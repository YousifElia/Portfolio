// ============================================================================
// raymarch.frag  —  per-pixel relativistic ray tracer
//
// For each screen pixel:
//   1) reconstruct the world-space view ray from the camera's projection;
//   2) integrate the photon geodesic with RK4 under the Kerr force law;
//   3) at every RK4 segment that intersects the disk's scale-height slab,
//      take adaptive sub-samples and accumulate volumetric emission +
//      absorption with Doppler / gravitational redshift;
//   4) terminate when the ray crosses the horizon (capture → black) or
//      escapes to infinity (sample procedural starfield in the deflected
//      direction — stars near the photon sphere appear as Einstein arcs
//      for free, because we sample at the BENT direction);
//   5) write linear HDR radiance — tone mapping happens in the filmic pass.
// ============================================================================

#include "common.glsl"
#include "kerr.glsl"
#include "geodesic_rk4.glsl"
#include "disk_volume.glsl"
#include "redshift.glsl"
#include "starfield.glsl"

precision highp float;

in vec2 vUv;

// --- Camera + projection ---------------------------------------------------
uniform vec3  uCamPos;
uniform mat4  uInvProj;
uniform mat4  uCamWorld;
uniform vec2  uResolution;
uniform float uTime;

// --- Black hole ------------------------------------------------------------
uniform float uM;          // mass parameter (M; defines length scale)
uniform float uSpin;       // spin a in M units, 0..0.998
uniform vec3  uSpinAxis;   // unit vector; default (0,1,0) (camera-friendly)

// --- Integrator ------------------------------------------------------------
uniform float uStepBase;   // base affine step size (~0.06–0.12)
uniform int   uMaxSteps;   // hard cap on RK4 steps per ray (<= 320)
uniform float uFarRadius;  // affine-distance early-out

// --- Disk geometry / appearance --------------------------------------------
uniform float uDiskIn;     // inner edge (~ ISCO)
uniform float uDiskOut;    // outer edge
uniform float uDiskH0;     // scale-height multiplier
uniform float uDiskKappa;  // extinction coefficient
uniform float uDiskEmiss;  // emissive scale
uniform float uDiskTempIn; // K, inner edge color temperature
uniform float uDiskTempOut;// K, outer edge color temperature

// --- Background ------------------------------------------------------------
uniform float uStarsGain;
uniform float uExposure;

// --- Frame-coherent noise dither (helps the volumetric integration) --------
float screenDither(vec2 fragXY){
  return hash13(vec3(fragXY, uTime * 60.0));
}

out vec4 outColor;

void main(){
  // ---------------------------------------------------------------------
  // 1) Reconstruct the world ray from screen UV through the inverse
  //    projection. Using the renderer's own matrices guarantees that the
  //    raymarch sees the same camera that the rest of the scene was
  //    framed for.
  // ---------------------------------------------------------------------
  vec2 ndc   = vUv * 2.0 - 1.0;
  vec4 vClip = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 vDir  = vClip.xyz / vClip.w;
  vec3 rayDir = normalize((uCamWorld * vec4(vDir, 0.0)).xyz);

  GeoState Y;
  Y.r = uCamPos;
  Y.v = rayDir;

  vec3 axis    = normalize(uSpinAxis);
  float horizon = kerrHorizon(uM, uSpin);
  float rPhoton = kerrPhotonOrbit(uM, uSpin);
  float diskIn = max(kerrISCO(uM, uSpin), horizon * 1.08);
  diskIn = max(diskIn, uDiskIn);

  // Stochastic offset on the first step — kills the "shell-banding" artifact
  // you otherwise see when many rays cross the same disk z-slab at exactly
  // the same affine parameter. Bounded in [0.5, 1.0] of the base step so the
  // first step always makes meaningful progress.
  float jitter = screenDither(gl_FragCoord.xy);
  {
    float dt0 = adaptiveStep(length(Y.r), rPhoton, uStepBase) * (0.5 + 0.5 * jitter);
    Y = rk4Step(Y, dt0, uM, uSpin, axis);
  }

  vec3  L  = vec3(0.0);   // accumulated radiance
  float Tr = 1.0;          // remaining transmittance through media
  float caustic = 0.0;     // higher-order photon-ring energy
  bool  captured = false;

  // ---------------------------------------------------------------------
  // 2) Geodesic integration loop with embedded volumetric disk sampling.
  // ---------------------------------------------------------------------
  for(int i = 0; i < 320; i++){
    if(i >= uMaxSteps) break;

    float r = length(Y.r);
    if(r < horizon * 1.005){ captured = true; break; }
    if(r > uFarRadius && dot(Y.v, Y.r) > 0.0) break;

    float dt = adaptiveStep(r, rPhoton, uStepBase);

    // Higher-order photon-ring caustic. Rays that skim the unstable photon
    // orbit spend longer near the hole and pick up extra disk images. This is
    // not a fake screen-space ring; it is integrated along the same bent path.
    float shell = exp(-pow((r - rPhoton) / max(0.20 * rPhoton, 0.25), 2.0));
    float grazing = smoothstep(0.55, 0.98, length(cross(normalize(Y.r), Y.v)));
    caustic += shell * grazing * dt;

    GeoState Yn = rk4Step(Y, dt, uM, uSpin, axis);

    // ---- Volumetric disk integration along this segment ---------------
    // Adaptive sub-stepping: take more samples when the segment lies near
    // or crosses the equatorial slab.
    DiskCoord d0 = diskFrame(Y.r,  axis);
    DiskCoord d1 = diskFrame(Yn.r, axis);
    float Havg   = max(uDiskH0 * (0.6 + 0.5 * 0.5 * (d0.s + d1.s)), 0.02);
    bool nearDisk = (abs(d0.z) < 4.0 * Havg || abs(d1.z) < 4.0 * Havg
                  || (d0.z * d1.z) < 0.0)  // crosses the plane
                  && (max(d0.s, d1.s) > diskIn * 0.85)
                  && (min(d0.s, d1.s) < uDiskOut * 1.10);

    if(nearDisk && Tr > 0.005){
      // Adaptive sub-sampling — finer when the segment crosses the equatorial
      // plane (z sign change), coarser when it just brushes the slab.
      bool crosses = (d0.z * d1.z) < 0.0;
      int subN = crosses ? 6 : 3;
      float invN = 1.0 / float(subN);
      float dsSub = dt * invN;
      // Stratified-jitter the sub-samples so banding doesn't survive.
      float jit = jitter * invN;
      for(int j = 0; j < 6; j++){
        if(j >= subN) break;
        float u = (float(j) + 0.5) * invN + jit * 0.6 - 0.3 * invN;
        u = clamp(u, 0.0, 1.0);
        vec3 p = mix(Y.r,  Yn.r, u);
        vec3 vd = normalize(mix(Y.v, Yn.v, u));

        float rho = diskDensity(p, axis, diskIn, uDiskOut, uDiskH0, uTime);
        if(rho < 1e-4) continue;

        DiskCoord dc = diskFrame(p, axis);
        vec3 emit    = diskEmission(p, axis, diskIn, uDiskOut,
                                    uDiskTempIn, uDiskTempOut);

        // Doppler from orbital flow + gravitational redshift.
        vec3  vOrbit = dc.ePhi;                       // prograde unit vector
        float beta   = diskOrbitalBeta(dc.s, uM, uSpin);
        // Photon direction at the emission point pointing TOWARD camera:
        // since vd is the photon direction along its forward path, the
        // direction TOWARD the camera is -vd at the emission point.
        float dop    = dopplerFactor(beta, vOrbit, -vd);
        float shift  = totalShift(dc.s, uM, uSpin, dop);
        emit         = applyRedshift(emit, shift) * beamingGain(shift);

        // Volumetric step: transmittance T *= exp(-κ ρ ds); emission
        // contribution = (radiance · absorbed-energy) × T_before.
        float opt   = uDiskKappa * rho * dsSub;
        float alpha = 1.0 - exp(-opt);
        L  += emit * uDiskEmiss * rho * Tr * alpha;
        Tr *= 1.0 - alpha;
        if(Tr < 0.003) break;
      }
    }

    Y = Yn;
  }

  // ---------------------------------------------------------------------
  // 3) Background contribution — only what escaped the disk and the hole.
  //    Sampling the *deflected* direction gives Einstein-ring stretching
  //    of stars near the photon sphere automatically.
  // ---------------------------------------------------------------------
  if(!captured && Tr > 0.003){
    vec3 bg = sampleStars(Y.v) * uStarsGain;
    L += bg * Tr;
  }

  if(!captured){
    vec3 ringTint = vec3(1.20, 0.74, 0.42);
    L += ringTint * min(caustic, 2.5) * 0.08 * Tr;
  }

  // Exposure (linear) — the filmic pass does the proper tone curve later.
  L *= uExposure;

  outColor = vec4(L, 1.0);
}

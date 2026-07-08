// ============================================================================
// disk_volume.glsl  —  volumetric, participating-media accretion disk
//
// The disk is modelled as a flattened torus around the equatorial plane:
//
//   ρ(r, z, φ, t) = radial(r) · vertical(r, z) · turbulence(r, φ, z, t)
//
// where r and φ are cylindrical coordinates in the disk frame (z aligned with
// the spin axis) and z is the height above the equatorial plane.
//
// During raymarching, every RK4 segment that has either endpoint inside the
// scale-height slab is sub-sampled and contributes a (radiance, opacity) pair.
// Transmittance is updated as T *= exp(-κ ρ ds), front-to-back, which makes
// the disk physically participating: stars and the lensed inner edge fade
// correctly behind nearer disk material.
// ============================================================================

#ifndef DISK_VOLUME_GLSL
#define DISK_VOLUME_GLSL

#include "common.glsl"
#include "kerr.glsl"

// --- Disk geometry parameters provided by host (uniforms) ------------------
// uDiskIn  — inner edge, typically the ISCO (~6M Schw / ~M extremal Kerr)
// uDiskOut — outer cosmetic radius
// uDiskH0  — scale height multiplier (0.04 thin, 0.12 puffy)
// uDiskKappa — opacity coefficient (extinction per unit density per unit ds)
// uDiskEmissivity — emissive scale
// uDiskTempIn  — color temperature (K) at the inner edge
// uDiskTempOut — color temperature (K) at the outer edge

// Project a Cartesian point r⃗ into the disk frame, returning (s, z) where:
//   s = cylindrical radius in disk plane
//   z = height above plane along spin axis
struct DiskCoord {
  float s;        // in-plane radius
  float z;        // perpendicular height
  float phi;      // azimuth in disk plane
  vec3  inPlane;  // projection onto plane (length s)
  vec3  ePhi;     // unit azimuthal (orbital) direction
};

DiskCoord diskFrame(vec3 r, vec3 axis){
  DiskCoord d;
  d.z       = dot(r, axis);
  d.inPlane = r - axis * d.z;
  d.s       = length(d.inPlane);
  // Pick a stable reference direction perpendicular to axis to define φ=0.
  vec3 ref  = abs(axis.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 eX   = normalize(cross(axis, ref));
  vec3 eY   = cross(axis, eX);
  float u   = dot(d.inPlane, eX);
  float v   = dot(d.inPlane, eY);
  d.phi     = atan(v, u);
  d.ePhi    = (d.s > 1e-4) ? normalize(cross(axis, d.inPlane / d.s)) : vec3(0.0);
  return d;
}

// Radial brightness profile — peaks near the inner edge, falls off as the
// material cools and thins outward. Power-law plus exponential cutoff.
float diskRadial(float s, float sIn, float sOut){
  if(s < sIn || s > sOut) return 0.0;
  float n  = (s - sIn) / max(sOut - sIn, 1e-4);
  float p  = pow(1.0 - n, 1.6);                // bright inner edge
  p *= smoothstep(0.0, 0.06, n);                // soft fade at inner edge
  p *= smoothstep(0.0, 0.15, 1.0 - n);          // soft fade at outer edge
  return p;
}

// Vertical (z) gaussian profile, scale height grows ~ s.
float diskVertical(float s, float z, float h0){
  float H = h0 * (0.6 + 0.5 * s);
  float u = z / max(H, 1e-3);
  return exp(-u * u);
}

// Turbulent multiplier — slow-moving streaks of denser gas. We compose two
// fbm samples at different scales rotating with orbital flow.
float diskTurbulence(float s, float phi, float z, float t){
  // Orbital flow rate ω ∝ 1/s^{3/2} (Keplerian). Multiply the azimuthal
  // coordinate so noise streaks rotate with the disk.
  float omega = 1.8 / (pow(s, 1.5) + 0.4);
  float a     = phi + omega * t;
  vec2 c1 = vec2(s * 1.4, a * 4.0);
  vec2 c2 = vec2(s * 0.6 - t * 0.03, a * 1.6);
  float f1 = fbm2(c1, 4);
  float f2 = fbm2(c2, 3);
  float band = sin(a * 11.0 + s * 0.9 - t * 0.7) * 0.5 + 0.5;
  return clamp(0.5 + 0.7 * f1 + 0.4 * f2 + 0.1 * band, 0.15, 1.6);
}

// Full density at a Cartesian point. Returns 0 outside the disk slab.
float diskDensity(vec3 r, vec3 axis, float sIn, float sOut, float h0, float t){
  DiskCoord d = diskFrame(r, axis);
  float rad   = diskRadial(d.s, sIn, sOut);
  if(rad < 1e-4) return 0.0;
  float vert  = diskVertical(d.s, d.z, h0);
  if(vert < 1e-4) return 0.0;
  float turb  = diskTurbulence(d.s, d.phi, d.z, t);
  return rad * vert * turb;
}

// Emission color at a point. Interstellar hero-shot palette: blistering
// white-blue at the inner edge, light blue mid-disk, deep cobalt at the
// outer rim. This is the high-temperature regime used in the film's
// Gargantua hero shot — physically a ~10⁷ K accretion disk would peak in
// UV/X-ray, but for visualisation we map the inner edge to pure white with
// a slight blue cast and let the outer regions cool into a deep blue.
//
// Returns linear-HDR radiance.
vec3 diskEmission(vec3 r, vec3 axis, float sIn, float sOut,
                  float Tin, float Tout){
  DiskCoord d = diskFrame(r, axis);
  float n = clamp((d.s - sIn) / max(sOut - sIn, 1e-4), 0.0, 1.0);

  // 3-stop ramp — pure-white hot, light-blue mid, deep cobalt outer.
  vec3 hot  = vec3(1.05, 1.10, 1.20);  // white with slight blue
  vec3 mid  = vec3(0.55, 0.80, 1.20);  // light blue
  vec3 cold = vec3(0.08, 0.22, 0.55);  // deep cobalt
  vec3 ramp = mix(hot, mid, smoothstep(0.0,  0.35, n));
  ramp      = mix(ramp, cold, smoothstep(0.35, 1.0,  n));

  // Subtle blackbody bias so Doppler chromatic shifts still separate the
  // approaching and receding sides — without it the disk is monochrome
  // and the Kerr spin asymmetry vanishes.
  float Trel = pow(1.0 - n, 0.75);
  float T    = mix(Tout, Tin, Trel);
  vec3 bb    = blackbody(T);
  vec3 col   = mix(ramp, ramp * bb * 1.25, 0.30);

  // Luminosity concentrated toward the inner edge — the hot rim is where
  // most of the disk's light comes from.
  float lum  = pow(1.0 - n, 1.6) * 2.2 + 0.12;
  return col * lum;
}

// Orbital direction (unit) for material at this point — used for Doppler.
// Returns zero outside the disk plane projection.
// Direction sign: prograde with the spin axis (axis × inPlane, normalised).
vec3 diskOrbitalDir(vec3 r, vec3 axis){
  DiskCoord d = diskFrame(r, axis);
  if(d.s < 1e-4) return vec3(0.0);
  return d.ePhi;
}

// Orbital speed β = v/c for a circular Keplerian orbit at radius s (in M=1
// units). Relativistically corrected via Schwarzschild orbital velocity:
//   β² = M / (s - 2M)        for s > 2M
// Capped at 0.95 to avoid divergence as s → r_ISCO.
float diskOrbitalBeta(float s, float M, float a){
  float m = max(M, 1e-4);
  float x = max(s / m, kerrHorizon(M, a) / m + 0.04);
  float aBar = clamp(a / m, -0.998, 0.998);

  // Prograde Kerr angular velocity in geometric units:
  // omega = 1 / (r^(3/2) + a). The mild lapse correction keeps the local
  // speed high near the horizon without exploding inside the ergosphere.
  float omega = 1.0 / (pow(x, 1.5) + aBar);
  float lapse = sqrt(max(1.0 - 2.0 / max(x, 2.04) + (aBar * aBar) / (x * x),
                         0.10));
  float beta = x * omega / lapse;
  return clamp(beta, 0.0, 0.82);
}

#endif // DISK_VOLUME_GLSL

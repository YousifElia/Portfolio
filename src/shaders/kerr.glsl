// ============================================================================
// kerr.glsl  —  Kerr metric quantities + photon geodesic right-hand side
//
// We integrate photon trajectories as a second-order ODE in Cartesian space,
// using an "equatorial-reduced 3D" formulation:
//
//   dr⃗/dλ = v⃗
//   dv⃗/dλ = a⃗(r⃗, v⃗; M, a, ω̂)
//
// where the acceleration is the sum of:
//
//   1) Leading-order Schwarzschild deflection in vector form,
//      derived from the orbital equation d²u/dφ² + u = 3Mu² with u = 1/r:
//
//        a⃗_S = -(3/2) · r_s · h² / r⁵ · r⃗,         h² = |r⃗ × v⃗|²
//
//      r_s = 2M is the Schwarzschild radius. This single term alone already
//      produces the photon sphere at r = 1.5 r_s = 3M and an Einstein ring.
//
//   2) Kerr frame-dragging (Lense–Thirring), leading order in a:
//
//        a⃗_LT = (2 M a / r³) · (ω̂ × v⃗)
//
//      Pushes prograde photons forward and retrograde photons backward,
//      twisting the lensed background and offsetting the photon ring to one
//      side of the silhouette.
//
//   3) Shadow asymmetry (next-to-leading-order Kerr correction):
//
//        a⃗_Q = a² M / r⁴ · ((r̂·ω̂)² - 1/3) · r̂
//
//      Breaks spherical symmetry of the shadow into the characteristic D-shape
//      of a high-spin Kerr black hole.
//
// This is a deliberate reduction of the full 4-coordinate Kerr geodesic
// equations (Boyer–Lindquist, with E, L_z, Q conserved) into a 3D vector
// equation that is RK4-friendly per fragment. It reproduces the visual
// signatures of Kerr (asymmetric ring, frame-dragged background, D-shadow)
// while remaining tractable in real-time. Reference: arXiv:1502.03808
// (Double Negative Gravitational Renderer) and oseiskar/black-hole.
// ============================================================================

#ifndef KERR_GLSL
#define KERR_GLSL

#include "common.glsl"

// Horizon radius of a Kerr black hole in M=1 units:
//   r_+ = M + sqrt(M² - a²)
// Photons that cross r_+ are gone — we treat this as capture.
float kerrHorizon(float M, float a){
  return M + sqrt(max(M*M - a*a, 0.0));
}

// Ergosphere radius in the equatorial plane (θ=π/2):
//   r_E = M + sqrt(M² - a² cos²θ)
// At the equator this is just 2M regardless of a. Used for cosmetic glow.
float kerrErgoEquator(float M){ return 2.0 * M; }

// Photon-orbit radius in the equatorial plane (prograde):
//   r_ph = 2M [1 + cos(2/3 acos(-a/M))]
// We use this to taper the integration step finer near the photon ring.
float kerrPhotonOrbit(float M, float a){
  // Stable to a=0: cos(2/3 acos(0)) = cos(π/3) = 0.5 → r_ph = 3M ✓
  float ac = clamp(-a / max(M, 1e-4), -1.0, 1.0);
  return 2.0 * M * (1.0 + cos(2.0/3.0 * acos(ac)));
}

// Innermost stable circular orbit for equatorial Kerr orbits. Positive spin
// is prograde with the disk and pulls the bright inner edge toward r_+.
float kerrISCO(float M, float a){
  float m = max(M, 1e-4);
  float x = clamp(a / m, -0.998, 0.998);
  float x2 = x * x;
  float z1 = 1.0 + pow(1.0 - x2, 1.0 / 3.0) *
             (pow(1.0 + x, 1.0 / 3.0) + pow(1.0 - x, 1.0 / 3.0));
  float z2 = sqrt(3.0 * x2 + z1 * z1);
  float sgn = x < 0.0 ? -1.0 : 1.0;
  float root = sqrt(max((3.0 - z1) * (3.0 + z1 + 2.0 * z2), 0.0));
  return m * (3.0 + z2 - sgn * root);
}

// Gravitational redshift factor for a static emitter at radius r,
// observed at infinity:
//   f_obs / f_emit = sqrt(1 - r_s / r)
// Real disk material orbits, so the orbital Doppler factor is applied
// separately in the disk module; this is the pure gravitational piece.
float gravRedshift(float r, float M, float a){
  float rPlus = kerrHorizon(M, a);
  return sqrt(max((r - rPlus) / max(r, rPlus * 1.0001), 1e-4));
}

float gravRedshift(float r, float M){
  return gravRedshift(r, M, 0.0);
}

// --- Photon acceleration ---------------------------------------------------
// Inputs:
//   r       — position (Cartesian, M=1 units, hole at origin)
//   v       — direction (unit vector, current ray tangent)
//   M       — gravitational mass parameter
//   a       — spin parameter (0 = Schwarzschild, ≤ M for sub-extremal Kerr)
//   axis    — unit spin axis (Cartesian)
// Output:
//   3D acceleration vector a⃗ such that dv⃗/dλ = a⃗.
vec3 photonAccel(vec3 r, vec3 v, float M, float a, vec3 axis){
  float r2   = dot(r, r);
  float rmag = sqrt(max(r2, 1e-8));
  float r3   = r2 * rmag;
  float r4   = r2 * r2;
  float r5   = r4 * rmag;

  vec3  L    = cross(r, v);
  float L2   = dot(L, L);
  float rs   = 2.0 * M;

  // Schwarzschild vector form.
  vec3 aSchw = -1.5 * rs * L2 / r5 * r;

  // Kerr frame-dragging.
  vec3 aDrag = (2.0 * M * a / r3) * cross(axis, v);

  // Kerr shadow asymmetry (D-shape) — small contribution outside ~3M, ramps
  // up near the photon ring at high spin.
  vec3  rhat   = r / rmag;
  float zcomp  = dot(rhat, axis);
  float quadF  = (zcomp * zcomp - 0.333333);
  vec3  aQuad  = (a * a * M / r4) * quadF * rhat;

  return aSchw + aDrag + aQuad;
}

#endif // KERR_GLSL

// ============================================================================
// geodesic_rk4.glsl  —  fourth-order Runge–Kutta integrator for the photon
// geodesic, with adaptive step size keyed off the current radial distance.
//
// State Y = (r⃗, v⃗) in ℝ⁶. The RHS is
//   f(Y) = (v⃗, a⃗(r⃗, v⃗))
// where a⃗ is photonAccel() from kerr.glsl. RK4 update for step h:
//   k1 = f(Y)
//   k2 = f(Y + h/2 k1)
//   k3 = f(Y + h/2 k2)
//   k4 = f(Y +  h   k3)
//   Y' = Y + h/6 (k1 + 2k2 + 2k3 + k4)
// ============================================================================

#ifndef GEODESIC_RK4_GLSL
#define GEODESIC_RK4_GLSL

#include "kerr.glsl"

struct GeoState { vec3 r; vec3 v; };

// One RK4 step. dt is the (possibly already-adapted) affine-parameter step.
GeoState rk4Step(GeoState Y, float dt, float M, float a, vec3 axis){
  // k1
  vec3 k1r = Y.v;
  vec3 k1v = photonAccel(Y.r, Y.v, M, a, axis);
  // k2
  vec3 r2  = Y.r + 0.5 * dt * k1r;
  vec3 v2  = Y.v + 0.5 * dt * k1v;
  vec3 k2r = v2;
  vec3 k2v = photonAccel(r2, v2, M, a, axis);
  // k3
  vec3 r3  = Y.r + 0.5 * dt * k2r;
  vec3 v3  = Y.v + 0.5 * dt * k2v;
  vec3 k3r = v3;
  vec3 k3v = photonAccel(r3, v3, M, a, axis);
  // k4
  vec3 r4  = Y.r + dt * k3r;
  vec3 v4  = Y.v + dt * k3v;
  vec3 k4r = v4;
  vec3 k4v = photonAccel(r4, v4, M, a, axis);

  GeoState Yn;
  Yn.r = Y.r + dt / 6.0 * (k1r + 2.0*k2r + 2.0*k3r + k4r);
  Yn.v = Y.v + dt / 6.0 * (k1v + 2.0*k2v + 2.0*k3v + k4v);
  // Renormalise the tangent — for null geodesics the affine parameter sets
  // |v⃗| = 1 in the local flat frame, and finite-precision drift would
  // otherwise let the integrator accelerate or decelerate the photon.
  Yn.v = normalize(Yn.v);
  return Yn;
}

// Adaptive step size — fine near the photon sphere, coarse far away.
// r_ph is the photon-orbit radius from kerrPhotonOrbit().
float adaptiveStep(float r, float rPhoton, float baseStep){
  // Steep tightening when r approaches r_ph: 1/(1 + (r/r_ph)²)
  // gives ≈1 when r=r_ph and ≈0.5 at r=r_ph√1 — i.e. fine in the lensing
  // shell. Far away, scale ∝ r so we cross interstellar distance fast.
  float near = 1.0 / (0.4 + (r / max(rPhoton, 0.5)));
  float far  = max(1.0, r * 0.10);
  float nearBlend = 1.0 - smoothstep(rPhoton * 1.2, rPhoton * 4.0, r);
  return clamp(baseStep * mix(far, near, nearBlend),
               baseStep * 0.28, baseStep * 12.0);
}

#endif // GEODESIC_RK4_GLSL

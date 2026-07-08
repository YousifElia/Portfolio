// ============================================================================
// redshift.glsl  —  Doppler + gravitational redshift, applied to emitted
// radiance at the point of emission and the photon direction at that point.
//
// For a photon emitted by a source moving with 3-velocity v_emit (β = |v|/c)
// in a stationary gravitational field, the frequency shift seen by a far
// observer factors as:
//
//   f_obs / f_emit  =  δ_grav · δ_Doppler
//
//   δ_grav   = sqrt(1 - r_s / r_emit)         (Schwarzschild far-observer)
//   δ_Doppler = 1 / (γ (1 - β · μ))            (special-relativistic)
//
// where μ = cos(angle between v_emit and the photon's outgoing direction in
// the local rest frame), γ = 1/√(1−β²). The total shift δ_tot blue/redshifts
// the spectrum, and the apparent radiance scales as δ_tot⁴ (Liouville's
// theorem applied to specific intensity — relativistic beaming).
//
// This file exposes:
//   dopplerFactor(beta, vdir, photonDir)   →  δ_Doppler
//   totalShift(rEmit, M, spin, dopDoppler) →  δ_tot
//   beamingGain(δ_tot)                     →  δ_tot⁴ (clamped)
//   applyRedshift(color, δ_tot)            →  chromatically-shifted color
// ============================================================================

#ifndef REDSHIFT_GLSL
#define REDSHIFT_GLSL

#include "common.glsl"
#include "kerr.glsl"

// Special-relativistic Doppler. `beta` is the speed of the emitter (units c),
// `vDir` its direction of motion, `photonDir` the photon direction at the
// emission point (pointing AWAY from emitter toward observer).
float dopplerFactor(float beta, vec3 vDir, vec3 photonDir){
  beta = clamp(beta, 0.0, 0.999);
  float mu    = clamp(dot(vDir, photonDir), -1.0, 1.0);
  float gamma = 1.0 / sqrt(1.0 - beta * beta);
  return 1.0 / (gamma * (1.0 - beta * mu));
}

// Total shift factor combining gravitational and Doppler pieces.
float totalShift(float rEmit, float M, float spin, float dopDoppler){
  return gravRedshift(rEmit, M, spin) * dopDoppler;
}

float totalShift(float rEmit, float M, float dopDoppler){
  return totalShift(rEmit, M, 0.0, dopDoppler);
}

// Relativistic beaming — specific intensity I_ν scales as δ⁴ along the
// photon path (Liouville). We clamp to a sane range so the approaching side
// of the disk doesn't blow the tone mapper apart.
float beamingGain(float shift){
  return clamp(pow(shift, 4.0), 0.05, 4.5);
}

// Chromatic remap that *visually* moves a spectrum's centroid. This is not a
// rigorous spectral redshift (which would require sampling a Planck curve at
// the emitted wavelengths and integrating against the observer's RGB
// sensitivity curves) — instead it remaps the apparent color temperature so
// blueshifted emission looks bluer, redshifted emission looks redder, with
// the right qualitative response. Good enough for cinematic visuals and ~3×
// cheaper than a true spectral resample.
vec3 applyRedshift(vec3 color, float shift){
  // shift < 1 → redshift, > 1 → blueshift.
  // Convert shift to a delta in "temperature units" and lerp.
  float s = clamp(shift, 0.25, 3.5);
  // Cool→warm warp parameters tuned to feel cinematic.
  vec3 warmShift = vec3(0.20, 0.50, 1.30);  // bright blue side
  vec3 coldShift = vec3(1.45, 0.55, 0.18);  // warm red side
  float k = clamp((s - 0.6) / 1.6, 0.0, 1.0);
  vec3 chroma = mix(coldShift, warmShift, k);
  return color * chroma;
}

#endif // REDSHIFT_GLSL

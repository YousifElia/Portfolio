// ============================================================================
// starfield.glsl  —  procedural 3D starfield sampled by ray direction
// The background is sampled in the *deflected* direction, so near the photon
// ring stars naturally curve into Einstein-ring arcs without any post-process.
// ============================================================================

#ifndef STARFIELD_GLSL
#define STARFIELD_GLSL

#include "common.glsl"

// Multi-octave star sampler. `dir` is a unit world-space ray direction.
// The returned color is unbounded HDR — bright stars deliberately exceed 1.0
// so the bloom stage gives them halation.
vec3 sampleStars(vec3 dir){
  vec3 col = vec3(0.0);

  // Three octaves of star density, exponentially increasing cell count so the
  // density looks like a real night sky (lots of dim stars + few bright).
  for(int i = 0; i < 3; i++){
    float fi    = float(i);
    float scale = 70.0 * exp2(fi);
    vec3  d     = dir * scale;
    vec3  cell  = floor(d);
    vec3  fr    = fract(d);
    float h     = hash13(cell + fi * 7.3);
    float thr   = 0.991 - fi * 0.0025;
    if(h > thr){
      vec3 cen = vec3(
        hash13(cell + 1.7 + fi),
        hash13(cell + 3.1 + fi),
        hash13(cell + 5.5 + fi)
      );
      vec3  sp = fr - cen;
      float br = exp(-dot(sp, sp) * 95.0);
      // Color temperature variety (hot blue-white → cool warm).
      float T  = mix(2800.0, 11500.0, hash13(cell + 11.0 + fi));
      vec3  ti = blackbody(T) * 0.9 + 0.1;
      col += ti * br * pow(h - thr, 1.15) * 32.0;
    }
  }

  // Soft interstellar dust / nebulosity, very low brightness, sampled in 2D
  // projections of the direction so it flows across the sky without obvious
  // tiling. Cooled blue with a faint warm undertone — reads as galactic dust.
  vec2  proj = vec2(atan(dir.z, dir.x) * INV_PI * 0.5, asin(clamp(dir.y, -1.0, 1.0)) * INV_PI);
  float gas1 = fbm2(proj * 6.0,      4);
  float gas2 = fbm2(proj * 18.0 + 4.0, 3);
  float gas  = pow(gas1 * 0.7 + gas2 * 0.3, 2.0);
  vec3 dustCool = vec3(0.020, 0.030, 0.055);
  vec3 dustWarm = vec3(0.045, 0.030, 0.018);
  col += mix(dustCool, dustWarm, gas2 * 0.6) * gas * 1.2;

  return col;
}

#endif // STARFIELD_GLSL

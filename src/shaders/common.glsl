// ============================================================================
// common.glsl  —  hashes, noise, color utilities, math constants
// Included by every other shader via #include "common.glsl".
// ============================================================================

#ifndef COMMON_GLSL
#define COMMON_GLSL

const float PI      = 3.141592653589793;
const float TWO_PI  = 6.283185307179586;
const float INV_PI  = 0.318309886183791;

// --- Hashes ----------------------------------------------------------------
float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// --- 2D value noise + fbm --------------------------------------------------
float vnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float a = hash13(vec3(i, 0.0));
  float b = hash13(vec3(i + vec2(1.0, 0.0), 0.0));
  float c = hash13(vec3(i + vec2(0.0, 1.0), 0.0));
  float d = hash13(vec3(i + vec2(1.0, 1.0), 0.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm2(vec2 p, int octaves){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 8; i++){
    if(i >= octaves) break;
    v += a * vnoise2(p);
    p = p * 2.07 + 17.7;
    a *= 0.5;
  }
  return v;
}

// --- 3D value noise + fbm --------------------------------------------------
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float a = hash13(i + vec3(0,0,0));
  float b = hash13(i + vec3(1,0,0));
  float c = hash13(i + vec3(0,1,0));
  float d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1));
  float g = hash13(i + vec3(1,0,1));
  float h = hash13(i + vec3(0,1,1));
  float k = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y),
             mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}
float fbm3(vec3 p, int octaves){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 8; i++){
    if(i >= octaves) break;
    v += a * vnoise3(p);
    p = p * 2.07 + 17.7;
    a *= 0.5;
  }
  return v;
}

// --- Blackbody radiation (Planck approximation) ----------------------------
// Returns linear-RGB roughly matching a blackbody at temperature T (Kelvin).
// Approximation from Tanner Helland fit, fast enough for per-fragment use.
vec3 blackbody(float T){
  T = clamp(T, 1000.0, 40000.0);
  float t = T * 0.01;
  vec3 c;
  // Red
  c.r = T <= 6600.0 ? 1.0
                    : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
  // Green
  c.g = T <= 6600.0 ? clamp(0.390081 * log(t) - 0.631841, 0.0, 1.0)
                    : clamp(1.129891 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  // Blue
  c.b = T >= 6600.0 ? 1.0
                    : (T <= 1900.0 ? 0.0
                                   : clamp(0.543206 * log(t - 10.0) - 1.196254,
                                           0.0, 1.0));
  return c;
}

// Apply Doppler/gravitational redshift factor `dop` (=f_obs/f_emit) to a
// blackbody-like color by remapping its peak. dop>1 blueshifts, dop<1 reds.
vec3 redshiftColor(vec3 c, float dop){
  // Simple chromatic shift: scale channels by Planck-like response.
  // dop^4 also brightens (relativistic beaming) — applied elsewhere.
  float r = c.r * mix(1.6, 0.45, clamp(dop * 0.5, 0.0, 1.0));
  float g = c.g * mix(1.2, 0.85, clamp((dop - 0.5) * 0.7, 0.0, 1.0));
  float b = c.b * mix(0.35, 1.8, clamp((dop - 0.4) * 0.6, 0.0, 1.0));
  return vec3(r, g, b);
}

// --- sRGB / linear utilities -----------------------------------------------
vec3 linearToSRGB(vec3 c){
  return mix(12.92 * c, 1.055 * pow(max(c, 1e-6), vec3(1.0/2.4)) - 0.055,
             step(0.0031308, c));
}
vec3 sRGBToLinear(vec3 c){
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)),
             step(0.04045, c));
}

#endif // COMMON_GLSL

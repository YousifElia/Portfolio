// ============================================================================
// post_filmic.frag  —  cinematic finish stage (final pass).
//
// Receives the already-bloomed HDR scene (scene + bloom additively combined
// upstream by UnrealBloomPass) and applies, in order:
//
//   1) Anamorphic halation  — horizontal warm bleed off bright highlights
//      (Interstellar's signature glow around the disk's hot inner rim).
//   2) Chromatic aberration — small per-channel UV offset growing toward the
//      frame edges, emulating an anamorphic lens.
//   3) ACES filmic tone map — Stephen Hill's "fitted" ACES (cheap, never
//      clips magenta, gives a real cinematic shoulder).
//   4) Color grade           — cool shadows / warm highlights, lift saturation.
//   5) Vignette + film grain.
//   6) sRGB encode.
//
// Pipeline note: this pass is renderer-agnostic. It does its own sRGB
// encode so it works regardless of `renderer.outputColorSpace`.
// ============================================================================

#include "common.glsl"

precision highp float;
precision highp sampler2D;

in vec2 vUv;

uniform sampler2D tDiffuse;            // bloomed HDR scene (linear)
uniform vec2  uResolution;
uniform float uTime;
uniform float uHalation;
uniform float uChromAb;
uniform float uVignette;
uniform float uGrain;
uniform float uExposure;
uniform float uSaturation;

// --- ACES filmic (Stephen Hill fit) ---------------------------------------
const mat3 ACES_IN = mat3(
   0.59719, 0.07600, 0.02840,
   0.35458, 0.90834, 0.13383,
   0.04823, 0.01566, 0.83777
);
const mat3 ACES_OUT = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602
);
vec3 acesFilm(vec3 x){
  vec3 v = ACES_IN * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(ACES_OUT * (a / b), 0.0, 1.0);
}

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

out vec4 outColor;

void main(){
  vec2 uv = vUv;
  vec2 toCenter = uv - 0.5;
  float r2 = dot(toCenter, toCenter);

  // ---- Chromatic aberration  (sample BEFORE tone map) -------------------
  float ca = uChromAb * (0.6 + 1.4 * r2);
  vec2 caDir = normalize(toCenter + vec2(1e-5));
  vec3 col;
  col.r = texture(tDiffuse, uv - caDir * ca * 1.00).r;
  col.g = texture(tDiffuse, uv - caDir * ca * 0.00).g;
  col.b = texture(tDiffuse, uv + caDir * ca * 1.00).b;

  // ---- Anamorphic halation  (horizontal warm bleed) ---------------------
  if(uHalation > 0.001){
    float texel = 1.0 / uResolution.x;
    vec3 acc = vec3(0.0);
    // 6-tap horizontal sample of bright neighborhood — cheap, holds the
    // film-halation feeling without needing a dedicated buffer.
    for(int i = 1; i <= 6; i++){
      float fi = float(i);
      float w  = exp(-fi * fi * 0.05);
      vec3 a = texture(tDiffuse, uv + vec2(  fi * 8.0 * texel, 0.0)).rgb;
      vec3 b = texture(tDiffuse, uv + vec2( -fi * 8.0 * texel, 0.0)).rgb;
      // Only the OVERBRIGHT portion (>~0.7 luminance) contributes — keeps
      // halation off the main image, glowing only where photons cluster.
      float la = max(luma(a) - 0.7, 0.0);
      float lb = max(luma(b) - 0.7, 0.0);
      acc += (a * la + b * lb) * w;
    }
    vec3 haloTint = vec3(1.25, 0.62, 0.30);
    col += haloTint * acc * 0.18 * uHalation;
  }

  col *= uExposure;

  // ---- ACES tone map ----------------------------------------------------
  col = acesFilm(col);

  // ---- Color grade ------------------------------------------------------
  // Lift shadows toward cyan, highlights toward warm amber. This is the
  // teal/orange split that gives the Interstellar palette its character.
  float L = luma(col);
  vec3 cool = vec3(0.84, 0.94, 1.08);
  vec3 warm = vec3(1.10, 1.00, 0.88);
  vec3 grade = mix(cool, warm, smoothstep(0.05, 0.85, L));
  col *= grade;

  // Saturation: keep darks neutral, push highlights colorful.
  float sat = mix(0.94, uSaturation, smoothstep(0.18, 0.85, L));
  col = mix(vec3(L), col, sat);

  // ---- Vignette + grain -------------------------------------------------
  float vig = 1.0 - smoothstep(0.42, 1.10,
              length(toCenter * vec2(uResolution.x / uResolution.y, 1.0)) * 1.18);
  col *= mix(1.0, vig, uVignette);

  float g = (hash13(vec3(gl_FragCoord.xy, uTime * 1000.0)) - 0.5) * uGrain;
  col += g;

  // ---- sRGB encode ------------------------------------------------------
  col = linearToSRGB(clamp(col, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}

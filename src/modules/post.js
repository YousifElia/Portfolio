// ============================================================================
// post.js  —  post-processing chain.
//
// EffectComposer pipeline:
//   RenderPass(scene, camera)      // raymarch quad → HDR target
//   UnrealBloomPass                // multi-mip Gaussian bloom, additive
//   FilmicPass                     // halation + CA + ACES + grade + grain
//                                  //  + sRGB encode
//
// The composer writes HDR (HalfFloatType) up to the filmic pass, which is the
// only stage that gamma-encodes for the framebuffer. Order matters: bloom
// MUST run on linear HDR before tonemapping, otherwise highlights wash out.
// ============================================================================

import * as THREE from 'https://esm.sh/three@0.160.0';
import { EffectComposer }   from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }       from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass }       from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js';

export function buildPostChain({ renderer, scene, camera, vertSrc, filmicSrc, width, height }){
  const pr = renderer.getPixelRatio();

  // HDR-capable render target. HalfFloatType keeps the volumetric disk's
  // overbright inner edge from clipping before the tone mapper sees it.
  const rt = new THREE.WebGLRenderTarget(width * pr, height * pr, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(width, height);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom — tuned for the Gargantua hero shot: enough strength + radius to
  // give the lensed arc and inner rim a luminous glow, but a non-zero
  // threshold so the shadow stays unambiguously dark.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.76,   // strength
    0.58,   // radius
    0.30    // threshold
  );
  composer.addPass(bloom);

  // Filmic finish — single fullscreen pass that takes the bloom output as
  // its sole input and runs CA, halation, ACES, color grade, grain.
  //
  // ShaderPass swallows `glslVersion` when given a plain shader object, so we
  // build the ShaderMaterial explicitly (ShaderPass detects this branch and
  // reuses the material instead of recreating it).
  const filmicMat = new THREE.ShaderMaterial({
    name: 'FilmicPass',
    glslVersion: THREE.GLSL3,
    uniforms: {
      tDiffuse:    { value: null },
      uResolution: { value: new THREE.Vector2(width * pr, height * pr) },
      uTime:       { value: 0 },
      uHalation:   { value: 0.30 },
      uChromAb:    { value: 0.0008 },
      uVignette:   { value: 0.55 },
      uGrain:      { value: 0.006 },
      uExposure:   { value: 1.00 },
      uSaturation: { value: 1.10 },
    },
    vertexShader:   vertSrc,
    fragmentShader: filmicSrc,
  });
  const filmic = new ShaderPass(filmicMat);
  composer.addPass(filmic);

  function setSize(w, h){
    const pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    filmic.uniforms.uResolution.value.set(w * pr, h * pr);
  }
  function setTime(t){ filmic.uniforms.uTime.value = t; }

  return { composer, bloom, filmic, setSize, setTime };
}

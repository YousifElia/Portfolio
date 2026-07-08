// ============================================================================
// renderer.js  —  renderer factory.
//
// Strategy:
//   * Probe WebGPU and expose the adapter result to the host UI.
//   * Keep the production path on WebGL2 because this renderer is deliberately
//     GLSL ShaderMaterial + EffectComposer based. Three's WebGPU path is a
//     TSL/WGSL material pipeline, so a true WebGPU port should live behind
//     this same factory instead of half-migrating the current shader stack.
//   * Both paths use linear HDR throughput. We do the sRGB encode
//     ourselves in the filmic shader so the renderer's outputColorSpace
//     setting is irrelevant to the cinematic result.
//
// This is the single point where the renderer is chosen.
// ============================================================================

import * as THREE from 'https://esm.sh/three@0.160.0';

export async function createRenderer({ canvas, pixelRatio = 1.5 } = {}){
  const caps = {
    webgpu: typeof navigator !== 'undefined' && !!navigator.gpu,
    webgpuAdapter: false,
    webgpuPath: 'deferred-tsl-port',
  };
  if(caps.webgpu){
    // Probe to differentiate "browser exposes navigator.gpu" from
    // "an adapter is actually available" — older Linux drivers may fail.
    try{
      const adapter = await navigator.gpu.requestAdapter();
      caps.webgpuAdapter = !!adapter;
    }catch{ caps.webgpuAdapter = false; }
  }
  console.info('[renderer] capabilities:', caps);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
    depth: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;  // filmic shader → sRGB
  renderer.toneMapping = THREE.NoToneMapping;               // filmic shader → ACES

  const gl = renderer.getContext();
  caps.webgl2 = !!(gl && typeof WebGL2RenderingContext !== 'undefined' &&
                   gl instanceof WebGL2RenderingContext);
  caps.backendReason = caps.webgpuAdapter
    ? 'WebGPU adapter available; GLSL/EffectComposer pipeline is running on WebGL2 until the shader stack is ported to TSL/WGSL.'
    : 'WebGPU adapter unavailable; using WebGL2 GLSL pipeline.';

  return {
    renderer,
    backend: caps.webgl2 ? 'webgl2-glsl' : 'webgl-glsl',
    caps,
  };
}

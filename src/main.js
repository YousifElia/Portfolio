// ============================================================================
// main.js  —  bootstrap. Loads shaders, builds the renderer + scene + Kerr
// raymarch pass + post chain, and exposes a small control surface for the
// host HTML (scroll-driven camera dive, dev GUI).
// ============================================================================

import * as THREE          from 'https://esm.sh/three@0.160.0';
import { ShaderLoader }    from './modules/shaderLoader.js';
import { createRenderer }  from './modules/renderer.js';
import { buildBlackHolePass } from './modules/blackhole.js';
import { buildPostChain }  from './modules/post.js';
import { createQualityManager } from './modules/quality.js';

const SHADERS_BASE = './src/shaders/';

export async function init({ container, onReady, onProgress }){
  const devMode = new URLSearchParams(location.search).has('dev');
  onProgress?.({ stage: 'shaders', t: 0 });

  // ---- 1) Load shaders --------------------------------------------------
  const sl = new ShaderLoader(SHADERS_BASE);
  const [fullscreenVert, raymarchFrag, filmicFrag] = await Promise.all([
    sl.load('fullscreen.vert'),
    sl.load('raymarch.frag'),
    sl.load('post_filmic.frag'),
  ]);
  onProgress?.({ stage: 'renderer', t: 0.35 });

  // ---- 2) Renderer ------------------------------------------------------
  const { renderer, backend, caps } = await createRenderer({ pixelRatio: 1.5 });
  container.appendChild(renderer.domElement);
  onProgress?.({ stage: 'scene', t: 0.55 });

  // ---- 3) Scene + camera ------------------------------------------------
  // Single scene: just the raymarch quad. Everything else is generated
  // inside the fragment shader (background stars, lensing, disk volume).
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    52,                                   // wider FOV reads more cinematic
    window.innerWidth / window.innerHeight,
    0.01, 5000
  );

  // Camera path — in M=1 units.
  //   Start: just above the disk plane (~1.5° tilt), distance ≈ 24M. The
  //          near side of the disk extends past the frame edges, the lensed
  //          back wraps OVER the top of the shadow, the hole projects to
  //          exact screen center (camera looks at origin). This is the
  //          iconic Interstellar / Gargantua hero shot.
  //   End:   distance ≈ 5.5M, near the photon sphere — dramatic dive into
  //          the light wrap.
  const camStart = new THREE.Vector3(0.0,  1.35, 13.5);
  const camEnd   = new THREE.Vector3(0.0,  0.72, 4.3);
  camera.position.copy(camStart);
  camera.lookAt(0, 0, 0);

  const bh = buildBlackHolePass({
    vertSrc: fullscreenVert,
    fragSrc: raymarchFrag,
    width: renderer.domElement.width,
    height: renderer.domElement.height,
  });
  scene.add(bh.mesh);

  // ---- 4) Post chain ----------------------------------------------------
  const post = buildPostChain({
    renderer, scene, camera,
    vertSrc: fullscreenVert,
    filmicSrc: filmicFrag,
    width: window.innerWidth, height: window.innerHeight,
  });

  const quality = createQualityManager({
    renderer,
    bh,
    post,
    enabled: !devMode,
  });
  onProgress?.({ stage: 'compile', t: 0.85 });

  // ---- 5) Render loop ---------------------------------------------------
  let t = 0;
  let running = false;
  let rafId = 0;
  let lastNow = performance.now();
  function frame(now = performance.now()){
    if(!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(Math.max((now - lastNow) * 0.001, 0.0), 0.05);
    lastNow = now;
    t += dt || 1/60;
    quality.update(now);
    bh.sync(camera, t);
    post.setTime(t);
    post.composer.render();
  }

  // ---- 6) Resize --------------------------------------------------------
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    quality.resize();
  });

  // ---- 7) Control surface for the host page -----------------------------
  const handle = {
    backend, caps,
    camera, camStart, camEnd,
    bloom: post.bloom,
    filmic: post.filmic,
    quality,
    bh,
    start(){
      if(running) return;
      running = true;
      lastNow = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    stop(){
      running = false;
      if(rafId) cancelAnimationFrame(rafId);
    },
    setBloom(strength){ post.bloom.strength = strength; },
    setExposure(x){ post.filmic.uniforms.uExposure.value = x; },
    // Convenience for the dev GUI in the HTML.
    uniforms: bh.uniforms,
  };

  console.info(
    `%c[kerr] ready · backend=${backend}`,
    'color:#5fb3d4;font-weight:600',
    {
      camera: { start: camStart.toArray(), end: camEnd.toArray() },
      horizon: 'r_+ = M + √(M²-a²) ≈ ' + (bh.uniforms.uM.value + Math.sqrt(Math.max(bh.uniforms.uM.value**2 - bh.uniforms.uSpin.value**2, 0))).toFixed(3),
      disk: `[${bh.uniforms.uDiskIn.value}M .. ${bh.uniforms.uDiskOut.value}M]`,
      spin: bh.uniforms.uSpin.value,
      quality: quality.name,
      caps,
    }
  );
  onProgress?.({ stage: 'done', t: 1, backend, caps });
  onReady?.(handle);
  handle.start();
  return handle;
}

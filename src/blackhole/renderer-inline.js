// Ported verbatim from the original inline module script in index.html.
// Kept as plain JS (excluded from strict tsc) until it is modularised in
// src/blackhole/*.ts. Runs on import; the black-hole teaser self-boots.
import * as THREE          from 'three';
import { EffectComposer }  from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/* ─── Environment profile — decided once, drives every branch ─── */
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = matchMedia('(max-width: 768px)').matches
              || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const saveData = !!(navigator.connection && navigator.connection.saveData);

/* ─── DOM refs ────────────────────────────────────────────────── */
const navEl    = document.getElementById('nav');
const heroBg   = document.getElementById('hole-stage');  /* black-hole demo stage (moved out of the hero) */
const diveBtn  = document.getElementById('dive-btn');
const instrEl  = document.getElementById('hero-instr');
const fpsEl    = document.getElementById('instr-fps');
const relaunch = document.getElementById('relaunch-dive');

/* ═══════════════════════════════════════════════════════════════════
   UI BEHAVIOUR — independent of WebGL.
   Kept first so a renderer failure can't break nav, reveals, or
   active-link tracking.
══════════════════════════════════════════════════════════════════ */

/* Nav transitions from transparent (over dark hero) to solid (over
   light body) at a small scroll threshold. */
const onScroll = () => navEl.classList.toggle('scrolled', scrollY > 24);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* Scroll-reveal — disabled under reduced motion (CSS keeps reveals
   pinned visible there). One-shot: never re-hide. */
if (!reduceMotion) {
  const revealIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in-view');
        revealIO.unobserve(e.target);
      }
    }
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => revealIO.observe(el));
}

/* Active-link tracking — highlights the section being read. */
const navLinks = [...document.querySelectorAll('.nav-links a')];
const linkFor  = (id) => navLinks.find((a) => a.getAttribute('href') === '#' + id);
const navIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      navLinks.forEach((a) => { a.classList.remove('active'); a.removeAttribute('aria-current'); });
      const link = linkFor(e.target.id);
      if (link) { link.classList.add('active'); link.setAttribute('aria-current', 'true'); }
    }
  }
}, { rootMargin: '-45% 0px -50% 0px' });
['about', 'work', 'milestones', 'connect'].forEach((id) => {
  const sec = document.getElementById(id);
  if (sec) navIO.observe(sec);
});

/* Small colophon for anyone who opens devtools. */
function logColophon() {
  console.log('%cYousif Elia — built with hand-written GLSL.',
              'color:#6cc1e0;font:600 13px ui-monospace,monospace');
  console.log('%cThe black hole is ~270 lines of shader, one draw call. '
            + 'Vite + TypeScript, no framework — the shader is the whole show.',
              'color:#8d857a;font:12px ui-monospace,monospace');
}

/* ═══════════════════════════════════════════════════════════════════
   BLACK-HOLE RENDERER
   The GLSL is preserved from prior iterations — it was the strongest
   engineering on the site. Self-contained inside this <script> so
   the file ships as one HTML document. (The /src/ modules remain on
   disk as the canonical reference and a clean import target for any
   future build step.)
══════════════════════════════════════════════════════════════════ */
function initRenderer() {
  let W = heroBg.clientWidth  || innerWidth;
  let H = heroBg.clientHeight || innerHeight;

  const renderer = new THREE.WebGLRenderer({
    antialias: !isMobile,
    powerPreference: isMobile ? 'low-power' : 'high-performance',
  });
  /* DPR cap — the single highest-leverage perf knob for a
     raymarcher, whose cost scales with pixel count. */
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.0 : 1.5));
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  heroBg.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, W / H, 0.01, 3000);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const BLOOM_BASE = 0.45, BLOOM_PEAK = 2.4;
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), BLOOM_BASE, 0.55, 0.85);
  composer.addPass(bloom);

  const DISK_TILT = THREE.MathUtils.degToRad(6);

  const raymarchMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: 0 },
      uResolution:  { value: new THREE.Vector2(W, H) },
      uCamPos:      { value: new THREE.Vector3() },
      uInvProj:     { value: new THREE.Matrix4() },
      uCamWorld:    { value: new THREE.Matrix4() },
      uHorizonR:    { value: 0.85 },
      uMass:        { value: 0.82 },
      /* Mobile profile: bigger steps + fewer of them. */
      uStepSize:    { value: isMobile ? 0.15 : 0.10 },
      uMaxSteps:    { value: isMobile ? 100  : 180  },
      uDiskIn:      { value: 1.45 },
      uDiskOut:     { value: 7.0  },
      uDiskTilt:    { value: DISK_TILT },
      uDiskOpacity: { value: 0.45 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform vec2  uResolution;
      uniform vec3  uCamPos;
      uniform mat4  uInvProj, uCamWorld;
      uniform float uHorizonR, uMass, uStepSize, uMaxSteps;
      uniform float uDiskIn, uDiskOut, uDiskTilt, uDiskOpacity;
      varying vec2 vUv;

      float h31(vec3 p){
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float n2(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0 - 2.0*f);
        float a = h31(vec3(i, 0.0));
        float b = h31(vec3(i + vec2(1.0, 0.0), 0.0));
        float c = h31(vec3(i + vec2(0.0, 1.0), 0.0));
        float d = h31(vec3(i + vec2(1.0, 1.0), 0.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm2(vec2 p){
        float v = 0.0, a = 0.5;
        for(int i = 0; i < 5; i++){
          v += a * n2(p);
          p  = p * 2.07 + 17.7;
          a *= 0.5;
        }
        return v;
      }
      float n3(vec3 p){
        vec3 i = floor(p), f = fract(p);
        f = f*f*(3.0 - 2.0*f);
        float a = h31(i);
        float b = h31(i + vec3(1.0, 0.0, 0.0));
        float c = h31(i + vec3(0.0, 1.0, 0.0));
        float d = h31(i + vec3(1.0, 1.0, 0.0));
        float e = h31(i + vec3(0.0, 0.0, 1.0));
        float g = h31(i + vec3(1.0, 0.0, 1.0));
        float k = h31(i + vec3(0.0, 1.0, 1.0));
        float l = h31(i + vec3(1.0, 1.0, 1.0));
        return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y),
                   mix(mix(e,g,f.x), mix(k,l,f.x), f.y), f.z);
      }
      float fbm3(vec3 p){
        float v = 0.0, a = 0.55;
        for(int i = 0; i < 4; i++){
          v += a * n3(p);
          p  = p * 2.07 + vec3(17.7, 9.3, 5.1);
          a *= 0.5;
        }
        return v;
      }

      vec3 sampleStars(vec3 dir){
        vec3 col = vec3(0.0);
        for(int i = 0; i < 3; i++){
          float fi    = float(i);
          float scale = 80.0 * exp2(fi);
          vec3  d     = dir * scale;
          vec3  cell  = floor(d);
          vec3  fr    = fract(d);
          float h     = h31(cell + fi * 7.3);
          float thr   = 0.988 - fi * 0.003;
          if(h > thr){
            vec3 cen = vec3(
              h31(cell + 1.7 + fi),
              h31(cell + 3.1 + fi),
              h31(cell + 5.5 + fi)
            );
            vec3  sp = fr - cen;
            float br = exp(-dot(sp, sp) * 80.0);
            vec3  ti = mix(vec3(0.78, 0.86, 1.00),
                           vec3(1.00, 0.95, 0.82),
                           h31(cell + 11.0 + fi));
            col += ti * br * (h - thr) * 25.0;
          }
        }
        float gas = fbm2(dir.xy * 2.0 + dir.zx * 1.2);
        col += vec3(0.030, 0.038, 0.060) * gas * 0.6;
        return col;
      }

      vec3 diskEmission(float r, float ang, vec3 inPlane, vec3 rayDir){
        float nP = clamp((r - uDiskIn) / (uDiskOut - uDiskIn), 0.0, 1.0);
        float ia = smoothstep(0.0,  0.04, nP);
        float oa = 1.0 - smoothstep(0.86, 1.0, nP);

        float swirl = uTime * (2.8 / (pow(r, 1.1) + 0.5));
        vec2  coord = vec2(ang * 6.0 + r * 0.4 + swirl * 3.0, r * 2.2);
        float pat   = fbm2(coord + uTime * 0.38) * 0.7 + 0.4;
        pat += sin(ang * 3.0 + r * 4.5 - uTime * 2.1 - swirl * 1.8) * 0.06;

        vec3 hot = vec3(0.92, 0.97, 1.00);
        vec3 mid = vec3(0.40, 0.75, 1.00);
        vec3 cl  = vec3(0.04, 0.12, 0.42);
        vec3 c   = mix(hot, mid, smoothstep(0.0, 0.40, nP));
        c        = mix(c,   cl,  smoothstep(0.40, 1.0, nP));

        float brightness = pow(1.0 - smoothstep(0.0, 0.95, nP), 1.4) * 2.2;
        brightness *= pat;

        vec3  diskN   = vec3(sin(uDiskTilt), -cos(uDiskTilt), 0.0);
        vec3  velDir  = normalize(cross(diskN, inPlane));
        float mu      = dot(velDir, -rayDir);
        float beta    = clamp(0.55 / sqrt(max(r * 0.5, 0.2)), 0.0, 0.86);
        float gamma   = 1.0 / sqrt(1.0 - beta * beta);
        float doppler = 1.0 / (gamma * (1.0 - beta * mu));
        brightness *= clamp(pow(doppler, 1.5), 0.5, 2.6);

        vec3 dopTint = mix(vec3(0.28, 0.58, 1.22),
                          vec3(0.92, 0.99, 1.12),
                          clamp((doppler - 0.6) / 1.0, 0.0, 1.0));
        c *= dopTint;

        float dustExtent = uDiskOut * 2.2;
        float nDust    = clamp((r - uDiskOut) / dustExtent, 0.0, 1.0);
        float dustMask = step(uDiskOut, r) * pow(1.0 - nDust, 1.6);
        vec2  dustCoord = vec2(ang * 2.2 + swirl * 1.5, r * 0.55);
        float dustPat   = fbm2(dustCoord + uTime * 0.20);
        dustPat = pow(dustPat, 1.05);
        vec3 dustCol = mix(vec3(0.06, 0.18, 0.46),
                           vec3(0.40, 0.70, 1.05),
                           dustPat);
        vec3 dustEmit = dustCol * (dustPat * 0.6 + 0.45) * dustMask * 1.15 * dopTint;

        return c * brightness * ia * oa + dustEmit;
      }

      void main(){
        vec2 ndc   = vUv * 2.0 - 1.0;
        vec4 vClip = uInvProj * vec4(ndc, 1.0, 1.0);
        vec3 vDir  = vClip.xyz / vClip.w;
        vec3 rayDir = normalize((uCamWorld * vec4(vDir, 0.0)).xyz);
        vec3 rayPos = uCamPos;

        vec3 diskN = vec3(sin(uDiskTilt), -cos(uDiskTilt), 0.0);
        vec3 diskZ = vec3(0.0, 0.0, 1.0);
        vec3 diskX = normalize(cross(diskN, diskZ));

        vec3  col      = vec3(0.0);
        float tr       = 1.0;
        bool  captured = false;
        float prevSide = dot(rayPos, diskN);
        float minR     = 1e9;

        for(int i = 0; i < 240; i++){
          if(float(i) >= uMaxSteps) break;
          float r = length(rayPos);
          minR = min(minR, r);
          if(r < uHorizonR){ captured = true; break; }

          float dt = uStepSize * (1.0 + r * 0.12);

          if(r < uHorizonR * 3.3 && tr > 0.01){
            float atmoT = clamp((uHorizonR * 3.3 - r) / (uHorizonR * 2.3), 0.0, 1.0);
            float ca    = uTime * 0.55;
            mat2  crot  = mat2(cos(ca), -sin(ca), sin(ca), cos(ca));
            vec3  cp    = rayPos;
            cp.xz       = crot * cp.xz;
            cp          = cp * 0.95 + vec3(0.0, uTime * 0.12, 0.0);
            float cloud = pow(fbm3(cp), 1.4);
            float density  = atmoT * atmoT * cloud;
            vec3  cloudCol = mix(vec3(0.030, 0.055, 0.11),
                                 vec3(0.20, 0.36, 0.64), cloud);
            col += cloudCol * density * tr * dt * 0.9;
            tr  *= 1.0 - density * 0.22 * dt;
          }

          vec3 accel = -rayPos * (uMass / (r * r * r));
          rayDir = normalize(rayDir + accel * dt);

          vec3  nextPos = rayPos + rayDir * dt;
          float curSide = dot(nextPos, diskN);

          if(prevSide * curSide < 0.0 && tr > 0.005){
            float t       = prevSide / (prevSide - curSide);
            vec3  xPos    = mix(rayPos, nextPos, t);
            vec3  inPlane = xPos - diskN * dot(xPos, diskN);
            float rCross  = length(inPlane);
            if(rCross >= uDiskIn && rCross <= uDiskOut * 3.3){
              float du   = dot(inPlane, diskX);
              float dv   = dot(inPlane, diskZ);
              float ang  = atan(dv, du);
              vec3  emit = diskEmission(rCross, ang, inPlane, rayDir);
              float dustWeight = smoothstep(uDiskOut * 1.05, uDiskOut, rCross);
              float diskAlpha  = uDiskOpacity * mix(0.18, 1.0, dustWeight);
              col += emit * tr * diskAlpha;
              tr  *= 1.0 - diskAlpha * 0.7;
            }
          }

          prevSide = curSide;
          rayPos   = nextPos;

          if(r > 80.0 && dot(rayDir, rayPos) > 0.0) break;
        }

        if(captured){
          col += sampleStars(rayDir) * 0.035;
          col += vec3(0.014, 0.028, 0.060);
        } else if(tr > 0.005){
          col += sampleStars(rayDir) * tr;
        }

        float gd     = (minR - uHorizonR * 1.55) * 3.5;
        float graze  = exp(-gd * gd);
        vec2  scr    = vUv - 0.5;
        scr.x       *= uResolution.x / uResolution.y;
        float scrAng = atan(scr.y, scr.x);
        float w1     = 0.5 + 0.5 * sin(scrAng * 2.0 - uTime * 2.6);
        float w2     = 0.5 + 0.5 * sin(scrAng * 5.0 + uTime * 1.7);
        float ringI  = graze * (0.25 + w1 * 0.42 + w2 * 0.22);
        col += vec3(1.0, 0.94, 0.82) * ringI;

        float d1 = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float d2 = fract(sin(dot(gl_FragCoord.xy, vec2(63.7264, 10.873))) * 43758.5453);
        col += (d1 + d2 - 1.0) / 255.0;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest:  false,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), raymarchMat);
  quad.frustumCulled = false;
  scene.add(quad);

  /* Camera: a fixed cinematic resting pose, with a barely-there
     idle drift. The "dive" pushes the camera in toward the light
     wrap and eases out — a self-contained moment, never a gate. */
  const camRest = new THREE.Vector3(0, 0.72, 7.4);
  const camDive = new THREE.Vector3(0, 0.30, 2.55);
  camera.position.copy(camRest);
  camera.lookAt(0, 0, 0);

  const DIVE_IN = 1900, DIVE_HOLD = 420, DIVE_OUT = 2600;
  let divePhase = 'idle';   /* idle | in | hold | out */
  let diveT0    = 0;
  const easeInOut = (x) => x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2;

  function startDive() {
    if (divePhase !== 'idle' || reduceMotion) return;
    divePhase = 'in';
    diveT0 = performance.now();
    diveBtn?.setAttribute('aria-disabled', 'true');
  }

  function updateCamera(now, time) {
    if (divePhase === 'idle') {
      camera.position.set(
        camRest.x + Math.sin(time * 0.16) * 0.12,
        camRest.y + Math.sin(time * 0.12) * 0.07,
        camRest.z + Math.sin(time * 0.09) * 0.16,
      );
      bloom.strength = BLOOM_BASE;
    } else if (divePhase === 'in') {
      const e = easeInOut(Math.min((now - diveT0) / DIVE_IN, 1));
      camera.position.lerpVectors(camRest, camDive, e);
      bloom.strength = BLOOM_BASE + (BLOOM_PEAK - BLOOM_BASE) * e;
      if (e >= 1) { divePhase = 'hold'; diveT0 = now; }
    } else if (divePhase === 'hold') {
      camera.position.copy(camDive);
      bloom.strength = BLOOM_PEAK;
      if (now - diveT0 >= DIVE_HOLD) { divePhase = 'out'; diveT0 = now; }
    } else {
      const e = easeInOut(Math.min((now - diveT0) / DIVE_OUT, 1));
      camera.position.lerpVectors(camDive, camRest, e);
      bloom.strength = BLOOM_PEAK + (BLOOM_BASE - BLOOM_PEAK) * e;
      if (e >= 1) {
        divePhase = 'idle';
        diveBtn?.removeAttribute('aria-disabled');
      }
    }
    camera.lookAt(0, 0, 0);
  }

  function renderFrame(time) {
    camera.updateMatrixWorld(true);
    raymarchMat.uniforms.uTime.value = time;
    raymarchMat.uniforms.uCamPos.value.copy(camera.position);
    raymarchMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    raymarchMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    composer.render();
  }

  /* Lifecycle-gated loop — runs only while tab visible, hero on
     screen, and motion allowed. */
  let t = 0;
  let rafId = null;
  let lastFrame = performance.now();
  let tabVisible = document.visibilityState === 'visible';
  let heroVisible = true;

  let fpsCount = 0, fpsSince = performance.now();

  const wantsLoop = () => tabVisible && heroVisible && !reduceMotion;

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    t += dt;

    updateCamera(now, t);
    renderFrame(t);

    fpsCount++;
    if (now - fpsSince >= 500) {
      const fps = Math.round((fpsCount * 1000) / (now - fpsSince));
      if (fpsEl) fpsEl.textContent = fps + ' fps';
      fpsCount = 0; fpsSince = now;
    }

    if (!wantsLoop()) { cancelAnimationFrame(rafId); rafId = null; }
  }
  function play() {
    if (rafId === null && wantsLoop()) {
      lastFrame = performance.now();
      fpsSince = lastFrame; fpsCount = 0;
      rafId = requestAnimationFrame(loop);
    }
  }
  function pause() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function renderStatic() {
    t = 8;
    updateCamera(performance.now(), t);
    renderFrame(t);
  }

  function resize() {
    W = heroBg.clientWidth || innerWidth;
    H = heroBg.clientHeight || innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    composer.setSize(W, H);
    bloom.resolution.set(W, H);
    raymarchMat.uniforms.uResolution.value.set(W, H);
    if (reduceMotion) renderStatic();
  }
  addEventListener('resize', resize, { passive: true });

  document.addEventListener('visibilitychange', () => {
    tabVisible = document.visibilityState === 'visible';
    tabVisible ? play() : pause();
  });

  new IntersectionObserver((entries) => {
    heroVisible = entries[0].isIntersecting;
    if (heroVisible) {
      play();
    } else {
      pause();
      if (divePhase !== 'idle') {
        divePhase = 'idle';
        diveBtn?.removeAttribute('aria-disabled');
      }
    }
  }, { threshold: 0 }).observe(heroBg);

  /* "Re-launch the live demo" link in the case study section:
     scrolls back up to the hero, then triggers the dive. Gives the
     case study a payoff without needing a second canvas. */
  relaunch?.addEventListener('click', (ev) => {
    /* Honour the anchor; just queue the dive once we arrive. */
    setTimeout(() => {
      if (!reduceMotion) startDive();
    }, 700);
  });

  /* First paint — two rAFs give the shader a frame to compile
     before the canvas is revealed. No fake progress bar; just a
     clean cross-fade. */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (reduceMotion) {
      renderStatic();
    } else {
      renderFrame(t);
      if (diveBtn) {
        diveBtn.hidden = false;
        diveBtn.addEventListener('click', startDive);
      }
      instrEl?.classList.add('live');
      play();
    }
    heroBg.classList.add('ready');
    if (performance.mark) performance.mark('bh-first-frame');
  }));
}

/* ─── Boot ─────────────────────────────────────────────────────
   Renderer skipped on metered connections; any WebGL failure is
   caught. The page is never blocked on the GPU. */
if (saveData) {
  console.info('Save-Data is on — skipping the WebGL renderer; CSS fallback in use.');
} else {
  try {
    initRenderer();
  } catch (err) {
    console.warn('Black-hole renderer unavailable — using CSS fallback.', err);
  }
}
logColophon();

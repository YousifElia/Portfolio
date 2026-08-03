// ============================================================================
// blackhole.js — <black-hole> web component.
//
// A self-contained, real-time gravitationally-lensed black hole rendered by a
// single WebGL fragment shader (no three.js, no assets). Per-pixel rays bend
// toward the singularity, the far side of the accretion disk lenses up over
// the shadow, background stars are sampled in the DEFLECTED direction, warm
// amber/terracotta disk (palette #b46a55 family).
//
// Attributes:
//   intensity="0..1"   0.35 = subtle/ambient (card at rest), 1 = full.
//   interactive        present → drag to orbit, wheel to zoom.
//   yaw / pitch / dist initial camera (radians / M units).
//   fov="0.3..1.3"     half-angle ray spread. 0.49 = normal, >1 = wide.
//   paused             present → freeze time (still renders on orbit).
//
// Camera API (used by the cinematic dive):
//   el.camera                     → {dist, fov, yaw, pitch, starBoost}
//   el.setCam({...})              → jump instantly
//   el.flyTo({...}, {duration, ease}) → Promise<boolean>  (false = cancelled)
//   el.cancelFly()                → abort an in-flight move
//
// Performance: DPR cap 1.25, IntersectionObserver pauses offscreen instances,
// adaptive step raymarch with distance-aware early-out, honors
// prefers-reduced-motion (static frame, orbit still re-renders).
// ============================================================================
(function () {
  'use strict';

  const VERT = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}';

  const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uDist;
uniform float uYaw;
uniform float uPitch;
uniform float uIntensity;
uniform float uFov;
uniform float uStarBoost;

const float HORIZON = 0.62;
const float DISK_IN = 1.45;
const float DISK_OUT = 7.2;
const float BEND = 2.2;

float hash21(vec2 p){
  p = fract(p*vec2(123.34,456.21));
  p += dot(p, p+45.32);
  return fract(p.x*p.y);
}

// Background starfield sampled by ray DIRECTION — so lensing warps it.
// uStarBoost (1..2.4) deepens the field during the wide pull-back shot:
// a third octave, a lower brightness cutoff, and a lifted gain.
vec3 stars(vec3 rd){
  float sb = clamp(uStarBoost, 1.0, 2.4);
  float deep = clamp(sb - 1.0, 0.0, 1.0);
  float thr = mix(0.982, 0.958, deep);
  vec2 sph = vec2(atan(rd.z, rd.x), asin(clamp(rd.y,-1.,1.)));
  vec3 col = vec3(0.);
  for(int i=0;i<3;i++){
    float fi = float(i);
    float sc = 26. + fi*23.;
    vec2 st = sph * sc;
    vec2 id = floor(st);
    vec2 f  = fract(st) - .5;
    float h = hash21(id + fi*17.3);
    float bright = step(thr, h);
    float tw = .75 + .25*sin(uTime*(1.5+3.*fract(h*7.))+h*40.);
    float d = length(f - (vec2(hash21(id+3.1), hash21(id+5.7))-.5)*.6);
    float s = smoothstep(.10, .0, d) * bright * tw * (h-thr)*(1.0/max(1.0-thr,0.001))*0.98;
    // temperature: mostly blue-white, some warm
    vec3 tint = mix(vec3(.86,.92,1.), vec3(1.,.88,.72), step(.78, fract(h*13.)));
    // far octaves read as fainter, more distant stars
    col += s * tint * (1.0 - fi*0.24);
  }
  // faint milky-way band
  float band = exp(-abs(rd.y*2.2 + rd.x*.45)*2.6);
  col += band * vec3(.10,.13,.22)*(.35 + .55*deep);
  return col * mix(1.0, 1.55, deep);
}

// Accretion disk emission at a plane-crossing point.
vec3 disk(vec3 hit, vec3 rd){
  float r = length(hit.xz);
  float t = clamp((r-DISK_IN)/(DISK_OUT-DISK_IN), 0., 1.);
  float ang = atan(hit.z, hit.x);
  // orbital speed ~ r^-1/2 → inner rings shear faster
  float swirl = ang*3. - uTime*(1.6/sqrt(max(r,.7))) + 14./max(r,.8);
  float streaks = .62 + .38*sin(swirl)* sin(swirl*2.7+1.7);
  float fine = .8 + .2*sin(34.*log(max(r,.6)) - ang*6. + uTime*.7);
  // hot white inner → amber → deep ember outer (warm #b46a55 palette)
  vec3 cIn  = vec3(1.5,1.36,1.16);
  vec3 cMid = vec3(1.15,.60,.42)*1.5;
  vec3 cOut = vec3(.36,.14,.11);
  vec3 c = mix(cIn, cMid, smoothstep(0.,.42,t));
  c = mix(c, cOut, smoothstep(.42,1.,t));
  float fall = 1.4/(1.+ 2.2*t*t*6.);
  // Doppler beaming: the side orbiting toward you brightens; the receding
  // side dims but keeps a lifted floor so it never crushes to black.
  vec3 vel = normalize(vec3(-hit.z, 0., hit.x));
  float beam = dot(vel, -rd);
  float dop = 0.68 + 1.15*(0.5 + 0.5*beam);
  // soften rims
  float edge = smoothstep(0.,.10,t) * smoothstep(1.,.82,t);
  return c * fall * streaks * fine * dop * edge * 2.1;
}

void main(){
  vec2 uv = (2.*gl_FragCoord.xy - uRes)/uRes.y;

  // camera on a sphere, looking at origin
  float cp = cos(uPitch), sp = sin(uPitch);
  vec3 ro = uDist * vec3(cp*sin(uYaw), sp, cp*cos(uYaw));
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(fw, vec3(0.,1.,0.)));
  vec3 up = cross(rt, fw);
  float fov = clamp(uFov, 0.22, 1.4);
  vec3 rd = normalize(uv.x*rt*fov + uv.y*up*fov + fw);

  vec3 p = ro;
  vec3 v = rd;
  vec3 col = vec3(0.);
  float trans = 1.;
  bool captured = false;

  // let the ray escape just past wherever the camera actually is, and take
  // bigger strides far from the hole so a 46 M pull-back stays cheap.
  float esc = max(42., uDist*1.22);
  float cap = clamp(uDist*0.10, 1.5, 2.6);

  for(int i=0;i<110;i++){
    float r = length(p);
    if(r < HORIZON){ captured = true; break; }
    if(r > esc && dot(p, v) > 0.) break;
    float dt = clamp(.18*(r-.5), .05, cap);
    // Newtonian-style deflection (the documented shortcut): pull the ray
    // toward the singularity, stronger as 1/r².
    v = normalize(v - normalize(p)*(BEND/(r*r))*dt);
    vec3 np = p + v*dt;
    // disk lives in the y=0 plane — detect the crossing
    if(p.y*np.y < 0.){
      float f = p.y/(p.y-np.y);
      vec3 hit = mix(p, np, f);
      float hr = length(hit.xz);
      if(hr > DISK_IN && hr < DISK_OUT){
        col += trans * disk(hit, v);
        trans *= .42;
        if(trans < .02) break;
      }
    }
    p = np;
  }

  if(!captured && trans > .02){
    col += trans * stars(v) * (0.7 + 0.5*uIntensity);
  }

  col *= mix(.42, 1.05, uIntensity);
  col = 1. - exp(-col * mix(1.15, 1.75, uIntensity));
  col += col*col*.22;                       // cheap bloom
  vec2 q = uv*.5;
  col *= 1. - .32*dot(q,q);                 // vignette
  gl_FragColor = vec4(col, 1.);
}`;

  const EASE = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
    inOutQuint: (t) => (t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  };
  const CAM_KEYS = ['dist', 'fov', 'yaw', 'pitch', 'starBoost', 'intensity'];

  class BlackHoleEl extends HTMLElement {
    static get observedAttributes() { return ['intensity', 'interactive', 'paused', 'yaw', 'pitch', 'dist', 'fov']; }

    constructor() {
      super();
      this._t = 0;
      this._last = 0;
      this._raf = 0;
      this._visible = true;
      this._ok = false;
      this._intensity = 0.35;
      this._targetIntensity = 0.35;
      this._yaw = 0.0;
      this._pitch = 0.10;
      this._dist = 13.5;
      this._fov = 0.49;
      this._starBoost = 1;
      this._drift = true;
      this._reduced = false;
      this._needsFrame = true;
      this._fly = null;
    }

    attributeChangedCallback(name, _o, val) {
      if (name === 'intensity') this._targetIntensity = Math.max(0, Math.min(1, parseFloat(val || '0.35') || 0.35));
      if (name === 'yaw' && val != null) this._yaw = parseFloat(val) || 0;
      if (name === 'pitch' && val != null) this._pitch = parseFloat(val) || 0.10;
      if (name === 'dist' && val != null) this._dist = parseFloat(val) || 13.5;
      if (name === 'fov' && val != null) this._fov = parseFloat(val) || 0.49;
      this._needsFrame = true;
    }

    // ── camera API ───────────────────────────────────────────────────────
    get camera() {
      return { dist: this._dist, fov: this._fov, yaw: this._yaw, pitch: this._pitch, starBoost: this._starBoost, intensity: this._targetIntensity };
    }

    setCam(to) {
      if (!to) return;
      this.cancelFly();
      this._applyCam(to);
      this._needsFrame = true;
    }

    _applyCam(o) {
      for (let i = 0; i < CAM_KEYS.length; i++) {
        const k = CAM_KEYS[i];
        if (o[k] === undefined) continue;
        if (k === 'intensity') { this._targetIntensity = o[k]; this._intensity = o[k]; }
        else this['_' + k] = o[k];
      }
    }

    flyTo(to, opts) {
      opts = opts || {};
      this.cancelFly();
      // NOTE: flyTo is an explicit, user-initiated camera move (and always
      // skippable), so it is not short-circuited by prefers-reduced-motion —
      // that flag still freezes the ambient disk/time animation.
      const from = {};
      for (let i = 0; i < CAM_KEYS.length; i++) {
        const k = CAM_KEYS[i];
        if (to[k] !== undefined) from[k] = k === 'intensity' ? this._targetIntensity : this['_' + k];
      }
      return new Promise((resolve) => {
        this._fly = {
          from: from, to: to, t0: performance.now(),
          dur: Math.max(16, (opts.duration || 1) * 1000),
          ease: EASE[opts.ease] || EASE.inOutCubic,
          resolve: resolve,
        };
        this._needsFrame = true;
      });
    }

    cancelFly() {
      if (!this._fly) return;
      const f = this._fly;
      this._fly = null;
      f.resolve(false);
    }

    _tickFly(now) {
      const f = this._fly;
      if (!f) return;
      let p = (now - f.t0) / f.dur;
      if (p > 1) p = 1;
      const e = f.ease(p);
      const step = {};
      for (const k in f.to) step[k] = f.from[k] + (f.to[k] - f.from[k]) * e;
      this._applyCam(step);
      this._needsFrame = true;
      if (p >= 1) { this._fly = null; f.resolve(true); }
    }

    connectedCallback() {
      if (this._canvas) return;
      this.style.display = this.style.display || 'block';
      if (getComputedStyle(this).position === 'static') this.style.position = 'relative';
      // Fill the container by default — a bare <black-hole> has no intrinsic
      // size and would otherwise render 0px tall.
      if (!this.style.width) this.style.width = '100%';
      if (!this.style.height) this.style.height = '100%';

      const c = document.createElement('canvas');
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      this.appendChild(c);
      this._canvas = c;

      this._reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

      const gl = c.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
        || c.getContext('experimental-webgl');
      if (!gl) { this._fallback(); return; }
      this._gl = gl;

      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error('[black-hole] shader:', gl.getShaderInfoLog(s));
          return null;
        }
        return s;
      };
      const vs = sh(gl.VERTEX_SHADER, VERT);
      const fs = sh(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) { this._fallback(); return; }
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this._fallback(); return; }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      this._u = {
        res: gl.getUniformLocation(prog, 'uRes'),
        time: gl.getUniformLocation(prog, 'uTime'),
        dist: gl.getUniformLocation(prog, 'uDist'),
        yaw: gl.getUniformLocation(prog, 'uYaw'),
        pitch: gl.getUniformLocation(prog, 'uPitch'),
        intensity: gl.getUniformLocation(prog, 'uIntensity'),
        fov: gl.getUniformLocation(prog, 'uFov'),
        starBoost: gl.getUniformLocation(prog, 'uStarBoost'),
      };
      this._ok = true;

      this._ro = new ResizeObserver(() => { this._resize(); this._needsFrame = true; });
      this._ro.observe(this);
      this._resize();

      this._io = new IntersectionObserver((en) => {
        this._visible = !!(en[0] && en[0].isIntersecting);
        if (this._visible) this._needsFrame = true;
      });
      this._io.observe(this);

      if (this.hasAttribute('interactive')) this._wireInteraction();

      this._last = performance.now();
      const loop = (now) => {
        this._raf = requestAnimationFrame(loop);
        if (!this._visible) return;
        const dt = Math.min((now - this._last) / 1000, 0.05);
        this._last = now;
        const frozen = this._reduced || this.hasAttribute('paused');
        if (!frozen) this._t += dt;
        if (this._fly) this._tickFly(now);
        // smooth intensity toward target
        const di = this._targetIntensity - this._intensity;
        if (Math.abs(di) > 0.002) { this._intensity += di * Math.min(1, dt * 6); this._needsFrame = true; }
        if (frozen && !this._needsFrame) return;
        this._draw();
        this._needsFrame = false;
        if (!this._logged) {
          this._logged = true;
          console.log('[black-hole] first frame drawn at ' + this._canvas.width + 'x' + this._canvas.height);
          document.documentElement.setAttribute('data-bh-frame', this._canvas.width + 'x' + this._canvas.height);
        }
      };
      this._raf = requestAnimationFrame(loop);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      this.cancelFly();
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
    }

    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const w = Math.max(1, Math.round(this.clientWidth * dpr));
      const h = Math.max(1, Math.round(this.clientHeight * dpr));
      if (this._canvas.width !== w || this._canvas.height !== h) {
        this._canvas.width = w; this._canvas.height = h;
        if (this._gl) this._gl.viewport(0, 0, w, h);
      }
    }

    _draw() {
      if (!this._ok) return;
      const gl = this._gl, u = this._u;
      const yaw = this._yaw + (this._drift && !this.hasAttribute('interactive') ? this._t * 0.02 : 0);
      gl.uniform2f(u.res, this._canvas.width, this._canvas.height);
      gl.uniform1f(u.time, this._t);
      gl.uniform1f(u.dist, this._dist);
      gl.uniform1f(u.yaw, yaw);
      gl.uniform1f(u.pitch, this._pitch);
      gl.uniform1f(u.intensity, this._intensity);
      gl.uniform1f(u.fov, this._fov);
      gl.uniform1f(u.starBoost, this._starBoost);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _wireInteraction() {
      this.style.cursor = 'grab';
      this.style.touchAction = 'none';
      let dragging = false, lx = 0, ly = 0;
      this.addEventListener('pointerdown', (e) => {
        this.cancelFly();                       // taking the stick skips the intro
        dragging = true; lx = e.clientX; ly = e.clientY;
        this.setPointerCapture(e.pointerId);
        this.style.cursor = 'grabbing';
      });
      this.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        this._yaw -= (e.clientX - lx) * 0.005;
        this._pitch = Math.max(0.02, Math.min(1.15, this._pitch + (e.clientY - ly) * 0.004));
        lx = e.clientX; ly = e.clientY;
        this._needsFrame = true;
      });
      const end = () => { dragging = false; this.style.cursor = 'grab'; };
      this.addEventListener('pointerup', end);
      this.addEventListener('pointercancel', end);
      this.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.cancelFly();
        this._dist = Math.max(3.6, Math.min(60, this._dist * (1 + e.deltaY * 0.0012)));
        this._needsFrame = true;
      }, { passive: false });
    }

    // CSS-gradient stand-in if WebGL is unavailable.
    _fallback() {
      this._canvas.style.display = 'none';
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;inset:0;background:radial-gradient(ellipse 48% 38% at 56% 50%,rgba(180,106,85,.22),transparent 62%),radial-gradient(circle 90px at 56% 50%,#000 36%,transparent 74%),#0b1320';
      this.appendChild(d);
    }
  }

  if (!customElements.get('black-hole')) customElements.define('black-hole', BlackHoleEl);
})();

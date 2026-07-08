// ============================================================================
// quality.js - small adaptive quality controller for the expensive geodesic
// pass. It only changes resolution and integrator budgets; the visual model
// stays the same, so performance adaptation does not turn into an arcade mode.
// ============================================================================

const TIERS = [
  { name: 'performance', pixelRatio: 1.00, maxSteps: 160, stepBase: 0.060 },
  { name: 'balanced',    pixelRatio: 1.20, maxSteps: 210, stepBase: 0.050 },
  { name: 'cinematic',   pixelRatio: 1.45, maxSteps: 260, stepBase: 0.042 },
  { name: 'reference',   pixelRatio: 1.65, maxSteps: 320, stepBase: 0.036 },
];

export function createQualityManager({
  renderer,
  bh,
  post,
  enabled = true,
  initialTier = 2,
  targetMs = 33.3,
}){
  let tierIndex = Math.max(0, Math.min(TIERS.length - 1, initialTier));
  let auto = enabled;
  let emaMs = targetMs;
  let lastNow = performance.now();
  let sampleFrames = 0;
  let cooldownFrames = 0;

  function currentTier(){
    return TIERS[tierIndex];
  }

  function resizeTargets(){
    const tier = currentTier();
    const dpr = Math.min(window.devicePixelRatio || 1, tier.pixelRatio);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    bh.setSize(renderer.domElement.width, renderer.domElement.height);
    post.setSize(window.innerWidth, window.innerHeight);
  }

  function applyTier(){
    const tier = currentTier();
    bh.uniforms.uMaxSteps.value = tier.maxSteps;
    bh.uniforms.uStepBase.value = tier.stepBase;
    resizeTargets();
  }

  function setTier(nextTier){
    tierIndex = Math.max(0, Math.min(TIERS.length - 1, Math.round(nextTier)));
    applyTier();
  }

  function update(now = performance.now()){
    const dt = now - lastNow;
    lastNow = now;
    if(!auto || dt <= 0 || dt > 500) return;

    emaMs = emaMs * 0.94 + dt * 0.06;
    if(cooldownFrames > 0){
      cooldownFrames--;
      return;
    }

    sampleFrames++;
    if(sampleFrames < 90) return;
    sampleFrames = 0;

    if(emaMs > targetMs * 1.18 && tierIndex > 0){
      setTier(tierIndex - 1);
      cooldownFrames = 150;
    }else if(emaMs < targetMs * 0.70 && tierIndex < TIERS.length - 1){
      setTier(tierIndex + 1);
      cooldownFrames = 210;
    }
  }

  applyTier();

  return {
    tiers: TIERS,
    update,
    resize: resizeTargets,
    setTier,
    get tier(){ return tierIndex; },
    get name(){ return currentTier().name; },
    get frameMs(){ return emaMs; },
    get enabled(){ return auto; },
    set enabled(value){ auto = !!value; },
  };
}

const wrap = document.getElementById('wrap');
let tx = 0;
let ty = 0;
let cx = 0;
let cy = 0;
let lastX = null;
let lastY = null;
let spot = 0.24;
let targetSpot = 0.24;

wrap.addEventListener('mousemove', e => {
  const r = wrap.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  const nx = px / r.width - 0.5;
  const ny = py / r.height - 0.5;

  if (lastX !== null && lastY !== null) {
    const dx = px - lastX;
    const dy = py - lastY;
    const speed = Math.min(Math.sqrt(dx * dx + dy * dy) / 30, 1);
    targetSpot = 0.22 + speed * 0.35;
  } else {
    targetSpot = 0.28;
  }

  lastX = px;
  lastY = py;
  tx = nx * 22;
  ty = ny * 22;
});

wrap.addEventListener('mouseleave', () => {
  tx = 0;
  ty = 0;
  targetSpot = 0.2;
  lastX = null;
  lastY = null;
});

(function tick() {
  cx += (tx - cx) * 0.08;
  cy += (ty - cy) * 0.08;
  spot += (targetSpot - spot) * 0.08;
  wrap.style.setProperty('--mx', `${cx.toFixed(2)}px`);
  wrap.style.setProperty('--my', `${cy.toFixed(2)}px`);
  wrap.style.setProperty('--spot', spot.toFixed(3));
  requestAnimationFrame(tick);
})();

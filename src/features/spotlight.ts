// ============================================================================
// spotlight.ts — cursor-following accent glow on project cards. Writes the
// pointer position into --mx/--my; the gradient itself lives in CSS
// (.project::before). Pointer-only by nature — touch devices simply never
// see the glow, and the cards remain fully usable.
// ============================================================================

export function initSpotlight(): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.querySelectorAll<HTMLElement>('.project').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    });
  });
}

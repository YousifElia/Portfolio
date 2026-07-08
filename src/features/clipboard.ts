// ============================================================================
// clipboard.ts — progressive "click to copy" for elements carrying a
// `data-copy` attribute. Without JS the elements are ordinary mailto links,
// so nothing here is load-bearing.
// ============================================================================

export function initCopyToClipboard(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-copy]');

  targets.forEach((el) => {
    const value = el.dataset.copy;
    if (!value) return;

    // Only hijack the click when the Clipboard API is actually available;
    // otherwise leave the native mailto behaviour intact.
    if (!navigator.clipboard) return;

    const original = el.textContent ?? value;
    let resetTimer: number | undefined;

    el.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await navigator.clipboard.writeText(value);
        el.textContent = 'Copied ✓';
        el.classList.add('copied');
      } catch {
        // Clipboard blocked (permissions/insecure context) — fall back to
        // the real mail client so the action is never dead.
        window.location.href = el.getAttribute('href') ?? `mailto:${value}`;
        return;
      }
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        el.textContent = original;
        el.classList.remove('copied');
      }, 1600);
    });
  });
}

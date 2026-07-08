// ============================================================================
// theme.ts — light/dark toggle. The initial theme is resolved by the inline
// head script (localStorage → system preference) before first paint; this
// module only wires the toggle button and persistence.
// ============================================================================

const STORAGE_KEY = 'theme';

export function initThemeToggle(): void {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode) — theme still toggles for the session */
    }
    // Keep the browser chrome (mobile address bar) in step with the page.
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute('content', next === 'dark' ? '#070a13' : '#f7f4ec'));

    // Little celestial spin on the incoming icon (CSS keyframe).
    btn.classList.remove('spin');
    void btn.offsetWidth; // restart the animation if clicked rapidly
    btn.classList.add('spin');
  });
  btn.addEventListener('animationend', () => btn.classList.remove('spin'));
}

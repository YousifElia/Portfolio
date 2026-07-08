// ============================================================================
// tabs.ts — accessible tab switcher for the Work / Education panel
// (ARIA tabs pattern: aria-selected, roving tabindex, arrow keys).
// Progressive: without JS the Work panel is visible and Education is
// hidden — the page still communicates the primary story.
// ============================================================================

export function initTabs(): void {
  document.querySelectorAll<HTMLElement>('[data-tabs]').forEach((widget) => {
    const tabs = [...widget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    if (tabs.length === 0) return;

    const panelFor = (tab: HTMLButtonElement): HTMLElement | null => {
      const id = tab.getAttribute('aria-controls');
      return id ? document.getElementById(id) : null;
    };

    const select = (tab: HTMLButtonElement): void => {
      tabs.forEach((t) => {
        const active = t === tab;
        t.setAttribute('aria-selected', String(active));
        t.tabIndex = active ? 0 : -1;
        const panel = panelFor(t);
        if (panel) panel.hidden = !active;
      });
      tab.focus();
    };

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (dir === 0) return;
        e.preventDefault();
        select(tabs[(i + dir + tabs.length) % tabs.length]);
      });
    });
  });
}

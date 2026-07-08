// ============================================================================
// main.ts — site entry point (Vite + TypeScript).
//
// Boots the live black-hole teaser and hosts the site's progressive-
// enhancement features. The page is plain semantic HTML/CSS and remains
// fully readable with this module removed.
// ============================================================================

// Light features first — instant, no dependencies.
import { initCopyToClipboard } from './features/clipboard.ts';
import { initThemeToggle } from './features/theme.ts';
import { initTabs } from './features/tabs.ts';
import { initTypewriter } from './features/typewriter.ts';
import { initSpotlight } from './features/spotlight.ts';

initCopyToClipboard();
initThemeToggle();
initTabs();
initTypewriter();
initSpotlight();

// Heavy modules are code-split so three.js and gsap ship as separate,
// cacheable chunks and never block first paint.
//
// Renderer: nav/scroll-reveal/teaser UI + the black hole (self-executes).
void import('./blackhole/renderer-inline.js');

// Milestones star chart — the starfield renders immediately; gsap is
// pulled in lazily inside the module only when motion is allowed.
void import('./sections/constellation.ts').then((m) => m.initConstellation());

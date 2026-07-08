// ============================================================================
// constellation.ts — the Milestones star chart.
//
// Layers of realism, in order of importance:
//   1. Procedural background starfield (~240 stars). Sizes follow a
//      power-law-ish distribution (many faint, few bright) like a real
//      magnitude distribution; tints vary blue-white → warm the way real
//      stellar temperatures do; density is biased toward the Milky-way
//      band drawn in the SVG.
//   2. A subset of stars twinkles at randomized periods (CSS keyframes;
//      the class is only applied when motion is allowed).
//   3. The constellation lines draw themselves in and the milestone
//      stars pop in when the chart scrolls into view (GSAP, once).
//   4. A meteor streaks across every ~7–12 s (GSAP, looped).
//   5. The deep starfield parallaxes slightly slower than the chart
//      (GSAP ScrollTrigger scrub) — barely perceptible depth.
//
// Progressive: the named stars, lines, grid, and labels are plain markup.
// Without JS the chart is complete; this module only adds atmosphere.
// Under prefers-reduced-motion: stars are still generated (realism is
// static), but twinkle/draw/meteor/parallax are all skipped.
// ============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 1200;
const VIEW_H = 560;
const STAR_COUNT = 240;

/** Small deterministic PRNG (mulberry32) so the sky is identical on
 *  every visit — a real sky doesn't reshuffle between page loads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from a point to the Milky-way band's centre line (a shallow
 *  diagonal through the chart, matching the rotated wash in the SVG). */
function bandDistance(x: number, y: number): number {
  // Line through (0, 340) → (1200, 40): y = 340 - 0.25x
  const lineY = 340 - 0.25 * x;
  return Math.abs(y - lineY);
}

function generateStarfield(group: SVGGElement, allowMotion: boolean): void {
  const rand = mulberry32(20260705); // today's date — a fixed sky
  const frag = document.createDocumentFragment();

  let placed = 0;
  while (placed < STAR_COUNT) {
    const x = rand() * VIEW_W;
    const y = rand() * VIEW_H;

    // Density bias: stars near the Milky-way band survive more often.
    const d = bandDistance(x, y);
    const keepP = 0.45 + 0.55 * Math.exp(-(d * d) / (2 * 150 * 150));
    if (rand() > keepP) continue;
    placed++;

    // Magnitude: r^3 weighting → many faint, few bright.
    const m = rand();
    const r = 0.35 + Math.pow(m, 3) * 1.5;

    // Temperature tint: mostly blue-white, occasionally warm.
    const warm = rand() < 0.22;
    const tint = warm
      ? `rgba(255,${230 - Math.round(rand() * 30)},${190 - Math.round(rand() * 40)},1)`
      : `rgba(${215 + Math.round(rand() * 25)},${228 + Math.round(rand() * 20)},255,1)`;

    const opacity = 0.25 + m * 0.65;

    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', x.toFixed(1));
    c.setAttribute('cy', y.toFixed(1));
    c.setAttribute('r', r.toFixed(2));
    c.setAttribute('fill', tint);
    c.setAttribute('opacity', opacity.toFixed(2));

    // ~1 in 5 stars twinkles, each with its own period and phase.
    if (allowMotion && rand() < 0.2) {
      c.classList.add('tw');
      c.style.setProperty('--twd', `${(2.2 + rand() * 4.5).toFixed(2)}s`);
      c.style.setProperty('--twdel', `${(rand() * 5).toFixed(2)}s`);
      c.style.setProperty('--two', opacity.toFixed(2));
    }
    frag.appendChild(c);
  }

  group.appendChild(frag);
}

/** Randomize the milestone stars' breathing so they don't pulse in sync. */
function desyncMilestoneStars(rand: () => number): void {
  document.querySelectorAll<HTMLElement>('.star-core').forEach((core) => {
    core.style.setProperty('--twd', `${(3.8 + rand() * 3).toFixed(2)}s`);
    core.style.setProperty('--twdel', `${(rand() * 4).toFixed(2)}s`);
  });
}

export async function initConstellation(): Promise<void> {
  const sky = document.getElementById('sky');
  const starsBg = document.getElementById('stars-bg') as SVGGElement | null;
  if (!sky || !starsBg) return;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  generateStarfield(starsBg, !reduceMotion);
  if (reduceMotion) return; // static chart — fully labeled, no motion

  desyncMilestoneStars(mulberry32(97));

  const { gsap } = await import('gsap');
  const { ScrollTrigger } = await import('gsap/ScrollTrigger');
  gsap.registerPlugin(ScrollTrigger);

  // ── Draw-in: lines trace themselves, stars pop, labels settle. ──
  const lines = [...sky.querySelectorAll<SVGPathElement>('.cons-lines path')];
  lines.forEach((p) => {
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = `${len}`;
  });

  const entry = gsap.timeline({
    scrollTrigger: { trigger: sky, start: 'top 72%', once: true },
  });
  entry
    .from('.star', {
      scale: 0, opacity: 0,
      duration: 0.5, ease: 'back.out(2.2)', stagger: 0.14,
    })
    .to(lines, {
      strokeDashoffset: 0,
      duration: 0.8, ease: 'power1.inOut', stagger: 0.18,
    }, '-=0.3')
    .from('.sky-caption', { opacity: 0, duration: 0.8 }, '-=0.4');

  // ── Depth: the far starfield scrolls a touch slower than the chart. ──
  gsap.fromTo(starsBg, { y: -14 }, {
    y: 14, ease: 'none',
    scrollTrigger: { trigger: sky, start: 'top bottom', end: 'bottom top', scrub: true },
  });

  // ── Meteors: an ambient streak every 7–12 s — and clicking any
  //    empty patch of sky fires one from under the cursor. ──
  const rand = mulberry32(Date.now() >>> 0);

  const makeMeteor = (): HTMLSpanElement => {
    const m = document.createElement('span');
    m.className = 'meteor';
    m.setAttribute('aria-hidden', 'true');
    sky.appendChild(m);
    return m;
  };
  const ambient = makeMeteor();
  const clicked = makeMeteor(); // separate element so a click never cuts the ambient one

  const shootFrom = (meteor: HTMLSpanElement, fx: number, fy: number, onDone?: () => void): void => {
    const angle = 18 + rand() * 20; // degrees below horizontal
    const dist = 220 + rand() * 260;

    gsap.timeline({ onComplete: onDone })
      .set(meteor, {
        x: fx * sky.clientWidth,
        y: fy * sky.clientHeight,
        rotation: angle,
        opacity: 0,
      })
      .to(meteor, { opacity: 0.9, duration: 0.12 })
      .to(meteor, {
        x: `+=${dist * Math.cos((angle * Math.PI) / 180)}`,
        y: `+=${dist * Math.sin((angle * Math.PI) / 180)}`,
        duration: 0.8,
        ease: 'power1.in',
      }, '<')
      .to(meteor, { opacity: 0, duration: 0.25 }, '-=0.3');
  };

  const ambientLoop = (): void => {
    shootFrom(ambient, 0.15 + rand() * 0.6, 0.05 + rand() * 0.35, () => {
      gsap.delayedCall(6 + rand() * 5, ambientLoop);
    });
  };
  gsap.delayedCall(2.5 + rand() * 3, ambientLoop);

  sky.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.star')) return; // stars are links
    const r = sky.getBoundingClientRect();
    shootFrom(clicked, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  });
}

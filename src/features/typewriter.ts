// ============================================================================
// typewriter.ts — cycles the hero's "$ yousif --builds" argument through a
// short word list with a type/erase rhythm. Decoration only: the <p> carries
// an aria-label with the full sentence, and without JS (or under reduced
// motion) the first word simply stays put.
// ============================================================================

const WORDS = [
  'software',
  'black holes',
  'chrome extensions',
  'CLIs',
  'databases',
  'things that ship',
];

const TYPE_MS = 65;
const ERASE_MS = 38;
const HOLD_MS = 1900;

export function initTypewriter(): void {
  const el = document.getElementById('typewriter');
  if (!el) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let word = 0;

  const type = (i: number): void => {
    el.textContent = WORDS[word].slice(0, i);
    if (i < WORDS[word].length) {
      window.setTimeout(() => type(i + 1), TYPE_MS);
    } else {
      window.setTimeout(erase, HOLD_MS);
    }
  };

  const erase = (): void => {
    const cur = el.textContent ?? '';
    if (cur.length > 0) {
      el.textContent = cur.slice(0, -1);
      window.setTimeout(erase, ERASE_MS);
    } else {
      word = (word + 1) % WORDS.length;
      window.setTimeout(() => type(0), 260);
    }
  };

  // Start by erasing the server-rendered first word after a beat.
  window.setTimeout(erase, HOLD_MS);
}

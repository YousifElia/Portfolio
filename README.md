# Portfolio — Yousif Elia

My personal site: a single static page, four sections (work, experience, stack,
contact), and a **real-time gravitationally-lensed black hole** rendered live in
a WebGL fragment shader.

**Live:** https://yousifelia.github.io/Portfolio/

## Run it locally

Any static file server works — there is no build step and no dependencies.

```bash
python -m http.server 8123
```

Then open http://localhost:8123.

## Structure

```
index.html      The entire site — content, styles and page logic
support.js      Small runtime that renders the page's component markup
blackhole.js    The <black-hole> web component (WebGL, self-contained)
assets/         Photo, company logos, résumé PDF
```

## The black hole

`blackhole.js` is a standalone custom element — no three.js, no models, no
textures. One fragment shader raymarches every pixel: rays bend toward the
singularity, the far side of the accretion disk lenses up over the shadow, and
background stars are sampled along the *deflected* ray direction.

```html
<black-hole intensity="0.35" yaw="0.55" pitch="0.12" dist="14.5"></black-hole>
```

| Attribute     | Meaning                                              |
| ------------- | ---------------------------------------------------- |
| `intensity`   | `0.35` ambient (card at rest) → `1` full             |
| `interactive` | drag to orbit, wheel to zoom                         |
| `yaw` `pitch` `dist` | starting camera position                      |
| `fov`         | ray spread; `0.49` normal, higher = wider            |
| `paused`      | freeze time (still redraws while orbiting)           |

It also exposes a small camera API (`setCam`, `flyTo`, `cancelFly`) — that's
what drives the cinematic "take a dive" sequence on the featured project card.

Performance and accessibility guards are built in: device-pixel-ratio capped at
1.25, `IntersectionObserver` pauses instances that scroll offscreen, the
raymarch step adapts with distance, and `prefers-reduced-motion` renders a
static frame instead of animating.

## Deploying

The repo is the site — no build. Push to `main` and serve the repo root
(GitHub Pages → Settings → Pages → deploy from `main`, folder `/`).

## Contact

**Yousif Elia** · [GitHub](https://github.com/YousifElia) ·
[LinkedIn](https://www.linkedin.com/in/yousif-elia-swe/) · yousif.eliaa@gmail.com

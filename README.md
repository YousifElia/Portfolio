# Yousif Elia — Portfolio

Static site, no build step. Open `index.html` through any static server.

Local preview:  `npx serve .`  (or `python -m http.server`)

Files
- index.html — the portfolio
- support.js — runtime the page needs (keep next to index.html)
- blackhole.js — the WebGL black hole
- assets/ — logos, photo, Dusk screenshot, resume PDF

Deploy (Cloudflare Pages, free)
1. Push this folder to a GitHub repo.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Framework preset: None. Build command: (empty). Output directory: /
4. Deploy → you get yourname.pages.dev. Add a custom domain under Custom domains.

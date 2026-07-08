/// <reference types="vite/client" />

// Ported legacy renderer — plain JS by design (see src/blackhole/). It is a
// self-executing side-effect module with no exports.
declare module './blackhole/renderer-inline.js';
declare module '*/renderer-inline.js';

// GLSL shader sources are imported as raw strings via Vite's `?raw` suffix.
declare module '*.glsl?raw' {
  const src: string;
  export default src;
}
declare module '*.frag?raw' {
  const src: string;
  export default src;
}
declare module '*.vert?raw' {
  const src: string;
  export default src;
}

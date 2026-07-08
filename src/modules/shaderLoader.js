// ============================================================================
// shaderLoader.js  —  fetches .glsl files and resolves `#include "name.glsl"`
// directives, with a guard against double-inclusion (#ifndef X_GLSL).
//
// Usage:
//   const sl = new ShaderLoader('./src/shaders/');
//   const frag = await sl.load('raymarch.frag');
// ============================================================================

export class ShaderLoader {
  constructor(baseURL){
    this.baseURL = baseURL.endsWith('/') ? baseURL : baseURL + '/';
    this._cache = new Map();          // raw fetched contents
  }

  async _fetch(name){
    if(this._cache.has(name)) return this._cache.get(name);
    const r = await fetch(this.baseURL + name);
    if(!r.ok) throw new Error(`shader fetch failed: ${name} (${r.status})`);
    const txt = await r.text();
    this._cache.set(name, txt);
    return txt;
  }

  // Resolve `#include "foo.glsl"` recursively. Each included file is emitted
  // only once per compilation unit (its own #ifndef guard would do this too,
  // but pre-stripping makes shader source much shorter and faster to compile).
  async _resolve(name, included){
    if(included.has(name)) return '';
    included.add(name);
    const src = await this._fetch(name);

    // Find all #include directives and substitute.
    const includeRe = /^[ \t]*#include[ \t]+["<]([^">]+)[">][ \t]*$/gm;
    const includes = [...src.matchAll(includeRe)];
    let out = src;
    for(const m of includes){
      const incName = m[1];
      const incSrc  = await this._resolve(incName, included);
      out = out.replace(m[0], incSrc);
    }
    return out;
  }

  async load(name){
    return this._resolve(name, new Set());
  }

  // Convenience: preload a list in parallel.
  async preload(names){
    return Promise.all(names.map(n => this._fetch(n)));
  }
}

// ============================================================================
// blackhole.js  —  builds the Kerr ray-traced black hole as a single
// fullscreen-quad ShaderMaterial. Exposes uniform handles so the host can
// tune mass, spin, disk geometry, exposure, and step count at runtime.
//
// The entire visual — disk, lensed background, photon ring, ergosphere
// asymmetry — lives inside the one fragment shader (raymarch.frag). There is
// no scene-graph geometry for the disk or shadow: those are emergent from
// the per-pixel geodesic integration.
// ============================================================================

import * as THREE from 'https://esm.sh/three@0.160.0';

export function buildBlackHolePass({ vertSrc, fragSrc, width, height }){
  const uniforms = {
    // Camera
    uCamPos:       { value: new THREE.Vector3() },
    uInvProj:      { value: new THREE.Matrix4() },
    uCamWorld:     { value: new THREE.Matrix4() },
    uResolution:   { value: new THREE.Vector2(width, height) },
    uTime:         { value: 0 },

    // Black hole — mass parameter M and spin a (units of M). Gargantua is
    // a/M ≈ 0.998 (near-extremal); we expose 0..0.99 as the artistic range.
    uM:            { value: 1.0  },
    uSpin:         { value: 0.94 },
    uSpinAxis:     { value: new THREE.Vector3(0.05, 1.0, 0.0).normalize() },

    // Integrator
    uStepBase:     { value: 0.042 },
    uMaxSteps:     { value: 260   },
    uFarRadius:    { value: 96.0  },

    // Disk (units of M; ISCO of Schwarzschild = 6M, decreases with spin).
    // uDiskIn is a floor; the shader raises the inner edge to the Kerr ISCO.
    uDiskIn:       { value: 1.15  },
    uDiskOut:      { value: 10.5  },
    uDiskH0:       { value: 0.048 },
    uDiskKappa:    { value: 2.20  },
    uDiskEmiss:    { value: 1.70  },
    uDiskTempIn:   { value: 9200.0 },
    uDiskTempOut:  { value: 2600.0 },

    // Background
    uStarsGain:    { value: 0.78  },
    uExposure:     { value: 1.05  },
  };

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: vertSrc,
    fragmentShader: fragSrc,
    depthTest:  false,
    depthWrite: false,
    transparent: false,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;

  // Per-frame uniform sync from a THREE.PerspectiveCamera. The camera's own
  // matrices are the source of truth so the raymarch sees exactly the same
  // projection the scroll animation set up.
  function sync(camera, t){
    camera.updateMatrixWorld(true);
    uniforms.uTime.value = t;
    uniforms.uCamPos.value.copy(camera.position);
    uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    uniforms.uCamWorld.value.copy(camera.matrixWorld);
  }

  function setSize(w, h){ uniforms.uResolution.value.set(w, h); }

  return { mesh, material: mat, uniforms, sync, setSize };
}

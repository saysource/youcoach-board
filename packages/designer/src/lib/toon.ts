// Shared cel-shading bits used by both the placed 3D objects (objects3d.ts) and
// the field goals (goal.ts / field3d.ts). Kept in its own module so those two
// can share it without an import cycle. Framework-free (three.js only).

import * as THREE from 'three'

// A stepped grayscale ramp used as a toon gradientMap. The few, widely-spaced
// steps give hard, high-contrast cel bands (a very dark shadow tone up to full
// light) for the extreme flat-shaded look. Cached (one texture, shared).
let toonRamp: THREE.DataTexture | null = null
export function toonGradientMap(): THREE.DataTexture {
  if (!toonRamp) {
    // A hard, high-contrast ramp: three tones (deep shadow / mid / full light)
    // with big jumps, placed so a surface's ~0.6–0.95 lighting range straddles
    // the mid↔light step — a bold cel split rather than a subtle gradient.
    const steps = new Uint8Array([75, 75, 75, 150, 150, 150, 255, 255])
    const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
    tex.minFilter = tex.magFilter = THREE.NearestFilter
    tex.needsUpdate = true
    toonRamp = tex
  }
  return toonRamp
}

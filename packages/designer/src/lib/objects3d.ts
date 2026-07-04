// The "3D materials" registry: real three.js objects placed on the pitch
// (Object3DElement). Each builder returns a UNIT-sized mesh centered at the
// origin (nominal size 1 m); Object3DLayer scales it by the element's `size` and
// lifts it so it rests on the ground. Toon-shaded to match the goal's look.
//
// Framework-free (three.js only). Extend KNOWN_OBJECTS to grow the palette.

import * as THREE from 'three'

export const KNOWN_OBJECTS = ['ball', 'cube'] as const
export type Object3DKind = (typeof KNOWN_OBJECTS)[number]
export function isKnownObject(id: string): id is Object3DKind {
  return (KNOWN_OBJECTS as readonly string[]).includes(id)
}

/** A simple soccer-ball texture: white with scattered black pentagons. */
function soccerTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#fafafa'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#141414'
  const penta = (cx: number, cy: number, r: number, rot: number) => {
    g.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = rot + (i * 2 * Math.PI) / 5 - Math.PI / 2
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      if (i) g.lineTo(x, y)
      else g.moveTo(x, y)
    }
    g.closePath()
    g.fill()
  }
  // A spread of pentagons (wraps around the sphere's UV — approximate but reads
  // clearly as a soccer ball).
  const spots: Array<[number, number]> = [
    [46, 60], [128, 34], [210, 66], [88, 128], [172, 132], [40, 200], [128, 214], [216, 196],
  ]
  spots.forEach(([x, y], i) => penta(x, y, 26, i * 0.7))
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Build the mesh for a 3D object id (unit size, centered at the origin). */
export function buildObject3D(objectId: string): THREE.Mesh {
  if (objectId === 'cube') {
    const mat = new THREE.MeshToonMaterial({ color: 0xff8c42 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
    mesh.castShadow = true
    return mesh
  }
  // ball (default)
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, map: soccerTexture() })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 28), mat)
  mesh.castShadow = true
  return mesh
}

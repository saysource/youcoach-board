// The "3D materials" registry: real three.js objects placed on the pitch
// (Object3DElement). Each builder returns a UNIT-sized mesh centered at the
// origin (nominal size 1 m); Object3DLayer scales it by the element's `size` and
// lifts it so it rests on the ground. Toon-shaded to match the goal's look.
//
// Framework-free (three.js only). Extend KNOWN_OBJECTS to grow the palette.

import * as THREE from 'three'
// The cone is a real modelled asset (Blender → glTF), embedded as base64 so it
// ships inside the bundle — no runtime fetch, so it stays embed-safe in every
// host (App2, bare page, …) regardless of asset-serving base paths.
import { CONE_GLB_BASE64 } from './cone-glb'

export const KNOWN_OBJECTS = ['ball', 'cube', 'cone'] as const
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

/** Decode a base64 string into an ArrayBuffer (sync — no fetch). */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

// glTF accessor component-type → typed-array constructor (only the ones our
// meshes use: float positions/normals, ushort/uint indices).
const COMPONENT: Record<number, { array: Float32ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor }> = {
  5126: { array: Float32Array },
  5123: { array: Uint16Array },
  5125: { array: Uint32Array },
}
const NUM_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

interface GlbJson {
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number }> }>
  accessors: Array<{ bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }>
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>
}

/** Minimal, synchronous GLB → BufferGeometry parser for our single-primitive,
 *  un-compressed assets (POSITION + NORMAL + indices). We avoid GLTFLoader here
 *  because it resolves asynchronously, whereas `buildObject3D` must be sync. */
function parseGlbGeometry(buf: ArrayBuffer): THREE.BufferGeometry {
  const dv = new DataView(buf)
  let json: GlbJson | null = null
  let bin: ArrayBuffer | null = null
  let off = 12 // skip the 12-byte GLB header (magic, version, length)
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    const start = off + 8
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len))) as GlbJson
    else if (type === 0x004e4942) bin = buf.slice(start, start + len)
    off = start + len + ((4 - (len % 4)) % 4) // chunks are 4-byte aligned
  }
  if (!json || !bin) throw new Error('cone.glb: missing JSON or BIN chunk')

  const read = (accessorIndex: number) => {
    const acc = json!.accessors[accessorIndex]
    const bv = json!.bufferViews[acc.bufferView]
    const comp = COMPONENT[acc.componentType]
    const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
    return new comp.array(bin!, byteOffset, acc.count * NUM_COMPONENTS[acc.type])
  }

  const prim = json.meshes[0].primitives[0]
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(read(prim.attributes.POSITION), 3))
  if (prim.attributes.NORMAL != null) geom.setAttribute('normal', new THREE.BufferAttribute(read(prim.attributes.NORMAL), 3))
  if (prim.indices != null) geom.setIndex(new THREE.BufferAttribute(read(prim.indices), 1))
  return geom
}

// Parse + normalise the cone once, lazily. Like the procedural ball/cube, the
// stored geometry is centered at the origin and fits a unit (1 m) box, so
// Object3DLayer can scale it by `size` and lift it by size/2 uniformly. We
// clone it per instance so each mesh owns disposable geometry.
let coneGeometry: THREE.BufferGeometry | null = null
function unitConeGeometry(): THREE.BufferGeometry {
  if (!coneGeometry) {
    const geom = parseGlbGeometry(base64ToArrayBuffer(CONE_GLB_BASE64))
    geom.computeBoundingBox()
    const box = geom.boundingBox!
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    geom.translate(-center.x, -center.y, -center.z)
    geom.scale(1 / maxDim, 1 / maxDim, 1 / maxDim)
    // De-index + per-face normals → flat (faceted) shading: each triangle reads
    // as one flat tone under the toon ramp, giving the low-poly cel look.
    const flat = geom.toNonIndexed()
    flat.computeVertexNormals()
    geom.dispose()
    coneGeometry = flat
  }
  return coneGeometry.clone()
}

// A stepped grayscale ramp used as a toon gradientMap. The few, widely-spaced
// steps give hard, high-contrast cel bands (a very dark shadow tone up to full
// light) for the extreme flat-shaded look. Cached (one texture, shared).
let toonRamp: THREE.DataTexture | null = null
function toonGradientMap(): THREE.DataTexture {
  if (!toonRamp) {
    const steps = new Uint8Array([30, 120, 255]) // deep shadow → mid → full light
    const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
    tex.minFilter = tex.magFilter = THREE.NearestFilter
    tex.needsUpdate = true
    toonRamp = tex
  }
  return toonRamp
}

/** An extreme cel-shaded toon material: a hard 3-band gradient. Paired with the
 *  cone's flat-normal geometry, each facet reads as a distinct flat tone. */
function extremeToon(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradientMap() })
}

/** Black ink strokes along the geometry's hard edges (creases/rims — e.g. the
 *  cone's base rim), the internal-line counterpart of the silhouette outline.
 *  `thresholdAngle` (deg) keeps only sharp edges, not every triangle seam. */
function creaseEdges(geometry: THREE.BufferGeometry, thresholdAngle = 24): THREE.LineSegments {
  const seg = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, thresholdAngle), new THREE.LineBasicMaterial({ color: 0x111111 }))
  seg.name = 'creaseEdges'
  seg.scale.setScalar(1.008) // lift just off the surface to avoid z-fighting
  return seg
}

/** A slightly-inflated, back-faces-only black shell of the same geometry — the
 *  classic toon "ink" outline. Added as a child so it scales/moves with the
 *  object; a small factor keeps the line thin. */
function toonOutline(geometry: THREE.BufferGeometry): THREE.Mesh {
  const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide }))
  outline.name = 'toonOutline'
  outline.scale.setScalar(1.04)
  return outline
}

/** Build the mesh for a 3D object id (unit size, centered at the origin). */
export function buildObject3D(objectId: string): THREE.Mesh {
  if (objectId === 'cone') {
    const geom = unitConeGeometry()
    const mesh = new THREE.Mesh(geom, extremeToon(0xf4611e))
    mesh.castShadow = true
    mesh.add(toonOutline(geom)) // silhouette ink (shares the mesh geometry)
    mesh.add(creaseEdges(geom)) // internal strokes along the rim/creases
    return mesh
  }
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

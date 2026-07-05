// The "3D materials" registry: real three.js objects placed on the pitch
// (Object3DElement). Each builder returns a UNIT-sized mesh centered at the
// origin (nominal size 1 m); Object3DLayer scales it by the element's `size` and
// lifts it so it rests on the ground. Toon-shaded to match the goal's look.
//
// Framework-free (three.js only). Extend KNOWN_OBJECTS to grow the palette.

import * as THREE from 'three'
import { toonGradientMap } from './toon'
import { buildGoal, type GoalStyle } from './goal'
// Real modelled assets (Blender → glTF), embedded as base64 so they ship inside
// the JS bundle — no runtime fetch, so they stay embed-safe in every host (App2,
// bare page, …) regardless of asset-serving base paths.
import { CONE_GLB_BASE64 } from './cone-glb'
import { HIGH_CONE_GLB_BASE64 } from './high-cone-glb'
import { CONE_HURDLE_GLB_BASE64 } from './cone-hurdle-glb'
import { HURDLE_LOW_GLB_BASE64 } from './hurdle-low-glb'
import { HURDLE_GLB_BASE64 } from './hurdle-glb'
import { HURDLE_HIGH_GLB_BASE64 } from './hurdle-high-glb'
import { SPEED_LADDER_GLB_BASE64 } from './speed-ladder-glb'
import { MANNEQUIN_GLB_BASE64 } from './mannequin-glb'
import { BALANCE_DOME_GLB_BASE64 } from './balance-dome-glb'

// GLB-backed objects: embedded model bytes + toon colour. The models are authored
// at real metric scale with their base on the ground (y=0), so they render as-is
// (size is a plain ×1 multiplier). Add a row (and KNOWN_OBJECTS + catalog) to grow.
const GLB_OBJECTS: Record<string, { data: string; color: number }> = {
  cone: { data: CONE_GLB_BASE64, color: 0xf4611e },
  high_cone: { data: HIGH_CONE_GLB_BASE64, color: 0xf4611e },
  cone_hurdle: { data: CONE_HURDLE_GLB_BASE64, color: 0xf4611e },
  hurdle_low: { data: HURDLE_LOW_GLB_BASE64, color: 0xf2c200 },
  hurdle: { data: HURDLE_GLB_BASE64, color: 0xf2c200 },
  hurdle_high: { data: HURDLE_HIGH_GLB_BASE64, color: 0xf2c200 },
  speed_ladder: { data: SPEED_LADDER_GLB_BASE64, color: 0xf2c200 },
  mannequin: { data: MANNEQUIN_GLB_BASE64, color: 0x2c3e50 },
  balance_dome: { data: BALANCE_DOME_GLB_BASE64, color: 0x2aa8a8 },
}

// Procedural goals. Built at their real metric size (feet → metres), so they're
// placed with `size` = 1 (see OBJECT3D_SIZES) rather than the unit-scaled default.
const FT = 0.3048
const GOALS: Record<string, { width: number; height: number; style: GoalStyle }> = {
  goal_full: { width: 24 * FT, height: 8 * FT, style: 'box' }, // regulation 11-a-side (matches the pitch)
  goal_9: { width: 16 * FT, height: 7 * FT, style: 'angled' },
  goal_7: { width: 12 * FT, height: 6 * FT, style: 'angled' },
  goal_futsal: { width: 9.8 * FT, height: 6.5 * FT, style: 'angled' },
  goal_small: { width: 6 * FT, height: 4 * FT, style: 'angled' },
}

export const KNOWN_OBJECTS = ['ball', 'cube', 'cone', 'high_cone', 'cone_hurdle', 'hurdle_low', 'hurdle', 'hurdle_high', 'speed_ladder', 'mannequin', 'balance_dome', 'goal_full', 'goal_9', 'goal_7', 'goal_futsal', 'goal_small'] as const
export type Object3DKind = (typeof KNOWN_OBJECTS)[number]
export function isKnownObject(id: string): id is Object3DKind {
  return (KNOWN_OBJECTS as readonly string[]).includes(id)
}

// Default placed `size` (a scale multiplier). GLB objects and goals are modelled
// at real metric size, so they drop in at ×1; the procedural ball/cube fall back
// to the caller's nominal default.
export function defaultObject3DSize(objectId: string, fallback: number): number {
  if (objectId in GLB_OBJECTS || objectId in GOALS) return 1
  return fallback
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

/** Minimal, synchronous GLB → BufferGeometry parser for our un-compressed assets
 *  (POSITION + NORMAL + indices). Merges ALL primitives of the first mesh into a
 *  single geometry — models split by material (e.g. a hurdle's frame + bars, a
 *  ladder's rails + rungs) have several primitives, and dropping the extras
 *  would leave parts (like the legs) missing. We avoid GLTFLoader because it
 *  resolves asynchronously, whereas `buildObject3D` must be sync. */
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
  if (!json || !bin) throw new Error('glb: missing JSON or BIN chunk')

  const read = (accessorIndex: number) => {
    const acc = json!.accessors[accessorIndex]
    const bv = json!.bufferViews[acc.bufferView]
    const comp = COMPONENT[acc.componentType]
    const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
    return new comp.array(bin!, byteOffset, acc.count * NUM_COMPONENTS[acc.type])
  }

  // Gather every primitive, then concatenate into one position/normal/index set.
  const prims = json.meshes[0].primitives.map((p) => ({
    pos: read(p.attributes.POSITION) as Float32Array,
    nrm: p.attributes.NORMAL != null ? (read(p.attributes.NORMAL) as Float32Array) : null,
    idx: p.indices != null ? read(p.indices) : null,
  }))
  const totalVerts = prims.reduce((n, p) => n + p.pos.length / 3, 0)
  const totalIdx = prims.reduce((n, p) => n + (p.idx ? p.idx.length : 0), 0)
  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const indices = new Uint32Array(totalIdx)
  let vOff = 0
  let iOff = 0
  let hasNormals = true
  for (const p of prims) {
    positions.set(p.pos, vOff * 3)
    if (p.nrm) normals.set(p.nrm, vOff * 3)
    else hasNormals = false
    if (p.idx) {
      for (let k = 0; k < p.idx.length; k++) indices[iOff + k] = p.idx[k] + vOff
      iOff += p.idx.length
    }
    vOff += p.pos.length / 3
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (hasNormals) geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  if (totalIdx) geom.setIndex(new THREE.BufferAttribute(indices, 1))
  if (!hasNormals) geom.computeVertexNormals()
  return geom
}

// Parse a GLB object once per id, lazily, at its authored REAL metric size with
// its base on the ground (y=0) — no re-centering/rescaling. We clone it per
// instance so each mesh owns disposable geometry. The model's smooth normals are
// kept — they give a visible light→dark falloff toward the silhouette.
const geomCache = new Map<string, THREE.BufferGeometry>()
function glbGeometry(id: string, data: string): THREE.BufferGeometry {
  let geom = geomCache.get(id)
  if (!geom) {
    geom = parseGlbGeometry(base64ToArrayBuffer(data))
    geom.computeBoundingBox()
    geomCache.set(id, geom)
  }
  return geom.clone()
}


/** An extreme cel-shaded toon material: a hard, high-contrast 3-tone gradient
 *  that splits the surface into bold light/mid/shadow bands. */
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

// Toon outline thickness as a fraction of a model's largest dimension, so the
// ink line stays visually proportional across objects of very different sizes
// (a 0.25 m cone vs a 1.75 m mannequin). Its world value is stored per object so
// the layer can lift by it (keeping the outline's underside above the y=0 clip).
export const OUTLINE_FRACTION = 0.009

/** The back-faces-only black "ink" outline shell. Instead of a uniform scale
 *  (which displaces the shell sideways on thin, off-centre parts like a hurdle
 *  rail — a one-sided outline), it pushes every vertex OUT along its surface
 *  normal by a fixed distance, giving an even line all the way round. Offset in
 *  model space so it scales with the object; clipping-plane aware (y<0 hidden). */
function outlineMaterial(thickness: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { thickness: { value: thickness } },
    side: THREE.BackSide,
    clipping: true,
    vertexShader: `
      #include <clipping_planes_pars_vertex>
      uniform float thickness;
      void main() {
        vec3 p = position + normalize(normal) * thickness;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: `
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        gl_FragColor = vec4(0.067, 0.067, 0.067, 1.0);
      }
    `,
  })
}

function toonOutline(geometry: THREE.BufferGeometry, thickness: number): THREE.Mesh {
  const outline = new THREE.Mesh(geometry, outlineMaterial(thickness))
  outline.name = 'toonOutline'
  return outline
}

/** Build the renderable for a 3D object id. GLB/primitive kinds are a single
 *  real-size Mesh (base on the ground); goals are a real-size Group. `userData
 *  .outlineOffset` is the ink thickness in world metres, so the layer can lift
 *  the object by it. Object3DLayer handles either. */
export function buildObject3D(objectId: string): THREE.Object3D {
  const goal = GOALS[objectId]
  if (goal) {
    // Depth (how far the frame runs back): the box goal keeps the pitch's ratio;
    // the sloped-back goals run back ~0.9× their height.
    const depth = goal.height * (goal.style === 'box' ? 0.82 : 0.9)
    return buildGoal({ width: goal.width, height: goal.height, depth, style: goal.style })
  }
  const glb = GLB_OBJECTS[objectId]
  if (glb) {
    const geom = glbGeometry(objectId, glb.data)
    const s = geom.boundingBox!.getSize(new THREE.Vector3())
    const outlineOffset = OUTLINE_FRACTION * (Math.max(s.x, s.y, s.z) || 1)
    const mesh = new THREE.Mesh(geom, extremeToon(glb.color))
    mesh.castShadow = true
    mesh.add(toonOutline(geom, outlineOffset)) // silhouette ink (shares the mesh geometry)
    mesh.add(creaseEdges(geom)) // internal strokes along the rim/creases
    mesh.userData.outlineOffset = outlineOffset
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

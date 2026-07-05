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
import { WALL_MANNEQUIN_GLB_BASE64 } from './wall-mannequin-glb'
import { BALANCE_DOME_GLB_BASE64 } from './balance-dome-glb'
import { BALL_GLB_BASE64 } from './ball-glb'
// The inflatable mannequin's "fake defender" drawing — a single black line-art
// path, printed onto the front of the (tintable) mannequin body as a decal.
import mannequinDecalRaw from '../assets/materials3d/mannequin_decal.svg?raw'

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
  mannequin: { data: MANNEQUIN_GLB_BASE64, color: 0xe7eaed }, // off-white inflatable; recolorable
  wall_mannequin: { data: WALL_MANNEQUIN_GLB_BASE64, color: 0x9aa3ab },
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

export const KNOWN_OBJECTS = ['ball', 'cube', 'cone', 'high_cone', 'cone_hurdle', 'hurdle_low', 'hurdle', 'hurdle_high', 'speed_ladder', 'mannequin', 'wall_mannequin', 'balance_dome', 'goal_full', 'goal_9', 'goal_7', 'goal_futsal', 'goal_small'] as const
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

// Colorable materials: exactly the GLB-backed objects (cones, hurdles, ladder,
// mannequins, balance dome). Goals + ball/cube are not tintable.
export function isObject3DColorable(objectId: string): boolean {
  return objectId in GLB_OBJECTS
}

// A placed goal (real-metric, structural) — exempt from the global object scale so
// the "make materials bigger" default doesn't balloon regulation goals.
export function isObject3DGoal(objectId: string): boolean {
  return objectId in GOALS
}

// The authored default tint for a colorable object (as a CSS hex), used to seed a
// freshly placed element's color and as the picker's baseline.
export function object3dDefaultColor(objectId: string): string {
  const c = GLB_OBJECTS[objectId]?.color
  return c === undefined ? '#ffffff' : `#${c.toString(16).padStart(6, '0')}`
}

// Rotationally symmetric objects: a Y-axis rotation has no visible effect, so
// their rotation handle is hidden and rotation is left at 0.
// The mannequin carries a front-facing print, so a Y-rotation IS visible (it turns
// the fake defender to face a different way) — it stays rotatable.
const ROTATION_SYMMETRIC = new Set<string>(['ball', 'cone', 'high_cone', 'balance_dome'])
export function isObject3DRotatable(objectId: string): boolean {
  return !ROTATION_SYMMETRIC.has(objectId)
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
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; material?: number }> }>
  materials?: Array<{ pbrMetallicRoughness?: { baseColorFactor?: number[] } }>
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

/** Like parseGlbGeometry but keeps each primitive SEPARATE, paired with its
 *  material's base colour — for multi-material models we render one mesh per
 *  material (e.g. the two-tone soccer ball's white shell + black patches). */
function parseGlbByMaterial(buf: ArrayBuffer): { geometry: THREE.BufferGeometry; color: THREE.Color }[] {
  const dv = new DataView(buf)
  let json: GlbJson | null = null
  let bin: ArrayBuffer | null = null
  let off = 12
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    const start = off + 8
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len))) as GlbJson
    else if (type === 0x004e4942) bin = buf.slice(start, start + len)
    off = start + len + ((4 - (len % 4)) % 4)
  }
  if (!json || !bin) throw new Error('glb: missing JSON or BIN chunk')
  const read = (accessorIndex: number) => {
    const acc = json!.accessors[accessorIndex]
    const bv = json!.bufferViews[acc.bufferView]
    const comp = COMPONENT[acc.componentType]
    const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
    return new comp.array(bin!, byteOffset, acc.count * NUM_COMPONENTS[acc.type])
  }
  return json.meshes[0].primitives.map((p) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(read(p.attributes.POSITION) as Float32Array, 3))
    if (p.attributes.NORMAL != null) geometry.setAttribute('normal', new THREE.BufferAttribute(read(p.attributes.NORMAL) as Float32Array, 3))
    else geometry.computeVertexNormals()
    if (p.indices != null) geometry.setIndex(new THREE.BufferAttribute(read(p.indices), 1))
    geometry.computeBoundingBox()
    const f = json!.materials?.[p.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor
    // Use the base colour as the toon display colour (crisp white / near-black patches).
    const color = f ? new THREE.Color().setRGB(f[0], f[1], f[2], THREE.SRGBColorSpace) : new THREE.Color(0xffffff)
    return { geometry, color }
  })
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
  seg.scale.setScalar(1.003) // nudge off the surface (small, so it isn't displaced on big models)
  seg.raycast = () => {} // decorative — never a click target (else its ~1u line threshold makes a huge hit area)
  return seg
}

// Toon outline thickness as a fraction of a model's MEDIAN dimension (not the
// largest) so it stays proportional to the object's cross-section, not its length
// — a long, thin ladder was getting an outline thicker than its own bars. Stored
// per object so the layer can lift by it (keeping the underside above the y=0 clip).
export const OUTLINE_FRACTION = 0.013

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
  outline.raycast = () => {} // decorative shell — never a click target (pick the real mesh)
  return outline
}

/* ---- inflatable mannequin decal --------------------------------------------- *
 * The GLB carries no UVs, so we can't map an image through the model's own
 * texture coordinates. Instead we rasterize the line-art SVG to a canvas texture
 * (synchronously, via Path2D — no async image load) and PROJECT it onto the
 * front of the body in a small shader: a planar projection (X→u, Y→v) masked by
 * the surface normal so the print lands only on the front hemisphere and fades
 * toward the sides, the way a graphic wraps a real inflatable. The body stays a
 * plain tintable toon mesh; the decal is a fixed-colour overlay on top.          */

let decalTex: THREE.CanvasTexture | null = null
function mannequinDecalTexture(): THREE.CanvasTexture {
  if (decalTex) return decalTex
  const vb = mannequinDecalRaw.match(/viewBox="([\d.\s-]+)"/)
  const [, , vw, vh] = (vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 1604, 4775]) as number[]
  const d = mannequinDecalRaw.match(/\sd="([^"]+)"/)?.[1] ?? ''
  const W = 512
  const H = Math.round((W * vh) / vw)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!
  g.scale(W / vw, H / vh)
  g.fillStyle = '#141414' // fixed dark ink — the drawing does NOT take the body tint
  if (d) g.fill(new Path2D(d))
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  decalTex = tex
  return tex
}

/** The projected front decal, sharing the body geometry so it hugs the curvature.
 *  `pushOut` lifts it a hair off the skin (along the normal) so it doesn't z-fight
 *  the body. Clipping-plane aware (matches the toon body / outline at the y=0 clip). */
function mannequinDecal(geom: THREE.BufferGeometry, pushOut: number): THREE.Mesh {
  const bb = geom.boundingBox!
  const tex = mannequinDecalTexture()
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      bboxMin: { value: bb.min.clone() },
      bboxSize: { value: bb.getSize(new THREE.Vector3()) },
      imageAspect: { value: tex.image.width / tex.image.height },
      frontDir: { value: new THREE.Vector3(0, 0, 1) },
      pushOut: { value: pushOut },
    },
    transparent: true,
    depthWrite: false,
    clipping: true,
    side: THREE.FrontSide,
    vertexShader: `
      #include <clipping_planes_pars_vertex>
      uniform vec3 bboxMin; uniform vec3 bboxSize; uniform float imageAspect;
      uniform vec3 frontDir; uniform float pushOut;
      varying vec2 vUv; varying float vMask;
      void main() {
        float ny = (position.y - bboxMin.y) / bboxSize.y;       // 0..1, bottom→top
        float nx = (position.x - bboxMin.x) / bboxSize.x - 0.5; // -0.5..0.5
        float bandFracX = (bboxSize.y * imageAspect) / bboxSize.x; // aspect-correct band
        // CanvasTexture flipY=true → image-top samples at v=1, so the model top
        // (ny=1 = the head) must map to v=1: vUv.y = ny (NOT 1-ny, else upside-down).
        vUv = vec2(nx / bandFracX + 0.5, ny);
        vMask = dot(normalize(normal), normalize(frontDir));
        vec3 p = position + normalize(normal) * pushOut;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: `
      #include <clipping_planes_pars_fragment>
      uniform sampler2D map;
      varying vec2 vUv; varying float vMask;
      void main() {
        #include <clipping_planes_fragment>
        if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) discard;
        float m = smoothstep(0.15, 0.5, vMask); // front-facing only; fades to the sides
        if (m <= 0.001) discard;
        vec4 tex = texture2D(map, vUv);
        float a = tex.a * m;
        if (a < 0.02) discard;
        gl_FragColor = vec4(tex.rgb, a);
      }
    `,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = 'mannequinDecal'
  mesh.renderOrder = 2
  mesh.raycast = () => {} // decorative — pick the body, not the print
  return mesh
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
    const median = [s.x, s.y, s.z].sort((a, b) => a - b)[1]
    const outlineOffset = OUTLINE_FRACTION * (median || 1)
    const mesh = new THREE.Mesh(geom, extremeToon(glb.color))
    mesh.castShadow = true
    mesh.add(toonOutline(geom, outlineOffset)) // silhouette ink (shares the mesh geometry)
    mesh.add(creaseEdges(geom)) // internal strokes along the rim/creases
    // The inflatable mannequin also carries a printed "fake defender" on its front.
    if (objectId === 'mannequin') mesh.add(mannequinDecal(geom, outlineOffset * 0.5))
    mesh.userData.outlineOffset = outlineOffset
    return mesh
  }
  if (objectId === 'cube') {
    const mat = new THREE.MeshToonMaterial({ color: 0xff8c42 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
    mesh.castShadow = true
    return mesh
  }
  return buildBall() // ball (default)
}

// The real (GLB) soccer ball: a two-tone toon model (white shell + black patches),
// authored to rest with its ORIGIN on the ground and its CENTRE ~0.10 m up, so the
// whole ball sits a little above the surface (never half-buried by the y=0 clip).
let ballPrims: { geometry: THREE.BufferGeometry; color: THREE.Color }[] | null = null
function buildBall(): THREE.Group {
  if (!ballPrims) ballPrims = parseGlbByMaterial(base64ToArrayBuffer(BALL_GLB_BASE64))
  const group = new THREE.Group()
  let shell: THREE.BufferGeometry | null = null // largest primitive → silhouette ink
  for (const { geometry, color } of ballPrims) {
    const g = geometry.clone()
    const mesh = new THREE.Mesh(g, extremeToon(color.getHex(THREE.SRGBColorSpace)))
    mesh.castShadow = true
    group.add(mesh)
    if (!shell || g.boundingBox!.getSize(new THREE.Vector3()).length() > shell.boundingBox!.getSize(new THREE.Vector3()).length()) shell = g
  }
  if (shell) {
    const s = shell.boundingBox!.getSize(new THREE.Vector3())
    const outlineOffset = OUTLINE_FRACTION * ([s.x, s.y, s.z].sort((a, b) => a - b)[1] || 1)
    group.add(toonOutline(shell, outlineOffset))
  }
  group.userData.originAtGround = true // keep the authored height (don't re-rest)
  return group
}

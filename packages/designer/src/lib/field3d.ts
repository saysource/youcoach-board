// A real, procedural 3D soccer pitch: crisp white markings as FLAT GROUND GEOMETRY
// (resolution-independent — no texture to blur when zoomed), translucent white
// "mowing" shading bands over a TRANSPARENT ground (the board background shows
// through), plus goals + optional corner flags. Framework-free (three.js only).
//
// World frame matches lib/arrow3d.ts and the field cameras: x = pitch length
// (0..105), z = pitch width (0..68), y = up (metres). The reference builds the
// pitch centred on the origin; we translate the whole group to (52.5, 0, 34) so
// the pitch spans 0..105 × 0..68 — the same frame arrows + camera poses use.

import * as THREE from 'three'
import type { FieldType, TrainingLayout } from '@youcoach-board/core'
import { buildGoal } from './goal'
import grassUrl from '../assets/grass.png'

// Pitch dims (metres, ~FIFA), matching field-reference.ts.
const L = 105
const W = 68
const HALF_L = L / 2 // 52.5
const HALF_W = W / 2 // 34
// Per-field-type half-dimensions + goal width (metres). Every field is built
// CENTRED and then translated to the pitch centre (52.5, 0, 34), so objects,
// arrows and cameras keep sharing one world frame; the camera zones frame each
// field's own extent. Futsal is a placeholder until real court dims are provided.
export const FIELD_DIMS: Record<FieldType, { halfL: number; halfW: number; goalW: number }> = {
  soccer11: { halfL: 52.5, halfW: 34, goalW: 7.32 },
  training: { halfL: 20, halfW: 15, goalW: 5 },
  futsal: { halfL: 20, halfW: 10, goalW: 3 },
}
// Training-area variants sit inside the 40×30 area, in the centred frame. Dividing
// lines sit ZONE_INSET metres in from each end; horizontal bands are a third tall.
const ZONE_INSET = 10

// The training goals are smaller than a regulation goal.
const TRAIN_GOAL_W = 5

// Divider LINES per layout, as segments [x0, z0, x1, z1] in the centred frame.
function trainingLineSegs(layout: TrainingLayout, halfL: number, halfW: number): [number, number, number, number][] {
  const zb = halfW / 3
  switch (layout) {
    case 'zones':
    case 'channel':
    case 'ends':
      return [[-ZONE_INSET, -halfW, -ZONE_INSET, halfW], [ZONE_INSET, -halfW, ZONE_INSET, halfW]]
    case 'goals4':
      return [[-halfL, 0, halfL, 0]] // one horizontal midline
    case 'band_h':
      return [[-halfL, -zb, halfL, -zb], [-halfL, zb, halfL, zb]]
    default:
      return []
  }
}

// Shaded fill RECTS per layout, as axis-aligned [x0, z0, x1, z1] (the translucent
// "band" over a region). Replaces the mowing stripes for non-plain layouts.
function trainingShadeRects(layout: TrainingLayout, halfL: number, halfW: number): [number, number, number, number][] {
  const zb = halfW / 3
  switch (layout) {
    case 'zones':
      return [[-halfL, -halfW, -ZONE_INSET, halfW], [ZONE_INSET, -halfW, halfL, halfW]] // external strips
    case 'channel':
    case 'channel_goals':
      return [[-ZONE_INSET, -halfW, ZONE_INSET, halfW]] // middle vertical band
    case 'band_h':
      return [[-halfL, -zb, halfL, zb]] // middle horizontal band
    default:
      return []
  }
}

// The goals for a layout, positioned in the centred frame.
function trainingGoalGroups(layout: TrainingLayout, halfL: number, halfW: number): THREE.Group[] {
  const gw = TRAIN_GOAL_W
  switch (layout) {
    case 'ends':
      return [makeGoal(-1, halfL, gw), makeGoal(1, halfL, gw)]
    case 'channel_goals': // two goals at each end, offset in width
      return [makeGoal(-1, halfL, gw, 7.5), makeGoal(-1, halfL, gw, -7.5), makeGoal(1, halfL, gw, 7.5), makeGoal(1, halfL, gw, -7.5)]
    case 'goals4': // two on the far edge, two on the near edge
      return [makeEdgeGoal(-ZONE_INSET, 1, halfW, gw), makeEdgeGoal(ZONE_INSET, 1, halfW, gw), makeEdgeGoal(-ZONE_INSET, -1, halfW, gw), makeEdgeGoal(ZONE_INSET, -1, halfW, gw)]
    default:
      return []
  }
}
const GOAL_W = 7.32
const GOAL_H = 2.44
const GOAL_D = 2.0
const POST_R = 0.06
const LINE_W = 0.45 // base pitch line width (metres); scaled down when zoomed in
const LINE_W_MIN = 0.18 // thinnest line (close zoom) — ~real pitch line width
const BAND_OPACITY = 0.16 // semi-transparent white "shading" bands
// Stack heights (metres) so the ground / bands / lines never z-fight.
const GRASS_Y = -0.02 // the grass ground sits a hair UNDER the lines/bands
const BAND_Y = 0.05
const LINE_Y = 0.15
const GOAL_Y = 0.18 // lift the goals just above the lines so posts don't collide

// Metres covered by one grass.png tile, and how much the grass extends past the
// pitch on every side (a 25% border), so the field always rests on grass.
const GRASS_TILE = 1.5
const GRASS_MARGIN = 0.25

// The tiled grass texture, loaded once. Subscribers (the scene layer) re-render
// when it arrives, since TextureLoader resolves after the first paint.
let grassTex: THREE.Texture | null = null
const grassReadyCbs = new Set<() => void>()
export function onGrassReady(cb: () => void): () => void {
  grassReadyCbs.add(cb)
  return () => {
    grassReadyCbs.delete(cb)
  }
}
function grassTexture(): THREE.Texture {
  if (!grassTex) {
    grassTex = new THREE.TextureLoader().load(grassUrl, () => grassReadyCbs.forEach((cb) => cb()))
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping
    grassTex.colorSpace = THREE.SRGBColorSpace
    grassTex.anisotropy = 8
  }
  return grassTex
}

/** A horizontal grass ground: the pitch + a 25% border on each side, tiled with the
 *  grass texture (UVs scaled so tiling is per-plane, not on the shared texture), and
 *  dropped just under the lines to avoid z-fighting. Centred on the field origin. */
function buildGrassGround(halfL: number, halfW: number): THREE.Mesh {
  const w = halfL * 2 * (1 + 2 * GRASS_MARGIN)
  const d = halfW * 2 * (1 + 2 * GRASS_MARGIN)
  const geo = new THREE.PlaneGeometry(w, d)
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / GRASS_TILE), uv.getY(i) * (d / GRASS_TILE))
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: grassTexture() }))
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = GRASS_Y
  mesh.name = 'field-grass'
  return mesh
}

// One shared sun so the field and the arrow scene cast agreeing shadows.
export const SUN_POSITION = new THREE.Vector3(120, 165, 70)
export const SUN_TARGET = new THREE.Vector3(HALF_L, 0, HALF_W)

/** Line width for a given camera→target distance: roughly constant on-screen
 *  thickness, so lines thin down as you zoom in (clamped). */
export function lineWidthForDistance(distance: number): number {
  return Math.max(LINE_W_MIN, Math.min(LINE_W, (distance * LINE_W) / 100))
}

/* ---- field markings as flat ground geometry (crisp at any zoom) ------------- *
 * Everything is built in the centred frame (x −52.5..52.5, z −34..34) in the
 * y=0 plane; the group is shifted to the corner-origin frame at the end.        */

// Push a flat quad (two triangles) at y=0 into a positions array.
function quad(pos: number[], ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  pos.push(ax, 0, az, bx, 0, bz, cx, 0, cz, ax, 0, az, cx, 0, cz, dx, 0, dz)
}
// A straight line as a width-w ribbon from (x0,z0) to (x1,z1).
function seg(pos: number[], x0: number, z0: number, x1: number, z1: number, w = LINE_W) {
  const dx = x1 - x0
  const dz = z1 - z0
  const len = Math.hypot(dx, dz) || 1
  const nx = (-dz / len) * (w / 2)
  const nz = (dx / len) * (w / 2)
  quad(pos, x0 + nx, z0 + nz, x1 + nx, z1 + nz, x1 - nx, z1 - nz, x0 - nx, z0 - nz)
}
// A polyline (closed if `close`) as connected ribbons, with a small disc at each
// vertex so the corners join cleanly (no gap/notch where ribbons meet).
function poly(pos: number[], pts: [number, number][], close = false, w = LINE_W) {
  for (let i = 1; i < pts.length; i++) seg(pos, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], w)
  if (close && pts.length > 2) seg(pos, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], w)
  const skip = close ? -1 : pts.length - 1 // open ends need no join
  for (let i = 0; i < pts.length; i++) if (i !== 0 || close) if (i !== skip) disc(pos, pts[i][0], pts[i][1], w / 2, 10)
}
// An arc/circle as a width-w annulus strip.
function arc(pos: number[], cx: number, cz: number, r: number, a0: number, a1: number, steps: number, w = LINE_W) {
  const ro = r + w / 2
  const ri = r - w / 2
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + ((a1 - a0) * i) / steps
    const t1 = a0 + ((a1 - a0) * (i + 1)) / steps
    quad(pos, cx + ro * Math.cos(t0), cz + ro * Math.sin(t0), cx + ro * Math.cos(t1), cz + ro * Math.sin(t1), cx + ri * Math.cos(t1), cz + ri * Math.sin(t1), cx + ri * Math.cos(t0), cz + ri * Math.sin(t0))
  }
}
// A filled disc (penalty / centre spots) as a triangle fan.
function disc(pos: number[], cx: number, cz: number, r: number, steps = 16) {
  for (let i = 0; i < steps; i++) {
    const t0 = (2 * Math.PI * i) / steps
    const t1 = (2 * Math.PI * (i + 1)) / steps
    pos.push(cx, 0, cz, cx + r * Math.cos(t0), 0, cz + r * Math.sin(t0), cx + r * Math.cos(t1), 0, cz + r * Math.sin(t1))
  }
}

/** Field markings for a type, built in the centred frame. The training `layout`
 *  adds its divider lines to the outer boundary. */
export function markingsGeometry(w = LINE_W, fieldType: FieldType = 'soccer11', layout: TrainingLayout = 'plain'): THREE.BufferGeometry {
  const { halfL, halfW } = FIELD_DIMS[fieldType]
  if (fieldType === 'soccer11') return soccerMarkings(w)
  return trainingMarkings(w, halfL, halfW, fieldType === 'training' ? layout : 'plain')
}

// A rectangular training area (outer boundary) plus the layout's divider lines.
function trainingMarkings(w: number, halfL: number, halfW: number, layout: TrainingLayout): THREE.BufferGeometry {
  const p: number[] = []
  poly(p, [[-halfL, -halfW], [halfL, -halfW], [halfL, halfW], [-halfL, halfW]], true, w)
  for (const [x0, z0, x1, z1] of trainingLineSegs(layout, halfL, halfW)) seg(p, x0, z0, x1, z1, w)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return geo
}

function soccerMarkings(w: number): THREE.BufferGeometry {
  const p: number[] = []
  const jn = (x: number, z: number) => disc(p, x, z, w / 2, 10) // fill a join
  // Outer boundary + halfway (disc the halfway's T-junctions with the touchlines).
  poly(p, [[-HALF_L, -HALF_W], [HALF_L, -HALF_W], [HALF_L, HALF_W], [-HALF_L, HALF_W]], true, w)
  seg(p, 0, -HALF_W, 0, HALF_W, w)
  // Centre circle + spot.
  arc(p, 0, 0, 9.15, 0, 2 * Math.PI, 96, w)
  disc(p, 0, 0, 0.18)
  const penAngle = Math.acos(5.5 / 9.15)
  for (const s of [-1, 1]) {
    const gl = s * HALF_L
    // Penalty + goal areas (open on the goal line, which is the boundary).
    poly(p, [[gl, -20.16], [gl - s * 16.5, -20.16], [gl - s * 16.5, 20.16], [gl, 20.16]], false, w)
    poly(p, [[gl, -9.16], [gl - s * 5.5, -9.16], [gl - s * 5.5, 9.16], [gl, 9.16]], false, w)
    const spotX = gl - s * 11
    disc(p, spotX, 0, 0.18)
    const [a0, a1] = s < 0 ? [-penAngle, penAngle] : [Math.PI - penAngle, Math.PI + penAngle]
    arc(p, spotX, 0, 9.15, a0, a1, 24, w)
    jn(spotX + 9.15 * Math.cos(a0), 9.15 * Math.sin(a0)) // "D" meets the box edge
    jn(spotX + 9.15 * Math.cos(a1), 9.15 * Math.sin(a1))
  }
  // Corner arcs.
  arc(p, -HALF_L, -HALF_W, 1, 0, Math.PI / 2, 12, w)
  arc(p, HALF_L, -HALF_W, 1, Math.PI / 2, Math.PI, 12, w)
  arc(p, -HALF_L, HALF_W, 1, -Math.PI / 2, 0, 12, w)
  arc(p, HALF_L, HALF_W, 1, Math.PI, Math.PI * 1.5, 12, w)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return geo
}

/** The mown "shading" bands, extended past the pitch so the shading covers a larger
 *  surface than the lines. `orientation` runs the stripes lengthwise (vertical, the
 *  default — bands span the width), across (horizontal — bands span the length), or
 *  off (empty geometry). For the zones area, the "bands" are instead a single fill
 *  over each of the two external zones (unless off). */
export type FieldBandsOrientation = 'vertical' | 'horizontal' | 'none'
export function bandsGeometry(orientation: FieldBandsOrientation = 'vertical', halfL = HALF_L, halfW = HALF_W, fieldType: FieldType = 'soccer11', layout: TrainingLayout = 'plain'): THREE.BufferGeometry {
  const p: number[] = []
  // A non-plain training layout replaces the mowing stripes with its own shaded
  // region(s) — a single translucent fill over each rect.
  if (fieldType === 'training' && layout !== 'plain') {
    if (orientation !== 'none') {
      for (const [x0, z0, x1, z1] of trainingShadeRects(layout, halfL, halfW)) quad(p, x0, z0, x1, z0, x1, z1, x0, z1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    return geo
  }
  if (orientation !== 'none') {
    const x0 = -halfL
    const x1 = halfL
    const z0 = -halfW
    const z1 = halfW
    const bands = 14
    if (orientation === 'vertical') {
      const bw = (x1 - x0) / bands
      for (let b = 0; b < bands; b += 2) {
        const bx0 = x0 + b * bw
        quad(p, bx0, z0, bx0 + bw, z0, bx0 + bw, z1, bx0, z1)
      }
    } else {
      const bh = (z1 - z0) / bands
      for (let b = 0; b < bands; b += 2) {
        const bz0 = z0 + b * bh
        quad(p, x0, bz0, x1, bz0, x1, bz0 + bh, x0, bz0 + bh)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return geo
}

// A regulation goal at one end of the pitch, built from the shared parametric
// goal. The canonical goal opens toward +X with its back behind; the far-end
// goal is turned 180° so both mouths face the field. Centered between the goal
// line (front) and its back (GOAL_D outside), just above the lines (GOAL_Y).
function makeGoal(sign: number, halfL = HALF_L, goalW = GOAL_W, z = 0): THREE.Group {
  const g = buildGoal({ width: goalW, height: GOAL_H, depth: GOAL_D, style: 'box', postR: POST_R })
  g.position.set(sign * (halfL + GOAL_D / 2), GOAL_Y, z)
  if (sign > 0) g.rotation.y = Math.PI
  return g
}

// A goal on the near/far touchline (z = ±halfW), turned 90° so its mouth faces the
// field. signZ = +1 → far edge (mouth toward −Z); −1 → near edge (mouth toward +Z).
// buildGoal opens toward +X, so far edge needs +90° and near edge −90°.
function makeEdgeGoal(x: number, signZ: number, halfW: number, goalW: number): THREE.Group {
  const g = buildGoal({ width: goalW, height: GOAL_H, depth: GOAL_D, style: 'box', postR: POST_R })
  g.position.set(x, GOAL_Y, signZ * (halfW + GOAL_D / 2))
  g.rotation.y = signZ > 0 ? Math.PI / 2 : -Math.PI / 2
  return g
}

function makeFlag(x: number, z: number): THREE.Group {
  const grp = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 }))
  pole.position.set(x, 0.75, z)
  pole.castShadow = true
  grp.add(pole)
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshStandardMaterial({ color: 0xff5252, side: THREE.DoubleSide, roughness: 0.6 }))
  flag.position.set(x + Math.sign(x) * -0.35, 1.28, z)
  flag.castShadow = true
  grp.add(flag)
  return grp
}

/** Build the pitch as one group, CENTRED then shifted to the pitch centre so all
 *  field types share the world frame (objects/arrows/cameras). The ground is
 *  transparent; only the white lines + shading bands are drawn, plus goals + flags.
 *  Flags are only meaningful on the full soccer pitch. */
export function buildFieldGroup(opts: { flags?: boolean; goals?: boolean; bands?: FieldBandsOrientation; fieldType?: FieldType; layout?: TrainingLayout } = {}): THREE.Group {
  const fieldType = opts.fieldType ?? 'soccer11'
  const layout = opts.layout ?? 'plain'
  const { halfL, halfW, goalW } = FIELD_DIMS[fieldType]
  const group = new THREE.Group()

  // The tiled grass ground, oversized past the pitch, under everything else.
  group.add(buildGrassGround(halfL, halfW))

  // Transparent ground that still catches the goals' soft shadows.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.6, W * 1.8), new THREE.ShadowMaterial({ opacity: 0.18 }))
  shadow.rotation.x = -Math.PI / 2
  shadow.receiveShadow = true
  group.add(shadow)

  // Translucent white shading bands (over the field extent), then crisp lines.
  // Named so the layer can rebuild the geometry when the orientation changes.
  const bands = new THREE.Mesh(bandsGeometry(opts.bands ?? 'vertical', halfL, halfW, fieldType, layout), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: BAND_OPACITY, depthWrite: false, side: THREE.DoubleSide }))
  bands.name = 'field-bands'
  bands.position.y = BAND_Y
  bands.renderOrder = 1
  group.add(bands)

  // Opaque so they depth-test cleanly above the bands (no transparency sorting).
  // Named so the layer can rebuild the geometry at a zoom-dependent width.
  const lines = new THREE.Mesh(markingsGeometry(LINE_W, fieldType, layout), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }))
  lines.name = 'field-lines'
  lines.position.y = LINE_Y
  group.add(lines)

  // Goals in a named subgroup so the layer can toggle their visibility live. Soccer
  // has its two end goals; the training area's goals come from its layout.
  const goals = new THREE.Group()
  goals.name = 'field-goals'
  if (fieldType === 'training') goals.add(...trainingGoalGroups(layout, halfL, halfW))
  else goals.add(makeGoal(-1, halfL, goalW), makeGoal(1, halfL, goalW))
  goals.visible = opts.goals ?? true
  group.add(goals)

  // Corner flags only on the full soccer pitch.
  if ((opts.flags ?? true) && fieldType === 'soccer11') {
    for (const x of [-halfL, halfL]) for (const z of [-halfW, halfW]) group.add(makeFlag(x, z))
  }

  // Centre-origin children → shift so the field is centred on the pitch centre.
  group.position.set(HALF_L, 0, HALF_W)
  return group
}

/** The goals only (centred on the pitch, like buildFieldGroup), rebuilt so the
 *  object layer can add them to ITS scene — sharing one depth buffer with the
 *  placed 3D objects. That way a ball can sit inside the goal (occluded by the
 *  front net, in front of the back net) and a player in front occludes the net,
 *  instead of the goal being painted flat on top. Shadow-casting is left off —
 *  the field layer's own goals cast the ground shadow, so this copy doesn't
 *  double it. */
export function buildGoalsOverlay(fieldType: FieldType = 'soccer11', layout: TrainingLayout = 'plain'): THREE.Group {
  const { halfL, halfW, goalW } = FIELD_DIMS[fieldType]
  const goals = new THREE.Group()
  if (fieldType === 'training') goals.add(...trainingGoalGroups(layout, halfL, halfW))
  else goals.add(makeGoal(-1, halfL, goalW), makeGoal(1, halfL, goalW))
  goals.position.set(HALF_L, 0, HALF_W)
  goals.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = false
    m.receiveShadow = false
  })
  return goals
}

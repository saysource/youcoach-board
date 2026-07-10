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
import { buildGoal, type GoalStyle } from './goal'

// Pitch dims (metres, ~FIFA), matching field-reference.ts.
const L = 105
const W = 68
const HALF_L = L / 2 // 52.5
const HALF_W = W / 2 // 34
/** World-space pitch centre: every field type is built centred and translated here,
 *  so a field of half-extent FIELD_DIMS[type] spans [centre ± halfExtent]. */
export const FIELD_WORLD_CENTER: [number, number] = [HALF_L, HALF_W]
// Per-field-type half-dimensions + goal width (metres). Every field is built
// CENTRED and then translated to the pitch centre (52.5, 0, 34), so objects,
// arrows and cameras keep sharing one world frame; the camera zones frame each
// field's own extent. Futsal: official 40×20 m court, 3 m goals.
export const FIELD_DIMS: Record<FieldType, { halfL: number; halfW: number; goalW: number }> = {
  soccer11: { halfL: 52.5, halfW: 34, goalW: 7.32 },
  training: { halfL: 20, halfW: 15, goalW: 5 },
  futsal: { halfL: 20, halfW: 10, goalW: 3 },
}

// ── Futsal court (design from assets/futsal_field.svg; official FIFA metrics) ──
// The court is a COLORED indoor floor: a court fill (the drawing's "background",
// driven by the surface color), an out-of-bounds BORDER frame around it, filled
// AREAS (goal areas + centre-circle disc), and the white markings on top.
const FUTSAL_BORDER_BAND = 2 // width (m) of the border frame around the court
const FUTSAL_AREA_R = 6 // goal-area radius (quarter circles off each post)
const FUTSAL_CIRCLE_R = 3 // centre circle
const FUTSAL_GOAL_H = 2
const FUTSAL_GOAL_D = 1
/** Court fill when no surface color is set — the reference drawing's blue. */
export const FUTSAL_COURT_FALLBACK = '#3b9ccc'
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
export const BAND_OPACITY = 0.16 // semi-transparent white "shading" bands
// Stack heights (metres) so the bands / lines never z-fight.
const BAND_Y = 0.05
const LINE_Y = 0.15
const GOAL_Y = 0.18 // lift the goals just above the lines so posts don't collide

// One shared sun so the field and the object/arrow scenes cast agreeing shadows.
export const SUN_POSITION = new THREE.Vector3(120, 165, 70)
export const SUN_TARGET = new THREE.Vector3(HALF_L, 0, HALF_W)

/** The four stadium pylons: HIGH (85 m), ~12 m outside each corner, each aimed
 *  a little INSIDE its corner (~13 m in along the length, ~8 m along the width)
 *  and only slightly inclined. With the 30° half-angle cone each spot paints a
 *  ~48 m circle of light: it reaches the pitch centre and spills ~35 m outside
 *  the perimeter — four overlapping circles covering the whole field. Pure
 *  ILLUMINATION (no shadows — the sun casts those). */
export const FLOODLIGHTS: { pos: [number, number, number]; target: [number, number, number] }[] = (
  [[0, 0], [105, 0], [0, 68], [105, 68]] as const
).map(([cx, cz]) => ({
  pos: [cx + (cx < HALF_L ? -12 : 12), 85, cz + (cz < HALF_W ? -12 : 12)],
  target: [cx + (cx < HALF_L ? 13 : -13), 0, cz + (cz < HALF_W ? 8 : -8)],
}))

/** A shadowless stadium floodlight (physical falloff). Proper SPOT behavior: a
 *  tight cone with a hard edge, so each pylon paints a distinct circle of light
 *  on the surface (esp. on a dark surround). */
export function makeFloodlight(f: { pos: [number, number, number]; target: [number, number, number] }): THREE.SpotLight {
  const spot = new THREE.SpotLight(0xffffff, 129500, 400, Math.PI / 6, 0.08, 2.7)
  spot.position.set(...f.pos)
  spot.target.position.set(...f.target)
  return spot
}

/** The CENTRE glow: a shadowless point light hung above the pitch centre. A
 *  point (not a spot) gives the pure radial falloff of the reference look —
 *  brightest at midfield, fading smoothly in every direction with no cone
 *  edge. The height sets the spread: lower = tighter hotspot. */
export const CENTER_LIGHT_INTENSITY = 12000 // default centre-glow intensity (scaled by background.centerLight)
export function makeCenterLight(): THREE.PointLight {
  const light = new THREE.PointLight(0xffffff, CENTER_LIGHT_INTENSITY, 0, 2)
  light.position.set(HALF_L, 45, HALF_W)
  return light
}

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

// A filled circular sector (triangle fan about the centre) — futsal area fills.
function sector(pos: number[], cx: number, cz: number, r: number, a0: number, a1: number, steps: number) {
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + ((a1 - a0) * i) / steps
    const t1 = a0 + ((a1 - a0) * (i + 1)) / steps
    pos.push(cx, 0, cz, cx + r * Math.cos(t0), 0, cz + r * Math.sin(t0), cx + r * Math.cos(t1), 0, cz + r * Math.sin(t1))
  }
}

/** Field markings for a type, built in the centred frame. The training `layout`
 *  adds its divider lines to the outer boundary. */
export function markingsGeometry(w = LINE_W, fieldType: FieldType = 'soccer11', layout: TrainingLayout = 'plain'): THREE.BufferGeometry {
  const { halfL, halfW } = FIELD_DIMS[fieldType]
  if (fieldType === 'soccer11') return soccerMarkings(w)
  // Futsal lines at HALF width: court markings are thinner (8 cm-ish) and the
  // small court makes full-width lines read chunky.
  if (fieldType === 'futsal') return futsalMarkings(w / 2)
  return trainingMarkings(w, halfL, halfW, layout)
}

// Futsal markings (official): boundary, halfway + centre circle (r 3) and spot,
// goal areas (r 6 quarter arcs off each post joined by a straight segment),
// penalty spot (6 m) + second penalty mark (10 m), corner arcs (r 0.25),
// substitution-zone ticks on the near touchline (5 m and 10 m from halfway) and
// the 5 m corner-distance ticks on the goal lines.
function futsalMarkings(w: number): THREE.BufferGeometry {
  const { halfL, halfW, goalW } = FIELD_DIMS.futsal
  const gh = goalW / 2
  const p: number[] = []
  const tickW = w * 0.6
  // Boundary + halfway (disc the T-junctions), centre circle + spot.
  poly(p, [[-halfL, -halfW], [halfL, -halfW], [halfL, halfW], [-halfL, halfW]], true, w)
  seg(p, 0, -halfW, 0, halfW, w)
  arc(p, 0, 0, FUTSAL_CIRCLE_R, 0, 2 * Math.PI, 64, w)
  disc(p, 0, 0, 0.15)
  for (const s of [-1, 1]) {
    const gl = s * halfL
    // Goal area: a quarter arc off each post + the 6 m chord between them. For the
    // left end the arcs run from the goal line (pointing ±z) to straight in (+x).
    const aIn = s < 0 ? 0 : Math.PI // "toward the field" angle
    arc(p, gl, -gh, FUTSAL_AREA_R, s < 0 ? -Math.PI / 2 : Math.PI, s < 0 ? aIn : Math.PI * 1.5, 16, w)
    arc(p, gl, gh, FUTSAL_AREA_R, s < 0 ? aIn : Math.PI / 2, s < 0 ? Math.PI / 2 : Math.PI, 16, w)
    seg(p, gl - s * FUTSAL_AREA_R, -gh, gl - s * FUTSAL_AREA_R, gh, w)
    // Penalty spot (6 m) + second penalty mark (10 m).
    disc(p, gl - s * 6, 0, 0.12)
    disc(p, gl - s * 10, 0, 0.1)
    // 5 m corner-distance ticks on the goal line (crossing it).
    for (const z of [-halfW + 5, halfW - 5]) seg(p, gl - 0.4, z, gl + 0.4, z, tickW)
  }
  // Corner arcs (r 0.25 — thin, or the arc drowns in the line width).
  arc(p, -halfL, -halfW, 0.25, 0, Math.PI / 2, 6, tickW)
  arc(p, halfL, -halfW, 0.25, Math.PI / 2, Math.PI, 6, tickW)
  arc(p, -halfL, halfW, 0.25, -Math.PI / 2, 0, 6, tickW)
  arc(p, halfL, halfW, 0.25, Math.PI, Math.PI * 1.5, 6, tickW)
  // Substitution zones on the near touchline: ticks 5 m and 10 m from halfway.
  for (const x of [-10, -5, 5, 10]) seg(p, x, halfW - 0.4, x, halfW + 0.4, tickW)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return geo
}

/** Futsal AREAS fill (the drawing's dark shapes): the two goal areas (quarter
 *  discs + connecting rectangle) and the centre-circle disc. */
export function futsalAreasGeometry(): THREE.BufferGeometry {
  const { halfL, goalW } = FIELD_DIMS.futsal
  const gh = goalW / 2
  const p: number[] = []
  disc(p, 0, 0, FUTSAL_CIRCLE_R, 48)
  for (const s of [-1, 1]) {
    const gl = s * halfL
    const inX = gl - s * FUTSAL_AREA_R
    sector(p, gl, -gh, FUTSAL_AREA_R, s < 0 ? -Math.PI / 2 : Math.PI, s < 0 ? 0 : Math.PI * 1.5, 16)
    sector(p, gl, gh, FUTSAL_AREA_R, s < 0 ? 0 : Math.PI / 2, s < 0 ? Math.PI / 2 : Math.PI, 16)
    quad(p, gl, -gh, inX, -gh, inX, gh, gl, gh)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return geo
}

/** Futsal BORDER frame: the band between the court boundary and the surround
 *  (the drawing's orange frame), as four rectangles around the court. */
export function futsalBorderGeometry(): THREE.BufferGeometry {
  const { halfL, halfW } = FIELD_DIMS.futsal
  const b = FUTSAL_BORDER_BAND
  const oL = halfL + b
  const oW = halfW + b
  const p: number[] = []
  quad(p, -oL, -oW, oL, -oW, oL, -halfW, -oL, -halfW) // top band
  quad(p, -oL, halfW, oL, halfW, oL, oW, -oL, oW) // bottom band
  quad(p, -oL, -halfW, -halfL, -halfW, -halfL, halfW, -oL, halfW) // left band
  quad(p, halfL, -halfW, oL, -halfW, oL, halfW, halfL, halfW) // right band
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return geo
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
export type FieldBandsOrientation = 'vertical' | 'horizontal' | 'cross' | 'none'
export function bandsGeometry(orientation: FieldBandsOrientation = 'vertical', halfL = HALF_L, halfW = HALF_W, fieldType: FieldType = 'soccer11', layout: TrainingLayout = 'plain'): THREE.BufferGeometry {
  const p: number[] = []
  // Futsal is an indoor court — no mowing pattern.
  if (fieldType === 'futsal') {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    return geo
  }
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
    // One band WIDTH (metres) for both orientations, so vertical and horizontal
    // stripes match (and 'cross' makes square cells). Derived from splitting the
    // length into 14 — the long-axis look is unchanged; the cross-axis now uses the
    // same width instead of length/14 ≠ width/14.
    const bw = (x1 - x0) / 14
    // 'cross' lays down BOTH sets (a chequered mow); the caller halves the band
    // opacity so a single strip reads at half intensity and the overlaps (where the
    // two sets cross) compound back up to a full band. The bands material has
    // depthWrite off, so the coplanar quads blend rather than z-fight.
    if (orientation === 'vertical' || orientation === 'cross') {
      for (let bx0 = x0; bx0 < x1; bx0 += 2 * bw) {
        quad(p, bx0, z0, Math.min(bx0 + bw, x1), z0, Math.min(bx0 + bw, x1), z1, bx0, z1)
      }
    }
    if (orientation === 'horizontal' || orientation === 'cross') {
      for (let bz0 = z0; bz0 < z1; bz0 += 2 * bw) {
        quad(p, x0, bz0, x1, bz0, x1, Math.min(bz0 + bw, z1), x0, Math.min(bz0 + bw, z1))
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
function makeGoal(sign: number, halfL = HALF_L, goalW = GOAL_W, z = 0, goalH = GOAL_H, goalD = GOAL_D, style: GoalStyle = 'box'): THREE.Group {
  const g = buildGoal({ width: goalW, height: goalH, depth: goalD, style, postR: POST_R })
  g.position.set(sign * (halfL + goalD / 2), GOAL_Y, z)
  if (sign > 0) g.rotation.y = Math.PI
  return g
}

// The two end goals for a field type. Futsal goals are smaller (3×2 m, 1 m deep)
// and use the striped indoor style (red/white frame, rounded thin back).
function endGoals(fieldType: FieldType, halfL: number, goalW: number): THREE.Group[] {
  const futsal = fieldType === 'futsal'
  const h = futsal ? FUTSAL_GOAL_H : GOAL_H
  const d = futsal ? FUTSAL_GOAL_D : GOAL_D
  const style: GoalStyle = futsal ? 'futsal' : 'box'
  return [makeGoal(-1, halfL, goalW, 0, h, d, style), makeGoal(1, halfL, goalW, 0, h, d, style)]
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
export function buildFieldGroup(opts: { flags?: boolean; goals?: boolean; bands?: FieldBandsOrientation; fieldType?: FieldType; layout?: TrainingLayout; surround?: string; court?: string; border?: string; areas?: string } = {}): THREE.Group {
  const fieldType = opts.fieldType ?? 'soccer11'
  const layout = opts.layout ?? 'plain'
  const { halfL, halfW, goalW } = FIELD_DIMS[fieldType]
  const group = new THREE.Group()

  // Optional "infinite" colored ground under everything: a huge flat plane just
  // below y=0, so grazing/perspective views get a real horizon instead of the
  // flat 2D board background. Hidden when surround is unset/'transparent' —
  // NOTE it is opaque, so when visible it covers the 2D background image/color
  // everywhere the plane projects (including inside the pitch).
  const surroundOn = !!opts.surround && opts.surround !== 'transparent'
  // Lit standard material: the floodlights' falloff grades the plane away from
  // the pitch, and its low roughness gives the surface a slight sheen.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ color: surroundOn ? opts.surround : '#ffffff', roughness: 0.55, metalness: 0 }),
  )
  ground.name = 'field-ground'
  ground.rotation.x = -Math.PI / 2
  // Deep enough below the lines/bands that far-away, grazing views don't
  // z-fight (depth precision shrinks with distance); still visually "at" y=0.
  ground.position.y = -0.3
  ground.visible = surroundOn
  group.add(ground)

  // Transparent ground that still catches the goals' soft shadows. Lifted just
  // above the futsal court fills (which are opaque) so the shadows stay visible.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.6, W * 1.8), new THREE.ShadowMaterial({ opacity: 0.18 }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.04
  shadow.receiveShadow = true
  group.add(shadow)

  // Futsal indoor floor: court fill (the drawing's "background", driven by the
  // surface color), the out-of-bounds border frame, and the filled areas (goal
  // areas + centre circle). Unlit (MeshBasic) so they keep the design's exact
  // colors; named so the layer can recolor them live.
  if (fieldType === 'futsal') {
    // LIT surfaces (like the surround ground) so the stadium/central lights shape
    // them. Kept a few millimetres apart — close enough that lines no longer read
    // as floating at grazing angles — with polygonOffset + renderOrder resolving
    // the depth ties the small gaps alone can't guarantee at distance.
    // Low roughness = a varnished indoor floor: the floodlights/sun paint glossy
    // specular highlights that slide across the court as the camera moves.
    const mat = (color: string, order: number) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 1.0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order * 3 })
    const courtPos: number[] = []
    quad(courtPos, -halfL, -halfW, halfL, -halfW, halfL, halfW, -halfL, halfW)
    const courtGeo = new THREE.BufferGeometry()
    courtGeo.setAttribute('position', new THREE.Float32BufferAttribute(courtPos, 3))
    courtGeo.computeVertexNormals()
    const court = new THREE.Mesh(courtGeo, mat(opts.court ?? FUTSAL_COURT_FALLBACK, 1))
    court.name = 'field-court'
    court.position.y = 0.002
    court.renderOrder = 1
    group.add(court)

    const borderGeo = futsalBorderGeometry()
    borderGeo.computeVertexNormals()
    const border = new THREE.Mesh(borderGeo, mat(opts.border ?? '#ff9f48', 1))
    border.name = 'field-border'
    border.position.y = 0.002
    border.renderOrder = 1
    group.add(border)

    const areasGeo = futsalAreasGeometry()
    areasGeo.computeVertexNormals()
    const areas = new THREE.Mesh(areasGeo, mat(opts.areas ?? '#277ea0', 2))
    areas.name = 'field-areas'
    areas.position.y = 0.005
    areas.renderOrder = 2
    group.add(areas)
  }

  // Translucent white shading bands (over the field extent), then crisp lines.
  // Named so the layer can rebuild the geometry when the orientation changes.
  const bands = new THREE.Mesh(bandsGeometry(opts.bands ?? 'vertical', halfL, halfW, fieldType, layout), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: opts.bands === 'cross' ? BAND_OPACITY / 2 : BAND_OPACITY, depthWrite: false, side: THREE.DoubleSide }))
  bands.name = 'field-bands'
  bands.position.y = BAND_Y
  bands.renderOrder = 1
  group.add(bands)

  // Opaque so they depth-test cleanly above the bands (no transparency sorting).
  // Named so the layer can rebuild the geometry at a zoom-dependent width.
  // Futsal lines sit just above the court fills (a big gap reads as floating at
  // grazing angles over the colored surfaces); grass pitches keep the safe height.
  const lines = new THREE.Mesh(markingsGeometry(LINE_W, fieldType, layout), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, ...(fieldType === 'futsal' ? { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 } : {}) }))
  lines.name = 'field-lines'
  lines.position.y = fieldType === 'futsal' ? 0.01 : LINE_Y
  lines.renderOrder = fieldType === 'futsal' ? 3 : 0
  group.add(lines)

  // Goals in a named subgroup so the layer can toggle their visibility live. Soccer
  // has its two end goals; the training area's goals come from its layout.
  const goals = new THREE.Group()
  goals.name = 'field-goals'
  if (fieldType === 'training') goals.add(...trainingGoalGroups(layout, halfL, halfW))
  else goals.add(...endGoals(fieldType, halfL, goalW))
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
  else goals.add(...endGoals(fieldType, halfL, goalW))
  goals.position.set(HALF_L, 0, HALF_W)
  goals.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = false
    m.receiveShadow = false
  })
  return goals
}

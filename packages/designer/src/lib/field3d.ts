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
import { buildGoal } from './goal'

// Pitch dims (metres, ~FIFA), matching field-reference.ts.
const L = 105
const W = 68
const HALF_L = L / 2 // 52.5
const HALF_W = W / 2 // 34
const GOAL_W = 7.32
const GOAL_H = 2.44
const GOAL_D = 2.0
const POST_R = 0.06
const LINE_W = 0.45 // base pitch line width (metres); scaled down when zoomed in
const LINE_W_MIN = 0.18 // thinnest line (close zoom) — ~real pitch line width
const BAND_OVERFLOW = 0 // stripe bands stay within the pitch
const BAND_OPACITY = 0.16 // semi-transparent white "shading" bands
// Stack heights (metres) so the ground / bands / lines never z-fight.
const BAND_Y = 0.05
const LINE_Y = 0.15
const GOAL_Y = 0.18 // lift the goals just above the lines so posts don't collide

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

export function markingsGeometry(w = LINE_W): THREE.BufferGeometry {
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

// Alternating translucent-white "mowing" bands, extended past the pitch so the
// shading covers a larger surface than the lines.
function bandsGeometry(): THREE.BufferGeometry {
  const p: number[] = []
  const mx = L * BAND_OVERFLOW
  const mz = W * BAND_OVERFLOW
  const x0 = -HALF_L - mx
  const x1 = HALF_L + mx
  const z0 = -HALF_W - mz
  const z1 = HALF_W + mz
  const bands = 14
  const bw = (x1 - x0) / bands
  for (let b = 0; b < bands; b += 2) {
    const bx0 = x0 + b * bw
    quad(p, bx0, z0, bx0 + bw, z0, bx0 + bw, z1, bx0, z1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return geo
}

// A regulation goal at one end of the pitch, built from the shared parametric
// goal. The canonical goal opens toward +X with its back behind; the far-end
// goal is turned 180° so both mouths face the field. Centered between the goal
// line (front) and its back (GOAL_D outside), just above the lines (GOAL_Y).
function makeGoal(sign: number): THREE.Group {
  const g = buildGoal({ width: GOAL_W, height: GOAL_H, depth: GOAL_D, style: 'box', postR: POST_R })
  g.position.set(sign * (HALF_L + GOAL_D / 2), GOAL_Y, 0)
  if (sign > 0) g.rotation.y = Math.PI
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

/** Build the pitch as one group in the corner-origin world frame (0..105 × 0..68).
 *  The ground is transparent (the board background shows through); only the white
 *  lines + translucent shading bands are drawn, plus goals + flags. */
export function buildFieldGroup(opts: { flags?: boolean } = {}): THREE.Group {
  const group = new THREE.Group()

  // Transparent ground that still catches the goals' soft shadows.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.6, W * 1.8), new THREE.ShadowMaterial({ opacity: 0.18 }))
  shadow.rotation.x = -Math.PI / 2
  shadow.receiveShadow = true
  group.add(shadow)

  // Translucent white shading bands (extended past the pitch), then crisp lines.
  const bands = new THREE.Mesh(bandsGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: BAND_OPACITY, depthWrite: false, side: THREE.DoubleSide }))
  bands.position.y = BAND_Y
  bands.renderOrder = 1
  group.add(bands)

  // Opaque so they depth-test cleanly above the bands (no transparency sorting).
  // Named so the layer can rebuild the geometry at a zoom-dependent width.
  const lines = new THREE.Mesh(markingsGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }))
  lines.name = 'field-lines'
  lines.position.y = LINE_Y
  group.add(lines)

  group.add(makeGoal(-1), makeGoal(1))

  if (opts.flags ?? true) {
    for (const x of [-HALF_L, HALF_L]) for (const z of [-HALF_W, HALF_W]) group.add(makeFlag(x, z))
  }

  // Centre-origin children → shift so the pitch spans 0..105 × 0..68.
  group.position.set(HALF_L, 0, HALF_W)
  return group
}

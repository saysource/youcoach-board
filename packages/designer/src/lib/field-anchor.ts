// Pinning board elements to the 3D pitch.
//
// Two kinds of pin, both recording where an element sits on the grass so we can
// recompute its 2D placement when the field camera (background.field3d) changes:
//
//   - STANDING elements (figure, token): one `ground = [x, z]` (world metres,
//     y=0) — the element's BOTTOM-CENTER ("feet"). On a camera change it keeps
//     that spot and scales with the pitch magnification there.
//   - AREA/PATH elements (polyline, and rectangles converted to closed
//     polylines): one `ground` per point, parallel to `points`. Each defining
//     point sticks to its own grass spot, so the shape genuinely WARPS onto the
//     field surface (a pitch rectangle becomes a trapezoid from another angle).
//
// See specs/start.md "Elements on the 3D space". Framework-free (three.js only).

import * as THREE from 'three'
import { type BoardElement, type PolylineElement, type ElementChange, type Operation, getLocalBounds, BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { makeCalibratedCamera, type PosedCamera } from './field-camera'
import { boardToGround } from './arrow3d'
import { rectToPolyline, ellipseToPolyline } from './draw'

/** Project a ground point (x, 0, z) to board units, but clamp a point that lies
 *  BEHIND the camera to just in front of the near plane (w ≥ ε). Plain
 *  `.project()` divides by a negative w for behind-camera points, which flips
 *  their sign and wraps a vertex to the OPPOSITE side of the screen — so a filled
 *  polygon straddling the camera (e.g. a pitch rectangle when zoomed in low)
 *  inverts and covers everything. Clamping w keeps a behind vertex flying off in
 *  its true direction, so the shape just extends off-screen. */
function projectGround(cam: THREE.Camera, x: number, z: number): [number, number] {
  const v = new THREE.Vector4(x, 0, z, 1)
  v.applyMatrix4(cam.matrixWorldInverse)
  v.applyMatrix4(cam.projectionMatrix)
  const w = v.w > 1e-4 ? v.w : 1e-4
  return [((v.x / w + 1) * BOARD_WIDTH) / 2, ((1 - v.y / w) * BOARD_HEIGHT) / 2]
}

/** Elements that stand on the pitch and carry a single ground anchor. */
export type GroundElement = Extract<BoardElement, { type: 'figure' | 'token' }>
export function isGroundElement(el: BoardElement): el is GroundElement {
  return el.type === 'figure' || el.type === 'token'
}

/** The element's local (transform-free) center — the axis the transform scales/
 *  rotates about — and its local height. */
function localCenter(el: GroundElement): { cx: number; cy: number; h: number } {
  const lb = getLocalBounds(el)
  return { cx: lb.x + lb.width / 2, cy: lb.y + lb.height / 2, h: lb.height }
}

/** The element's current bottom-center in board units (transform applied). */
export function bottomCenterBoard(el: GroundElement): { x: number; y: number } {
  const { cx, cy, h } = localCenter(el)
  const t = el.transform
  return { x: cx + t.x, y: cy + (h * t.scale) / 2 + t.y }
}

/** A polyline's points in board units, with its transform applied EXACTLY as
 *  ElementView renders it: `board = c + R·s·(p − c) + (x, y)` (translate, then
 *  rotate + scale about the local center). */
function polyBoardPoints(el: PolylineElement): [number, number][] {
  const lb = getLocalBounds(el)
  const cx = lb.x + lb.width / 2
  const cy = lb.y + lb.height / 2
  const { x, y, rotate, scale } = el.transform
  const rad = (rotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return el.points.map(([px, py]) => {
    const sx = (px - cx) * scale
    const sy = (py - cy) * scale
    return [cx + (sx * cos - sy * sin) + x, cy + (sx * sin + sy * cos) + y]
  })
}

/** Each polyline point's ground anchor under `cam`, or null if ANY point doesn't
 *  hit the ground plane (the array must stay parallel to `points`). */
function polylineGround(el: PolylineElement, cam: THREE.Camera): Array<[number, number]> | null {
  const out: Array<[number, number]> = []
  for (const [bx, by] of polyBoardPoints(el)) {
    const g = boardToGround(bx, by, cam)
    if (!g) return null
    out.push([g.x, g.z])
  }
  return out
}

/** Ground pixels-per-metre at (x, z): √(projected area of a 1 m × 1 m ground
 *  quad). Direction-averaged + perspective-correct, and — unlike a vertical
 *  yard-stick — well-defined even in a straight-down top view. Uses the
 *  w-clamped projection so a spot near/behind the camera doesn't flip to a
 *  bogus area. */
function groundPPM(cam: THREE.Camera, x: number, z: number): number {
  const o = projectGround(cam, x, z)
  const a = projectGround(cam, x + 1, z)
  const b = projectGround(cam, x, z + 1)
  const area = Math.abs((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]))
  return Math.sqrt(area) || 1
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const closePt = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4
function sameGround(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  return a.length === b.length && a.every((p, i) => closePt(p, b[i]))
}

/** Prepare pins on entering Edit-Background (a single undoable step, run BEFORE
 *  the field-edit transaction). For every pinnable element it (re)derives the
 *  ground anchor from the element's CURRENT board placement through `cfg` — which
 *  heals any staleness from ordinary fixed-camera edits — and, because only a
 *  polygon can warp, CONVERTS each rectangle into an equivalent closed polyline
 *  first. Returns:
 *   - `remove` + `add` ops (same index, id preserved) per rectangle, the added
 *     polyline already carrying its per-point ground, and
 *   - one `update` op setting `ground` on figures/tokens/polylines whose anchor
 *     changed (already-synced elements are skipped, so it's idempotent). */
export function buildPinOps(elements: BoardElement[], cfg: PosedCamera): Operation[] {
  const cam = makeCalibratedCamera(cfg)
  const ops: Operation[] = []
  const updates: ElementChange[] = []
  elements.forEach((el, index) => {
    if (el.type === 'figure' || el.type === 'token') {
      const bc = bottomCenterBoard(el)
      const g = boardToGround(bc.x, bc.y, cam)
      if (!g) return
      const next: [number, number] = [g.x, g.z]
      // Capture the figure's real-world height (metres) at its spot, so its size
      // can be derived absolutely under any camera (self-correcting scaling).
      const sizeM = (localCenter(el).h * el.transform.scale) / groundPPM(cam, g.x, g.z)
      const groundSame = el.ground && closePt(el.ground, next)
      const sizeSame = el.sizeM != null && Math.abs(el.sizeM - sizeM) < 1e-4
      if (groundSame && sizeSame) return
      updates.push({ id: el.id, before: { ground: el.ground, sizeM: el.sizeM }, after: { ground: next, sizeM } })
    } else if (el.type === 'polyline') {
      const g = polylineGround(el, cam)
      if (!g) return
      if (el.ground && sameGround(el.ground, g)) return
      updates.push({ id: el.id, before: { ground: el.ground }, after: { ground: g } })
    } else if (el.type === 'rect' || el.type === 'ellipse') {
      // Only a point-defined shape can warp onto the pitch, so a rectangle / oval
      // becomes its polyline equivalent (closed; smooth for the oval) when pinned.
      const poly = (el.type === 'rect' ? rectToPolyline(el) : ellipseToPolyline(el)) as PolylineElement
      const g = polylineGround(poly, cam)
      ops.push({ kind: 'remove', element: el, index })
      ops.push({ kind: 'add', element: g ? { ...poly, ground: g } : poly, index })
    }
  })
  if (updates.length) ops.push({ kind: 'update', changes: updates })
  return ops
}

/** Reproject every pinned element from the `before` camera to `after`:
 *   - figure/token: reposition its bottom-center to `projectGround(ground)` and
 *     resize ABSOLUTELY from its stored metric height (`sizeM × ground-ppm`), so
 *     scale is self-correcting — a figure that briefly leaves the view while
 *     zooming returns to its right size (older docs with no `sizeM` fall back to
 *     the ground-ppm ratio);
 *   - polyline: reproject EACH point to `projectGround(ground[i])` and bake it
 *     into `points` (resetting translate/rotate/scale, keeping opacity), so the
 *     shape warps to stay on the field surface.
 *  Elements without a ground anchor are skipped. Returns the `update` changes. */
export function reprojectChanges(elements: BoardElement[], before: PosedCamera, after: PosedCamera, opts?: { tokenPerspective?: boolean }): ElementChange[] {
  const tokenPerspective = opts?.tokenPerspective !== false
  const oldCam = makeCalibratedCamera(before)
  const newCam = makeCalibratedCamera(after)
  const changes: ElementChange[] = []
  for (const el of elements) {
    if (el.type === 'polyline' && el.ground) {
      const pts: Array<[number, number]> = el.ground.map(([x, z]) => projectGround(newCam, x, z))
      changes.push({ id: el.id, before: { points: el.points, transform: el.transform }, after: { points: pts, transform: { ...el.transform, x: 0, y: 0, rotate: 0, scale: 1 } } })
      continue
    }
    if (!isGroundElement(el) || !el.ground) continue
    const [gx, gz] = el.ground
    const { cx, cy, h } = localCenter(el)
    let scale: number
    if (el.type === 'token' && !tokenPerspective) {
      // Token-perspective off: keep a constant on-board size (still repositioned).
      scale = el.transform.scale
    } else if (el.sizeM != null) {
      // Absolute: size follows the pitch magnification here, independent of the
      // current (possibly out-of-view, collapsed) scale — so it never gets stuck.
      scale = clamp((el.sizeM * groundPPM(newCam, gx, gz)) / (h || 1), 0.05, 30)
    } else {
      const ratio = groundPPM(newCam, gx, gz) / groundPPM(oldCam, gx, gz)
      if (!Number.isFinite(ratio) || ratio <= 0) continue
      scale = clamp(el.transform.scale * ratio, 0.05, 30)
    }
    const [bcx, bcy] = projectGround(newCam, gx, gz)
    const after2 = { ...el.transform, x: bcx - cx, y: bcy - cy - (h * scale) / 2, scale }
    changes.push({ id: el.id, before: { transform: el.transform }, after: { transform: after2 } })
  }
  return changes
}

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
import { type BoardElement, type PolylineElement, type DrawElement, type TokenElement, type ElementChange, type Operation, getLocalBounds, BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { makeCalibratedCamera, type PosedCamera } from './field-camera'
import { boardToGround } from './arrow3d'
import { rectToPolyline, ellipseToPolyline } from './draw'
import { DEFAULT_ZONE } from './field-zones'

/** Project a ground point (x, 0, z) to board units, but clamp a point that lies
 *  BEHIND the camera to just in front of the near plane (w ≥ ε). Plain
 *  `.project()` divides by a negative w for behind-camera points, which flips
 *  their sign and wraps a vertex to the OPPOSITE side of the screen — so a filled
 *  polygon straddling the camera (e.g. a pitch rectangle when zoomed in low)
 *  inverts and covers everything. Clamping w keeps a behind vertex flying off in
 *  its true direction, so the shape just extends off-screen. */
export function projectGround(cam: THREE.Camera, x: number, z: number): [number, number] {
  const v = new THREE.Vector4(x, 0, z, 1)
  v.applyMatrix4(cam.matrixWorldInverse)
  v.applyMatrix4(cam.projectionMatrix)
  const w = v.w > 1e-4 ? v.w : 1e-4
  return [((v.x / w + 1) * BOARD_WIDTH) / 2, ((1 - v.y / w) * BOARD_HEIGHT) / 2]
}

/** Clip-space w of a ground point (> 0 ⇔ in front of the camera). */
function groundW(cam: THREE.Camera, x: number, z: number): number {
  const v = new THREE.Vector4(x, 0, z, 1)
  v.applyMatrix4(cam.matrixWorldInverse)
  v.applyMatrix4(cam.projectionMatrix)
  return v.w
}

/** Project a chain of ground points to board units, clipping every vertex that lies
 *  BEHIND the camera (w ≤ ε) to where its segment crosses the front plane — toward
 *  whichever neighbour is in front. Keeps a pitch-pinned line running off toward the
 *  horizon instead of its far end swinging to huge coordinates (the raw per-point
 *  w-clamp) when the camera dips low on zoom-in. Output stays parallel to the input;
 *  a vertex with no in-front neighbour (whole segment behind) falls back to the
 *  clamp (it is off-screen regardless). */
export function projectGroundPath(cam: THREE.Camera, pts: Array<[number, number]>): Array<[number, number]> {
  const EPS = 1e-3
  const ws = pts.map(([x, z]) => groundW(cam, x, z))
  return pts.map(([x, z], i) => {
    if (ws[i] > EPS) return projectGround(cam, x, z)
    const j = ws[i - 1] > EPS ? i - 1 : ws[i + 1] > EPS ? i + 1 : -1
    if (j < 0) return projectGround(cam, x, z)
    const t = (EPS - ws[i]) / (ws[j] - ws[i])
    return projectGround(cam, x + (pts[j][0] - x) * t, z + (pts[j][1] - z) * t)
  })
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

/** Point-path elements that carry a per-point ground footprint. */
type PathElement = PolylineElement | DrawElement

/** A polyline/stroke's points in board units, with its transform applied EXACTLY as
 *  ElementView renders it: `board = c + R·s·(p − c) + (x, y)` (translate, then
 *  rotate + scale about the local center). */
export function polyBoardPoints(el: PathElement): [number, number][] {
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
export function polylineGround(el: PathElement, cam: THREE.Camera): Array<[number, number]> | null {
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

/** Ground pixels-per-metre at a standing element's pitch anchor under `cfg` (its
 *  stored ground, else derived from its current bottom-center), or null if it
 *  can't be projected. Lets the designer compute perspective-correct token sizes
 *  at resize time (in normal mode, where no reprojection runs). */
export function anchorPPM(el: GroundElement, cfg: PosedCamera): number | null {
  const cam = makeCalibratedCamera(cfg)
  let g = el.ground
  if (!g) {
    const bc = bottomCenterBoard(el)
    const hit = boardToGround(bc.x, bc.y, cam)
    if (!hit) return null
    g = [hit.x, hit.z]
  }
  return groundPPM(cam, g[0], g[1])
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const closePt = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4

/** Pitch centre (metres, corner-origin frame) — the neutral depth for the fixed
 *  reference scale below. */
const PITCH_CENTRE: [number, number] = [52.5, 34]

/** A FIXED board-units-per-metre — the ground-ppm at pitch centre in the default
 *  view — used to size tokens when perspective is off, so their size is constant
 *  (independent of the field camera's zoom/pan), like the pose-number markers.
 *  Computed once (lazily) from the default pose. */
let ppmRefCache: number | null = null
export function referencePPM(): number {
  if (ppmRefCache == null) ppmRefCache = groundPPM(makeCalibratedCamera(DEFAULT_ZONE.camera), PITCH_CENTRE[0], PITCH_CENTRE[1])
  return ppmRefCache
}

/** On-board height (px) for a token of metric height `m` at ground `g`: sized at
 *  its own depth when perspective is on (near tokens read bigger, follows the
 *  camera), or at a FIXED reference scale when off (constant board size — doesn't
 *  change with the scene's zoom/pan). */
export function tokenBoardH(cam: THREE.Camera, m: number, g: [number, number], perspective: boolean): number {
  return perspective ? m * groundPPM(cam, g[0], g[1]) : m * referencePPM()
}

/** Default token size on the pitch: a 2.5 m RADIUS → 5 m DIAMETER. A token box is
 *  square (width = height = diameter), and `sizeM` is that metric height, so this
 *  is the default `sizeM`. Deliberately fixed (not derived from the drawn board
 *  size), so every fresh token is 2.5 m regardless of prior scale logic. */
export const TOKEN_DEFAULT_SIZE_M = 5

/** Pin a freshly-stamped token to the pitch at the fixed 2.5 m-radius default:
 *  capture its ground anchor + set `sizeM` and the on-board `scale` so it renders
 *  at 2.5 m radius immediately (before any camera move). Returns it unchanged if
 *  its drop point misses the pitch. */
export function pinNewToken(el: TokenElement, cfg: PosedCamera, perspective: boolean): TokenElement {
  const cam = makeCalibratedCamera(cfg)
  const bc = bottomCenterBoard(el)
  const g = boardToGround(bc.x, bc.y, cam)
  if (!g) return el
  const h = localCenter(el).h
  const scale = clamp(tokenBoardH(cam, TOKEN_DEFAULT_SIZE_M, [g.x, g.z], perspective) / (h || 1), 0.05, 30)
  return { ...el, ground: [g.x, g.z], sizeM: TOKEN_DEFAULT_SIZE_M, transform: { ...el.transform, scale } }
}

/** The ground displacement (metres) for nudging a pitch element at ground (gx, gz)
 *  by (dx, dy) BOARD units under `cfg` — projects the anchor, offsets it on-screen,
 *  and reads back the ground delta. So arrow-key nudges of `object3d`/`arrow3d`
 *  feel like the 2D board nudge (screen-relative). Null if it can't hit the ground. */
export function groundNudgeDelta(cfg: PosedCamera, gx: number, gz: number, dx: number, dy: number): { dgx: number; dgz: number } | null {
  const cam = makeCalibratedCamera(cfg)
  const b = projectGround(cam, gx, gz)
  const g0 = boardToGround(b[0], b[1], cam)
  const g1 = boardToGround(b[0] + dx, b[1] + dy, cam)
  if (!g0 || !g1) return null
  return { dgx: g1.x - g0.x, dgz: g1.z - g0.z }
}
function sameGround(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  return a.length === b.length && a.every((p, i) => closePt(p, b[i]))
}

/** The one metric height (metres) all tokens share when "sync token sizes" is on
 *  — taken from the reference token (first selected, else first in the doc) at its
 *  ground spot. Storing ONE size (rather than deriving each token's from its own
 *  depth) is what keeps synced tokens equal in flat views: without it, entering
 *  from a perspective view gives near/far tokens different `sizeM` for the same
 *  board size, so they'd render at different sizes in a later top view. */
function sharedTokenSizeM(elements: BoardElement[], cam: THREE.Camera, refId?: string): number | null {
  const tokens = elements.filter((e): e is GroundElement => e.type === 'token')
  const ref = tokens.find((t) => t.id === refId) ?? tokens[0]
  if (!ref) return null
  const bc = bottomCenterBoard(ref)
  const g = boardToGround(bc.x, bc.y, cam)
  if (!g) return null
  return (localCenter(ref).h * ref.transform.scale) / groundPPM(cam, g.x, g.z)
}

/** Prepare pins on entering Edit-Background (a single undoable step, run BEFORE
 *  the field-edit transaction). For every pinnable element it (re)derives the
 *  ground anchor from the element's CURRENT board placement through `cfg` — which
 *  heals any staleness from ordinary fixed-camera edits — and, because only a
 *  polygon can warp, CONVERTS each rectangle into an equivalent closed polyline
 *  first. When `syncTokenSizes` is on, ALL tokens are given one shared metric
 *  height (so they stay equal-sized in flat views regardless of perspective).
 *  Returns:
 *   - `remove` + `add` ops (same index, id preserved) per rectangle, the added
 *     polyline already carrying its per-point ground, and
 *   - one `update` op setting `ground`/`sizeM` on standing elements whose anchor
 *     changed (already-synced elements are skipped, so it's idempotent). */
export function buildPinOps(elements: BoardElement[], cfg: PosedCamera, opts?: { syncTokenSizes?: boolean; refTokenId?: string }): Operation[] {
  const cam = makeCalibratedCamera(cfg)
  const ops: Operation[] = []
  const updates: ElementChange[] = []
  const shared = opts?.syncTokenSizes ? sharedTokenSizeM(elements, cam, opts.refTokenId) : null
  elements.forEach((el, index) => {
    if (el.type === 'figure' || el.type === 'token') {
      const bc = bottomCenterBoard(el)
      const g = boardToGround(bc.x, bc.y, cam)
      if (!g) return
      const next: [number, number] = [g.x, g.z]
      // Capture the element's real-world height (metres) at its spot, so its size
      // can be derived absolutely under any camera (self-correcting scaling).
      // Synced tokens all take the ONE shared size instead of their own depth's.
      // Tokens take a FIXED default size (2.5 m radius) rather than one derived from
      // their drawn board size — a synced token takes the shared size, else its own
      // explicit `sizeM` (from a resize), else the 2.5 m default. Figures stay
      // derived from their drawn size.
      const sizeM =
        el.type === 'token'
          ? (shared ?? el.sizeM ?? TOKEN_DEFAULT_SIZE_M)
          : (localCenter(el).h * el.transform.scale) / groundPPM(cam, g.x, g.z)
      const groundSame = el.ground && closePt(el.ground, next)
      const sizeSame = el.sizeM != null && Math.abs(el.sizeM - sizeM) < 1e-4
      if (groundSame && sizeSame) return
      updates.push({ id: el.id, before: { ground: el.ground, sizeM: el.sizeM }, after: { ground: next, sizeM } })
    } else if (el.type === 'polyline' || el.type === 'draw') {
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

/** Return `elements` with each figure/token/polyline's ground anchor derived under
 *  `cfg` when it lacks one (figures/tokens also gain `sizeM`), so they can be
 *  reprojected without a prior Edit-Background pin pass — e.g. to follow the
 *  orbiting field during (view-only) navigation. Elements that already carry a
 *  ground anchor, and non-pinnable types, are returned unchanged. */
export function withGroundAnchors(elements: BoardElement[], cfg: PosedCamera): BoardElement[] {
  const cam = makeCalibratedCamera(cfg)
  return elements.map((el) => {
    if ((el.type === 'figure' || el.type === 'token') && !el.ground) {
      const bc = bottomCenterBoard(el)
      const g = boardToGround(bc.x, bc.y, cam)
      if (!g) return el
      // Tokens default to the fixed 2.5 m radius (or their explicit resized `sizeM`);
      // figures derive from their drawn board size.
      const sizeM = el.type === 'token' ? (el.sizeM ?? TOKEN_DEFAULT_SIZE_M) : (localCenter(el).h * el.transform.scale) / groundPPM(cam, g.x, g.z)
      return { ...el, ground: [g.x, g.z] as [number, number], sizeM }
    }
    if ((el.type === 'polyline' || el.type === 'draw') && !el.ground) {
      const g = polylineGround(el, cam)
      return g ? { ...el, ground: g } : el
    }
    return el
  })
}

/** Pin a freshly-drawn shape to the pitch: capture each point's ground anchor under
 *  `cfg` so it lives on the 3D surface from birth (warps with the camera, preserves
 *  its drawn shape in top view). A rectangle/oval is stored as the equivalent
 *  ground-pinned polyline (only a point-defined shape can warp). Non-shapes and
 *  points that miss the ground are returned unchanged. */
export function pinNewShape(el: BoardElement, cfg: PosedCamera): BoardElement {
  const cam = makeCalibratedCamera(cfg)
  if (el.type === 'polyline' || el.type === 'draw') {
    const g = polylineGround(el, cam)
    return g ? { ...el, ground: g } : el
  }
  if (el.type === 'rect' || el.type === 'ellipse') {
    const poly = (el.type === 'rect' ? rectToPolyline(el) : ellipseToPolyline(el)) as PolylineElement
    const g = polylineGround(poly, cam)
    // Only convert when it can actually be pinned (on the pitch); off-pitch it stays
    // an editable rectangle/oval.
    return g ? { ...poly, ground: g } : el
  }
  return el
}

/** The ground-plane translation (metres, x/z) corresponding to dragging the cursor
 *  from `from` to `to` on the board under `cam` — the delta a 3D-surface drag moves
 *  a shape's footprint by. Null if either point doesn't hit the ground (off-pitch /
 *  above the horizon), so the caller can fall back to a flat 2D translate. */
export function groundDelta(cam: THREE.Camera, from: { x: number; y: number }, to: { x: number; y: number }): { dgx: number; dgz: number } | null {
  const g0 = boardToGround(from.x, from.y, cam)
  const g1 = boardToGround(to.x, to.y, cam)
  if (!g0 || !g1) return null
  return { dgx: g1.x - g0.x, dgz: g1.z - g0.z }
}

/** Move a shape by translating its GROUND footprint by (dgx, dgz) metres and
 *  reprojecting through `cam` — the 3D-surface drag. A rectangle/oval comes back as
 *  the equivalent pitch-pinned polyline (only a point-defined shape can warp), so
 *  its footprint stays a true rectangle in top view while it deforms in perspective.
 *  Returns null for shapes we don't 3D-move here or when a point leaves the ground,
 *  so the caller falls back to a flat 2D translate. */
export function groundMoveElement(el: BoardElement, cam: THREE.Camera, dgx: number, dgz: number): BoardElement | null {
  const movePoly = <T extends PathElement>(poly: T): T | null => {
    const g = polylineGround(poly, cam)
    if (!g) return null
    const ground = g.map(([x, z]) => [x + dgx, z + dgz] as [number, number])
    const points = ground.map(([x, z]) => projectGround(cam, x, z))
    return { ...poly, points, ground, transform: { ...poly.transform, x: 0, y: 0, rotate: 0, scale: 1 } }
  }
  if (el.type === 'polyline' || el.type === 'draw') return movePoly(el)
  if (el.type === 'rect' || el.type === 'ellipse') return movePoly((el.type === 'rect' ? rectToPolyline(el) : ellipseToPolyline(el)) as PolylineElement)
  return null
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
    if ((el.type === 'polyline' || el.type === 'draw') && el.ground) {
      const pts: Array<[number, number]> = projectGroundPath(newCam, el.ground)
      changes.push({ id: el.id, before: { points: el.points, transform: el.transform }, after: { points: pts, transform: { ...el.transform, x: 0, y: 0, rotate: 0, scale: 1 } } })
      continue
    }
    if (!isGroundElement(el) || !el.ground) continue
    const [gx, gz] = el.ground
    const { cx, cy, h } = localCenter(el)
    let scale: number
    if (el.type === 'token' && el.sizeM != null) {
      // Absolute from the token's metric height: at its own depth (perspective) or
      // uniform (perspective off). Self-correcting — never gets stuck.
      scale = clamp(tokenBoardH(newCam, el.sizeM, [gx, gz], tokenPerspective) / (h || 1), 0.05, 30)
    } else if (el.sizeM != null) {
      // Figure: always perspective-sized from its metric height.
      scale = clamp((el.sizeM * groundPPM(newCam, gx, gz)) / (h || 1), 0.05, 30)
    } else if (el.type === 'token' && !tokenPerspective) {
      scale = el.transform.scale // legacy (no sizeM): keep constant when off
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

/** Re-size all tokens at the CURRENT camera for the given prefs — used when a
 *  token preference is toggled (not a camera move), so tokens update at once:
 *  perspective on → each at its depth; off → uniform (pitch-centre depth); sync
 *  on → all share one metric size. Derives a token's ground/`sizeM` on the fly if
 *  it isn't pinned yet, keeps its feet on the ground, and skips no-op changes. */
export function tokenSizeChanges(elements: BoardElement[], cfg: PosedCamera, opts: { syncTokenSizes?: boolean; tokenPerspective?: boolean; refTokenId?: string }): ElementChange[] {
  const cam = makeCalibratedCamera(cfg)
  const tokens = elements.filter((e): e is GroundElement => e.type === 'token')
  if (!tokens.length) return []
  const perspective = opts.tokenPerspective !== false
  // A display toggle must NOT change physical size: prefer the reference token's
  // STORED metric height (invariant), deriving from its board size only if unset.
  const refTok = tokens.find((t) => t.id === opts.refTokenId) ?? tokens[0]
  const shared = opts.syncTokenSizes ? refTok.sizeM ?? sharedTokenSizeM(elements, cam, opts.refTokenId) : null
  const changes: ElementChange[] = []
  for (const t of tokens) {
    let g = t.ground
    if (!g) {
      const bc = bottomCenterBoard(t)
      const hit = boardToGround(bc.x, bc.y, cam)
      if (!hit) continue
      g = [hit.x, hit.z]
    }
    const { cx, cy, h } = localCenter(t)
    const m = shared ?? t.sizeM ?? (h * t.transform.scale) / groundPPM(cam, g[0], g[1])
    const scale = clamp(tokenBoardH(cam, m, g, perspective) / (h || 1), 0.05, 30)
    const [bcx, bcy] = projectGround(cam, g[0], g[1])
    const after = { transform: { ...t.transform, x: bcx - cx, y: bcy - cy - (h * scale) / 2, scale }, ground: g, sizeM: m }
    const t0 = t.transform
    const unchanged = Math.abs(scale - t0.scale) < 1e-4 && Math.abs(after.transform.x - t0.x) < 1e-2 && Math.abs(after.transform.y - t0.y) < 1e-2 && t.ground != null && t.sizeM != null
    if (unchanged) continue
    changes.push({ id: t.id, before: { transform: t0, ground: t.ground, sizeM: t.sizeM }, after })
  }
  return changes
}

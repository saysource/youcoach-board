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
import { type BoardElement, type PolylineElement, type DrawElement, type TokenElement, type TextElement, type ElementTransform, type ElementChange, type Operation, getLocalBounds, BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { makeCalibratedCamera, type PosedCamera } from './field-camera'
import { boardToGround, makeArrow3DCamera } from './arrow3d'
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

/** Remap free board points (e.g. movement-path anchors) from one field pose to
 *  another: each point keeps its spot on the grass. Points that miss the ground
 *  plane under the old pose stay where they are. */
export function reprojectBoardPoints(pts: Array<[number, number]>, before: PosedCamera, after: PosedCamera): Array<[number, number]> {
  const oldCam = makeCalibratedCamera(before)
  const newCam = makeCalibratedCamera(after)
  return pts.map(([bx, by]) => {
    const g = boardToGround(bx, by, oldCam)
    return g ? projectGround(newCam, g.x, g.z) : [bx, by]
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

/** The element's current box CENTER in board units (transform applied). TOKENS
 *  anchor here — the badge circle's center is the position the user perceives,
 *  and a center anchor is rotation-invariant (a bottom-center pin sits half a
 *  badge away in the CURRENT screen-down direction, so orbiting the camera
 *  would drift the visible circle across the pitch). Upright figures keep the
 *  bottom-center "standing" anchor (their feet ARE the position). */
export function centerBoard(el: GroundElement): { x: number; y: number } {
  const { cx, cy } = localCenter(el)
  return { x: cx + el.transform.x, y: cy + el.transform.y }
}

/** The board point a ground element's pin derives from: center for tokens,
 *  bottom-center (feet) for figures. */
function anchorBoard(el: GroundElement): { x: number; y: number } {
  return el.type === 'token' ? centerBoard(el) : bottomCenterBoard(el)
}

/** A pitch-pinned 3D text: written on the field surface, anchored by its box centre. */
export function isText3d(el: BoardElement): el is TextElement {
  return el.type === 'text' && el.text3d === true
}

/** A text element's box CENTRE in board units (transform translate applied). 3D text
 *  keeps scale 1, so this is the anchor we pin to the pitch. */
export function textCenterBoard(el: TextElement): { x: number; y: number } {
  return { x: el.x + el.width / 2 + el.transform.x, y: el.y + el.height / 2 + el.transform.y }
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
    const bc = anchorBoard(el)
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

/** Seed for background.objectScale on a legacy 2D background: the multiplier at
 *  which a real-size standing player (1.8 m) reads about as tall on the board as
 *  a 2D player figure sized by the field's catalog `scale` (longest side =
 *  boardWidth/10 · figureScale). Measured with a vertical yard-stick — it's the
 *  player's HEIGHT we're matching, not a ground footprint — at the posed field
 *  camera's look-at spot (or the fixed default camera's centre when the legacy
 *  field has no calibration). */
const PLAYER_HEIGHT_M = 1.8
export function legacyObjectScale(cfg: PosedCamera | null, figureScale: number): number {
  const cam = cfg ? makeCalibratedCamera(cfg) : makeArrow3DCamera()
  const [gx, gz] = cfg ? [cfg.target[0], cfg.target[2]] : [0, 0]
  const foot = new THREE.Vector3(gx, 0, gz).project(cam)
  const head = new THREE.Vector3(gx, PLAYER_HEIGHT_M, gz).project(cam)
  const heightPx = (Math.abs(head.y - foot.y) * BOARD_HEIGHT) / 2
  const targetPx = (BOARD_WIDTH / 10) * figureScale
  return clamp(Math.round((targetPx / (heightPx || 1)) * 10) / 10, 0.1, 8)
}

/** On-board height (px) for a token of metric diameter `m` (metres) at ground `g`:
 *  ALWAYS sized at its own depth (near tokens read bigger, follows the camera) —
 *  tokens are circular objects always facing the camera. */
export function tokenBoardH(cam: THREE.Camera, m: number, g: [number, number]): number {
  return m * groundPPM(cam, g[0], g[1])
}

/** Default global token size: 4 m DIAMETER (2 m radius). A token box is square
 *  (width = height = diameter), and `sizeM` is that metric diameter. The properties
 *  slider maps 2 m … 10 m; every token shares one size. */
export const TOKEN_DEFAULT_SIZE_M = 4

/** Pin a freshly-stamped token to the pitch at the global size `sizeM` (metres):
 *  capture its ground anchor + set `sizeM` and the on-board `scale` so it renders
 *  at that metric size immediately. Returns it unchanged if its drop point misses
 *  the pitch. */
export function pinNewToken(el: TokenElement, cfg: PosedCamera, sizeM: number): TokenElement {
  const cam = makeCalibratedCamera(cfg)
  const bc = centerBoard(el)
  const g = boardToGround(bc.x, bc.y, cam)
  if (!g) return el
  const h = localCenter(el).h
  const scale = clamp(tokenBoardH(cam, sizeM, [g.x, g.z]) / (h || 1), 0.05, 30)
  return { ...el, ground: [g.x, g.z], sizeM, transform: { ...el.transform, scale } }
}

/** The transform placing a standing element (figure/token) with its feet at ground
 *  (gx, gz) under `cam`, sized from its metric size at THAT depth — so it grows/
 *  shrinks with perspective as it moves nearer/further. Same formula reprojection
 *  uses on a camera move, so a drag and an orbit size a token identically. */
export function standingTransform(el: GroundElement, cam: THREE.Camera, gx: number, gz: number): ElementTransform {
  const { cx, cy, h } = localCenter(el)
  let scale: number
  if (el.type === 'token') scale = clamp(tokenBoardH(cam, el.sizeM ?? TOKEN_DEFAULT_SIZE_M, [gx, gz]) / (h || 1), 0.05, 30)
  else if (el.sizeM != null) scale = clamp((el.sizeM * groundPPM(cam, gx, gz)) / (h || 1), 0.05, 30)
  else scale = el.transform.scale
  const [bcx, bcy] = projectGround(cam, gx, gz)
  // Tokens center ON the anchor; figures stand on it (feet at the ground point).
  return { ...el.transform, x: bcx - cx, y: bcy - cy - (el.type === 'token' ? 0 : (h * scale) / 2), scale }
}

/** Pin a batch of tokens to the pitch at given metric ground spots (metres), all at
 *  the shared global size `sizeM`, under the field camera `cfg` — one camera build
 *  for the whole set. Each returned token carries its `ground` anchor and the
 *  perspective transform placing its feet there. Used to drop a game-system
 *  formation's worth of tokens at once. */
export function pinTokensAtGround(tokens: TokenElement[], grounds: Array<[number, number]>, cfg: PosedCamera, sizeM: number): TokenElement[] {
  const cam = makeCalibratedCamera(cfg)
  return tokens.map((el, i) => {
    const [gx, gz] = grounds[i]
    const sized = { ...el, sizeM }
    return { ...sized, ground: [gx, gz] as [number, number], transform: standingTransform(sized, cam, gx, gz) }
  })
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
/** Prepare pins on entering Edit-Background (a single undoable step, run BEFORE
 *  the field-edit transaction). For every pinnable element it (re)derives the
 *  ground anchor from the element's CURRENT board placement through `cfg` — which
 *  heals any staleness from ordinary fixed-camera edits — and, because only a
 *  polygon can warp, CONVERTS each rectangle into an equivalent closed polyline
 *  first. Tokens keep their shared global `sizeM` (all tokens are one size).
 *  Returns:
 *   - `remove` + `add` ops (same index, id preserved) per rectangle, the added
 *     polyline already carrying its per-point ground, and
 *   - one `update` op setting `ground`/`sizeM` on standing elements whose anchor
 *     changed (already-synced elements are skipped, so it's idempotent). */
export function buildPinOps(elements: BoardElement[], cfg: PosedCamera): Operation[] {
  const cam = makeCalibratedCamera(cfg)
  const ops: Operation[] = []
  const updates: ElementChange[] = []
  elements.forEach((el, index) => {
    if (el.type === 'figure' || el.type === 'token') {
      const bc = anchorBoard(el)
      const g = boardToGround(bc.x, bc.y, cam)
      if (!g) return
      const next: [number, number] = [g.x, g.z]
      // Capture the element's real-world size (metres) at its spot, so its size can
      // be derived absolutely under any camera. Tokens carry the shared global size
      // (all one size); figures derive from their drawn size.
      const sizeM =
        el.type === 'token'
          ? (el.sizeM ?? TOKEN_DEFAULT_SIZE_M)
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
    } else if (isText3d(el)) {
      const c = textCenterBoard(el)
      const g = boardToGround(c.x, c.y, cam)
      if (!g) return
      const next: [number, number] = [g.x, g.z]
      if (el.ground && closePt(el.ground, next)) return
      updates.push({ id: el.id, before: { ground: el.ground }, after: { ground: next } })
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
      const bc = anchorBoard(el)
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
    if (isText3d(el) && !el.ground) {
      const c = textCenterBoard(el)
      const g = boardToGround(c.x, c.y, cam)
      return g ? { ...el, ground: [g.x, g.z] as [number, number] } : el
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
export function reprojectChanges(elements: BoardElement[], before: PosedCamera, after: PosedCamera): ElementChange[] {
  const oldCam = makeCalibratedCamera(before)
  const newCam = makeCalibratedCamera(after)
  const changes: ElementChange[] = []
  for (const el of elements) {
    if ((el.type === 'polyline' || el.type === 'draw') && el.ground) {
      const pts: Array<[number, number]> = projectGroundPath(newCam, el.ground)
      changes.push({ id: el.id, before: { points: el.points, transform: el.transform }, after: { points: pts, transform: { ...el.transform, x: 0, y: 0, rotate: 0, scale: 1 } } })
      continue
    }
    if (isText3d(el) && el.ground) {
      // 3D text: keep its (invisible) selection box centred on the anchor — the
      // visible glyphs are drawn by the field overlay from `ground`. Translate only.
      const [tx, ty] = projectGround(newCam, el.ground[0], el.ground[1])
      const after = { ...el.transform, x: tx - (el.x + el.width / 2), y: ty - (el.y + el.height / 2), rotate: 0, scale: 1 }
      changes.push({ id: el.id, before: { transform: el.transform }, after: { transform: after } })
      continue
    }
    if (!isGroundElement(el) || !el.ground) continue
    const [gx, gz] = el.ground
    const { cx, cy, h } = localCenter(el)
    let scale: number
    if (el.type === 'token') {
      // A token is always its metric diameter at its own depth (perspective) —
      // self-correcting, never gets stuck. Older docs without `sizeM` fall to the
      // global default.
      scale = clamp(tokenBoardH(newCam, el.sizeM ?? TOKEN_DEFAULT_SIZE_M, [gx, gz]) / (h || 1), 0.05, 30)
    } else if (el.sizeM != null) {
      // Figure: always perspective-sized from its metric height.
      scale = clamp((el.sizeM * groundPPM(newCam, gx, gz)) / (h || 1), 0.05, 30)
    } else {
      const ratio = groundPPM(newCam, gx, gz) / groundPPM(oldCam, gx, gz)
      if (!Number.isFinite(ratio) || ratio <= 0) continue
      scale = clamp(el.transform.scale * ratio, 0.05, 30)
    }
    const [bcx, bcy] = projectGround(newCam, gx, gz)
    // Tokens center ON the anchor; figures stand on it.
    const after2 = { ...el.transform, x: bcx - cx, y: bcy - cy - (el.type === 'token' ? 0 : (h * scale) / 2), scale }
    changes.push({ id: el.id, before: { transform: el.transform }, after: { transform: after2 } })
  }
  return changes
}

/** Set EVERY token to the global metric diameter `sizeM` (metres) at the CURRENT
 *  camera — the properties size slider's batch update. All tokens become one size,
 *  perspective-scaled by their depth, feet kept on the ground. Derives a token's
 *  ground on the fly if it isn't pinned yet, and skips no-op changes. */
export function tokenSizeChanges(elements: BoardElement[], cfg: PosedCamera, sizeM: number): ElementChange[] {
  const cam = makeCalibratedCamera(cfg)
  const tokens = elements.filter((e): e is GroundElement => e.type === 'token')
  if (!tokens.length) return []
  const changes: ElementChange[] = []
  for (const t of tokens) {
    let g = t.ground
    if (!g) {
      const bc = centerBoard(t)
      const hit = boardToGround(bc.x, bc.y, cam)
      if (!hit) continue
      g = [hit.x, hit.z]
    }
    const { cx, cy, h } = localCenter(t)
    const scale = clamp(tokenBoardH(cam, sizeM, g) / (h || 1), 0.05, 30)
    const [bcx, bcy] = projectGround(cam, g[0], g[1])
    const after = { transform: { ...t.transform, x: bcx - cx, y: bcy - cy, scale }, ground: g, sizeM }
    const t0 = t.transform
    const unchanged = Math.abs(scale - t0.scale) < 1e-4 && Math.abs(after.transform.x - t0.x) < 1e-2 && Math.abs(after.transform.y - t0.y) < 1e-2 && t.ground != null && t.sizeM === sizeM
    if (unchanged) continue
    changes.push({ id: t.id, before: { transform: t0, ground: t.ground, sizeM: t.sizeM }, after })
  }
  return changes
}

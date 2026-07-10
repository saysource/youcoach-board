// Movement paths between animation frames (specs/animation.md Phase 2).
//
// A path describes how an element's CENTRE travels from its previous-frame
// position into the current frame: a Catmull-Rom spline through
// [prevCenter, ...storedMidPoints, curCenter]. Only the mid points are stored
// (frame.paths[id]); the endpoints derive from the element positions, so
// moving an element keeps its path attached. Straight moves store nothing.

import { type BoardElement, getLocalBounds } from '@youcoach-board/core'

export type PathPoint = [number, number]

/** Whether a movement path applies to this element: anything placed via the 2D
 *  transform. 3D-ground elements (object3d, arrow3d) move in metres and keep
 *  plain linear interpolation. */
export function pathable(el: BoardElement): boolean {
  return el.type !== 'object3d' && el.type !== 'arrow3d'
}

/** The element's board-space centre: local-bounds centre + transform translate
 *  (scale/rotate act ABOUT the centre, so they don't displace it). */
export function elementCenter(el: BoardElement): PathPoint | null {
  if (!pathable(el)) return null
  const lb = getLocalBounds(el)
  const t = (el as Extract<BoardElement, { transform: { x: number; y: number } }>).transform
  return [lb.x + lb.width / 2 + t.x, lb.y + lb.height / 2 + t.y]
}

function catmullRom(p0: PathPoint, p1: PathPoint, p2: PathPoint, p3: PathPoint, t: number): PathPoint {
  const t2 = t * t
  const t3 = t2 * t
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * (b - c) + d - a) * t3)
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]
}

/** Dense polyline through the control points (endpoints included). With two
 *  controls this is the straight segment; more run a Catmull-Rom through all. */
export function samplePath(ctrl: PathPoint[], perSegment = 16): PathPoint[] {
  if (ctrl.length < 2) return ctrl.slice()
  if (ctrl.length === 2) return [ctrl[0], ctrl[1]]
  const out: PathPoint[] = [ctrl[0]]
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[i - 1] ?? ctrl[i]
    const p3 = ctrl[i + 2] ?? ctrl[i + 1]
    for (let s = 1; s <= perSegment; s++) out.push(catmullRom(p0, ctrl[i], ctrl[i + 1], p3, s / perSegment))
  }
  return out
}

/** Point at fraction `t` (0‥1) of the path's ARC LENGTH — constant travel speed
 *  along the curve, however unevenly the control points are spaced. */
export function pointAlongPath(ctrl: PathPoint[], t: number): PathPoint {
  const pts = samplePath(ctrl)
  if (pts.length === 0) return [0, 0]
  if (pts.length === 1 || t <= 0) return pts[0]
  if (t >= 1) return pts[pts.length - 1]
  const lens: number[] = [0]
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const target = t * lens[lens.length - 1]
  let i = 1
  while (i < lens.length - 1 && lens[i] < target) i++
  const span = lens[i] - lens[i - 1] || 1
  const f = (target - lens[i - 1]) / span
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]
}

/** Index (into the STORED mid points) at which to insert a new anchor for a
 *  click at `p`: after the nearest segment of the control polygon [A,...mids,B]. */
export function insertIndexFor(a: PathPoint, mids: PathPoint[], b: PathPoint, p: PathPoint): number {
  const ctrl = [a, ...mids, b]
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < ctrl.length - 1; i++) {
    const d = distToSegment(p, ctrl[i], ctrl[i + 1])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best // insert as mids[best]
}

function distToSegment(p: PathPoint, a: PathPoint, b: PathPoint): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

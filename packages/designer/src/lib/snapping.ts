// Excalidraw-style "snap to objects": when moving a selection, it magnetically
// snaps to other elements. Two independent kinds per axis:
//   • alignment — a notable point (corner / centre / ellipse axis-extreme) lines
//     up with another element's notable point (drawn as a line with a small × on
//     each point that triggered it);
//   • equidistance — the box centres between two elements so the gaps on both
//     sides are equal (drawn as two equal segments, each with a ‖ tick).
// The X and Y axes snap independently; per axis the nearer of the two wins. Pure
// geometry (board units): the caller supplies each element's notable points +
// AABB and the on-screen threshold in board units, applies the returned offset to
// its move delta, and draws the guides.

import type { Box } from '@youcoach-board/core'

export interface SnapMark {
  x: number
  y: number
}

/** An element as the snapper sees it: its notable points (for alignment) and its
 *  axis-aligned bounding box (for equidistance). */
export interface SnapElement {
  points: SnapMark[]
  box: Box
}

export interface SnapLine {
  x1: number
  y1: number
  x2: number
  y2: number
  /** The notable points that triggered this line (draw a small × on each). */
  marks: SnapMark[]
}

/** One of the two equal gaps: an axis-aligned segment, ‖-ticked at its middle. */
export interface GapSegment {
  x1: number
  y1: number
  x2: number
  y2: number
  axis: 'x' | 'y'
}

export interface SnapResult {
  /** Offset to add to the (already-clamped) move delta so the snap engages. */
  dx: number
  dy: number
  /** Alignment guide lines. */
  guides: SnapLine[]
  /** Equal-distance gap segments. */
  gaps: GapSegment[]
}

const EMPTY: SnapResult = { dx: 0, dy: 0, guides: [], gaps: [] }

// A hair of tolerance absorbs FP drift when testing coincidence.
const COINCIDE = 0.5

// Smallest offset (target − moving) lining any moving point up with any target
// point on the given axis, within `threshold`; null when nothing is close enough.
function alignOffset(moving: SnapMark[], targets: SnapMark[], axis: 'x' | 'y', threshold: number): number | null {
  let best: number | null = null
  let bestAbs = threshold + 1
  for (const m of moving) {
    for (const t of targets) {
      const diff = t[axis] - m[axis]
      const abs = Math.abs(diff)
      if (abs <= threshold && abs < bestAbs) {
        bestAbs = abs
        best = diff
      }
    }
  }
  return best
}

// Axis accessors so the gap logic is written once for both orientations.
interface Axis {
  lo: (b: Box) => number // near edge on the main axis
  hi: (b: Box) => number // far edge on the main axis
  clo: (b: Box) => number // near edge on the cross axis
  chi: (b: Box) => number // far edge on the cross axis
}
const X_AXIS: Axis = { lo: (b) => b.x, hi: (b) => b.x + b.width, clo: (b) => b.y, chi: (b) => b.y + b.height }
const Y_AXIS: Axis = { lo: (b) => b.y, hi: (b) => b.y + b.height, clo: (b) => b.x, chi: (b) => b.x + b.width }

interface GapHit {
  offset: number
  before: Box // element on the low side
  after: Box // element on the high side
}

// The smallest offset that centres `moving` between a pair of elements straddling
// it on `ax` (so both gaps become equal), if within `threshold`. Both elements
// must overlap the moving box on the cross axis and leave room for it.
function centerGap(moving: Box, targets: Box[], threshold: number, ax: Axis): GapHit | null {
  const size = ax.hi(moving) - ax.lo(moving)
  const overlaps = (t: Box) => ax.clo(t) < ax.chi(moving) && ax.chi(t) > ax.clo(moving)
  const befores = targets.filter((t) => ax.hi(t) <= ax.lo(moving) + COINCIDE && overlaps(t))
  const afters = targets.filter((t) => ax.lo(t) >= ax.hi(moving) - COINCIDE && overlaps(t))
  const center = (ax.lo(moving) + ax.hi(moving)) / 2
  let best: GapHit | null = null
  let bestAbs = threshold + 1
  for (const before of befores) {
    for (const after of afters) {
      if (ax.lo(after) - ax.hi(before) < size) continue // moving box wouldn't fit
      const desired = (ax.hi(before) + ax.lo(after)) / 2
      const offset = desired - center
      const abs = Math.abs(offset)
      if (abs <= threshold && abs < bestAbs) {
        bestAbs = abs
        best = { offset, before, after }
      }
    }
  }
  return best
}

// The two equal gap segments (for rendering), drawn at the centre of the band the
// three boxes share on the cross axis, using the already-snapped moving box.
function gapSegments(snapped: Box, hit: GapHit, ax: Axis, axis: 'x' | 'y'): GapSegment[] {
  const cross = (Math.max(ax.clo(hit.before), ax.clo(snapped), ax.clo(hit.after)) + Math.min(ax.chi(hit.before), ax.chi(snapped), ax.chi(hit.after))) / 2
  const seg = (a: number, b: number): GapSegment =>
    axis === 'x' ? { x1: a, y1: cross, x2: b, y2: cross, axis } : { x1: cross, y1: a, x2: cross, y2: b, axis }
  return [seg(ax.hi(hit.before), ax.lo(snapped)), seg(ax.hi(snapped), ax.lo(hit.after))]
}

// Alignment guides along one axis: one line per snapped-point coordinate that
// coincides with a target point, threading every point (moving + target) on it.
function alignGuides(movingPts: SnapMark[], targetPts: SnapMark[], axis: 'x' | 'y'): SnapLine[] {
  const cross: 'x' | 'y' = axis === 'x' ? 'y' : 'x'
  const out: SnapLine[] = []
  const done = new Set<number>()
  for (const mp of movingPts) {
    const key = Math.round(mp[axis] * 100)
    if (done.has(key)) continue
    const tp = targetPts.filter((p) => Math.abs(p[axis] - mp[axis]) < COINCIDE)
    if (tp.length === 0) continue
    done.add(key)
    const marks = [...movingPts.filter((p) => Math.abs(p[axis] - mp[axis]) < COINCIDE), ...tp]
    const c = marks.map((p) => p[cross])
    const lo = Math.min(...c)
    const hi = Math.max(...c)
    out.push(axis === 'x' ? { x1: mp.x, y1: lo, x2: mp.x, y2: hi, marks } : { x1: lo, y1: mp.y, x2: hi, y2: mp.y, marks })
  }
  return out
}

const shiftPts = (pts: SnapMark[], dx: number, dy: number): SnapMark[] => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))

// Compute the snap offset + guides for the `moving` element (at its pre-snap
// position) against the other elements `targets`. Per axis, alignment and
// equidistance compete; the nearer offset wins.
export function computeSnap(moving: SnapElement, targets: SnapElement[], threshold: number): SnapResult {
  if (targets.length === 0 || threshold <= 0) return EMPTY

  const targetPts = targets.flatMap((t) => t.points)
  const targetBoxes = targets.map((t) => t.box)
  const alignX = alignOffset(moving.points, targetPts, 'x', threshold)
  const alignY = alignOffset(moving.points, targetPts, 'y', threshold)
  const gapX = centerGap(moving.box, targetBoxes, threshold, X_AXIS)
  const gapY = centerGap(moving.box, targetBoxes, threshold, Y_AXIS)

  const pickX = pickAxis(alignX, gapX)
  const pickY = pickAxis(alignY, gapY)
  if (!pickX && !pickY) return EMPTY

  const dx = pickX?.offset ?? 0
  const dy = pickY?.offset ?? 0
  const snappedPts = shiftPts(moving.points, dx, dy)
  const snappedBox: Box = { x: moving.box.x + dx, y: moving.box.y + dy, width: moving.box.width, height: moving.box.height }
  const guides: SnapLine[] = []
  const gaps: GapSegment[] = []

  if (pickX?.kind === 'align') guides.push(...alignGuides(snappedPts, targetPts, 'x'))
  else if (pickX?.kind === 'gap' && gapX) gaps.push(...gapSegments(snappedBox, gapX, X_AXIS, 'x'))

  if (pickY?.kind === 'align') guides.push(...alignGuides(snappedPts, targetPts, 'y'))
  else if (pickY?.kind === 'gap' && gapY) gaps.push(...gapSegments(snappedBox, gapY, Y_AXIS, 'y'))

  return { dx, dy, guides, gaps }
}

// Choose the nearer of an alignment offset and a gap hit for one axis.
function pickAxis(align: number | null, gap: GapHit | null): { offset: number; kind: 'align' | 'gap' } | null {
  if (align != null && (!gap || Math.abs(align) <= Math.abs(gap.offset))) return { offset: align, kind: 'align' }
  if (gap) return { offset: gap.offset, kind: 'gap' }
  return null
}

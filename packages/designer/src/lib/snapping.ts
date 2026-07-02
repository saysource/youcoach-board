// Excalidraw-style "snap to objects": when moving a selection, its bounding box
// magnetically snaps to other elements. Two independent kinds per axis:
//   • alignment — an edge/centre lines up with another element's edge/centre
//     (drawn as a line with a small × on each notable point);
//   • equidistance — the box centres between two elements so the gaps on both
//     sides are equal (drawn as two equal segments, each with a ‖ tick).
// The X and Y axes snap independently; per axis the nearer of the two wins. Pure
// geometry (board units): the caller supplies AABBs and the on-screen threshold in
// board units, applies the returned offset to its move delta, and draws the guides.

import type { Box } from '@youcoach-board/core'

export interface SnapMark {
  x: number
  y: number
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

// The three notable coordinates of a box on each axis: [start edge, center, end].
function xAnchors(b: Box): number[] {
  return [b.x, b.x + b.width / 2, b.x + b.width]
}
function yAnchors(b: Box): number[] {
  return [b.y, b.y + b.height / 2, b.y + b.height]
}

// Smallest offset (target − moving) that lines any moving anchor up with any
// target anchor within `threshold`; null when nothing is close enough.
function alignOffset(moving: number[], targets: Box[], anchorsOf: (b: Box) => number[], threshold: number): number | null {
  let best: number | null = null
  let bestAbs = threshold + 1
  for (const m of moving) {
    for (const t of targets) {
      for (const a of anchorsOf(t)) {
        const diff = a - m
        const abs = Math.abs(diff)
        if (abs <= threshold && abs < bestAbs) {
          bestAbs = abs
          best = diff
        }
      }
    }
  }
  return best
}

// The notable point(s) where a vertical line at x=`mx` meets box `b`: its centre
// (a single point — the line then stops at the centre) if that's what aligned,
// otherwise the two corners on the meeting edge.
function marksOnVertical(b: Box, mx: number): SnapMark[] {
  const cx = b.x + b.width / 2
  if (Math.abs(cx - mx) < COINCIDE) return [{ x: mx, y: b.y + b.height / 2 }]
  return [{ x: mx, y: b.y }, { x: mx, y: b.y + b.height }]
}
function marksOnHorizontal(b: Box, my: number): SnapMark[] {
  const cy = b.y + b.height / 2
  if (Math.abs(cy - my) < COINCIDE) return [{ x: b.x + b.width / 2, y: my }]
  return [{ x: b.x, y: my }, { x: b.x + b.width, y: my }]
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

// Compute the snap offset + guides for `moving` (the selection AABB at its pre-snap
// position) against the other elements' AABBs `targets`. Per axis, alignment and
// equidistance compete; the nearer offset wins.
export function computeSnap(moving: Box, targets: Box[], threshold: number): SnapResult {
  if (targets.length === 0 || threshold <= 0) return EMPTY

  const alignX = alignOffset(xAnchors(moving), targets, xAnchors, threshold)
  const alignY = alignOffset(yAnchors(moving), targets, yAnchors, threshold)
  const gapX = centerGap(moving, targets, threshold, X_AXIS)
  const gapY = centerGap(moving, targets, threshold, Y_AXIS)

  // Per axis, pick alignment or gap by the smaller magnitude.
  const pickX = pickAxis(alignX, gapX)
  const pickY = pickAxis(alignY, gapY)
  if (!pickX && !pickY) return EMPTY

  const dx = pickX?.offset ?? 0
  const dy = pickY?.offset ?? 0
  const snapped: Box = { x: moving.x + dx, y: moving.y + dy, width: moving.width, height: moving.height }
  const guides: SnapLine[] = []
  const gaps: GapSegment[] = []

  if (pickX?.kind === 'align') {
    for (const mx of xAnchors(snapped)) {
      const aligned = targets.filter((t) => xAnchors(t).some((a) => Math.abs(a - mx) < COINCIDE))
      if (aligned.length === 0) continue
      const marks = [snapped, ...aligned].flatMap((b) => marksOnVertical(b, mx))
      const ys = marks.map((m) => m.y)
      guides.push({ x1: mx, y1: Math.min(...ys), x2: mx, y2: Math.max(...ys), marks })
    }
  } else if (pickX?.kind === 'gap' && gapX) {
    gaps.push(...gapSegments(snapped, gapX, X_AXIS, 'x'))
  }

  if (pickY?.kind === 'align') {
    for (const my of yAnchors(snapped)) {
      const aligned = targets.filter((t) => yAnchors(t).some((a) => Math.abs(a - my) < COINCIDE))
      if (aligned.length === 0) continue
      const marks = [snapped, ...aligned].flatMap((b) => marksOnHorizontal(b, my))
      const xs = marks.map((m) => m.x)
      guides.push({ x1: Math.min(...xs), y1: my, x2: Math.max(...xs), y2: my, marks })
    }
  } else if (pickY?.kind === 'gap' && gapY) {
    gaps.push(...gapSegments(snapped, gapY, Y_AXIS, 'y'))
  }

  return { dx, dy, guides, gaps }
}

// Choose the nearer of an alignment offset and a gap hit for one axis.
function pickAxis(align: number | null, gap: GapHit | null): { offset: number; kind: 'align' | 'gap' } | null {
  if (align != null && (!gap || Math.abs(align) <= Math.abs(gap.offset))) return { offset: align, kind: 'align' }
  if (gap) return { offset: gap.offset, kind: 'gap' }
  return null
}

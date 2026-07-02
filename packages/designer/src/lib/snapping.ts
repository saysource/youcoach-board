// Excalidraw-style "snap to objects": when moving a selection, its bounding box
// is magnetically aligned to other elements' notable coordinates — the two edges
// and the center on each axis. The X and Y axes snap independently. Pure geometry
// (board units); the caller supplies AABBs and the on-screen threshold in board
// units, applies the returned offset to its move delta, and draws the guides.

import type { Box } from '@youcoach-board/core'

export interface SnapLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface SnapResult {
  /** Offset to add to the (already-clamped) move delta so an anchor lines up. */
  dx: number
  dy: number
  /** Alignment guide lines to draw, in board coordinates. */
  guides: SnapLine[]
}

const EMPTY: SnapResult = { dx: 0, dy: 0, guides: [] }

// The three notable coordinates of a box on each axis: [start edge, center, end].
function xAnchors(b: Box): number[] {
  return [b.x, b.x + b.width / 2, b.x + b.width]
}
function yAnchors(b: Box): number[] {
  return [b.y, b.y + b.height / 2, b.y + b.height]
}

// Smallest offset (target − moving) that lines any moving anchor up with any
// target anchor within `threshold`; null when nothing is close enough.
function bestOffset(moving: number[], targets: Box[], anchorsOf: (b: Box) => number[], threshold: number): number | null {
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

// Whether a target has an anchor coinciding with `v` (after snapping), so it
// should be threaded by the guide line. A hair of tolerance absorbs FP drift.
const COINCIDE = 0.5

// Compute the snap offset + guide lines for `moving` (the selection AABB at its
// pre-snap position) against the other elements' AABBs `targets`.
export function computeSnap(moving: Box, targets: Box[], threshold: number): SnapResult {
  if (targets.length === 0 || threshold <= 0) return EMPTY

  const ox = bestOffset(xAnchors(moving), targets, xAnchors, threshold)
  const oy = bestOffset(yAnchors(moving), targets, yAnchors, threshold)
  if (ox == null && oy == null) return EMPTY

  const dx = ox ?? 0
  const dy = oy ?? 0
  const snapped: Box = { x: moving.x + dx, y: moving.y + dy, width: moving.width, height: moving.height }
  const guides: SnapLine[] = []

  // Vertical guide(s): for each snapped x-anchor that now coincides with a target
  // anchor, span the line across every box sharing it (the moving box included).
  if (ox != null) {
    for (const mx of xAnchors(snapped)) {
      const aligned = targets.filter((t) => xAnchors(t).some((a) => Math.abs(a - mx) < COINCIDE))
      if (aligned.length === 0) continue
      let top = snapped.y
      let bottom = snapped.y + snapped.height
      for (const t of aligned) {
        top = Math.min(top, t.y)
        bottom = Math.max(bottom, t.y + t.height)
      }
      guides.push({ x1: mx, y1: top, x2: mx, y2: bottom })
    }
  }
  // Horizontal guide(s).
  if (oy != null) {
    for (const my of yAnchors(snapped)) {
      const aligned = targets.filter((t) => yAnchors(t).some((a) => Math.abs(a - my) < COINCIDE))
      if (aligned.length === 0) continue
      let left = snapped.x
      let right = snapped.x + snapped.width
      for (const t of aligned) {
        left = Math.min(left, t.x)
        right = Math.max(right, t.x + t.width)
      }
      guides.push({ x1: left, y1: my, x2: right, y2: my })
    }
  }

  return { dx, dy, guides }
}

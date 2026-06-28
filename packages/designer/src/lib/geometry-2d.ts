// 2D transform math for selection handles (resize / rotate / line endpoints).
//
// An element's on-screen geometry is its local box transformed by its
// `transform`: scale about the local center, then rotate about the local
// center, then translate. These helpers map points between LOCAL (geometry)
// space and BOARD space, and compute resize/rotate results that keep the
// expected anchor fixed even when the element is rotated.

import { getLocalBounds, type Box, type BoardElement, type ElementTransform } from '@youcoach-board/core'

export interface Pt {
  x: number
  y: number
}

type Xform = Pick<ElementTransform, 'x' | 'y' | 'rotate' | 'scale'>

export function boxCenter(b: Box): Pt {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** Rotate a vector about the origin by `deg` (screen convention: y down). */
export function rotateDeg(p: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

/** Map a LOCAL point (geometry space) to BOARD space via the element transform. */
export function elementToBoard(local: Pt, box: Box, t: Xform): Pt {
  const c = boxCenter(box)
  const v = rotateDeg({ x: (local.x - c.x) * t.scale, y: (local.y - c.y) * t.scale }, t.rotate)
  return { x: v.x + c.x + t.x, y: v.y + c.y + t.y }
}

/** Inverse of {@link elementToBoard}: BOARD point → LOCAL point. */
export function boardToElement(board: Pt, box: Box, t: Xform): Pt {
  const c = boxCenter(box)
  const v = rotateDeg({ x: board.x - c.x - t.x, y: board.y - c.y - t.y }, -t.rotate)
  return { x: v.x / t.scale + c.x, y: v.y / t.scale + c.y }
}

export type CornerId = 'nw' | 'ne' | 'se' | 'sw'

export function localCorners(b: Box): Record<CornerId, Pt> {
  return {
    nw: { x: b.x, y: b.y },
    ne: { x: b.x + b.width, y: b.y },
    se: { x: b.x + b.width, y: b.y + b.height },
    sw: { x: b.x, y: b.y + b.height },
  }
}

/** The element's 4 bounding-box corners in BOARD space (transform applied),
 *  order nw, ne, se, sw — for drawing the rotated selection outline / hit-area. */
export function boardCorners(element: BoardElement): Pt[] {
  const box = getLocalBounds(element)
  const t = element.transform
  const c = localCorners(box)
  return [
    elementToBoard(c.nw, box, t),
    elementToBoard(c.ne, box, t),
    elementToBoard(c.se, box, t),
    elementToBoard(c.sw, box, t),
  ]
}

const OPPOSITE: Record<CornerId, CornerId> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }

export interface ResizeOptions {
  /** Alt/Option — "specular" resize: symmetric about the center (the opposite
   *  side mirrors the drag) instead of pinning the opposite corner. */
  fromCenter?: boolean
  /** Shift — lock the original aspect ratio. */
  proportional?: boolean
}

/**
 * Resize by dragging `handle` to `pointer` (board coords). Works while rotated.
 * Default: the opposite corner stays pinned (a compensating translate is
 * derived). With `fromCenter`, the center stays pinned and both sides mirror.
 * With `proportional`, the original aspect ratio is preserved.
 */
export function computeResize(
  box0: Box,
  t0: ElementTransform,
  handle: CornerId,
  pointer: Pt,
  minSize: number,
  opts: ResizeOptions = {},
): { box: Box; transform: ElementTransform } {
  if (opts.fromCenter) {
    // Symmetric: center is the fixed pivot, half-extents follow the pointer.
    const ctr = boxCenter(box0)
    const ctrBoard = elementToBoard(ctr, box0, t0)
    const dl = rotateDeg({ x: pointer.x - ctrBoard.x, y: pointer.y - ctrBoard.y }, -t0.rotate)
    let halfW = Math.abs(dl.x) / t0.scale
    let halfH = Math.abs(dl.y) / t0.scale
    if (opts.proportional) {
      const s = Math.max(halfW / (box0.width / 2 || 1), halfH / (box0.height / 2 || 1))
      halfW = (box0.width / 2) * s
      halfH = (box0.height / 2) * s
    }
    const width = Math.max(minSize, halfW * 2)
    const height = Math.max(minSize, halfH * 2)
    // Center stays fixed → translate is unchanged; box is recentered on `ctr`.
    return { box: { x: ctr.x - width / 2, y: ctr.y - height / 2, width, height }, transform: { ...t0 } }
  }

  const anchorLocal = localCorners(box0)[OPPOSITE[handle]]
  const anchorBoard = elementToBoard(anchorLocal, box0, t0)

  // Pointer offset from the (fixed) anchor, in the element's local orientation.
  const dl = rotateDeg({ x: pointer.x - anchorBoard.x, y: pointer.y - anchorBoard.y }, -t0.rotate)
  const sx = dl.x / t0.scale
  const sy = dl.y / t0.scale

  // Positive magnitudes (the per-handle placement below restores direction;
  // dragging "inward" past the anchor clamps to minSize rather than flipping).
  let width = Math.max(minSize, handle === 'nw' || handle === 'sw' ? -sx : sx)
  let height = Math.max(minSize, handle === 'nw' || handle === 'ne' ? -sy : sy)
  if (opts.proportional) {
    const s = Math.max(width / (box0.width || 1), height / (box0.height || 1))
    width = box0.width * s
    height = box0.height * s
  }

  let x: number
  let y: number
  if (handle === 'se') {
    x = anchorLocal.x
    y = anchorLocal.y
  } else if (handle === 'nw') {
    x = anchorLocal.x - width
    y = anchorLocal.y - height
  } else if (handle === 'ne') {
    x = anchorLocal.x
    y = anchorLocal.y - height
  } else {
    // sw
    x = anchorLocal.x - width
    y = anchorLocal.y
  }

  const box: Box = { x, y, width, height }
  const c = boxCenter(box)
  // Choose translate so the anchor corner still maps to anchorBoard.
  const rotated = rotateDeg({ x: (anchorLocal.x - c.x) * t0.scale, y: (anchorLocal.y - c.y) * t0.scale }, t0.rotate)
  return {
    box,
    transform: { ...t0, x: anchorBoard.x - c.x - rotated.x, y: anchorBoard.y - c.y - rotated.y },
  }
}

/** Rotation (deg, normalized to (-180,180]) so the top handle points at `pointer`.
 *  `snap` magnets to 15° increments (… 0 / 15 / 30 / 45 / …). */
export function rotationFor(box0: Box, t0: Xform, pointer: Pt, snap: boolean): number {
  const c = boxCenter(box0)
  const cx = c.x + t0.x
  const cy = c.y + t0.y
  let deg = (Math.atan2(pointer.y - cy, pointer.x - cx) * 180) / Math.PI + 90
  if (snap) deg = Math.round(deg / 15) * 15
  deg = ((deg % 360) + 360) % 360
  return deg > 180 ? deg - 360 : deg
}

import type { BoardElement, ElementType, Box } from '@youcoach-board/core'
import { normalizeBox, IDENTITY_TRANSFORM } from '@youcoach-board/core'
import type { ToolId } from '../components/Toolbar'

export interface Point {
  x: number
  y: number
}

/** Phase 2 static figure style (per spec: transparent fill, 3px black stroke). */
export const FIGURE_STROKE = '#111111'
export const FIGURE_STROKE_WIDTH = 3
export const FIGURE_FILL = 'transparent'

/** Below this drag distance (board units) a press is treated as a click, not a
 *  figure — so a stray click with a creation tool doesn't drop a zero-size shape. */
export const MIN_DRAG = 4

export type DraftType = Extract<ElementType, 'rect' | 'ellipse' | 'line'>

/** Map a toolbar tool id to the element type it creates, or null if the tool
 *  isn't a figure-creation tool. Note the deliberate 'rectangle' → 'rect'
 *  rename: tool ids are UI labels, element types are model names. */
export function toolElementType(tool: ToolId): DraftType | null {
  switch (tool) {
    case 'rectangle':
      return 'rect'
    case 'ellipse':
      return 'ellipse'
    case 'line':
      return 'line'
    default:
      return null
  }
}

/** Map a screen (client) coordinate into board user-space via the SVG's CTM.
 *  This accounts for the viewBox scaling and letterbox offset automatically. */
export function clientToBoard(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/** Build a figure from a drag (two corners). Used both for the live draft
 *  preview and the committed element. */
export function makeFigure(type: DraftType, id: string, start: Point, current: Point): BoardElement {
  const base = {
    id,
    transform: { ...IDENTITY_TRANSFORM },
    stroke: FIGURE_STROKE,
    strokeWidth: FIGURE_STROKE_WIDTH,
    fill: FIGURE_FILL,
  }
  if (type === 'line') {
    return { ...base, type: 'line', x1: start.x, y1: start.y, x2: current.x, y2: current.y }
  }
  const box = normalizeBox(start.x, start.y, current.x, current.y)
  return { ...base, type, ...box }
}

/** Build a polyline from clicked vertices (board coords). */
export function makePolyline(id: string, points: Point[], closed: boolean): BoardElement {
  return {
    id,
    type: 'polyline',
    transform: { ...IDENTITY_TRANSFORM },
    stroke: FIGURE_STROKE,
    strokeWidth: FIGURE_STROKE_WIDTH,
    fill: FIGURE_FILL,
    points: points.map((p) => [p.x, p.y] as [number, number]),
    closed,
  }
}

/** Whether a drag is large enough to become a real figure. */
export function isDragSignificant(type: DraftType, start: Point, current: Point): boolean {
  if (type === 'line') {
    return Math.hypot(current.x - start.x, current.y - start.y) >= MIN_DRAG
  }
  return Math.abs(current.x - start.x) >= MIN_DRAG || Math.abs(current.y - start.y) >= MIN_DRAG
}

/** AABB overlap test — marquee "intersection" mode (touch to select). */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** True if `outer` fully contains `inner` — marquee "containment" mode. */
export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

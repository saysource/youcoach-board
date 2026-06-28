import type { ArrowTip, BoardElement, Box, StrokeStyle } from '@youcoach-board/core'
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

/** The styling a newly-created element gets — the editable "next figure" defaults
 *  shown in the properties panel before anything is selected, and the
 *  last-used style after a create/edit. */
export interface FigureStyle {
  stroke: string
  strokeWidth: number
  strokeStyle: StrokeStyle
  fill: string
  opacity: number
}

export const DEFAULT_FIGURE_STYLE: FigureStyle = {
  stroke: FIGURE_STROKE,
  strokeWidth: FIGURE_STROKE_WIDTH,
  strokeStyle: 'solid',
  fill: FIGURE_FILL,
  opacity: 1,
}

/** Read an element's style into a FigureStyle (e.g. to remember last-used). */
export function figureStyleOf(el: BoardElement): FigureStyle {
  return {
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    strokeStyle: el.strokeStyle,
    fill: el.fill,
    opacity: el.transform.opacity,
  }
}

/** Overlay a FigureStyle onto an element (stroke/fill/… + transform opacity),
 *  preserving its geometry. Used so drafts/creations adopt the tool defaults. */
export function applyFigureStyle(el: BoardElement, st: FigureStyle): BoardElement {
  return {
    ...el,
    stroke: st.stroke,
    strokeWidth: st.strokeWidth,
    strokeStyle: st.strokeStyle,
    fill: st.fill,
    transform: { ...el.transform, opacity: st.opacity },
  } as BoardElement
}

/** Whether the figure a tool creates is a closed (fillable) shape — drives
 *  whether the panel offers a Background color for the tool's future element. */
export function toolCreatesClosed(tool: ToolId): boolean {
  return tool === 'rectangle' || tool === 'ellipse'
}

/** Below this drag distance (board units) a press is treated as a click, not a
 *  figure — so a stray click with a creation tool doesn't drop a zero-size shape. */
export const MIN_DRAG = 4

// What a drag with a creation tool drafts. 'line' isn't an element type — it's
// the 2-point-polyline draft shared by the line and arrow tools (which on a mere
// click instead start a multi-point polyline; see InteractiveBoard).
export type DraftType = 'rect' | 'ellipse' | 'line'

/** Map a toolbar tool id to what it drafts on drag, or null if not a creation
 *  tool. Both line and arrow draft a 'line' (the arrow tip is added separately,
 *  see toolEndTip). 'rectangle' → 'rect': tool ids are UI labels, not types. */
export function toolElementType(tool: ToolId): DraftType | null {
  switch (tool) {
    case 'rectangle':
      return 'rect'
    case 'ellipse':
      return 'ellipse'
    case 'line':
    case 'arrow':
      return 'line'
    default:
      return null
  }
}

/** The end arrow tip a creation tool gives its line/polyline. */
export function toolEndTip(tool: ToolId): ArrowTip {
  return tool === 'arrow' ? 'arrow' : 'none'
}

/** Map a screen (client) coordinate into board user-space via the SVG's CTM.
 *  This accounts for the viewBox scaling and letterbox offset automatically. */
export function clientToBoard(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

const figureBase = (id: string) => ({
  id,
  transform: { ...IDENTITY_TRANSFORM },
  stroke: FIGURE_STROKE,
  strokeWidth: FIGURE_STROKE_WIDTH,
  strokeStyle: 'solid' as const,
  fill: FIGURE_FILL,
})

/** Build a box figure (rect / ellipse) from a drag (two corners). Used for both
 *  the live draft preview and the committed element. */
export function makeFigure(type: 'rect' | 'ellipse', id: string, start: Point, current: Point): BoardElement {
  const box = normalizeBox(start.x, start.y, current.x, current.y)
  return { ...figureBase(id), type, ...box }
}

/** Build a straight line as a 2-point (open) polyline, optionally end-tipped. */
export function makeLine(id: string, start: Point, current: Point, endTip: ArrowTip = 'none'): BoardElement {
  return makePolyline(id, [start, current], false, 'none', endTip)
}

/** Build a polyline from vertices (board coords). */
export function makePolyline(
  id: string,
  points: Point[],
  closed: boolean,
  startTip: ArrowTip = 'none',
  endTip: ArrowTip = 'none',
): BoardElement {
  return {
    ...figureBase(id),
    type: 'polyline',
    points: points.map((p) => [p.x, p.y] as [number, number]),
    closed,
    startTip,
    endTip,
  }
}

/** Build a freehand stroke from captured points (board coords). */
export function makeDraw(id: string, points: Point[]): BoardElement {
  return {
    ...figureBase(id),
    type: 'draw',
    points: points.map((p) => [p.x, p.y] as [number, number]),
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

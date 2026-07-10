import type { ArrowTip, BoardElement, PolylineElement, Box, StrokeStyle, FillStyle, TokenShape, TokenFill, TextAlign } from '@youcoach-board/core'
import {
  normalizeBox,
  IDENTITY_TRANSFORM,
  DEFAULT_WAVE_LENGTH,
  DEFAULT_WAVE_AMPLITUDE,
  DEFAULT_LINES_OFFSET,
  textFontStack,
  TEXT_FONT_WEIGHT,
  TEXT_FONT_WEIGHT_BOLD,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_BG,
} from '@youcoach-board/core'
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
  fillStyle: FillStyle
  opacity: number
}

export const DEFAULT_FIGURE_STYLE: FigureStyle = {
  stroke: FIGURE_STROKE,
  strokeWidth: FIGURE_STROKE_WIDTH,
  strokeStyle: 'solid',
  // New shapes (rectangle / oval / …) default to a striped red fill at 20% opacity
  // (the 8-digit hex alpha 0x33 ≈ 20%). Stroke stays fully opaque.
  fill: '#ff000033',
  fillStyle: 'striped',
  opacity: 1,
}

/** Read an element's style into a FigureStyle (e.g. to remember last-used). */
export function figureStyleOf(el: BoardElement): FigureStyle {
  return {
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    strokeStyle: el.strokeStyle,
    fill: el.fill,
    fillStyle: el.fillStyle,
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
    fillStyle: st.fillStyle,
    transform: { ...el.transform, opacity: st.opacity },
  } as BoardElement
}

/** The box-shape tools (the Shapes menu) — all create a closed, fillable figure. */
export const SHAPE_TOOLS = ['rectangle', 'ellipse', 'diamond', 'pentagon', 'triangle', 'trapezoid'] as const
export type ShapeTool = (typeof SHAPE_TOOLS)[number]
export function isShapeTool(tool: ToolId): tool is ShapeTool {
  return (SHAPE_TOOLS as readonly string[]).includes(tool)
}

/** Whether the figure a tool creates is a closed (fillable) shape — drives
 *  whether the panel offers a Background color for the tool's future element. */
export function toolCreatesClosed(tool: ToolId): boolean {
  return isShapeTool(tool)
}

/** The line/arrow tools (the Lines menu). Straight: line/arrow; curved (smooth):
 *  elbow-line/elbow-arrow. zigzag-arrow/double-arrow ride the same smooth curve
 *  with the wave/parallel render style. All the *-arrow tools get an end tip. */
export const LINE_TOOLS = ['arrow', 'line', 'elbow-arrow', 'elbow-line', 'zigzag-arrow', 'double-arrow', 'tape'] as const
export type LineTool = (typeof LINE_TOOLS)[number]
export function isLineTool(tool: ToolId): tool is LineTool {
  return (LINE_TOOLS as readonly string[]).includes(tool)
}
/** Whether a line tool draws a smooth (curved) line rather than straight.
 *  Zigzag/double lines render along the same smooth curve, so they're curved too. */
export function toolIsCurved(tool: ToolId): boolean {
  return tool === 'elbow-arrow' || tool === 'elbow-line' || tool === 'zigzag-arrow' || tool === 'double-arrow'
}
/** Whether a line tool draws a zigzag (wave) line. */
export function toolIsZigzag(tool: ToolId): boolean {
  return tool === 'zigzag-arrow'
}
/** Whether a line tool draws a double (parallel) line. */
export function toolIsDouble(tool: ToolId): boolean {
  return tool === 'double-arrow'
}
/** Whether a line tool is the CAD measurement "tape" (2-point line + length label). */
export function toolIsTape(tool: ToolId): boolean {
  return tool === 'tape'
}

/** Below this drag distance (board units) a press is treated as a click, not a
 *  figure — so a stray click with a creation tool doesn't drop a zero-size shape. */
export const MIN_DRAG = 4

// What a drag with a creation tool drafts. 'line' isn't an element type — it's
// the 2-point-polyline draft shared by the line and arrow tools (which on a mere
// click instead start a multi-point polyline; see InteractiveBoard). The box
// shapes map 1:1 to element types except 'rectangle' → 'rect'.
export type BoxShapeType = 'rect' | 'ellipse' | 'diamond' | 'pentagon' | 'triangle' | 'trapezoid'
export type DraftType = BoxShapeType | 'line'

/** Map a toolbar tool id to what it drafts on drag, or null if not a creation
 *  tool. Both line and arrow draft a 'line' (the arrow tip is added separately,
 *  see toolEndTip). 'rectangle' → 'rect': tool ids are UI labels, not types. */
export function toolElementType(tool: ToolId): DraftType | null {
  switch (tool) {
    case 'rectangle':
      return 'rect'
    case 'ellipse':
      return 'ellipse'
    case 'diamond':
    case 'pentagon':
    case 'triangle':
    case 'trapezoid':
      return tool
    case 'line':
    case 'arrow':
    case 'elbow-line':
    case 'elbow-arrow':
    case 'zigzag-arrow':
    case 'double-arrow':
    case 'tape':
      return 'line'
    default:
      return null
  }
}

/** The end arrow tip a creation tool gives its line/polyline. */
export function toolEndTip(tool: ToolId): ArrowTip {
  return tool === 'arrow' || tool === 'elbow-arrow' || tool === 'zigzag-arrow' || tool === 'double-arrow' ? 'arrow' : 'none'
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
  fillStyle: 'solid' as const,
})

// Normalized (0..1 within the bounding box) vertices for the polygon shapes,
// which are created as CLOSED POLYLINES (not their own element type). Pentagon is
// a regular pentagon pointing up, fitted to the box.
const SHAPE_POLY: Record<Exclude<BoxShapeType, 'rect' | 'ellipse'>, Point[]> = {
  triangle: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  diamond: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }],
  pentagon: [{ x: 0.5, y: 0 }, { x: 1, y: 0.382 }, { x: 0.809, y: 1 }, { x: 0.191, y: 1 }, { x: 0, y: 0.382 }],
  trapezoid: [{ x: 0.25, y: 0 }, { x: 0.75, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
}

/** Build a box figure from a drag (two corners). rect/ellipse become their own
 *  element; the polygon shapes (diamond/pentagon/triangle/trapezoid) become a
 *  CLOSED POLYLINE whose vertices are the shape template scaled into the box.
 *  Used for both the live draft preview and the committed element. */
export function makeFigure(type: BoxShapeType, id: string, start: Point, current: Point): BoardElement {
  const box = normalizeBox(start.x, start.y, current.x, current.y)
  if (type === 'rect' || type === 'ellipse') {
    return { ...figureBase(id), type, ...box }
  }
  const pts = SHAPE_POLY[type].map((n) => ({ x: box.x + n.x * box.width, y: box.y + n.y * box.height }))
  return makePolyline(id, pts, true)
}

/** Shift = keep proportion: project `current` so the box from `start` is square,
 *  preserving the drag direction on each axis. */
export function squareCorner(start: Point, current: Point): Point {
  const dx = current.x - start.x
  const dy = current.y - start.y
  const s = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: start.x + (dx < 0 ? -s : s), y: start.y + (dy < 0 ? -s : s) }
}

/** Build a straight line as a 2-point (open) polyline, optionally end-tipped and
 *  curved (a 2-point curve is straight; the curve shows once points are added). */
export function makeLine(id: string, start: Point, current: Point, endTip: ArrowTip = 'none', curve = false, zigzag = false, double = false, tape = false): BoardElement {
  const el = makePolyline(id, [start, current], false, 'none', endTip, curve, zigzag, double)
  return tape ? { ...(el as PolylineElement), tape: true } : el
}

/** Build a polyline from vertices (board coords). */
export function makePolyline(
  id: string,
  points: Point[],
  closed: boolean,
  startTip: ArrowTip = 'none',
  endTip: ArrowTip = 'none',
  curve = false,
  zigzag = false,
  double = false,
): BoardElement {
  return {
    ...figureBase(id),
    type: 'polyline',
    points: points.map((p) => [p.x, p.y] as [number, number]),
    closed,
    curve,
    zigzag,
    waveLength: DEFAULT_WAVE_LENGTH,
    waveAmplitude: DEFAULT_WAVE_AMPLITUDE,
    double,
    linesOffset: DEFAULT_LINES_OFFSET,
    startTip,
    endTip,
  }
}

/** Default edge length (board units) of a freshly stamped token. */
export const TOKEN_SIZE = 70

/** The appearance a token carries (everything except text/geometry) — copied from
 *  the last selected/created token so new tokens inherit the "team kit". */
export interface TokenStyle {
  shape: TokenShape
  tokenFill: TokenFill
  color1: string
  color2: string
  textColor: string
  showLabel: boolean
}

/** Fallback style for the very first token (before any has been made/selected). */
export const DEFAULT_TOKEN_STYLE: TokenStyle = {
  shape: 'token',
  tokenFill: 'solid',
  color1: '#fa3523',
  color2: '#648fec',
  textColor: '#111111',
  showLabel: false,
}

/** The "next token" defaults: its style + the starting badge text + label. New
 *  tokens inherit this (updated from the last selected/created token); also what
 *  the properties panel edits while the Token tool is active. */
export interface TokenDefaults extends TokenStyle {
  text: string
  label: string
}
export const DEFAULT_TOKEN_DEFAULTS: TokenDefaults = { ...DEFAULT_TOKEN_STYLE, text: '1', label: '' }

/** Build a token of edge `size` centered at (cx, cy) with the given style + label. */
export function makeToken(id: string, cx: number, cy: number, style: TokenStyle = DEFAULT_TOKEN_STYLE, text = '1', size = TOKEN_SIZE): BoardElement {
  return {
    id,
    type: 'token',
    x: Math.round(cx - size / 2),
    y: Math.round(cy - size / 2),
    width: size,
    height: size,
    shape: style.shape,
    tokenFill: style.tokenFill,
    color1: style.color1,
    color2: style.color2,
    textColor: style.textColor,
    text,
    label: '',
    showLabel: style.showLabel,
    transform: { ...IDENTITY_TRANSFORM },
    stroke: '#111111',
    strokeWidth: 3,
    strokeStyle: 'solid',
    fill: 'transparent',
    fillStyle: 'solid',
  }
}

/** The label for a new token, continuing from `lastText` (the last selected/
 *  created token's label): a numeric label advances to the next free number among
 *  tokens of the SAME team — same colors AND fill style — or restarts at 1 for a
 *  brand-new team (no matching tokens yet), rather than carrying over the previous
 *  team's number. A non-numeric label is simply reused. */
export function nextTokenText(elements: BoardElement[], ref: { color1: string; color2: string; textColor: string; tokenFill: TokenFill }, lastText: string): string {
  if (!/^-?\d+$/.test(lastText.trim())) return lastText // non-numeric → reuse it
  const nums: number[] = []
  for (const e of elements) {
    if (e.type !== 'token') continue
    if (e.color1 !== ref.color1 || e.color2 !== ref.color2 || e.textColor !== ref.textColor || e.tokenFill !== ref.tokenFill) continue
    const n = Number(e.text)
    if (e.text.trim() !== '' && Number.isInteger(n)) nums.push(n)
  }
  return nums.length ? String(Math.max(...nums) + 1) : '1'
}

// ── Text element ─────────────────────────────────────────────────────────────

/** The style a text element carries (everything except its content/geometry) —
 *  what the panel edits and new text elements inherit. */
export interface TextStyle {
  textColor: string
  bgColor: string
  fontSize: number
  align: TextAlign
  bold: boolean
  /** Curated font id (core BOARD_FONTS); undefined = the default font. */
  fontFamily?: string
  /** Render italic. */
  italic?: boolean
  /** Write the text onto the 3D field surface (pinned, leaning) rather than flat. */
  text3d: boolean
  /** 3D text reading direction about the field X axis (0/90/180/270°). */
  orientation: number
}
export const DEFAULT_TEXT_STYLE: TextStyle = {
  textColor: DEFAULT_TEXT_COLOR,
  bgColor: DEFAULT_TEXT_BG,
  fontSize: DEFAULT_TEXT_FONT_SIZE,
  align: 'center',
  bold: false,
  text3d: false,
  orientation: 0,
}
/** The "next text" defaults (= its style); no starting content (text starts empty). */
export type TextDefaults = TextStyle
export const DEFAULT_TEXT_DEFAULTS: TextDefaults = { ...DEFAULT_TEXT_STYLE }

// Reused offscreen 2D context for text measurement (canvas measureText at
// `fontSize` px yields widths in board units 1:1, matching the SVG renderer).
let _measureCtx: CanvasRenderingContext2D | null = null
function measureCtx(): CanvasRenderingContext2D | null {
  if (!_measureCtx && typeof document !== 'undefined') _measureCtx = document.createElement('canvas').getContext('2d')
  return _measureCtx
}

/** The background box (width/height in board units) that fits `text` at `fontSize`:
 *  the widest line plus TEXT_PADDING on each side, floored to fit an "M"; height
 *  is line-count · line-height + padding. Kept in lockstep with ElementView's
 *  text layout so the SVG and the inline editor overlay agree. */
export function measureTextBox(text: string, fontSize: number, bold = false, fontFamily?: string, italic = false): { width: number; height: number } {
  const lines = text.length ? text.split('\n') : ['']
  const ctx = measureCtx()
  let maxW = 0
  if (ctx) {
    ctx.font = `${italic ? 'italic ' : ''}${bold ? TEXT_FONT_WEIGHT_BOLD : TEXT_FONT_WEIGHT} ${fontSize}px ${textFontStack(fontFamily)}`
    for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width)
    maxW = Math.max(maxW, ctx.measureText('M').width) // min width fits an "M"
  } else {
    // SSR/export fallback: rough monospace-ish estimate.
    maxW = Math.max(1, ...lines.map((l) => l.length)) * fontSize * 0.6
  }
  const lineH = fontSize * TEXT_LINE_HEIGHT
  return {
    width: Math.ceil(maxW + 2 * TEXT_PADDING),
    height: Math.ceil(lines.length * lineH + 2 * TEXT_PADDING),
  }
}

/** Build a text element centered at (cx, cy) with the given style + content.
 *  Its box is measured from the content so it fits exactly (min = one "M"). */
export function makeText(id: string, cx: number, cy: number, style: TextStyle = DEFAULT_TEXT_STYLE, text = ''): BoardElement {
  const { width, height } = measureTextBox(text, style.fontSize, style.bold, style.fontFamily, style.italic)
  return {
    id,
    type: 'text',
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
    width,
    height,
    text,
    textColor: style.textColor,
    bgColor: style.bgColor,
    fontSize: style.fontSize,
    align: style.align,
    bold: style.bold,
    fontFamily: style.fontFamily,
    italic: style.italic || undefined,
    ...(style.text3d ? { text3d: true, orientation: style.orientation } : {}),
    transform: { ...IDENTITY_TRANSFORM },
    stroke: '#111111',
    strokeWidth: 3,
    strokeStyle: 'solid',
    fill: 'transparent',
    fillStyle: 'solid',
  }
}

/** Convert a rectangle into an equivalent CLOSED polyline (its four corners),
 *  preserving id, transform and style so it stays put and looks identical. */
export function rectToPolyline(rect: Extract<BoardElement, { type: 'rect' }>): BoardElement {
  const { x, y, width, height } = rect
  return {
    id: rect.id,
    type: 'polyline',
    points: [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ],
    closed: true,
    curve: false,
    zigzag: false,
    waveLength: DEFAULT_WAVE_LENGTH,
    waveAmplitude: DEFAULT_WAVE_AMPLITUDE,
    double: false,
    linesOffset: DEFAULT_LINES_OFFSET,
    startTip: 'none',
    endTip: 'none',
    transform: rect.transform,
    stroke: rect.stroke,
    strokeWidth: rect.strokeWidth,
    strokeStyle: rect.strokeStyle,
    fill: rect.fill,
    fillStyle: rect.fillStyle,
  }
}

/** Control points stored for an oval. A ground ellipse projects to a conic, and our
 *  reprojection is only exact AT the points (catmull-rom interpolates between them in
 *  board space), so we sample densely enough to hug the true projected curve — the
 *  user never sees these points (no vertex handles). `curve: true` smooths them. */
const ELLIPSE_SAMPLES = 24

/** Convert an ellipse into an equivalent CLOSED SMOOTH polyline flagged `oval`, so
 *  it renders through the polyline machinery (and can warp onto the pitch — only a
 *  point-defined shape can) yet is presented as an ellipse (box resize handles, no
 *  vertex handles). Preserves id, transform and style. The ellipse analog of
 *  {@link rectToPolyline}. */
export function ellipseToPolyline(ellipse: Extract<BoardElement, { type: 'ellipse' }>): BoardElement {
  const { x, y, width, height } = ellipse
  const cx = x + width / 2
  const cy = y + height / 2
  const rx = width / 2
  const ry = height / 2
  const points: Array<[number, number]> = []
  for (let i = 0; i < ELLIPSE_SAMPLES; i++) {
    const a = (2 * Math.PI * i) / ELLIPSE_SAMPLES
    points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return {
    id: ellipse.id,
    type: 'polyline',
    oval: true,
    points,
    closed: true,
    curve: true,
    zigzag: false,
    waveLength: DEFAULT_WAVE_LENGTH,
    waveAmplitude: DEFAULT_WAVE_AMPLITUDE,
    double: false,
    linesOffset: DEFAULT_LINES_OFFSET,
    startTip: 'none',
    endTip: 'none',
    transform: ellipse.transform,
    stroke: ellipse.stroke,
    strokeWidth: ellipse.strokeWidth,
    strokeStyle: ellipse.strokeStyle,
    fill: ellipse.fill,
    fillStyle: ellipse.fillStyle,
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

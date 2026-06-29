// The board element model (v3).
//
// Framework-free: pure data + pure helpers, runnable anywhere (editor, viewer,
// exporter, Node). The v3 shape is built for extensibility, learning from the
// old (v2) model:
//
//   - Every element has a `transform` — its *placement* (translation, rotation,
//     scale, opacity) — kept SEPARATE from the element's intrinsic geometry.
//     Moving/rotating/scaling an element changes only the transform; the shape
//     coordinates stay put. This is what makes keyframe animation (which will
//     interpolate the transform over time) clean, and lets one "move" operation
//     touch the same two attributes for every element type.
//   - Geometry is type-specific (box for rect/ellipse, points for polyline, and
//     later svg/text for figures and labels).
//
// Lines and arrows are NOT their own types: they are the 2-point case of a
// polyline (with optional arrow tips), so one element/gesture/render path covers
// straight lines, multi-segment paths, arrows and closed polygons. New element
// types slot in by extending the union + a case in ElementView and the parser.

/** Placement of an element — the animatable part, applied on top of geometry. */
export interface ElementTransform {
  /** Translation from the authored geometry, in board user-space units. */
  x: number
  y: number
  /** Rotation in degrees, about the element's local center. */
  rotate: number
  /** Uniform scale, about the element's local center. */
  scale: number
  /** 0–1. */
  opacity: number
}

export const IDENTITY_TRANSFORM: ElementTransform = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }

export type ElementType = 'rect' | 'ellipse' | 'polyline' | 'draw' | 'figure'

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

/** Arrow tip drawn at a polyline endpoint. Extensible (triangle/circle/bar…);
 *  for now a plain filled arrowhead or none. Only meaningful on OPEN polylines. */
export type ArrowTip = 'none' | 'arrow'

interface BaseElement {
  id: string
  transform: ElementTransform
  /** Stroke color (CSS color). */
  stroke: string
  /** Stroke width, in board user-space units. */
  strokeWidth: number
  /** Line style of the stroke. */
  strokeStyle: StrokeStyle
  /** Fill (CSS color, or 'transparent'). */
  fill: string
}

/** Dash array (in board units) for a stroke style, or undefined for solid.
 *  Dotted needs round line caps to render as dots. */
export function strokeDash(style: StrokeStyle, strokeWidth: number): string | undefined {
  if (style === 'dashed') return `${strokeWidth * 2.5} ${strokeWidth * 2}`
  if (style === 'dotted') return `0 ${strokeWidth * 2}`
  return undefined
}

/** Axis-aligned box figures (rect + ellipse) share a bounding-box geometry. */
export interface RectElement extends BaseElement {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse'
  x: number
  y: number
  width: number
  height: number
}

/** A point sequence (≥2 points). The 2-point case is a straight line; with arrow
 *  tips it's an arrow. `closed` (only with ≥3 points) joins last→first into a
 *  fillable polygon. Tips apply at the first/last point of an OPEN polyline.
 *  `curve` renders a smooth (auto, Catmull-Rom → cubic bézier) path through the
 *  points instead of straight segments. Points are in local coordinates. */
export interface PolylineElement extends BaseElement {
  type: 'polyline'
  points: Array<[number, number]>
  closed: boolean
  curve: boolean
  startTip: ArrowTip
  endTip: ArrowTip
}

/** A freehand stroke: a dense point path, always open and unfilled, rendered
 *  smoothed. Like a polyline but with no per-vertex editing — it's selected and
 *  transformed (move/resize/rotate) as a whole. */
export interface DrawElement extends BaseElement {
  type: 'draw'
  points: Array<[number, number]>
}

/** A catalog figure (player, material, field…) placed on the board. Stores a
 *  REFERENCE to the catalog (`figureId`) plus per-slot color overrides and an
 *  optional horizontal mirror — never the SVG itself, so documents stay small and
 *  re-resolve through the host's asset URL. Its intrinsic `width`/`height` (from
 *  the catalog) drive bounds/placement; geometry sits at the local origin and the
 *  transform places it. The real SVG is fetched/recolored in the designer/viewer;
 *  see specs/catalog.md. */
export interface FigureElement extends BaseElement {
  type: 'figure'
  figureId: string
  /** Box geometry (like rect) so move/resize/group reuse the same paths. */
  x: number
  y: number
  width: number
  height: number
  /** Recolor slot → CSS color (e.g. `yc-skin`); slots absent fall back to the
   *  catalog defaults. */
  colors?: Record<string, string>
  /** Render mirrored (artificial right-facing reuses a left-facing SVG). */
  mirror?: boolean
  /** Marks this figure as a ball — special-cased later (e.g. animation). */
  ball?: boolean
}

export type BoardElement = RectElement | EllipseElement | PolylineElement | DrawElement | FigureElement

// ── Smooth curves (auto, no user handles) ───────────────────────────────────
// A polyline with `curve` renders as a Catmull-Rom spline through its points,
// realized as one cubic bézier per segment. The same per-segment cubics position
// the mid-segment edit anchors (evaluated at t=0.5), so rendering and editing
// agree exactly.

/** A cubic bézier segment: start, two controls, end. */
export type Cubic = [[number, number], [number, number], [number, number], [number, number]]

/** Catmull-Rom → cubic béziers through `pts`. Open curves clamp the phantom end
 *  neighbors to the endpoints; closed curves wrap (and include the last→first
 *  segment). Returns one cubic per segment (open: n-1, closed: n). */
export function catmullRomCubics(pts: Array<[number, number]>, closed: boolean): Cubic[] {
  const n = pts.length
  if (n < 2) return []
  const segs = closed ? n : n - 1
  const out: Cubic[] = []
  for (let i = 0; i < segs; i++) {
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const prev = !closed && i === 0 ? p1 : pts[(i - 1 + n) % n]
    const next = !closed && i === segs - 1 ? p2 : pts[(i + 2) % n]
    const c1: [number, number] = [p1[0] + (p2[0] - prev[0]) / 6, p1[1] + (p2[1] - prev[1]) / 6]
    const c2: [number, number] = [p2[0] - (next[0] - p1[0]) / 6, p2[1] - (next[1] - p1[1]) / 6]
    out.push([p1, c1, c2, p2])
  }
  return out
}

/** Evaluate a cubic bézier at parameter t (0..1). */
export function cubicPointAt(c: Cubic, t: number): [number, number] {
  const m = 1 - t
  const a = m * m * m
  const b = 3 * m * m * t
  const d = 3 * m * t * t
  const e = t * t * t
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]]
}

/** SVG path `d` for a smooth curve through `pts`. */
export function curvedPathD(pts: Array<[number, number]>, closed: boolean): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0]},${pts[0][1]}`
  for (const c of catmullRomCubics(pts, closed)) d += ` C ${c[1][0]},${c[1][1]} ${c[2][0]},${c[2][1]} ${c[3][0]},${c[3][1]}`
  if (closed) d += ' Z'
  return d
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Build a normalized (always-positive-size) box from two opposite corners. */
export function normalizeBox(ax: number, ay: number, bx: number, by: number): Box {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  }
}

/** The element's bounding box in its OWN coordinates, ignoring the transform. */
export function getLocalBounds(el: BoardElement): Box {
  if (el.type === 'polyline' || el.type === 'draw') {
    if (el.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
    const xs = el.points.map((p) => p[0])
    const ys = el.points.map((p) => p[1])
    return normalizeBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
  }
  return { x: el.x, y: el.y, width: el.width, height: el.height }
}

/** The element's bounding box in board coordinates, with its transform applied
 *  (translation + scale about center). Rotation is ignored here for now (all
 *  current figures are unrotated); revisit when rotation lands. */
export function getElementBounds(el: BoardElement): Box {
  const lb = getLocalBounds(el)
  const { x, y, scale } = el.transform
  const cx = lb.x + lb.width / 2
  const cy = lb.y + lb.height / 2
  const width = lb.width * scale
  const height = lb.height * scale
  return { x: cx - width / 2 + x, y: cy - height / 2 + y, width, height }
}

// ── Defensive parsing ──────────────────────────────────────────────────────
// Elements arrive from untrusted JSON; anything malformed is dropped (returns
// null) rather than throwing, so one bad element can't break the whole load.

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function parseTransform(raw: unknown): ElementTransform {
  if (typeof raw !== 'object' || raw === null) return { ...IDENTITY_TRANSFORM }
  const o = raw as Record<string, unknown>
  return {
    x: num(o.x) ?? 0,
    y: num(o.y) ?? 0,
    rotate: num(o.rotate) ?? 0,
    scale: num(o.scale) ?? 1,
    opacity: num(o.opacity) ?? 1,
  }
}

export function parseElement(raw: unknown): BoardElement | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : null
  if (!id) return null
  const base = {
    id,
    transform: parseTransform(o.transform),
    stroke: str(o.stroke, '#000000'),
    strokeWidth: num(o.strokeWidth) ?? 3,
    strokeStyle: (o.strokeStyle === 'dashed' || o.strokeStyle === 'dotted' ? o.strokeStyle : 'solid') as StrokeStyle,
    fill: str(o.fill, 'transparent'),
  }

  if (o.type === 'rect' || o.type === 'ellipse') {
    const x = num(o.x)
    const y = num(o.y)
    const width = num(o.width)
    const height = num(o.height)
    if (x === null || y === null || width === null || height === null) return null
    return { ...base, type: o.type, x, y, width, height }
  }
  if (o.type === 'line') {
    // Legacy: a 2-point line is now a 2-point (open, untipped) polyline.
    const x1 = num(o.x1)
    const y1 = num(o.y1)
    const x2 = num(o.x2)
    const y2 = num(o.y2)
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null
    return { ...base, type: 'polyline', points: [[x1, y1], [x2, y2]], closed: false, curve: false, startTip: 'none', endTip: 'none' }
  }
  if (o.type === 'polyline') {
    if (!Array.isArray(o.points)) return null
    const points: Array<[number, number]> = []
    for (const p of o.points) {
      if (!Array.isArray(p)) return null
      const x = num(p[0])
      const y = num(p[1])
      if (x === null || y === null) return null
      points.push([x, y])
    }
    if (points.length < 2) return null
    return { ...base, type: 'polyline', points, closed: o.closed === true, curve: o.curve === true, startTip: parseTip(o.startTip), endTip: parseTip(o.endTip) }
  }
  if (o.type === 'draw') {
    if (!Array.isArray(o.points)) return null
    const points: Array<[number, number]> = []
    for (const p of o.points) {
      if (!Array.isArray(p)) return null
      const x = num(p[0])
      const y = num(p[1])
      if (x === null || y === null) return null
      points.push([x, y])
    }
    if (points.length < 2) return null
    return { ...base, type: 'draw', points }
  }
  if (o.type === 'figure') {
    const figureId = typeof o.figureId === 'string' ? o.figureId : null
    const width = num(o.width)
    const height = num(o.height)
    if (!figureId || width === null || height === null) return null
    return { ...base, type: 'figure', figureId, x: num(o.x) ?? 0, y: num(o.y) ?? 0, width, height, colors: parseColors(o.colors), mirror: o.mirror === true, ball: o.ball === true || undefined }
  }
  return null
}

function parseTip(v: unknown): ArrowTip {
  return v === 'arrow' ? 'arrow' : 'none'
}

function parseColors(v: unknown): Record<string, string> | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val
  return Object.keys(out).length ? out : undefined
}

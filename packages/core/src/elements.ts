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
//   - Geometry is type-specific (box for rect/ellipse, endpoints for line, and
//     later svg/points/text for figures, polygons and labels).
//
// Phase 2 ships rect / ellipse / line; new element types slot in by extending
// the union + adding a case to ElementView and the parser.

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

export type ElementType = 'rect' | 'ellipse' | 'line' | 'polyline'

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

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

export interface LineElement extends BaseElement {
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
}

/** A multi-point line. `closed` joins the last point back to the first (and the
 *  shape can be filled). Points are in local coordinates. */
export interface PolylineElement extends BaseElement {
  type: 'polyline'
  points: Array<[number, number]>
  closed: boolean
}

export type BoardElement = RectElement | EllipseElement | LineElement | PolylineElement

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
  if (el.type === 'line') return normalizeBox(el.x1, el.y1, el.x2, el.y2)
  if (el.type === 'polyline') {
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
    const x1 = num(o.x1)
    const y1 = num(o.y1)
    const x2 = num(o.x2)
    const y2 = num(o.y2)
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null
    return { ...base, type: 'line', x1, y1, x2, y2 }
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
    return { ...base, type: 'polyline', points, closed: o.closed === true }
  }
  return null
}

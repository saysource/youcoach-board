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

export type ElementType = 'rect' | 'ellipse' | 'polyline' | 'draw' | 'figure' | 'token' | 'text' | 'arrow3d'

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

/** How a closed shape's fill is painted: a flat color, or 45° stripes of it. */
export type FillStyle = 'solid' | 'striped'

/** Arrow tip drawn at a polyline endpoint. Extensible (triangle/circle/bar…);
 *  for now a plain filled arrowhead or none. Only meaningful on OPEN polylines. */
export type ArrowTip = 'none' | 'arrow'

interface BaseElement {
  id: string
  /** When true, the element is protected: it can be selected (to unlock) but not
   *  moved, resized, rotated, edited or deleted from the canvas. */
  locked?: boolean
  transform: ElementTransform
  /** Stroke color (CSS color). */
  stroke: string
  /** Stroke width, in board user-space units. */
  strokeWidth: number
  /** Line style of the stroke. */
  strokeStyle: StrokeStyle
  /** Fill (CSS color, or 'transparent'). */
  fill: string
  /** How the fill is painted (only meaningful for closed shapes). */
  fillStyle: FillStyle
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
 *  points instead of straight segments. `zigzag` renders a wave along that smooth
 *  path (editing is identical to a curved line). Points are in local coords. */
export interface PolylineElement extends BaseElement {
  type: 'polyline'
  points: Array<[number, number]>
  closed: boolean
  curve: boolean
  /** Render the (curved) path as a wave; anchors still sit on the smooth path. */
  zigzag: boolean
  /** Wave period in board units (one full crest→crest). Smaller = more waves
   *  (higher frequency). Only used when `zigzag`. */
  waveLength: number
  /** Wave peak-to-trough height in board units. 0 = AUTO: use `waveLength` (so a
   *  single wave is as tall as it is wide). Only used when `zigzag`. */
  waveAmplitude: number
  /** Render two parallel lines straddling the (curved) reference path. Mutually
   *  exclusive with `zigzag`. */
  double: boolean
  /** Gap between the two parallel lines in board units. Only used when `double`. */
  linesOffset: number
  startTip: ArrowTip
  endTip: ArrowTip
  /** Per-point world-ground anchors `[x, z]` (metres, y=0), parallel to `points` —
   *  each defining point pinned to the pitch, so the shape warps to stay on the
   *  field surface when the 3D field camera changes. Absent = not pinned. See
   *  specs/start.md "Elements on the 3D space". */
  ground?: Array<[number, number]>
  /** A CAD-style measurement "tape": a strictly 2-point straight line rendered with
   *  end ticks and its ground length (metres) labelled along it. */
  tape?: boolean
  /** An OVAL rendered through the polyline machinery (so it warps onto the pitch),
   *  but presented to the user as an ellipse: box resize handles, no vertex/anchor
   *  handles. Stores only the few control points needed; `curve` renders it smooth.
   *  Internal detail — the user never sees "polyline". */
  oval?: boolean
}

/** A freehand stroke: a dense point path, always open and unfilled, rendered
 *  smoothed. Like a polyline but with no per-vertex editing — it's selected and
 *  transformed (move/resize/rotate) as a whole. */
export interface DrawElement extends BaseElement {
  type: 'draw'
  points: Array<[number, number]>
  /** Per-point world-ground anchors `[x, z]` (metres, y=0), parallel to `points` —
   *  the stroke painted on the 3D surface, so it warps to stay on the field when the
   *  camera changes. Absent = not pinned (a flat board stroke). Like PolylineElement. */
  ground?: Array<[number, number]>
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
  /** World-ground anchor `[x, z]` (metres, y=0) — the figure's bottom-center pinned
   *  to the pitch, so it keeps its physical spot when the 3D field camera changes.
   *  Absent = not (yet) pinned. See specs/start.md "Elements on the 3D space". */
  ground?: [number, number]
  /** The figure's real-world height in metres at its ground spot, so its on-board
   *  size can be derived ABSOLUTELY under any camera (`sizeM × ground-ppm`). Kept
   *  in sync alongside `ground`; makes scaling self-correcting (a figure that
   *  passes out of view while zooming returns to its right size). */
  sizeM?: number
}

/** A token: an internally-managed disc/jersey badge with a configurable fill and
 *  a short text label — NOT a catalog figure. `shape` picks the silhouette;
 *  `tokenFill` picks how the badge interior is painted from `color1`/`color2`;
 *  `text` is the (inline-editable) label drawn in `textColor`. Box geometry like
 *  rect/figure so move/resize/group reuse the same machinery. */
export type TokenShape = 'token' | 'jersey'
export type TokenFill = 'solid' | 'vstripes' | 'hstripes' | 'vstripe' | 'hstripe' | 'checker' | 'plaid'

export interface TokenElement extends BaseElement {
  type: 'token'
  x: number
  y: number
  width: number
  height: number
  shape: TokenShape
  tokenFill: TokenFill
  /** Primary / secondary badge colors (CSS). */
  color1: string
  color2: string
  /** Label color (CSS). */
  textColor: string
  /** The short label drawn in the badge. */
  text: string
  /** A caption drawn UNDER the badge (always black). Empty renders as "Player". */
  label: string
  /** Whether the under-badge caption is shown. */
  showLabel: boolean
  /** World-ground anchor `[x, z]` (metres, y=0) — the badge's bottom-center pinned
   *  to the pitch (see FigureElement.ground). */
  ground?: [number, number]
  /** Real-world height in metres for absolute pinned scaling (see
   *  FigureElement.sizeM). */
  sizeM?: number
}

/** A multiline text label wrapped by a rounded rectangle (which may be
 *  transparent). Box geometry like rect: `width`/`height` are DERIVED from the
 *  text + `fontSize` (fitted with a small padding; see TEXT_PADDING) by the
 *  designer and stored so the viewer/export render identically without measuring.
 *  `align` only matters across multiple lines. */
export type TextAlign = 'left' | 'center' | 'right'

export interface TextElement extends BaseElement {
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  /** The text; may contain newlines (multiline). */
  text: string
  /** Text color (CSS). */
  textColor: string
  /** Rounded-rectangle background color (CSS, or 'transparent'); carries opacity. */
  bgColor: string
  /** Font size in board units (TEXT_MIN_FONT..TEXT_MAX_FONT). */
  fontSize: number
  /** Horizontal alignment of the lines within the box. */
  align: TextAlign
  /** Render bold (font weight 800) instead of the regular weight. */
  bold: boolean
  /** Curated font id (see fonts.ts BOARD_FONTS); absent = the default font. */
  fontFamily?: string
  /** Render italic (synthesized obliquing where a face has no italic file). */
  italic?: boolean
  /** When true, the text is written onto the 3D field surface (lying flat, leaning
   *  in perspective) instead of floating flat on the board. Pinned via `ground`. */
  text3d?: boolean
  /** For 3D text: the reading direction on the pitch, in degrees about the field's
   *  X axis — one of 0 / 90 / 180 / 270. No auto-rotation (unlike a tape label). */
  orientation?: number
  /** World-ground anchor `[x, z]` (metres, y=0) — the 3D text's centre pinned to the
   *  pitch, so it follows the field camera. Absent = not pinned (a flat board text). */
  ground?: [number, number]
}

/** A real 3D arrow rendered with three.js (designer overlay), not SVG. Its shape
 *  lives in a fixed 3D scene: the arrow sits on the ground plane at (x, z), rotated
 *  `y` radians about the vertical axis, arcing up by `splineHeight` over a span of
 *  `splineWidth`. The remaining fields size the extruded ribbon + arrowhead. Board
 *  color = `fill` (BaseElement); `opacity` is its own 0..1 field. `transform` is
 *  unused (kept identity) — placement is intrinsic. See lib/arrow3d in designer. */
export interface Arrow3DElement extends BaseElement {
  type: 'arrow3d'
  /** Tail position on the ground plane. */
  x: number
  z: number
  /** Rotation around the vertical (Y) axis, in radians. */
  y: number
  /** Tail→head span (arc length base). */
  splineWidth: number
  /** Arc height. */
  splineHeight: number
  /** How much of the arc is drawn (0..1; the head sits at the far end). */
  splineLength: number
  /** Ribbon half-width of the stick. */
  stickWidth: number
  /** Ribbon thickness (extrusion depth). */
  thickness: number
  /** Arrowhead half-width. */
  tipWidth: number
  /** Arrowhead length. */
  tipLength: number
  /** 0..1. */
  opacity: number
}

/** A real 3D object (three.js mesh) placed on the pitch — the first members of a
 *  coming "3D materials" palette. Like arrow3d its placement is intrinsic (not via
 *  `transform`): it sits on the ground plane at (x, z) metres, rotated `rotation`
 *  radians about the vertical (Y) axis only, and is `size` metres big. `objectId`
 *  selects which object ('ball' | 'cube' for now; extensible). Rendered by
 *  Object3DLayer. */
export interface Object3DElement extends BaseElement {
  type: 'object3d'
  /** Which 3D object to render ('ball' | 'cube' …). */
  objectId: string
  /** Ground position (metres, corner-origin pitch frame). */
  x: number
  z: number
  /** Rotation about the vertical (Y) axis, in radians (the only allowed rotation). */
  rotation: number
  /** Custom size as a multiplier RELATIVE to the global object scale (1 = global).
   *  Only used when `useGlobalSize` is false; the rendered scale is floored at the
   *  object's real size (×1 absolute), never smaller. */
  size: number
  /** When true (default), the object renders at the global object scale
   *  (background.objectScale) and `size` is ignored. When false, it uses its own
   *  custom `size`. */
  useGlobalSize: boolean
  /** Recolor slots (3D players: skin/hair/kit), the same slot names as figure
   *  players (yc-skin, yc-hair, yc-color-1 …). Absent → the authored look. */
  colors?: Record<string, string>
}

export type BoardElement = RectElement | EllipseElement | PolylineElement | DrawElement | FigureElement | TokenElement | TextElement | Arrow3DElement | Object3DElement

// ── Smooth curves (auto, no user handles) ───────────────────────────────────
// A polyline with `curve` renders as a Catmull-Rom spline through its points,
// realized as one cubic bézier per segment. The same per-segment cubics position
// the mid-segment edit anchors (evaluated at t=0.5), so rendering and editing
// agree exactly.

/** A cubic bézier segment: start, two controls, end. */
export type Cubic = [[number, number], [number, number], [number, number], [number, number]]

/** Catmull-Rom → cubic béziers through `pts`, with CENTRIPETAL parameterization
 *  (`alpha` = 0.5) so unevenly-spaced points don't cusp or loop — uniform
 *  Catmull-Rom overshoots badly once points bunch up, e.g. when a curve is pinned
 *  to the pitch and the perspective compresses its far end. Open curves use a
 *  one-sided tangent at each end; closed curves wrap (and include last→first).
 *  Returns one cubic per segment (open: n-1, closed: n). Reduces to the classic
 *  uniform form when points are evenly spaced. */
export function catmullRomCubics(pts: Array<[number, number]>, closed: boolean, alpha = 0.5): Cubic[] {
  const n = pts.length
  if (n < 2) return []
  const segs = closed ? n : n - 1
  const out: Cubic[] = []
  const knot = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) ** alpha
  for (let i = 0; i < segs; i++) {
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    // Phantom neighbors: null at an open curve's ends → one-sided end tangent.
    const p0 = !closed && i === 0 ? null : pts[(i - 1 + n) % n]
    const p3 = !closed && i === segs - 1 ? null : pts[(i + 2) % n]
    const d1 = p0 ? knot(p0, p1) : 0
    const d2 = knot(p1, p2) || 1e-6
    const d3 = p3 ? knot(p2, p3) : 0
    // Non-uniform Catmull-Rom tangents (dP/dt) at p1 and p2; the bézier controls are
    // p ± tangent·d2/3. A clamped end (no neighbor) falls back to the segment chord.
    const tan = (a: [number, number], b: [number, number], c: [number, number], da: number, db: number): [number, number] =>
      da > 1e-9
        ? [(b[0] - a[0]) / da - (c[0] - a[0]) / (da + db) + (c[0] - b[0]) / db, (b[1] - a[1]) / da - (c[1] - a[1]) / (da + db) + (c[1] - b[1]) / db]
        : [(c[0] - b[0]) / db, (c[1] - b[1]) / db]
    const m1 = p0 ? tan(p0, p1, p2, d1, d2) : ([(p2[0] - p1[0]) / d2, (p2[1] - p1[1]) / d2] as [number, number])
    const m2 = p3 ? tan(p1, p2, p3, d2, d3) : ([(p2[0] - p1[0]) / d2, (p2[1] - p1[1]) / d2] as [number, number])
    const c1: [number, number] = [p1[0] + (m1[0] * d2) / 3, p1[1] + (m1[1] * d2) / 3]
    const c2: [number, number] = [p2[0] - (m2[0] * d2) / 3, p2[1] - (m2[1] * d2) / 3]
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

/** Parameters t in (0,1) where a cubic's derivative is 0 on one axis (its
 *  extrema), given the four control values for that axis. */
function cubicExtremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t) = 3[(A) + 2t(B-A) + t²(A-2B+C)], with A=p1-p0, B=p2-p1, C=p3-p2.
  const A = p1 - p0
  const B = p2 - p1
  const C = p3 - p2
  const qa = A - 2 * B + C
  const qb = 2 * (B - A)
  const qc = A
  const ts: number[] = []
  if (Math.abs(qa) < 1e-9) {
    if (Math.abs(qb) > 1e-9) {
      const t = -qc / qb
      if (t > 0 && t < 1) ts.push(t)
    }
  } else {
    const disc = qb * qb - 4 * qa * qc
    if (disc >= 0) {
      const sq = Math.sqrt(disc)
      for (const t of [(-qb + sq) / (2 * qa), (-qb - sq) / (2 * qa)]) if (t > 0 && t < 1) ts.push(t)
    }
  }
  return ts
}

/** Tight bounding box of the smooth curve through `pts` — includes the bézier
 *  overshoot between anchors, not just the anchors themselves. */
export function curveBounds(pts: Array<[number, number]>, closed: boolean): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const acc = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const c of catmullRomCubics(pts, closed)) {
    acc(c[0][0], c[0][1])
    acc(c[3][0], c[3][1])
    for (const t of cubicExtremaT(c[0][0], c[1][0], c[2][0], c[3][0])) acc(cubicPointAt(c, t)[0], cubicPointAt(c, t)[1])
    for (const t of cubicExtremaT(c[0][1], c[1][1], c[2][1], c[3][1])) acc(cubicPointAt(c, t)[0], cubicPointAt(c, t)[1])
  }
  return normalizeBox(minX, minY, maxX, maxY)
}

// ── Zigzag (wave) rendering ─────────────────────────────────────────────────
// A 'zigzag' line follows the SAME smooth curve as a curved line, but the drawn
// stroke is a sine wave riding along it. Two per-element controls (ported from
// the old editor): `waveLength` is the period (crest→crest, in board units;
// smaller = higher frequency, range ~6–80), and `waveAmplitude` is the
// peak-to-trough height (0 = AUTO → equals waveLength, i.e. a square-ish wave).
export const WAVE_LENGTH_MIN = 20
export const WAVE_LENGTH_MAX = 60
export const WAVE_AMPLITUDE_MAX = 100
export const DEFAULT_WAVE_LENGTH = 40
export const DEFAULT_WAVE_AMPLITUDE = 12
const ZIGZAG_SAMPLE_STEP = 3 // board units between samples along the centerline

/** Resolve a zigzag's wave geometry: the perpendicular offset (half of the
 *  peak-to-trough height) and the period, applying the AUTO-amplitude rule. */
export function waveParams(el: PolylineElement): { offset: number; wavelength: number } {
  const wavelength = el.waveLength > 0 ? el.waveLength : DEFAULT_WAVE_LENGTH
  const peak = el.waveAmplitude > 0 ? el.waveAmplitude : wavelength // 0 = auto
  return { offset: peak / 2, wavelength }
}

/** Tangent (dx,dy) of a cubic bézier at parameter t. */
function cubicTangent(c: Cubic, t: number): [number, number] {
  const m = 1 - t
  const dx = 3 * m * m * (c[1][0] - c[0][0]) + 6 * m * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0])
  const dy = 3 * m * m * (c[1][1] - c[0][1]) + 6 * m * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1])
  return [dx, dy]
}

/** Smoothstep ease (0→1) used to blend a straightened tail in. */
function smoothstep(f: number): number {
  return f * f * (3 - 2 * f)
}

/** SVG path `d` for a wave running along the smooth curve through `pts`.
 *  `amplitude` here is the perpendicular OFFSET (half the peak-to-trough).
 *  When an end carries an arrow tip, that end's tail is straightened toward the
 *  straight line through the endpoint and its adjacent anchor — so the arrow
 *  marker (which orients to the last segment) faces along the reference line. */
export function zigzagPathD(
  pts: Array<[number, number]>,
  closed: boolean,
  amplitude = DEFAULT_WAVE_AMPLITUDE / 2,
  wavelength = DEFAULT_WAVE_LENGTH,
  startArrow = false,
  endArrow = false,
): string {
  if (pts.length < 2) return ''
  const cubics = catmullRomCubics(pts, closed)
  const out: Array<[number, number]> = []
  const arc: number[] = []
  let s = 0 // arc length along the centerline
  let prev: [number, number] | null = null
  // Sample finely enough that one wave period gets ~20 points (so crests stay
  // round), but never coarser than the base step on long-wavelength waves.
  const sampleStep = Math.max(0.8, Math.min(ZIGZAG_SAMPLE_STEP, wavelength / 20))
  for (let ci = 0; ci < cubics.length; ci++) {
    const c = cubics[ci]
    const chord = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1])
    const steps = Math.max(2, Math.round(chord / sampleStep))
    for (let i = ci === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps
      const pt = cubicPointAt(c, t)
      if (prev) s += Math.hypot(pt[0] - prev[0], pt[1] - prev[1])
      prev = pt
      const tan = cubicTangent(c, t)
      const len = Math.hypot(tan[0], tan[1]) || 1
      const off = amplitude * Math.sin((2 * Math.PI * s) / wavelength)
      out.push([pt[0] + (-tan[1] / len) * off, pt[1] + (tan[0] / len) * off])
      arc.push(s)
    }
  }
  const total = s || 1
  const straightLen = Math.min(wavelength, total * 0.45)
  // Arrow direction = the smooth curve's tangent at the endpoint (how the line
  // visually arrives at the tip), so the arrow marker reads naturally.
  if (!closed && endArrow) {
    const E = pts[pts.length - 1]
    const dir = vunit(cubicTangent(cubics[cubics.length - 1], 1))
    for (let k = 0; k < out.length; k++) {
      const dEnd = total - arc[k]
      if (dEnd < straightLen) {
        const f = smoothstep(1 - dEnd / straightLen)
        const tx = E[0] - dir[0] * dEnd
        const ty = E[1] - dir[1] * dEnd
        out[k] = [out[k][0] + (tx - out[k][0]) * f, out[k][1] + (ty - out[k][1]) * f]
      }
    }
  }
  if (!closed && startArrow) {
    const S = pts[0]
    const inward = vunit(cubicTangent(cubics[0], 0))
    for (let k = 0; k < out.length; k++) {
      const dStart = arc[k]
      if (dStart < straightLen) {
        const f = smoothstep(1 - dStart / straightLen)
        const tx = S[0] + inward[0] * dStart
        const ty = S[1] + inward[1] * dStart
        out[k] = [out[k][0] + (tx - out[k][0]) * f, out[k][1] + (ty - out[k][1]) * f]
      }
    }
  }
  // Smooth the sampled wave into a quadratic path (control point = each sample,
  // endpoints = midpoints between samples) so crests read as round curves rather
  // than faceted segments. The very ends are drawn straight to the exact sample,
  // keeping arrow-marker orientation (the straightened tail) intact.
  let d = `M ${out[0][0]},${out[0][1]}`
  if (out.length === 2) {
    d += ` L ${out[1][0]},${out[1][1]}`
  } else {
    for (let i = 1; i < out.length - 1; i++) {
      const mx = (out[i][0] + out[i + 1][0]) / 2
      const my = (out[i][1] + out[i + 1][1]) / 2
      d += ` Q ${out[i][0]},${out[i][1]} ${mx},${my}`
    }
    const last = out[out.length - 1]
    d += ` L ${last[0]},${last[1]}`
  }
  if (closed) d += ' Z'
  return d
}

// ── Double line (two parallel strokes) ──────────────────────────────────────
// A 'double' line follows the SAME smooth curve as a curved line, but draws two
// strokes offset ±linesOffset/2 along the path normal. `linesOffset` is the gap.
// When an end carries an arrow tip, that end is straightened along the reference
// tangent and the two strokes are capped by a single arrowhead spanning the gap.
export const LINES_OFFSET_MIN = 5
export const LINES_OFFSET_MAX = 25
export const DEFAULT_LINES_OFFSET = 10

type Vec = [number, number]
function vunit(v: Vec): Vec {
  const l = Math.hypot(v[0], v[1]) || 1
  return [v[0] / l, v[1] / l]
}
function polyD(pts: Vec[], close: boolean): string {
  if (pts.length === 0) return ''
  let d = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]},${pts[i][1]}`
  if (close) d += ' Z'
  return d
}

export interface DoubleLineGeom {
  /** The two parallel stroke paths. */
  left: string
  right: string
  /** Filled arrowhead path(s), one per tipped end. */
  arrows: string[]
}

/** Build the two parallel stroke paths (and any arrowheads) for a double line. */
export function doubleLinePaths(
  pts: Array<[number, number]>,
  closed: boolean,
  linesOffset: number,
  startArrow: boolean,
  endArrow: boolean,
): DoubleLineGeom {
  if (pts.length < 2) return { left: '', right: '', arrows: [] }
  const half = linesOffset / 2
  const cubics = catmullRomCubics(pts, closed)
  // Sample the centerline into points + unit tangents.
  const P: Vec[] = []
  const T: Vec[] = []
  for (let ci = 0; ci < cubics.length; ci++) {
    const c = cubics[ci]
    const chord = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1])
    const steps = Math.max(2, Math.round(chord / ZIGZAG_SAMPLE_STEP))
    for (let i = ci === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps
      P.push(cubicPointAt(c, t))
      T.push(vunit(cubicTangent(c, t)))
    }
  }
  const n = P.length
  const cum = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])
  const total = cum[n - 1] || 1
  // Arrow direction = the smooth curve's tangent AT the endpoint (captured before
  // the tail is straightened). This is how the line visually arrives at the tip,
  // so the arrowhead reads naturally even on looping paths.
  const startDir = T[0]
  const endDir = T[n - 1]
  // Arrowhead depth (along the line) and its base half-width. The base spans
  // 2×linesOffset, so the head overhangs the parallel strokes on both sides.
  const arrowLen = Math.min(Math.max(linesOffset * 1.4, 14), total * 0.45)
  const baseHalf = linesOffset
  const straightLen = Math.min(arrowLen + half, total * 0.49)

  // Straighten the tail near a tipped end so the arrowhead approach is parallel
  // to (and aligned with) the curve's endpoint tangent.
  if (!closed && endArrow) {
    const E = P[n - 1]
    const dir = endDir
    for (let i = 0; i < n; i++) {
      const dEnd = total - cum[i]
      if (dEnd < straightLen) {
        const f = smoothstep(1 - dEnd / straightLen)
        const tx = E[0] - dir[0] * dEnd
        const ty = E[1] - dir[1] * dEnd
        P[i] = [P[i][0] + (tx - P[i][0]) * f, P[i][1] + (ty - P[i][1]) * f]
        T[i] = vunit([T[i][0] + (dir[0] - T[i][0]) * f, T[i][1] + (dir[1] - T[i][1]) * f])
      }
    }
  }
  if (!closed && startArrow) {
    const S = P[0]
    const dir = startDir
    for (let i = 0; i < n; i++) {
      const dStart = cum[i]
      if (dStart < straightLen) {
        const f = smoothstep(1 - dStart / straightLen)
        const tx = S[0] + dir[0] * dStart
        const ty = S[1] + dir[1] * dStart
        P[i] = [P[i][0] + (tx - P[i][0]) * f, P[i][1] + (ty - P[i][1]) * f]
        T[i] = vunit([T[i][0] + (dir[0] - T[i][0]) * f, T[i][1] + (dir[1] - T[i][1]) * f])
      }
    }
  }

  // Offset points along the (now possibly straightened) normals.
  const L: Vec[] = []
  const R: Vec[] = []
  for (let i = 0; i < n; i++) {
    const nx = -T[i][1]
    const ny = T[i][0]
    L.push([P[i][0] + nx * half, P[i][1] + ny * half])
    R.push([P[i][0] - nx * half, P[i][1] - ny * half])
  }

  const arrows: string[] = []
  let lo = 0
  let hi = n - 1
  if (!closed && startArrow) {
    const apex = P[0]
    const dir = startDir // curve tangent at the start (points inward)
    const np: Vec = [-dir[1], dir[0]]
    const neck: Vec = [apex[0] + dir[0] * arrowLen, apex[1] + dir[1] * arrowLen]
    // Strokes meet the neck on the base line; the head corners overhang to ±baseHalf.
    while (lo < hi && cum[lo] < arrowLen) lo++
    L[lo] = [neck[0] + np[0] * half, neck[1] + np[1] * half]
    R[lo] = [neck[0] - np[0] * half, neck[1] - np[1] * half]
    const cL: Vec = [neck[0] + np[0] * baseHalf, neck[1] + np[1] * baseHalf]
    const cR: Vec = [neck[0] - np[0] * baseHalf, neck[1] - np[1] * baseHalf]
    arrows.push(polyD([cL, apex, cR], true))
  }
  if (!closed && endArrow) {
    const apex = P[n - 1]
    const dir = endDir // curve tangent at the end
    const np: Vec = [-dir[1], dir[0]]
    const neck: Vec = [apex[0] - dir[0] * arrowLen, apex[1] - dir[1] * arrowLen]
    while (hi > lo && total - cum[hi] < arrowLen) hi--
    L[hi] = [neck[0] + np[0] * half, neck[1] + np[1] * half]
    R[hi] = [neck[0] - np[0] * half, neck[1] - np[1] * half]
    const cL: Vec = [neck[0] + np[0] * baseHalf, neck[1] + np[1] * baseHalf]
    const cR: Vec = [neck[0] - np[0] * baseHalf, neck[1] - np[1] * baseHalf]
    arrows.push(polyD([cL, apex, cR], true))
  }

  return {
    left: polyD(L.slice(lo, hi + 1), closed),
    right: polyD(R.slice(lo, hi + 1), closed),
    arrows,
  }
}

// ── Token (disc / jersey badge) geometry ────────────────────────────────────
// Both silhouettes are authored in a 100×100 box (from assets/token_plain.svg
// and assets/token_tshirt.svg); the renderer scales this into the element box.
// `clip` is the fillable silhouette (used as a clipPath AND the stroked outline);
// `strokeWidth` is the outline width in that 100-space; `text` positions the
// label. Pattern tiling constants live here too so fills are consistent.
export interface TokenGeometry {
  /** SVG fragment string for the silhouette (circle/path), without paint. */
  shape: 'circle' | 'path'
  /** circle: [cx, cy, r]; path: the `d`. */
  circle?: [number, number, number]
  path?: string
  strokeWidth: number
  text: { x: number; y: number; size: number }
}

export const TOKEN_GEOMETRY: Record<TokenShape, TokenGeometry> = {
  token: {
    shape: 'circle',
    circle: [50, 50, 45.445],
    strokeWidth: 8.33,
    text: { x: 50, y: 50, size: 50 },
  },
  jersey: {
    shape: 'path',
    path: 'M50,9.485C44.518,9.485 42.116,8.247 37.951,5.058C20.026,12.144 18.784,15.497 18.784,15.497C18.784,15.497 15.531,29.859 11.379,40.664L26.292,43.875L27.717,38.416C29.224,57.179 27.996,74.392 25.831,91.072C36.314,91.301 47.444,91.974 50,91.974C52.556,91.974 63.686,91.301 74.169,91.072C72.004,74.392 70.776,57.179 72.283,38.416L74.062,44.206L88.621,40.664C84.469,29.859 81.216,15.497 81.216,15.497C81.216,15.497 79.974,12.144 62.049,5.058C57.884,8.247 55.482,9.485 50,9.485Z',
    strokeWidth: 3.96,
    text: { x: 50, y: 48, size: 25 },
  },
}

/** The token badge is authored in this square coordinate space. */
export const TOKEN_VIEW = 100
/** Vertical/horizontal stripe period (100-space). */
export const TOKEN_STRIPE_PERIOD = 20
/** Width of the lone band for the single-stripe fills (100-space). */
export const TOKEN_SINGLE_STRIPE = 36
/** Checkerboard square size (100-space). */
export const TOKEN_CHECKER_SIZE = 14
/** Label font for tokens — shared by the rendered SVG label and the inline
 *  editor so they match exactly. (Loaded by the host; falls back to sans-serif.) */
export const TOKEN_FONT = "'Asap Condensed', system-ui, sans-serif"
export const TOKEN_FONT_WEIGHT = 600
/** Under-badge caption: a FIXED on-screen size (px), independent of the token's
 *  size and the board's fit-scale — the renderer divides by the px-per-board-unit
 *  it's given (falls back to board units when none is provided, e.g. export). */
export const TOKEN_LABEL_PX = 14
/** Gap (px) between the badge bottom and the caption baseline. */
export const TOKEN_LABEL_GAP_PX = 3
/** Shown when a token's `label` is empty. */
export const TOKEN_LABEL_PLACEHOLDER = 'Player'

// ── Text element ─────────────────────────────────────────────────────────────
// The font/line-height/padding are shared by the SVG renderer (ElementView), the
// designer's box measurement, and the inline editor's overlay <textarea>, so all
// three agree exactly. A system font (no webfont dependency) keeps canvas
// measureText and SVG rendering in lockstep.
export const TEXT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
export const TEXT_FONT_WEIGHT = 400
/** Weight used when a text element is bold. */
export const TEXT_FONT_WEIGHT_BOLD = 800
/** Line box height as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.25
/** Padding (board units) between the text bbox and the background rectangle. */
export const TEXT_PADDING = 5
export const TEXT_MIN_FONT = 2
export const TEXT_MAX_FONT = 200
export const DEFAULT_TEXT_FONT_SIZE = 24
export const DEFAULT_TEXT_COLOR = '#000000'
/** Default text background: white at 50% opacity (#rrggbbaa). */
export const DEFAULT_TEXT_BG = '#ffffff80'

/** Corner radius (board units) of a text element's background rectangle. */
export function textBoxRadius(el: TextElement): number {
  return Math.min(el.height / 2, Math.max(6, el.fontSize * 0.3))
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
  // A curved/zigzag/double polyline's bbox must cover the bézier overshoot (and
  // the wave amplitude / parallel offset), not just the anchors.
  if (el.type === 'polyline' && (el.curve || el.zigzag || el.double) && el.points.length >= 2) {
    const b = curveBounds(el.points, el.closed)
    if (el.zigzag) {
      const { offset } = waveParams(el)
      return { x: b.x - offset, y: b.y - offset, width: b.width + 2 * offset, height: b.height + 2 * offset }
    }
    if (el.double) {
      // Arrowheads overhang to ±linesOffset; the plain strokes only to ±half.
      const arrowed = !el.closed && (el.startTip === 'arrow' || el.endTip === 'arrow')
      const m = arrowed ? el.linesOffset : el.linesOffset / 2
      return { x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m }
    }
    return b
  }
  if (el.type === 'polyline' || el.type === 'draw') {
    if (el.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
    const xs = el.points.map((p) => p[0])
    const ys = el.points.map((p) => p[1])
    return normalizeBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
  }
  // 3D elements (arrow / object) have no SVG box — they live in the 3D overlay;
  // the designer computes their screen bounds by projecting. Empty box here.
  if (el.type === 'arrow3d' || el.type === 'object3d') return { x: 0, y: 0, width: 0, height: 0 }
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

/** A finite `[x, z]` ground anchor, or undefined (dropped) if malformed. */
function parseGround(v: unknown): [number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined
  const x = num(v[0])
  const z = num(v[1])
  return x === null || z === null ? undefined : [x, z]
}

/** An array of `[x, z]` ground anchors (one per polyline point), or undefined if
 *  malformed/empty — any bad entry drops the whole array (it must stay parallel
 *  to `points`). */
function parseGroundArray(v: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined
  const out: Array<[number, number]> = []
  for (const p of v) {
    const g = parseGround(p)
    if (!g) return undefined
    out.push(g)
  }
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
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
    locked: o.locked === true,
    transform: parseTransform(o.transform),
    stroke: str(o.stroke, '#000000'),
    strokeWidth: num(o.strokeWidth) ?? 3,
    strokeStyle: (o.strokeStyle === 'dashed' || o.strokeStyle === 'dotted' ? o.strokeStyle : 'solid') as StrokeStyle,
    fill: str(o.fill, 'transparent'),
    fillStyle: (o.fillStyle === 'striped' ? 'striped' : 'solid') as FillStyle,
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
    return { ...base, type: 'polyline', points: [[x1, y1], [x2, y2]], closed: false, curve: false, zigzag: false, waveLength: DEFAULT_WAVE_LENGTH, waveAmplitude: DEFAULT_WAVE_AMPLITUDE, double: false, linesOffset: DEFAULT_LINES_OFFSET, startTip: 'none', endTip: 'none' }
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
    const wl = num(o.waveLength)
    const wa = num(o.waveAmplitude)
    const lo = num(o.linesOffset)
    return {
      ...base,
      type: 'polyline',
      points,
      closed: o.closed === true,
      curve: o.curve === true,
      zigzag: o.zigzag === true,
      waveLength: wl === null ? DEFAULT_WAVE_LENGTH : clamp(wl, WAVE_LENGTH_MIN, WAVE_LENGTH_MAX),
      waveAmplitude: wa === null ? DEFAULT_WAVE_AMPLITUDE : clamp(wa, 0, WAVE_AMPLITUDE_MAX),
      double: o.double === true,
      linesOffset: lo === null ? DEFAULT_LINES_OFFSET : clamp(lo, LINES_OFFSET_MIN, LINES_OFFSET_MAX),
      startTip: parseTip(o.startTip),
      endTip: parseTip(o.endTip),
      ground: parseGroundArray(o.ground),
      tape: o.tape === true || undefined,
      oval: o.oval === true || undefined,
    }
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
    return { ...base, type: 'draw', points, ground: parseGroundArray(o.ground) }
  }
  if (o.type === 'figure') {
    const figureId = typeof o.figureId === 'string' ? o.figureId : null
    const width = num(o.width)
    const height = num(o.height)
    if (!figureId || width === null || height === null) return null
    return { ...base, type: 'figure', figureId, x: num(o.x) ?? 0, y: num(o.y) ?? 0, width, height, colors: parseColors(o.colors), mirror: o.mirror === true, ball: o.ball === true || undefined, ground: parseGround(o.ground), sizeM: num(o.sizeM) ?? undefined }
  }
  if (o.type === 'token') {
    const width = num(o.width)
    const height = num(o.height)
    if (width === null || height === null) return null
    const fills: TokenFill[] = ['solid', 'vstripes', 'hstripes', 'vstripe', 'hstripe', 'checker', 'plaid']
    return {
      ...base,
      type: 'token',
      x: num(o.x) ?? 0,
      y: num(o.y) ?? 0,
      width,
      height,
      shape: o.shape === 'jersey' ? 'jersey' : 'token',
      tokenFill: fills.includes(o.tokenFill as TokenFill) ? (o.tokenFill as TokenFill) : 'solid',
      color1: str(o.color1, '#ebebeb'),
      color2: str(o.color2, '#1e1e1e'),
      textColor: str(o.textColor, '#111111'),
      text: typeof o.text === 'string' ? o.text : '',
      label: typeof o.label === 'string' ? o.label : '',
      showLabel: o.showLabel === true,
      ground: parseGround(o.ground),
      sizeM: num(o.sizeM) ?? undefined,
    }
  }
  if (o.type === 'text') {
    const width = num(o.width)
    const height = num(o.height)
    if (width === null || height === null) return null
    const aligns: TextAlign[] = ['left', 'center', 'right']
    const fs = num(o.fontSize)
    return {
      ...base,
      type: 'text',
      x: num(o.x) ?? 0,
      y: num(o.y) ?? 0,
      width,
      height,
      text: typeof o.text === 'string' ? o.text : '',
      textColor: str(o.textColor, DEFAULT_TEXT_COLOR),
      bgColor: str(o.bgColor, DEFAULT_TEXT_BG),
      fontSize: fs === null ? DEFAULT_TEXT_FONT_SIZE : clamp(fs, TEXT_MIN_FONT, TEXT_MAX_FONT),
      align: aligns.includes(o.align as TextAlign) ? (o.align as TextAlign) : 'center',
      bold: o.bold === true,
      fontFamily: typeof o.fontFamily === 'string' ? o.fontFamily : undefined,
      italic: o.italic === true || undefined,
      text3d: o.text3d === true || undefined,
      orientation: [0, 90, 180, 270].includes(o.orientation as number) ? (o.orientation as number) : undefined,
      ground: parseGround(o.ground),
    }
  }
  if (o.type === 'arrow3d') {
    return {
      ...base,
      type: 'arrow3d',
      fill: str(o.fill, ARROW3D_DEFAULTS.fill),
      x: num(o.x) ?? ARROW3D_DEFAULTS.x,
      z: num(o.z) ?? ARROW3D_DEFAULTS.z,
      y: num(o.y) ?? ARROW3D_DEFAULTS.y,
      splineWidth: num(o.splineWidth) ?? ARROW3D_DEFAULTS.splineWidth,
      splineHeight: num(o.splineHeight) ?? ARROW3D_DEFAULTS.splineHeight,
      splineLength: num(o.splineLength) ?? ARROW3D_DEFAULTS.splineLength,
      stickWidth: num(o.stickWidth) ?? ARROW3D_DEFAULTS.stickWidth,
      thickness: num(o.thickness) ?? ARROW3D_DEFAULTS.thickness,
      tipWidth: num(o.tipWidth) ?? ARROW3D_DEFAULTS.tipWidth,
      tipLength: num(o.tipLength) ?? ARROW3D_DEFAULTS.tipLength,
      opacity: clamp(num(o.opacity) ?? ARROW3D_DEFAULTS.opacity, 0, 1),
    }
  }
  if (o.type === 'object3d') {
    const objectId = typeof o.objectId === 'string' ? o.objectId : null
    if (!objectId) return null
    return {
      ...base,
      type: 'object3d',
      objectId,
      x: num(o.x) ?? OBJECT3D_DEFAULTS.x,
      z: num(o.z) ?? OBJECT3D_DEFAULTS.z,
      rotation: num(o.rotation) ?? OBJECT3D_DEFAULTS.rotation,
      size: num(o.size) ?? OBJECT3D_DEFAULTS.size,
      useGlobalSize: o.useGlobalSize !== false,
      colors: parseColors(o.colors),
    }
  }
  return null
}

/** Default placement/size for a fresh 3D object (pitch-centre, unrotated). */
export const OBJECT3D_DEFAULTS = {
  x: 52.5,
  z: 34,
  rotation: 0,
  size: 1, // 1 = the global object scale (custom size is relative to it)
} as const

/** Default geometry/appearance for a new 3D arrow (from YouCoach Video Analysis,
 *  with x/z/y placement chosen so a fresh arrow lands in view on the board). */
export const ARROW3D_DEFAULTS = {
  x: 0,
  z: 0,
  y: 0,
  splineWidth: 8,
  splineHeight: 3,
  splineLength: 1,
  stickWidth: 0.3,
  thickness: 0.05,
  tipWidth: 0.075,
  tipLength: 0.25,
  fill: '#FF0000',
  opacity: 1,
} as const

function parseTip(v: unknown): ArrowTip {
  return v === 'arrow' ? 'arrow' : 'none'
}

function parseColors(v: unknown): Record<string, string> | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val
  return Object.keys(out).length ? out : undefined
}

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BoardCanvas,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  ElementView,
  getElementBounds,
  getLocalBounds,
  normalizeBox,
  TOKEN_GEOMETRY,
  TOKEN_VIEW,
  TOKEN_FONT,
  TOKEN_FONT_WEIGHT,
  TOKEN_LABEL_PX,
  TOKEN_LABEL_GAP_PX,
  TEXT_FONT,
  TEXT_FONT_WEIGHT,
  TEXT_FONT_WEIGHT_BOLD,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  TEXT_MIN_FONT,
  TEXT_MAX_FONT,
  type ArrowTip,
  type BoardElement,
  type ElementTransform,
  type Box,
  type Arrow3DElement,
  ARROW3D_DEFAULTS,
  IDENTITY_TRANSFORM,
} from '@youcoach-board/core'
import { useEditorStore } from '../store/context'
import { isCreationTool } from '../store/editorStore'
import {
  clientToBoard,
  makeFigure,
  makeLine,
  makePolyline,
  makeDraw,
  makeToken,
  makeText,
  measureTextBox,
  nextTokenText,
  TOKEN_SIZE,
  squareCorner,
  applyFigureStyle,
  isDragSignificant,
  boxesIntersect,
  boxContains,
  toolElementType,
  toolEndTip,
  toolIsCurved,
  toolIsZigzag,
  toolIsDouble,
  isLineTool,
  MIN_DRAG,
  type DraftType,
  type Point,
} from '../lib/draw'
import { computeResize, rotationFor, boardToElement, elementToBoard, localCorners, boardCorners, tokenLabelBand, type CornerId } from '../lib/geometry-2d'
import { SelectionHandles, GroupHandles, SELECTION_PAD_PX, type HandleId } from './SelectionHandles'
import { FigureView } from './FigureView'
import { BackgroundView } from './BackgroundView'
import { computeSnap, snapResize, type SnapResult, type SnapElement, type SnapMark, type SnapLine } from '../lib/snapping'
import { Arrow3DLayer, type Arrow3DLayerHandle } from './Arrow3DLayer'
import { FieldHomographyLayer } from './FieldHomographyLayer'
import { FieldCameraLayer } from './FieldCameraLayer'
import { arrow3DHandlePositions, arrow3DHandlePositionsVia, arrow3DWorldHandles, boardToApexHeight, boardToGround, boardToHeight, makeArrow3DCamera } from '../lib/arrow3d'
import { fieldHomography, fieldCamera, PITCH_MODELS } from '../lib/field-reference'
import { makeCalibratedCamera } from '../lib/field-camera'
import { boardToMetric, worldToBoard } from '../lib/homography-camera'
import { cn } from '../lib/cn'

const MIN_SIZE = 6 // smallest box dimension a resize can produce (board units)
// The corner diagonally opposite a resize handle (stays pinned during a text resize).
const OPPOSITE_CORNER: Record<CornerId, CornerId> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }
const CANVAS_KEEP = 28 // min board units of a moved figure that must stay on-canvas
const POLY_END_R_PX = 7 // on-screen radius of the first/last polyline finish dots
const FREEHAND_MIN_STEP = 2 // min board-unit gap between captured freehand samples
const MOVE_THRESHOLD_PX = 4 // on-screen drag distance before a move engages
const SNAP_PX = 6 // on-screen distance within which a move snaps to another object
const BG_MOVE_HANDLE_PX = 72 // on-screen size of the background pan handle (icon viewBox 46×46)
// 4-way move arrows (assets/move_background.svg), centered in a 46×46 viewBox.
const BG_MOVE_PATH =
  'M18.648,18.648L18.648,6.688L15.815,6.688L22.504,0L29.192,6.688L26.36,6.688L26.36,18.648L38.319,18.648L38.319,15.815L45.008,22.504L38.319,29.192L38.319,26.36L26.36,26.36L26.36,38.319L29.192,38.319L22.504,45.008L15.815,38.319L18.648,38.319L18.648,26.36L6.688,26.36L6.688,29.192L0,22.504L6.688,15.815L6.688,18.648L18.648,18.648Z'


interface Draft {
  type: DraftType
  start: Point
  current: Point
  // For 'line' drafts: the end arrow tip (arrow tool → 'arrow').
  endTip: ArrowTip
  // For 'line' drafts: draw a smooth (curved) line (elbow / zigzag / double tools).
  curve: boolean
  // For 'line' drafts: wave (zigzag-arrow) / parallel (double-arrow) render style.
  zigzag: boolean
  double: boolean
  // Shift held — snap a line's angle to 15° steps (see snapLineEnd).
  snap: boolean
}

// Snap a line's end so its angle from `start` is a multiple of 15° (so it also
// locks exactly horizontal/vertical), preserving length. Used while drawing with
// Shift held.
function snapLineEnd(start: Point, current: Point): Point {
  const dx = current.x - start.x
  const dy = current.y - start.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return current
  const step = Math.PI / 12 // 15°
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: start.x + Math.cos(ang) * len, y: start.y + Math.sin(ang) * len }
}

// In-progress polyline: committed vertices plus the live cursor (preview seg).
// `endTip` carries the tool's arrow tip onto the finished open polyline.
interface PolyDraft {
  points: Point[]
  cursor: Point
  endTip: ArrowTip
  // Draw a smooth (curved) multi-point line (elbow / zigzag / double tools).
  curve: boolean
  // Wave (zigzag-arrow) / parallel (double-arrow) render style.
  zigzag: boolean
  double: boolean
  // Shift held — angle-snap the next segment (from the last point) to 15°.
  snap: boolean
}

// The polyline draft's live end point: the cursor, angle-snapped to the last
// placed point when Shift is held.
function polyDraftEnd(d: PolyDraft): Point {
  return d.snap && d.points.length > 0 ? snapLineEnd(d.points[d.points.length - 1], d.cursor) : d.cursor
}

// A move can drag several elements at once (group move). We snapshot each
// element's transform at drag start, then offset all by the same delta.
interface MoveState {
  ids: string[]
  start: Point
  current: Point
  origins: Record<string, ElementTransform>
  // The move stays inert until the pointer travels MOVE_THRESHOLD_PX (so a click
  // that selects doesn't nudge the figure). Sticky once engaged.
  engaged: boolean
}

// A resize / rotate / polyline-vertex gesture on one element. (A straight line's
// endpoints are just its two polyline vertices, so they use the 'point' kind.)
interface Gesture {
  // 'point' drags an existing vertex; 'anchor' inserts a new vertex on a segment
  // (splitting it / adding a curve point) and drags it.
  kind: 'resize' | 'rotate' | 'point' | 'anchor'
  id: string
  handle: HandleId
  box0: Box
  t0: ElementTransform
  start: Point
  current: Point
  snap: boolean // shift — rotation snap / proportional resize
  alt: boolean // option/alt — specular (from-center) resize
}

// A resize / rotate gesture on a MULTI-selection's group box. Resize scales every
// element uniformly about the opposite corner; rotate spins them about the group
// center. We snapshot each element's transform; geometry is untouched (only the
// transform changes), so the same op is reversible.
interface GroupGesture {
  kind: 'resize' | 'rotate'
  handle: CornerId | 'rotate'
  box0: Box // group union (board space, unpadded) at start
  start: Point
  current: Point
  snap: boolean
  t0: Record<string, ElementTransform>
}

const GROUP_OPP: Record<CornerId, CornerId> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }

function boxCorner(box: Box, id: CornerId): Point {
  if (id === 'nw') return { x: box.x, y: box.y }
  if (id === 'ne') return { x: box.x + box.width, y: box.y }
  if (id === 'se') return { x: box.x + box.width, y: box.y + box.height }
  return { x: box.x, y: box.y + box.height }
}

interface Marquee {
  start: Point
  current: Point
  additive: boolean
  base: string[]
}

// The editing surface: turns pointer gestures into create / select / move /
// resize / rotate against the editor store, and renders the live preview +
// selection chrome.
//
//   - click an element → select it (and start a move); shift-click toggles;
//   - drag empty space → marquee-select (live; direction = contain vs touch);
//   - drag a selected element → group move (one undo step);
//   - drag a corner handle → resize (anchored at the opposite corner, even when
//     rotated); drag the top circle → rotate; drag a polyline vertex (a straight
//     line's endpoints are its two vertices) → reshape.
// A faint alignment grid drawn in board coordinates, in the background layer
// (under the elements). Toggled with the "G" shortcut.
// Eraser: on-screen radius of the erase circle (px) — a 13px dot. The tail keeps
// the last TAIL_MS of pointer path, so its length tracks speed and drops to zero
// when the pointer is still; capped so the array stays bounded on very fast drags.
const ERASER_RADIUS_PX = 6.5
const ERASER_TAIL_MS = 150
const ERASER_TAIL_MAX = 96
const ERASER_HEAD_R = ERASER_RADIUS_PX * 1.5 // tail-head dot, a little bigger than the pointer

interface TailPt {
  x: number
  y: number
  t: number
}

// A solid "comet" ribbon that follows the recent pointer path `pts` (so it bends
// around the cursor's trajectory): full half-width `r` at the head (newest point,
// the cursor) tapering to a point at the oldest. The head dot is drawn separately.
// Returns an SVG path `d` (board units), or '' when there's no meaningful tail.
function eraserTailPath(pts: TailPt[], r: number): string {
  const n = pts.length
  if (n < 2) return ''
  const left: string[] = []
  const right: string[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    let dx = b.x - a.x
    let dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const h = r * (i / (n - 1)) // 0 at the oldest (tip) → r at the head (cursor)
    left.push(`${pts[i].x - dy * h},${pts[i].y + dx * h}`)
    right.push(`${pts[i].x + dy * h},${pts[i].y - dx * h}`)
  }
  return `M ${left.join(' L ')} L ${right.reverse().join(' L ')} Z`
}

// ── Lasso hit-testing ────────────────────────────────────────────────────────
// Ray-cast: is `pt` inside the (implicitly closed) polygon `poly`?
function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
// Do segments p1p2 and p3p4 cross?
function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const side = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = side(p3, p4, p1)
  const d2 = side(p3, p4, p2)
  const d3 = side(p1, p2, p3)
  const d4 = side(p1, p2, p4)
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0
}
// Does the closed lasso loop touch the axis-aligned box (enclose it, be drawn over
// it, or cross one of its edges)?
function lassoHitsBox(poly: Point[], b: Box): boolean {
  if (poly.length < 2) return false
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ]
  if (corners.some((c) => pointInPolygon(c, poly))) return true // box enclosed
  if (poly.some((p) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height)) return true // loop over box
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const c = poly[(i + 1) % poly.length] // includes the closing edge
    for (let k = 0; k < 4; k++) if (segmentsIntersect(a, c, corners[k], corners[(k + 1) % 4])) return true
  }
  return false
}

const GRID_STEP = 60 // board units → a 20×15 grid over the 1200×900 board
function BoardGrid() {
  const lines: React.ReactNode[] = []
  for (let x = GRID_STEP; x < BOARD_WIDTH; x += GRID_STEP) lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={BOARD_HEIGHT} />)
  for (let y = GRID_STEP; y < BOARD_HEIGHT; y += GRID_STEP) lines.push(<line key={`h${y}`} x1={0} y1={y} x2={BOARD_WIDTH} y2={y} />)
  return (
    <g stroke="currentColor" strokeOpacity={0.14} strokeWidth={1} pointerEvents="none">
      {lines}
    </g>
  )
}

export function InteractiveBoard({ backgroundMode = false, homographyMode = false, cameraMode = false, showGrid = false }: { backgroundMode?: boolean; homographyMode?: boolean; cameraMode?: boolean; showGrid?: boolean }) {
  const doc = useEditorStore((s) => s.doc)
  const activeTool = useEditorStore((s) => s.activeTool)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const tokenDefaults = useEditorStore((s) => s.tokenDefaults)
  const textDefaults = useEditorStore((s) => s.textDefaults)
  const lastTokenId = useEditorStore((s) => s.lastTokenId)
  const setSelection = useEditorStore((s) => s.setSelection)
  const createFigure = useEditorStore((s) => s.createFigure)
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  const removeElements = useEditorStore((s) => s.removeElements)
  const setBackground = useEditorStore((s) => s.setBackground)
  const beginTransaction = useEditorStore((s) => s.beginTransaction)
  const commitTransaction = useEditorStore((s) => s.commitTransaction)
  const updateElements = useEditorStore((s) => s.updateElements)
  const duplicateInPlace = useEditorStore((s) => s.duplicateInPlace)
  const toolDefaults = useEditorStore((s) => s.toolDefaults)
  const viewport = useEditorStore((s) => s.viewport)
  const snapToObjects = useEditorStore((s) => s.snapToObjects)
  const keepToolActive = useEditorStore((s) => s.keepToolActive)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)
  const panBy = useEditorStore((s) => s.panBy)
  const zoomBy = useEditorStore((s) => s.zoomBy)
  const viewBox = `${viewport.panX} ${viewport.panY} ${BOARD_WIDTH / viewport.zoom} ${BOARD_HEIGHT / viewport.zoom}`

  const svgRef = useRef<SVGSVGElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Last vertex pointer-down (handle + event timestamp) to detect a double-tap
  // for vertex removal (the DOM dblclick is eaten by setPointerCapture).
  const lastVertexTapRef = useRef<{ handle: HandleId; t: number } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [move, setMove] = useState<MoveState | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [groupGesture, setGroupGesture] = useState<GroupGesture | null>(null)
  const [polyDraft, setPolyDraft] = useState<PolyDraft | null>(null)
  // In-progress freehand stroke: the captured points (board coords).
  const [freeDraft, setFreeDraft] = useState<Point[] | null>(null)
  // Inline token editing: which token + which field (the badge number or the
  // under-badge label) + the in-progress text. Double-click / touch long-press;
  // committed on Enter/blur.
  type EditField = 'text' | 'label'
  // `created` marks a text element that was made by this edit session (so an empty
  // blur/escape discards it entirely). `text` is the CURRENT typed value.
  const [editing, setEditing] = useState<{ id: string; field: EditField; text: string; created?: boolean } | null>(null)
  // Original text of a text element at edit start, to restore on Escape.
  const origTextRef = useRef<string>('')
  // Screen placement of the inline editor (computed in an effect — needs the CTM).
  const [editPos, setEditPos] = useState<{ left: number; top: number; width: number; font: number; color: string } | null>(null)
  // Screen placement of the text-element editor overlay (recomputed live as the
  // box grows). Kept separate because a text edit sizes to the whole box.
  const [textBox, setTextBox] = useState<{ left: number; top: number; width: number; height: number; font: number; pad: number; align: 'left' | 'center' | 'right'; color: string; bold: boolean } | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last token pointer-down (id + field + timestamp) to detect a double-tap
  // manually — the native dblclick can't fire once the selection frame covers the
  // token (the two clicks land on different DOM nodes). `pressTokenField` records
  // which text the current press landed on (badge number vs label).
  const tokenTapRef = useRef<{ id: string; field: EditField; t: number } | null>(null)
  const pressTokenFieldRef = useRef<EditField>('text')
  // In-progress background pan (dragging the move handle): the pointer-down
  // board point + the field's offset at that moment.
  const [bgPan, setBgPan] = useState<{ start: Point; origin: [number, number] } | null>(null)
  // Screen pixels per board unit (CTM x-scale); selection chrome divides by it
  // to stay a constant on-screen size. Recomputed when the SVG resizes.
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = () => {
      const m = svg.getScreenCTM()
      if (m && m.a) setScale(m.a)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(svg)
    return () => ro.disconnect()
    // Re-measure when the viewBox (zoom/pan) changes, not just on resize.
  }, [viewBox])

  // Space-bar (or the Hand tool) turns the board into a pan surface: a drag
  // overlay translates the viewport. Space is tracked globally; released on blur.
  const [spaceHeld, setSpaceHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false)
    }
    const blur = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const panActive = spaceHeld || activeTool === 'hand'
  const panLast = useRef<{ x: number; y: number } | null>(null)
  function panDown(e: React.PointerEvent) {
    e.stopPropagation() // pan swallows the gesture: no marquee/selection/create
    panLast.current = { x: e.clientX, y: e.clientY }
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort; the full-board overlay still receives moves */
    }
  }
  function panMove(e: React.PointerEvent) {
    if (!panLast.current) return
    e.stopPropagation()
    const dx = e.clientX - panLast.current.x
    const dy = e.clientY - panLast.current.y
    panLast.current = { x: e.clientX, y: e.clientY }
    if (scale) panBy(-dx / scale, -dy / scale) // drag follows the content
  }
  function panEnd() {
    panLast.current = null
  }

  // ⌘/Ctrl + wheel (and trackpad pinch, which sends ctrlKey) zooms toward the
  // cursor. Registered non-passively so the page doesn't scroll/zoom instead.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const p = clientToBoard(svg, e.clientX, e.clientY)
      zoomBy(Math.exp(-e.deltaY * 0.0015), { x: p.x, y: p.y })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  // The element currently being inline-edited (if it's a text element) — recompute
  // its editor overlay box whenever its geometry (grows as you type) or the zoom
  // changes. Kept in an effect so the CTM/refs aren't read during render.
  const editingEl = editing ? doc.elements.find((e) => e.id === editing.id) : undefined
  const editingTextEl = editingEl && editingEl.type === 'text' ? editingEl : null
  useEffect(() => {
    const place = () => {
      const el = editingTextEl
      if (!el) return setTextBox(null)
      const svg = svgRef.current
      const cont = containerRef.current
      if (!svg || !cont) return
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const sp = new DOMPoint(el.x + el.transform.x, el.y + el.transform.y).matrixTransform(ctm)
      const r = cont.getBoundingClientRect()
      const sc = el.transform.scale * ctm.a
      setTextBox({ left: sp.x - r.left, top: sp.y - r.top, width: el.width * sc, height: el.height * sc, font: el.fontSize * sc, pad: TEXT_PADDING * sc, align: el.align, color: el.textColor, bold: el.bold })
    }
    place()
  }, [editingTextEl, scale])

  // Abandon any in-progress polyline if the user leaves the line/arrow tools
  // (React's "adjust state when a value changes during render" pattern).
  const [polyTool, setPolyTool] = useState(activeTool)
  if (polyTool !== activeTool) {
    setPolyTool(activeTool)
    if (polyDraft && !isLineTool(activeTool)) setPolyDraft(null)
  }

  // ESC ends a polyline open (capture phase + stopPropagation so the shell's
  // global Escape handler doesn't also fire and switch tools mid-finish).
  useEffect(() => {
    if (!polyDraft) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (polyDraft.points.length >= 2) createFigure(applyFigureStyle(makePolyline(crypto.randomUUID(), polyDraft.points, false, 'none', polyDraft.endTip, polyDraft.curve, polyDraft.zigzag, polyDraft.double), toolDefaults))
      setPolyDraft(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [polyDraft, createFigure, toolDefaults])

  const creating = isCreationTool(activeTool)
  const eraserTool = activeTool === 'eraser'
  const lassoTool = activeTool === 'lasso'
  const arrow3dTool = activeTool === 'arrow3d'
  const selectedSet = new Set(selectedIds)

  // ── 3D arrows (three.js overlay) ────────────────────────────────────────────
  // The WebGL layer's imperative handle (for click hit-testing), and a fixed
  // projection camera (no view-offset) used for ground raycasts / handle math —
  // it matches the projection the layer uses for full-board coordinates.
  const arrow3dLayerRef = useRef<Arrow3DLayerHandle>(null)
  // Field-perspective calibration for arrows. Precedence: a hand-posed camera wins
  // (real 3D height + shadow), else a homography (ground-exact, faked height), else
  // the default fixed near-ortho camera. `arrow3dCam` is the calibrated camera when
  // one exists, so the camera-parameterised arrow math (ground/handles/height) all
  // works unchanged; homography still uses its own custom projection.
  const fieldCamCfg = fieldCamera(doc.background.fieldSvg)
  const fieldH = fieldHomography(doc.background.fieldSvg)
  const useHomography = !!fieldH && !fieldCamCfg
  const fixedCam = useState(() => makeArrow3DCamera())[0]
  const arrow3dCam = useMemo(() => (fieldCamCfg ? makeCalibratedCamera(fieldCamCfg) : fixedCam), [fieldCamCfg, fixedCam])
  // Board point → ground position: metric metres under a field camera/homography.
  function arrow3dGround(p: Point): { x: number; z: number } | null {
    return useHomography ? boardToMetric(fieldH!, p.x, p.y) : boardToGround(p.x, p.y, arrow3dCam)
  }
  // The three handle board positions (tail, head, apex) for an arrow.
  function arrow3dHandleBoard(el: Arrow3DElement): { x: number; y: number }[] {
    if (useHomography) {
      const [t, h, a] = arrow3DWorldHandles(el.x, el.y, el.z, el.splineWidth, el.splineHeight)
      return [worldToBoard(fieldH!, t.x, t.y, t.z), worldToBoard(fieldH!, h.x, h.y, h.z), worldToBoard(fieldH!, a.x, a.y, a.z)]
    }
    if (fieldCamCfg) return arrow3DHandlePositionsVia(arrow3dCam, el.x, el.y, el.z, el.splineWidth, el.splineHeight)
    return arrow3DHandlePositions(el.x, el.y, el.z, el.splineWidth, el.splineHeight)
  }
  // Defaults for a new arrow — metric metres when a field camera or homography is
  // active (both view the metric pitch), fixed-camera world units otherwise. Sizes
  // scale with the pitch length (soccer 105 = 1×) so an arrow isn't huge on a small
  // futsal court / training grid.
  const arrow3dMetric = !!(fieldCamCfg || fieldH)
  const pitchK = fieldCamCfg ? PITCH_MODELS[fieldCamCfg.ref].size[0] / 105 : 1
  const arrow3dDefaults = arrow3dMetric
    ? { ...ARROW3D_DEFAULTS, splineWidth: 18 * pitchK, splineHeight: 4 * pitchK, stickWidth: 1.2 * pitchK, thickness: 0.3 * pitchK, tipWidth: 3 * pitchK, tipLength: 5 * pitchK }
    : ARROW3D_DEFAULTS
  // Draft while drag-creating (tail + head on the ground), preview-rendered.
  const [arrow3dDraft, setArrow3dDraft] = useState<{ tail: { x: number; z: number }; head: { x: number; z: number } } | null>(null)
  // In-progress edit of one arrow (drag a handle or the body).
  const [arrow3dGesture, setArrow3dGesture] = useState<{ id: string; kind: 'tail' | 'head' | 'apex' | 'body'; orig: Arrow3DElement; grabGround: { x: number; z: number } } | null>(null)
  const arrow3dElements = doc.elements.filter((e): e is Arrow3DElement => e.type === 'arrow3d')

  // Build a fresh 3D arrow element with the given ground placement.
  function makeArrow3D(x: number, z: number, y: number, splineWidth: number): Arrow3DElement {
    return {
      id: crypto.randomUUID(),
      type: 'arrow3d',
      transform: { ...IDENTITY_TRANSFORM },
      stroke: '#000000',
      strokeWidth: 1,
      strokeStyle: 'solid',
      fill: arrow3dDefaults.fill,
      fillStyle: 'solid',
      x,
      z,
      y,
      splineWidth,
      splineHeight: arrow3dDefaults.splineHeight,
      splineLength: arrow3dDefaults.splineLength,
      stickWidth: arrow3dDefaults.stickWidth,
      thickness: arrow3dDefaults.thickness,
      tipWidth: arrow3dDefaults.tipWidth,
      tipLength: arrow3dDefaults.tipLength,
      opacity: arrow3dDefaults.opacity,
    }
  }

  // Placement (x, z, y-rotation, splineWidth) for a tail→head pair on the ground.
  function arrow3dPlacement(tail: { x: number; z: number }, head: { x: number; z: number }) {
    const dx = tail.x - head.x
    const dz = tail.z - head.z
    return { x: tail.x, z: tail.z, y: Math.atan2(dx, dz), splineWidth: Math.max(0.3, Math.hypot(dx, dz)) }
  }

  // Update the dragged arrow's fields live (inside the gesture's transaction).
  function editArrow3D(g: NonNullable<typeof arrow3dGesture>, patch: Partial<Arrow3DElement>) {
    const before: Partial<Arrow3DElement> = {}
    for (const k of Object.keys(patch) as (keyof Arrow3DElement)[]) (before as Record<string, unknown>)[k] = g.orig[k]
    updateElements([{ id: g.id, before, after: patch }])
  }

  // Handle a move of the current 3D-arrow gesture to board point `p`.
  function dragArrow3D(g: NonNullable<typeof arrow3dGesture>, p: Point) {
    if (g.kind === 'apex') {
      const apex = arrow3DWorldHandles(g.orig.x, g.orig.y, g.orig.z, g.orig.splineWidth, g.orig.splineHeight)[2]
      if (fieldCamCfg) {
        // Real camera: drag intersects the vertical plane through the apex's base.
        editArrow3D(g, { splineHeight: boardToApexHeight(p.x, p.y, apex.x, apex.z, arrow3dCam) })
      } else if (useHomography) {
        // Local vertical scale (board px per metre of height) about the apex.
        const g0 = worldToBoard(fieldH!, apex.x, 0, apex.z)
        const perM = g0.y - worldToBoard(fieldH!, apex.x, 1, apex.z).y
        editArrow3D(g, { splineHeight: Math.abs(perM) > 1e-4 ? Math.max(0, (g0.y - p.y) / perM) : g.orig.splineHeight })
      } else {
        editArrow3D(g, { splineHeight: boardToHeight(p.x, p.y, apex.z, arrow3dCam) })
      }
      return
    }
    const ground = arrow3dGround(p)
    if (!ground) return
    if (g.kind === 'body') {
      editArrow3D(g, { x: g.orig.x + (ground.x - g.grabGround.x), z: g.orig.z + (ground.z - g.grabGround.z) })
      return
    }
    // tail or head drag: recompute placement from the tail/head ground pair.
    const headWorld = arrow3DWorldHandles(g.orig.x, g.orig.y, g.orig.z, g.orig.splineWidth, g.orig.splineHeight)[1]
    const tail = g.kind === 'tail' ? ground : { x: g.orig.x, z: g.orig.z }
    const head = g.kind === 'head' ? ground : { x: headWorld.x, z: headWorld.z }
    const pl = arrow3dPlacement(tail, head)
    editArrow3D(g, pl)
  }

  // Lasso: free-draw a loop; every element the (implicitly closed) loop touches is
  // selected live and stays selected for the rest of the gesture (accumulated in a
  // ref so rapid moves read the latest). `lasso` holds the path for rendering.
  const lassoRef = useRef<{ pts: Point[]; ids: Set<string> } | null>(null)
  const [lasso, setLasso] = useState<Point[] | null>(null)
  // Add every element the current loop touches to the accumulated selection.
  function updateLassoHits() {
    const g = lassoRef.current
    if (!g) return
    for (const el of doc.elements) {
      if (g.ids.has(el.id) || el.type === 'arrow3d') continue // already selected, or a 3D arrow (no SVG box)
      const b = unionBounds([el])
      if (b && lassoHitsBox(g.pts, b)) g.ids.add(el.id)
    }
    setSelection([...g.ids])
  }

  // Eraser: on drag, elements the moving circle touches dim to opacity-25 and are
  // deleted on pointer-up. `ids` accumulates every touched element. `pts` is the
  // recent pointer path, timestamped: the tail is drawn as a ribbon along it (so it
  // bends around the cursor's path), full width at the head (cursor) tapering to a
  // point. Only the last TAIL_MS of movement is kept, so the tail's length tracks
  // speed and shrinks to zero when the pointer is still. The live gesture lives in a
  // ref (so rapid synchronous pointer events read the latest, not a stale render);
  // `erasing` gates the retract loop.
  const eraseRef = useRef<{ pts: TailPt[]; ids: Set<string> } | null>(null)
  const [erase, setErase] = useState<{ pts: TailPt[]; ids: Set<string> } | null>(null)
  const [erasing, setErasing] = useState(false)
  const syncErase = () => {
    const g = eraseRef.current
    setErase(g ? { pts: g.pts.slice(), ids: new Set(g.ids) } : null)
  }
  // Drop path points older than the window (always keeping the head), so the tail
  // retracts as the pointer slows and collapses to the cursor when it stops.
  const pruneTail = (now: number) => {
    const g = eraseRef.current
    if (!g) return
    const cutoff = now - ERASER_TAIL_MS
    const pts = g.pts.filter((pt, i) => pt.t >= cutoff || i === g.pts.length - 1)
    if (pts.length !== g.pts.length) g.pts = pts
  }
  // No pointer events fire while the pointer is held still, so this loop is what
  // ages out the tail once movement stops.
  useEffect(() => {
    if (!erasing) return
    let raf = 0
    const tick = () => {
      pruneTail(performance.now())
      syncErase()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [erasing])
  // Board-unit eraser radius from its fixed on-screen size.
  const eraseRadius = () => ERASER_RADIUS_PX / (scale || 1)
  // Ids of elements whose bounding box intersects the eraser circle at `p`.
  function elementsUnder(p: Point, r: number): string[] {
    const out: string[] = []
    for (const el of doc.elements) {
      if (el.type === 'arrow3d') continue // 3D arrows have no SVG box; not erasable this way
      const b = getElementBounds(el)
      const cx = Math.max(b.x, Math.min(p.x, b.x + b.width))
      const cy = Math.max(b.y, Math.min(p.y, b.y + b.height))
      const dx = p.x - cx
      const dy = p.y - cy
      if (dx * dx + dy * dy <= r * r) out.push(el.id)
    }
    return out
  }
  // Sample the segment a→b so a fast drag doesn't skip elements between frames.
  function eraseSegment(a: Point, b: Point, r: number): string[] {
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(dist / (r * 0.8)))
    const set = new Set<string>()
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      for (const id of elementsUnder({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r)) set.add(id)
    }
    return [...set]
  }
  // Entering the eraser drops any selection, so its chrome (frame/handles) doesn't
  // intercept the scrub — the board surface receives the erase gesture instead.
  useEffect(() => {
    if (eraserTool) setSelection([])
  }, [eraserTool, setSelection])

  // Clamp a move delta so the selection's union bounding box always keeps at
  // least CANVAS_KEEP units overlapping the canvas — a figure can never be
  // dragged entirely off-board (and lost). Linear in the delta, computed from
  // the union at the move's start (origin transforms).
  function clampMoveDelta(dx: number, dy: number): Point {
    if (!move) return { x: dx, y: dy }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const id of move.ids) {
      const el = doc.elements.find((e) => e.id === id)
      const o = move.origins[id]
      if (!el || !o) continue
      const b = getElementBounds({ ...el, transform: o } as BoardElement)
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.width)
      maxY = Math.max(maxY, b.y + b.height)
    }
    if (!Number.isFinite(minX)) return { x: dx, y: dy }
    const K = CANVAS_KEEP
    const loX = K - maxX
    const hiX = doc.width - K - minX
    const loY = K - maxY
    const hiY = doc.height - K - minY
    return {
      x: loX <= hiX ? Math.min(Math.max(dx, loX), hiX) : dx,
      y: loY <= hiY ? Math.min(Math.max(dy, loY), hiY) : dy,
    }
  }

  // ── Snap to objects (Excalidraw-style alignment) ──────────────────────────
  // An element's notable snap points (rotation-aware): the four corners + centre
  // for boxes, or the four axis-extremes (side midpoints) + centre for ellipses.
  function notablePoints(el: BoardElement): SnapMark[] {
    const [nw, ne, se, sw] = boardCorners(el)
    const center = { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 }
    const mid = (a: SnapMark, b: SnapMark): SnapMark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    if (el.type === 'ellipse') return [mid(nw, ne), mid(ne, se), mid(se, sw), mid(sw, nw), center]
    return [nw, ne, se, sw, center]
  }
  // Notable points of an axis-aligned box (used for a multi-selection's bbox).
  function boxPoints(b: Box): SnapMark[] {
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    return [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }, { x: cx, y: cy }]
  }

  // Snap offset + guides for the current move, or null when snapping is off /
  // the move hasn't engaged / there's nothing to snap. Boxes (for equidistance)
  // are rotation-aware AABBs; alignment uses each element's notable points. A
  // single element snaps by its own points; a multi-selection by its bbox's.
  function moveSnap(m: MoveState): SnapResult | null {
    if (!snapToObjects || !m.engaged) return null
    const originEls = m.ids
      .map((id) => {
        const el = doc.elements.find((e) => e.id === id)
        return el && m.origins[id] ? ({ ...el, transform: m.origins[id] } as BoardElement) : null
      })
      .filter((e): e is BoardElement => e !== null)
    const u = unionBounds(originEls)
    if (!u) return null
    const raw = clampMoveDelta(m.current.x - m.start.x, m.current.y - m.start.y)
    const movingBox: Box = { x: u.x + raw.x, y: u.y + raw.y, width: u.width, height: u.height }
    const movingPts = (originEls.length === 1 ? notablePoints(originEls[0]) : boxPoints(u)).map((p) => ({ x: p.x + raw.x, y: p.y + raw.y }))
    const moving: SnapElement = { box: movingBox, points: movingPts }
    const targets = doc.elements
      .filter((e) => !m.ids.includes(e.id) && e.type !== 'arrow3d')
      .map((e): SnapElement | null => {
        const b = unionBounds([e])
        return b ? { box: b, points: notablePoints(e) } : null
      })
      .filter((t): t is SnapElement => t !== null)
    return computeSnap(moving, targets, SNAP_PX / (scale || 1))
  }

  // The move delta actually applied: clamped to the canvas, then nudged by the
  // snap offset. Used by both the live preview and the pointer-up commit so they
  // always agree.
  function moveDelta(m: MoveState): Point {
    const raw = clampMoveDelta(m.current.x - m.start.x, m.current.y - m.start.y)
    const snap = moveSnap(m)
    return snap ? { x: raw.x + snap.dx, y: raw.y + snap.dy } : raw
  }

  // The resized element's notable points (rotation- and type-aware: ellipse radius
  // extremes, else corners) + its AABB, for a given handle pointer.
  function resizedNotable(el: BoardElement, g: Gesture, pointer: Point): { pts: SnapMark[]; box: Box } {
    const { box, transform } = computeResize(g.box0, g.t0, g.handle as CornerId, pointer, MIN_SIZE, {
      fromCenter: g.alt,
      proportional: g.snap || el.type === 'figure' || el.type === 'token',
    })
    const c = localCorners(box)
    const nw = elementToBoard(c.nw, box, transform)
    const ne = elementToBoard(c.ne, box, transform)
    const se = elementToBoard(c.se, box, transform)
    const sw = elementToBoard(c.sw, box, transform)
    const center = { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 }
    const mid = (a: SnapMark, b: SnapMark): SnapMark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    const pts = el.type === 'ellipse' ? [mid(nw, ne), mid(ne, se), mid(se, sw), mid(sw, nw), center] : [nw, ne, se, sw, center]
    const xs = [nw.x, ne.x, se.x, sw.x]
    const ys = [nw.y, ne.y, se.y, sw.y]
    return { pts, box: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } }
  }

  // The resize handle's board point (= the dragged corner, opposite one anchored),
  // snapped so the resized element's notable points on the moving edges align to
  // other elements. Same point feeds the live preview and the commit; also returns
  // the guides to draw.
  function resizePointer(el: BoardElement, g: Gesture): { pointer: Point; guides: SnapLine[] } {
    const base = clampToCanvas(resizeCurrent(el, g))
    if (!snapToObjects) return { pointer: base, guides: [] }
    const { pts, box } = resizedNotable(el, g, base)
    // Notable points on the moving edges (the two edges meeting at the handle).
    const edgeX = g.handle.includes('e') ? box.x + box.width : g.handle.includes('w') ? box.x : null
    const edgeY = g.handle.includes('s') ? box.y + box.height : g.handle.includes('n') ? box.y : null
    const xPts = edgeX != null ? pts.filter((p) => Math.abs(p.x - edgeX) < 0.5) : []
    const yPts = edgeY != null ? pts.filter((p) => Math.abs(p.y - edgeY) < 0.5) : []
    const targetPts = doc.elements.filter((e) => e.id !== g.id && e.type !== 'arrow3d').flatMap((e) => notablePoints(e))
    const { dx, dy, guides } = snapResize(xPts, yPts, targetPts, SNAP_PX / (scale || 1))
    return { pointer: clampToCanvas({ x: base.x + dx, y: base.y + dy }), guides }
  }

  // Keep a board-space point within the canvas (used for polyline vertex drags).
  function clampToCanvas(p: Point): Point {
    return { x: Math.min(Math.max(p.x, 0), doc.width), y: Math.min(Math.max(p.y, 0), doc.height) }
  }

  // Remap polyline points from their old local bbox into a new one (so corner
  // resize scales the line). Zero-extent axes keep points pinned (no div/0).
  function scalePoints(points: Array<[number, number]>, from: Box, to: Box): Array<[number, number]> {
    return points.map(([x, y]) => [
      to.x + (from.width ? (x - from.x) / from.width : 0) * to.width,
      to.y + (from.height ? (y - from.y) / from.height : 0) * to.height,
    ])
  }

  // Union AABB (over rotated corners) of a set of elements, in board space.
  function unionBounds(els: BoardElement[]): Box | null {
    if (els.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const el of els) {
      for (const c of boardCorners(el)) {
        minX = Math.min(minX, c.x)
        minY = Math.min(minY, c.y)
        maxX = Math.max(maxX, c.x)
        maxY = Math.max(maxY, c.y)
      }
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  // New transform for one element under a group gesture. Geometry is untouched —
  // we move the element's center and adjust its scale/rotation so the whole set
  // scales about the opposite corner (resize) or spins about the center (rotate).
  function groupTransformFor(el: BoardElement, g: GroupGesture): ElementTransform {
    const t0 = g.t0[el.id]
    const lb = getLocalBounds(el)
    const lc = { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 } // local center (const)
    const c0 = { x: lc.x + t0.x, y: lc.y + t0.y } // board center at start
    if (g.kind === 'rotate') {
      const center = { x: g.box0.x + g.box0.width / 2, y: g.box0.y + g.box0.height / 2 }
      const a0 = Math.atan2(g.start.y - center.y, g.start.x - center.x)
      const a1 = Math.atan2(g.current.y - center.y, g.current.x - center.x)
      let deg = ((a1 - a0) * 180) / Math.PI
      if (g.snap) deg = Math.round(deg / 15) * 15
      const rad = (deg * Math.PI) / 180
      const dx = c0.x - center.x
      const dy = c0.y - center.y
      const c1 = { x: center.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: center.y + dx * Math.sin(rad) + dy * Math.cos(rad) }
      return { ...t0, rotate: t0.rotate + deg, x: c1.x - lc.x, y: c1.y - lc.y }
    }
    // resize: uniform scale about the opposite corner (projected ratio).
    const pivot = boxCorner(g.box0, GROUP_OPP[g.handle as CornerId])
    const corner = boxCorner(g.box0, g.handle as CornerId)
    const sx = corner.x - pivot.x
    const sy = corner.y - pivot.y
    const len2 = sx * sx + sy * sy || 1
    const s = Math.max(0.05, ((g.current.x - pivot.x) * sx + (g.current.y - pivot.y) * sy) / len2)
    const c1 = { x: pivot.x + s * (c0.x - pivot.x), y: pivot.y + s * (c0.y - pivot.y) }
    return { ...t0, scale: t0.scale * s, x: c1.x - lc.x, y: c1.y - lc.y }
  }

  // Resolve a polyline/line vertex drag → the new LOCAL point. With shift held,
  // the dragged vertex angle-snaps (15° steps, incl. horizontal/vertical)
  // relative to its adjacent vertex — the same snapping as line creation.
  // Object-snap a dragged polyline vertex (board space): magnet it to other
  // elements' notable points AND to this shape's other vertices (which count as
  // notable points). `excludeIdx` is the vertex being moved (skip it as a target);
  // pass -1 when inserting a brand-new vertex (all existing vertices are targets).
  function snapVertexBoard(g: Gesture, board: Point, excludeIdx: number): { board: Point; guides: SnapLine[] } {
    const el = doc.elements.find((e) => e.id === g.id)
    if (!snapToObjects || !el) return { board, guides: [] }
    const targetPts: SnapMark[] = doc.elements.filter((e) => e.id !== g.id && e.type !== 'arrow3d').flatMap((e) => notablePoints(e))
    if (el.type === 'polyline') {
      el.points.forEach((pt, idx) => {
        if (idx !== excludeIdx) targetPts.push(elementToBoard({ x: pt[0], y: pt[1] }, g.box0, g.t0))
      })
    }
    const snap = snapResize([board], [board], targetPts, SNAP_PX / (scale || 1))
    return { board: clampToCanvas({ x: board.x + snap.dx, y: board.y + snap.dy }), guides: snap.guides }
  }

  function resolvePointDrag(g: Gesture): { lp: Point; guides: SnapLine[] } {
    const el = doc.elements.find((e) => e.id === g.id)
    const i = Number(g.handle.slice('point-'.length))
    let board = g.current
    if (g.snap && el?.type === 'polyline' && el.points.length >= 2) {
      // Reference the previous vertex (or the next one for the first vertex).
      const ni = i > 0 ? i - 1 : 1
      const neighbor = elementToBoard({ x: el.points[ni][0], y: el.points[ni][1] }, g.box0, g.t0)
      board = snapLineEnd(neighbor, board)
    }
    const snapped = snapVertexBoard(g, clampToCanvas(board), i)
    return { lp: boardToElement(snapped.board, g.box0, g.t0), guides: snapped.guides }
  }

  // Same object-snap for a NEW vertex inserted by dragging a mid-segment anchor.
  function resolveAnchorDrag(g: Gesture): { lp: Point; guides: SnapLine[] } {
    const snapped = snapVertexBoard(g, clampToCanvas(g.current), -1)
    return { lp: boardToElement(snapped.board, g.box0, g.t0), guides: snapped.guides }
  }

  // Resize pointer for a token's bottom handles: those sit a caption-band below
  // the badge corner (so the frame wraps the label), but resize math uses the
  // badge box — so shift the pointer up by the band to avoid a jump on grab.
  function resizeCurrent(el: BoardElement, g: Gesture): Point {
    const band = tokenLabelBand(el, scale)
    if (band > 0 && (g.handle === 'se' || g.handle === 'sw')) {
      const L = band * g.t0.scale
      const th = (g.t0.rotate * Math.PI) / 180
      return { x: g.current.x + L * Math.sin(th), y: g.current.y - L * Math.cos(th) }
    }
    return g.current
  }

  // Resizing a TEXT element only changes its font size (proportional to the drag);
  // the box is re-measured to fit and the handle's opposite corner stays put.
  function textFontResize(el: Extract<BoardElement, { type: 'text' }>, g: Gesture): BoardElement {
    const { box } = computeResize(g.box0, g.t0, g.handle as CornerId, clampToCanvas(g.current), MIN_SIZE, { proportional: true })
    const s = box.width / (g.box0.width || 1)
    const fontSize = Math.max(TEXT_MIN_FONT, Math.min(TEXT_MAX_FONT, Math.round(el.fontSize * s)))
    const m = measureTextBox(el.text, fontSize, el.bold)
    const opp = OPPOSITE_CORNER[g.handle as CornerId]
    const c0 = localCorners(g.box0)[opp as CornerId]
    const x = opp === 'nw' || opp === 'sw' ? c0.x : c0.x - m.width
    const y = opp === 'nw' || opp === 'ne' ? c0.y : c0.y - m.height
    return { ...el, fontSize, x, y, width: m.width, height: m.height, transform: g.t0 }
  }

  // The element as it should render RIGHT NOW — committed state plus any
  // in-progress move / resize / rotate / endpoint gesture.
  function liveElement(el: BoardElement): BoardElement {
    if (groupGesture && groupGesture.t0[el.id]) {
      return { ...el, transform: groupTransformFor(el, groupGesture) }
    }
    if (move && move.origins[el.id]) {
      if (!move.engaged) return el // not dragged far enough yet — stay put
      const o = move.origins[el.id]
      const d = moveDelta(move)
      return { ...el, transform: { ...o, x: o.x + d.x, y: o.y + d.y } }
    }
    if (gesture && gesture.id === el.id) {
      if (gesture.kind === 'rotate') {
        return { ...el, transform: { ...gesture.t0, rotate: rotationFor(gesture.box0, gesture.t0, gesture.current, gesture.snap) } }
      }
      if (gesture.kind === 'resize') {
        const { box, transform } = computeResize(gesture.box0, gesture.t0, gesture.handle as CornerId, resizePointer(el, gesture).pointer, MIN_SIZE, {
          fromCenter: gesture.alt,
          // Figures + tokens keep their aspect ratio, so the frame always matches it.
          proportional: gesture.snap || el.type === 'figure' || el.type === 'token',
        })
        if (el.type === 'polyline' || el.type === 'draw') {
          return { ...el, points: scalePoints(el.points, gesture.box0, box), transform }
        }
        if (el.type === 'text') return textFontResize(el, gesture)
        return { ...el, x: box.x, y: box.y, width: box.width, height: box.height, transform } as BoardElement
      }
      if (gesture.kind === 'point' && el.type === 'polyline') {
        const i = Number(gesture.handle.slice('point-'.length))
        const { lp } = resolvePointDrag(gesture)
        const points = el.points.map((p, idx) => (idx === i ? ([lp.x, lp.y] as [number, number]) : p))
        return { ...el, points }
      }
      if (gesture.kind === 'anchor' && el.type === 'polyline') {
        // Insert a vertex on segment `seg` (between vertex seg and seg+1) and drag
        // it — splits a straight segment / adds a curve point on a curved one.
        const seg = Number(gesture.handle.slice('anchor-'.length))
        const { lp } = resolveAnchorDrag(gesture)
        const points = [...el.points]
        points.splice(seg + 1, 0, [lp.x, lp.y])
        return { ...el, points }
      }
    }
    return el
  }

  const selectedEls = doc.elements.filter((e) => selectedSet.has(e.id))
  const liveSelected = selectedEls.map(liveElement)

  function startMove(ids: string[], from: Point, pointerId: number, presetOrigins?: Record<string, ElementTransform>) {
    // ⌥-drag duplicates first: the clones aren't in `doc` yet this render, so their
    // origins are passed in explicitly.
    const origins: Record<string, ElementTransform> = presetOrigins ?? {}
    if (!presetOrigins)
      for (const id of ids) {
        const el = doc.elements.find((e) => e.id === id)
        if (el) origins[id] = el.transform
      }
    setMove({ ids, start: from, current: from, origins, engaged: false })
    containerRef.current?.setPointerCapture(pointerId)
  }

  // ⌥-drag: duplicate the current selection in place and drag the clones instead.
  function startAltDuplicateMove(from: Point, pointerId: number): boolean {
    const clones = duplicateInPlace()
    if (clones.length === 0) return false
    const origins: Record<string, ElementTransform> = {}
    for (const c of clones) origins[c.id] = c.transform
    startMove(clones.map((c) => c.id), from, pointerId, origins)
    return true
  }

  // Finish the in-progress polyline. `closed` joins last→first (needs ≥3
  // points); open needs ≥2. createFigure selects it and reverts to the select
  // tool (unless the tool lock is on).
  function finishPolyline(closed: boolean) {
    if (!polyDraft) return
    if (polyDraft.points.length >= (closed ? 3 : 2)) {
      // Closed polygons carry no tips; an open polyline keeps the tool's end tip.
      createFigure(applyFigureStyle(makePolyline(crypto.randomUUID(), polyDraft.points, closed, 'none', closed ? 'none' : polyDraft.endTip, polyDraft.curve, polyDraft.zigzag, polyDraft.double), toolDefaults))
    }
    setPolyDraft(null)
  }

  function onContainerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Only the LEFT button drives interactions (touch/pen primary press is 0 too).
    if (e.button !== 0) return
    if (backgroundMode || homographyMode || cameraMode) return // calibration modes: only their own handles are active
    const svg = svgRef.current
    if (!svg) return
    const p = clientToBoard(svg, e.clientX, e.clientY)

    // Eraser: start a scrub — touched elements dim now, deleted on pointer-up.
    if (eraserTool) {
      eraseRef.current = { pts: [{ ...p, t: e.timeStamp }], ids: new Set(elementsUnder(p, eraseRadius())) }
      setErasing(true)
      syncErase()
      try {
        containerRef.current?.setPointerCapture(e.pointerId)
      } catch {
        /* capture is best-effort; moves over the board still reach the handler */
      }
      return
    }

    // Lasso: start a free-draw selection loop (elements it touches select live).
    if (lassoTool) {
      lassoRef.current = { pts: [p], ids: new Set() }
      setLasso([p])
      setSelection([])
      try {
        containerRef.current?.setPointerCapture(e.pointerId)
      } catch {
        /* capture is best-effort; moves over the board still reach the handler */
      }
      return
    }

    // 3D arrow: drag on the ground plane to set tail → head; created on pointer-up.
    if (arrow3dTool) {
      const g = arrow3dGround(p)
      if (g) {
        setArrow3dDraft({ tail: g, head: g })
        try {
          containerRef.current?.setPointerCapture(e.pointerId)
        } catch {
          /* best-effort */
        }
      }
      return
    }

    // Freehand: start capturing a stroke (points appended on move).
    if (activeTool === 'draw') {
      setFreeDraft([clampToCanvas(p)])
      containerRef.current?.setPointerCapture(e.pointerId)
      return
    }

    // Token: a stamp tool — a single click drops a default token at the cursor
    // (createFigure selects it and reverts to the select tool unless locked).
    if (activeTool === 'token') {
      const c = clampToCanvas(p)
      // Use the editable next-token defaults (style + starting text/label).
      const td = tokenDefaults
      // Size: copy the last selected/created token's CURRENT size (so resizes are
      // honoured); else match any token already on the board; else honour the
      // field's figure scale (the same multiplier placed figures use).
      const ref =
        doc.elements.find((e) => e.id === lastTokenId && e.type === 'token') ??
        [...doc.elements].reverse().find((e) => e.type === 'token')
      const size = ref?.type === 'token' ? ref.width : Math.round(TOKEN_SIZE * doc.background.figureScale)
      const tok = makeToken(crypto.randomUUID(), c.x, c.y, td, td.text, size)
      if (tok.type === 'token') {
        tok.label = td.label
        tok.text = nextTokenText(doc.elements, tok, td.text)
      }
      createFigure(tok)
      return
    }

    // Text: a stamp tool — click drops an (empty) text element and immediately
    // opens the inline editor (Excalidraw-style). Blurring it empty discards it.
    if (activeTool === 'text') {
      const c = clampToCanvas(p)
      const txt = makeText(crypto.randomUUID(), c.x, c.y, textDefaults, '')
      createFigure(txt)
      // Defer opening the editor until AFTER this click's pointerup, so the
      // trailing pointerup doesn't blur the freshly-focused textarea (which would
      // commit-and-discard the empty element). Token editing starts on pointerup,
      // so it doesn't hit this.
      setTimeout(() => startTextEdit(txt, true), 0)
      return
    }

    // Already mid-polyline (entered by a click with the line/arrow tool):
    // each further click drops a vertex; finishing is via the end dots / ESC.
    if (polyDraft) {
      setPolyDraft((d) => {
        if (!d) return d
        const np = e.shiftKey && d.points.length > 0 ? snapLineEnd(d.points[d.points.length - 1], p) : p
        return { ...d, points: [...d.points, np], cursor: p, snap: e.shiftKey }
      })
      return
    }

    const type = toolElementType(activeTool)
    if (type) {
      // line/arrow start as a 'line' draft: a drag → straight line, a click →
      // multi-point polyline (resolved on pointer-up). rect/ellipse → box draft.
      setDraft({ type, start: p, current: p, endTip: toolEndTip(activeTool), curve: toolIsCurved(activeTool), zigzag: toolIsZigzag(activeTool), double: toolIsDouble(activeTool), snap: e.shiftKey })
      containerRef.current?.setPointerCapture(e.pointerId)
    } else {
      // A 3D arrow under the cursor selects (and starts a body-move) — it isn't an
      // SVG element, so it can't be hit by the normal element handlers.
      const hitId = arrow3dLayerRef.current?.pick(p.x, p.y)
      if (hitId) {
        const el = doc.elements.find((x) => x.id === hitId)
        if (el?.type === 'arrow3d') {
          setSelection(e.shiftKey ? [...new Set([...selectedIds, hitId])] : [hitId])
          const ground = arrow3dGround(p)
          if (ground) {
            beginTransaction()
            setArrow3dGesture({ id: hitId, kind: 'body', orig: el, grabGround: ground })
          }
          try {
            containerRef.current?.setPointerCapture(e.pointerId)
          } catch {
            /* best-effort */
          }
          return
        }
      }
      setMarquee({ start: p, current: p, additive: e.shiftKey, base: selectedIds })
      containerRef.current?.setPointerCapture(e.pointerId)
    }
  }

  // Start dragging one of a selected 3D arrow's control handles.
  function onArrow3DHandleDown(el: Arrow3DElement, kind: 'tail' | 'head' | 'apex', e: React.PointerEvent) {
    e.stopPropagation()
    const p = svgRef.current ? clientToBoard(svgRef.current, e.clientX, e.clientY) : { x: 0, y: 0 }
    const ground = arrow3dGround(p) ?? { x: el.x, z: el.z }
    beginTransaction()
    setArrow3dGesture({ id: el.id, kind, orig: el, grabGround: ground })
    try {
      containerRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* best-effort */
    }
  }

  function marqueeSelection(m: Marquee): string[] {
    const box = normalizeBox(m.start.x, m.start.y, m.current.x, m.current.y)
    if (box.width < MIN_DRAG && box.height < MIN_DRAG) return m.additive ? m.base : []
    const contain = m.current.y >= m.start.y
    const hits = doc.elements
      .filter((el) => {
        if (el.type === 'arrow3d') return false // 3D arrows aren't marquee-selectable (no SVG box)
        const b = getElementBounds(el)
        return contain ? boxContains(box, b) : boxesIntersect(b, box)
      })
      .map((el) => el.id)
    return m.additive ? [...new Set([...m.base, ...hits])] : hits
  }

  function onElementPointerDown(e: React.PointerEvent, el: BoardElement) {
    if (e.button !== 0) return
    if (creating || backgroundMode || homographyMode || cameraMode) return // calibration modes: elements are inert
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    // Note which token text this press landed on (the under-badge label carries a
    // data-token-label marker), so a double-tap edits the right field.
    pressTokenFieldRef.current = (e.target as Element | null)?.closest?.('[data-token-label]') ? 'label' : 'text'
    const next = new Set(selectedIds)
    let willMove: boolean
    if (e.shiftKey) {
      if (next.has(el.id)) {
        next.delete(el.id)
        willMove = false
      } else {
        next.add(el.id)
        willMove = true
      }
    } else {
      if (!next.has(el.id)) {
        next.clear()
        next.add(el.id)
      }
      willMove = true
    }
    const ids = [...next]
    setSelection(ids)
    if (willMove && ids.length) {
      const from = clientToBoard(svg, e.clientX, e.clientY)
      // ⌥-drag duplicates the selection and drags the copies (originals stay put).
      if (e.altKey) startAltDuplicateMove(from, e.pointerId)
      else startMove(ids, from, e.pointerId)
    }
    // Touch long-press on a token → inline edit (fires only if the finger stays
    // put; any drag/up clears the timer). Double-click is the pointer path.
    cancelLongPress()
    if (el.type === 'token') {
      const field = pressTokenFieldRef.current
      longPressRef.current = setTimeout(() => startTokenEdit(el, field), 500)
    } else if (el.type === 'text') {
      longPressRef.current = setTimeout(() => startTextEdit(el), 500)
    }
  }

  function cancelLongPress() {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  // Map a board point to a position within the container (for the inline editor).
  function boardToContainer(bx: number, by: number): { x: number; y: number; scale: number } | null {
    const svg = svgRef.current
    const cont = containerRef.current
    if (!svg || !cont) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const sp = new DOMPoint(bx, by).matrixTransform(ctm)
    const r = cont.getBoundingClientRect()
    return { x: sp.x - r.left, y: sp.y - r.top, scale: ctm.a }
  }

  function startTokenEdit(el: BoardElement, field: EditField) {
    if (el.type !== 'token') return
    if (field === 'label' && !el.showLabel) return // nothing to edit if hidden
    cancelLongPress()
    setSelection([el.id])
    setEditing({ id: el.id, field, text: field === 'label' ? el.label : el.text })
    let cx: number
    let cy: number
    let font: number // editor font in screen px (overlays the rendered glyph 1:1)
    if (field === 'label') {
      // Caption: a fixed on-screen size centered just below the badge (mirrors the
      // renderer, which divides the px sizes by the fit-scale to get board units).
      const gapBoard = TOKEN_LABEL_GAP_PX / scale
      const fontBoard = TOKEN_LABEL_PX / scale
      cx = el.x + el.width / 2 + el.transform.x
      cy = el.y + el.height + gapBoard + fontBoard / 2 + el.transform.y
      font = TOKEN_LABEL_PX
    } else {
      // Badge number: anchored at the geometry's text point, sized into the box.
      const g = TOKEN_GEOMETRY[el.shape]
      cx = el.x + (g.text.x / TOKEN_VIEW) * el.width + el.transform.x
      cy = el.y + (g.text.y / TOKEN_VIEW) * el.height + el.transform.y
      font = (g.text.size / TOKEN_VIEW) * (el.width * el.transform.scale * scale)
    }
    const pos = boardToContainer(cx, cy)
    if (pos) {
      const px = el.width * el.transform.scale * pos.scale // token width in screen px
      const width = Math.max(40, field === 'label' ? px * 1.8 : px * 0.9)
      // The label is always black; the badge number uses the token's text color.
      setEditPos({ left: pos.x - width / 2, top: pos.y - font, width, font, color: field === 'label' ? '#000000' : el.textColor })
    }
  }

  function commitTokenEdit() {
    if (!editing) return
    const el = doc.elements.find((e) => e.id === editing.id)
    if (el && el.type === 'token') {
      const cur = editing.field === 'label' ? el.label : el.text
      if (cur !== editing.text) {
        updateElements([{ id: editing.id, before: { [editing.field]: cur }, after: { [editing.field]: editing.text } }])
      }
    }
    setEditing(null)
  }

  // ── Text element inline editing ────────────────────────────────────────────
  // The editor is a fully-transparent <textarea> laid exactly over the rendered
  // SVG text; typing live-updates the element (text + measured box) inside one
  // undo transaction, so it feels like editing the SVG directly. Enter inserts a
  // newline; blur commits; Escape restores the original.
  function startTextEdit(el: BoardElement, created = false) {
    if (el.type !== 'text') return
    cancelLongPress()
    setSelection([el.id])
    setEditPos(null) // text uses its own overlay (computed from the live element)
    origTextRef.current = el.text
    beginTransaction()
    setEditing({ id: el.id, field: 'text', text: el.text, created })
  }

  // Apply a new text value to the edited element live: re-measure the box and keep
  // its center fixed so it grows symmetrically.
  function applyLiveText(el: Extract<BoardElement, { type: 'text' }>, value: string) {
    const { width, height } = measureTextBox(value, el.fontSize, el.bold)
    updateElements([
      {
        id: el.id,
        before: { text: el.text, x: el.x, y: el.y, width: el.width, height: el.height },
        after: { text: value, x: el.x + (el.width - width) / 2, y: el.y + (el.height - height) / 2, width, height },
      },
    ])
  }

  function commitTextEdit() {
    if (!editing) return
    const el = doc.elements.find((e) => e.id === editing.id)
    const empty = el?.type === 'text' && el.text.trim() === ''
    commitTransaction()
    setEditing(null)
    // A freshly-created text left empty is discarded (it's still selected).
    if (editing.created && empty) deleteSelected()
  }

  function cancelTextEdit() {
    if (!editing) return
    const el = doc.elements.find((e) => e.id === editing.id)
    if (el?.type === 'text' && !editing.created) applyLiveText(el, origTextRef.current)
    commitTransaction()
    setEditing(null)
    if (editing.created) deleteSelected()
  }

  function onHandleDown(handle: HandleId, e: React.PointerEvent, el: BoardElement) {
    if (e.button !== 0) return
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    // Double-tap a polyline vertex → remove it. Detected here (not via the DOM
    // dblclick) because setPointerCapture below eats the synthetic dblclick.
    if (handle.startsWith('point-')) {
      const now = e.timeStamp
      const last = lastVertexTapRef.current
      if (last && last.handle === handle && now - last.t < 350) {
        lastVertexTapRef.current = null
        removeVertex(el, Number(handle.slice('point-'.length)))
        return
      }
      lastVertexTapRef.current = { handle, t: now }
    }
    const kind: Gesture['kind'] =
      handle === 'rotate' ? 'rotate' : handle.startsWith('point-') ? 'point' : handle.startsWith('anchor-') ? 'anchor' : 'resize'
    const p = clientToBoard(svg, e.clientX, e.clientY)
    setGesture({ kind, id: el.id, handle, box0: getLocalBounds(el), t0: el.transform, start: p, current: p, snap: e.shiftKey, alt: e.altKey })
    containerRef.current?.setPointerCapture(e.pointerId)
  }

  function onGroupHandleDown(handle: CornerId | 'rotate', e: React.PointerEvent) {
    if (e.button !== 0) return
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    const u = unionBounds(liveSelected)
    if (!u) return
    const t0: Record<string, ElementTransform> = {}
    for (const el of liveSelected) t0[el.id] = el.transform
    const p = clientToBoard(svg, e.clientX, e.clientY)
    setGroupGesture({ kind: handle === 'rotate' ? 'rotate' : 'resize', handle, box0: u, start: p, current: p, snap: e.shiftKey, t0 })
    containerRef.current?.setPointerCapture(e.pointerId)
  }

  // Pressing inside the group frame (between elements) drags the whole group.
  function onGroupBodyPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    if (creating) return
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    const from = clientToBoard(svg, e.clientX, e.clientY)
    if (e.altKey) startAltDuplicateMove(from, e.pointerId)
    else startMove(selectedIds, from, e.pointerId)
  }

  // Grab the background move handle: pan the field SVG by dragging it.
  function onBgPanPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    // Coalesce the whole pan drag into one undo step.
    beginTransaction()
    setBgPan({ start: clientToBoard(svg, e.clientX, e.clientY), origin: doc.background.position })
    containerRef.current?.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    cancelLongPress() // any movement aborts a pending long-press
    const svg = svgRef.current
    if (!svg) return
    const p = clientToBoard(svg, e.clientX, e.clientY)
    const g = eraseRef.current
    if (g) {
      const last = g.pts[g.pts.length - 1]
      for (const id of eraseSegment(last, p, eraseRadius())) g.ids.add(id)
      g.pts.push({ ...p, t: e.timeStamp })
      pruneTail(e.timeStamp)
      if (g.pts.length > ERASER_TAIL_MAX) g.pts = g.pts.slice(-ERASER_TAIL_MAX)
      syncErase()
      return
    }
    // Lasso: extend the loop (skip near-duplicate samples) and re-test hits.
    const lg = lassoRef.current
    if (lg) {
      const last = lg.pts[lg.pts.length - 1]
      if (Math.hypot(p.x - last.x, p.y - last.y) >= FREEHAND_MIN_STEP) {
        lg.pts.push(p)
        setLasso(lg.pts.slice())
        updateLassoHits()
      }
      return
    }
    // 3D arrow: extend the create-draft, or edit a handle / move the body.
    if (arrow3dDraft) {
      const g = arrow3dGround(p)
      if (g) setArrow3dDraft((d) => (d ? { ...d, head: g } : d))
      return
    }
    if (arrow3dGesture) {
      dragArrow3D(arrow3dGesture, p)
      return
    }
    if (bgPan) {
      setBackground({ position: [bgPan.origin[0] + (p.x - bgPan.start.x), bgPan.origin[1] + (p.y - bgPan.start.y)] })
    } else if (freeDraft) {
      const cp = clampToCanvas(p)
      setFreeDraft((pts) => {
        if (!pts) return pts
        // Skip near-duplicate samples so the point list stays manageable.
        const last = pts[pts.length - 1]
        if (Math.hypot(cp.x - last.x, cp.y - last.y) < FREEHAND_MIN_STEP) return pts
        return [...pts, cp]
      })
    } else if (polyDraft) setPolyDraft((d) => (d ? { ...d, cursor: p, snap: e.shiftKey } : d))
    else if (draft) setDraft((d) => (d ? { ...d, current: p, snap: e.shiftKey } : d))
    else if (groupGesture) setGroupGesture((g) => (g ? { ...g, current: p, snap: e.shiftKey } : g))
    else if (gesture) setGesture((g) => (g ? { ...g, current: p, snap: e.shiftKey, alt: e.altKey } : g))
    else if (move)
      setMove((m) => (m ? { ...m, current: p, engaged: m.engaged || Math.hypot(p.x - m.start.x, p.y - m.start.y) * scale >= MOVE_THRESHOLD_PX } : m))
    else if (marquee) {
      const next = { ...marquee, current: p }
      setMarquee(next)
      setSelection(marqueeSelection(next))
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    cancelLongPress() // a tap/drag release aborts a pending long-press
    // Only release if we actually captured (polyline clicks don't capture).
    if (containerRef.current?.hasPointerCapture?.(e.pointerId)) {
      containerRef.current.releasePointerCapture(e.pointerId)
    }
    if (eraseRef.current) {
      const ids = [...eraseRef.current.ids]
      eraseRef.current = null
      setErasing(false)
      setErase(null)
      if (ids.length) removeElements(ids)
    } else if (lassoRef.current) {
      // Selection is already set live; keep it and hand over to the select tool
      // (unless the tool is locked) so the user can act on the picked elements.
      lassoRef.current = null
      setLasso(null)
      if (!keepToolActive) setActiveTool('select')
    } else if (arrow3dDraft) {
      // Finalize a new 3D arrow. A click (no real drag) → a default-sized arrow.
      const { tail, head } = arrow3dDraft
      setArrow3dDraft(null)
      const dragged = Math.hypot(tail.x - head.x, tail.z - head.z) >= 0.5
      const pl = dragged ? arrow3dPlacement(tail, head) : { x: tail.x, z: tail.z, y: 0, splineWidth: arrow3dDefaults.splineWidth }
      createFigure(makeArrow3D(pl.x, pl.z, pl.y, pl.splineWidth))
    } else if (arrow3dGesture) {
      setArrow3dGesture(null)
      commitTransaction()
    } else if (bgPan) {
      setBgPan(null)
      commitTransaction()
    } else if (freeDraft) {
      const pts = freeDraft
      setFreeDraft(null)
      // Need at least a short stroke (≥2 distinct points) to keep it.
      if (pts.length >= 2) createFigure(applyFigureStyle(makeDraw(crypto.randomUUID(), pts), toolDefaults))
    } else if (draft) {
      const { type, start, current, endTip, curve, zigzag, double, snap } = draft
      setDraft(null)
      if (type === 'line') {
        if (isDragSignificant('line', start, current)) {
          // A real drag → a straight line (2-point polyline, end-tipped if arrow).
          const end = snap ? snapLineEnd(start, current) : current
          createFigure(applyFigureStyle(makeLine(crypto.randomUUID(), start, end, endTip, curve, zigzag, double), toolDefaults))
        } else {
          // A click → switch to multi-point polyline mode, seeded with this point.
          setPolyDraft({ points: [start], cursor: current, endTip, curve, zigzag, double, snap })
        }
      } else if (isDragSignificant(type, start, current)) {
        // Shift keeps the shape's proportion (square bounding box → regular shape).
        const end = snap ? squareCorner(start, current) : current
        createFigure(applyFigureStyle(makeFigure(type, crypto.randomUUID(), start, end), toolDefaults))
      }
    } else if (groupGesture) {
      const g = groupGesture
      setGroupGesture(null)
      // Commit the group transform as one undoable update across all members.
      if (Math.hypot(g.current.x - g.start.x, g.current.y - g.start.y) >= 1) {
        const changes = []
        for (const id of Object.keys(g.t0)) {
          const el = doc.elements.find((e) => e.id === id)
          if (el) changes.push({ id, before: { transform: g.t0[id] }, after: { transform: groupTransformFor(el, g) } })
        }
        if (changes.length) updateElements(changes)
      }
    } else if (gesture) {
      const g = gesture
      setGesture(null)
      commitGesture(g)
    } else if (move) {
      // Use the SAME clamped+snapped delta the preview showed, so the commit matches.
      const d = moveDelta(move)
      const { ids, origins, engaged } = move
      setMove(null)
      if (engaged) {
        updateElements(
          ids
            .filter((id) => origins[id])
            .map((id) => ({
              id,
              before: { transform: origins[id] },
              after: { transform: { ...origins[id], x: origins[id].x + d.x, y: origins[id].y + d.y } },
            })),
        )
      } else if (ids.length === 1) {
        // A tap (no drag) on a single token: a second one within 400ms opens the
        // inline editor. Detected on pointerup — after the press's default focus
        // has settled — so the editor's autofocus isn't immediately stolen. This
        // is also capture-proof (the synthetic click goes to the capture target).
        const el = doc.elements.find((x) => x.id === ids[0])
        if (el?.type === 'token') {
          const field = pressTokenFieldRef.current // which text this tap landed on
          const prev = tokenTapRef.current
          if (prev && prev.id === el.id && prev.field === field && e.timeStamp - prev.t < 400) {
            tokenTapRef.current = null
            startTokenEdit(el, field)
          } else {
            tokenTapRef.current = { id: el.id, field, t: e.timeStamp }
          }
        } else if (el?.type === 'text') {
          // Same double-tap path as tokens (a native dblclick can't fire once the
          // selection frame covers the element).
          const prev = tokenTapRef.current
          if (prev && prev.id === el.id && e.timeStamp - prev.t < 400) {
            tokenTapRef.current = null
            startTextEdit(el)
          } else {
            tokenTapRef.current = { id: el.id, field: 'text', t: e.timeStamp }
          }
        } else {
          tokenTapRef.current = null
        }
      }
    } else if (marquee) {
      setSelection(marqueeSelection(marquee))
      setMarquee(null)
    }
  }

  function commitGesture(g: Gesture) {
    // Ignore a handle click with no real drag (avoids empty undo entries).
    if (Math.hypot(g.current.x - g.start.x, g.current.y - g.start.y) < 1) return
    const el = doc.elements.find((e) => e.id === g.id)
    if (!el) return
    if (g.kind === 'rotate') {
      updateElements([{ id: g.id, before: { transform: g.t0 }, after: { transform: { ...g.t0, rotate: rotationFor(g.box0, g.t0, g.current, g.snap) } } }])
    } else if (g.kind === 'resize') {
      const { box, transform } = computeResize(g.box0, g.t0, g.handle as CornerId, resizePointer(el, g).pointer, MIN_SIZE, {
        fromCenter: g.alt,
        // Figures + tokens keep their aspect ratio, so the frame always matches it.
        proportional: g.snap || el.type === 'figure' || el.type === 'token',
      })
      if (el.type === 'polyline' || el.type === 'draw') {
        updateElements([
          { id: g.id, before: { points: el.points, transform: g.t0 }, after: { points: scalePoints(el.points, g.box0, box), transform } },
        ])
      } else if (el.type === 'text') {
        // Text resize = font-size change (box re-measured); transform is unchanged.
        const r = textFontResize(el, g) as Extract<BoardElement, { type: 'text' }>
        updateElements([
          {
            id: g.id,
            before: { fontSize: el.fontSize, x: el.x, y: el.y, width: el.width, height: el.height },
            after: { fontSize: r.fontSize, x: r.x, y: r.y, width: r.width, height: r.height },
          },
        ])
      } else {
        updateElements([
          {
            id: g.id,
            before: { x: g.box0.x, y: g.box0.y, width: g.box0.width, height: g.box0.height, transform: g.t0 },
            after: { x: box.x, y: box.y, width: box.width, height: box.height, transform },
          },
        ])
      }
    } else if (g.kind === 'point' && el.type === 'polyline') {
      const i = Number(g.handle.slice('point-'.length))
      const { lp } = resolvePointDrag(g)
      const after = el.points.map((p, idx) => (idx === i ? ([lp.x, lp.y] as [number, number]) : p))
      updateElements([{ id: g.id, before: { points: el.points }, after: { points: after } }])
    } else if (g.kind === 'anchor' && el.type === 'polyline') {
      const seg = Number(g.handle.slice('anchor-'.length))
      const { lp } = resolveAnchorDrag(g)
      const after = [...el.points]
      after.splice(seg + 1, 0, [lp.x, lp.y])
      updateElements([{ id: g.id, before: { points: el.points }, after: { points: after } }])
    }
  }

  // Double-click a vertex to remove it (Miro). Open lines keep their endpoints;
  // a polyline keeps ≥2 points, a closed polygon ≥3.
  function removeVertex(el: BoardElement, i: number) {
    if (el.type !== 'polyline') return
    const min = el.closed ? 3 : 2
    if (el.points.length <= min) return
    if (!el.closed && (i === 0 || i === el.points.length - 1)) return
    updateElements([{ id: el.id, before: { points: el.points }, after: { points: el.points.filter((_, idx) => idx !== i) } }])
  }

  const single = !creating && liveSelected.length === 1
  const marqueeBox = marquee ? normalizeBox(marquee.start.x, marquee.start.y, marquee.current.x, marquee.current.y) : null
  // The selection FRAME polygon (padded to match the visible frame), used as the
  // move-hit area so clicking anywhere inside the frame — including the gap
  // between the figure and its frame — drags rather than deselects.
  const framePoints = (el: BoardElement) => {
    const box = getLocalBounds(el)
    const pad = SELECTION_PAD_PX / scale
    const pbox = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
    const c = localCorners(pbox)
    const t = el.transform
    // Note: the move hit-area stays on the badge (NOT extended over the caption),
    // so double-clicking the caption still hits the label text (not this overlay)
    // and edits the label. The caption is independently grabbable via its own
    // element group, so moving by the label still works.
    return [c.nw, c.ne, c.se, c.sw]
      .map((p) => {
        const b = elementToBoard(p, pbox, t)
        return `${b.x},${b.y}`
      })
      .join(' ')
  }
  // Object-snap guides (alignment lines + equal-distance gaps) shown while dragging,
  // resizing, or dragging a polyline vertex.
  const objectSnap = move ? moveSnap(move) : null
  const resizeGuides = ((): SnapLine[] => {
    if (!gesture || gesture.kind !== 'resize') return []
    const el = doc.elements.find((e) => e.id === gesture.id)
    return el ? resizePointer(el, gesture).guides : []
  })()
  const pointGuides = gesture?.kind === 'point' ? resolvePointDrag(gesture).guides : gesture?.kind === 'anchor' ? resolveAnchorDrag(gesture).guides : []
  const alignGuides = [...(objectSnap?.guides ?? []), ...resizeGuides, ...pointGuides]
  const gapGuides = objectSnap?.gaps ?? []

  // 2D selection chrome excludes 3D arrows (they have no SVG box; their own
  // handles are drawn separately over the WebGL layer).
  const liveSelected2D = liveSelected.filter((el) => el.type !== 'arrow3d')
  const selectedArrow3D = liveSelected.length === 1 && liveSelected[0].type === 'arrow3d' ? (liveSelected[0] as Arrow3DElement) : null
  // Elements handed to the WebGL layer (+ a live preview while drag-creating).
  const arrow3dLayerElements = arrow3dDraft
    ? [...arrow3dElements, (() => {
        const d = arrow3dDraft
        const dragged = Math.hypot(d.tail.x - d.head.x, d.tail.z - d.head.z) >= 0.5
        const pl = dragged ? arrow3dPlacement(d.tail, d.head) : { x: d.tail.x, z: d.tail.z, y: 0, splineWidth: arrow3dDefaults.splineWidth }
        const el = makeArrow3D(pl.x, pl.z, pl.y, pl.splineWidth)
        el.id = 'arrow3d-draft'
        return el
      })()]
    : arrow3dElements
  // Selected arrow's handle positions in BOARD coords (pure — projected via the
  // fixed camera). Rendered in an SVG overlay that shares the board viewBox, so
  // pan/zoom/letterbox are handled without touching a ref during render.
  const arrow3dHandles = selectedArrow3D ? arrow3dHandleBoard(selectedArrow3D) : null
  // Group frame box (padded for display) for a multi-selection — the interactive
  // group resize/rotate chrome is drawn on it.
  const groupUnion = liveSelected2D.length >= 2 ? unionBounds(liveSelected2D) : null
  const groupPad = 6 / scale
  const groupBox = groupUnion
    ? { x: groupUnion.x - groupPad, y: groupUnion.y - groupPad, width: groupUnion.width + 2 * groupPad, height: groupUnion.height + 2 * groupPad }
    : null

  // The eraser turns the pointer into a filled circle matching the erase radius.
  const eraserD = ERASER_RADIUS_PX * 2 + 2
  const eraserCursor = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${eraserD}' height='${eraserD}'><circle cx='${eraserD / 2}' cy='${eraserD / 2}' r='${ERASER_RADIUS_PX}' fill='#ffffff' stroke='#000000' stroke-width='1.5'/></svg>`,
  )}") ${eraserD / 2} ${eraserD / 2}, auto`

  return (
    <div
      ref={containerRef}
      data-board-surface
      className={cn('relative h-full w-full touch-none select-none', creating || lassoTool ? 'cursor-crosshair' : 'cursor-default')}
      style={eraserTool ? { cursor: eraserCursor } : undefined}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <BoardCanvas
        doc={doc}
        svgRef={svgRef}
        viewBox={viewBox}
        background={
          <>
            <BackgroundView doc={doc} />
            {showGrid && <BoardGrid />}
          </>
        }
        overlay={
          <>
            {/* Group body grab area: pressing anywhere inside the group frame
                (incl. gaps between elements) drags the whole group. Drawn first,
                so the per-element grabs above it still take element clicks (e.g.
                shift-toggle). */}
            {groupBox && (
              <rect
                x={groupBox.x}
                y={groupBox.y}
                width={groupBox.width}
                height={groupBox.height}
                fill="transparent"
                style={{ cursor: 'move' }}
                onPointerDown={onGroupBodyPointerDown}
              />
            )}
            {/* Per-element grab areas (the padded selection frame) for moving.
                Drawn under the handles so handles win the pointer. Skipped for
                straight lines (2-point polylines), grabbed by their own stroke. */}
            {!creating &&
              liveSelected2D.map((el) =>
                el.type === 'polyline' && el.points.length === 2 ? null : (
                  <polygon
                    key={`hit-${el.id}`}
                    points={framePoints(el)}
                    fill="transparent"
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => onElementPointerDown(e, el)}
                  />
                ),
              )}
            {/* Selection chrome: full handles for a single selection, plain
                outlines + a group frame for a multi-selection. */}
            {!creating &&
              liveSelected2D.map((el) => (
                <SelectionHandles
                  key={`sel-${el.id}`}
                  element={el}
                  scale={scale}
                  onHandleDown={single ? (handle, e) => onHandleDown(handle, e, el) : undefined}
                  hideFrame={gesture?.id === el.id && (gesture.kind === 'point' || gesture.kind === 'anchor')}
                />
              ))}
            {/* Group resize/rotate chrome for a multi-selection. Hidden while
                rotating (the box is an AABB that grows, so the handle would slide
                out from under the pointer); the per-element frames stay. */}
            {groupBox && groupGesture?.kind !== 'rotate' && <GroupHandles box={groupBox} scale={scale} onDown={onGroupHandleDown} />}
            {marqueeBox && (
              <rect
                x={marqueeBox.x}
                y={marqueeBox.y}
                width={marqueeBox.width}
                height={marqueeBox.height}
                fill="var(--color-selection-frame)"
                fillOpacity={0.12}
                stroke="var(--color-selection-handle)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                shapeRendering="crispEdges"
                pointerEvents="none"
              />
            )}
            {/* Lasso: the free-drawn selection loop (closed, dashed). */}
            {lasso && lasso.length >= 2 && (
              <polygon
                points={lasso.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="var(--color-selection-frame)"
                fillOpacity={0.12}
                stroke="var(--color-selection-handle)"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {/* Object-snap alignment guides (red) while dragging a selection: a
                line through the aligned coordinate plus a small × on each notable
                point that triggered it. */}
            {alignGuides.map((g, i) => {
              const m = 3.5 / scale // half-length of the × marks (fixed on-screen)
              return (
                <g key={`align-${i}`} stroke="#ff00fb" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none">
                  <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} shapeRendering="crispEdges" />
                  {g.marks.map((pt, j) => (
                    <g key={j}>
                      <line x1={pt.x - m} y1={pt.y - m} x2={pt.x + m} y2={pt.y + m} />
                      <line x1={pt.x - m} y1={pt.y + m} x2={pt.x + m} y2={pt.y - m} />
                    </g>
                  ))}
                </g>
              )
            })}
            {/* Equal-distance gap segments (red) with a ‖ tick at each midpoint. */}
            {gapGuides.map((g, i) => {
              const t = 3 / scale // half-length of the ‖ ticks
              const s = 1.5 / scale // half-gap between the two parallel ticks
              const mx = (g.x1 + g.x2) / 2
              const my = (g.y1 + g.y2) / 2
              return (
                <g key={`gap-${i}`} stroke="#ff00fb" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none">
                  <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} shapeRendering="crispEdges" />
                  {g.axis === 'x' ? (
                    <>
                      <line x1={mx - s} y1={my - t} x2={mx - s} y2={my + t} />
                      <line x1={mx + s} y1={my - t} x2={mx + s} y2={my + t} />
                    </>
                  ) : (
                    <>
                      <line x1={mx - t} y1={my - s} x2={mx + t} y2={my - s} />
                      <line x1={mx - t} y1={my + s} x2={mx + t} y2={my + s} />
                    </>
                  )}
                </g>
              )
            })}
            {freeDraft && freeDraft.length >= 1 && (
              <ElementView element={applyFigureStyle(makeDraw('draw-draft', freeDraft), toolDefaults)} />
            )}
            {draft &&
              (draft.type === 'line' ? (
                <ElementView element={applyFigureStyle(makeLine('draft', draft.start, draft.snap ? snapLineEnd(draft.start, draft.current) : draft.current, draft.endTip, draft.curve, draft.zigzag, draft.double), toolDefaults)} />
              ) : (
                <ElementView element={applyFigureStyle(makeFigure(draft.type, 'draft', draft.start, draft.snap ? squareCorner(draft.start, draft.current) : draft.current), toolDefaults)} />
              ))}
            {polyDraft && (
              <>
                {/* Live preview: placed segments + the segment to the (snapped) cursor. */}
                <ElementView element={applyFigureStyle(makePolyline('poly-draft', [...polyDraft.points, polyDraftEnd(polyDraft)], false, 'none', polyDraft.endTip, polyDraft.curve, polyDraft.zigzag, polyDraft.double), toolDefaults)} />
                {/* First dot → close; last dot → end open. Hover bounce via CSS. */}
                <circle
                  className="ycb-poly-end"
                  cx={polyDraft.points[0].x}
                  cy={polyDraft.points[0].y}
                  r={POLY_END_R_PX / scale}
                  fill="#ffffff"
                  stroke="var(--color-selection-handle)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    finishPolyline(true)
                  }}
                />
                {polyDraft.points.length >= 2 && (
                  <circle
                    className="ycb-poly-end"
                    cx={polyDraft.points[polyDraft.points.length - 1].x}
                    cy={polyDraft.points[polyDraft.points.length - 1].y}
                    r={POLY_END_R_PX / scale}
                    fill="#ffffff"
                    stroke="var(--color-selection-handle)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      finishPolyline(false)
                    }}
                  />
                )}
              </>
            )}
            {/* Background pan handle: drag to move the field SVG. Shown only in
                background-edit mode when a field overlay is present. Sits at the
                field's current center (board center + offset). */}
            {backgroundMode && doc.background.fieldSvg && (() => {
              const hx = BOARD_WIDTH / 2 + doc.background.position[0]
              const hy = BOARD_HEIGHT / 2 + doc.background.position[1]
              const size = BG_MOVE_HANDLE_PX / scale
              return (
                <g transform={`translate(${hx} ${hy})`} style={{ cursor: 'move' }} onPointerDown={onBgPanPointerDown}>
                  <circle r={size * 0.7} fill="var(--color-selection-frame)" fillOpacity={0.18} stroke="var(--color-selection-handle)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  <g transform={`translate(${-size / 2} ${-size / 2}) scale(${size / 46})`}>
                    <path d={BG_MOVE_PATH} fill="var(--color-selection-handle)" />
                  </g>
                </g>
              )
            })()}
            {/* Eraser tail: an opaque grey "comet" following the recent pointer path
                (so it bends with the trajectory) — a rounded head dot (a little
                bigger than the pointer circle) at the cursor tapering to a point
                behind. Long on a fast flick, gone once the pointer stops. The
                pointer circle itself is the CSS cursor. */}
            {erase && (() => {
              const rHead = ERASER_HEAD_R / (scale || 1)
              const tail = eraserTailPath(erase.pts, rHead)
              if (!tail) return null
              const head = erase.pts[erase.pts.length - 1]
              return (
                <g pointerEvents="none" fill="#000000" opacity={0.3}>
                  <path d={tail} />
                  <circle cx={head.x} cy={head.y} r={rHead} />
                </g>
              )
            })()}
          </>
        }
      >
        <g style={{ pointerEvents: creating || backgroundMode || homographyMode || cameraMode || eraserTool || lassoTool ? 'none' : 'auto' }}>
          {doc.elements.map((el) => {
            const live = liveElement(el)
            const erasing = erase?.ids.has(el.id)
            // Hide the token field being edited (the HTML input shows the live
            // value) ONLY in the rendered element — the selection chrome still
            // sees the real `showLabel`, so the frame doesn't shrink while editing.
            const render =
              editing && editing.id === el.id && live.type === 'token'
                ? editing.field === 'label'
                  ? { ...live, showLabel: false }
                  : { ...live, text: '' }
                : live
            return (
              <g key={el.id} style={{ cursor: 'move', opacity: erasing ? 0.25 : undefined }} onPointerDown={(e) => onElementPointerDown(e, el)}>
                {render.type === 'figure' ? <FigureView element={render} /> : <ElementView element={render} viewScale={scale} />}
              </g>
            )
          })}
        </g>
      </BoardCanvas>
      {/* 3D arrows: WebGL overlay (pointer-transparent) + their control handles. */}
      <Arrow3DLayer ref={arrow3dLayerRef} elements={arrow3dLayerElements} selectedIds={selectedIds} viewport={viewport} svgRef={svgRef} containerRef={containerRef} homography={useHomography ? fieldH : null} camera={fieldCamCfg} />
      {/* Field-perspective calibration overlays (dedicated modes). */}
      {homographyMode && <FieldHomographyLayer viewBox={viewBox} />}
      {cameraMode && <FieldCameraLayer viewBox={viewBox} />}
      {selectedArrow3D && !arrow3dGesture && arrow3dHandles && (
        <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'none' }}>
          {/* Dotted guides: tail → apex → head, and apex → base midpoint. */}
          <polyline
            points={`${arrow3dHandles[0].x},${arrow3dHandles[0].y} ${arrow3dHandles[2].x},${arrow3dHandles[2].y} ${arrow3dHandles[1].x},${arrow3dHandles[1].y}`}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={arrow3dHandles[2].x}
            y1={arrow3dHandles[2].y}
            x2={(arrow3dHandles[0].x + arrow3dHandles[1].x) / 2}
            y2={(arrow3dHandles[0].y + arrow3dHandles[1].y) / 2}
            stroke="#ffffff"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.7}
            vectorEffect="non-scaling-stroke"
          />
          {(['tail', 'head', 'apex'] as const).map((kind, i) => (
            <circle
              key={kind}
              cx={arrow3dHandles[i].x}
              cy={arrow3dHandles[i].y}
              r={7 / scale}
              fill="#ffffff"
              stroke="#3b82f6"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
              onPointerDown={(e) => onArrow3DHandleDown(selectedArrow3D, kind, e)}
            />
          ))}
        </svg>
      )}
      {/* Pan surface: covers the board while Space is held or the Hand tool is
          active, so a drag translates the viewport instead of hitting elements. */}
      {panActive && (
        <div
          className="absolute inset-0 z-10 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={panDown}
          onPointerMove={panMove}
          onPointerUp={panEnd}
          onPointerCancel={panEnd}
        />
      )}
      {editing && editPos && (
        <input
          autoFocus
          value={editing.text}
          placeholder={editing.field === 'label' ? 'Player' : ''}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setEditing((cur) => (cur ? { ...cur, text: e.target.value } : cur))}
          onBlur={commitTokenEdit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              commitTokenEdit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(null)
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: editPos.left,
            top: editPos.top,
            width: editPos.width,
            height: editPos.font * 2,
            fontFamily: TOKEN_FONT,
            fontSize: editPos.font,
            fontWeight: TOKEN_FONT_WEIGHT,
            textAlign: 'center',
            border: 'none',
            background: 'transparent',
            color: editPos.color,
            outline: 'none',
            padding: 0,
            margin: 0,
            lineHeight: 1,
          }}
          className="z-40 select-text outline-none"
        />
      )}
      {/* Text element editor: a transparent multiline <textarea> laid exactly over
          the live SVG text (which shows the value as you type). Enter = newline;
          blur commits; Escape restores. */}
      {editing && editingTextEl && textBox && (
        <textarea
          autoFocus
          value={editing.text}
          wrap="off"
          onFocus={(e) => {
            const v = e.currentTarget.value
            e.currentTarget.setSelectionRange(v.length, v.length)
          }}
          onChange={(e) => {
            const val = e.target.value
            setEditing((cur) => (cur ? { ...cur, text: val } : cur))
            const cur = doc.elements.find((x) => x.id === editing.id)
            if (cur?.type === 'text') applyLiveText(cur, val)
          }}
          onBlur={commitTextEdit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              cancelTextEdit()
            }
            // Enter falls through → inserts a newline (multiline text).
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: textBox.left,
            top: textBox.top,
            width: textBox.width,
            height: textBox.height,
            fontFamily: TEXT_FONT,
            fontSize: textBox.font,
            fontWeight: textBox.bold ? TEXT_FONT_WEIGHT_BOLD : TEXT_FONT_WEIGHT,
            lineHeight: TEXT_LINE_HEIGHT,
            padding: textBox.pad,
            textAlign: textBox.align,
            color: 'transparent',
            caretColor: textBox.color,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            margin: 0,
            resize: 'none',
            overflow: 'hidden',
            boxSizing: 'border-box',
            whiteSpace: 'pre',
          }}
          className="z-40 select-text outline-none"
        />
      )}
    </div>
  )
}

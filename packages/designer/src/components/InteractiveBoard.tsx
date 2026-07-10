import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ZoomIn, ZoomOut, Hand, RefreshCw, RectangleVertical, RectangleHorizontal, Rotate3d } from 'lucide-react'
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
  TOKEN_LABEL_PLACEHOLDER,
  TEXT_FONT,
  TEXT_FONT_WEIGHT,
  TEXT_FONT_WEIGHT_BOLD,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  TEXT_MIN_FONT,
  TEXT_MAX_FONT,
  type ArrowTip,
  type BoardElement,
  type ElementChange,
  type ElementPatch,
  type Operation,
  type PolylineElement,
  type ElementTransform,
  type Box,
  type Arrow3DElement,
  type Object3DElement,
  ARROW3D_DEFAULTS,
  IDENTITY_TRANSFORM,
} from '@youcoach-board/core'
import { useEditorStore, useEditorStoreApi } from '../store/context'
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
  toolIsTape,
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
import { ExportGuideFrame } from './ExportGuideFrame'
import { Arrow3DLayer, type Arrow3DLayerHandle } from './Arrow3DLayer'
import { Object3DLayer, type Object3DLayerHandle, type Token3D } from './Object3DLayer'
import { FieldHomographyLayer } from './FieldHomographyLayer'
import { FieldCameraLayer } from './FieldCameraLayer'
import { FieldSceneLayer } from './FieldSceneLayer'
import { TapeDecorations } from './TapeDecoration'
import { Text3DFrames, Text3DHtml } from './Text3DDecoration'
import { text3dCorners } from '../lib/text3d'
import { FieldEditOverlay } from './FieldEditOverlay'
import { FieldZoneTool } from './FieldZoneTool'
import { arrow3DHandlePositions, arrow3DHandlePositionsVia, arrow3DWorldHandles, boardToApexHeight, boardToGround, boardToHeight, makeArrow3DCamera, worldPointToBoard } from '../lib/arrow3d'
import { isObject3DRotatable } from '../lib/objects3d'
import { fieldHomography, fieldCamera, PITCH_MODELS } from '../lib/field-reference'
import { makeCalibratedCamera, configToOrbit, orbitToConfig, type PitchType, type Orbit } from '../lib/field-camera'
import { DEFAULT_ZONE } from '../lib/field-zones'
import { buildPinOps, groundDelta, groundMoveElement, polylineGround, pinNewToken, isText3d, isGroundElement, projectGround, standingTransform, centerBoard, referencePPM } from '../lib/field-anchor'
import { exportBoardImage, registerBoardExporter } from '../lib/export-image'
import { boardToMetric, worldToBoard } from '../lib/homography-camera'
import { cn } from '../lib/cn'

const MIN_SIZE = 6 // smallest box dimension a resize can produce (board units)
// The corner diagonally opposite a resize handle (stays pinned during a text resize).
const OPPOSITE_CORNER: Record<CornerId, CornerId> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }
const CANVAS_KEEP = 28 // min board units of a moved figure that must stay on-canvas
const POLY_END_R_PX = 7 // on-screen radius of the first/last polyline finish dots
const FREEHAND_MIN_STEP = 2 // min board-unit gap between captured freehand samples
// Selected OPEN paths show no bbox frame; instead a wider frame-colour stroke is
// drawn UNDER the path to highlight it (on-screen px added to the real stroke width).
const SELECTION_HALO_PX = 8
// A selected open polyline's under-path highlight: the same geometry, re-stroked in
// the selection-frame colour, wider + solid + no tips, at half opacity — so the real
// path (and any arrowhead) still reads clearly on top.
function pathHalo(el: Extract<BoardElement, { type: 'polyline' }>, scale: number): BoardElement {
  return { ...el, stroke: 'var(--color-selection-frame)', strokeWidth: el.strokeWidth + SELECTION_HALO_PX / scale, strokeStyle: 'solid', fill: 'transparent', startTip: 'none', endTip: 'none', transform: { ...el.transform, opacity: 0.5 } }
}
const MOVE_THRESHOLD_PX = 4 // on-screen drag distance before a move engages
// Alt/Option + wheel 3D zoom-to-cursor of the field camera (normal mode).
const WHEEL_ZOOM_K = 0.0015 // wheel delta → dolly factor (negative delta = zoom in)
const ZOOM_MIN_DIST = 2 // camera→target distance clamp (metres), matches OrbitControls
const ZOOM_MAX_DIST = 400
const ZOOM_MIN_CAM_Y = 0.5 // keep the camera a little above the grass
const OBJECT3D_MOVE_PX = 9 // firmer drag threshold for 3D objects (more resistance)
const SNAP_PX = 6 // on-screen distance within which a move snaps to another object


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
  // For 'line' drafts: the CAD measurement "tape" (2-point line + length label).
  tape: boolean
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

export function InteractiveBoard({ backgroundMode = false, homographyMode = false, cameraMode = false, zoneMode = false, showGrid = false, navigating = false, navMarkers = false, onNavTap }: { backgroundMode?: boolean; homographyMode?: boolean; cameraMode?: boolean; zoneMode?: boolean; showGrid?: boolean; navigating?: boolean; navMarkers?: boolean; onNavTap?: () => void }) {
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
  const pinSetup = useEditorStore((s) => s.pinSetup)
  const tokenSizeM = useEditorStore((s) => s.tokenSizeM)
  const exportGuide = useEditorStore((s) => s.exportGuide)
  const tokenTextScale = useEditorStore((s) => s.tokenTextScale)
  const dropReplaceId = useEditorStore((s) => s.dropReplaceId)
  const tokenLabelScale = useEditorStore((s) => s.tokenLabelScale)
  const duplicateInPlace = useEditorStore((s) => s.duplicateInPlace)
  const toolDefaults = useEditorStore((s) => s.toolDefaults)
  const viewport = useEditorStore((s) => s.viewport)
  const snapToObjects = useEditorStore((s) => s.snapToObjects)
  const keepToolActive = useEditorStore((s) => s.keepToolActive)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)
  const storeApi = useEditorStoreApi()
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
  // Token tool: the pointer's board position, so a 50%-opacity preview of the token
  // that a click would drop follows the cursor. Null when the pointer isn't over the
  // board (or the token tool isn't active).
  const [tokenPreview, setTokenPreview] = useState<Point | null>(null)
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
  // Screen pixels per board unit (CTM x-scale); selection chrome divides by it
  // to stay a constant on-screen size. Recomputed when the SVG resizes.
  const [scale, setScale] = useState(1)
  // Board→overlay-pixel mapping (from the SVG's screen CTM, relative to its own
  // top-left). Only changes on resize/zoom/pan — NOT per field-camera frame — so we
  // keep it in state (measured in an effect) rather than reading the ref in render.
  const [boardCtm, setBoardCtm] = useState<{ a: number; b: number; c: number; d: number; ex: number; ey: number } | null>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = () => {
      const m = svg.getScreenCTM()
      if (m && m.a) {
        setScale(m.a)
        const r = svg.getBoundingClientRect()
        setBoardCtm({ a: m.a, b: m.b, c: m.c, d: m.d, ex: m.e - r.left, ey: m.f - r.top })
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(svg)
    return () => ro.disconnect()
    // Re-measure when the viewBox (zoom/pan) changes, not just on resize.
  }, [viewBox])


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
  const object3dLayerRef = useRef<Object3DLayerHandle>(null)
  // Field-perspective calibration for arrows. Precedence: a hand-posed camera wins
  // (real 3D height + shadow), else a homography (ground-exact, faked height), else
  // the default fixed near-ortho camera. `arrow3dCam` is the calibrated camera when
  // one exists, so the camera-parameterised arrow math (ground/handles/height) all
  // works unchanged; homography still uses its own custom projection.
  // A real 3D field (background.field3d) wins over the legacy per-field calibrated
  // camera, which wins over the homography, which wins over the fixed camera.
  // Navigation edits background.field3d directly (coalesced into one undo step), so
  // there's no separate session pose — the field pose IS the drawing's stored pose.
  const field3d = doc.background.field3d
  const fieldCamCfg = field3d ?? fieldCamera(doc.background.fieldSvg)
  const fieldH = fieldHomography(doc.background.fieldSvg)
  const useHomography = !!fieldH && !fieldCamCfg
  const fixedCam = useState(() => makeArrow3DCamera())[0]
  const arrow3dCam = useMemo(() => (fieldCamCfg ? makeCalibratedCamera(fieldCamCfg) : fixedCam), [fieldCamCfg, fixedCam])
  // While editing a 3D field's background: reset the board framing (so the orbit
  // camera + zone markers align) and coalesce the whole session — orbit + nudges +
  // zone jumps — into ONE undo step (begin on enter, commit on Finish).
  const editing3d = backgroundMode && !!field3d
  // Camera interaction mode: 'orbit' = free orbit; 'pan' = drag pans (orbit off);
  // 'portrait'/'landscape' = a near-overhead pan/zoom-only view.
  const [view, setView] = useState<'orbit' | 'portrait' | 'landscape' | 'pan'>('orbit')
  const panMode = view !== 'orbit'
  useEffect(() => {
    if (!editing3d || !field3d) return
    // Prepare pitch pins (ONE undoable step, before the field-edit transaction):
    // (re)derive every element's ground anchor from its CURRENT board placement —
    // healing staleness from ordinary fixed-camera edits — and convert rectangles to
    // closed polylines so they can warp onto the field surface.
    pinSetup(buildPinOps(doc.elements, field3d))
    beginTransaction()
    return () => commitTransaction()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing3d])

  // Entering navigation pins elements to the field (ONE undoable step): convert
  // rectangles/ovals to warp-able polylines and derive every element's ground anchor
  // so ALL of them reproject as the view orbits, then coalesce the whole orbit
  // session (pose + reprojections, written live to background.field3d) into ONE undo
  // step — begin on enter, commit on exit — exactly like Edit-Background.
  useEffect(() => {
    if (!navigating) return
    const cam = doc.background.field3d
    if (!cam) return
    pinSetup(buildPinOps(doc.elements, cam))
    beginTransaction()
    return () => commitTransaction()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating])

  // Edit-Background camera nudges for the 3D field (coach-friendly, discrete steps;
  // fov stays 50). Each is one undo step.
  function nudgeField3d(fn: (o: Orbit) => Orbit) {
    if (!field3d) return
    setView('orbit')
    setBackground({ field3d: orbitToConfig(fn(configToOrbit(field3d)), field3d.ref as PitchType) })
  }
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

  // Option/Alt + wheel: a 3D "zoom to cursor" of the field camera, in NORMAL mode
  // only (navigation + background-edit have their own OrbitControls). Dollies the
  // saved field3d toward/away from the ground point under the pointer, keeping that
  // point fixed on screen — like OrbitControls' zoomToCursor. The whole wheel
  // gesture coalesces into ONE undo step via a debounced transaction. The live pose
  // is read from the store (not a stale closure) so fast bursts accumulate.
  const zoomCommitRef = useRef<number | null>(null)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    if (backgroundMode || homographyMode || cameraMode || zoneMode || navigating) return
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return
      const f3d = storeApi.getState().doc.background.field3d
      if (!f3d) {
        // 2D flat viewport: Alt+wheel zooms toward the cursor. No 3D camera and no
        // undo step (the viewport isn't part of the document) — re-anchor the pan so
        // the board point under the pointer stays put as the zoom changes. Down =
        // zoom out (matches the 3D dolly); clamp mirrors the store's setViewport.
        e.preventDefault()
        const { zoom, panX, panY } = storeApi.getState().viewport
        const next = clamp(zoom * Math.exp(-e.deltaY * WHEEL_ZOOM_K), 0.1, 8)
        if (next === zoom) return
        const p = clientToBoard(svg, e.clientX, e.clientY)
        const k = zoom / next
        storeApi.getState().setViewport({ zoom: next, panX: p.x - (p.x - panX) * k, panY: p.y - (p.y - panY) * k })
        return
      }
      e.preventDefault()
      const p = clientToBoard(svg, e.clientX, e.clientY)
      const g = boardToGround(p.x, p.y, makeCalibratedCamera(f3d))
      const pivot = g ? [g.x, 0, g.z] : f3d.target
      const C = f3d.position, T = f3d.target
      const dist = Math.hypot(C[0] - T[0], C[1] - T[1], C[2] - T[2]) || 1
      const f = clamp(Math.exp(e.deltaY * WHEEL_ZOOM_K), ZOOM_MIN_DIST / dist, ZOOM_MAX_DIST / dist)
      if (f === 1) return
      const toward = (a: readonly number[]): [number, number, number] => [pivot[0] + (a[0] - pivot[0]) * f, pivot[1] + (a[1] - pivot[1]) * f, pivot[2] + (a[2] - pivot[2]) * f]
      const position = toward(C)
      position[1] = Math.max(ZOOM_MIN_CAM_Y, position[1])
      if (zoomCommitRef.current === null) beginTransaction()
      else window.clearTimeout(zoomCommitRef.current)
      setBackground({ field3d: { ...f3d, position, target: toward(T) } })
      zoomCommitRef.current = window.setTimeout(() => {
        commitTransaction()
        zoomCommitRef.current = null
      }, 250)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      svg.removeEventListener('wheel', onWheel)
      if (zoomCommitRef.current !== null) {
        window.clearTimeout(zoomCommitRef.current)
        commitTransaction()
        zoomCommitRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundMode, homographyMode, cameraMode, zoneMode, navigating])

  // A near-overhead top view; azimuth sets the orientation (0 = landscape / goals
  // left-right, 90 = portrait / goals top-bottom). Orbit is disabled while locked.
  function goTopView(orientation: 'portrait' | 'landscape') {
    const ref = (field3d?.ref ?? 'soccer11') as PitchType
    const pose = orbitToConfig({ targetX: 52.5, targetZ: 34, azimuth: orientation === 'portrait' ? 90 : 0, elevation: 89.5, distance: orientation === 'portrait' ? 135 : 100, fov: 50 }, ref)
    setView(orientation)
    setBackground({ field3d: pose })
  }
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
  const pitchLen = fieldCamCfg ? (PITCH_MODELS[fieldCamCfg.ref as PitchType] ?? PITCH_MODELS.soccer11).size[0] : 105
  const pitchK = pitchLen / 105
  const arrow3dDefaults = arrow3dMetric
    ? { ...ARROW3D_DEFAULTS, splineWidth: 18 * pitchK, splineHeight: 4 * pitchK, stickWidth: 1.2 * pitchK, thickness: 0.3 * pitchK, tipWidth: 1.5 * pitchK, tipLength: 2.5 * pitchK }
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

  // ── 3D objects (balls, cubes … the "3D materials" palette) ─────────────────
  // In-progress edit of one object: drag its body (move on the ground) or its
  // rotate handle (spin about Y). Placement is intrinsic (x/z ground + rotation).
  // `start`/`engaged` add a small drag threshold (resistance) before a move takes;
  // `alt` (Option held on press) duplicates the object once the drag engages.
  // `moving` = the ground origins of every object dragged together (the clicked
  // object `id` is the primary, used as the snap reference). Rotate uses only the
  // primary.
  const [object3dGesture, setObject3dGesture] = useState<{ id: string; kind: 'move' | 'rotate'; orig: Object3DElement; grabGround: { x: number; z: number }; start: Point; engaged: boolean; alt: boolean; moving: { id: string; x: number; z: number }[] } | null>(null)
  // Field-axis alignment guides shown while dragging 3D object(s).
  const [object3dSnapGuides, setObject3dSnapGuides] = useState<SnapLine[]>([])
  const object3dElements = doc.elements.filter((e): e is Object3DElement => e.type === 'object3d')
  // 3D tokens (background.tokens3d): disc-shaped tokens rendered as real pucks by
  // Object3DLayer. Ground/size come from the pin anchors when present, else are
  // projected through the current camera / sized by the reference ppm. Jersey
  // tokens keep their 2D badge (their silhouette has no 3D counterpart).
  const tokens3d = doc.background.tokens3d
  const token3dList: Token3D[] = !tokens3d
    ? []
    : doc.elements.flatMap((el) => {
        const live = liveElement(el)
        if (live.type !== 'token' || live.shape !== 'token') return []
        // Anchor the disc at the badge's CENTER (what the user reads as "the
        // position"), not at the bottom-center ground pin — the pin is the
        // standing anchor, half a badge below the circle's center (2.5 m off
        // for a default 5 m token in top-down).
        const c = centerBoard(live)
        const g = arrow3dGround({ x: c.x, y: c.y })
        if (!g) return []
        const ground: [number, number] = [g.x, g.z]
        const sizeM = live.sizeM ?? (live.width * live.transform.scale) / referencePPM()
        return [{
          id: el.id,
          x: ground[0],
          z: ground[1],
          sizeM,
          opacity: live.transform.opacity,
          style: { tokenFill: live.tokenFill, color1: live.color1, color2: live.color2, text: live.text, textColor: live.textColor, textScale: tokenTextScale },
        }]
      })

  function editObject3D(g: NonNullable<typeof object3dGesture>, patch: Partial<Object3DElement>) {
    const before: Partial<Object3DElement> = {}
    for (const k of Object.keys(patch) as (keyof Object3DElement)[]) (before as Record<string, unknown>)[k] = g.orig[k]
    updateElements([{ id: g.id, before, after: patch }])
  }

  // Snap a ground point (nx, nz) so it lines up with `targets` ALONG THE FIELD AXES
  // (constant pitch-x or pitch-z), not screen axes — so alignment behaves the same
  // in perspective as top-down. The snap radius is the on-screen SNAP_PX converted
  // to ground metres per axis (perspective varies metres/px). Emits a field-axis
  // guide (a straight ground line stays straight projected) per snapped axis.
  function snapGroundAxes(nx: number, nz: number, targets: { x: number; z: number }[]): { x: number; z: number; guides: SnapLine[] } {
    const px = SNAP_PX / (scale || 1)
    const c0 = object3dToBoard(nx, 0, nz)
    const cX = object3dToBoard(nx + 0.5, 0, nz)
    const cZ = object3dToBoard(nx, 0, nz + 0.5)
    const thrX = px / (Math.hypot(cX.x - c0.x, cX.y - c0.y) / 0.5 || 1)
    const thrZ = px / (Math.hypot(cZ.x - c0.x, cZ.y - c0.y) / 0.5 || 1)
    let bestX = thrX
    let snapX: number | null = null
    let bestZ = thrZ
    let snapZ: number | null = null
    for (const t of targets) {
      const dxa = Math.abs(t.x - nx)
      if (dxa < bestX) {
        bestX = dxa
        snapX = t.x
      }
      const dza = Math.abs(t.z - nz)
      if (dza < bestZ) {
        bestZ = dza
        snapZ = t.z
      }
    }
    const ox = snapX ?? nx
    const oz = snapZ ?? nz
    const toB = (x: number, z: number) => object3dToBoard(x, 0, z)
    const guides: SnapLine[] = []
    if (snapX != null) {
      const aligned = targets.filter((t) => Math.abs(t.x - ox) < 0.02)
      const zs = [oz, ...aligned.map((t) => t.z)]
      const a = toB(ox, Math.min(...zs))
      const b = toB(ox, Math.max(...zs))
      guides.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, marks: [toB(ox, oz), ...aligned.map((t) => toB(t.x, t.z))] })
    }
    if (snapZ != null) {
      const aligned = targets.filter((t) => Math.abs(t.z - oz) < 0.02)
      const xs = [ox, ...aligned.map((t) => t.x)]
      const a = toB(Math.min(...xs), oz)
      const b = toB(Math.max(...xs), oz)
      guides.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, marks: [toB(ox, oz), ...aligned.map((t) => toB(t.x, t.z))] })
    }
    return { x: ox, z: oz, guides }
  }

  // Field-axis snap for a MOVE: the moving selection's ground centre lines up with
  // other elements' ground centres (objects use x/z; 2D elements project their box
  // centre onto the pitch).
  function snapGroundPoint(nx: number, nz: number, exclude: Set<string>): { x: number; z: number; guides: SnapLine[] } {
    const targets: { x: number; z: number }[] = []
    for (const e of doc.elements) {
      if (exclude.has(e.id) || e.type === 'arrow3d') continue
      if (e.type === 'object3d') {
        targets.push({ x: e.x, z: e.z })
        continue
      }
      const b = unionBounds([e])
      const gr = b && arrow3dGround({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
      if (gr) targets.push(gr)
    }
    return snapGroundAxes(nx, nz, targets)
  }

  // Move (x/z) every object in the gesture by a shared ground delta, or rotate
  // the primary (about Y). The primary drives snapping; its snapped delta applies
  // to all so a multi-selection keeps its relative layout.
  function dragObject3D(g: NonNullable<typeof object3dGesture>, p: Point, shift: boolean) {
    const ground = arrow3dGround(p)
    if (!ground) return
    if (g.kind === 'move') {
      let dx = ground.x - g.grabGround.x
      let dz = ground.z - g.grabGround.z
      if (snapToObjects) {
        const sn = snapGroundPoint(g.orig.x + dx, g.orig.z + dz, new Set(g.moving.map((m) => m.id)))
        dx = sn.x - g.orig.x
        dz = sn.z - g.orig.z
        setObject3dSnapGuides(sn.guides)
      } else if (object3dSnapGuides.length) setObject3dSnapGuides([])
      updateElements(
        g.moving.map((m) => {
          const before: Partial<Object3DElement> = { x: m.x, z: m.z }
          const after: Partial<Object3DElement> = { x: m.x + dx, z: m.z + dz }
          return { id: m.id, before, after }
        }),
      )
    } else {
      // Rotate: the handle points toward the pointer's ground direction from the
      // center. Holding Shift snaps to 15° steps.
      let rot = Math.atan2(ground.x - g.orig.x, ground.z - g.orig.z)
      if (shift) {
        const step = Math.PI / 12 // 15°
        rot = Math.round(rot / step) * step
      }
      editObject3D(g, { rotation: rot })
    }
  }

  // Project a world point (metres) to board coords through the active field cam
  // (or the field homography), so 3D-object handles land in the right place.
  function object3dToBoard(x: number, y: number, z: number): { x: number; y: number } {
    return useHomography ? worldToBoard(fieldH!, x, y, z) : worldPointToBoard(arrow3dCam, x, y, z)
  }
  // The rotate handle sits at the object's "forward" edge on the ground.
  function object3dRotateBoard(el: Object3DElement): { x: number; y: number } {
    const r = el.size * 0.9
    return object3dToBoard(el.x + r * Math.sin(el.rotation), 0, el.z + r * Math.cos(el.rotation))
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
      // A 3D object is caught when its base centre falls inside the lasso loop.
      if (el.type === 'object3d') {
        if (pointInPolygon(object3dToBoard(el.x, 0, el.z), g.pts)) g.ids.add(el.id)
        continue
      }
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
    // Circle (centre `p`, radius `r`) vs an axis-aligned board box.
    const hitsBox = (b: { x: number; y: number; width: number; height: number }) => {
      const cx = Math.max(b.x, Math.min(p.x, b.x + b.width))
      const cy = Math.max(b.y, Math.min(p.y, b.y + b.height))
      const dx = p.x - cx
      const dy = p.y - cy
      return dx * dx + dy * dy <= r * r
    }
    for (const el of doc.elements) {
      if (el.type === 'arrow3d') {
        // No SVG box — hit-test the eraser circle against the arrow's projected
        // tail/head/apex bounding box (its footprint on the board).
        const h = arrow3dHandleBoard(el)
        const xs = h.map((q) => q.x)
        const ys = h.map((q) => q.y)
        const bx = Math.min(...xs)
        const by = Math.min(...ys)
        if (hitsBox({ x: bx, y: by, width: Math.max(...xs) - bx, height: Math.max(...ys) - by })) out.push(el.id)
        continue
      }
      if (el.type === 'object3d') {
        // Project the base centre and a footprint edge to get a board-space radius,
        // then do a circle-vs-circle test against the eraser.
        const c = object3dToBoard(el.x, 0, el.z)
        const objR = el.size * (doc.background.objectScale ?? 1) * 0.5
        const e2 = object3dToBoard(el.x + objR, 0, el.z)
        const radB = Math.hypot(e2.x - c.x, e2.y - c.y)
        const dx = p.x - c.x
        const dy = p.y - c.y
        if (Math.hypot(dx, dy) <= r + radB) out.push(el.id)
        continue
      }
      const b = getElementBounds(el)
      if (hitsBox(b)) out.push(el.id)
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
    // A 3D object snaps by the centre of its base (x, y=0, z) projected to board.
    if (el.type === 'object3d') return [object3dToBoard(el.x, 0, el.z)]
    if (el.type === 'arrow3d') return []
    const [nw, ne, se, sw] = boardCorners(el)
    const center = { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 }
    const mid = (a: SnapMark, b: SnapMark): SnapMark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    if (el.type === 'ellipse') return [mid(nw, ne), mid(ne, se), mid(se, sw), mid(sw, nw), center]
    return [nw, ne, se, sw, center]
  }
  // A snap TARGET for one element: its box + notable points. A 3D object is a
  // zero-size box at its base centre (so it aligns without adding spurious edges).
  function snapElementOf(e: BoardElement): SnapElement | null {
    if (e.type === 'object3d') {
      const c = object3dToBoard(e.x, 0, e.z)
      return { box: { x: c.x, y: c.y, width: 0, height: 0 }, points: [c] }
    }
    const b = unionBounds([e])
    return b ? { box: b, points: notablePoints(e) } : null
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
      .map(snapElementOf)
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

  // An element's board-space CENTRE at transform `t` (translate only — scale/rotate
  // are about the centre, so they don't move it).
  function elBoardCenter(el: BoardElement, t: ElementTransform): Point {
    const lb = getLocalBounds(el)
    return { x: lb.x + lb.width / 2 + t.x, y: lb.y + lb.height / 2 + t.y }
  }

  // On a 3D field: the move gesture's snapped GROUND delta (metres, x/z) + the
  // field-axis guide lines. The selection's ground centre is snapped to other
  // elements' ground x/z (constant pitch-x or pitch-z lines — the SAME behaviour in
  // perspective as top-down), never to screen horizontals/verticals. No snap → the
  // raw ground delta with no guides.
  function groundSnap(m: MoveState): { dgx: number; dgz: number; guides: SnapLine[] } {
    const dg = groundDelta(arrow3dCam, m.start, m.current) ?? { dgx: 0, dgz: 0 }
    if (!snapToObjects || !m.engaged) return { dgx: dg.dgx, dgz: dg.dgz, guides: [] }
    const originEls = m.ids
      .map((id) => {
        const el = doc.elements.find((e) => e.id === id)
        return el && m.origins[id] ? ({ ...el, transform: m.origins[id] } as BoardElement) : null
      })
      .filter((e): e is BoardElement => e !== null)
    const u = unionBounds(originEls)
    const gc0 = u ? arrow3dGround({ x: u.x + u.width / 2, y: u.y + u.height / 2 }) : null
    if (!gc0) return { dgx: dg.dgx, dgz: dg.dgz, guides: [] }
    const sn = snapGroundPoint(gc0.x + dg.dgx, gc0.z + dg.dgz, new Set(m.ids))
    return { dgx: sn.x - gc0.x, dgz: sn.z - gc0.z, guides: sn.guides }
  }

  // Board translate that slides a standing/flat element (token/figure/text/…) along
  // the pitch by a ground delta (metres), perspective-correct; null if its centre
  // leaves the ground plane. Its ground anchor (if any) shifts by the same delta.
  function groundTranslate(el: BoardElement, t: ElementTransform, dgx: number, dgz: number): Point | null {
    const ob = elBoardCenter(el, t)
    const gc = arrow3dGround(ob)
    if (!gc) return null
    const nb = projectGround(arrow3dCam, gc.x + dgx, gc.z + dgz)
    return { x: t.x + (nb[0] - ob.x), y: t.y + (nb[1] - ob.y) }
  }

  // The single [x,z] ground anchor a standing element carries (figure/token/3D text),
  // shifted by (dgx,dgz) — for keeping the pin in step with a ground move.
  function shiftGroundAnchor(el: BoardElement, dgx: number, dgz: number): [number, number] | undefined {
    const g = (isGroundElement(el) || isText3d(el)) ? el.ground : undefined
    return g ? [g[0] + dgx, g[1] + dgz] : undefined
  }

  // The resized element's notable points (rotation- and type-aware: ellipse radius
  // extremes, else corners) + its AABB, for a given handle pointer.
  function resizedNotable(el: BoardElement, g: Gesture, pointer: Point): { pts: SnapMark[]; box: Box } {
    const { box, transform } = computeResize(g.box0, g.t0, g.handle as CornerId, pointer, MIN_SIZE, {
      // Tokens always resize about their center (symmetric), so their pinned
      // ground spot doesn't shift; others do so only with the alt modifier.
      fromCenter: g.alt || el.type === 'token',
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

  // Build the token a click at board point `c` would create — the editable next-token
  // defaults (style + text/label), sized to match existing tokens (or the field's
  // figure scale) and, on a 3D field, pinned to the pitch at the global token size so
  // it perspective-scales. Shared by the click handler and the hover PREVIEW so they
  // never diverge. `id` is 'token-preview' for the ghost, a real uuid for a placement.
  function makeTokenAt(c: Point, id: string): BoardElement {
    const td = tokenDefaults
    // Size: copy the last selected/created token's CURRENT size (so resizes are
    // honoured); else match any token already on the board; else the field figure scale.
    const ref =
      doc.elements.find((e) => e.id === lastTokenId && e.type === 'token') ??
      [...doc.elements].reverse().find((e) => e.type === 'token')
    const size = ref?.type === 'token' ? ref.width : Math.round(TOKEN_SIZE * doc.background.figureScale)
    let tok = makeToken(id, c.x, c.y, td, td.text, size)
    if (tok.type === 'token') {
      tok.label = td.label
      tok.text = nextTokenText(doc.elements, tok, td.text)
      if (fieldCamCfg) {
        const existing = doc.elements.find((e): e is Extract<BoardElement, { type: 'token' }> => e.type === 'token')
        tok = pinNewToken(tok, fieldCamCfg, existing?.sizeM ?? tokenSizeM)
      }
    }
    return tok
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
      // Tokens never spin — a group rotation only orbits their position (rotate kept).
      const rotate = el.type === 'token' ? t0.rotate : t0.rotate + deg
      return { ...t0, rotate, x: c1.x - lc.x, y: c1.y - lc.y }
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

  // The 3D-field version of snapVertexBoard: magnet a dragged vertex to the FIELD
  // axes (constant pitch-x / pitch-z) through other elements' notable points AND
  // this shape's other vertices — projected onto the pitch — so a point aligns the
  // same way in perspective as top-down. `excludeIdx` skips the moving vertex.
  function snapVertexGround(g: Gesture, board: Point, excludeIdx: number): { board: Point; guides: SnapLine[] } {
    const el = doc.elements.find((e) => e.id === g.id)
    const gp = arrow3dGround(board)
    if (!snapToObjects || !el || !gp) return { board, guides: [] }
    const targets: { x: number; z: number }[] = []
    for (const e of doc.elements) {
      if (e.id === g.id || e.type === 'arrow3d') continue
      for (const p of notablePoints(e)) {
        const gg = arrow3dGround(p)
        if (gg) targets.push(gg)
      }
    }
    if (el.type === 'polyline') {
      el.points.forEach((pt, idx) => {
        if (idx === excludeIdx) return
        const gg = arrow3dGround(elementToBoard({ x: pt[0], y: pt[1] }, g.box0, g.t0))
        if (gg) targets.push(gg)
      })
    }
    const sn = snapGroundAxes(gp.x, gp.z, targets)
    const nb = projectGround(arrow3dCam, sn.x, sn.z)
    return { board: clampToCanvas({ x: nb[0], y: nb[1] }), guides: sn.guides }
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
    // On a 3D field a vertex snaps along the pitch axes; flat boards → screen axes.
    const snapped = fieldCamCfg ? snapVertexGround(g, clampToCanvas(board), i) : snapVertexBoard(g, clampToCanvas(board), i)
    return { lp: boardToElement(snapped.board, g.box0, g.t0), guides: snapped.guides }
  }

  // Same object-snap for a NEW vertex inserted by dragging a mid-segment anchor.
  function resolveAnchorDrag(g: Gesture): { lp: Point; guides: SnapLine[] } {
    const snapped = fieldCamCfg ? snapVertexGround(g, clampToCanvas(g.current), -1) : snapVertexBoard(g, clampToCanvas(g.current), -1)
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
  // A live vertex edit changes `points`; on a pitch-pinned polyline keep its
  // per-point `ground` anchor in step so anything reading `ground` (the Tape's
  // length/ticks/label) tracks the drag instead of lagging until commit. Off-pitch
  // or unpinned → just the new points. Mirrors reanchorPoints (the commit path).
  function liveReground(el: Extract<BoardElement, { type: 'polyline' }>, points: Array<[number, number]>): BoardElement {
    if (el.ground && fieldCamCfg) {
      const ground = polylineGround({ ...el, points }, arrow3dCam)
      if (ground) return { ...el, points, ground }
    }
    return { ...el, points }
  }

  function liveElement(el: BoardElement): BoardElement {
    if (groupGesture && groupGesture.t0[el.id]) {
      return { ...el, transform: groupTransformFor(el, groupGesture) }
    }
    if (move && move.origins[el.id]) {
      if (!move.engaged) return el // not dragged far enough yet — stay put
      const o = move.origins[el.id]
      // On a 3D field EVERY element moves along the pitch by a field-axis-snapped
      // ground delta: shapes warp (groundMoveElement); figures/tokens re-stand at the
      // new depth (so they GROW/SHRINK with perspective as they near/leave the
      // camera); other flat elements (3D text) slide keeping their anchor in step.
      // Flat boards fall back to the screen-space translate.
      if (fieldCamCfg) {
        const s = groundSnap(move)
        const moved = groundMoveElement(el, arrow3dCam, s.dgx, s.dgz)
        if (moved) return moved
        if (isGroundElement(el) && el.ground) {
          const ng: [number, number] = [el.ground[0] + s.dgx, el.ground[1] + s.dgz]
          return { ...el, transform: standingTransform(el, arrow3dCam, ng[0], ng[1]), ground: ng }
        }
        const gt = groundTranslate(el, o, s.dgx, s.dgz)
        if (gt) {
          const ground = shiftGroundAnchor(el, s.dgx, s.dgz)
          return { ...el, transform: { ...o, x: gt.x, y: gt.y }, ...(ground ? { ground } : {}) } as BoardElement
        }
      }
      const d = moveDelta(move)
      return { ...el, transform: { ...o, x: o.x + d.x, y: o.y + d.y } }
    }
    if (gesture && gesture.id === el.id) {
      if (gesture.kind === 'rotate') {
        return { ...el, transform: { ...gesture.t0, rotate: rotationFor(gesture.box0, gesture.t0, gesture.current, gesture.snap) } }
      }
      if (gesture.kind === 'resize') {
        const { box, transform } = computeResize(gesture.box0, gesture.t0, gesture.handle as CornerId, resizePointer(el, gesture).pointer, MIN_SIZE, {
          // Tokens always resize symmetrically about their center (see commit).
          fromCenter: gesture.alt || el.type === 'token',
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
        return liveReground(el, points)
      }
      if (gesture.kind === 'anchor' && el.type === 'polyline') {
        // Insert a vertex on segment `seg` (between vertex seg and seg+1) and drag
        // it — splits a straight segment / adds a curve point on a curved one.
        const seg = Number(gesture.handle.slice('anchor-'.length))
        const { lp } = resolveAnchorDrag(gesture)
        const points = [...el.points]
        points.splice(seg + 1, 0, [lp.x, lp.y])
        return liveReground(el, points)
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
    // Locked elements stay put — drop them from the move (they remain selected).
    const movable = presetOrigins ? ids : ids.filter((id) => !doc.elements.find((e) => e.id === id)?.locked)
    if (movable.length === 0) return
    if (!presetOrigins)
      for (const id of movable) {
        const el = doc.elements.find((e) => e.id === id)
        if (el) origins[id] = el.transform
      }
    setMove({ ids: movable, start: from, current: from, origins, engaged: false })
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
    if (backgroundMode || homographyMode || cameraMode || zoneMode || navigating) return // calibration/navigation: only their own handles are active
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
      createFigure(makeTokenAt(clampToCanvas(p), crypto.randomUUID()))
      return
    }

    // Text: a stamp tool — click drops an (empty) text element and immediately
    // opens the inline editor (Excalidraw-style). Blurring it empty discards it.
    if (activeTool === 'text') {
      const c = clampToCanvas(p)
      // 3D text only when on a 3D field; pin its centre to the drop point's pitch spot.
      const style = fieldCamCfg ? textDefaults : { ...textDefaults, text3d: false }
      let txt = makeText(crypto.randomUUID(), c.x, c.y, style, '')
      if (fieldCamCfg && txt.type === 'text' && txt.text3d) {
        const g = boardToGround(c.x, c.y, arrow3dCam)
        if (g) txt = { ...txt, ground: [g.x, g.z] }
      }
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
      setDraft({ type, start: p, current: p, endTip: toolEndTip(activeTool), curve: toolIsCurved(activeTool), zigzag: toolIsZigzag(activeTool), double: toolIsDouble(activeTool), tape: toolIsTape(activeTool), snap: e.shiftKey })
      containerRef.current?.setPointerCapture(e.pointerId)
    } else {
      // A 3D thing under the cursor (arrow / object / token disc) — not SVG, so it
      // can't be hit by the normal element handlers. In real-camera mode arrows
      // live in the object layer's scene (shared depth buffer); the arrow layer
      // only answers in the legacy homography/fixed modes.
      const objId = arrow3dLayerRef.current?.pick(p.x, p.y) ?? object3dLayerRef.current?.pick(p.x, p.y)
      if (objId) {
        const el = doc.elements.find((x) => x.id === objId)
        // A 3D arrow selects and starts a body-move.
        if (el?.type === 'arrow3d') {
          setSelection(e.shiftKey ? [...new Set([...selectedIds, objId])] : [objId])
          const ground = arrow3dGround(p)
          if (ground) {
            beginTransaction()
            setArrow3dGesture({ id: objId, kind: 'body', orig: el, grabGround: ground })
          }
          try {
            containerRef.current?.setPointerCapture(e.pointerId)
          } catch {
            /* best-effort */
          }
          return
        }
        // A 3D object selects (and starts a move on the ground).
        if (el?.type === 'object3d') {
          // Shift toggles selection membership without starting a drag.
          if (e.shiftKey) {
            setSelection(selectedIds.includes(objId) ? selectedIds.filter((i) => i !== objId) : [...selectedIds, objId])
            try {
              containerRef.current?.setPointerCapture(e.pointerId)
            } catch {
              /* best-effort */
            }
            return
          }
          // Clicking an already-selected object keeps the whole selection, so a
          // drag moves every selected 3D object together; else select just this.
          const sel = selectedIds.includes(objId) ? selectedIds : [objId]
          setSelection(sel)
          const ground = arrow3dGround(p)
          // The transaction begins on engagement (past the drag threshold), not
          // here — so a bare click doesn't create an empty edit / duplicate.
          // Locked objects stay put — don't include them in the drag (a locked
          // clicked object just selects); only start a gesture if something moves.
          if (ground && !el.locked) {
            const moving = object3dElements.filter((x) => sel.includes(x.id) && !x.locked).map((x) => ({ id: x.id, x: x.x, z: x.z }))
            if (moving.length) setObject3dGesture({ id: objId, kind: 'move', orig: el, grabGround: ground, start: p, engaged: false, alt: e.altKey, moving })
          }
          try {
            containerRef.current?.setPointerCapture(e.pointerId)
          } catch {
            /* best-effort */
          }
          return
        }
        // A 3D token disc under the cursor (tokens3d): select it and drag via the
        // normal 2D move machinery — the token stays a 2D element; the disc just
        // follows its derived ground point.
        if (el?.type === 'token') {
          if (e.shiftKey) {
            setSelection(selectedIds.includes(objId) ? selectedIds.filter((i) => i !== objId) : [...selectedIds, objId])
            return
          }
          const sel = selectedIds.includes(objId) ? selectedIds : [objId]
          setSelection(sel)
          if (!el.locked) startMove(sel, p, e.pointerId)
          return
        }
      }
      setMarquee({ start: p, current: p, additive: e.shiftKey, base: selectedIds })
      containerRef.current?.setPointerCapture(e.pointerId)
    }
  }

  // Start dragging a selected 3D object's rotate handle.
  function onObject3DRotateDown(el: Object3DElement, e: React.PointerEvent) {
    if (el.locked) return
    e.stopPropagation()
    const p = svgRef.current ? clientToBoard(svgRef.current, e.clientX, e.clientY) : { x: 0, y: 0 }
    const ground = arrow3dGround(p) ?? { x: el.x, z: el.z }
    beginTransaction()
    setObject3dGesture({ id: el.id, kind: 'rotate', orig: el, grabGround: ground, start: p, engaged: true, alt: false, moving: [{ id: el.id, x: el.x, z: el.z }] })
    try {
      containerRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* best-effort */
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
        if (el.type === 'arrow3d') return false // 3D arrows have no SVG box
        // A 3D object is picked by its base centre projected to the board.
        if (el.type === 'object3d') {
          const c = object3dToBoard(el.x, 0, el.z)
          return c.x >= box.x && c.x <= box.x + box.width && c.y >= box.y && c.y <= box.y + box.height
        }
        const b = getElementBounds(el)
        return contain ? boxContains(box, b) : boxesIntersect(b, box)
      })
      .map((el) => el.id)
    return m.additive ? [...new Set([...m.base, ...hits])] : hits
  }

  function onElementPointerDown(e: React.PointerEvent, el: BoardElement) {
    if (e.button !== 0) return
    if (creating || backgroundMode || homographyMode || cameraMode || zoneMode || navigating) return // calibration/navigation: elements are inert
    // 3D objects/arrows are painted ABOVE the SVG, so one under the cursor is visually
    // on top of this 2D element — don't grab the click here; let it bubble to the
    // container's 3D hit-test, which selects the thing you actually see on top.
    if (fieldCamCfg && svgRef.current) {
      const p = clientToBoard(svgRef.current, e.clientX, e.clientY)
      if (object3dLayerRef.current?.pick(p.x, p.y) || arrow3dLayerRef.current?.pick(p.x, p.y)) return
    }
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
    if (el.locked) return // locked → no inline edit
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
    if (el.type !== 'token' || el.locked) return
    if (field === 'label' && !el.showLabel) return // nothing to edit if hidden
    cancelLongPress()
    setSelection([el.id])
    setEditing({ id: el.id, field, text: field === 'label' ? el.label : el.text })
    let cx: number
    let cy: number
    let font: number // editor font in screen px (overlays the rendered glyph 1:1)
    if (field === 'label') {
      // Caption: a FIXED on-screen-size label anchored a fixed gap below the token's
      // BASE — which sits at (centre + half-height × perspective scale). Mirrors the
      // renderer so the textarea overlays the glyph 1:1 whatever the token's size.
      const gapBoard = TOKEN_LABEL_GAP_PX / scale
      const fontBoard = (TOKEN_LABEL_PX / scale) * tokenLabelScale
      const baseY = el.y + el.height / 2 + (el.height / 2) * el.transform.scale + el.transform.y
      cx = el.x + el.width / 2 + el.transform.x
      cy = baseY + gapBoard + fontBoard / 2
      font = TOKEN_LABEL_PX * tokenLabelScale
    } else {
      // Badge number: anchored at the geometry's text point, sized into the box.
      const g = TOKEN_GEOMETRY[el.shape]
      cx = el.x + (g.text.x / TOKEN_VIEW) * el.width + el.transform.x
      cy = el.y + (g.text.y / TOKEN_VIEW) * el.height + el.transform.y
      font = (g.text.size / TOKEN_VIEW) * (el.width * el.transform.scale * scale) * tokenTextScale
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
    // A newly created text is briefly unselected/inert; a locked existing one never edits.
    if (el.type !== 'text' || (el.locked && !created)) return
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
    // Locked members keep the frame's size but are excluded from t0, so they
    // neither preview-transform nor commit (group resize/rotate skips them).
    const t0: Record<string, ElementTransform> = {}
    for (const el of liveSelected) if (!el.locked) t0[el.id] = el.transform
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
    if (object3dGesture) {
      const g = object3dGesture
      if (!g.engaged) {
        // Movement resistance: ignore until the pointer has moved past the
        // threshold, so a click doesn't nudge (or Option-click duplicate) it.
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) * scale < OBJECT3D_MOVE_PX) return
        const ground = arrow3dGround(p) ?? g.grabGround
        if (g.alt) {
          // Option+drag: drop a copy of every moving object at its original spot
          // and drag the copies (the originals stay put).
          const copies: Object3DElement[] = []
          for (const m of g.moving) {
            const src = object3dElements.find((x) => x.id === m.id)
            if (!src) continue
            const copy = { ...src, id: crypto.randomUUID() }
            createFigure(copy)
            copies.push(copy)
          }
          beginTransaction()
          const primary = copies[g.moving.findIndex((m) => m.id === g.id)] ?? copies[0] ?? { ...g.orig, id: crypto.randomUUID() }
          setSelection(copies.map((c) => c.id))
          setObject3dGesture({ id: primary.id, kind: 'move', orig: primary, grabGround: ground, start: g.start, engaged: true, alt: true, moving: copies.map((c) => ({ id: c.id, x: c.x, z: c.z })) })
        } else {
          beginTransaction()
          setObject3dGesture({ ...g, engaged: true, grabGround: ground })
        }
        return
      }
      dragObject3D(g, p, e.shiftKey)
      return
    }
    if (freeDraft) {
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
    // Token tool with no active gesture: move the drop-preview ghost with the cursor.
    else if (activeTool === 'token') setTokenPreview(clampToCanvas(p))
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
    } else if (object3dGesture) {
      setObject3dGesture(null)
      if (object3dSnapGuides.length) setObject3dSnapGuides([])
      commitTransaction()
    } else if (freeDraft) {
      const pts = freeDraft
      setFreeDraft(null)
      // Need at least a short stroke (≥2 distinct points) to keep it.
      if (pts.length >= 2) createFigure(applyFigureStyle(makeDraw(crypto.randomUUID(), pts), toolDefaults))
    } else if (draft) {
      const { type, start, current, endTip, curve, zigzag, double, tape, snap } = draft
      setDraft(null)
      if (type === 'line') {
        if (isDragSignificant('line', start, current)) {
          // A real drag → a straight line (2-point polyline, end-tipped if arrow;
          // a tape carries its measurement flag).
          const end = snap ? snapLineEnd(start, current) : current
          createFigure(applyFigureStyle(makeLine(crypto.randomUUID(), start, end, endTip, curve, zigzag, double, tape), toolDefaults))
        } else if (!tape) {
          // A click → switch to multi-point polyline mode, seeded with this point.
          // The tape is strictly 2 points, so a click just cancels (drag required).
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
        // 3D field: EVERY element commits as a field-axis-snapped ground-surface move
        // — shapes warp (rect/ovals become the equivalent pinned polyline, remove+add
        // id kept), standing/flat elements slide perspective-correctly and shift their
        // ground anchor. Flat boards keep the screen-space translate. One undo step
        // (pinSetup wraps multi-op as a transaction).
        const s = fieldCamCfg ? groundSnap(move) : null
        if (s) {
          const ops: Operation[] = []
          const updates: ElementChange[] = []
          for (const id of ids) {
            if (!origins[id]) continue
            const orig = doc.elements.find((e) => e.id === id)
            if (!orig) continue
            const m = groundMoveElement(orig, arrow3dCam, s.dgx, s.dgz)
            if (m && (orig.type === 'rect' || orig.type === 'ellipse')) {
              const index = doc.elements.findIndex((e) => e.id === id)
              ops.push({ kind: 'remove', element: orig, index }, { kind: 'add', element: m, index })
            } else if (m && (orig.type === 'polyline' || orig.type === 'draw')) {
              const p = orig as PolylineElement
              const mp = m as PolylineElement
              updates.push({ id, before: { points: p.points, ground: p.ground, transform: origins[id] }, after: { points: mp.points, ground: mp.ground, transform: mp.transform } })
            } else if (isGroundElement(orig) && orig.ground) {
              // Figure/token: re-stand at the new depth so it keeps its metric size
              // (grows/shrinks with perspective), and shift its ground anchor.
              const og = { ...orig, transform: origins[id] } as typeof orig
              const ng: [number, number] = [orig.ground[0] + s.dgx, orig.ground[1] + s.dgz]
              updates.push({ id, before: { transform: origins[id], ground: orig.ground }, after: { transform: standingTransform(og, arrow3dCam, ng[0], ng[1]), ground: ng } })
            } else {
              // Other flat elements (3D text): slide along the ground + shift the pin;
              // if the centre leaves the pitch, fall back to the flat translate.
              const gt = groundTranslate(orig, origins[id], s.dgx, s.dgz)
              const after: ElementPatch = { transform: gt ? { ...origins[id], x: gt.x, y: gt.y } : { ...origins[id], x: origins[id].x + d.x, y: origins[id].y + d.y } }
              const before: ElementPatch = { transform: origins[id] }
              const ng = gt ? shiftGroundAnchor(orig, s.dgx, s.dgz) : undefined
              if (ng) {
                before.ground = isText3d(orig) ? orig.ground : undefined
                after.ground = ng
              }
              updates.push({ id, before, after })
            }
          }
          if (updates.length) ops.push({ kind: 'update', changes: updates })
          pinSetup(ops)
        } else {
          updateElements(
            ids
              .filter((id) => origins[id])
              .map((id) => ({
                id,
                before: { transform: origins[id] },
                after: { transform: { ...origins[id], x: origins[id].x + d.x, y: origins[id].y + d.y } },
              })),
          )
        }
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
        // Tokens always resize symmetrically about their center, so a resize
        // doesn't shift the token's (pinned) position.
        fromCenter: g.alt || el.type === 'token',
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
        const resizeChange = {
          id: g.id,
          before: { x: g.box0.x, y: g.box0.y, width: g.box0.width, height: g.box0.height, transform: g.t0 },
          after: { x: box.x, y: box.y, width: box.width, height: box.height, transform },
        }
        updateElements([resizeChange])
      }
    } else if (g.kind === 'point' && el.type === 'polyline') {
      const i = Number(g.handle.slice('point-'.length))
      const { lp } = resolvePointDrag(g)
      const after = el.points.map((p, idx) => (idx === i ? ([lp.x, lp.y] as [number, number]) : p))
      updateElements([reanchorPoints(el, after)])
    } else if (g.kind === 'anchor' && el.type === 'polyline') {
      const seg = Number(g.handle.slice('anchor-'.length))
      const { lp } = resolveAnchorDrag(g)
      const after = [...el.points]
      after.splice(seg + 1, 0, [lp.x, lp.y])
      updateElements([reanchorPoints(el, after)])
    }
  }

  // A point/vertex edit changes `points`; on a pitch-pinned polyline (carrying a
  // per-point `ground` anchor) that anchor must be re-derived from the NEW board
  // points, or the next camera move reprojects the edited point back to its old
  // ground spot. Falls back to a points-only change off-pitch / when unpinned.
  function reanchorPoints(el: Extract<BoardElement, { type: 'polyline' }>, after: Array<[number, number]>): ElementChange {
    if (el.ground && fieldCamCfg) {
      const ground = polylineGround({ ...el, points: after }, arrow3dCam)
      if (ground) return { id: el.id, before: { points: el.points, ground: el.ground }, after: { points: after, ground } }
    }
    return { id: el.id, before: { points: el.points }, after: { points: after } }
  }

  // Double-click a vertex to remove it (Miro). Open lines keep their endpoints;
  // a polyline keeps ≥2 points, a closed polygon ≥3.
  function removeVertex(el: BoardElement, i: number) {
    if (el.type !== 'polyline') return
    const min = el.closed ? 3 : 2
    if (el.points.length <= min) return
    if (!el.closed && (i === 0 || i === el.points.length - 1)) return
    updateElements([reanchorPoints(el, el.points.filter((_, idx) => idx !== i))])
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
  // A 3D text's hit/grab area is its PROJECTED footprint quad (matching the leaning
  // glyphs), not the flat axis-aligned box. Used for both click-select and move.
  const isText3dHit = (el: BoardElement): el is Extract<BoardElement, { type: 'text' }> => isText3d(el) && !!fieldCamCfg && !!el.ground
  const text3dHitPoints = (el: Extract<BoardElement, { type: 'text' }>) => text3dCorners(el, arrow3dCam).map((p) => `${p[0]},${p[1]}`).join(' ')
  // Object-snap guides (alignment lines + equal-distance gaps) shown while dragging,
  // resizing, or dragging a polyline vertex. On a 3D field the move snaps to the
  // pitch axes (field guides), off-field to screen axes (2D snap + gap guides).
  const fieldMoveSnap = move && move.engaged && fieldCamCfg ? groundSnap(move) : null
  const objectSnap = move && !fieldCamCfg ? moveSnap(move) : null
  const resizeGuides = ((): SnapLine[] => {
    if (!gesture || gesture.kind !== 'resize') return []
    const el = doc.elements.find((e) => e.id === gesture.id)
    return el ? resizePointer(el, gesture).guides : []
  })()
  const pointGuides = gesture?.kind === 'point' ? resolvePointDrag(gesture).guides : gesture?.kind === 'anchor' ? resolveAnchorDrag(gesture).guides : []
  const alignGuides = [...(fieldMoveSnap?.guides ?? []), ...(objectSnap?.guides ?? []), ...resizeGuides, ...pointGuides, ...object3dSnapGuides]
  const gapGuides = objectSnap?.gaps ?? []

  // 2D selection chrome excludes 3D arrows (they have no SVG box; their own
  // handles are drawn separately over the WebGL layer).
  const liveSelected2D = liveSelected.filter((el) => el.type !== 'arrow3d' && el.type !== 'object3d')
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
  // A single selected 3D object → its centre + rotate-handle board positions.
  const selectedObject3D = liveSelected.length === 1 && liveSelected[0].type === 'object3d' ? (liveSelected[0] as Object3DElement) : null
  const object3dCentreBoard = selectedObject3D ? object3dToBoard(selectedObject3D.x, 0, selectedObject3D.z) : null
  const object3dRotBoard = selectedObject3D ? object3dRotateBoard(selectedObject3D) : null
  // Group frame box (padded for display) for a multi-selection — the interactive
  // group resize/rotate chrome is drawn on it.
  const groupUnion = liveSelected2D.length >= 2 ? unionBounds(liveSelected2D) : null
  const groupPad = 6 / scale
  const groupBox = groupUnion
    ? { x: groupUnion.x - groupPad, y: groupUnion.y - groupPad, width: groupUnion.width + 2 * groupPad, height: groupUnion.height + 2 * groupPad }
    : null

  // Elements are inert (no pointer events) in the calibration/creation modes.
  const elementsInert = creating || backgroundMode || homographyMode || cameraMode || zoneMode || navigating || eraserTool || lassoTool

  // "Export as…" (main menu): composite the live layer stack into a PNG. The
  // latest closure lives in a ref (it captures doc/camera/ctm) — refreshed in an
  // effect (not during render) — and is registered once on mount.
  const exportImageRef = useRef<(w: number, h: number) => Promise<void>>(async () => {})
  useEffect(() => {
    exportImageRef.current = async (w, h) => {
      if (!containerRef.current || !svgRef.current) return
      const prevSel = selectedIds
      setSelection([]) // no selection chrome in the export
      // Wait for the deselected frame to paint. rAF can stall entirely in
      // throttled/headless contexts, so race it against a short timeout.
      await new Promise<void>((r) => {
        let settled = false
        const fin = () => {
          if (!settled) {
            settled = true
            r()
          }
        }
        requestAnimationFrame(() => requestAnimationFrame(fin))
        setTimeout(fin, 150)
      })
      try {
        const ctm = boardCtm
        await exportBoardImage(
          {
            container: containerRef.current,
            svg: svgRef.current,
            background: doc.background,
            texts: fieldCamCfg && ctm ? doc.elements.map(liveElement).filter((e): e is Extract<BoardElement, { type: 'text' }> => isText3d(e) && !!e.ground) : [],
            cam: arrow3dCam,
            boardToPx: (b) => (ctm ? { x: ctm.a * b[0] + ctm.c * b[1] + ctm.ex, y: ctm.b * b[0] + ctm.d * b[1] + ctm.ey } : { x: 0, y: 0 }),
          },
          w,
          h,
          `${doc.title || 'board'}-${w}x${h}.png`,
        )
      } finally {
        setSelection(prevSel)
      }
    }
  })
  useEffect(() => {
    registerBoardExporter((w, h) => exportImageRef.current(w, h))
    // Dev-only automation hook (CDP tests drive exports directly through it).
    if (import.meta.env.DEV) (window as unknown as { __ycbExport?: unknown }).__ycbExport = (w: number, h: number) => exportImageRef.current(w, h)
    return () => {
      registerBoardExporter(null)
      if (import.meta.env.DEV) delete (window as unknown as { __ycbExport?: unknown }).__ycbExport
    }
  }, [])

  // A 2D-badge token on a 3D field is lifted OUT of the main SVG into its own
  // layer painted ABOVE the 3D-text overlay (a badge "stands" on the grass, so
  // pitch-written text must go under it). 3D disc tokens are the WebGL layer's.
  const isElevatedToken = (el: BoardElement): boolean => !!fieldCamCfg && el.type === 'token' && !(tokens3d && el.shape === 'token')

  // One board element as its interactive SVG node — shared by the main canvas
  // and the elevated 2D-token layer, so both paint and behave identically.
  function renderBoardElement(el: BoardElement) {
    const live = liveElement(el)
    const erasing = erase?.ids.has(el.id)
    // Hide the token field being edited (the HTML input shows the live
    // value) ONLY in the rendered element — the selection chrome still
    // sees the real `showLabel`, so the frame doesn't shrink while editing.
    const beingEdited = !!editing && editing.id === el.id
    // A pitch-pinned 3D text draws its glyphs through the HTML overlay; here
    // its hit area is the PROJECTED footprint quad (so clicking the leaning
    // text selects it), EXCEPT while editing it, when the flat box + live text
    // back the inline textarea.
    const t3dHit = isText3dHit(live) && !beingEdited
    const render =
      beingEdited && live.type === 'token'
        ? editing!.field === 'label'
          ? { ...live, showLabel: false }
          : { ...live, text: '' }
        : live
    // Single-selected open path: draw the highlight halo UNDER the path.
    const showHalo = render.type === 'polyline' && !render.closed && !erasing && selectedIds.length === 1 && selectedIds[0] === el.id
    return (
      <g key={el.id} style={{ cursor: 'move', opacity: erasing ? 0.25 : undefined }} onPointerDown={(e) => onElementPointerDown(e, el)}>
        {showHalo && render.type === 'polyline' && <ElementView element={pathHalo(render, scale)} viewScale={scale} />}
        {t3dHit ? (
          <polygon points={text3dHitPoints(live)} fill="transparent" />
        ) : render.type === 'figure' ? (
          <FigureView element={render} />
        ) : (
          <ElementView element={render} viewScale={scale} tokenTextScale={tokenTextScale} tokenLabelScale={tokenLabelScale} tokenBadgeHidden={tokens3d && render.type === 'token' && render.shape === 'token'} />
        )}
      </g>
    )
  }

  // The eraser turns the pointer into a filled circle matching the erase radius.
  const eraserD = ERASER_RADIUS_PX * 2 + 2
  const eraserCursor = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${eraserD}' height='${eraserD}'><circle cx='${eraserD / 2}' cy='${eraserD / 2}' r='${ERASER_RADIUS_PX}' fill='#ffffff' stroke='#000000' stroke-width='1.5'/></svg>`,
  )}") ${eraserD / 2} ${eraserD / 2}, auto`

  return (
    <div
      ref={containerRef}
      data-board-surface
      className={cn('relative isolate h-full w-full touch-none select-none', creating || lassoTool ? 'cursor-crosshair' : 'cursor-default')}
      style={eraserTool ? { cursor: eraserCursor } : undefined}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setTokenPreview(null)}
    >
      {/* 2D base surface (grass image / solid colour): the fixed working area the field
          recedes over. It fills the board rect and does NOT zoom — an identical viewBox +
          preserveAspectRatio to the board SVG at 100% pins it exactly where the board
          content sits, so as the flat viewport shrinks the field-lines SVG + objects
          above it, the surface stays put (a camera pulling away from a real pitch).
          A surface colour REPLACES the grass image; transparent surface shows the image. */}
      {!field3d && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
          // zIndex −1 keeps the base BELOW the board SVG (which is statically
          // positioned, so it would otherwise paint under this absolute layer),
          // mirroring FieldSceneLayer's negative-z backdrop.
          style={{ zIndex: -1 }}
          viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {doc.background.image && (!doc.background.surfaceColor || doc.background.surfaceColor === 'transparent') ? (
            <image href={doc.background.image} x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} preserveAspectRatio="xMidYMid slice" />
          ) : (
            <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} fill={doc.background.surfaceColor ?? 'transparent'} />
          )}
        </svg>
      )}
      {/* Real 3D field: the board background (image/solid) + the pitch scene, both
          confined to the board rect and BELOW the 2D SVG (negative z). */}
      {field3d && <FieldSceneLayer camera={field3d} viewport={viewport} image={doc.background.image} svgRef={svgRef} containerRef={containerRef} showGoals={doc.background.showGoals} bands={doc.background.bands} fieldType={doc.background.fieldType} layout={doc.background.trainingLayout} surface={doc.background.surfaceColor} lineColor={doc.background.lineColor} showLines={doc.background.showLines} bandsOpacity={doc.background.bandsOpacity} centerLight={doc.background.centerLight} courtColor={doc.background.courtColor} borderColor={doc.background.borderColor} areasColor={doc.background.areasColor} renderTick={editing3d} />}
      <BoardCanvas
        doc={doc}
        svgRef={svgRef}
        viewBox={viewBox}
        // Declare the tool cursor on the SVG itself (the actual pointer target), not
        // only on the container — so it can't flicker to the inherited/default value
        // as the pointer crosses the stacked WebGL/overlay layers. Eraser keeps its
        // data-URL cursor from the container (inherited when this is unset).
        className={cn(creating || lassoTool ? 'cursor-crosshair' : eraserTool ? undefined : 'cursor-default')}
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
                el.type === 'polyline' && el.points.length === 2 ? null : (tokens3d && el.type === 'token' && el.shape === 'token') ? null : (
                  <polygon
                    key={`hit-${el.id}`}
                    points={isText3dHit(el) ? text3dHitPoints(el) : framePoints(el)}
                    fill="transparent"
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => onElementPointerDown(e, el)}
                  />
                ),
              )}
            {/* Selection chrome: full handles for a single selection, plain
                outlines + a group frame for a multi-selection. Hidden while
                navigating — the board isn't editable there, so a selection frame
                would wrongly suggest you can move things. */}
            {!creating && !navigating &&
              liveSelected2D
                // A 3D text shows the projected footprint quad (Text3DFrames) instead
                // of an axis-aligned box, so skip the normal chrome for it. A 3D
                // token disc gets the WebGL OutlinePass highlight instead — the 2D
                // ring would sit at the badge's (hidden) flat position.
                .filter((el) => !(isText3d(el) && fieldCamCfg && !!el.ground))
                .filter((el) => !(tokens3d && el.type === 'token' && el.shape === 'token'))
                .map((el) => (
                  <SelectionHandles
                    key={`sel-${el.id}`}
                    element={el}
                    scale={scale}
                    onHandleDown={single && !el.locked ? (handle, e) => onHandleDown(handle, e, el) : undefined}
                    hideFrame={gesture?.id === el.id && (gesture.kind === 'point' || gesture.kind === 'anchor')}
                  />
                ))}
            {/* Group resize/rotate chrome for a multi-selection. Hidden while
                rotating (the box is an AABB that grows, so the handle would slide
                out from under the pointer); the per-element frames stay. */}
            {!navigating && groupBox && groupGesture?.kind !== 'rotate' && <GroupHandles box={groupBox} scale={scale} onDown={onGroupHandleDown} />}
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
            {/* Token drop-preview: a 50%-opacity ghost of the token a click would
                create, following the cursor (perspective-sized like the real one).
                Pointer-transparent so it never fights the crosshair cursor. */}
            {activeTool === 'token' && tokenPreview && !move && !gesture && (
              <g pointerEvents="none" opacity={0.5}>
                <ElementView element={makeTokenAt(tokenPreview, 'token-preview')} viewScale={scale} tokenTextScale={tokenTextScale} tokenLabelScale={tokenLabelScale} />
              </g>
            )}
          </>
        }
      >
        <g style={{ pointerEvents: elementsInert ? 'none' : 'auto' }}>
          {doc.elements.map((el) => (isElevatedToken(el) ? null : renderBoardElement(el)))}
        </g>
        {fieldCamCfg && (
          <TapeDecorations
            elements={doc.elements
              .map(liveElement)
              .filter((e): e is PolylineElement => e.type === 'polyline' && !!e.tape)}
            cam={arrow3dCam}
          />
        )}
        {/* 3D-text selection frame: the projected footprint quad (leans with the
            text), for selected 3D texts only. The glyphs live in an HTML overlay. */}
        {fieldCamCfg && !navigating && (
          <Text3DFrames
            elements={liveSelected
              .filter((e): e is Extract<BoardElement, { type: 'text' }> => isText3d(e) && !!e.ground && !(editing && editing.id === e.id))}
            cam={arrow3dCam}
          />
        )}
      </BoardCanvas>
      {/* 3D text: HTML overlay carrying a perspective matrix3d (pointer-transparent;
          the SVG hit-box drives selection/move). Skips the text being inline-edited.
          Rendered BELOW the WebGL layers (DOM order + equal stacking level): the
          text is written on the grass, so standing 3D things (tokens, players,
          arrows) paint over it — while it still sits above the flat board SVG. */}
      {fieldCamCfg && (
        <Text3DHtml
          elements={doc.elements
            .map(liveElement)
            .filter((e): e is Extract<BoardElement, { type: 'text' }> => isText3d(e) && !!e.ground && !(editing && editing.id === e.id))}
          cam={arrow3dCam}
          ctm={boardCtm}
        />
      )}
      {/* Elevated 2D tokens: badge tokens on a 3D field, in their own SVG layer
          ABOVE the 3D-text overlay (badges stand on the grass, pitch-written text
          goes under them) but BELOW the WebGL layers. Same interactive markup as
          the main canvas (renderBoardElement), so drag/select/edit work as usual. */}
      {fieldCamCfg && doc.elements.some(isElevatedToken) && (
        <svg data-layer="tokens-2d" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'none' }}>
          <g style={{ pointerEvents: elementsInert ? 'none' : 'auto' }}>
            {doc.elements.map((el) => (isElevatedToken(el) ? renderBoardElement(el) : null))}
          </g>
        </svg>
      )}
      {/* 3D arrows: in real-camera mode they render inside the Object3DLayer scene
          (one depth buffer with objects/tokens/goals, so occlusion is correct);
          this layer only draws them in the legacy homography/fixed modes. */}
      <Arrow3DLayer ref={arrow3dLayerRef} elements={fieldCamCfg ? [] : arrow3dLayerElements} selectedIds={selectedIds} erasingIds={erase?.ids} viewport={viewport} svgRef={svgRef} containerRef={containerRef} homography={useHomography ? fieldH : null} camera={fieldCamCfg} />
      {/* 3D objects ("3D materials") + tokens + arrows: WebGL overlay (pointer-transparent). */}
      <Object3DLayer ref={object3dLayerRef} elements={object3dElements} tokens={token3dList} arrows={fieldCamCfg ? arrow3dLayerElements : []} selectedIds={navigating ? [] : selectedIds} replaceTargetId={dropReplaceId} erasingIds={erase?.ids} viewport={viewport} svgRef={svgRef} containerRef={containerRef} camera={fieldCamCfg} objectScale={doc.background.objectScale} minScale={field3d ? 1 : 0.05} fieldType={doc.background.fieldType} layout={doc.background.trainingLayout} showGoals={!!field3d && doc.background.showGoals} />
      {/* 3D-token captions: the WebGL canvas sits above the SVG, so the discs would
          occlude their own labels — re-render them here, above the canvas, anchored
          just below each disc's camera-facing edge. Fixed on-screen size like the
          2D token captions; pointer-transparent (the SVG hit-box owns interaction). */}
      {token3dList.length > 0 && (
        <svg data-layer="captions" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'none' }}>
          {token3dList.map((t) => {
            const el = doc.elements.find((e) => e.id === t.id)
            if (!el || el.type !== 'token' || !el.showLabel) return null
            if (editing && editing.id === t.id && editing.field === 'label') return null
            const cp = arrow3dCam.position
            let dx = cp.x - t.x
            let dz = cp.z - t.z
            const len = Math.hypot(dx, dz) || 1
            dx /= len
            dz /= len
            const b = object3dToBoard(t.x + dx * (t.sizeM / 2), 0, t.z + dz * (t.sizeM / 2))
            const font = TOKEN_LABEL_PX / (scale || 1)
            const gap = TOKEN_LABEL_GAP_PX / (scale || 1)
            return (
              <text key={t.id} x={b.x} y={b.y + gap + font / 2} textAnchor="middle" dominantBaseline="central" fontSize={font} fontWeight={TOKEN_FONT_WEIGHT} fill="#000000" style={{ fontFamily: TOKEN_FONT }}>
                {el.label || TOKEN_LABEL_PLACEHOLDER}
              </text>
            )
          })}
        </svg>
      )}
      {/* Field-perspective calibration overlays (dedicated modes). */}
      {homographyMode && <FieldHomographyLayer viewBox={viewBox} />}
      {cameraMode && <FieldCameraLayer viewBox={viewBox} />}
      {zoneMode && field3d && <FieldZoneTool field3d={field3d} viewBox={viewBox} />}
      {/* 3D-field pose editor: OrbitControls + numbered zone markers (bg-edit). */}
      {editing3d && field3d && <FieldEditOverlay field3d={field3d} fieldType={doc.background.fieldType} viewBox={viewBox} panMode={panMode} onExitPan={() => setView('orbit')} onPose={(p) => setBackground({ field3d: p })} />}
      {/* Navigation mode: the same orbit controls in normal mode, writing the pose
          straight to background.field3d (coalesced by the nav transaction above). */}
      {navigating && !backgroundMode && field3d && <FieldEditOverlay field3d={field3d} fieldType={doc.background.fieldType} viewBox={viewBox} panMode={false} onExitPan={() => {}} onPose={(p) => setBackground({ field3d: p })} showMarkers={navMarkers} onTap={onNavTap} />}
      {/* Edit-Background controls for the 3D field: coach-friendly discrete nudges. */}
      {backgroundMode && field3d && (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/95 p-1.5 shadow-lg">
          <FieldCtl label="Zoom in" onClick={() => nudgeField3d((o) => ({ ...o, distance: clamp(o.distance - 12, 4, 400) }))}><ZoomIn /></FieldCtl>
          <FieldCtl label="Zoom out" onClick={() => nudgeField3d((o) => ({ ...o, distance: clamp(o.distance + 12, 4, 400) }))}><ZoomOut /></FieldCtl>
          <span className="mx-0.5 h-6 w-px bg-border" />
          <FieldCtl label="Pan tool (disable orbit)" active={view === 'pan'} onClick={() => setView('pan')}><Hand /></FieldCtl>
          <span className="mx-0.5 h-6 w-px bg-border" />
          <FieldCtl label="Top view (portrait)" active={view === 'portrait'} onClick={() => goTopView('portrait')}><RectangleVertical /></FieldCtl>
          <FieldCtl label="Top view (landscape)" active={view === 'landscape'} onClick={() => goTopView('landscape')}><RectangleHorizontal /></FieldCtl>
          <FieldCtl label="3D orbit view" active={view === 'orbit'} onClick={() => setView('orbit')}><Rotate3d /></FieldCtl>
          <span className="mx-0.5 h-6 w-px bg-border" />
          <FieldCtl label="Reset view" onClick={() => { setView('orbit'); setBackground({ field3d: DEFAULT_ZONE.camera }) }}><RefreshCw /></FieldCtl>
        </div>
      )}
      {!navigating && selectedArrow3D && !arrow3dGesture && arrow3dHandles && (
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
      {/* Selected 3D object: a rotate handle (about Y) sticking out from its centre. */}
      {!navigating && selectedObject3D && !selectedObject3D.locked && isObject3DRotatable(selectedObject3D.objectId) && !object3dGesture && object3dCentreBoard && object3dRotBoard && (
        <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'none' }}>
          <line x1={object3dCentreBoard.x} y1={object3dCentreBoard.y} x2={object3dRotBoard.x} y2={object3dRotBoard.y} stroke="#ffffff" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          <circle
            cx={object3dRotBoard.x}
            cy={object3dRotBoard.y}
            r={7 / scale}
            fill="#ffffff"
            stroke="#3b82f6"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'auto', cursor: 'grab' }}
            onPointerDown={(e) => onObject3DRotateDown(selectedObject3D, e)}
          />
        </svg>
      )}
      {/* Export-aspect guide frame (4:3 / 16:9 / 9:16): a composition aid drawn on
          top of everything, marking the region an image export would capture. */}
      {exportGuide !== 'off' && (
        <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'none' }}>
          <ExportGuideFrame guide={exportGuide} />
        </svg>
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

// A compact icon button for the 3D-field Edit-Background control bar.
function FieldCtl({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn('flex size-8 items-center justify-center rounded-md [&_svg]:size-4', active ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
    >
      {children}
    </button>
  )
}

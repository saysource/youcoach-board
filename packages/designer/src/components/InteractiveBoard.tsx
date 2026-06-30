import { useEffect, useRef, useState } from 'react'
import {
  BoardCanvas,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  ElementView,
  getElementBounds,
  getLocalBounds,
  normalizeBox,
  type ArrowTip,
  type BoardElement,
  type ElementTransform,
  type Box,
} from '@youcoach-board/core'
import { useEditorStore } from '../store/context'
import { isCreationTool } from '../store/editorStore'
import {
  clientToBoard,
  makeFigure,
  makeLine,
  makePolyline,
  makeDraw,
  squareCorner,
  applyFigureStyle,
  isDragSignificant,
  boxesIntersect,
  boxContains,
  toolElementType,
  toolEndTip,
  toolIsCurved,
  isLineTool,
  MIN_DRAG,
  type DraftType,
  type Point,
} from '../lib/draw'
import { computeResize, rotationFor, boardToElement, elementToBoard, localCorners, boardCorners, type CornerId } from '../lib/geometry-2d'
import { SelectionHandles, GroupHandles, SELECTION_PAD_PX, type HandleId } from './SelectionHandles'
import { FigureView } from './FigureView'
import { BackgroundView } from './BackgroundView'
import { buildFigureElement, FIGURE_DND_MIME, FIELD_DND_MIME, type FigureDragData, type FieldDragData } from '../lib/assets'
import { cn } from '../lib/cn'

const MIN_SIZE = 6 // smallest box dimension a resize can produce (board units)
const CANVAS_KEEP = 28 // min board units of a moved figure that must stay on-canvas
const POLY_END_R_PX = 7 // on-screen radius of the first/last polyline finish dots
const FREEHAND_MIN_STEP = 2 // min board-unit gap between captured freehand samples
const MOVE_THRESHOLD_PX = 4 // on-screen drag distance before a move engages
const BG_MOVE_HANDLE_PX = 40 // on-screen size of the background pan handle (icon viewBox 46×46)
// 4-way move arrows (assets/move_background.svg), centered in a 46×46 viewBox.
const BG_MOVE_PATH =
  'M18.648,18.648L18.648,6.688L15.815,6.688L22.504,0L29.192,6.688L26.36,6.688L26.36,18.648L38.319,18.648L38.319,15.815L45.008,22.504L38.319,29.192L38.319,26.36L26.36,26.36L26.36,38.319L29.192,38.319L22.504,45.008L15.815,38.319L18.648,38.319L18.648,26.36L6.688,26.36L6.688,29.192L0,22.504L6.688,15.815L6.688,18.648L18.648,18.648Z'

interface SnapGuide {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface Draft {
  type: DraftType
  start: Point
  current: Point
  // For 'line' drafts: the end arrow tip (arrow tool → 'arrow').
  endTip: ArrowTip
  // For 'line' drafts: draw a smooth (curved) line (elbow tools).
  curve: boolean
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
  // Draw a smooth (curved) multi-point line (elbow tools).
  curve: boolean
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
export function InteractiveBoard({ backgroundMode = false }: { backgroundMode?: boolean }) {
  const doc = useEditorStore((s) => s.doc)
  const activeTool = useEditorStore((s) => s.activeTool)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const setSelection = useEditorStore((s) => s.setSelection)
  const createFigure = useEditorStore((s) => s.createFigure)
  const setBackground = useEditorStore((s) => s.setBackground)
  const beginTransaction = useEditorStore((s) => s.beginTransaction)
  const commitTransaction = useEditorStore((s) => s.commitTransaction)
  const updateElements = useEditorStore((s) => s.updateElements)
  const toolDefaults = useEditorStore((s) => s.toolDefaults)

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
  }, [])

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
      if (polyDraft.points.length >= 2) createFigure(applyFigureStyle(makePolyline(crypto.randomUUID(), polyDraft.points, false, 'none', polyDraft.endTip, polyDraft.curve), toolDefaults))
      setPolyDraft(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [polyDraft, createFigure, toolDefaults])

  const creating = isCreationTool(activeTool)
  const selectedSet = new Set(selectedIds)

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
  function resolvePointDrag(g: Gesture): { lp: Point; guides: SnapGuide[] } {
    const el = doc.elements.find((e) => e.id === g.id)
    const i = Number(g.handle.slice('point-'.length))
    let board = g.current
    if (g.snap && el?.type === 'polyline' && el.points.length >= 2) {
      // Reference the previous vertex (or the next one for the first vertex).
      const ni = i > 0 ? i - 1 : 1
      const neighbor = elementToBoard({ x: el.points[ni][0], y: el.points[ni][1] }, g.box0, g.t0)
      board = snapLineEnd(neighbor, board)
    }
    board = clampToCanvas(board)
    return { lp: boardToElement(board, g.box0, g.t0), guides: [] }
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
      const d = clampMoveDelta(move.current.x - move.start.x, move.current.y - move.start.y)
      return { ...el, transform: { ...o, x: o.x + d.x, y: o.y + d.y } }
    }
    if (gesture && gesture.id === el.id) {
      if (gesture.kind === 'rotate') {
        return { ...el, transform: { ...gesture.t0, rotate: rotationFor(gesture.box0, gesture.t0, gesture.current, gesture.snap) } }
      }
      if (gesture.kind === 'resize') {
        const { box, transform } = computeResize(gesture.box0, gesture.t0, gesture.handle as CornerId, clampToCanvas(gesture.current), MIN_SIZE, {
          fromCenter: gesture.alt,
          // Figures keep their SVG aspect ratio, so the frame always matches it.
          proportional: gesture.snap || el.type === 'figure',
        })
        if (el.type === 'polyline' || el.type === 'draw') {
          return { ...el, points: scalePoints(el.points, gesture.box0, box), transform }
        }
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
        const lp = boardToElement(clampToCanvas(gesture.current), gesture.box0, gesture.t0)
        const points = [...el.points]
        points.splice(seg + 1, 0, [lp.x, lp.y])
        return { ...el, points }
      }
    }
    return el
  }

  const selectedEls = doc.elements.filter((e) => selectedSet.has(e.id))
  const liveSelected = selectedEls.map(liveElement)

  function startMove(ids: string[], from: Point, pointerId: number) {
    const origins: Record<string, ElementTransform> = {}
    for (const id of ids) {
      const el = doc.elements.find((e) => e.id === id)
      if (el) origins[id] = el.transform
    }
    setMove({ ids, start: from, current: from, origins, engaged: false })
    containerRef.current?.setPointerCapture(pointerId)
  }

  // Finish the in-progress polyline. `closed` joins last→first (needs ≥3
  // points); open needs ≥2. createFigure selects it and reverts to the select
  // tool (unless the tool lock is on).
  function finishPolyline(closed: boolean) {
    if (!polyDraft) return
    if (polyDraft.points.length >= (closed ? 3 : 2)) {
      // Closed polygons carry no tips; an open polyline keeps the tool's end tip.
      createFigure(applyFigureStyle(makePolyline(crypto.randomUUID(), polyDraft.points, closed, 'none', closed ? 'none' : polyDraft.endTip, polyDraft.curve), toolDefaults))
    }
    setPolyDraft(null)
  }

  function onContainerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Only the LEFT button drives interactions (touch/pen primary press is 0 too).
    if (e.button !== 0) return
    const svg = svgRef.current
    if (!svg) return
    const p = clientToBoard(svg, e.clientX, e.clientY)

    // Freehand: start capturing a stroke (points appended on move).
    if (activeTool === 'draw') {
      setFreeDraft([clampToCanvas(p)])
      containerRef.current?.setPointerCapture(e.pointerId)
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
      setDraft({ type, start: p, current: p, endTip: toolEndTip(activeTool), curve: toolIsCurved(activeTool), snap: e.shiftKey })
      containerRef.current?.setPointerCapture(e.pointerId)
    } else {
      setMarquee({ start: p, current: p, additive: e.shiftKey, base: selectedIds })
      containerRef.current?.setPointerCapture(e.pointerId)
    }
  }

  function marqueeSelection(m: Marquee): string[] {
    const box = normalizeBox(m.start.x, m.start.y, m.current.x, m.current.y)
    if (box.width < MIN_DRAG && box.height < MIN_DRAG) return m.additive ? m.base : []
    const contain = m.current.y >= m.start.y
    const hits = doc.elements
      .filter((el) => {
        const b = getElementBounds(el)
        return contain ? boxContains(box, b) : boxesIntersect(b, box)
      })
      .map((el) => el.id)
    return m.additive ? [...new Set([...m.base, ...hits])] : hits
  }

  function onElementPointerDown(e: React.PointerEvent, el: BoardElement) {
    if (e.button !== 0) return
    if (creating) return
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
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
    if (willMove && ids.length) startMove(ids, clientToBoard(svg, e.clientX, e.clientY), e.pointerId)
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
    startMove(selectedIds, clientToBoard(svg, e.clientX, e.clientY), e.pointerId)
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
    const svg = svgRef.current
    if (!svg) return
    const p = clientToBoard(svg, e.clientX, e.clientY)
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
    // Only release if we actually captured (polyline clicks don't capture).
    if (containerRef.current?.hasPointerCapture?.(e.pointerId)) {
      containerRef.current.releasePointerCapture(e.pointerId)
    }
    if (bgPan) {
      setBgPan(null)
      commitTransaction()
    } else if (freeDraft) {
      const pts = freeDraft
      setFreeDraft(null)
      // Need at least a short stroke (≥2 distinct points) to keep it.
      if (pts.length >= 2) createFigure(applyFigureStyle(makeDraw(crypto.randomUUID(), pts), toolDefaults))
    } else if (draft) {
      const { type, start, current, endTip, curve, snap } = draft
      setDraft(null)
      if (type === 'line') {
        if (isDragSignificant('line', start, current)) {
          // A real drag → a straight line (2-point polyline, end-tipped if arrow).
          const end = snap ? snapLineEnd(start, current) : current
          createFigure(applyFigureStyle(makeLine(crypto.randomUUID(), start, end, endTip, curve), toolDefaults))
        } else {
          // A click → switch to multi-point polyline mode, seeded with this point.
          setPolyDraft({ points: [start], cursor: current, endTip, curve, snap })
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
      // Use the SAME clamped delta the preview showed, so the commit matches.
      const d = clampMoveDelta(move.current.x - move.start.x, move.current.y - move.start.y)
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
      const { box, transform } = computeResize(g.box0, g.t0, g.handle as CornerId, clampToCanvas(g.current), MIN_SIZE, {
        fromCenter: g.alt,
        // Figures keep their SVG aspect ratio, so the frame always matches it.
        proportional: g.snap || el.type === 'figure',
      })
      if (el.type === 'polyline' || el.type === 'draw') {
        updateElements([
          { id: g.id, before: { points: el.points, transform: g.t0 }, after: { points: scalePoints(el.points, g.box0, box), transform } },
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
      const lp = boardToElement(clampToCanvas(g.current), g.box0, g.t0)
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
    return [c.nw, c.ne, c.se, c.sw]
      .map((p) => {
        const b = elementToBoard(p, pbox, t)
        return `${b.x},${b.y}`
      })
      .join(' ')
  }
  const snapGuides = gesture && gesture.kind === 'point' ? resolvePointDrag(gesture).guides : []

  // Drag-and-drop a figure from the palette: allow the drop, then place it at the
  // cursor (clamped to the canvas).
  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    const t = e.dataTransfer.types
    if (t.includes(FIGURE_DND_MIME) || t.includes(FIELD_DND_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    // A dragged field applies as the background (position-independent, same as
    // clicking it); a dragged figure is placed at the cursor.
    const fieldRaw = e.dataTransfer.getData(FIELD_DND_MIME)
    if (fieldRaw) {
      e.preventDefault()
      try {
        const fd = JSON.parse(fieldRaw) as FieldDragData
        setBackground({ fieldSvg: fd.fieldSvg, scale: 1, position: [0, 0], figureScale: fd.figureScale })
      } catch {
        /* ignore malformed payload */
      }
      return
    }
    const raw = e.dataTransfer.getData(FIGURE_DND_MIME)
    if (!raw) return
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    let d: FigureDragData
    try {
      d = JSON.parse(raw) as FigureDragData
    } catch {
      return
    }
    const c = clampToCanvas(clientToBoard(svg, e.clientX, e.clientY))
    createFigure(buildFigureElement(d, c.x, c.y))
  }

  // Group frame box (padded for display) for a multi-selection — the interactive
  // group resize/rotate chrome is drawn on it.
  const groupUnion = liveSelected.length >= 2 ? unionBounds(liveSelected) : null
  const groupPad = 6 / scale
  const groupBox = groupUnion
    ? { x: groupUnion.x - groupPad, y: groupUnion.y - groupPad, width: groupUnion.width + 2 * groupPad, height: groupUnion.height + 2 * groupPad }
    : null

  return (
    <div
      ref={containerRef}
      data-board-surface
      className={cn('h-full w-full touch-none', creating ? 'cursor-crosshair' : 'cursor-default')}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <BoardCanvas
        doc={doc}
        svgRef={svgRef}
        background={<BackgroundView doc={doc} />}
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
              liveSelected.map((el) =>
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
              liveSelected.map((el) => (
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
            {/* Alignment guides while shift-snapping a polyline vertex. */}
            {snapGuides.map((gd, i) => (
              <line
                key={`snap-${i}`}
                x1={gd.x1}
                y1={gd.y1}
                x2={gd.x2}
                y2={gd.y2}
                stroke="var(--color-fuchsia-200)"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                shapeRendering="crispEdges"
                pointerEvents="none"
              />
            ))}
            {freeDraft && freeDraft.length >= 1 && (
              <ElementView element={applyFigureStyle(makeDraw('draw-draft', freeDraft), toolDefaults)} />
            )}
            {draft &&
              (draft.type === 'line' ? (
                <ElementView element={applyFigureStyle(makeLine('draft', draft.start, draft.snap ? snapLineEnd(draft.start, draft.current) : draft.current, draft.endTip, draft.curve), toolDefaults)} />
              ) : (
                <ElementView element={applyFigureStyle(makeFigure(draft.type, 'draft', draft.start, draft.snap ? squareCorner(draft.start, draft.current) : draft.current), toolDefaults)} />
              ))}
            {polyDraft && (
              <>
                {/* Live preview: placed segments + the segment to the (snapped) cursor. */}
                <ElementView element={applyFigureStyle(makePolyline('poly-draft', [...polyDraft.points, polyDraftEnd(polyDraft)], false, 'none', polyDraft.endTip, polyDraft.curve), toolDefaults)} />
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
          </>
        }
      >
        <g style={{ pointerEvents: creating ? 'none' : 'auto' }}>
          {doc.elements.map((el) => {
            const live = liveElement(el)
            return (
              <g key={el.id} style={{ cursor: 'move' }} onPointerDown={(e) => onElementPointerDown(e, el)}>
                {live.type === 'figure' ? <FigureView element={live} /> : <ElementView element={live} />}
              </g>
            )
          })}
        </g>
      </BoardCanvas>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  BoardCanvas,
  ElementView,
  getElementBounds,
  getLocalBounds,
  normalizeBox,
  type BoardElement,
  type ElementTransform,
  type Box,
} from '@youcoach-board/core'
import { useEditorStore } from '../store/context'
import { isCreationTool } from '../store/editorStore'
import {
  clientToBoard,
  makeFigure,
  makePolyline,
  isDragSignificant,
  boxesIntersect,
  boxContains,
  toolElementType,
  MIN_DRAG,
  type DraftType,
  type Point,
} from '../lib/draw'
import { computeResize, rotationFor, boardToElement, elementToBoard, boardCorners, type CornerId } from '../lib/geometry-2d'
import { SelectionHandles, type HandleId } from './SelectionHandles'
import { cn } from '../lib/cn'

const MIN_SIZE = 6 // smallest box dimension a resize can produce (board units)
const CANVAS_KEEP = 28 // min board units of a moved figure that must stay on-canvas
const POLY_END_R_PX = 7 // on-screen radius of the first/last polyline finish dots
const SNAP_PX = 8 // on-screen snap radius for shift-aligning a polyline vertex

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
}

// In-progress polyline: committed vertices plus the live cursor (preview seg).
interface PolyDraft {
  points: Point[]
  cursor: Point
}

// A move can drag several elements at once (group move). We snapshot each
// element's transform at drag start, then offset all by the same delta.
interface MoveState {
  ids: string[]
  start: Point
  current: Point
  origins: Record<string, ElementTransform>
}

// A resize / rotate / line-endpoint / polyline-vertex gesture on one element.
interface Gesture {
  kind: 'resize' | 'rotate' | 'endpoint' | 'point'
  id: string
  handle: HandleId
  box0: Box
  t0: ElementTransform
  start: Point
  current: Point
  snap: boolean // shift — rotation snap / proportional resize
  alt: boolean // option/alt — specular (from-center) resize
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
//     rotated); drag the top circle → rotate; drag a line endpoint → reshape.
export function InteractiveBoard() {
  const doc = useEditorStore((s) => s.doc)
  const activeTool = useEditorStore((s) => s.activeTool)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const setSelection = useEditorStore((s) => s.setSelection)
  const createFigure = useEditorStore((s) => s.createFigure)
  const updateElements = useEditorStore((s) => s.updateElements)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [move, setMove] = useState<MoveState | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [polyDraft, setPolyDraft] = useState<PolyDraft | null>(null)
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

  // Abandon any in-progress polyline if the user switches tools (React's
  // "adjust state when a value changes during render" pattern — no effect).
  const [polyTool, setPolyTool] = useState(activeTool)
  if (polyTool !== activeTool) {
    setPolyTool(activeTool)
    if (polyDraft && activeTool !== 'polyline') setPolyDraft(null)
  }

  // ESC ends a polyline open (capture phase + stopPropagation so the shell's
  // global Escape handler doesn't also fire and switch tools mid-finish).
  useEffect(() => {
    if (!polyDraft) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (polyDraft.points.length >= 2) createFigure(makePolyline(crypto.randomUUID(), polyDraft.points, false))
      setPolyDraft(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [polyDraft, createFigure])

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

  // Resolve a polyline vertex drag → the new LOCAL point, plus alignment guides.
  // With shift held, the vertex magnets (independently on X and Y) to the
  // nearest OTHER vertex sharing that axis, within SNAP_PX; a guide line is
  // emitted between the aligned points. Snapping is done in board space.
  function resolvePointDrag(g: Gesture): { lp: Point; guides: SnapGuide[] } {
    const el = doc.elements.find((e) => e.id === g.id)
    const i = Number(g.handle.slice('point-'.length))
    let board = clampToCanvas(g.current)
    const guides: SnapGuide[] = []
    if (g.snap && el?.type === 'polyline') {
      const thr = SNAP_PX / scale
      const others = el.points
        .map((p, idx) => ({ idx, b: elementToBoard({ x: p[0], y: p[1] }, g.box0, g.t0) }))
        .filter((o) => o.idx !== i)
      let bx: { d: number; x: number; refY: number } | null = null
      let by: { d: number; y: number; refX: number } | null = null
      for (const o of others) {
        const dx = Math.abs(o.b.x - board.x)
        if (dx <= thr && (bx === null || dx < bx.d)) bx = { d: dx, x: o.b.x, refY: o.b.y }
        const dy = Math.abs(o.b.y - board.y)
        if (dy <= thr && (by === null || dy < by.d)) by = { d: dy, y: o.b.y, refX: o.b.x }
      }
      if (bx) board = { x: bx.x, y: board.y }
      if (by) board = { x: board.x, y: by.y }
      if (bx) guides.push({ x1: bx.x, y1: bx.refY, x2: board.x, y2: board.y })
      if (by) guides.push({ x1: by.refX, y1: by.y, x2: board.x, y2: board.y })
    }
    return { lp: boardToElement(board, g.box0, g.t0), guides }
  }

  // The element as it should render RIGHT NOW — committed state plus any
  // in-progress move / resize / rotate / endpoint gesture.
  function liveElement(el: BoardElement): BoardElement {
    if (move && move.origins[el.id]) {
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
          proportional: gesture.snap,
        })
        if (el.type === 'polyline') {
          return { ...el, points: scalePoints(el.points, gesture.box0, box), transform }
        }
        return { ...el, x: box.x, y: box.y, width: box.width, height: box.height, transform } as BoardElement
      }
      if (gesture.kind === 'endpoint' && el.type === 'line') {
        const lp = boardToElement(clampToCanvas(gesture.current), gesture.box0, gesture.t0)
        return gesture.handle === 'start' ? { ...el, x1: lp.x, y1: lp.y } : { ...el, x2: lp.x, y2: lp.y }
      }
      if (gesture.kind === 'point' && el.type === 'polyline') {
        const i = Number(gesture.handle.slice('point-'.length))
        const { lp } = resolvePointDrag(gesture)
        const points = el.points.map((p, idx) => (idx === i ? ([lp.x, lp.y] as [number, number]) : p))
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
    setMove({ ids, start: from, current: from, origins })
    containerRef.current?.setPointerCapture(pointerId)
  }

  // Finish the in-progress polyline. `closed` joins last→first (needs ≥3
  // points); open needs ≥2. createFigure selects it and reverts to the select
  // tool (unless the tool lock is on).
  function finishPolyline(closed: boolean) {
    if (!polyDraft) return
    if (polyDraft.points.length >= (closed ? 3 : 2)) {
      createFigure(makePolyline(crypto.randomUUID(), polyDraft.points, closed))
    }
    setPolyDraft(null)
  }

  function onContainerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const svg = svgRef.current
    if (!svg) return
    const p = clientToBoard(svg, e.clientX, e.clientY)

    // Polyline: click-to-add-vertices (finishing is handled by the end dots/ESC).
    if (activeTool === 'polyline') {
      setPolyDraft((d) => (d ? { ...d, points: [...d.points, p] } : { points: [p], cursor: p }))
      return
    }

    const type = toolElementType(activeTool)
    if (type) {
      setDraft({ type, start: p, current: p })
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
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    const kind: Gesture['kind'] =
      handle === 'rotate'
        ? 'rotate'
        : handle === 'start' || handle === 'end'
          ? 'endpoint'
          : handle.startsWith('point-')
            ? 'point'
            : 'resize'
    const p = clientToBoard(svg, e.clientX, e.clientY)
    setGesture({ kind, id: el.id, handle, box0: getLocalBounds(el), t0: el.transform, start: p, current: p, snap: e.shiftKey, alt: e.altKey })
    containerRef.current?.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const svg = svgRef.current
    if (!svg) return
    const p = clientToBoard(svg, e.clientX, e.clientY)
    if (polyDraft) setPolyDraft((d) => (d ? { ...d, cursor: p } : d))
    else if (draft) setDraft((d) => (d ? { ...d, current: p } : d))
    else if (gesture) setGesture((g) => (g ? { ...g, current: p, snap: e.shiftKey, alt: e.altKey } : g))
    else if (move) setMove((m) => (m ? { ...m, current: p } : m))
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
    if (draft) {
      const { type, start, current } = draft
      setDraft(null)
      if (isDragSignificant(type, start, current)) createFigure(makeFigure(type, crypto.randomUUID(), start, current))
    } else if (gesture) {
      const g = gesture
      setGesture(null)
      commitGesture(g)
    } else if (move) {
      // Use the SAME clamped delta the preview showed, so the commit matches.
      const d = clampMoveDelta(move.current.x - move.start.x, move.current.y - move.start.y)
      const { ids, origins } = move
      setMove(null)
      if (Math.hypot(d.x, d.y) >= MIN_DRAG) {
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
        proportional: g.snap,
      })
      if (el.type === 'polyline') {
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
    } else if (g.kind === 'endpoint' && el.type === 'line') {
      const lp = boardToElement(clampToCanvas(g.current), g.box0, g.t0)
      const before = g.handle === 'start' ? { x1: el.x1, y1: el.y1 } : { x2: el.x2, y2: el.y2 }
      const after = g.handle === 'start' ? { x1: lp.x, y1: lp.y } : { x2: lp.x, y2: lp.y }
      updateElements([{ id: g.id, before, after }])
    } else if (g.kind === 'point' && el.type === 'polyline') {
      const i = Number(g.handle.slice('point-'.length))
      const { lp } = resolvePointDrag(g)
      const after = el.points.map((p, idx) => (idx === i ? ([lp.x, lp.y] as [number, number]) : p))
      updateElements([{ id: g.id, before: { points: el.points }, after: { points: after } }])
    }
  }

  const single = !creating && liveSelected.length === 1
  const marqueeBox = marquee ? normalizeBox(marquee.start.x, marquee.start.y, marquee.current.x, marquee.current.y) : null
  const polyPoints = (el: BoardElement) => boardCorners(el).map((p) => `${p.x},${p.y}`).join(' ')
  const snapGuides = gesture && gesture.kind === 'point' ? resolvePointDrag(gesture).guides : []

  return (
    <div
      ref={containerRef}
      data-board-surface
      className={cn('h-full w-full touch-none', creating ? 'cursor-crosshair' : 'cursor-default')}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <BoardCanvas
        doc={doc}
        svgRef={svgRef}
        overlay={
          <>
            {/* Whole-bounding-box grab areas (rotated polygon) for moving. Drawn
                under the handles so handles win the pointer. Skipped for lines,
                which are grabbed by their own stroke. */}
            {!creating &&
              liveSelected.map((el) =>
                el.type === 'line' ? null : (
                  <polygon
                    key={`hit-${el.id}`}
                    points={polyPoints(el)}
                    fill="transparent"
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => onElementPointerDown(e, el)}
                  />
                ),
              )}
            {/* Selection chrome: full handles for a single selection, plain
                outlines for a multi-selection. */}
            {!creating &&
              liveSelected.map((el) => (
                <SelectionHandles
                  key={`sel-${el.id}`}
                  element={el}
                  scale={scale}
                  onHandleDown={single ? (handle, e) => onHandleDown(handle, e, el) : undefined}
                />
              ))}
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
            {draft && <ElementView element={makeFigure(draft.type, 'draft', draft.start, draft.current)} />}
            {polyDraft && (
              <>
                {/* Live preview: placed segments + the segment to the cursor. */}
                <ElementView element={makePolyline('poly-draft', [...polyDraft.points, polyDraft.cursor], false)} />
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
          </>
        }
      >
        <g style={{ pointerEvents: creating ? 'none' : 'auto' }}>
          {doc.elements.map((el) => (
            <g key={el.id} style={{ cursor: 'move' }} onPointerDown={(e) => onElementPointerDown(e, el)}>
              <ElementView element={liveElement(el)} />
            </g>
          ))}
        </g>
      </BoardCanvas>
    </div>
  )
}

import { getLocalBounds, catmullRomCubics, cubicPointAt, type BoardElement, type Box } from '@youcoach-board/core'
import { elementToBoard, localCorners, tokenLabelBand, type Pt, type CornerId } from '../lib/geometry-2d'

export type HandleId = CornerId | 'rotate' | `point-${number}` | `anchor-${number}`

const FRAME = 'var(--color-selection-frame)' // bounding-box outline + rotation arm
const HANDLE = 'var(--color-selection-handle)' // resize / rotation / endpoint handles
// On-screen sizes (px); divided by `scale` to stay constant regardless of zoom.
const HANDLE_PX = 8
const ENDPOINT_R_PX = 6
const ANCHOR_R_PX = 4.5 // mid-segment "add point" anchors — smaller, filled
const ROT_R_PX = 5
const ROT_OFFSET_PX = 20
const STROKE_PX = 1.5
// Gap between the figure's bounding box and the selection frame, so the frame
// sits just OUTSIDE the figure rather than on top of it. Exported so the board's
// move-hit area can match the visible frame exactly.
export const SELECTION_PAD_PX = 6

interface Props {
  element: BoardElement
  scale: number
  /** Provided for single selection → renders interactive handles. Omitted for
   *  multi selection → renders just the outline. */
  onHandleDown?: (handle: HandleId, e: React.PointerEvent) => void
  /** Hide the bounding-box frame (outline + corners + rotation) — used while a
   *  vertex/anchor is being dragged so only the point handles show. */
  hideFrame?: boolean
}

// Local-coordinate positions of the mid-segment anchors for a polyline: the
// midpoint of each straight segment, or the curve's midpoint (t=0.5) when curved.
// Anchor `i` sits on the segment between vertex i and i+1 (closed wraps).
function polylineAnchors(el: Extract<BoardElement, { type: 'polyline' }>): Array<{ seg: number; at: Pt }> {
  // A tape (strict 2-point measure) and an oval (presented as an ellipse) never
  // offer the mid-segment "add point" anchor.
  if (el.tape || el.oval) return []
  const pts = el.points
  const n = pts.length
  if (n < 2) return []
  const segs = el.closed ? n : n - 1
  const cubics = el.curve ? catmullRomCubics(pts, el.closed) : null
  const out: Array<{ seg: number; at: Pt }> = []
  for (let i = 0; i < segs; i++) {
    if (cubics) {
      const m = cubicPointAt(cubics[i], 0.5)
      out.push({ seg: i, at: { x: m[0], y: m[1] } })
    } else {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      out.push({ seg: i, at: { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 } })
    }
  }
  return out
}

// Selection chrome for one element, drawn in board space so corner squares stay
// upright (axis-aligned) even when the element is rotated — only the outline
// rotates with it (the Excalidraw touch). A straight line (2-point polyline) is
// the exception: no box, just a draggable handle at each endpoint.
export function SelectionHandles({ element, scale, onHandleDown, hideFrame = false }: Props) {
  const interactive = !!onHandleDown
  const box = getLocalBounds(element)
  const t = element.transform

  // Mid-segment anchors (drag to split / add a curve point) for the selected
  // polyline, drawn under the vertex handles so vertices win the pointer.
  const anchors =
    interactive && element.type === 'polyline'
      ? polylineAnchors(element).map((a) => (
          <AnchorHandle
            key={`an-${a.seg}`}
            at={elementToBoard(a.at, box, t)}
            scale={scale}
            onDown={(e) => onHandleDown!(`anchor-${a.seg}`, e)}
          />
        ))
      : null

  // 2-point polyline = a straight line: in SINGLE selection, draggable endpoint
  // handles + a mid anchor (no frame). In a MULTI selection it falls through to
  // the box-like branch below, so it gets the same rectangular (dashed) frame as
  // everything else and reads clearly as selected.
  if (element.type === 'polyline' && element.points.length === 2 && interactive) {
    return (
      <g>
        {anchors}
        {element.points.map((p, i) => (
          <EndpointHandle
            key={`pt-${i}`}
            at={elementToBoard({ x: p[0], y: p[1] }, box, t)}
            scale={scale}
            handle={`point-${i}`}
            onDown={(e) => onHandleDown!(`point-${i}`, e)}
          />
        ))}
      </g>
    )
  }

  // Box-like (rect / ellipse / polyline): rotated outline + (if interactive)
  // corner + rotation handles. Polylines additionally get a circle on each
  // vertex (all handles live at once). The box is padded outward by a
  // screen-constant gap so the frame clears the figure; padding is symmetric,
  // so the rotation center is unchanged.
  const pad = SELECTION_PAD_PX / scale
  const pbox = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
  const c = localCorners(pbox)
  // A token with a caption extends the selection's BOTTOM by the caption band (a
  // fixed-px height below the badge), so the frame + bottom resize handles wrap
  // the label. The box keeps the badge's local frame (rotation about badge
  // center), only the se/sw corners drop by the band.
  const labelPad = tokenLabelBand(element, scale)
  const corners: Record<CornerId, Pt> = {
    nw: elementToBoard(c.nw, pbox, t),
    ne: elementToBoard(c.ne, pbox, t),
    se: elementToBoard({ x: c.se.x, y: c.se.y + labelPad }, pbox, t),
    sw: elementToBoard({ x: c.sw.x, y: c.sw.y + labelPad }, pbox, t),
  }
  const poly = `${corners.nw.x},${corners.nw.y} ${corners.ne.x},${corners.ne.y} ${corners.se.x},${corners.se.y} ${corners.sw.x},${corners.sw.y}`
  // Crisp (no anti-alias) only while the outline is axis-aligned; rotated edges
  // need smooth rendering or the diagonals look jagged.
  const r = ((t.rotate % 90) + 90) % 90
  const outlineRendering = r < 0.01 || r > 89.99 ? 'crispEdges' : 'geometricPrecision'

  // Multi-select (non-interactive): just the bounding-box outline (solid — only
  // the group frame is dashed).
  if (!interactive) {
    return (
      <polygon points={poly} fill="none" stroke={FRAME} strokeWidth={STROKE_PX} vectorEffect="non-scaling-stroke" shapeRendering={outlineRendering} pointerEvents="none" />
    )
  }

  // Text: frame + corner resize handles (no rotation). Dragging a corner scales
  // the FONT (the box re-fits the text; see InteractiveBoard.textFontResize).
  if (element.type === 'text') {
    const hs = HANDLE_PX / scale
    const cursor: Record<CornerId, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }
    return (
      <g>
        <polygon points={poly} fill="none" stroke={FRAME} strokeWidth={STROKE_PX} vectorEffect="non-scaling-stroke" shapeRendering={outlineRendering} pointerEvents="none" />
        {(Object.keys(corners) as CornerId[]).map((cid) => (
          <rect
            key={cid}
            x={corners[cid].x - hs / 2}
            y={corners[cid].y - hs / 2}
            width={hs}
            height={hs}
            rx={hs / 5}
            fill="#ffffff"
            stroke={HANDLE}
            strokeWidth={STROKE_PX}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: cursor[cid] }}
            data-handle={cid}
            onPointerDown={(e) => onHandleDown!(cid, e)}
          />
        ))}
      </g>
    )
  }

  // Rotation handle: above the (rotated) top edge, along its outward normal.
  const topMid = { x: (corners.nw.x + corners.ne.x) / 2, y: (corners.nw.y + corners.ne.y) / 2 }
  const ex = corners.ne.x - corners.nw.x
  const ey = corners.ne.y - corners.nw.y
  const len = Math.hypot(ex, ey) || 1
  const normal = { x: ey / len, y: -ex / len } // outward (away from center) on the top edge
  const rot = { x: topMid.x + (normal.x * ROT_OFFSET_PX) / scale, y: topMid.y + (normal.y * ROT_OFFSET_PX) / scale }
  const handleSize = HANDLE_PX / scale
  const cursorFor: Record<CornerId, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }

  return (
    <g>
      {/* The bounding-box frame (outline + rotation + corner resize) is hidden
          while a vertex/anchor is being dragged — only the point handles stay. */}
      {!hideFrame && (
        <>
          <polygon points={poly} fill="none" stroke={FRAME} strokeWidth={STROKE_PX} vectorEffect="non-scaling-stroke" shapeRendering={outlineRendering} pointerEvents="none" />
          {/* rotation arm + handle */}
          <line x1={topMid.x} y1={topMid.y} x2={rot.x} y2={rot.y} stroke={FRAME} strokeWidth={STROKE_PX} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <circle
            cx={rot.x}
            cy={rot.y}
            r={ROT_R_PX / scale}
            fill="#ffffff"
            stroke={HANDLE}
            strokeWidth={STROKE_PX}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'grab' }}
            data-handle="rotate"
            onPointerDown={(e) => onHandleDown!('rotate', e)}
          />
          {/* corner resize squares (kept axis-aligned / upright) */}
          {(Object.keys(corners) as CornerId[]).map((id) => (
            <rect
              key={id}
              x={corners[id].x - handleSize / 2}
              y={corners[id].y - handleSize / 2}
              width={handleSize}
              height={handleSize}
              rx={handleSize / 5}
              fill="#ffffff"
              stroke={HANDLE}
              strokeWidth={STROKE_PX}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: cursorFor[id] }}
              data-handle={id}
              onPointerDown={(e) => onHandleDown!(id, e)}
            />
          ))}
        </>
      )}
      {/* mid-segment anchors (under the vertices) + polyline vertex handles,
          drawn last so they sit above the corners. */}
      {anchors}
      {element.type === 'polyline' &&
        !element.oval &&
        element.points.map((p, i) => (
          <EndpointHandle
            key={`pt-${i}`}
            at={elementToBoard({ x: p[0], y: p[1] }, box, t)}
            scale={scale}
            handle={`point-${i}`}
            onDown={(e) => onHandleDown!(`point-${i}`, e)}
          />
        ))}
    </g>
  )
}

function EndpointHandle({
  at,
  scale,
  handle,
  onDown,
}: {
  at: Pt
  scale: number
  handle: string
  /** Omitted for non-interactive (multi-select) markers. */
  onDown?: (e: React.PointerEvent) => void
}) {
  return (
    <circle
      cx={at.x}
      cy={at.y}
      r={ENDPOINT_R_PX / scale}
      fill="#ffffff"
      stroke={HANDLE}
      strokeWidth={STROKE_PX}
      vectorEffect="non-scaling-stroke"
      style={onDown ? { cursor: 'move' } : undefined}
      data-handle={handle}
      onPointerDown={onDown}
    />
  )
}

// A mid-segment anchor: a smaller, filled dot. Dragging it inserts a vertex on
// that segment (split a straight segment / add a curve point on a curved one).
function AnchorHandle({ at, scale, onDown }: { at: Pt; scale: number; onDown: (e: React.PointerEvent) => void }) {
  return (
    <circle
      cx={at.x}
      cy={at.y}
      r={ANCHOR_R_PX / scale}
      fill={HANDLE}
      stroke="#ffffff"
      strokeWidth={STROKE_PX}
      vectorEffect="non-scaling-stroke"
      style={{ cursor: 'copy' }}
      onPointerDown={onDown}
    />
  )
}

// Interactive chrome for a MULTI-selection's group: a dashed axis-aligned frame
// with upright resize corners + a rotation handle. Resizing scales the whole set
// uniformly about the opposite corner; rotating spins it about the center. The
// box is already padded by the caller.
export function GroupHandles({
  box,
  scale,
  onDown,
}: {
  box: Box
  scale: number
  onDown: (handle: CornerId | 'rotate', e: React.PointerEvent) => void
}) {
  const corners: Record<CornerId, Pt> = {
    nw: { x: box.x, y: box.y },
    ne: { x: box.x + box.width, y: box.y },
    se: { x: box.x + box.width, y: box.y + box.height },
    sw: { x: box.x, y: box.y + box.height },
  }
  const handleSize = HANDLE_PX / scale
  const topMid = { x: box.x + box.width / 2, y: box.y }
  const rot = { x: topMid.x, y: topMid.y - ROT_OFFSET_PX / scale }
  const cursorFor: Record<CornerId, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }
  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke={FRAME}
        strokeWidth={STROKE_PX}
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
        shapeRendering="crispEdges"
        pointerEvents="none"
      />
      <line x1={topMid.x} y1={topMid.y} x2={rot.x} y2={rot.y} stroke={FRAME} strokeWidth={STROKE_PX} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      <circle
        cx={rot.x}
        cy={rot.y}
        r={ROT_R_PX / scale}
        fill="#ffffff"
        stroke={HANDLE}
        strokeWidth={STROKE_PX}
        vectorEffect="non-scaling-stroke"
        style={{ cursor: 'grab' }}
        data-handle="rotate"
        onPointerDown={(e) => onDown('rotate', e)}
      />
      {(Object.keys(corners) as CornerId[]).map((id) => (
        <rect
          key={id}
          x={corners[id].x - handleSize / 2}
          y={corners[id].y - handleSize / 2}
          width={handleSize}
          height={handleSize}
          rx={handleSize / 5}
          fill="#ffffff"
          stroke={HANDLE}
          strokeWidth={STROKE_PX}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: cursorFor[id] }}
          data-handle={id}
          onPointerDown={(e) => onDown(id, e)}
        />
      ))}
    </g>
  )
}

import { getLocalBounds, type BoardElement } from '@youcoach-board/core'
import { elementToBoard, localCorners, type Pt, type CornerId } from '../lib/geometry-2d'

export type HandleId = CornerId | 'rotate' | `point-${number}`

const FRAME = 'var(--color-selection-frame)' // bounding-box outline + rotation arm
const HANDLE = 'var(--color-selection-handle)' // resize / rotation / endpoint handles
// On-screen sizes (px); divided by `scale` to stay constant regardless of zoom.
const HANDLE_PX = 10
const ENDPOINT_R_PX = 6
const ROT_R_PX = 5
const ROT_OFFSET_PX = 20
const STROKE_PX = 2
// Gap between the figure's bounding box and the selection frame, so the frame
// sits just OUTSIDE the figure rather than on top of it.
const PAD_PX = 6

interface Props {
  element: BoardElement
  scale: number
  /** Provided for single selection → renders interactive handles. Omitted for
   *  multi selection → renders just the outline. */
  onHandleDown?: (handle: HandleId, e: React.PointerEvent) => void
}

// Selection chrome for one element, drawn in board space so corner squares stay
// upright (axis-aligned) even when the element is rotated — only the outline
// rotates with it (the Excalidraw touch). A straight line (2-point polyline) is
// the exception: no box, just a draggable handle at each endpoint.
export function SelectionHandles({ element, scale, onHandleDown }: Props) {
  const interactive = !!onHandleDown
  const box = getLocalBounds(element)
  const t = element.transform

  // 2-point polyline = a straight line: endpoint handles only, no frame.
  if (element.type === 'polyline' && element.points.length === 2) {
    if (!interactive) return null // multi-select: nothing extra for a line
    return (
      <g>
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
  const pad = PAD_PX / scale
  const pbox = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
  const c = localCorners(pbox)
  const corners: Record<CornerId, Pt> = {
    nw: elementToBoard(c.nw, pbox, t),
    ne: elementToBoard(c.ne, pbox, t),
    se: elementToBoard(c.se, pbox, t),
    sw: elementToBoard(c.sw, pbox, t),
  }
  const poly = `${corners.nw.x},${corners.nw.y} ${corners.ne.x},${corners.ne.y} ${corners.se.x},${corners.se.y} ${corners.sw.x},${corners.sw.y}`
  // Crisp (no anti-alias) only while the outline is axis-aligned; rotated edges
  // need smooth rendering or the diagonals look jagged.
  const r = ((t.rotate % 90) + 90) % 90
  const outlineRendering = r < 0.01 || r > 89.99 ? 'crispEdges' : 'geometricPrecision'

  // Multi-select (non-interactive): just the bounding-box outline.
  if (!interactive) {
    return (
      <polygon points={poly} fill="none" stroke={FRAME} strokeWidth={STROKE_PX} vectorEffect="non-scaling-stroke" shapeRendering={outlineRendering} pointerEvents="none" />
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
      {/* polyline vertex handles — drawn last so they sit above the corners. */}
      {element.type === 'polyline' &&
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

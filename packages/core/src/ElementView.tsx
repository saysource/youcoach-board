import type { BoardElement } from './elements'
import { getLocalBounds } from './elements'

// Renders a single board element to SVG. Presentational and shared: the viewer
// renders elements through this directly, and the designer wraps it with
// interaction handlers — one visual source of truth for both. Export-safe
// (plain SVG primitives, no foreignObject).
//
// The element's `transform` (placement) is applied on a wrapping <g>, kept
// separate from the intrinsic geometry below it.
export function ElementView({ element }: { element: BoardElement }) {
  const { x, y, rotate, scale, opacity } = element.transform
  const c = getLocalBounds(element)
  const cx = c.x + c.width / 2
  const cy = c.y + c.height / 2
  // Translate, then rotate + scale about the element's local center.
  const transform =
    `translate(${x} ${y}) rotate(${rotate} ${cx} ${cy}) ` +
    `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`

  return (
    <g transform={transform} opacity={opacity}>
      <Shape element={element} />
    </g>
  )
}

function Shape({ element }: { element: BoardElement }) {
  const paint = {
    fill: element.fill,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
  }

  if (element.type === 'rect') {
    return <rect x={element.x} y={element.y} width={element.width} height={element.height} {...paint} />
  }

  if (element.type === 'ellipse') {
    return (
      <ellipse
        cx={element.x + element.width / 2}
        cy={element.y + element.height / 2}
        rx={element.width / 2}
        ry={element.height / 2}
        {...paint}
      />
    )
  }

  if (element.type === 'polyline') {
    const pts = element.points.map((p) => `${p[0]},${p[1]}`).join(' ')
    const hit = Math.max(element.strokeWidth * 4, 16)
    // A transparent fat companion widens the hit area; closed → polygon (fillable).
    if (element.closed) {
      return (
        <g>
          <polygon points={pts} stroke="transparent" strokeWidth={hit} fill={element.fill} strokeLinejoin="round" />
          <polygon points={pts} stroke={element.stroke} strokeWidth={element.strokeWidth} fill={element.fill} strokeLinejoin="round" />
        </g>
      )
    }
    return (
      <g>
        <polyline points={pts} stroke="transparent" strokeWidth={hit} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={pts} stroke={element.stroke} strokeWidth={element.strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    )
  }

  // line — a transparent fat companion stroke widens the hit area so a thin
  // line is still easy to click for selection.
  return (
    <g>
      <line
        x1={element.x1}
        y1={element.y1}
        x2={element.x2}
        y2={element.y2}
        stroke="transparent"
        strokeWidth={Math.max(element.strokeWidth * 4, 16)}
        strokeLinecap="round"
        fill="none"
      />
      <line
        x1={element.x1}
        y1={element.y1}
        x2={element.x2}
        y2={element.y2}
        stroke={element.stroke}
        strokeWidth={element.strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  )
}

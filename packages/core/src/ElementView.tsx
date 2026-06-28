import { useId } from 'react'
import type { BoardElement } from './elements'
import { getLocalBounds, strokeDash } from './elements'

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

// A smoothed SVG path through freehand points: quadratic segments whose control
// point is each sample and whose endpoints are the midpoints between samples —
// a cheap, stable way to round off the polyline of captured points.
function freehandPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return ''
  if (pts.length < 3) return `M ${pts.map((p) => `${p[0]},${p[1]}`).join(' L ')}`
  let d = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    d += ` Q ${pts[i][0]},${pts[i][1]} ${mx},${my}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last[0]},${last[1]}`
  return d
}

function Shape({ element }: { element: BoardElement }) {
  // Unique per instance, so each element's arrow marker def doesn't collide.
  const markerId = useId()
  const dash = strokeDash(element.strokeStyle, element.strokeWidth)
  // Dotted needs round caps to render as dots rather than vanishing.
  const cap = element.strokeStyle === 'dotted' ? 'round' : undefined
  const paint = {
    fill: element.fill,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    strokeDasharray: dash,
  }

  if (element.type === 'figure') {
    // Placeholder until the designer/viewer injects the recolored SVG: a dashed
    // box at the figure's intrinsic size, labelled with its catalog id.
    const { width, height } = element
    const s = Math.max(width, height)
    return (
      <g>
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          rx={s * 0.05}
          fill="rgba(0,0,0,0.05)"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={s * 0.01}
          strokeDasharray={`${s * 0.04} ${s * 0.03}`}
        />
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={Math.min(width, height) * 0.12}
          fill="rgba(0,0,0,0.5)"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          {element.figureId}
        </text>
      </g>
    )
  }

  if (element.type === 'rect') {
    return (
      <rect x={element.x} y={element.y} width={element.width} height={element.height} {...paint} strokeLinecap={cap} />
    )
  }

  if (element.type === 'ellipse') {
    return (
      <ellipse
        cx={element.x + element.width / 2}
        cy={element.y + element.height / 2}
        rx={element.width / 2}
        ry={element.height / 2}
        {...paint}
        strokeLinecap={cap}
      />
    )
  }

  if (element.type === 'draw') {
    const d = freehandPath(element.points)
    const hit = Math.max(element.strokeWidth * 4, 16)
    return (
      <g>
        <path d={d} stroke="transparent" strokeWidth={hit} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d={d}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
          strokeDasharray={dash}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    )
  }

  // polyline — covers straight lines, multi-segment paths, arrows and (closed)
  // polygons. A transparent fat companion stroke widens the hit area; arrow tips
  // are drawn as a marker at the first/last point of an OPEN polyline.
  const pts = element.points.map((p) => `${p[0]},${p[1]}`).join(' ')
  const hit = Math.max(element.strokeWidth * 4, 16)
  const Tag = element.closed ? 'polygon' : 'polyline'
  const tips = !element.closed && (element.startTip === 'arrow' || element.endTip === 'arrow')
  return (
    <g>
      {tips && (
        <defs>
          {/* orient="auto-start-reverse" lets one marker serve both ends; sized
              in stroke-width units so the arrowhead scales with the stroke. */}
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth={5}
            markerHeight={5}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={element.stroke} />
          </marker>
        </defs>
      )}
      <Tag points={pts} stroke="transparent" strokeWidth={hit} fill={element.closed ? element.fill : 'none'} strokeLinecap="round" strokeLinejoin="round" />
      <Tag
        points={pts}
        stroke={element.stroke}
        strokeWidth={element.strokeWidth}
        strokeDasharray={dash}
        fill={element.closed ? element.fill : 'none'}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerStart={tips && element.startTip === 'arrow' ? `url(#${markerId})` : undefined}
        markerEnd={tips && element.endTip === 'arrow' ? `url(#${markerId})` : undefined}
      />
    </g>
  )
}

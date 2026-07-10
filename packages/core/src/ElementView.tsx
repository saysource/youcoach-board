import { useId } from 'react'
import type { BoardElement } from './elements'
import { textFontStack } from './fonts'
import { getLocalBounds, curvedPathD, zigzagPathD, waveParams, doubleLinePaths, strokeDash, TOKEN_GEOMETRY, TOKEN_VIEW, TOKEN_STRIPE_PERIOD, TOKEN_SINGLE_STRIPE, TOKEN_CHECKER_SIZE, TOKEN_FONT, TOKEN_FONT_WEIGHT, TOKEN_LABEL_PX, TOKEN_LABEL_GAP_PX, TOKEN_LABEL_PLACEHOLDER, TEXT_FONT_WEIGHT, TEXT_FONT_WEIGHT_BOLD, TEXT_LINE_HEIGHT, TEXT_PADDING, textBoxRadius } from './elements'

// Renders a single board element to SVG. Presentational and shared: the viewer
// renders elements through this directly, and the designer wraps it with
// interaction handlers — one visual source of truth for both. Export-safe
// (plain SVG primitives, no foreignObject).
//
// The element's `transform` (placement) is applied on a wrapping <g>, kept
// separate from the intrinsic geometry below it.
// `viewScale` = screen px per board unit. When provided, the token caption renders
// at a FIXED on-screen size (TOKEN_LABEL_PX) regardless of the board's fit-scale or
// the token's size; without it (viewer/export) the caption falls back to board units.
export function ElementView({ element, viewScale, tokenTextScale = 1, tokenLabelScale = 1, tokenBadgeHidden = false }: { element: BoardElement; viewScale?: number; tokenTextScale?: number; tokenLabelScale?: number; tokenBadgeHidden?: boolean }) {
  // 3D arrows/objects are drawn by the designer's WebGL overlay, never as SVG.
  if (element.type === 'arrow3d' || element.type === 'object3d') return null
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
      <Shape element={element} viewScale={viewScale} tokenTextScale={tokenTextScale} tokenLabelScale={tokenLabelScale} tokenBadgeHidden={tokenBadgeHidden} />
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

// Stripe tile (board units) for the 'striped' fill — a 45° hatch of the fill
// color over transparent gaps.
const STRIPE = 12

function Shape({ element, viewScale, tokenTextScale = 1, tokenLabelScale = 1, tokenBadgeHidden = false }: { element: BoardElement; viewScale?: number; tokenTextScale?: number; tokenLabelScale?: number; tokenBadgeHidden?: boolean }) {
  // Unique per instance, so each element's marker/pattern/clip defs don't collide.
  const markerId = useId()
  const patternId = useId()
  const clipId = useId()
  if (element.type === 'arrow3d' || element.type === 'object3d') return null // WebGL overlay
  const dash = strokeDash(element.strokeStyle, element.strokeWidth)
  // Dotted needs round caps to render as dots rather than vanishing.
  const cap = element.strokeStyle === 'dotted' ? 'round' : undefined
  // Striped fill: paint via a 45° line pattern when the shape has a real fill.
  const hasFill = element.fill !== 'transparent' && element.fill !== ''
  const striped = element.fillStyle === 'striped' && hasFill
  const fillPaint = striped ? `url(#${patternId})` : element.fill
  const stripesDef = striped ? (
    <defs>
      <pattern id={patternId} patternUnits="userSpaceOnUse" width={STRIPE} height={STRIPE} patternTransform="rotate(45)">
        <line x1={STRIPE / 2} y1={0} x2={STRIPE / 2} y2={STRIPE} stroke={element.fill} strokeWidth={STRIPE / 2} />
      </pattern>
    </defs>
  ) : null
  const paint = {
    fill: fillPaint,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    strokeDasharray: dash,
  }

  if (element.type === 'token') {
    const g = TOKEN_GEOMETRY[element.shape]
    const { x, y, width, height } = element
    // Place + scale the 100-space badge into the element box.
    const t = `translate(${x} ${y}) scale(${width / TOKEN_VIEW} ${height / TOKEN_VIEW})`
    // The silhouette, reused as clip (fillable interior) and stroked outline.
    const silhouette =
      g.shape === 'circle'
        ? <circle cx={g.circle![0]} cy={g.circle![1]} r={g.circle![2]} />
        : <path d={g.path!} />
    const f = element.tokenFill
    const P = TOKEN_STRIPE_PERIOD
    const C = TOKEN_CHECKER_SIZE
    // color2 overlay on a color1 base, all clipped to the silhouette.
    const overlay =
      f === 'vstripes' ? <rect x={0} y={0} width={TOKEN_VIEW} height={TOKEN_VIEW} fill={`url(#${patternId})`} />
      : f === 'hstripes' ? <rect x={0} y={0} width={TOKEN_VIEW} height={TOKEN_VIEW} fill={`url(#${patternId})`} />
      : f === 'checker' ? <rect x={0} y={0} width={TOKEN_VIEW} height={TOKEN_VIEW} fill={`url(#${patternId})`} />
      : f === 'plaid' ? <rect x={0} y={0} width={TOKEN_VIEW} height={TOKEN_VIEW} fill={`url(#${patternId})`} />
      : f === 'vstripe' ? <rect x={TOKEN_VIEW / 2 - TOKEN_SINGLE_STRIPE / 2} y={0} width={TOKEN_SINGLE_STRIPE} height={TOKEN_VIEW} fill={element.color2} />
      : f === 'hstripe' ? <rect x={0} y={TOKEN_VIEW / 2 - TOKEN_SINGLE_STRIPE / 2} width={TOKEN_VIEW} height={TOKEN_SINGLE_STRIPE} fill={element.color2} />
      : null
    const patternDef =
      f === 'vstripes' ? (
        <pattern id={patternId} patternUnits="userSpaceOnUse" width={P} height={P}>
          <rect x={0} y={0} width={P / 2} height={P} fill={element.color2} />
        </pattern>
      ) : f === 'hstripes' ? (
        <pattern id={patternId} patternUnits="userSpaceOnUse" width={P} height={P}>
          <rect x={0} y={0} width={P} height={P / 2} fill={element.color2} />
        </pattern>
      ) : f === 'checker' ? (
        <pattern id={patternId} patternUnits="userSpaceOnUse" width={C * 2} height={C * 2}>
          <rect x={0} y={0} width={C} height={C} fill={element.color2} />
          <rect x={C} y={C} width={C} height={C} fill={element.color2} />
        </pattern>
      ) : f === 'plaid' ? (
        // Vertical + horizontal stripes (a plaid grid), not a checkerboard.
        <pattern id={patternId} patternUnits="userSpaceOnUse" width={P} height={P}>
          <rect x={0} y={0} width={P / 2} height={P} fill={element.color2} />
          <rect x={0} y={0} width={P} height={P / 2} fill={element.color2} />
        </pattern>
      ) : null
    // Caption: a fixed-size 2D label anchored at the token's BASE, which itself moves
    // as the token grows/shrinks with 3D perspective. It lives inside the element's
    // transform (scaled by `transform.scale`), so we COUNTER-SCALE the font + gap by
    // that scale — the label keeps a constant on-screen size no matter how big the
    // token renders, sitting a fixed gap below the (scaled) base. `viewScale` keeps
    // it constant against board zoom too.
    const labelScale = element.transform.scale || 1
    const labelFont = ((viewScale && viewScale > 0 ? TOKEN_LABEL_PX / viewScale : TOKEN_LABEL_PX) / labelScale) * tokenLabelScale
    const labelGap = (viewScale && viewScale > 0 ? TOKEN_LABEL_GAP_PX / viewScale : TOKEN_LABEL_GAP_PX) / labelScale
    return (
      <>
        {/* Hidden badge (tokens3d): invisible AND inert — the 3D disc owns picking. */}
        <g transform={t} opacity={tokenBadgeHidden ? 0 : undefined} pointerEvents={tokenBadgeHidden ? 'none' : undefined}>
          <defs>
            <clipPath id={clipId}>{silhouette}</clipPath>
            {patternDef}
          </defs>
          {g.shape === 'circle' ? (
            <circle cx={g.circle![0]} cy={g.circle![1]} r={g.circle![2]} fill="#000000" style={{ filter: 'drop-shadow(rgba(0, 0, 0, 0.5) 8px 8px 3px)' }} />
          ) : (
            <path d={g.path!} fill="#000000" style={{ filter: 'drop-shadow(rgba(0, 0, 0, 0.5) 8px 8px 3px)' }} />
          )}
          <g clipPath={`url(#${clipId})`}>
            <rect x={0} y={0} width={TOKEN_VIEW} height={TOKEN_VIEW} fill={element.color1} />
            {overlay}
          </g>
          {/* Outline drawn on top so the fill never bleeds past the silhouette. */}
          {g.shape === 'circle' ? (
            <circle cx={g.circle![0]} cy={g.circle![1]} r={g.circle![2]} fill="none" stroke={element.stroke} strokeWidth={g.strokeWidth} />
          ) : (
            <path d={g.path!} fill="none" stroke={element.stroke} strokeWidth={g.strokeWidth} />
          )}
          {element.text && (
            <text
              x={g.text.x}
              y={g.text.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={g.text.size * tokenTextScale}
              fontWeight={TOKEN_FONT_WEIGHT}
              fill={element.textColor}
              style={{ fontFamily: TOKEN_FONT }}
            >
              {element.text}
            </text>
          )}
        </g>
        {/* Caption: outside the size-scaled group so its font stays fixed (px) and
            doesn't grow/shrink with the token; centered just below the badge. */}
        {element.showLabel && !tokenBadgeHidden && (
          <text
            data-token-label=""
            x={element.x + element.width / 2}
            y={element.y + element.height + labelGap + labelFont / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={labelFont}
            fontWeight={TOKEN_FONT_WEIGHT}
            fill="#000000"
            style={{ fontFamily: TOKEN_FONT }}
          >
            {element.label || TOKEN_LABEL_PLACEHOLDER}
          </text>
        )}
      </>
    )
  }

  if (element.type === 'text') {
    const { x, y, width, height, fontSize, align } = element
    const lines = element.text.length ? element.text.split('\n') : ['']
    const lineH = fontSize * TEXT_LINE_HEIGHT
    const rx = textBoxRadius(element)
    const hasBg = element.bgColor !== 'transparent' && element.bgColor !== ''
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
    const tx = align === 'left' ? x + TEXT_PADDING : align === 'right' ? x + width - TEXT_PADDING : x + width / 2
    // Text block is vertically centered in the box (which is height = lines·lineH
    // + 2·pad, so the top sits exactly at y + pad).
    const top = y + (height - lines.length * lineH) / 2
    return (
      <g>
        {/* Transparent hit area so the whole box (not just the glyphs) selects/moves. */}
        <rect x={x} y={y} width={width} height={height} rx={rx} fill={hasBg ? element.bgColor : 'transparent'} />
        <text
          textAnchor={anchor}
          fontSize={fontSize}
          fontWeight={element.bold ? TEXT_FONT_WEIGHT_BOLD : TEXT_FONT_WEIGHT}
          fontStyle={element.italic ? 'italic' : undefined}
          fill={element.textColor}
          style={{ fontFamily: textFontStack(element.fontFamily), whiteSpace: 'pre' }}
        >
          {lines.map((ln, i) => (
            <tspan key={i} x={tx} y={top + i * lineH + lineH / 2} dominantBaseline="central">
              {ln === '' ? ' ' : ln}
            </tspan>
          ))}
        </text>
      </g>
    )
  }

  if (element.type === 'figure') {
    // Placeholder until the designer/viewer injects the recolored SVG: a dashed
    // box at the figure's box, labelled with its catalog id.
    const { x, y, width, height } = element
    const s = Math.max(width, height)
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={s * 0.05}
          fill="rgba(0,0,0,0.05)"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={s * 0.01}
          strokeDasharray={`${s * 0.04} ${s * 0.03}`}
        />
        <text
          x={x + width / 2}
          y={y + height / 2}
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
      <g>
        {stripesDef}
        <rect x={element.x} y={element.y} width={element.width} height={element.height} {...paint} strokeLinecap={cap} />
      </g>
    )
  }

  if (element.type === 'ellipse') {
    return (
      <g>
        {stripesDef}
        <ellipse
          cx={element.x + element.width / 2}
          cy={element.y + element.height / 2}
          rx={element.width / 2}
          ry={element.height / 2}
          {...paint}
          strokeLinecap={cap}
        />
      </g>
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
  // polygons, optionally curved (a smooth path through the points). A transparent
  // fat companion stroke widens the hit area; arrow tips are drawn as a marker at
  // the first/last point of an OPEN polyline.
  const hit = Math.max(element.strokeWidth * 4, 16)
  const fill = element.closed ? fillPaint : 'none'
  const tips = !element.closed && (element.startTip === 'arrow' || element.endTip === 'arrow')

  // Double line: two parallel strokes straddling the smooth reference path, with
  // any arrow tips drawn as a single filled head spanning the gap. The reference
  // path provides the (invisible) hit area.
  if (element.double) {
    const g = doubleLinePaths(
      element.points,
      element.closed,
      element.linesOffset,
      !element.closed && element.startTip === 'arrow',
      !element.closed && element.endTip === 'arrow',
    )
    return (
      <g>
        <path d={curvedPathD(element.points, element.closed)} stroke="transparent" strokeWidth={hit} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d={g.left} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={dash} fill="none" strokeLinecap={cap} strokeLinejoin="round" />
        <path d={g.right} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={dash} fill="none" strokeLinecap={cap} strokeLinejoin="round" />
        {g.arrows.map((d, i) => (
          <path key={i} d={d} fill={element.stroke} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinejoin="round" />
        ))}
      </g>
    )
  }
  // Curved → a single <path>; straight → <polyline>/<polygon>. Both take the same
  // paint + marker props (markers work on path and polyline alike).
  const geom = element.zigzag
    ? { Tag: 'path' as const, attr: { d: (() => { const w = waveParams(element); return zigzagPathD(element.points, element.closed, w.offset, w.wavelength, tips && element.startTip === 'arrow', tips && element.endTip === 'arrow') })() } }
    : element.curve
    ? { Tag: 'path' as const, attr: { d: curvedPathD(element.points, element.closed) } }
    : { Tag: (element.closed ? 'polygon' : 'polyline') as 'polygon' | 'polyline', attr: { points: element.points.map((p) => `${p[0]},${p[1]}`).join(' ') } }
  const Tag = geom.Tag
  return (
    <g>
      {stripesDef}
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
      <Tag {...geom.attr} stroke="transparent" strokeWidth={hit} fill={fill} strokeLinecap="round" strokeLinejoin="round" />
      <Tag
        {...geom.attr}
        stroke={element.stroke}
        strokeWidth={element.strokeWidth}
        strokeDasharray={dash}
        fill={fill}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerStart={tips && element.startTip === 'arrow' ? `url(#${markerId})` : undefined}
        markerEnd={tips && element.endTip === 'arrow' ? `url(#${markerId})` : undefined}
      />
    </g>
  )
}

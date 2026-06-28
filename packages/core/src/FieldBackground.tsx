import { BOARD_WIDTH, BOARD_HEIGHT } from './geometry'

// A default 11v11 soccer pitch, drawn top-down in landscape (goals left/right).
// Pure, self-contained SVG — no <foreignObject>, no external refs — so it stays
// rasterizable for image/video export (see the spec's canvas decision). This is
// the Phase 2 placeholder background: later it becomes one selectable option
// among configurable field SVGs (futsal, partial fields, custom colors).

// ── Pitch geometry, in board user-space (see geometry.ts) ──────────────────
const MARGIN = 80
const LEFT = MARGIN
const TOP = MARGIN
const RIGHT = BOARD_WIDTH - MARGIN
const BOTTOM = BOARD_HEIGHT - MARGIN
const CX = BOARD_WIDTH / 2
const CY = BOARD_HEIGHT / 2

const CENTER_R = 95
const SPOT_R = 5

const PEN_DEPTH = 150 // penalty box depth from the goal line
const PEN_HALF = 200 // penalty box half-height
const GOAL_AREA_DEPTH = 55
const GOAL_AREA_HALF = 110
const PEN_SPOT_DIST = 100 // penalty spot distance from the goal line
const ARC_R = 95 // penalty arc radius (centered on the penalty spot)
const CORNER_R = 18
const GOAL_DEPTH = 14 // goal net box, drawn just outside the goal line
const GOAL_HALF = 60

// x where the penalty arc crosses the box edge, and the matching y-offset.
const ARC_BOX_DX = PEN_DEPTH - PEN_SPOT_DIST // 50
const ARC_DY = Math.sqrt(ARC_R * ARC_R - ARC_BOX_DX * ARC_BOX_DX)

const LINE = '#f4f7f4'
const LINE_OPACITY = 0.85
const STROKE = 3

// Mowing stripes: alternating translucent overlay bands for a turf look.
const STRIPES = 8
const stripeWidth = (RIGHT - LEFT) / STRIPES

// `image`, when set, is used as the grass surface (covering the board) instead
// of the flat green fill. NOTE: an external <image href> is not export-safe
// (rasterizing the SVG won't inline it) — this is a temporary stand-in until
// asset loading is defined; eventually we'll embed/preload it as a data URL.
export function FieldBackground({ image }: { image?: string | null } = {}) {
  return (
    <g data-field="soccer-11">
      {/* Grass: a background image if provided, else a flat green fill. */}
      {image ? (
        <image href={image} x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} preserveAspectRatio="xMidYMid slice" />
      ) : (
        <>
          <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#2f8a3e" />
          <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#1f6e2f" fillOpacity={0.35} />
        </>
      )}

      {/* Mowing stripes, clipped to the grass rect via a clipPath. */}
      <clipPath id="ycb-field-clip">
        <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} />
      </clipPath>
      <g clipPath="url(#ycb-field-clip)">
        {Array.from({ length: STRIPES }, (_, i) =>
          i % 2 === 0 ? (
            <rect
              key={i}
              x={LEFT + i * stripeWidth}
              y={0}
              width={stripeWidth}
              height={BOARD_HEIGHT}
              fill="#ffffff"
              fillOpacity={0.05}
            />
          ) : null,
        )}
      </g>

      {/* Markings. */}
      <g
        fill="none"
        stroke={LINE}
        strokeOpacity={LINE_OPACITY}
        strokeWidth={STROKE}
        strokeLinecap="round"
      >
        {/* Boundary + halfway line + center circle/spot. */}
        <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} />
        <line x1={CX} y1={TOP} x2={CX} y2={BOTTOM} />
        <circle cx={CX} cy={CY} r={CENTER_R} />
        <circle cx={CX} cy={CY} r={SPOT_R} fill={LINE} stroke="none" fillOpacity={LINE_OPACITY} />

        {/* Left end. */}
        <rect x={LEFT} y={CY - PEN_HALF} width={PEN_DEPTH} height={PEN_HALF * 2} />
        <rect x={LEFT} y={CY - GOAL_AREA_HALF} width={GOAL_AREA_DEPTH} height={GOAL_AREA_HALF * 2} />
        <circle cx={LEFT + PEN_SPOT_DIST} cy={CY} r={SPOT_R} fill={LINE} stroke="none" fillOpacity={LINE_OPACITY} />
        <path
          d={`M ${LEFT + PEN_DEPTH} ${CY - ARC_DY} A ${ARC_R} ${ARC_R} 0 0 1 ${LEFT + PEN_DEPTH} ${CY + ARC_DY}`}
        />
        <rect x={LEFT - GOAL_DEPTH} y={CY - GOAL_HALF} width={GOAL_DEPTH} height={GOAL_HALF * 2} />

        {/* Right end (mirror). */}
        <rect x={RIGHT - PEN_DEPTH} y={CY - PEN_HALF} width={PEN_DEPTH} height={PEN_HALF * 2} />
        <rect x={RIGHT - GOAL_AREA_DEPTH} y={CY - GOAL_AREA_HALF} width={GOAL_AREA_DEPTH} height={GOAL_AREA_HALF * 2} />
        <circle cx={RIGHT - PEN_SPOT_DIST} cy={CY} r={SPOT_R} fill={LINE} stroke="none" fillOpacity={LINE_OPACITY} />
        <path
          d={`M ${RIGHT - PEN_DEPTH} ${CY - ARC_DY} A ${ARC_R} ${ARC_R} 0 0 0 ${RIGHT - PEN_DEPTH} ${CY + ARC_DY}`}
        />
        <rect x={RIGHT} y={CY - GOAL_HALF} width={GOAL_DEPTH} height={GOAL_HALF * 2} />

        {/* Corner arcs. */}
        <path d={`M ${LEFT + CORNER_R} ${TOP} A ${CORNER_R} ${CORNER_R} 0 0 0 ${LEFT} ${TOP + CORNER_R}`} />
        <path d={`M ${RIGHT - CORNER_R} ${TOP} A ${CORNER_R} ${CORNER_R} 0 0 1 ${RIGHT} ${TOP + CORNER_R}`} />
        <path d={`M ${LEFT} ${BOTTOM - CORNER_R} A ${CORNER_R} ${CORNER_R} 0 0 0 ${LEFT + CORNER_R} ${BOTTOM}`} />
        <path d={`M ${RIGHT} ${BOTTOM - CORNER_R} A ${CORNER_R} ${CORNER_R} 0 0 1 ${RIGHT - CORNER_R} ${BOTTOM}`} />
      </g>
    </g>
  )
}

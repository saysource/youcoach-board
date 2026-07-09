import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import type { ExportGuide } from '../store/editorStore'

// The export-aspect guide frame: a border (with a dimmed surround) marking the
// region an image export of the chosen aspect ratio would capture, so the user can
// compose the scene inside it. The exporter fits the board to the export WIDTH and
// centres it vertically, so the frame is the target aspect FITTED INSIDE the 4:3
// board and centred — for 4:3 it is the whole board; a wider ratio (16:9) crops
// top/bottom; a taller ratio (9:16) crops left/right. Drawn in board coordinates.

const RATIO: Record<Exclude<ExportGuide, 'off'>, number> = { '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16 }

/** The captured rect (board units) for a guide aspect ratio, fitted + centred. */
function exportGuideRect(guide: Exclude<ExportGuide, 'off'>): { x: number; y: number; w: number; h: number } {
  const r = RATIO[guide]
  const boardR = BOARD_WIDTH / BOARD_HEIGHT
  const w = r >= boardR ? BOARD_WIDTH : BOARD_HEIGHT * r
  const h = r >= boardR ? BOARD_WIDTH / r : BOARD_HEIGHT
  return { x: (BOARD_WIDTH - w) / 2, y: (BOARD_HEIGHT - h) / 2, w, h }
}

export function ExportGuideFrame({ guide }: { guide: Exclude<ExportGuide, 'off'> }) {
  const { x, y, w, h } = exportGuideRect(guide)
  const inset = x > 0.5 || y > 0.5 // 4:3 fills the board → nothing to dim
  return (
    <g pointerEvents="none">
      {/* Dim the cropped-out surround (evenodd: whole board minus the frame). */}
      {inset && (
        <path
          d={`M0,0 H${BOARD_WIDTH} V${BOARD_HEIGHT} H0 Z M${x},${y} H${x + w} V${y + h} H${x} Z`}
          fillRule="evenodd"
          fill="#000000"
          opacity={0.28}
        />
      )}
      {/* Border: a white + offset-black dashed pair → "marching ants" readable on
          any pitch colour. non-scaling-stroke keeps it thin at any zoom. */}
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="9 6" vectorEffect="non-scaling-stroke" opacity={0.95} />
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#000000" strokeWidth={1.5} strokeDasharray="9 6" strokeDashoffset={9} vectorEffect="non-scaling-stroke" opacity={0.55} />
      {/* Ratio label, top-left inside the frame, with a dark halo. */}
      <text x={x + 8} y={y + 20} fontSize={16} fontWeight={600} fill="#ffffff" stroke="#000000" strokeWidth={3} paintOrder="stroke" style={{ fontFamily: 'system-ui, sans-serif' }}>
        {guide}
      </text>
    </g>
  )
}

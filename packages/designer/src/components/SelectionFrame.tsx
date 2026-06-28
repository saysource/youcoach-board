import type { Box } from '@youcoach-board/core'

// Scoped CSS variable defined on .ycb-root (see board.css).
const FRAME = 'var(--color-selection-frame)'
// Desired ON-SCREEN sizes (px). Converted to board units via `scale` so the
// chrome stays a constant size no matter how the board is fit/zoomed.
const PAD_PX = 5 // gap between the figure and its frame
const HANDLE_PX = 8
const STROKE_PX = 1.5

// The selection frame around a figure's bounding box. Phase 2: purely
// indicative — the corner handles are drawn but not yet draggable. Rendered in
// the overlay layer, so it never appears in exports.
//
// `scale` is screen-pixels-per-board-unit: sizes divide by it, and strokes use
// `vector-effect: non-scaling-stroke`, so the frame never scales with the board.
export function SelectionFrame({ box, scale }: { box: Box; scale: number }) {
  const pad = PAD_PX / scale
  const handle = HANDLE_PX / scale
  const x = box.x - pad
  const y = box.y - pad
  const w = box.width + pad * 2
  const h = box.height + pad * 2
  const corners: Array<[number, number]> = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]

  return (
    <g pointerEvents="none">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke={FRAME}
        strokeWidth={STROKE_PX}
        vectorEffect="non-scaling-stroke"
      />
      {corners.map(([cx, cy], i) => (
        <rect
          key={i}
          x={cx - handle / 2}
          y={cy - handle / 2}
          width={handle}
          height={handle}
          rx={handle / 4}
          ry={handle / 4}
          fill="#ffffff"
          fillOpacity={0.8}
          stroke={FRAME}
          strokeWidth={STROKE_PX}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  )
}

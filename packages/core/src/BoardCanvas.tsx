import { useId, type ReactNode, type Ref } from 'react'
import type { BoardDoc } from './model'
import { BOARD_WIDTH, BOARD_HEIGHT } from './geometry'
import { FieldBackground } from './FieldBackground'

// Canvas border thickness in board units (scales with the board; inset by half
// so the whole stroke stays inside the viewBox).
const BORDER_W = 2

export interface BoardCanvasProps {
  doc: BoardDoc
  /** Optional class hook for hosts that want to style the wrapper. */
  className?: string
  /** Ref to the underlying <svg> — the editor uses it for screen↔board
   *  coordinate conversion (getScreenCTM). */
  svgRef?: Ref<SVGSVGElement>
  /**
   * Content for the elements layer (figures, shapes, text). The editor injects
   * the document's rendered elements here; the read-only viewer injects the
   * document's static elements.
   */
  children?: ReactNode
  /**
   * Content for the overlay layer (selection handles, marquee, snap guides,
   * the in-progress draft figure). Kept above the elements so it never
   * participates in export of the artwork.
   */
  overlay?: ReactNode
  /**
   * Content for the background layer (solid color, field SVG, logo). The designer
   * injects a live, recolorable background here; when omitted, a default pitch is
   * drawn (used by the viewer/exporter until they provide their own).
   */
  background?: ReactNode
  /**
   * Override the SVG viewBox (`minX minY width height`) for zoom/pan. Defaults to
   * the full board `0 0 BOARD_WIDTH BOARD_HEIGHT`. Coordinate conversion via
   * getScreenCTM stays correct automatically.
   */
  viewBox?: string
}

// The single shared 2D render primitive — the SVG board layer that the viewer,
// the designer and (rasterized) the exporter all render through.
//
// The board is a fixed 4:3 user-space (see geometry.ts) mapped onto whatever
// pixel box the host provides via `viewBox` + `preserveAspectRatio` (default
// xMidYMid meet → the board scales to fit and stays centered, letterboxing
// against the host background). Content is organized into three stacked layers
// so later phases have stable, well-named insertion points:
//
//   background → the field (and, later, configurable backgrounds)
//   elements   → the document's figures/shapes/text (the exported artwork)
//   overlay    → editing chrome that must NOT appear in exports
//
// The 3D Arrow layer (three.js / WebGL) is a *separate* canvas the editor
// stacks over this SVG; it is intentionally not part of this primitive.
//
// Kept export-safe: no <foreignObject>, no external references, self-contained
// styles — so a serialize → rasterize pass reproduces it faithfully.
export function BoardCanvas({ doc, className, svgRef, children, overlay, background, viewBox }: BoardCanvasProps) {
  const label = doc.title.trim() || 'Untitled board'
  // Unique per instance so multiple embedded boards don't share a clip id.
  const clipId = `ycb-canvas-clip-${useId()}`
  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox={viewBox ?? `0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
      role="img"
      aria-label={label}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} />
        </clipPath>
      </defs>
      {/* Clipped to the 4:3 canvas so a scaled/panned field SVG (or logo) never
          draws past the board edges. */}
      <g data-layer="background" clipPath={`url(#${clipId})`}>
        {background ?? <FieldBackground image={doc.background.image} />}
      </g>
      {/* Elements are clipped to the canvas so figures never draw past its edge
          (overflow when moved/resized is hidden). The overlay is NOT clipped, so
          selection frames/handles can still extend beyond the board. */}
      <g data-layer="elements" clipPath={`url(#${clipId})`}>
        {children}
      </g>
      {/* Canvas boundary marker: square (not rounded), subtle. currentColor
          adapts to the host theme (dark-on-light, light-on-dark). Inset by half
          the stroke width so the whole stroke stays INSIDE the viewBox —
          otherwise the right/bottom edges fall on the boundary and get clipped. */}
      <rect
        data-canvas-border
        x={BORDER_W / 2}
        y={BORDER_W / 2}
        width={BOARD_WIDTH - BORDER_W}
        height={BOARD_HEIGHT - BORDER_W}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.18}
        strokeWidth={BORDER_W}
        pointerEvents="none"
      />
      <g data-layer="overlay">{overlay}</g>
    </svg>
  )
}

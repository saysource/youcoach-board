import { Rotate3d, RectangleHorizontal, RectangleVertical, MapPin, ZoomIn, ZoomOut, Hand } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '../lib/cn'

interface NavBarProps {
  /** Only shown when the drawing has a 3D field to navigate. */
  available: boolean
  navigating: boolean
  /** Toggle navigation mode (also the W shortcut). */
  onToggle: () => void
  /** Rotate the field to a straight-down top view, pitch length horizontal / vertical. */
  onTopViewH: () => void
  onTopViewV: () => void
  /** Whether the numbered position markers are shown (off by default). */
  markers: boolean
  onToggleMarkers: () => void
  /** 2D (no 3D field): show the flat zoom/pan controls instead of orbit. */
  flat?: boolean
  /** Current 2D zoom (1 = whole board) — disables zoom-out/hand at the floor. */
  zoom?: number
  onZoomIn?: () => void
  onZoomOut?: () => void
  /** Reset the zoom to 100% (click the percentage readout). */
  onResetZoom?: () => void
  /** The pan hand tool (drag the board to scroll the zoomed view). */
  panning?: boolean
  onTogglePan?: () => void
}

// Orbit-navigation control: a toggle to enter/leave a free-orbit "navigation mode"
// (same controls as Edit Background), plus quick horizontal/vertical top-view
// shortcuts. Navigation orbits the field's pose directly — it IS the drawing's pose,
// stored in the JSON — so there's no separate "temporary" view to save or reset.
export function NavBar({ available, navigating, onToggle, onTopViewH, onTopViewV, markers, onToggleMarkers, flat = false, zoom = 1, onZoomIn, onZoomOut, onResetZoom, panning = false, onTogglePan }: NavBarProps) {
  // 2D mode: no orbit — the same spot offers flat zoom (+/− keys too) and the
  // pan hand (⇧+arrows also scroll).
  if (!available && flat) {
    return (
      <div className="pointer-events-auto flex items-center rounded-lg border border-border bg-card shadow-md">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" aria-label="Zoom out (−)" disabled={zoom <= 0.1} onClick={onZoomOut}>
              <ZoomOut />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out (−)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" aria-label="Reset zoom (100%)" onClick={onResetZoom} className="w-11 shrink-0 px-0 text-xs tabular-nums font-medium">
              {Math.round(zoom * 100)}%
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset zoom (100%)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" aria-label="Zoom in (+)" disabled={zoom >= 8} onClick={onZoomIn}>
              <ZoomIn />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in (+)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" aria-label={panning ? 'Exit pan (drag scrolls the view)' : 'Pan the view (or ⇧+arrows)'} aria-pressed={panning} disabled={zoom <= 1 && !panning} onClick={onTogglePan} className={cn(panning && 'text-primary')}>
              <Hand />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{panning ? 'Exit pan' : 'Pan the view (⇧+arrows)'}</TooltipContent>
        </Tooltip>
      </div>
    )
  }
  if (!available) return null
  return (
    <div className="pointer-events-auto flex items-center rounded-lg border border-border bg-card shadow-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label={navigating ? 'Exit navigation (Space)' : 'Navigate scene (Space)'} aria-pressed={navigating} onClick={onToggle} className={cn(navigating && 'text-primary')}>
            <Rotate3d />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{navigating ? 'Exit navigation (Space)' : 'Navigate scene (Space)'}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Top view (horizontal)" onClick={onTopViewH}>
            <RectangleHorizontal />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Top view — horizontal</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Top view (vertical)" onClick={onTopViewV}>
            <RectangleVertical />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Top view — vertical</TooltipContent>
      </Tooltip>
      {navigating && (
        <>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" aria-label={markers ? 'Hide position markers' : 'Show position markers'} aria-pressed={markers} onClick={onToggleMarkers} className={cn(markers && 'text-primary')}>
                <MapPin />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{markers ? 'Hide position markers' : 'Show position markers'}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  )
}

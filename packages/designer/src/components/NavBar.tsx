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
  /** 3D mode: Edit-Background is active — the orbit toggle is hidden (the editor
   *  already orbits) but zoom/pan/top-view stay. */
  editingBg?: boolean
  /** 3D mode: dolly the field camera one step in/out (also the +/− keys). */
  onZoom3d?: (dir: 1 | -1) => void
  /** 3D mode: the pan hand (drag pans instead of orbiting) — only meaningful
   *  while orbiting (navigation / Edit Background). */
  pan3d?: boolean
  onTogglePan3d?: () => void
  showPan3d?: boolean
}

// Orbit-navigation control: a toggle to enter/leave a free-orbit "navigation mode"
// (same controls as Edit Background), plus quick horizontal/vertical top-view
// shortcuts. Navigation orbits the field's pose directly — it IS the drawing's pose,
// stored in the JSON — so there's no separate "temporary" view to save or reset.
export function NavBar({ available, navigating, onToggle, onTopViewH, onTopViewV, markers, onToggleMarkers, flat = false, zoom = 1, onZoomIn, onZoomOut, onResetZoom, panning = false, onTogglePan, editingBg = false, onZoom3d, pan3d = false, onTogglePan3d, showPan3d = false }: NavBarProps) {
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
            <Button size="icon-sm" aria-label={panning ? 'Exit pan (drag scrolls the view)' : 'Pan the view (or ⇧+arrows)'} aria-pressed={panning} disabled={zoom <= 1 && !panning} onClick={onTogglePan} className={cn('hover:bg-primary/25', panning && 'bg-primary/40 hover:bg-primary/40')}>
              <Hand />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{panning ? 'Exit pan' : 'Pan the view (⇧+arrows)'}</TooltipContent>
        </Tooltip>
      </div>
    )
  }
  if (!available) return null
  // Orbit / pan are an exclusive pair while an orbit session is up (navigation or
  // Edit Background): exactly one shows the main-toolbar active style, so the
  // current drag behavior is always visible at a glance.
  const inOrbitSession = navigating || editingBg
  const orbitActive = inOrbitSession && !pan3d
  const orbitLabel = !inOrbitSession ? 'Navigate scene (Space)' : pan3d ? 'Orbit (drag rotates)' : editingBg ? 'Orbit — drag rotates the view' : 'Exit navigation (Space)'
  return (
    <div className="pointer-events-auto flex items-center rounded-lg border border-border bg-card shadow-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            aria-label={orbitLabel}
            aria-pressed={orbitActive}
            onClick={() => {
              if (pan3d) onTogglePan3d?.()
              else if (!editingBg) onToggle()
            }}
            className={cn('hover:bg-primary/25', orbitActive && 'bg-primary/40 hover:bg-primary/40')}
          >
            <Rotate3d />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{orbitLabel}</TooltipContent>
      </Tooltip>
      {/* Field-camera zoom (dolly), same as the +/− keys. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Zoom in (+)" onClick={() => onZoom3d?.(1)}>
            <ZoomIn />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom in (+)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Zoom out (−)" onClick={() => onZoom3d?.(-1)}>
            <ZoomOut />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom out (−)</TooltipContent>
      </Tooltip>
      {/* Pan hand: while orbiting (navigation / Edit Background), a plain drag
          pans the camera instead of rotating it. */}
      {showPan3d && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" aria-label={pan3d ? 'Exit pan (drag orbits again)' : 'Pan the view (drag pans)'} aria-pressed={pan3d} onClick={onTogglePan3d} className={cn('hover:bg-primary/25', pan3d && 'bg-primary/40 hover:bg-primary/40')}>
              <Hand />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{pan3d ? 'Exit pan' : 'Pan the view'}</TooltipContent>
        </Tooltip>
      )}
      <span className="mx-0.5 h-5 w-px bg-border" />
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

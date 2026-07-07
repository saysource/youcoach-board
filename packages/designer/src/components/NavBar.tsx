import { Rotate3d, RectangleHorizontal, RectangleVertical, MapPin } from 'lucide-react'
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
}

// Orbit-navigation control: a toggle to enter/leave a free-orbit "navigation mode"
// (same controls as Edit Background), plus quick horizontal/vertical top-view
// shortcuts. Navigation orbits the field's pose directly — it IS the drawing's pose,
// stored in the JSON — so there's no separate "temporary" view to save or reset.
export function NavBar({ available, navigating, onToggle, onTopViewH, onTopViewV, markers, onToggleMarkers }: NavBarProps) {
  if (!available) return null
  return (
    <div className="pointer-events-auto flex items-center rounded-lg border border-border bg-card shadow-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label={navigating ? 'Exit navigation (W)' : 'Navigate scene (W)'} aria-pressed={navigating} onClick={onToggle} className={cn(navigating && 'text-primary')}>
            <Rotate3d />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{navigating ? 'Exit navigation (W)' : 'Navigate scene (W)'}</TooltipContent>
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

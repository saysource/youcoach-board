import { Orbit, RotateCcw, Save, MapPin, Grid2x2 } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '../lib/cn'

interface NavBarProps {
  /** Only shown when the drawing has a 3D field to navigate. */
  available: boolean
  navigating: boolean
  /** Toggle navigation mode (also the W shortcut). */
  onToggle: () => void
  /** Restore the drawing's saved pose (the one set in Edit Background). */
  onReset: () => void
  /** Store the current navigated pose as the drawing's default. */
  onStore: () => void
  /** Whether the numbered position markers are shown (off by default). */
  markers: boolean
  onToggleMarkers: () => void
  /** Snap the view straight down to a top view of the field. */
  onTopView: () => void
}

// Orbit-navigation control: a toggle to enter/leave a free-orbit "navigation mode"
// (same controls as Edit Background) that changes the VIEW without touching the
// drawing's saved pose. While navigating, a Reset (restore saved pose) and Store
// (save this pose as the default) appear alongside.
export function NavBar({ available, navigating, onToggle, onReset, onStore, markers, onToggleMarkers, onTopView }: NavBarProps) {
  if (!available) return null
  return (
    <div className="pointer-events-auto flex items-center rounded-lg border border-border bg-card shadow-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label={navigating ? 'Exit navigation (W)' : 'Navigate scene (W)'} aria-pressed={navigating} onClick={onToggle} className={cn(navigating && 'text-primary')}>
            <Orbit />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{navigating ? 'Exit navigation (W)' : 'Navigate scene (W)'}</TooltipContent>
      </Tooltip>
      {navigating && (
        <>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" aria-label="Top view" onClick={onTopView}>
                <Grid2x2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Top view</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" aria-label={markers ? 'Hide position markers' : 'Show position markers'} aria-pressed={markers} onClick={onToggleMarkers} className={cn(markers && 'text-primary')}>
                <MapPin />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{markers ? 'Hide position markers' : 'Show position markers'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" aria-label="Reset to saved pose" onClick={onReset}>
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to the drawing's pose</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" aria-label="Store as drawing pose" onClick={onStore}>
                <Save />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Store as the drawing's pose</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  )
}

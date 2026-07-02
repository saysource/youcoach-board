import { Minus, Plus } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { useEditorStore } from '../store/context'

// Bottom-left zoom control: −/+ zoom about center, and the percentage resets to
// 100% on click. Mirrors the ⌘±/⌘0 shortcuts.
export function ZoomBar() {
  const zoom = useEditorStore((s) => s.viewport.zoom)
  const zoomIn = useEditorStore((s) => s.zoomIn)
  const zoomOut = useEditorStore((s) => s.zoomOut)
  const zoomReset = useEditorStore((s) => s.zoomReset)
  return (
    <div className="pointer-events-auto flex items-center rounded-lg border border-border bg-card shadow-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Zoom out" onClick={zoomOut} disabled={zoom <= 1}>
            <Minus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Reset zoom"
            onClick={zoomReset}
            className="w-12 select-none text-center text-xs tabular-nums text-muted-foreground hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
        </TooltipTrigger>
        <TooltipContent>Reset zoom</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Zoom in" onClick={zoomIn} disabled={zoom >= 8}>
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom in</TooltipContent>
      </Tooltip>
    </div>
  )
}

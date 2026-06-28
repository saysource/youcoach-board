import { Minus, Plus } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

// Bottom-left zoom control. Phase 1: inert — fixed at 100%.
export function ZoomBar() {
  return (
    <div className="pointer-events-auto flex items-center rounded-lg border border-border bg-card shadow-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Zoom out" disabled>
            <Minus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>
      <span className="w-12 select-none text-center text-xs tabular-nums text-muted-foreground">100%</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Zoom in" disabled>
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom in</TooltipContent>
      </Tooltip>
    </div>
  )
}

import { Sparkles, Maximize, Minimize, PanelRight } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '../lib/cn'

interface TopRightControlsProps {
  fullscreen: boolean
  onToggleFullscreen: () => void
  drawerOpen: boolean
  onToggleDrawer: () => void
}

export function TopRightControls({
  fullscreen,
  onToggleFullscreen,
  drawerOpen,
  onToggleDrawer,
}: TopRightControlsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <IconControl label="AI tools" disabled>
        <Sparkles />
      </IconControl>
      {/* The one operational control in Phase 1: expand to fill the viewport. */}
      <IconControl
        label={fullscreen ? 'Exit full view' : 'Fill the viewport'}
        onClick={onToggleFullscreen}
        active={fullscreen}
      >
        {fullscreen ? <Minimize /> : <Maximize />}
      </IconControl>
      <IconControl label="Library" onClick={onToggleDrawer} active={drawerOpen}>
        <PanelRight />
      </IconControl>
    </div>
  )
}

interface IconControlProps {
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}

function IconControl({ label, onClick, active, disabled, children }: IconControlProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn('bg-card shadow-md', active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground')}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

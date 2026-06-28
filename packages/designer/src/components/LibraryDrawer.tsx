import { Search, X, LibraryBig, Sparkles, Maximize, Minimize, Pin, PinOff, type LucideIcon } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '../lib/cn'

interface LibraryDrawerProps {
  open: boolean
  onClose: () => void
  /** Docked = a real sidebar that the board refits around; otherwise it overlays. */
  pinned: boolean
  onTogglePin: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
}

// Right-side figures library. When open it hosts the controls that otherwise
// live top-right (AI, fill-viewport), plus a pin (dock/undock) and a close
// button. Content is still a placeholder until the figures palette lands.
export function LibraryDrawer({ open, onClose, pinned, onTogglePin, fullscreen, onToggleFullscreen }: LibraryDrawerProps) {
  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-72 flex-col border-l border-border bg-card transition-transform duration-200',
        pinned ? 'shadow-none' : 'shadow-xl',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="flex items-center justify-between gap-1 border-b border-border p-2 pl-3">
        <span className="text-sm font-semibold">Library</span>
        <div className="flex items-center gap-0.5">
          <HeaderButton icon={Sparkles} label="AI tools" disabled />
          <HeaderButton
            icon={fullscreen ? Minimize : Maximize}
            label={fullscreen ? 'Exit full view' : 'Fill the viewport'}
            active={fullscreen}
            onClick={onToggleFullscreen}
          />
          <HeaderButton
            icon={pinned ? PinOff : Pin}
            label={pinned ? 'Undock' : 'Dock as sidebar'}
            active={pinned}
            onClick={onTogglePin}
          />
          <HeaderButton icon={X} label="Close library" onClick={onClose} />
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-muted-foreground">
          <Search className="size-4" />
          <input
            type="text"
            placeholder="Search library"
            disabled
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <LibraryBig className="size-8 opacity-50" />
        <p className="text-sm">No figures yet</p>
        <p className="text-xs">Players, materials and fields will appear here.</p>
      </div>
    </aside>
  )
}

function HeaderButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground')}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

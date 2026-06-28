import { type ElementType } from 'react'
import {
  Lock,
  Hand,
  MousePointer2,
  Square,
  MoveRight,
  Minus,
  Pencil,
  Type,
  Image,
  Eraser,
  Shapes,
  Waypoints,
} from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { Separator } from './ui/separator'
import { cn } from '../lib/cn'

export type ToolId =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'ellipse'
  | 'polyline'
  | 'arrow'
  | 'line'
  | 'draw'
  | 'text'
  | 'image'
  | 'eraser'
  | 'more'

interface Tool {
  id: ToolId
  label: string
  /** Lucide icon or a custom SVG icon component. */
  icon: ElementType
  /** Number badge shown bottom-right, mirroring Excalidraw's keyboard hints. */
  shortcut?: number
}

// The selectable tools, in toolbar order (the lock toggle is rendered
// separately, ahead of these). Only rectangle / polyline / line create figures
// so far; the rest are placeholders.
const TOOLS: Tool[] = [
  { id: 'hand', label: 'Pan', icon: Hand },
  { id: 'select', label: 'Selection', icon: MousePointer2, shortcut: 1 },
  { id: 'rectangle', label: 'Rectangle', icon: Square, shortcut: 2 },
  { id: 'polyline', label: 'Polyline', icon: Waypoints, shortcut: 3 },
  { id: 'arrow', label: 'Arrow', icon: MoveRight, shortcut: 4 },
  { id: 'line', label: 'Line', icon: Minus, shortcut: 5 },
  { id: 'draw', label: 'Draw', icon: Pencil, shortcut: 6 },
  { id: 'text', label: 'Text', icon: Type, shortcut: 7 },
  { id: 'image', label: 'Image', icon: Image, shortcut: 8 },
  { id: 'eraser', label: 'Eraser', icon: Eraser, shortcut: 9 },
  { id: 'more', label: 'More tools', icon: Shapes },
]

interface ToolbarProps {
  activeTool: ToolId
  onToolChange: (tool: ToolId) => void
  locked: boolean
  onToggleLock: () => void
}

export function Toolbar({ activeTool, onToolChange, locked, onToggleLock }: ToolbarProps) {
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg">
      <ToolButton label={locked ? 'Unlock' : 'Keep selected tool active'} active={locked} onClick={onToggleLock}>
        <Lock />
      </ToolButton>
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      {TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          label={tool.label}
          active={activeTool === tool.id}
          shortcut={tool.shortcut}
          onClick={() => onToolChange(tool.id)}
        >
          <tool.icon />
        </ToolButton>
      ))}
    </div>
  )
}

interface ToolButtonProps {
  label: string
  active?: boolean
  shortcut?: number
  onClick: () => void
  children: React.ReactNode
}

function ToolButton({ label, active, shortcut, onClick, children }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn('relative hover:bg-primary/25', active && 'bg-primary/40 hover:bg-primary/40')}
        >
          {children}
          {shortcut !== undefined && (
            <span
              className={cn(
                'pointer-events-none absolute bottom-0.5 right-1 text-[9px] leading-none',
                active ? 'text-foreground/50' : 'text-foreground/50',
              )}
            >
              {shortcut}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

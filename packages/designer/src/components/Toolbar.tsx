import { type ElementType } from 'react'
import { Lock, Hand, MousePointer2, Square, MoveRight, Minus, Pencil, Eraser, Shapes } from 'lucide-react'
import { PlayersIcon, TrainingIcon, ShapesIcon, DiscsIcon, SoccerFieldIcon } from './icons'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { Separator } from './ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { cn } from '../lib/cn'

export type ToolId =
  | 'select'
  | 'hand'
  | 'rectangle'
  // 'ellipse' is a supported creation tool (see toolElementType) but not
  // currently exposed as its own toolbar button.
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'draw'
  | 'eraser'

interface Tool {
  id: ToolId
  label: string
  /** Lucide icon or a custom SVG icon component. */
  icon: ElementType
  /** Number badge shown bottom-right, mirroring Excalidraw's keyboard hints. */
  shortcut?: number
  /** Render a separator before this tool (group boundary). */
  groupStart?: boolean
}

// The figure tools, in toolbar order (the lock toggle, the More-tools menu and
// the eraser are rendered separately, around these). Only rectangle / arrow /
// line create figures so far; the rest are inert placeholders. The arrow and
// line tools draw a straight line on drag, or a multi-point polyline on click
// (arrow = end-tipped). A separator brackets the figure tools (after Selection).
const TOOLS: Tool[] = [
  { id: 'hand', label: 'Pan', icon: Hand },
  { id: 'select', label: 'Selection', icon: MousePointer2, shortcut: 1 },
  { id: 'rectangle', label: 'Rectangle', icon: Square, shortcut: 2, groupStart: true },
  { id: 'arrow', label: 'Arrow', icon: MoveRight, shortcut: 3 },
  { id: 'line', label: 'Line', icon: Minus, shortcut: 4 },
  { id: 'draw', label: 'Draw', icon: Pencil, shortcut: 5 },
]

interface ToolbarProps {
  activeTool: ToolId
  onToolChange: (tool: ToolId) => void
  locked: boolean
  onToggleLock: () => void
}

export function Toolbar({ activeTool, onToolChange, locked, onToggleLock }: ToolbarProps) {
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-card py-0.5 px-1 shadow-md">
      <ToolButton label={locked ? 'Unlock' : 'Keep selected tool active'} active={locked} onClick={onToggleLock}>
        <Lock />
      </ToolButton>
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      {TOOLS.map((tool) => (
        <div key={tool.id} className="flex items-center gap-1">
          {tool.groupStart && <Separator orientation="vertical" className="mx-0.5 h-6" />}
          <ToolButton
            label={tool.label}
            active={activeTool === tool.id}
            shortcut={tool.shortcut}
            onClick={() => onToolChange(tool.id)}
          >
            <tool.icon />
          </ToolButton>
        </div>
      ))}
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <MoreToolsMenu />
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <ToolButton label="Eraser" active={activeTool === 'eraser'} onClick={() => onToolChange('eraser')}>
        <Eraser />
      </ToolButton>
    </div>
  )
}

// The figure-library shortcut: a dropdown of element categories. Every item is
// an inert placeholder for now (no creation wired up yet).
function MoreToolsMenu() {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" aria-label="More tools" className="hover:bg-primary/25">
              <Shapes />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More tools</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem disabled>
          <PlayersIcon /> Players
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <TrainingIcon /> Materials
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <ShapesIcon /> Shapes
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <MoveRight /> Arrows
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <DiscsIcon /> Discs
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <SoccerFieldIcon /> Background
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ToolButtonProps {
  label: string
  active?: boolean
  shortcut?: number
  onClick: () => void
  children: React.ReactNode
}

function ToolButton({ label, active, onClick, children }: ToolButtonProps) {
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
          {/* {shortcut !== undefined && (
            <span
              className={cn(
                'pointer-events-none absolute bottom-0.5 right-1 text-[9px] leading-none',
                active ? 'text-foreground/50' : 'text-foreground/50',
              )}
            >
              {shortcut}
            </span>
          )} */}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

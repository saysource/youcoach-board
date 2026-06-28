import { type ElementType } from 'react'
import { Lock, Hand, MousePointer2, Square, MoveRight, Minus, Pencil, Eraser, Shapes, Type } from 'lucide-react'
import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { PlayersIcon, TrainingIcon, SoccerFieldIcon, MatchIcon } from './icons'
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
import { useAssets, buildFigureElement } from '../lib/assets'
import { useEditorStore } from '../store/context'

// Icon per catalog macro-group, for the More-tools menu.
const GROUP_ICON: Record<string, ElementType> = { players: PlayersIcon, materials: TrainingIcon, fields: SoccerFieldIcon }

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
  /** Open the library drawer at a category (from the More-tools menu). */
  onOpenCategory: (catId: string) => void
}

export function Toolbar({ activeTool, onToolChange, locked, onToggleLock, onOpenCategory }: ToolbarProps) {
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
      <MoreToolsMenu onOpenCategory={onOpenCategory} />
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <ToolButton label="Eraser" active={activeTool === 'eraser'} onClick={() => onToolChange('eraser')}>
        <Eraser />
      </ToolButton>
    </div>
  )
}

// The figure-library shortcut: the catalog's macro-groups jump the drawer to a
// category; below, quick "add" actions. ("Fields and Background" shows as
// "Background" — it'll later open a background-settings mode.)
function MoreToolsMenu({ onOpenCategory }: { onOpenCategory: (catId: string) => void }) {
  const { catalog } = useAssets()
  const createFigure = useEditorStore((s) => s.createFigure)
  // The ball = the first material with the "balls" action; flagged so animation
  // can special-case it later.
  const ball = catalog?.categories.materials?.figures.find((f) => f.svg && (f.actions ?? []).includes('material.balls'))

  function addBall() {
    if (!catalog || !ball?.svg) return
    const colors = { ...(catalog.defaults.materials ?? {}) }
    createFigure(buildFigureElement({ figureId: ball.svg, w: ball.w, h: ball.h, mirror: false, colors, ball: true }, BOARD_WIDTH / 2, BOARD_HEIGHT / 2))
  }

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
        {/* Figure macro-groups jump the drawer to a category. Fields are handled
            by "Edit Background" below. */}
        {catalog?.groups
          .filter((g) => g.id !== 'fields')
          .map((g) => {
            const Icon = GROUP_ICON[g.id] ?? Shapes
            const firstCat = g.categories[0]
            return (
              <DropdownMenuItem key={g.id} disabled={!firstCat} onSelect={() => firstCat && onOpenCategory(firstCat)}>
                <Icon /> {g.name}
              </DropdownMenuItem>
            )
          })}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!ball} onSelect={addBall}>
          <MatchIcon /> Add Ball
        </DropdownMenuItem>
        {/* Text element not implemented yet — placeholder. */}
        <DropdownMenuItem disabled>
          <Type /> Add Text
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Opens the All Fields category (and, later, a background-settings mode). */}
        <DropdownMenuItem disabled={!catalog?.categories.fields_all} onSelect={() => onOpenCategory('fields_all')}>
          <SoccerFieldIcon /> Edit Background
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

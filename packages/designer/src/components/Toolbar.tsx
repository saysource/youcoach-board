import { type ElementType, useState } from 'react'
import { Lock, Hand, MousePointer2, Square, Circle, Diamond, Pentagon, Triangle, MoveRight, Minus, Pencil, Eraser, Shapes, Type } from 'lucide-react'
import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { PlayersIcon, TrainingIcon, SoccerFieldIcon, MatchIcon, ShapesIcon, TrapezoidIcon, LinesIcon, ElbowLineIcon, ElbowArrowIcon } from './icons'
import { isShapeTool, isLineTool, type ShapeTool, type LineTool } from '../lib/draw'
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
  // The box-shape tools live behind the Shapes menu (see ShapesMenu / draw.ts
  // SHAPE_TOOLS), not as individual toolbar buttons.
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'pentagon'
  | 'triangle'
  | 'trapezoid'
  // The line/arrow tools live behind the Lines menu (see LinesMenu / draw.ts
  // LINE_TOOLS). Elbow = smooth (curved); the others are straight.
  | 'arrow'
  | 'line'
  | 'elbow-arrow'
  | 'elbow-line'
  | 'draw'
  | 'eraser'

// Shapes-menu entries (order shown in the dropdown). The first is the default.
const SHAPE_ITEMS: { id: ShapeTool; label: string; icon: ElementType }[] = [
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'diamond', label: 'Diamond', icon: Diamond },
  { id: 'pentagon', label: 'Pentagon', icon: Pentagon },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'trapezoid', label: 'Trapezoid', icon: TrapezoidIcon },
]
const SHAPE_ICON: Record<ShapeTool, ElementType> = Object.fromEntries(SHAPE_ITEMS.map((s) => [s.id, s.icon])) as Record<ShapeTool, ElementType>

// Lines-menu entries (order shown in the dropdown). The first is the default.
const LINE_ITEMS: { id: LineTool; label: string; icon: ElementType }[] = [
  { id: 'arrow', label: 'Arrow', icon: MoveRight },
  { id: 'line', label: 'Line', icon: Minus },
  { id: 'elbow-arrow', label: 'Elbow arrow', icon: ElbowArrowIcon },
  { id: 'elbow-line', label: 'Elbow line', icon: ElbowLineIcon },
]
const LINE_ICON: Record<LineTool, ElementType> = Object.fromEntries(LINE_ITEMS.map((s) => [s.id, s.icon])) as Record<LineTool, ElementType>

interface Tool {
  id: ToolId
  label: string
  /** Lucide icon or a custom SVG icon component. */
  icon: ElementType
  /** Number badge shown bottom-right, mirroring Excalidraw's keyboard hints. */
  shortcut?: number
}

// Navigation tools, rendered before the Shapes menu.
const NAV_TOOLS: Tool[] = [
  { id: 'hand', label: 'Pan', icon: Hand },
  { id: 'select', label: 'Selection', icon: MousePointer2, shortcut: 1 },
]

// Free-draw tool, rendered after the Shapes + Lines menus (same group). Box
// shapes are behind the Shapes menu; lines/arrows behind the Lines menu.
const DRAW_TOOLS: Tool[] = [{ id: 'draw', label: 'Draw', icon: Pencil, shortcut: 5 }]

interface ToolbarProps {
  activeTool: ToolId
  onToolChange: (tool: ToolId) => void
  locked: boolean
  onToggleLock: () => void
  /** Open the library drawer at a category (from the More-tools menu). */
  onOpenCategory: (catId: string) => void
}

export function Toolbar({ activeTool, onToolChange, locked, onToggleLock, onOpenCategory }: ToolbarProps) {
  // The shape last picked/used, so the Shapes button shows it and re-opening the
  // menu re-activates it. Null until the first use (button shows the generic icon).
  const [lastShape, setLastShape] = useState<ShapeTool | null>(null)
  function pickShape(tool: ShapeTool) {
    setLastShape(tool)
    onToolChange(tool)
  }
  const [lastLine, setLastLine] = useState<LineTool | null>(null)
  function pickLine(tool: LineTool) {
    setLastLine(tool)
    onToolChange(tool)
  }
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-card py-0.5 px-1 shadow-md">
      <ToolButton label={locked ? 'Unlock' : 'Keep selected tool active'} active={locked} onClick={onToggleLock}>
        <Lock />
      </ToolButton>
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      {NAV_TOOLS.map((tool) => (
        <ToolButton key={tool.id} label={tool.label} active={activeTool === tool.id} shortcut={tool.shortcut} onClick={() => onToolChange(tool.id)}>
          <tool.icon />
        </ToolButton>
      ))}
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <ShapesMenu activeTool={activeTool} lastShape={lastShape} onPick={pickShape} />
      <LinesMenu activeTool={activeTool} lastLine={lastLine} onPick={pickLine} />
      {DRAW_TOOLS.map((tool) => (
        <ToolButton key={tool.id} label={tool.label} active={activeTool === tool.id} shortcut={tool.shortcut} onClick={() => onToolChange(tool.id)}>
          <tool.icon />
        </ToolButton>
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

// The Shapes menu: a toolbar button whose icon is the active/last-used shape (or
// the generic Shapes glyph before any is used). Opening it auto-activates the
// last-used shape (default Rectangle) so the user can draw immediately; picking
// an item switches to that shape. Clicking outside closes it (Radix default).
function ShapesMenu({
  activeTool,
  lastShape,
  onPick,
}: {
  activeTool: ToolId
  lastShape: ShapeTool | null
  onPick: (tool: ShapeTool) => void
}) {
  const active = isShapeTool(activeTool)
  const current = active ? activeTool : lastShape
  const Icon = current ? SHAPE_ICON[current] : ShapesIcon
  return (
    <DropdownMenu onOpenChange={(open) => open && onPick(lastShape ?? 'rectangle')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              aria-label="Shapes"
              aria-pressed={active}
              className={cn('relative hover:bg-primary/25', active && 'bg-primary/40 hover:bg-primary/40')}
            >
              <Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Shapes</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-40">
        {SHAPE_ITEMS.map((it) => (
          <DropdownMenuItem key={it.id} onSelect={() => onPick(it.id)}>
            <it.icon /> {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The Lines menu: same pattern as ShapesMenu, for the line/arrow tools (Arrow,
// Line, Elbow arrow, Elbow line). Default icon is the generic Lines glyph; the
// trigger shows the active/last-used line tool's icon.
function LinesMenu({
  activeTool,
  lastLine,
  onPick,
}: {
  activeTool: ToolId
  lastLine: LineTool | null
  onPick: (tool: LineTool) => void
}) {
  const active = isLineTool(activeTool)
  const current = active ? activeTool : lastLine
  const Icon = current ? LINE_ICON[current] : LinesIcon
  return (
    <DropdownMenu onOpenChange={(open) => open && onPick(lastLine ?? 'arrow')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              aria-label="Lines"
              aria-pressed={active}
              className={cn('relative hover:bg-primary/25', active && 'bg-primary/40 hover:bg-primary/40')}
            >
              <Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Lines</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-40">
        {LINE_ITEMS.map((it) => (
          <DropdownMenuItem key={it.id} onSelect={() => onPick(it.id)}>
            <it.icon /> {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

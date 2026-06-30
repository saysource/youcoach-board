import { type ComponentType, type ReactNode } from 'react'
import {
  SlidersHorizontal,
  MoreHorizontal,
  CopyPlus,
  FlipHorizontal2,
  ClipboardCopy,
  ClipboardPaste,
  BringToFront,
  SendToBack,
  ArrowUp,
  ArrowDown,
  Trash2,
  Copy,
  Undo2,
  Redo2,
  Minus,
  Spline,
  MoveRight,
  SquareDashedBottom,
} from 'lucide-react'
import { type ArrowTip } from '@youcoach-board/core'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { cn } from '../../lib/cn'
import { CHECKER_IMAGE } from '../../lib/checker'
import { useEditorStore } from '../../store/context'
import type { Breakpoint } from '../../lib/use-breakpoint'
import { ClosePathIcon } from '../icons'
import { PropertyControls, Segmented } from './PropertyControls'
import { ColorPickerWidget } from './ColorPickerWidget'
import { usePropertyEditing } from './usePropertyEditing'
import { SubjectHeader } from './SubjectHeader'
import { BackgroundSettings } from './BackgroundSettings'

const isTransparent = (c?: string) => !c || c === 'transparent'
// Translucent, blurred buttons for the mobile bar — float over the canvas.
const TRANSLUCENT = 'border border-border/60 bg-card/75 shadow-sm backdrop-blur-sm'

// The minimal properties toolbar (replaces the old full panel): a left-side
// vertical cluster of icon buttons, each opening a dropdown widget. Background
// settings (field editing) take over only when nothing is selected.
export function PropertiesPanel({ mode, backgroundMode = false }: { mode: Breakpoint; backgroundMode?: boolean }) {
  if (mode !== 'full' && mode !== 'compact') return null
  return <PropertiesBar backgroundMode={backgroundMode} />
}

function FieldBackgroundPanel() {
  return (
    <div className="pointer-events-auto absolute left-2 top-16 z-30 max-h-[calc(100%-7rem)] w-52 overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-lg">
      <div className="flex items-center gap-2 px-1 text-sm font-medium text-foreground [&_svg]:size-6 [&_svg]:text-muted-foreground">
        <SquareDashedBottom /> <span>Background</span>
      </div>
      <div className="mt-3 border-t border-border pt-3">
        <BackgroundSettings />
      </div>
    </div>
  )
}

function PropertiesBar({ backgroundMode }: { backgroundMode: boolean }) {
  const p = usePropertyEditing()
  if (backgroundMode && p.count === 0) return <FieldBackgroundPanel />
  // Nothing to edit (the select/hand tool is active with no selection) → no panel.
  // It appears for a selection (to edit it) or a creation tool (future-element style).
  if (!p.editable) return null
  return (
    <div className="pointer-events-auto absolute left-3 top-16 z-30 flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg">
      <SubjectHeader compact />
      <span className="my-0.5 h-px w-6 bg-border" />
      {p.hasClosed && <ColorButton kind="fill" label="Background" channel="fill" value={p.values.fill} onChange={p.setFill} side="right" />}
      <ColorButton kind="stroke" label="Border" channel="stroke" value={p.values.stroke} onChange={p.setStroke} side="right" />
      <SettingsButton side="right" />
      {p.count > 0 && (
        <>
          <span className="my-0.5 h-px w-6 bg-border" />
          <ActionsMenu side="right" />
        </>
      )}
    </div>
  )
}

// A circle swatch button that opens the color picker. `kind` controls the glyph:
// 'fill' shows a filled disc, 'stroke' a ring.
function ColorButton({
  kind,
  label,
  channel,
  value,
  onChange,
  side,
  small,
  translucent,
}: {
  kind: 'fill' | 'stroke'
  label: string
  channel: string
  value: string | undefined
  onChange: (c: string) => void
  side: 'right' | 'top'
  small?: boolean
  translucent?: boolean
}) {
  const swatchStyle = isTransparent(value) ? {} : { backgroundImage: CHECKER_IMAGE, background: value }
  return (
    // The undo transaction is owned by ColorPickerWidget's lifecycle (begins on
    // mount, commits on unmount) — robust to every way the popover can close.
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label={label} className={cn(translucent && TRANSLUCENT)}>
              {kind === 'fill' ? (
                <span className="size-6 flex items-center justify-center rounded-lg" style={{ backgroundImage: CHECKER_IMAGE, backgroundColor: '#ffffff' }}>
                <span className="size-6 rounded-lg border border-border/70" style={swatchStyle} />
                </span>
              ) : (
                <span className="size-6 rounded-lg border-[3px] border-border" style={isTransparent(value) ? undefined : { borderColor: value as string }} />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-56">
        <ColorPickerWidget value={value} onChange={onChange} channel={channel} />
      </PopoverContent>
    </Popover>
  )
}

function SettingsButton({ side, small, translucent }: { side: 'right' | 'top'; small?: boolean; translucent?: boolean }) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label="Settings" className={cn(translucent && TRANSLUCENT)}>
              <SlidersHorizontal />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-52">
        <SettingsWidget />
      </PopoverContent>
    </Popover>
  )
}

const TIP_ITEMS: { value: ArrowTip; label: string; render: ReactNode }[] = [
  { value: 'none', label: 'None', render: <Minus className="size-4" /> },
  { value: 'arrow', label: 'Arrow', render: <MoveRight className="size-4" /> },
]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

// Element-specific "other props": stroke width/style/opacity (via PropertyControls)
// plus, for polylines, line type (straight/curved), arrow tips and close-path.
function SettingsWidget() {
  const p = usePropertyEditing()
  const hasPoly = p.polyCount > 0
  return (
    <div className="grid gap-3">
      {hasPoly && (
        <>
          <Field label="Line type">
            <Segmented
              items={[
                { value: 'straight', label: 'Straight', render: <Minus className="size-4" /> },
                { value: 'curved', label: 'Curved', render: <Spline className="size-4" /> },
              ]}
              value={p.values.curve === undefined ? undefined : p.values.curve ? 'curved' : 'straight'}
              onChange={(v) => p.setCurve(v === 'curved')}
            />
          </Field>
          {p.openPolyCount > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start tip">
                <Segmented items={TIP_ITEMS} value={p.values.startTip} onChange={p.setStartTip} />
              </Field>
              <Field label="End tip">
                <Segmented items={TIP_ITEMS} value={p.values.endTip} onChange={p.setEndTip} />
              </Field>
            </div>
          )}
          {p.closableCount > 0 && (
            <Field label="Close path">
              <button
                type="button"
                aria-pressed={!!p.values.closed}
                onClick={() => p.setClosed(!p.values.closed)}
                className={cn('flex size-8 items-center justify-center rounded-md border border-transparent text-foreground hover:bg-accent [&_svg]:size-4', p.values.closed && 'border-border bg-accent')}
              >
                <ClosePathIcon />
              </button>
            </Field>
          )}
        </>
      )}
      <PropertyControls />
    </div>
  )
}

// The "⋯" actions menu: duplicate, flip (figures), arrange (z-order), copy/paste
// style, delete.
function ActionsMenu({ side, small, translucent }: { side: 'right' | 'top'; small?: boolean; translucent?: boolean }) {
  const { figureCount } = usePropertyEditing()
  const flip = usePropertyEditing().flip
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected)
  const arrangeSelected = useEditorStore((s) => s.arrangeSelected)
  const copyStyle = useEditorStore((s) => s.copyStyle)
  const pasteStyle = useEditorStore((s) => s.pasteStyle)
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  const hasStyle = useEditorStore((s) => s.styleClipboard !== null)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label="Actions" className={cn(translucent && TRANSLUCENT)}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side={side} align="start" className="min-w-44">
        <DropdownMenuItem onSelect={duplicateSelected}>
          <CopyPlus /> Duplicate
        </DropdownMenuItem>
        {figureCount > 0 && (
          <DropdownMenuItem onSelect={flip}>
            <FlipHorizontal2 /> Flip
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Arrange</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => arrangeSelected('front')}>
          <BringToFront /> Bring to front
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => arrangeSelected('forward')}>
          <ArrowUp /> Bring forward
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => arrangeSelected('backward')}>
          <ArrowDown /> Send backward
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => arrangeSelected('back')}>
          <SendToBack /> Send to back
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={copyStyle}>
          <ClipboardCopy /> Copy style
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasStyle} onSelect={pasteStyle}>
          <ClipboardPaste /> Paste style
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={deleteSelected}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Always rendered in mobile mode. Selection color/settings on the left, undo/redo
// (always) + duplicate/delete (when selected) on the right.
export function MobileBar() {
  const p = usePropertyEditing()
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.pointer >= 0)
  const canRedo = useEditorStore((s) => s.pointer < s.stack.length - 1)
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected)
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  const selected = p.count > 0
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-16 z-30 flex items-center justify-between gap-2">
      <div className="pointer-events-auto flex items-center gap-1">
        {p.editable && p.hasClosed && <ColorButton kind="fill" label="Background" channel="fill" value={p.values.fill} onChange={p.setFill} side="top" small translucent />}
        {p.editable && <ColorButton kind="stroke" label="Border" channel="stroke" value={p.values.stroke} onChange={p.setStroke} side="top" small translucent />}
        {p.editable && <SettingsButton side="top" small translucent />}
      </div>
      <div className="pointer-events-auto flex items-center gap-1">
        <IconButton icon={Undo2} label="Undo" onClick={undo} disabled={!canUndo} />
        <IconButton icon={Redo2} label="Redo" onClick={redo} disabled={!canRedo} />
        {selected && <IconButton icon={Copy} label="Duplicate" onClick={duplicateSelected} />}
        {selected && <IconButton icon={Trash2} label="Delete" onClick={deleteSelected} />}
      </div>
    </div>
  )
}

function IconButton({ icon: Icon, label, onClick, disabled }: { icon: ComponentType<{ className?: string }>; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled} className={TRANSLUCENT}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

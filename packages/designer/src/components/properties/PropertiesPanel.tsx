import { type ComponentType } from 'react'
import { Palette, PenLine, SlidersHorizontal, Trash2, Copy, Undo2, Redo2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/cn'
import { useEditorStore } from '../../store/context'
import type { Breakpoint } from '../../lib/use-breakpoint'
import { PropertyControls, Swatches } from './PropertyControls'
import { usePropertyEditing } from './usePropertyEditing'
import { SubjectHeader } from './SubjectHeader'
import { STROKE_COLORS, BG_COLORS } from './palettes'

const isTransparent = (c?: string) => !c || c === 'transparent'
// Translucent, blurred buttons for the mobile bars — they float over the canvas
// without a solid card behind them, maximizing drawing visibility.
const TRANSLUCENT = 'border border-border/60 bg-card/75 shadow-sm backdrop-blur-sm'

// Selection properties for the full and compact layouts. Mobile is handled by
// MobileBar (which must stay visible — undo/redo — even with no selection).
export function PropertiesPanel({ mode }: { mode: Breakpoint }) {
  if (mode === 'full') return <FullPanel />
  if (mode === 'compact') return <CompactPanel />
  return null
}

function FullPanel() {
  const { editable, count } = usePropertyEditing()
  return (
    <div className="pointer-events-auto absolute left-2 top-16 z-30 max-h-[calc(100%-7rem)] w-52 overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-lg">
      <SubjectHeader />
      {editable ? (
        <>
          <div className="mt-3 border-t border-border pt-3">
            <PropertyControls />
          </div>
          {count > 0 && (
            <div className="mt-3 flex items-center gap-1 border-t border-border pt-2">
              <ActionButton icon={Copy} label="Duplicate" disabled />
              <DeleteButton />
            </div>
          )}
        </>
      ) : (
        <p className="px-1 pt-3 text-xs text-muted-foreground">No elements selected</p>
      )}
    </div>
  )
}

function CompactPanel() {
  const { editable, count, values, hasClosed, setStroke, setFill } = usePropertyEditing()
  return (
    <div className="pointer-events-auto absolute left-3 top-16 z-30 flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg">
      <SubjectHeader compact />
      {editable && (
        <>
          <span className="my-0.5 h-px w-6 bg-border" />
          {hasClosed && (
            <ColorButton icon={Palette} label="Background" colors={BG_COLORS} value={values.fill} onChange={setFill} side="right" />
          )}
          <ColorButton icon={PenLine} label="Stroke" colors={STROKE_COLORS} value={values.stroke} onChange={setStroke} side="right" />
          <SettingsButton side="right" />
        </>
      )}
      {count > 0 && (
        <>
          <span className="my-0.5 h-px w-6 bg-border" />
          <ActionButton icon={Copy} label="Duplicate" disabled />
          <DeleteButton />
        </>
      )}
    </div>
  )
}

// Always rendered in mobile mode. Sits just above the (bottom) main toolbar as
// two translucent clusters: selection properties on the left, and undo/redo
// (always) + copy/delete (when selected) on the right.
export function MobileBar() {
  const { editable, count, values, hasClosed, setStroke, setFill } = usePropertyEditing()
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.pointer >= 0)
  const canRedo = useEditorStore((s) => s.pointer < s.stack.length - 1)
  const selected = count > 0
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-16 z-30 flex items-center justify-between gap-2">
      <div className="pointer-events-auto flex items-center gap-1">
        {editable && hasClosed && (
          <ColorButton icon={Palette} label="Background" colors={BG_COLORS} value={values.fill} onChange={setFill} side="top" small translucent />
        )}
        {editable && (
          <ColorButton icon={PenLine} label="Stroke" colors={STROKE_COLORS} value={values.stroke} onChange={setStroke} side="top" small translucent />
        )}
        {editable && <SettingsButton side="top" small translucent />}
      </div>
      <div className="pointer-events-auto flex items-center gap-1">
        <ActionButton icon={Undo2} label="Undo" small translucent onClick={undo} disabled={!canUndo} />
        <ActionButton icon={Redo2} label="Redo" small translucent onClick={redo} disabled={!canRedo} />
        {selected && <ActionButton icon={Copy} label="Duplicate" small translucent disabled />}
        {selected && <DeleteButton small translucent />}
      </div>
    </div>
  )
}

function ColorButton({
  icon: Icon,
  label,
  colors,
  value,
  onChange,
  side,
  small,
  translucent,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  colors: string[]
  value: string | undefined
  onChange: (c: string) => void
  side: 'right' | 'top'
  small?: boolean
  translucent?: boolean
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label={label} className={cn('relative', translucent && TRANSLUCENT)}>
              <Icon />
              <span
                className="pointer-events-none absolute bottom-1 right-1 size-2 rounded-full border border-border"
                style={
                  isTransparent(value)
                    ? { backgroundImage: 'linear-gradient(45deg,#0004 25%,transparent 25%,transparent 75%,#0004 75%)', backgroundSize: '4px 4px' }
                    : { background: value }
                }
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-auto">
        <Swatches colors={colors} value={value} onChange={onChange} />
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
        <PropertyControls omitColors />
      </PopoverContent>
    </Popover>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  small,
  translucent,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  disabled?: boolean
  small?: boolean
  translucent?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size={small ? 'icon-sm' : 'icon'} aria-label={label} onClick={onClick} disabled={disabled} className={cn(translucent && TRANSLUCENT)}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function DeleteButton({ small, translucent }: { small?: boolean; translucent?: boolean }) {
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  return <ActionButton icon={Trash2} label="Delete" small={small} translucent={translucent} onClick={deleteSelected} />
}

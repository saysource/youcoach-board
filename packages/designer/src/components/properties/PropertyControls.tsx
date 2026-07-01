import { type ReactNode } from 'react'
import { type StrokeStyle, strokeDash } from '@youcoach-board/core'
import { Slider } from '../ui/slider'
import { cn } from '../../lib/cn'
import { CHECKER_IMAGE } from '../../lib/checker'
import { useDragTransaction } from '../../lib/use-drag-transaction'
import { usePropertyEditing } from './usePropertyEditing'
import { STROKE_WIDTHS, STROKE_STYLES } from './palettes'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

const isTransparent = (c: string) => c === 'transparent' || c === ''

// A row of color swatches + a native custom-color picker.
export function Swatches({
  colors,
  value,
  onChange,
}: {
  colors: string[]
  value: string | undefined
  onChange: (c: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {colors.map((c) => {
        const active = value === c
        return (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={active}
            onClick={() => onChange(c)}
            className={cn(
              'size-6 rounded-md border border-border p-0 overflow-hidden',
              active && 'ring-2 ring-primary ring-offset-1 ring-offset-popover',
            )}
            style={isTransparent(c) ? { backgroundImage: CHECKER_IMAGE, backgroundColor: '#ffffff' } : { background: c }}
          >
            <div className="size-6 relative" style={{ backgroundImage: CHECKER_IMAGE, backgroundColor: '#ffffff' }}>
                            <div className="size-6 eee relative" style={isTransparent(c) ? { } : { background: c }}></div>
                          </div>
          </button>
        )
      })}
      <span className="mx-0.5 h-5 w-px bg-border" />
      <label
        className="size-6 cursor-pointer overflow-hidden rounded-md border border-border"
        style={{ background: value && !isTransparent(value) ? value : '#ffffff' }}
        title="Custom color"
      >
        <input
          type="color"
          value={value && !isTransparent(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="size-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  )
}

export function Segmented<T extends string | number | boolean>({
  items,
  value,
  onChange,
  className,
}: {
  items: { value: T; label: string; render: ReactNode }[]
  value: T | undefined,
  className?: string
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {items.map((it) => {
        const active = value === it.value
        return (
          <button
            key={String(it.value)}
            type="button"
            aria-label={it.label}
            aria-pressed={active}
            onClick={() => onChange(it.value)}
            className={cn(
              'flex size-8 items-center justify-center rounded-md border border-transparent text-foreground hover:bg-accent',
              active && 'border-border bg-accent', className
            )}
          >
            {it.render}
          </button>
        )
      })}
    </div>
  )
}

function WidthIcon({ w }: { w: number }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
    </svg>
  )
}

function StyleIcon({ style }: { style: StrokeStyle }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <line
        x1="2"
        y1="9"
        x2="16"
        y2="9"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap={style === 'dotted' ? 'round' : 'butt'}
        strokeDasharray={strokeDash(style, 2)}
      />
    </svg>
  )
}

function OpacityControl({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  // Same model as the Color widget: apply live for feedback, with the whole drag
  // coalesced into one undo step (armed on first change, committed on window
  // pointerup — see useDragTransaction).
  const arm = useDragTransaction()
  return (
    <Slider
      min={0}
      max={100}
      step={1}
      value={[Math.round((value ?? 1) * 100)]}
      onValueChange={([p]) => {
        arm()
        onChange(p / 100)
      }}
    />
  )
}

// The non-color property sections (stroke width/style + opacity), shown in the
// Settings popover. Colors are edited through the dedicated Background/Border
// color buttons, not here.
export function PropertyControls() {
  const { values, setStrokeWidth, setStrokeStyle, setOpacity, allFigure } = usePropertyEditing()
  return (
    <div className="grid gap-3">
      {/* Figures ignore stroke — only opacity applies to them. */}
      {!allFigure && (
        <>
          <Field label="Stroke width">
            <Segmented
              items={STROKE_WIDTHS.map((w) => ({ value: w.value, label: w.label, render: <WidthIcon w={w.value} /> }))}
              value={values.strokeWidth}
              onChange={setStrokeWidth}
            />
          </Field>
          <Field label="Stroke style">
            <Segmented
              items={STROKE_STYLES.map((s) => ({ value: s.value, label: s.label, render: <StyleIcon style={s.value} /> }))}
              value={values.strokeStyle}
              onChange={setStrokeStyle}
            />
          </Field>
        </>
      )}
      <Field label="Opacity">
        <OpacityControl value={values.opacity} onChange={setOpacity} />
      </Field>
    </div>
  )
}

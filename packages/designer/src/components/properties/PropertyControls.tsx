import { useState, type ReactNode } from 'react'
import { type StrokeStyle, strokeDash } from '@youcoach-board/core'
import { Slider } from '../ui/slider'
import { cn } from '../../lib/cn'
import { usePropertyEditing } from './usePropertyEditing'
import { STROKE_COLORS, BG_COLORS, STROKE_WIDTHS, STROKE_STYLES } from './palettes'

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
              'size-6 rounded-md border border-border',
              active && 'ring-2 ring-primary ring-offset-1 ring-offset-popover',
            )}
            style={
              isTransparent(c)
                ? { backgroundImage: 'linear-gradient(45deg,#0002 25%,transparent 25%,transparent 75%,#0002 75%),linear-gradient(45deg,#0002 25%,transparent 25%,transparent 75%,#0002 75%)', backgroundSize: '8px 8px', backgroundPosition: '0 0,4px 4px' }
                : { background: c }
            }
          />
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

function Segmented<T extends string | number>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string; render: ReactNode }[]
  value: T | undefined
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
              active && 'border-border bg-accent',
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
  // Thumb tracks live; the committed value (single undo op) lands on release.
  const [live, setLive] = useState<number | null>(null)
  const v = (live ?? value ?? 1) * 100
  return (
    <Slider
      min={0}
      max={100}
      step={1}
      value={[Math.round(v)]}
      onValueChange={([p]) => setLive(p / 100)}
      onValueCommit={([p]) => {
        onChange(p / 100)
        setLive(null)
      }}
    />
  )
}

// The full set of property sections — reused by the full panel and the compact
// "settings" popover. `omitColors` skips the color rows (the compact toolbar
// surfaces those as its own dedicated buttons).
export function PropertyControls({ omitColors = false }: { omitColors?: boolean }) {
  const { hasClosed, values, setStroke, setFill, setStrokeWidth, setStrokeStyle, setOpacity } = usePropertyEditing()
  return (
    <div className="grid gap-3">
      {!omitColors && (
        <Field label="Stroke">
          <Swatches colors={STROKE_COLORS} value={values.stroke} onChange={setStroke} />
        </Field>
      )}
      {!omitColors && hasClosed && (
        <Field label="Background">
          <Swatches colors={BG_COLORS} value={values.fill} onChange={setFill} />
        </Field>
      )}
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
      <Field label="Opacity">
        <OpacityControl value={values.opacity} onChange={setOpacity} />
      </Field>
    </div>
  )
}

import { useState } from 'react'
import { HexColorPicker, HexColorInput } from 'react-colorful'
import { Pipette } from 'lucide-react'
import { cn } from '../../lib/cn'
import { CHECKER_IMAGE } from '../../lib/checker'
import { Separator } from '../ui/separator'
import { Slider } from '../ui/slider'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { useEditorStoreApi } from '../../store/context'
import { useDragTransaction } from '../../lib/use-drag-transaction'
import { Segmented } from './PropertyControls'

// The color picker widget. Opacity is an explicit, labelled slider (users don't
// have to discover the alpha track inside the saturation picker), and the RGB
// picker is tucked behind the hex sample swatch — so the always-visible controls
// are just colors. The palette is the fixed PREDEFINED set followed by colors
// actually in use in the document for this channel (carrying their opacity), so
// picking one restores both color AND opacity. Colors are 8-digit hex
// (#rrggbbaa); 'transparent' is the empty value.

const isTransparent = (c?: string) => !c || c === 'transparent'

// The fixed palette (first entry clears the color).
const PREDEFINED = ['transparent', '#f6dc64', '#e8a45b', '#e37268', '#73c268', '#799eed', '#8b84e7', '#ffffff', '#b0b0b0', '#1a1a1a']

// The 6-digit RGB hex (for the picker, hex input). 'transparent' → white; an
// 8-digit hex drops its alpha suffix.
const toRgbHex = (c?: string) => (isTransparent(c) ? '#ffffff' : (c as string).slice(0, 7))
// Two-digit alpha suffix of an 8-digit hex, or 'ff' (opaque) otherwise.
const alphaOf = (c?: string) => (typeof c === 'string' && /^#[0-9a-f]{8}$/i.test(c) ? c.slice(7) : 'ff')
// Alpha as 0–100 (transparent reads as 0).
const alphaPct = (c?: string) => (isTransparent(c) ? 0 : Math.round((parseInt(alphaOf(c), 16) / 255) * 100))
// 0–100 → two-digit hex alpha suffix.
const pctToHex = (pct: number) =>
  Math.round((pct / 100) * 255)
    .toString(16)
    .padStart(2, '0')
// Canonical form for comparison/dedup ('transparent' or '#rrggbbaa').
const norm = (c?: string) => (isTransparent(c) ? 'transparent' : `${toRgbHex(c)}${alphaOf(c)}`.toLowerCase())

export function ColorPickerWidget({
  value,
  onChange,
  fillStyle,
  onFillStyleChange,
  presets,
  showOpacity = true,
  allowTransparent = true,
}: {
  value: string | undefined
  onChange: (c: string) => void
  /** When set (fill/background channel), show a Solid/Striped fill-style toggle. */
  fillStyle?: 'solid' | 'striped'
  onFillStyleChange?: (s: 'solid' | 'striped') => void
  /** Override the swatch palette (and skip the document-used colors). */
  presets?: string[]
  /** Hide the opacity slider and emit plain 6-digit hex (no alpha suffix). */
  showOpacity?: boolean
  /** Hide the transparent swatch (channels that must carry a solid color). */
  allowTransparent?: boolean
}) {
  const storeApi = useEditorStoreApi()
  // Coalesce only the CONTINUOUS controls (opacity slider + the picker drag) into
  // one undo step — armed on their first change and committed on pointer release,
  // scoped to each drag (NOT the whole widget), so unrelated edits (e.g. moving an
  // element while the picker is open) keep their own undo ops.
  const arm = useDragTransaction()
  const current = norm(value)
  // Picking a swatch sets it wholesale (so collected colors restore their opacity).
  const setColor = (c: string) => onChange(c)
  const setAlpha = (pct: number) => onChange(`${toRgbHex(value)}${pctToHex(pct)}`)
  // Carry the current alpha onto a freshly-picked RGB — unless opacity is off, in
  // which case we emit plain 6-digit hex.
  const withAlpha = (rgb: string) => (showOpacity ? `${rgb}${alphaOf(value)}` : rgb)
  // Snapshot the document-used colors ONCE, when the picker opens — a SINGLE set
  // shared across all properties (every stroke, fill and figure color slot used
  // anywhere), so a color picked for one property is offered for the others too.
  // (Snapshotted, not live, so the swatches don't reorder under the cursor as you
  // edit; the widget remounts on each open, refreshing the set.)
  const [used] = useState<string[]>(() => {
    const seen = new Set(PREDEFINED.map(norm))
    const out: string[] = []
    const add = (c?: string) => {
      if (!c || isTransparent(c)) return
      const n = norm(c)
      if (seen.has(n)) return
      seen.add(n)
      out.push(c)
    }
    for (const el of storeApi.getState().doc.elements) {
      add(el.stroke)
      add(el.fill)
      if (el.type === 'figure' && el.colors) for (const c of Object.values(el.colors)) add(c)
    }
    return out
  })
  // A custom preset list (e.g. background) replaces both PREDEFINED and the
  // document-used colors; otherwise it's PREDEFINED followed by used colors.
  const palette = (presets ?? [...PREDEFINED, ...used]).filter((c) => allowTransparent || !isTransparent(c))
  return (
    <div className="grid gap-2.5">

      {onFillStyleChange && (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Fill style</span>
          <Segmented
            items={[
              { value: 'solid', label: 'Solid', render: <span className="size-4 rounded-[3px]" style={{ background: 'currentColor' }} /> },
              { value: 'striped', label: 'Striped', render: <span className="size-4 rounded-[3px]" style={{ backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 4px)' }} /> },
            ]}
            value={fillStyle}
            onChange={onFillStyleChange}
          />
        </div>
      )}

      {showOpacity && (
        <>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Opacity</span>
            <div className="flex items-center gap-2">
              <Slider
                min={0}
                max={100}
                step={1}
                value={[alphaPct(value)]}
                onValueChange={([v]) => {
                  arm() // first change of the drag begins the (one) undo transaction
                  setAlpha(v)
                }}
                className="flex-1"
              />
              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{alphaPct(value)}%</span>
            </div>
          </div>

          <Separator />
        </>
      )}

      <div className="flex flex-wrap gap-1">
        {palette.map((c) => (
          <Swatch key={c} color={c} active={current === norm(c)} onClick={() => setColor(c)} />
        ))}
      </div>

      <Separator />

      <div className="flex items-center gap-1.5">
        {/* The sample swatch opens the RGB picker. */}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Color picker" className="size-8  p-0 shrink-0 overflow-hidden rounded-md border border-border">
              <span className="block size-full" style={{ backgroundImage: CHECKER_IMAGE, backgroundColor: '#ffffff' }}>
                <span className="block size-full" style={isTransparent(value) ? undefined : { background: value }} />
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-auto p-2">
            {/* arm() on the first change of the drag → the whole drag is one undo
                step, committed on the window pointerup. */}
            <HexColorPicker
              color={toRgbHex(value)}
              onChange={(c) => {
                arm()
                onChange(withAlpha(c))
              }}
            />
          </PopoverContent>
        </Popover>
        <div className="flex h-8 flex-1 items-center rounded-md border border-border bg-background px-2">
          <span className="text-xs text-muted-foreground">#</span>
          <HexColorInput
            color={toRgbHex(value)}
            onChange={(c) => onChange(withAlpha(c))}
            prefixed={false}
            className="w-full min-w-0 flex-1 border-0 bg-transparent pl-1 font-mono text-xs uppercase outline-none"
          />
        </div>
        {'EyeDropper' in window && (
          <button
            type="button"
            aria-label="Pick color from screen"
            className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground [&_svg]:size-4"
            onClick={async () => {
              try {
                // @ts-expect-error EyeDropper isn't in the TS lib yet.
                const r = await new window.EyeDropper().open()
                onChange(withAlpha(r.sRGBHex))
              } catch {
                /* cancelled */
              }
            }}
          >
            <Pipette />
          </button>
        )}
      </div>
    </div>
  )
}

// One color swatch: the color over a checkerboard (so alpha reads clearly).
function Swatch({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={color}
      aria-pressed={active}
      onClick={onClick}
      className={cn('size-6 overflow-hidden rounded-md border border-border p-0', active && 'ring-2 ring-primary ring-offset-1 ring-offset-popover')}
    >
      <span className="block size-full" style={{ backgroundImage: CHECKER_IMAGE, backgroundColor: '#ffffff' }}>
        <span className="block size-full" style={isTransparent(color) ? undefined : { background: color }} />
      </span>
    </button>
  )
}

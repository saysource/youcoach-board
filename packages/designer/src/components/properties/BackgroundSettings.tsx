import { type LogoPosition, type FieldBands } from '@youcoach-board/core'
import { useEditorStore } from '../../store/context'
import { useDragTransaction } from '../../lib/use-drag-transaction'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'
import { Segmented } from './PropertyControls'
import { ColorPickerWidget } from './ColorPickerWidget'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { CHECKER_IMAGE } from '../../lib/checker'
import { LogoTopLeftIcon, LogoTopRightIcon, LogoCenterIcon, LogoBottomLeftIcon, LogoBottomRightIcon } from '../icons'
import defaultFieldImage from '../../assets/field0.jpg'

// Background swatch presets (first = restore the default field image).
const BG_COLORS = ['transparent', '#2f8a3e', '#3b7a57', '#5b8c3a', '#d1d1d1', '#9f9f9f', '#a6c58b', '#3389e0', '#ffffff']

// Surround (infinite 3D ground) presets — first = off (no plane, 2D background
// shows as before). Greens near the pitch grass, plus stadium greys/dark.
const SURROUND_COLORS = ['transparent', '#2f8a3e', '#256e31', '#3b7a57', '#5b8c3a', '#8a8a8a', '#4a4a4a', '#22301f', '#d1d1d1']

const BANDS_OPTIONS: { value: FieldBands; label: string; render: React.ReactNode }[] = [
  {
    value: 'vertical',
    label: 'Vertical',
    render: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <rect x="3" y="2" width="3" height="16" /><rect x="8.5" y="2" width="3" height="16" /><rect x="14" y="2" width="3" height="16" />
      </svg>
    ),
  },
  {
    value: 'horizontal',
    label: 'Horizontal',
    render: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <rect x="2" y="3" width="16" height="3" /><rect x="2" y="8.5" width="16" height="3" /><rect x="2" y="14" width="16" height="3" />
      </svg>
    ),
  },
  {
    value: 'none',
    label: 'None',
    render: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <circle cx="10" cy="10" r="7" /><line x1="5" y1="15" x2="15" y2="5" />
      </svg>
    ),
  },
]

const LOGO_OPTIONS: { value: LogoPosition; label: string; render: React.ReactNode }[] = [
  { value: 'top-left', label: 'Top left', render: <LogoTopLeftIcon className="size-5" /> },
  { value: 'top-right', label: 'Top right', render: <LogoTopRightIcon className="size-5" /> },
  { value: 'center', label: 'Center', render: <LogoCenterIcon className="size-5" /> },
  { value: 'bottom-left', label: 'Bottom left', render: <LogoBottomLeftIcon className="size-5" /> },
  { value: 'bottom-right', label: 'Bottom right', render: <LogoBottomRightIcon className="size-5" /> },
]

// The background color picker (its own toolbar button): the same widget as the
// stroke color, but without opacity and with the background presets. The
// "transparent" swatch restores the default field image; any color is a solid fill.
export function BackgroundColorPicker() {
  const bg = useEditorStore((s) => s.doc.background)
  const setBackground = useEditorStore((s) => s.setBackground)
  return (
    <ColorPickerWidget
      value={bg.image ? 'transparent' : bg.color}
      onChange={(c) => (c === 'transparent' || c === '' ? setBackground({ image: defaultFieldImage }) : setBackground({ color: c, image: null }))}
      presets={BG_COLORS}
      showOpacity={false}
    />
  )
}

// Background settings (field scale + logo position) — the field is panned directly
// on the canvas via the move handle (InteractiveBoard).
export function BackgroundSettings() {
  const bg = useEditorStore((s) => s.doc.background)
  const setBackground = useEditorStore((s) => s.setBackground)
  const arm = useDragTransaction()
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Field scale</span>
        <Slider
          min={20}
          max={300}
          step={5}
          value={[Math.round(bg.scale * 100)]}
          onValueChange={([v]) => {
            // First change arms the (one) undo transaction, committed on window pointerup.
            arm()
            setBackground({ scale: v / 100 })
          }}
        />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">Object size</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{bg.objectScale}× {bg.objectScale === 1 ? '(real)' : ''}</span>
        </div>
        {/* Stepped 1×–8×: models are real-size, this scales them up for a top-down board. */}
        <Slider
          min={1}
          max={8}
          step={1}
          value={[bg.objectScale]}
          onValueChange={([v]) => {
            arm()
            setBackground({ objectScale: v })
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">Goals</span>
        <Switch checked={bg.showGoals} onCheckedChange={(v) => setBackground({ showGoals: v })} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">Surround</span>
        {/* Infinite 3D ground plane under the field; transparent swatch = off. */}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Surround color" className="size-7 shrink-0 overflow-hidden rounded-md border border-border p-0">
              <span className="block size-full" style={{ backgroundImage: CHECKER_IMAGE, backgroundColor: '#ffffff' }}>
                <span className="block size-full" style={bg.surroundColor === 'transparent' ? undefined : { background: bg.surroundColor }} />
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="left" align="start" className="w-60 p-3">
            <ColorPickerWidget
              value={bg.surroundColor}
              onChange={(c) => setBackground({ surroundColor: c === '' ? 'transparent' : c })}
              presets={SURROUND_COLORS}
              showOpacity={false}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Bands</span>
        <Segmented items={BANDS_OPTIONS} value={bg.bands} onChange={(v) => setBackground({ bands: v })} />
      </div>

      <div className="grid gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Logo</span>
        {/* Segmented like Stroke width/style; click the active one again to remove. */}
        <Segmented
          items={LOGO_OPTIONS}
          value={bg.logo ?? undefined}
          onChange={(v) => setBackground({ logo: bg.logo === v ? null : v })}
        />
      </div>
    </div>
  )
}

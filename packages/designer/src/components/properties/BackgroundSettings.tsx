import { useTranslation } from 'react-i18next'
import { isLegacyBackground, type LogoPosition, type FieldBands } from '@youcoach-board/core'
import { useEditorStore } from '../../store/context'
import { cn } from '../../lib/cn'
import { useDragTransaction } from '../../lib/use-drag-transaction'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'
import { Segmented } from './PropertyControls'
import { ColorPickerWidget } from './ColorPickerWidget'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { LogoTopLeftIcon, LogoTopRightIcon, LogoCenterIcon, LogoBottomLeftIcon, LogoBottomRightIcon } from '../icons'

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
    value: 'cross',
    label: 'Cross',
    render: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <rect x="3" y="2" width="3" height="16" /><rect x="8.5" y="2" width="3" height="16" /><rect x="14" y="2" width="3" height="16" />
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

// Merged surface presets: transparent (= grass image / no surround) + the greens
// and stadium greys used near the pitch.
const SURFACE_COLORS = ['transparent', '#2f8a3e', '#256e31', '#3b7a57', '#5b8c3a', '#a6c58b', '#8a8a8a', '#4a4a4a', '#22301f', '#d1d1d1', '#3389e0', '#ffffff']

// Common field-line colours (default white).
const LINE_COLORS = ['#ffffff', '#000000', '#e6e6e6', '#f5d90a', '#111827', '#3389e0']

// Futsal court presets: the playing surface, the border (out-of-bounds frame)
// and the areas (goal areas + centre circle) — the reference design's colors
// plus common indoor floors.
const COURT_COLORS = ['#3b9ccc', '#2b7bb0', '#2f8a3e', '#d1651f', '#8a8a8a', '#b04a3c']
const BORDER_COLORS = ['#ff9f48', '#d1651f', '#2f8a3e', '#3389e0', '#8a8a8a', '#22301f']
const AREAS_COLORS = ['#277ea0', '#1d5f7a', '#2f8a3e', '#d1651f', '#8a8a8a', '#4a4a4a']

// The unified "Surface color" picker (its own toolbar button): one colour driving
// both the flat 2D board background and the 3D ground plane. 'transparent' = off
// (the default field image shows, no surround).
export function SurfaceColorPicker() {
  const bg = useEditorStore((s) => s.doc.background)
  const setBackground = useEditorStore((s) => s.setBackground)
  return (
    <ColorPickerWidget
      value={bg.surfaceColor}
      onChange={(c) => setBackground({ surfaceColor: c === '' ? 'transparent' : c })}
      presets={SURFACE_COLORS}
      showOpacity={false}
    />
  )
}

// The object/token sizing popover (cube button): global 3D-object display scale,
// the shared token size, and the 3D-tokens toggle. (Token size + 3D tokens are also
// in the token settings' global section — same store state.)
export function ObjectTokenSettings() {
  const { t } = useTranslation()
  const bg = useEditorStore((s) => s.doc.background)
  const setBackground = useEditorStore((s) => s.setBackground)
  const tokenSizeM = useEditorStore((s) => s.tokenSizeM)
  const setTokenSizeM = useEditorStore((s) => s.setTokenSizeM)
  const arm = useDragTransaction()
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">{t('Object size')}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{bg.objectScale}× {bg.objectScale === 1 ? t('(real)') : ''}</span>
        </div>
        {/* Stepped 1×–8×: models (and players) are real-size — this scales them up for a top-down board. */}
        <Slider min={1} max={8} step={1} value={[bg.objectScale]} onValueChange={([v]) => { arm(); setBackground({ objectScale: v }) }} />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">{t('Token size')}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{Math.round(tokenSizeM)} m</span>
        </div>
        {/* Global token diameter (2–10 m), shared with every token on the board. */}
        <Slider min={2} max={10} step={1} value={[Math.round(tokenSizeM)]} onValueChange={([v]) => { arm(); setTokenSizeM(v) }} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{t('3D tokens')}</span>
        <Switch checked={bg.tokens3d} onCheckedChange={(v) => setBackground({ tokens3d: v })} />
      </div>
    </div>
  )
}

// Background settings — field/pitch appearance. Object + token sizing live in their
// own (cube) popover; the surface colour is its own toolbar button.
export function BackgroundSettings() {
  const { t } = useTranslation()
  const bg = useEditorStore((s) => s.doc.background)
  const setBackground = useEditorStore((s) => s.setBackground)
  const arm = useDragTransaction()
  // A legacy 2D background (flat SVG field) has no 3D markings/mowing to style:
  // those controls are disabled until a real 3D field is applied.
  const legacy = isLegacyBackground(bg)
  // The futsal court is indoor: no mowing bands; it adds its own Border/Areas colors.
  const futsal = !legacy && !!bg.field3d && bg.fieldType === 'futsal'
  const dim = (on: boolean) => (on ? 'pointer-events-none opacity-40' : undefined)
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{t('Goals')}</span>
        <Switch checked={bg.showGoals} onCheckedChange={(v) => setBackground({ showGoals: v })} />
      </div>

      <div className={cn('flex items-center justify-between', dim(legacy))}>
        <span className="text-[11px] font-medium text-muted-foreground">{t('Field lines')}</span>
        <Switch disabled={legacy} checked={bg.showLines} onCheckedChange={(v) => setBackground({ showLines: v })} />
      </div>

      <div className={cn('flex items-center justify-between', dim(legacy))}>
        <span className="text-[11px] font-medium text-muted-foreground">{t('Line color')}</span>
        {/* Field markings colour (not the mowing bands); default white. */}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label={t('Line color')} className="size-7 shrink-0 overflow-hidden rounded-md border border-border p-0">
              <span className="block size-full" style={{ background: bg.lineColor }} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="left" align="start" className="w-60 p-3">
            <ColorPickerWidget
              value={bg.lineColor}
              onChange={(c) => setBackground({ lineColor: c === '' || c === 'transparent' ? '#ffffff' : c })}
              presets={LINE_COLORS}
              showOpacity={false}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Futsal court colors: the playing surface, the border frame + the filled
          areas (the master surface color only drives the infinite surround). */}
      {futsal && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">{t('Court')}</span>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label={t('Court color')} className="size-7 shrink-0 overflow-hidden rounded-md border border-border p-0">
                  <span className="block size-full" style={{ background: bg.courtColor }} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="left" align="start" className="w-60 p-3">
                <ColorPickerWidget
                  value={bg.courtColor}
                  onChange={(c) => setBackground({ courtColor: c === '' || c === 'transparent' ? '#3b9ccc' : c })}
                  presets={COURT_COLORS}
                  showOpacity={false}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">{t('Border')}</span>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label={t('Border color')} className="size-7 shrink-0 overflow-hidden rounded-md border border-border p-0">
                  <span className="block size-full" style={{ background: bg.borderColor }} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="left" align="start" className="w-60 p-3">
                <ColorPickerWidget
                  value={bg.borderColor}
                  onChange={(c) => setBackground({ borderColor: c === '' || c === 'transparent' ? '#ff9f48' : c })}
                  presets={BORDER_COLORS}
                  showOpacity={false}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">{t('Areas')}</span>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label={t('Areas color')} className="size-7 shrink-0 overflow-hidden rounded-md border border-border p-0">
                  <span className="block size-full" style={{ background: bg.areasColor }} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="left" align="start" className="w-60 p-3">
                <ColorPickerWidget
                  value={bg.areasColor}
                  onChange={(c) => setBackground({ areasColor: c === '' || c === 'transparent' ? '#277ea0' : c })}
                  presets={AREAS_COLORS}
                  showOpacity={false}
                />
              </PopoverContent>
            </Popover>
          </div>
        </>
      )}

      <div className={cn('grid gap-1.5', dim(legacy || futsal))}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">{t('Mowing opacity')}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{Math.round(bg.bandsOpacity * 100)}%</span>
        </div>
        <Slider disabled={legacy || futsal} min={0} max={100} step={5} value={[Math.round(bg.bandsOpacity * 100)]} onValueChange={([v]) => { arm(); setBackground({ bandsOpacity: v / 100 }) }} />
      </div>

      <div className={cn('grid gap-1.5', dim(legacy || futsal))}>
        <span className="text-[11px] font-medium text-muted-foreground">{t('Mowing')}</span>
        <Segmented items={BANDS_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} value={bg.bands} onChange={(v) => setBackground({ bands: v })} />
      </div>

      <div className={cn('grid gap-1.5', dim(legacy))}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">{t('Central light')}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{Math.round((bg.centerLight ?? 1) * 100)}%</span>
        </div>
        {/* Central point-light intensity: 0 … 125 % of the default (1 = default). */}
        <Slider disabled={legacy} min={0} max={125} step={5} value={[Math.round((bg.centerLight ?? 1) * 100)]} onValueChange={([v]) => { arm(); setBackground({ centerLight: v / 100 }) }} />
      </div>

      <div className="grid gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{t('Logo')}</span>
        {/* Segmented like Stroke width/style; click the active one again to remove. */}
        <Segmented
          items={LOGO_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
          value={bg.logo ?? undefined}
          onChange={(v) => setBackground({ logo: bg.logo === v ? null : v })}
        />
      </div>
    </div>
  )
}

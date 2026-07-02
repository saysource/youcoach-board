import { useState } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal } from 'lucide-react'
import { ElementView, IDENTITY_TRANSFORM, type TokenFill } from '@youcoach-board/core'
import { Button } from '../ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Slider } from '../ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/cn'
import { useDragTransaction } from '../../lib/use-drag-transaction'
import { usePortalContainer } from '../../lib/board-root'
import { useEditorStore } from '../../store/context'
import { usePropertyEditing } from './usePropertyEditing'
import { ColorPickerWidget } from './ColorPickerWidget'
import { facePreview, kitPreview, SKIN_PRESETS, HAIR_COLORS, SKIN_COLORS, DEFAULT_SKIN, DEFAULT_HAIR, EMPTY_KIT, KIT_HISTORY_SIZE, type KitStyle, type PlayerKit } from '../../lib/player-kit'

// Keep a nested editor/color popover (or the backdrop) from closing this popover.
const keepOpenOnNested = (e: { detail: { originalEvent: Event }; preventDefault: () => void }) => {
  const t = (e.detail.originalEvent.target as HTMLElement | null) ?? null
  if (t?.closest('[data-radix-popper-content-wrapper]') || t?.closest('[data-player-backdrop]')) e.preventDefault()
}

// A fully-transparent full-viewport layer under the open editor: any click on it
// closes the editor and is swallowed (so it never reaches the canvas and blurs the
// selection). Portaled next to the popovers so it sits above the board.
function Backdrop({ onClose, className = 'z-40' }: { onClose: () => void; className?: string }) {
  const container = usePortalContainer()
  const node = <div data-player-backdrop className={cn('fixed inset-0', className)} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onClose() }} />
  return container ? createPortal(node, container) : node
}

// A recolored face.svg (skin + hair) on a neutral circle — the skin preview.
function FaceAvatar({ skin, hair, size = 60, active }: { skin: string; hair: string; size?: number; active?: boolean }) {
  const pv = facePreview(skin, hair)
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted dark:bg-foreground/20 border border-border', active && 'ring-2 ring-primary ring-offset-1 ring-offset-popover')}
      style={{ width: size, height: size }}
    >
      {pv && <svg style={{ width: size * 0.82, height: size * 0.82 }} viewBox={pv.viewBox} preserveAspectRatio="xMidYMid meet" dangerouslySetInnerHTML={{ __html: pv.inner }} aria-hidden />}
    </span>
  )
}

// A color swatch for the advanced palettes (no custom picker, per spec).
function Swatch({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={color}
      aria-pressed={active}
      onClick={onClick}
      className={cn('size-5 shrink-0 rounded-md border border-border/70', active && 'ring-2 ring-primary ring-offset-1 ring-offset-popover')}
      style={{ background: color }}
    />
  )
}

// The skin editor: simple mode (8 skin/hair presets) ↔ advanced (hair + skin
// palettes around a live preview). No custom color picking.
function SkinEditor() {
  const p = usePropertyEditing()
  const skin = p.values.skin ?? DEFAULT_SKIN
  const hair = p.values.hair ?? DEFAULT_HAIR
  const [advanced, setAdvanced] = useState(false)
  return (
    <div className="grid gap-3">
      {!advanced ? (
        <div className="grid grid-cols-4 gap-2">
          {SKIN_PRESETS.map((preset) => (
            <button key={`${preset.skin}-${preset.hair}`} type="button" aria-label="Skin preset" onClick={() => p.setSkinHair(preset.skin, preset.hair)} className="flex items-center justify-center">
              <FaceAvatar skin={preset.skin} hair={preset.hair} size={60} active={preset.skin === skin && preset.hair === hair} />
            </button>
          ))}
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-1.5">
            {HAIR_COLORS.map((c) => (
              <Swatch key={c} color={c} active={c === hair} onClick={() => p.setHair(c)} />
            ))}
          </div>
          <div className="flex justify-center">
            <FaceAvatar skin={skin} hair={hair} size={72} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SKIN_COLORS.map((c) => (
              <Swatch key={c} color={c} active={c === skin} onClick={() => p.setSkin(c)} />
            ))}
          </div>
        </div>
      )}
      <button type="button" onClick={() => setAdvanced((a) => !a)} className="self-end text-[11px] font-medium text-muted-foreground hover:text-foreground">
        {advanced ? '◂ Less options' : 'More options ▸'}
      </button>
    </div>
  )
}

// The skin preview button → opens the skin editor. Controlled by the parent so
// skin and kit are mutually exclusive; closing happens via trigger or backdrop
// (never Radix's own outside-click), so switching editors is a single click.
function SkinButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const p = usePropertyEditing()
  const skin = p.values.skin ?? DEFAULT_SKIN
  const hair = p.values.hair ?? DEFAULT_HAIR
  return (
    <Popover open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverAnchor asChild>
            <Button size="icon" aria-label="Skin & hair" className="p-0 size-18" onClick={onToggle}>
              <FaceAvatar skin={skin} hair={hair} size={60} />
            </Button>
          </PopoverAnchor>
        </TooltipTrigger>
        <TooltipContent>Skin &amp; hair</TooltipContent>
      </Tooltip>
      {/* Open BELOW the settings popover (not over the canvas). */}
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-auto" onOpenAutoFocus={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <SkinEditor />
      </PopoverContent>
    </Popover>
  )
}

function OpacityRow() {
  const p = usePropertyEditing()
  const arm = useDragTransaction()
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">Opacity</span>
      <Slider
        min={0}
        max={100}
        step={1}
        value={[Math.round((p.values.opacity ?? 1) * 100)]}
        onValueChange={([v]) => {
          arm()
          p.setOpacity(v / 100)
        }}
      />
    </div>
  )
}

// ── Kit editor ───────────────────────────────────────────────────────────────

// A recolored kit.svg (body silhouette + colored kit), inside a circular chip —
// used for the trigger button in the settings row.
function KitFigure({ kit, size = 40 }: { kit: PlayerKit; size?: number }) {
  const pv = kitPreview(kit)
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden bg-muted dark:bg-foreground/20 border border-border rounded-full" style={{ width: size, height: size }}>
      {pv && <svg style={{ width: size * 0.9, height: size * 0.9 }} viewBox={pv.viewBox} preserveAspectRatio="xMidYMid meet" dangerouslySetInnerHTML={{ __html: pv.inner }} aria-hidden />}
    </span>
  )
}

// A bare recolored kit.svg — used for the editor preview and the recent-kit
// presets. Wrapped in a faint tint on dark themes so the (often dark) figure
// doesn't vanish against the dark popover; invisible in light mode.
function KitSvg({ kit, className, style }: { kit: PlayerKit; className?: string; style?: React.CSSProperties }) {
  const pv = kitPreview(kit)
  if (!pv) return null
  return (
    <span className={cn('inline-flex items-center justify-center rounded-md bg-transparent dark:bg-foreground/20', className)}>
      <svg style={style} viewBox={pv.viewBox} preserveAspectRatio="xMidYMid meet" dangerouslySetInnerHTML={{ __html: pv.inner }} aria-hidden />
    </span>
  )
}

// A jersey-style icon: the token jersey shirt (white base, mid-gray stripes) with
// the fill style matching the kit style (KitStyle === the token fill names).
// The 4th style ('checker') is actually a plaid (v+h stripes) — render its icon
// with the token's plaid fill, not a checkerboard.
const iconFill = (style: KitStyle): TokenFill => (style === 'checker' ? 'plaid' : style)

function KitStyleIcon({ style, size = 28 }: { style: KitStyle; size?: number }) {
  const el = {
    id: 'kit-style',
    type: 'token' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    shape: 'jersey' as const,
    tokenFill: iconFill(style),
    color1: '#ffffff',
    color2: '#888888',
    textColor: '#111111',
    text: '',
    label: '',
    showLabel: false,
    transform: IDENTITY_TRANSFORM,
    stroke: '#111111',
    strokeWidth: 3,
    strokeStyle: 'solid' as const,
    fill: 'transparent',
    fillStyle: 'solid' as const,
  }
  return (
    <svg width={size} height={size} viewBox="-4 -4 118 118" aria-hidden>
      <ElementView element={el} />
    </svg>
  )
}

// A solid color swatch → opens the stroke-like color widget (no opacity).
// Controlled by the kit editor so only one color picker is open at a time.
function KitColorButton({ color, label, onChange, open, onOpenChange }: { color: string; label: string; onChange: (c: string) => void; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="size-6 shrink-0 rounded-md border border-border/70" style={{ background: color }} />
      </PopoverTrigger>
      {/* Sits above the editor backdrop (z-40) but below the popover content
          (z-50): an outside click closes just this picker (not the whole editor),
          while the widget and its nested picker stay clickable. */}
      {open && <Backdrop onClose={() => onOpenChange(false)} className="z-45" />}
      <PopoverContent side="right" align="start" className="w-56">
        <ColorPickerWidget value={color} onChange={onChange} showOpacity={false} allowTransparent={false} />
      </PopoverContent>
    </Popover>
  )
}

const KIT_STYLES: KitStyle[] = ['solid', 'vstripes', 'hstripes', 'checker']

// The kit editor: big preview | controls (style + colors) | recent-kits grid.
function KitEditor() {
  const p = usePropertyEditing()
  const derived = p.values.kit ?? EMPTY_KIT
  const history = useEditorStore((s) => s.kitHistory)
  // Remember the stripe color across style changes: Solid clears the stripe slots,
  // so keep the last color here to propose it when a striped style is picked again.
  const [stripeColor, setStripeColor] = useState(derived.stripe)
  const kit = { ...derived, stripe: derived.style === 'solid' ? stripeColor : derived.stripe }
  const set = (patch: Partial<PlayerKit>) => {
    if (patch.stripe) setStripeColor(patch.stripe)
    p.setKit({ ...kit, ...patch })
  }
  const loadKit = (k: PlayerKit) => {
    setStripeColor(k.stripe)
    p.setKit(k)
  }
  // Only one color picker open at a time.
  const [openColor, setOpenColor] = useState<'jersey' | 'stripe' | 'shorts' | 'socks' | null>(null)
  const colorProps = (which: 'jersey' | 'stripe' | 'shorts' | 'socks') => ({
    open: openColor === which,
    onOpenChange: (o: boolean) => setOpenColor(o ? which : null),
  })
  return (
    <div className="flex items-stretch gap-3">
      <KitSvg kit={kit} className="shrink-0 self-center" style={{ height: 240, width: 'auto' }} />
      <div className="grid gap-2 border-l border-border pl-3">
        <div className="flex gap-1">
          {KIT_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={s}
              aria-pressed={kit.style === s}
              onClick={() => set({ style: s })}
              className={cn('flex items-center justify-center rounded-md border p-0.5', kit.style === s ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-accent')}
            >
              <KitStyleIcon style={s} size={42} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <KitColorButton color={kit.jersey} label="Jersey" onChange={(c) => set({ jersey: c })} {...colorProps('jersey')} />
          <span className="text-xs text-muted-foreground">Jersey</span>
        </div>
        {kit.style !== 'solid' && (
          <div className="flex items-center gap-2">
            <KitColorButton color={kit.stripe} label="Stripes" onChange={(c) => set({ stripe: c })} {...colorProps('stripe')} />
            <span className="text-xs text-muted-foreground">Stripes</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <KitColorButton color={kit.shorts} label="Shorts" onChange={(c) => set({ shorts: c })} {...colorProps('shorts')} />
          <span className="text-xs text-muted-foreground">Shorts</span>
        </div>
        <div className="flex items-center gap-2">
          <KitColorButton color={kit.socks} label="Socks" onChange={(c) => set({ socks: c })} {...colorProps('socks')} />
          <span className="text-xs text-muted-foreground">Socks</span>
        </div>
      </div>
      <div className="grid grid-cols-2 grid-rows-2 gap-1 self-stretch border-l border-border pl-3">
        {Array.from({ length: KIT_HISTORY_SIZE }).map((_, i) => {
          const k = history[i]
          return (
            <button key={i} type="button" aria-label="Recent kit" disabled={!k} onClick={() => k && loadKit(k)} className="flex items-center justify-center rounded-md disabled:cursor-default">
              <KitSvg kit={k ?? EMPTY_KIT} style={{ height: 114, width: 'auto', opacity: k ? 1 : 0.2 }} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// The kit preview button → opens the kit editor. Controlled by the parent (which
// pushes the kit to history when the editor closes).
function KitButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const p = usePropertyEditing()
  const kit = p.values.kit ?? EMPTY_KIT
  return (
    <Popover open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverAnchor asChild>
            <Button size="icon" aria-label="Kit" className="p-0 size-18" onClick={onToggle}>
              <KitFigure kit={kit} size={60} />
            </Button>
          </PopoverAnchor>
        </TooltipTrigger>
        <TooltipContent>Kit</TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-auto" onOpenAutoFocus={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <KitEditor />
      </PopoverContent>
    </Popover>
  )
}

// The player settings popover: skin + kit previews side by side, with the opacity
// slider beneath.
export function PlayerSettingsButton({ side }: { side: 'right' | 'top' }) {
  const p = usePropertyEditing()
  const pushKit = useEditorStore((s) => s.pushKit)
  const [editor, setEditor] = useState<'skin' | 'kit' | null>(null)
  // Switch/close the active editor; pushing the kit to history whenever the kit
  // editor is left.
  const go = (next: 'skin' | 'kit' | null) => {
    if (editor === 'kit' && next !== 'kit' && p.values.kit) pushKit(p.values.kit)
    setEditor(next)
  }
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size="icon" aria-label="Player settings">
              <SlidersHorizontal />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Player</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-50" onInteractOutside={keepOpenOnNested}>
        <div className="grid gap-3">
          <div className="flex items-center gap-6">
            <SkinButton open={editor === 'skin'} onToggle={() => go(editor === 'skin' ? null : 'skin')} />
            <KitButton open={editor === 'kit'} onToggle={() => go(editor === 'kit' ? null : 'kit')} />
          </div>
          <OpacityRow />
        </div>
      </PopoverContent>
      {editor && <Backdrop onClose={() => go(null)} />}
    </Popover>
  )
}

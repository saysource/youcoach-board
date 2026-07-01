import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Slider } from '../ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/cn'
import { useDragTransaction } from '../../lib/use-drag-transaction'
import { usePropertyEditing } from './usePropertyEditing'
import { facePreview, SKIN_PRESETS, HAIR_COLORS, SKIN_COLORS, DEFAULT_SKIN, DEFAULT_HAIR } from '../../lib/player-kit'

// A recolored face.svg (skin + hair) on a neutral circle — the skin preview.
function FaceAvatar({ skin, hair, size = 40, active }: { skin: string; hair: string; size?: number; active?: boolean }) {
  const pv = facePreview(skin, hair)
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted border border-border', active && 'ring-2 ring-primary ring-offset-1 ring-offset-popover')}
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
              <FaceAvatar skin={preset.skin} hair={preset.hair} size={44} active={preset.skin === skin && preset.hair === hair} />
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

// The skin preview button → opens the skin editor.
function SkinButton() {
  const p = usePropertyEditing()
  const skin = p.values.skin ?? DEFAULT_SKIN
  const hair = p.values.hair ?? DEFAULT_HAIR
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size="icon" aria-label="Skin & hair" className="p-0">
              <FaceAvatar skin={skin} hair={hair} size={48} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Skin &amp; hair</TooltipContent>
      </Tooltip>
      {/* Open BELOW the settings popover (not over the canvas), so the settings
          popover stays visible as a click target to dismiss this — clicking the
          canvas would blur the selection. */}
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-auto">
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

// The player settings popover: skin (and later kit) previews side by side, with
// the opacity slider beneath.
export function PlayerSettingsButton({ side }: { side: 'right' | 'top' }) {
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
      <PopoverContent
        side={side}
        align="start"
        className="w-52"
        // Keep open while a nested editor popover is in use.
        onInteractOutside={(e) => {
          const t = (e.detail.originalEvent.target as HTMLElement | null) ?? null
          if (t?.closest('[data-radix-popper-content-wrapper]')) e.preventDefault()
        }}
      >
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <SkinButton />
          </div>
          <OpacityRow />
        </div>
      </PopoverContent>
    </Popover>
  )
}

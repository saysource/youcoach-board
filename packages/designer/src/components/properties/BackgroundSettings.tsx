import { type LogoPosition } from '@youcoach-board/core'
import { useEditorStore } from '../../store/context'
import { Slider } from '../ui/slider'
import { cn } from '../../lib/cn'
import { Swatches } from './PropertyControls'

// Solid background colors (grass greens + futsal greys).
const BG_COLORS = ['#2f8a3e', '#3b7a57', '#5b8c3a', '#d1d1d1', '#e7e7e7', '#ffffff']

// Logo positions laid out on a 3×3 grid (the 4 corners + center).
const LOGO_CELLS: (LogoPosition | null)[] = ['top-left', null, 'top-right', null, 'center', null, 'bottom-left', null, 'bottom-right']

// Background settings shown in the properties panel while a field category is the
// active library category: solid background + color, field scale, logo position.
// (Panning the field via the move-background overlay is a follow-up.)
export function BackgroundSettings() {
  const bg = useEditorStore((s) => s.doc.background)
  const setBackground = useEditorStore((s) => s.setBackground)
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Solid background</span>
        {/* Picking a color switches to a solid background (clears the image). */}
        <Swatches colors={BG_COLORS} value={bg.image ? undefined : bg.color} onChange={(c) => setBackground({ color: c, image: null })} />
      </div>

      <div className="grid gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Field scale</span>
        <Slider
          min={20}
          max={300}
          step={5}
          value={[Math.round(bg.scale * 100)]}
          onValueChange={([v]) => setBackground({ scale: v / 100 })}
        />
      </div>

      <div className="grid gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Logo</span>
        <div className="grid w-[5.25rem] grid-cols-3 gap-1">
          {LOGO_CELLS.map((cell, i) =>
            cell ? (
              <button
                key={cell}
                type="button"
                aria-label={cell}
                aria-pressed={bg.logo === cell}
                onClick={() => setBackground({ logo: cell })}
                className={cn('flex size-6 items-center justify-center rounded-sm border border-border hover:bg-accent', bg.logo === cell && 'bg-primary/20')}
              >
                <span className="size-1.5 rounded-full bg-current opacity-60" />
              </button>
            ) : (
              <span key={i} className="size-6" />
            ),
          )}
        </div>
        <button
          type="button"
          onClick={() => setBackground({ logo: null })}
          className={cn('w-fit rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent', !bg.logo && 'bg-primary/20 font-medium')}
        >
          No logo
        </button>
      </div>
    </div>
  )
}

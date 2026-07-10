import { useState, type CSSProperties } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { cn } from '../../lib/cn'
import { useEditorStore } from '../../store/context'
import fadeIcon from '../../assets/effects/effect_fade.svg'
import zoomIcon from '../../assets/effects/effect_zoom.svg'
import dropIcon from '../../assets/effects/effect_drop.svg'
import floatIcon from '../../assets/effects/effect_float.svg'
import floatOutIcon from '../../assets/effects/effect_float_out.svg'
import slideIcon from '../../assets/effects/effect_slide.svg'
import slideOutIcon from '../../assets/effects/effect_slide_out.svg'

// Enter/exit effects picker (specs/animation.md "Special effects"): a panel
// like YouCoach Video Analysis' — In/Out tabs and a grid of canned animations
// applied when the element enters/leaves the scene between animation frames.
// Icons are VA's; directional variants rotate the base arrow icon like VA does.

const ROT90: CSSProperties = { transform: 'rotate(90deg)' }
const ROT90F: CSSProperties = { transform: 'rotate(90deg) scaleY(-1)' }
const ROT180: CSSProperties = { transform: 'rotate(180deg)' }

interface EffectDef {
  id: string
  label: string
  icon: string | null // null = the empty "None" tile
  style?: CSSProperties
}

const IN_EFFECTS: EffectDef[] = [
  { id: 'none', label: 'None', icon: null },
  { id: 'fade', label: 'Fade In', icon: fadeIcon },
  { id: 'zoom', label: 'Zoom', icon: zoomIcon },
  { id: 'drop', label: 'Drop', icon: dropIcon },
  { id: 'float_up', label: 'Float Up', icon: floatIcon },
  { id: 'float_down', label: 'Float Down', icon: floatIcon, style: ROT180 },
  { id: 'float_left', label: 'Float Left', icon: floatIcon, style: ROT90F },
  { id: 'float_right', label: 'Float Right', icon: floatIcon, style: ROT90 },
  { id: 'slide_up', label: 'Slide Up', icon: slideIcon },
  { id: 'slide_down', label: 'Slide Down', icon: slideIcon, style: ROT180 },
  { id: 'slide_left', label: 'Slide Left', icon: slideIcon, style: ROT90F },
  { id: 'slide_right', label: 'Slide Right', icon: slideIcon, style: ROT90 },
]

const OUT_EFFECTS: EffectDef[] = [
  { id: 'none', label: 'None', icon: null },
  { id: 'fade', label: 'Fade Out', icon: fadeIcon },
  // VA swaps these two icons for the out direction (zoom shrinks, lift grows).
  { id: 'zoom', label: 'Zoom', icon: dropIcon },
  { id: 'lift', label: 'Lift', icon: zoomIcon },
  { id: 'float_down', label: 'Float Down', icon: floatOutIcon },
  { id: 'float_up', label: 'Float Up', icon: floatOutIcon, style: ROT180 },
  { id: 'float_right', label: 'Float Right', icon: floatOutIcon, style: ROT90F },
  { id: 'float_left', label: 'Float Left', icon: floatOutIcon, style: ROT90 },
  { id: 'slide_down', label: 'Slide Down', icon: slideOutIcon },
  { id: 'slide_up', label: 'Slide Up', icon: slideOutIcon, style: ROT180 },
  { id: 'slide_right', label: 'Slide Right', icon: slideOutIcon, style: ROT90F },
  { id: 'slide_left', label: 'Slide Left', icon: slideOutIcon, style: ROT90 },
]

/** Elements that carry enter/exit effects: everything placed via the 2D
 *  transform (object3d/arrow3d degrade to fade/pop and keep no setting). */
const HAS_EFFECTS = (type: string) => type !== 'object3d' && type !== 'arrow3d'

export function EffectsButton({ side, small, translucent }: { side: 'right' | 'top'; small?: boolean; translucent?: boolean }) {
  const elements = useEditorStore((s) => s.doc.elements)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const updateElements = useEditorStore((s) => s.updateElements)
  const [tab, setTab] = useState<'in' | 'out'>('in')
  const sel = elements.filter((e) => selectedIds.includes(e.id) && HAS_EFFECTS(e.type))
  if (sel.length === 0) return null
  const first = sel[0]
  const current = tab === 'in' ? (first.effectIn ?? 'fade') : (first.effectOut ?? 'fade')

  function pick(id: string) {
    const key = tab === 'in' ? 'effectIn' : 'effectOut'
    updateElements(sel.map((e) => ({ id: e.id, before: { [key]: e[key] }, after: { [key]: id } })))
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label="Effects" className={cn(translucent && 'border border-border/60 bg-card/75 shadow-sm backdrop-blur-sm')}>
              <Sparkles />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Enter/exit effects</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-72 p-2">
        {/* In / Out tabs (VA's layout). */}
        <div className="mb-2 flex border-b border-border">
          {(
            [
              ['in', 'In'],
              ['out', 'Out'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'flex-1 pb-1.5 text-center text-sm font-medium text-muted-foreground',
                tab === value && 'border-b-2 border-primary text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(tab === 'in' ? IN_EFFECTS : OUT_EFFECTS).map((fx) => (
            <button
              key={fx.id}
              onClick={() => pick(fx.id)}
              aria-pressed={current === fx.id}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-md border p-1 hover:bg-primary/10',
                current === fx.id ? 'border-primary bg-primary/15' : 'border-transparent',
              )}
            >
              <span className="flex h-[75px] w-full items-center justify-center overflow-hidden rounded bg-muted">
                {fx.icon && <img src={fx.icon} alt="" className="size-16" style={fx.style} draggable={false} />}
              </span>
              <span className="w-full truncate text-center text-sm leading-tight text-muted-foreground">{fx.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

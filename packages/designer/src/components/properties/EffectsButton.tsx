import { useState, type CSSProperties } from 'react'
import { ChevronRight, Keyboard, Sparkles, UnfoldHorizontal } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Switch } from '../ui/switch'
import { Separator } from '../ui/separator'
import { ColorPickerWidget } from './ColorPickerWidget'
import { cn } from '../../lib/cn'
import { useEditorStore } from '../../store/context'
import { isObject3DBall } from '../../lib/objects3d'
import fadeIcon from '../../assets/effects/effect_fade.svg'
import zoomIcon from '../../assets/effects/effect_zoom.svg'
import dropIcon from '../../assets/effects/effect_drop.svg'
import floatIcon from '../../assets/effects/effect_float.svg'
import floatOutIcon from '../../assets/effects/effect_float_out.svg'
import slideIcon from '../../assets/effects/effect_slide.svg'
import slideOutIcon from '../../assets/effects/effect_slide_out.svg'
import pathIcon from '../../assets/effects/effect_forming_path.svg'
import pathOutIcon from '../../assets/effects/effect_forming_path_out.svg'

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
  /** Icon: an image URL (VA's SVGs), a rendered node (lucide, for the text
   *  effects), or null = the empty "None" tile. */
  icon: string | React.ReactNode | null
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

// Lines only (spec "Lines"): the line forms itself along its own path (the
// arrow tip rides the forming end); out = the line retracts.
const PATH_IN: EffectDef = { id: 'path', label: 'Path', icon: pathIcon }
const PATH_OUT: EffectDef = { id: 'path', label: 'Path', icon: pathOutIcon }

// Texts only — their OWN category, composed on top of the standard effect:
// letter-spacing glide (Tracking) and progressive characters (Typewriter,
// deliberately linear); out plays them in reverse (spread apart / delete).
const TEXT_EFFECTS: EffectDef[] = [
  { id: 'none', label: 'None', icon: null },
  { id: 'tracking', label: 'Tracking', icon: <UnfoldHorizontal className="size-9 text-muted-foreground" strokeWidth={1.5} /> },
  { id: 'typewriter', label: 'Typewriter', icon: <Keyboard className="size-9 text-muted-foreground" strokeWidth={1.5} /> },
]

// 3D arrows only — their own composed category: 'path' forms the arrow by
// animating its completeness (splineLength) from 0 to the authored value.
const LENGTH_EFFECTS_IN: EffectDef[] = [
  { id: 'none', label: 'None', icon: null },
  { id: 'path', label: 'Path', icon: pathIcon },
]
const LENGTH_EFFECTS_OUT: EffectDef[] = [
  { id: 'none', label: 'None', icon: null },
  { id: 'path', label: 'Path', icon: pathOutIcon },
]

function EffectGrid({ label, effects, current, onPick, collapsible, open, onToggle }: { label?: string; effects: EffectDef[]; current: string; onPick: (id: string) => void; collapsible?: boolean; open?: boolean; onToggle?: () => void }) {
  const currentLabel = effects.find((fx) => fx.id === current)?.label ?? current
  return (
    <div>
      {label &&
        (collapsible ? (
          // Collapsed section header (VA's layout): disclosure + name on the
          // left, the CHOSEN effect on the right.
          <button onClick={onToggle} className="flex w-full items-center gap-1 rounded-md py-1.5 pr-1 text-sm hover:bg-primary/10">
            <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
            <span className="flex-1 text-left font-medium text-foreground">{label}</span>
            <span className="text-muted-foreground">{currentLabel}</span>
          </button>
        ) : (
          <div className="mb-1 text-sm font-medium text-foreground">{label}</div>
        ))}
      {collapsible && !open ? null : (
      <div className="grid grid-cols-3 gap-1">
        {effects.map((fx) => (
          <button
            key={fx.id}
            onClick={() => onPick(fx.id)}
            aria-pressed={current === fx.id}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-md border p-1 hover:bg-primary/10',
              current === fx.id ? 'border-primary bg-primary/15' : 'border-transparent',
            )}
          >
            <span className="flex h-[75px] w-full items-center justify-center overflow-hidden rounded bg-muted">
              {typeof fx.icon === 'string' ? <img src={fx.icon} alt="" className="size-16" style={fx.style} draggable={false} /> : fx.icon}
            </span>
            <span className="w-full truncate text-center text-sm leading-tight text-muted-foreground">{fx.label}</span>
          </button>
        ))}
      </div>
      )}
    </div>
  )
}

export function EffectsButton({ side, small, translucent }: { side: 'right' | 'top'; small?: boolean; translucent?: boolean }) {
  const elements = useEditorStore((s) => s.doc.elements)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const updateElements = useEditorStore((s) => s.updateElements)
  const currentFrame = useEditorStore((s) => s.currentFrame)
  const frames = useEditorStore((s) => s.doc.animation.frames)
  const setFrameEffects = useEditorStore((s) => s.setFrameEffects)
  const [tab, setTab] = useState<'in' | 'out' | 'between'>('in')
  // Scope of the movement-effects tab: "Whole animation" edits the object-
  // level fields; "This move" writes a per-turn override for the transition
  // INTO the frame being edited (the movement-path mental model).
  const [scope, setScope] = useState<'all' | 'move'>('all')
  // Which section is expanded (VA-style accordion) for the sectioned layouts
  // (closed shapes: Border/Fill; texts: Effect/Text).
  const [openSection, setOpenSection] = useState<'first' | 'second' | null>('first')
  const sel = elements.filter((e) => selectedIds.includes(e.id))
  if (sel.length === 0) return null
  const first = sel[0]
  // The Path (line-forming) effect is offered when the whole selection is open
  // point paths (lines/arrows/freehand) — and for closed shapes' BORDERS below.
  const allLines = sel.every((e) => e.type === 'draw' || (e.type === 'polyline' && !e.closed))
  // Closed shapes (rect/ellipse/closed polyline) split into Border + Fill
  // sections, each with its own effect (specs/animation.md "Closed paths").
  const allClosed = sel.every((e) => e.type === 'rect' || e.type === 'ellipse' || (e.type === 'polyline' && e.closed))
  const allTexts = sel.every((e) => e.type === 'text')
  const allArrows3d = sel.every((e) => e.type === 'arrow3d')
  // Tail/Pulse apply to anything that MOVES as a unit on the pitch: tokens and
  // 3D objects (players/materials/ball).
  const allMovable = sel.every((e) => e.type === 'token' || e.type === 'object3d')
  // Ball-specific movement effects: Power Shot (its kick-and-glide easing) and
  // the Parabolic (lofted) shot.
  const allBalls = sel.every((e) => e.type === 'object3d' && isObject3DBall(e.objectId))
  const baseEffects = tab === 'in' ? IN_EFFECTS : OUT_EFFECTS
  const pathTile = tab === 'in' ? PATH_IN : PATH_OUT

  type Part = 'main' | 'fill' | 'text' | 'length'
  const KEYS: Record<Part, [string, string]> = {
    main: ['effectIn', 'effectOut'],
    fill: ['fillEffectIn', 'fillEffectOut'],
    text: ['textEffectIn', 'textEffectOut'],
    length: ['lengthEffectIn', 'lengthEffectOut'],
  }

  function currentOf(part: Part): string {
    const key = KEYS[part][tab === 'in' ? 0 : 1]
    const v = (first as unknown as Record<string, string | undefined>)[key]
    return v ?? (part === 'text' || part === 'length' ? 'none' : 'fade')
  }

  // The movement-effects tab (see the scope state above). Frame 1 has no
  // incoming move.
  const canMove = currentFrame > 0 && currentFrame < frames.length
  const moveScope = scope === 'move' && canMove
  const override = moveScope ? frames[currentFrame]?.effects?.[first.id] : undefined
  // Override keys ↔ the object-level field names.
  const OV: Record<string, keyof NonNullable<typeof override>> = { effectTail: 'tail', effectTailColor: 'tailColor', effectPulse: 'pulse', effectPulseColor: 'pulseColor', effectEase: 'ease', effectPower: 'power', effectParabolic: 'parabolic' }

  function setField(key: string, value: boolean | string) {
    if (moveScope) {
      for (const e of sel) setFrameEffects(currentFrame, e.id, { [OV[key]]: value })
      return
    }
    updateElements(sel.map((e) => ({ id: e.id, before: { [key]: (e as unknown as Record<string, unknown>)[key] }, after: { [key]: value } })))
  }
  // Effective values shown by the switches: the override (this move) wins.
  const fv = new Proxy(first as unknown as Record<string, unknown>, {
    get: (target, key: string) => {
      if (moveScope && override && OV[key] && override[OV[key]] !== undefined) return override[OV[key]]
      return target[key]
    },
  })

  function pick(id: string, part: Part = 'main') {
    const key = KEYS[part][tab === 'in' ? 0 : 1]
    updateElements(sel.map((e) => ({ id: e.id, before: { [key]: (e as unknown as Record<string, string | undefined>)[key] }, after: { [key]: id } })))
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
        {/* In / Out (+ Between for tokens) tabs (VA's layout). */}
        <div className="mb-2 flex border-b border-border">
          {(
            [
              ['in', 'In'] as const,
              ['out', 'Out'] as const,
              ['between', 'Effects'] as const,
            ]
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
        {tab === 'between' ? (
          <div className="space-y-2">
            {/* Scope: animation-wide vs just the move INTO the current frame. */}
            <div className="flex rounded-md border border-border p-0.5">
              {(
                [
                  ['all', 'Whole animation'],
                  ['move', 'This move'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  disabled={value === 'move' && !canMove}
                  onClick={() => setScope(value)}
                  className={cn(
                    'flex-1 rounded px-1 py-1 text-xs font-medium text-muted-foreground disabled:opacity-40',
                    scope === value && 'bg-primary/20 text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {moveScope && override && (
              <button onClick={() => sel.forEach((e) => setFrameEffects(currentFrame, e.id, null))} className="w-full rounded-md border border-border py-1 text-xs text-muted-foreground hover:bg-primary/10">
                Use animation settings for this move
              </button>
            )}
            {/* Movement effects: independently toggleable, configured inline.
                Tail/Pulse are token effects; Easy Easing (the element's own
                transition easing) applies to EVERY element type. */}
            {allMovable && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Tail</span>
                  <Switch checked={!!fv.effectTail} onCheckedChange={(v) => setField('effectTail', v)} />
                </div>
                {!!fv.effectTail && (
                  <div className="grid gap-1.5 pl-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Tail color</span>
                    <ColorPickerWidget
                      value={(fv.effectTailColor as string) ?? (fv.color1 as string)}
                      onChange={(c) => setField('effectTailColor', c)}
                      showOpacity={false}
                      allowTransparent={false}
                    />
                  </div>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Pulse</span>
                  <Switch checked={!!fv.effectPulse} onCheckedChange={(v) => setField('effectPulse', v)} />
                </div>
                {!!fv.effectPulse && (
                  <div className="grid gap-1.5 pl-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Pulse color</span>
                    <ColorPickerWidget
                      value={(fv.effectPulseColor as string) ?? (fv.color1 as string)}
                      onChange={(c) => setField('effectPulseColor', c)}
                      showOpacity={false}
                      allowTransparent={false}
                    />
                  </div>
                )}
                <Separator />
              </>
            )}
            {allBalls && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Parabolic Shot</span>
                  <Switch checked={!!fv.effectParabolic} onCheckedChange={(v) => setField('effectParabolic', v)} />
                </div>
                <Separator />
              </>
            )}
            {/* Easy Easing applies to every element; the ball ALSO offers Power
                Shot as an alternative easing — the two are mutually exclusive. */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Easy Easing</span>
              <Switch
                checked={!!fv.effectEase}
                onCheckedChange={(v) => {
                  setField('effectEase', v)
                  if (v && fv.effectPower) setField('effectPower', false)
                }}
              />
            </div>
            {allBalls && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Power Shot</span>
                <Switch
                  checked={!!fv.effectPower}
                  onCheckedChange={(v) => {
                    setField('effectPower', v)
                    if (v && fv.effectEase) setField('effectEase', false)
                  }}
                />
              </div>
            )}
          </div>
        ) : allClosed ? (
          <div className="max-h-[480px] space-y-1 divide-y divide-border overflow-y-auto">
            {/* Border first (it also offers Path — the outline forming). */}
            <EffectGrid label="Border" effects={baseEffects.concat([pathTile])} current={currentOf('main')} onPick={(id) => pick(id, 'main')} collapsible open={openSection === 'first'} onToggle={() => setOpenSection((s) => (s === 'first' ? null : 'first'))} />
            <EffectGrid label="Fill" effects={baseEffects} current={currentOf('fill')} onPick={(id) => pick(id, 'fill')} collapsible open={openSection === 'second'} onToggle={() => setOpenSection((s) => (s === 'second' ? null : 'second'))} />
          </div>
        ) : allArrows3d ? (
          <div className="max-h-[480px] space-y-1 divide-y divide-border overflow-y-auto">
            {/* Standard effect + the composed ARROW LENGTH category (so the
                opacity ramp stays opt-in via the standard effect). */}
            <EffectGrid label="Effect" effects={baseEffects} current={currentOf('main')} onPick={(id) => pick(id, 'main')} collapsible open={openSection === 'first'} onToggle={() => setOpenSection((s) => (s === 'first' ? null : 'first'))} />
            <EffectGrid label="Arrow Length" effects={tab === 'in' ? LENGTH_EFFECTS_IN : LENGTH_EFFECTS_OUT} current={currentOf('length')} onPick={(id) => pick(id, 'length')} collapsible open={openSection === 'second'} onToggle={() => setOpenSection((s) => (s === 'second' ? null : 'second'))} />
          </div>
        ) : allTexts ? (
          <div className="max-h-[480px] space-y-1 divide-y divide-border overflow-y-auto">
            {/* Standard effect + the composed TEXT effect (its own category). */}
            <EffectGrid label="Effect" effects={baseEffects} current={currentOf('main')} onPick={(id) => pick(id, 'main')} collapsible open={openSection === 'first'} onToggle={() => setOpenSection((s) => (s === 'first' ? null : 'first'))} />
            <EffectGrid label="Text" effects={TEXT_EFFECTS} current={currentOf('text')} onPick={(id) => pick(id, 'text')} collapsible open={openSection === 'second'} onToggle={() => setOpenSection((s) => (s === 'second' ? null : 'second'))} />
          </div>
        ) : (
          <EffectGrid effects={baseEffects.concat(allLines ? [pathTile] : [])} current={currentOf('main')} onPick={(id) => pick(id, 'main')} />
        )}
      </PopoverContent>
    </Popover>
  )
}

import { type ComponentType, type ReactNode } from 'react'
import {
  SlidersHorizontal,
  Box,
  MoreHorizontal,
  CopyPlus,
  FlipHorizontal2,
  ClipboardCopy,
  ClipboardPaste,
  BringToFront,
  SendToBack,
  ArrowUp,
  ArrowDown,
  Trash2,
  Copy,
  Undo2,
  Redo2,
  Minus,
  MoveRight,
  RotateCcw,
  Lock,
  Unlock,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignVerticalDistributeCenter,
} from 'lucide-react'
import { type ArrowTip, type BoardElement, type Arrow3DElement, type TokenShape, type TokenFill, type TextAlign, ElementView, IDENTITY_TRANSFORM, WAVE_LENGTH_MIN, WAVE_LENGTH_MAX, WAVE_AMPLITUDE_MAX, LINES_OFFSET_MIN, LINES_OFFSET_MAX, TEXT_MIN_FONT, TEXT_MAX_FONT } from '@youcoach-board/core'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { cn } from '../../lib/cn'
import { CHECKER_IMAGE } from '../../lib/checker'
import { useDragTransaction } from '../../lib/use-drag-transaction'
import { useEditorStore } from '../../store/context'
import type { Breakpoint } from '../../lib/use-breakpoint'
import { ClosePathIcon, LineStylePlainIcon, LineStyleCurvedIcon, LineStyleZigzagIcon, LineStyleDoubleIcon, OpenPathIcon, PolylineIcon, TokenDiscIcon, JerseyIcon } from '../icons'
import { PropertyControls, Segmented } from './PropertyControls'
import { ColorPickerWidget } from './ColorPickerWidget'
import { usePropertyEditing, type TokenVisualStyle } from './usePropertyEditing'
import { PlayerSettingsButton } from './PlayerSettings'
import { SubjectHeader } from './SubjectHeader'
import { BackgroundSettings, BackgroundColorPicker } from './BackgroundSettings'

const isTransparent = (c?: string) => !c || c === 'transparent'
// Translucent, blurred buttons for the mobile bar — float over the canvas.
const TRANSLUCENT = 'border border-border/60 bg-card/75 shadow-sm backdrop-blur-sm'

// The minimal properties toolbar (replaces the old full panel): a left-side
// vertical cluster of icon buttons, each opening a dropdown widget. Background
// settings (field editing) take over only when nothing is selected.
export function PropertiesPanel({ mode, backgroundMode = false }: { mode: Breakpoint; backgroundMode?: boolean }) {
  if (mode !== 'full' && mode !== 'compact') return null
  return <PropertiesBar backgroundMode={backgroundMode} />
}

// The background-edit toolbar: a left-side vertical cluster with the background
// color, settings (scale + logo), and reset — shown only in background-edit mode.
function BackgroundEditBar() {
  const bg = useEditorStore((s) => s.doc.background)
  const resetBackground = useEditorStore((s) => s.resetBackground)
  return (
    <div className="pointer-events-auto absolute left-3 top-16 z-30 flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg">
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button size="icon" aria-label="Background color">
                <span className="size-6 flex items-center justify-center rounded-lg" style={{ backgroundImage: CHECKER_IMAGE, backgroundColor: '#ffffff' }}>
                  <span className="size-6 rounded-lg border border-border/70" style={bg.image ? undefined : { background: bg.color }} />
                </span>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Background color</TooltipContent>
        </Tooltip>
        <PopoverContent side="right" align="start" className="w-56">
          <BackgroundColorPicker />
        </PopoverContent>
      </Popover>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button size="icon" aria-label="Background settings">
                <SlidersHorizontal />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Scale & logo</TooltipContent>
        </Tooltip>
        <PopoverContent side="right" align="start" className="w-52">
          <BackgroundSettings />
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" aria-label="Reset background" onClick={resetBackground}>
            <RotateCcw />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reset background</TooltipContent>
      </Tooltip>
    </div>
  )
}

function PropertiesBar({ backgroundMode }: { backgroundMode: boolean }) {
  const p = usePropertyEditing()
  if (backgroundMode) return <BackgroundEditBar />
  // Nothing to edit (the select/hand tool is active with no selection) → no panel.
  // It appears for a selection (to edit it) or a creation tool (future-element style).
  if (!p.editable) return null
  return (
    <>
      {/* <div className="w-[50px] opacity-50 pointer-events-auto absolute left-3 top-14 z-30 flex flex-col items-center gap-1 p-1.5"><SubjectHeader compact /></div> */}
      <div className="pointer-events-auto absolute left-3 top-16 z-30 flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg">
        <SubjectHeader compact />
        <span className="my-0.5 h-px w-6 bg-border" />
        {p.allToken ? (
          // Tokens carry a self-contained editor (type, colors, fill, text, opacity).
          <TokenSettingsButton side="right" />
        ) : p.allText ? (
          // Text: color (stroke-style widget), background color (with opacity), and a
          // settings popover (font size + alignment).
          <>
            <ColorButton kind="fill" label="Text color" value={p.values.textColor} onChange={p.setTextColor} side="right" />
            <ColorButton kind="fill" label="Background" value={p.values.bgColor} onChange={p.setBgColor} side="right" />
            <TextSettingsButton side="right" />
          </>
        ) : p.allPlayer ? (
          // Player: skin/kit editors + opacity in one settings popover. 3D player
          // characters additionally keep the object size controls (no body color —
          // their look is the skin/kit, not a tint).
          <>
            <PlayerSettingsButton side="right" />
            {p.allObject3D && <Object3DSettingsButton side="right" />}
          </>
        ) : p.allArrow3d ? (
          // 3D arrow: colour + a settings popover (opacity + geometry).
          <Arrow3DControls side="right" />
        ) : p.allObject3D ? (
          // 3D object/material: colour (tintable ones) + a size settings popover.
          <Object3DControls side="right" />
        ) : p.allMaterialColor ? (
          // Material: a single custom color (yc-color-1), no opacity, + opacity settings.
          <>
            <ColorButton kind="fill" label="Color" value={p.values.materialColor} onChange={p.setMaterialColor} side="right" showOpacity={false} />
            <SettingsButton side="right" />
          </>
        ) : (
          <>
            {p.hasClosed && (
              <ColorButton kind="fill" label="Background" value={p.values.fill} onChange={p.setFill} side="right" fillStyle={p.values.fillStyle} onFillStyleChange={p.setFillStyle} />
            )}
            {/* Figures ignore stroke, so no Border color for them. */}
            {!p.allFigure && <ColorButton kind="stroke" label="Border" value={p.values.stroke} onChange={p.setStroke} side="right" />}
            <SettingsButton side="right" />
          </>
        )}
        {p.count > 0 && (
          <>
            <span className="my-0.5 h-px w-6 bg-border" />
            <LockButton />
            <ActionsMenu side="right" />
          </>
        )}
        {p.allToken && <TokenStyleButtons apply={p.applyTokenStyle} side="right" />}
      </div>
    </>
  )
}

// The team-style cluster: one copy-style button per distinct token look on the
// board (up to 4). Clicking re-styles the selected token(s) to match. Hidden when
// the board has no tokens.
function TokenStyleButtons({ apply, side }: { apply: (style: TokenVisualStyle) => void; side: 'right' | 'top' }) {
  const elements = useEditorStore((s) => s.doc.elements)
  const activeTool = useEditorStore((s) => s.activeTool)
  const tokenDefaults = useEditorStore((s) => s.tokenDefaults)
  const styles = boardTokenStyles(elements)
  if (styles.length === 0) return null
  // With the Token tool up, outline the preset the NEXT token will actually use
  // (the current next-token defaults) — nothing is selected, so no per-element edit.
  const activeKey =
    activeTool === 'token'
      ? tokenStyleKey({ shape: tokenDefaults.shape, tokenFill: tokenDefaults.tokenFill, color1: tokenDefaults.color1, color2: tokenDefaults.color2, textColor: tokenDefaults.textColor })
      : null
  return (
    <>
      <span className={side === 'top' ? 'mx-0.5 h-6 w-px bg-border' : 'my-0.5 h-px w-6 bg-border'} />
      {styles.map((style) => (
        <TokenStyleButton key={tokenStyleKey(style)} style={style} onApply={() => apply(style)} active={tokenStyleKey(style) === activeKey} side={side} />
      ))}
    </>
  )
}

// A circle swatch button that opens the color picker. `kind` controls the glyph:
// 'fill' shows a filled disc, 'stroke' a ring.
function ColorButton({
  kind,
  label,
  value,
  onChange,
  side,
  small,
  translucent,
  fillStyle,
  onFillStyleChange,
  showOpacity,
}: {
  kind: 'fill' | 'stroke'
  label: string
  value: string | undefined
  onChange: (c: string) => void
  side: 'right' | 'top'
  small?: boolean
  translucent?: boolean
  fillStyle?: 'solid' | 'striped'
  onFillStyleChange?: (s: 'solid' | 'striped') => void
  /** Hide the opacity slider (e.g. material colors have no opacity). */
  showOpacity?: boolean
}) {
  const swatchStyle = isTransparent(value)
    ? {}
    : fillStyle === 'striped'
      ? { backgroundImage: `repeating-linear-gradient(135deg, ${value} 0 3px, transparent 3px 6px)` }
      : { background: value }
  return (
    // The undo transaction is owned by ColorPickerWidget's lifecycle (begins on
    // mount, commits on unmount) — robust to every way the popover can close.
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label={label} className={cn(translucent && TRANSLUCENT)}>
              {kind === 'fill' ? (
                <span className="size-6 flex items-center justify-center rounded-lg" style={{ backgroundImage: CHECKER_IMAGE, backgroundColor: '#ffffff' }}>
                <span className="size-6 rounded-lg border border-border/70" style={swatchStyle} />
                </span>
              ) : (
                <span className="size-6 rounded-lg border-[3px] border-border" style={isTransparent(value) ? undefined : { borderColor: value as string }} />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-56">
        <ColorPickerWidget value={value} onChange={onChange} fillStyle={fillStyle} onFillStyleChange={onFillStyleChange} showOpacity={showOpacity} />
      </PopoverContent>
    </Popover>
  )
}

// 3D-arrow controls: a colour swatch + a settings popover for opacity and the
// arrow geometry (thickness / widths / arc). Edits the selected arrow(s) directly.
function Arrow3DControls({ side }: { side: 'right' | 'top' }) {
  const doc = useEditorStore((s) => s.doc)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const updateElements = useEditorStore((s) => s.updateElements)
  const arrows = doc.elements.filter((e): e is Arrow3DElement => e.type === 'arrow3d' && selectedIds.includes(e.id))
  const first = arrows[0]
  if (!first) return null
  const setField = <K extends keyof Arrow3DElement>(k: K, v: Arrow3DElement[K]) => updateElements(arrows.map((a) => ({ id: a.id, before: { [k]: a[k] }, after: { [k]: v } })))
  return (
    <>
      <ColorButton kind="fill" label="Color" value={first.fill} onChange={(c) => setField('fill', c)} side={side} showOpacity={false} />
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button size="icon" aria-label="3D arrow settings">
                <SlidersHorizontal />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Arrow settings</TooltipContent>
        </Tooltip>
        <PopoverContent side={side} align="start" className="w-56">
          <div className="grid gap-3">
            <Field label={`Opacity (${Math.round(first.opacity * 100)}%)`}>
              <WaveSlider min={0} max={100} value={Math.round(first.opacity * 100)} onChange={(v) => setField('opacity', v / 100)} />
            </Field>
            <Field label="Curve height">
              <WaveSlider min={0} max={80} value={Math.round(first.splineHeight * 10)} onChange={(v) => setField('splineHeight', v / 10)} />
            </Field>
            <Field label="Completeness">
              <WaveSlider min={10} max={100} value={Math.round(first.splineLength * 100)} onChange={(v) => setField('splineLength', v / 100)} />
            </Field>
            <Field label="Thickness">
              <WaveSlider min={1} max={40} value={Math.round(first.thickness * 100)} onChange={(v) => setField('thickness', v / 100)} />
            </Field>
            <Field label="Stick width">
              <WaveSlider min={5} max={100} value={Math.round(first.stickWidth * 100)} onChange={(v) => setField('stickWidth', v / 100)} />
            </Field>
            <Field label="Tip width">
              <WaveSlider min={5} max={80} value={Math.round(first.tipWidth * 100)} onChange={(v) => setField('tipWidth', v / 100)} />
            </Field>
            <Field label="Tip length">
              <WaveSlider min={10} max={150} value={Math.round(first.tipLength * 100)} onChange={(v) => setField('tipLength', v / 100)} />
            </Field>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

// A lock/unlock toggle for the current selection. Locked elements can be selected
// (to unlock here) but not moved, resized, rotated, inline-edited or deleted on the
// canvas. Shows an open padlock to lock, a closed one (highlighted) to unlock.
function LockButton() {
  const doc = useEditorStore((s) => s.doc)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const toggleLock = useEditorStore((s) => s.toggleLock)
  const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
  const allLocked = sel.length > 0 && sel.every((e) => e.locked)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" aria-label={allLocked ? 'Unlock' : 'Lock'} aria-pressed={allLocked} onClick={toggleLock} className={cn(allLocked && 'text-primary')}>
          {allLocked ? <Lock /> : <Unlock />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{allLocked ? 'Unlock' : 'Lock'}</TooltipContent>
    </Tooltip>
  )
}

// 3D object/material controls: a body colour (tintable materials only, no opacity —
// the stroke widget) plus a settings popover with "use global size" + a size slider.
function Object3DControls({ side }: { side: 'right' | 'top' }) {
  const p = usePropertyEditing()
  return (
    <>
      {p.allObject3DColor && <ColorButton kind="fill" label="Color" value={p.values.object3dColor} onChange={p.setObject3DColor} side={side} showOpacity={false} />}
      {/* Per-part colors for multi-material objects (e.g. flag pole: Pole + Flag). */}
      {p.object3dSlots.map((s) => (
        <ColorButton key={s.id} kind="fill" label={s.label} value={p.values.object3dSlotColors[s.id]} onChange={(c) => p.setObject3DSlotColor(s.id, c)} side={side} showOpacity={false} />
      ))}
      <Object3DSettingsButton side={side} />
    </>
  )
}

// Size range as a multiplier of the global scale: down to 1/5×, up to 10×, with the
// slider MIDPOINT = the global size (1×). Log-mapped so each half is proportional.
const OBJ_SIZE_MIN = 0.2
const OBJ_SIZE_MAX = 10
function objSizeToSlider(size: number): number {
  const s = Math.min(OBJ_SIZE_MAX, Math.max(OBJ_SIZE_MIN, size))
  return s <= 1 ? ((Math.log(s) - Math.log(OBJ_SIZE_MIN)) / -Math.log(OBJ_SIZE_MIN)) * 50 : 50 + (Math.log(s) / Math.log(OBJ_SIZE_MAX)) * 50
}
function objSliderToSize(v: number): number {
  const t = v / 100
  const s = t <= 0.5 ? Math.exp(Math.log(OBJ_SIZE_MIN) * (1 - t * 2)) : Math.exp(Math.log(OBJ_SIZE_MAX) * ((t - 0.5) * 2))
  return Math.round(s * 100) / 100
}

function Object3DSettingsButton({ side }: { side: 'right' | 'top' }) {
  const p = usePropertyEditing()
  const useGlobal = p.values.object3dUseGlobal ?? true
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size="icon" aria-label="Object size">
              <Box />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Size</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-56">
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">Use global size</span>
            <Switch checked={useGlobal} onCheckedChange={p.setObject3DUseGlobal} />
          </div>
          {/* Always shown; disabled (and parked at the global midpoint) while the
              object follows the global size, so the control stays visible. */}
          <div className={cn('grid gap-1.5', useGlobal && 'opacity-60')}>
            <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>Small</span>
              <span>Big</span>
            </div>
            <WaveSlider min={0} max={100} disabled={useGlobal} value={useGlobal ? 50 : Math.round(objSizeToSlider(p.values.object3dSize ?? 1))} onChange={(v) => p.setObject3DSize(objSliderToSize(v))} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SettingsButton({ side, small, translucent }: { side: 'right' | 'top'; small?: boolean; translucent?: boolean }) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label="Settings" className={cn(translucent && TRANSLUCENT)}>
              <SlidersHorizontal />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-52">
        <SettingsWidget />
      </PopoverContent>
    </Popover>
  )
}

const ALIGN_ITEMS: { value: TextAlign; label: string; render: ReactNode }[] = [
  { value: 'left', label: 'Left', render: <AlignLeft className="size-4" /> },
  { value: 'center', label: 'Center', render: <AlignCenter className="size-4" /> },
  { value: 'right', label: 'Right', render: <AlignRight className="size-4" /> },
]

// 3D-text reading direction about the field X axis.
const ORIENT_ITEMS: { value: number; label: string; render: ReactNode }[] = [
  { value: 0, label: '0°', render: <span className="text-[11px]">0°</span> },
  { value: 90, label: '90°', render: <span className="text-[11px]">90°</span> },
  { value: 180, label: '180°', render: <span className="text-[11px]">180°</span> },
  { value: 270, label: '270°', render: <span className="text-[11px]">270°</span> },
]

// Text element settings popover: font size (2–200) + line alignment. Color and
// background are their own toolbar buttons (like a shape's border/fill).
function TextSettingsButton({ side, small, translucent }: { side: 'right' | 'top'; small?: boolean; translucent?: boolean }) {
  const p = usePropertyEditing()
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label="Text settings" className={cn(translucent && TRANSLUCENT)}>
              <SlidersHorizontal />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Text</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-56">
        <div className="grid gap-3">
          <Field label={`Font size (${p.values.fontSize ?? 0})`}>
            <WaveSlider min={TEXT_MIN_FONT} max={TEXT_MAX_FONT} value={p.values.fontSize ?? 0} onChange={p.setFontSize} />
          </Field>
          <Field label="Alignment">
            <Segmented items={ALIGN_ITEMS} value={p.values.align} onChange={p.setAlign} />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">Bold</span>
            <Switch checked={!!p.values.bold} onCheckedChange={p.setBold} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">On field (3D)</span>
            <Switch checked={!!p.values.text3d} onCheckedChange={p.setText3d} />
          </div>
          {p.values.text3d && (
            <Field label="Orientation">
              <Segmented items={ORIENT_ITEMS} value={p.values.orientation ?? 0} onChange={p.setOrientation} />
            </Field>
          )}
          <Field label="Opacity">
            <WaveSlider min={0} max={100} value={Math.round((p.values.opacity ?? 1) * 100)} onChange={(v) => p.setOpacity(v / 100)} />
          </Field>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const FILL_ITEMS: { value: TokenFill; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'vstripes', label: 'Vertical stripes' },
  { value: 'hstripes', label: 'Horizontal stripes' },
  { value: 'vstripe', label: 'Single vertical stripe' },
  { value: 'hstripe', label: 'Single horizontal stripe' },
  { value: 'checker', label: 'Checkerboard' },
]

// A live preview of the token with the given fill (and the editor's current
// shape/colors). Labelled "00" at 50px for the fill picker; the copy-style
// buttons reuse it text-less at a smaller size.
function TokenPreview({ shape, fill, color1, color2, textColor, text = '00', size = 50 }: { shape: TokenShape; fill: TokenFill; color1: string; color2: string; textColor: string; text?: string; size?: number }) {
  const el = {
    id: 'preview',
    type: 'token' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    shape,
    tokenFill: fill,
    color1,
    color2,
    textColor,
    text,
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

const tokenStyleKey = (s: TokenVisualStyle) => `${s.shape}|${s.tokenFill}|${s.color1}|${s.color2}|${s.textColor}`

// The distinct token "looks" (shape + fill + colors, ignoring text/label) present
// on the board, in z-order, capped at 4 — the teams the copy-style buttons offer.
function boardTokenStyles(elements: readonly BoardElement[]): TokenVisualStyle[] {
  const seen = new Set<string>()
  const out: TokenVisualStyle[] = []
  for (const e of elements) {
    if (e.type !== 'token') continue
    const style: TokenVisualStyle = { shape: e.shape, tokenFill: e.tokenFill, color1: e.color1, color2: e.color2, textColor: e.textColor }
    const key = tokenStyleKey(style)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(style)
    if (out.length === 4) break
  }
  return out
}

// One copy-style button: a text-less preview of a board token's look; clicking it
// restyles the selected token(s) to match (a one-click "paste style"). When the
// Token tool is active, `active` outlines the preset that the next token will use.
function TokenStyleButton({ style, onApply, active, side }: { style: TokenVisualStyle; onApply: () => void; active?: boolean; side: 'right' | 'top' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" aria-label="Apply this token style" aria-pressed={active} onClick={onApply} className={cn(active && 'ring-2 ring-primary ring-offset-1 ring-offset-card')}>
          <TokenPreview shape={style.shape} fill={style.tokenFill} color1={style.color1} color2={style.color2} textColor={style.textColor} text="" size={26} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>Copy this style</TooltipContent>
    </Tooltip>
  )
}

function TokenSettingsButton({ side, small, translucent }: { side: 'right' | 'top'; small?: boolean; translucent?: boolean }) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label="Token settings" className={cn(translucent && TRANSLUCENT)}>
              <SlidersHorizontal />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Token</TooltipContent>
      </Tooltip>
      <PopoverContent
        side={side}
        align="start"
        className="w-60"
        // Keep this popover open while a nested color-picker popover is in use
        // (interacting with it would otherwise read as an outside dismissal).
        onInteractOutside={(e) => {
          const t = (e.detail.originalEvent.target as HTMLElement | null) ?? null
          if (t?.closest('[data-radix-popper-content-wrapper]')) e.preventDefault()
        }}
      >
        <TokenSettingsWidget />
      </PopoverContent>
    </Popover>
  )
}

function TokenSettingsWidget() {
  const p = usePropertyEditing()
  const shape = p.values.tokenShape ?? 'token'
  const c1 = p.values.color1 ?? '#ebebeb'
  const c2 = p.values.color2 ?? '#1e1e1e'
  const tc = p.values.textColor ?? '#111111'
  return (
    <div className="grid gap-3">
      <Field label="Type">
        <Segmented
          items={[
            { value: 'token' as TokenShape, label: 'Token', render: <TokenDiscIcon className="size-4" /> },
            { value: 'jersey' as TokenShape, label: 'Jersey', render: <JerseyIcon className="size-4" /> },
          ]}
          value={p.values.tokenShape}
          onChange={p.setTokenShape}
        />
      </Field>
      <Field label="Colors">
        <div className="flex items-center gap-2">
          <ColorButton kind="fill" label="Color 1" value={p.values.color1} onChange={p.setColor1} side="right" small />
          <ColorButton kind="fill" label="Color 2" value={p.values.color2} onChange={p.setColor2} side="right" small />
          <ColorButton kind="fill" label="Text color" value={p.values.textColor} onChange={p.setTextColor} side="right" small />
        </div>
      </Field>
      <Field label="Fill">
        <div className="grid grid-cols-3 gap-1.5">
          {FILL_ITEMS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-label={f.label}
              aria-pressed={p.values.tokenFill === f.value}
              onClick={() => p.setTokenFill(f.value)}
              className={cn(
                'flex items-center justify-center rounded-md border p-0.5',
                p.values.tokenFill === f.value ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-accent',
              )}
            >
              <TokenPreview shape={shape} fill={f.value} color1={c1} color2={c2} textColor={tc} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Text">
        <input
          type="text"
          value={p.values.text ?? ''}
          onChange={(e) => p.setText(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Number"
        />
      </Field>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">Label</span>
        <Switch checked={!!p.values.showLabel} onCheckedChange={p.setShowLabel} />
      </div>
      {p.values.showLabel && (
        <input
          type="text"
          value={p.values.label ?? ''}
          onChange={(e) => p.setLabel(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Player"
        />
      )}
      {/* Global token size (Small → Big), shared by every token on the board (2–10 m). */}
      <Field label={`Size (${Math.round(p.values.tokenSize ?? 5)} m)`}>
        <WaveSlider min={2} max={10} value={Math.round(p.values.tokenSize ?? 5)} onChange={p.setTokenSize} />
      </Field>
      <Field label="Opacity">
        <WaveSlider min={0} max={100} value={Math.round((p.values.opacity ?? 1) * 100)} onChange={(v) => p.setOpacity(v / 100)} />
      </Field>
    </div>
  )
}

const TIP_ITEMS: { value: ArrowTip; label: string; render: ReactNode }[] = [
  { value: 'none', label: 'None', render: <Minus className="size-4" /> },
  { value: 'arrow', label: 'Arrow', render: <MoveRight className="size-4" /> },
]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

// Wave "frequency" is presented to the user as a 0–100 slider where higher =
// tighter waves, but stored as a period in board units. Map MAX px → 0%, MIN px
// → 100% (so dragging right raises the frequency), matching the old editor.
function freqToPct(waveLength: number | undefined): number {
  const wl = waveLength ?? WAVE_LENGTH_MAX
  return Math.round(((WAVE_LENGTH_MAX - wl) / (WAVE_LENGTH_MAX - WAVE_LENGTH_MIN)) * 100)
}
function pctToFreq(pct: number): number {
  return Math.round(WAVE_LENGTH_MAX - (pct / 100) * (WAVE_LENGTH_MAX - WAVE_LENGTH_MIN))
}

// A slider that coalesces a whole drag into one undo step (see useDragTransaction,
// same model as the opacity control).
function WaveSlider({ min, max, value, onChange, disabled }: { min: number; max: number; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const arm = useDragTransaction()
  return (
    <Slider
      min={min}
      max={max}
      step={1}
      value={[value]}
      disabled={disabled}
      className={cn(disabled && 'opacity-40')}
      onValueChange={([v]) => {
        arm()
        onChange(v)
      }}
    />
  )
}

// Element-specific "other props": stroke width/style/opacity (via PropertyControls)
// plus, for polylines, line type (straight/curved/zigzag), wave frequency/amplitude,
// arrow tips and close-path.
function SettingsWidget() {
  const p = usePropertyEditing()
  return (
    <div className="grid gap-3">
      {p.allPoly && (
        <>
          <Field label="Line type">
            <Segmented
              items={[
                { value: 'straight', label: 'Straight', render: <LineStylePlainIcon className="size-4" /> },
                { value: 'curved', label: 'Curved', render: <LineStyleCurvedIcon className="size-4" /> },
                { value: 'zigzag', label: 'Zigzag', render: <LineStyleZigzagIcon className="size-4" /> },
                { value: 'double', label: 'Double', render: <LineStyleDoubleIcon className="size-4" /> },
              ]}
              value={p.values.lineStyle}
              onChange={p.setLineStyle}
            />
          </Field>
          {p.values.lineStyle === 'zigzag' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Frequency">
                {/* Stored as a wave length (px); the slider reads as frequency, so
                    right = tighter waves. Range maps MAX→MIN px. */}
                <WaveSlider
                  min={0}
                  max={100}
                  value={freqToPct(p.values.waveLength)}
                  onChange={(pct) => p.setWaveLength(pctToFreq(pct))}
                />
              </Field>
              <Field label={`Amplitude${p.values.waveAmplitude === 0 ? ' (auto)' : ''}`}>
                {/* 0 = Auto (wave as tall as it is wide). */}
                <WaveSlider
                  min={0}
                  max={WAVE_AMPLITUDE_MAX}
                  value={p.values.waveAmplitude ?? 0}
                  onChange={p.setWaveAmplitude}
                />
              </Field>
            </div>
          )}
          {p.values.lineStyle === 'double' && (
            <Field label="Lines offset">
              <WaveSlider
                min={LINES_OFFSET_MIN}
                max={LINES_OFFSET_MAX}
                value={p.values.linesOffset ?? LINES_OFFSET_MIN}
                onChange={p.setLinesOffset}
              />
            </Field>
          )}
          {p.allOpenPoly && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start tip">
                <Segmented items={TIP_ITEMS} value={p.values.startTip} onChange={p.setStartTip} />
              </Field>
              <Field label="End tip">
                <Segmented items={TIP_ITEMS} value={p.values.endTip} onChange={p.setEndTip} />
              </Field>
            </div>
          )}
          {/* {p.allClosablePoly && (
            <Field label="Closed figure">
              <Segmented
                items={[
                  { value: true, label: 'Closed', render: <ClosePathIcon className="size-4" /> },
                  { value: false, label: 'Open', render: <OpenPathIcon className="size-4" /> },
                ]}
                value={p.values.closed === undefined ? false : p.values.closed}
                onChange={(v) => p.setClosed(v)}
              />
            </Field>
          )} */}
        </>
      )}
      <PropertyControls />
    </div>
  )
}

// The "⋯" actions menu: duplicate, flip (figures), arrange (z-order), copy/paste
// style, delete.
function ActionsMenu({ side, small, translucent }: { side: 'right' | 'top'; small?: boolean; translucent?: boolean }) {
  const { allFigure, flip, allClosablePoly, allRect, values, setClosed } = usePropertyEditing()
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected)
  const arrangeSelected = useEditorStore((s) => s.arrangeSelected)
  const alignSelected = useEditorStore((s) => s.alignSelected)
  const selCount = useEditorStore((s) => s.selectedIds.length)
  const convertRectsToPolylines = useEditorStore((s) => s.convertRectsToPolylines)
  const copyStyle = useEditorStore((s) => s.copyStyle)
  const pasteStyle = useEditorStore((s) => s.pasteStyle)
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  const hasStyle = useEditorStore((s) => s.styleClipboard !== null)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size={small ? 'icon-sm' : 'icon'} aria-label="Actions" className={cn(translucent && TRANSLUCENT)}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side={side} align="start" className="min-w-44">
        <DropdownMenuItem onSelect={duplicateSelected}>
          <CopyPlus /> Duplicate
        </DropdownMenuItem>
        {allFigure && (
          <DropdownMenuItem onSelect={flip}>
            <FlipHorizontal2 /> Flip
          </DropdownMenuItem>
        )}
        {allRect && (
          <DropdownMenuItem onSelect={convertRectsToPolylines}>
            <PolylineIcon /> Convert to polyline
          </DropdownMenuItem>
        )}
        {/* Close / open a polyline with more than 2 points. */}
        {allClosablePoly &&
          (values.closed ? (
            <DropdownMenuItem onSelect={() => setClosed(false)}>
              <OpenPathIcon /> Open path
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setClosed(true)}>
              <ClosePathIcon /> Close path
            </DropdownMenuItem>
          ))}
        {/* Alignment: only meaningful with a multi-selection (distribute ≥3). */}
        {selCount >= 2 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Align</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => alignSelected('left')}>
              <AlignStartVertical /> Align left
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => alignSelected('centerX')}>
              <AlignCenterVertical /> Center horizontally
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => alignSelected('right')}>
              <AlignEndVertical /> Align right
            </DropdownMenuItem>
            <DropdownMenuItem disabled={selCount < 3} onSelect={() => alignSelected('distributeX')}>
              <AlignHorizontalDistributeCenter /> Distribute horizontally
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => alignSelected('top')}>
              <AlignStartHorizontal /> Align top
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => alignSelected('centerY')}>
              <AlignCenterHorizontal /> Center vertically
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => alignSelected('bottom')}>
              <AlignEndHorizontal /> Align bottom
            </DropdownMenuItem>
            <DropdownMenuItem disabled={selCount < 3} onSelect={() => alignSelected('distributeY')}>
              <AlignVerticalDistributeCenter /> Distribute vertically
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Arrange</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => arrangeSelected('front')}>
          <BringToFront /> Bring to front
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => arrangeSelected('forward')}>
          <ArrowUp /> Bring forward
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => arrangeSelected('backward')}>
          <ArrowDown /> Send backward
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => arrangeSelected('back')}>
          <SendToBack /> Send to back
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={copyStyle}>
          <ClipboardCopy /> Copy style
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasStyle} onSelect={pasteStyle}>
          <ClipboardPaste /> Paste style
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={deleteSelected}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Always rendered in mobile mode. Selection color/settings on the left, undo/redo
// (always) + duplicate/delete (when selected) on the right.
export function MobileBar() {
  const p = usePropertyEditing()
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.pointer >= 0)
  const canRedo = useEditorStore((s) => s.pointer < s.stack.length - 1)
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected)
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  const selected = p.count > 0
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-16 z-30 flex items-center justify-between gap-2">
      <div className="pointer-events-auto flex items-center gap-1">
        {p.editable && p.hasClosed && <ColorButton kind="fill" label="Background" value={p.values.fill} onChange={p.setFill} side="top" small translucent />}
        {p.editable && !p.allFigure && <ColorButton kind="stroke" label="Border" value={p.values.stroke} onChange={p.setStroke} side="top" small translucent />}
        {p.editable && <SettingsButton side="top" small translucent />}
      </div>
      <div className="pointer-events-auto flex items-center gap-1">
        <IconButton icon={Undo2} label="Undo" onClick={undo} disabled={!canUndo} />
        <IconButton icon={Redo2} label="Redo" onClick={redo} disabled={!canRedo} />
        {selected && <IconButton icon={Copy} label="Duplicate" onClick={duplicateSelected} />}
        {selected && <IconButton icon={Trash2} label="Delete" onClick={deleteSelected} />}
      </div>
    </div>
  )
}

function IconButton({ icon: Icon, label, onClick, disabled }: { icon: ComponentType<{ className?: string }>; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled} className={TRANSLUCENT}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

import { type LogoPosition } from '@youcoach-board/core'
import { useEditorStore } from '../../store/context'
import { useDragTransaction } from '../../lib/use-drag-transaction'
import { Slider } from '../ui/slider'
import { Swatches, Segmented } from './PropertyControls'
import { LogoTopLeftIcon, LogoTopRightIcon, LogoCenterIcon, LogoBottomLeftIcon, LogoBottomRightIcon } from '../icons'
import defaultFieldImage from '../../assets/field0.jpg'

// Solid background: a transparent swatch (restore the default image) + colors.
const BG_COLORS = ['transparent', '#2f8a3e', '#3b7a57', '#5b8c3a', '#d1d1d1', '#e7e7e7', '#ffffff']

const LOGO_OPTIONS: { value: LogoPosition; label: string; render: React.ReactNode }[] = [
  { value: 'top-left', label: 'Top left', render: <LogoTopLeftIcon className="size-5" /> },
  { value: 'top-right', label: 'Top right', render: <LogoTopRightIcon className="size-5" /> },
  { value: 'center', label: 'Center', render: <LogoCenterIcon className="size-5" /> },
  { value: 'bottom-left', label: 'Bottom left', render: <LogoBottomLeftIcon className="size-5" /> },
  { value: 'bottom-right', label: 'Bottom right', render: <LogoBottomRightIcon className="size-5" /> },
]

// Background settings shown in the properties panel while a field category is the
// active library category: solid background + color, field scale, logo position.
// The field is panned directly on the canvas via the move handle (InteractiveBoard).
export function BackgroundSettings() {
  const bg = useEditorStore((s) => s.doc.background)
  const setBackground = useEditorStore((s) => s.setBackground)
  const arm = useDragTransaction()
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Solid background</span>
        {/* Transparent = restore the default field image; a color = solid fill. */}
        <Swatches
          colors={BG_COLORS}
          value={bg.image ? 'transparent' : bg.color}
          onChange={(c) => (c === 'transparent' || c === '' ? setBackground({ image: defaultFieldImage }) : setBackground({ color: c, image: null }))}
        />
      </div>

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

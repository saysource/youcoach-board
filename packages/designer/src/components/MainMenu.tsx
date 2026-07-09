import {
  Menu,
  FolderOpen,
  Save,
  ImageDown,
  Command,
  Search,
  CircleHelp,
  Trash2,
  Sun,
  Moon,
  Monitor,
  SlidersHorizontal,
  Magnet,
  Check,
  Wrench,
  Grid3x3,
  Video,
  MapPin,
  type LucideIcon,
} from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '../lib/cn'
import { useEditorStore } from '../store/context'
import { boardExporter } from '../lib/export-image'
import type { ThemeSetting } from '../lib/use-theme'

interface MainMenuProps {
  theme: ThemeSetting
  onThemeChange: (theme: ThemeSetting) => void
  /** Whether to show the theme switch. Phase 1: always true; later driven by
   *  embed config (a host may pin the theme and hide the control). */
  showThemeControl?: boolean
  /** Open the keyboard-shortcuts help dialog. */
  onShowShortcuts?: () => void
  /** Authoring tools, shown only in admin mode under a dedicated "Admin" section. */
  onFieldHomography?: () => void
  onFieldCamera?: () => void
  onFieldZones?: () => void
}

export function MainMenu({ theme, onThemeChange, showThemeControl = true, onShowShortcuts, onFieldHomography, onFieldCamera, onFieldZones }: MainMenuProps) {
  const snapToObjects = useEditorStore((s) => s.snapToObjects)
  const toggleSnapToObjects = useEditorStore((s) => s.toggleSnapToObjects)
  const adminMode = useEditorStore((s) => s.adminMode)
  const resetCanvas = useEditorStore((s) => s.resetCanvas)
  const exportGuide = useEditorStore((s) => s.exportGuide)
  const setExportGuide = useEditorStore((s) => s.setExportGuide)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" aria-label="Menu" className="bg-card shadow-md">
              <Menu />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Menu</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="min-w-60">
        {/* Phase 1: all items are inert placeholders except the theme switch. */}
        <DropdownMenuItem disabled>
          <FolderOpen /> Open…
          <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Save /> Save to…
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ImageDown /> Export as…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => void boardExporter()?.(1440, 1080)}>Image 4:3 (1440×1080)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void boardExporter()?.(1920, 1080)}>Image 16:9 (1920×1080)</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Command /> Command palette
          <DropdownMenuShortcut>⌘/</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Search /> Find on canvas
          <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onShowShortcuts?.()}>
          <CircleHelp /> Keyboard Shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SlidersHorizontal /> Preferences
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggleSnapToObjects() }}>
              <Magnet /> Snap to objects
              {snapToObjects && <Check className="ml-auto size-4" />}
              <DropdownMenuShortcut>⌥S</DropdownMenuShortcut>
            </DropdownMenuItem>
            {/* Export guide: overlay a target-aspect frame on the canvas to help
                compose an image export. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ImageDown /> Export guide
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(['off', '4:3', '16:9', '9:16'] as const).map((g) => (
                  <DropdownMenuItem key={g} onSelect={(e) => { e.preventDefault(); setExportGuide(g) }}>
                    {g === 'off' ? 'Off' : g}
                    {exportGuide === g && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => resetCanvas()}>
          <Trash2 /> Reset the canvas
        </DropdownMenuItem>

        {/* Admin: authoring-only field tools, hidden from final users. Toggled via
            ?admin=1 or the ⌥⇧A shortcut. */}
        {adminMode && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Wrench /> Admin tools
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => onFieldHomography?.()}>
                  <Grid3x3 /> Field homography
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onFieldCamera?.()}>
                  <Video /> Field camera
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onFieldZones?.()}>
                  <MapPin /> Field zones
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        {showThemeControl && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <div className="px-1.5 pb-1">
              <ThemeSegmented value={theme} onChange={onThemeChange} />
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const THEME_OPTIONS: { value: ThemeSetting; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function ThemeSegmented({
  value,
  onChange,
}: {
  value: ThemeSetting
  onChange: (theme: ThemeSetting) => void
}) {
  return (
    <div className="flex gap-1 rounded-md bg-muted p-0.5">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-label={opt.label}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex flex-1 items-center justify-center rounded p-1.5 transition-colors',
            value === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <opt.icon className="size-4" />
        </button>
      ))}
    </div>
  )
}

import {
  Menu,
  FolderOpen,
  Save,
  ImageDown,
  Image,
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
  Presentation,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { useEditorStore, useEditorStoreApi } from '../store/context'
import { openBoardFromFile, saveBoardToFile } from '../lib/board-file'
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
  /** Enter presentation mode (full-page board, chrome hidden; Esc exits). */
  onPresent?: () => void
  /** Server-side MP4 export (set only when the host provides the endpoint). */
  onExportVideo?: () => void
}

export function MainMenu({ theme, onThemeChange, showThemeControl = true, onShowShortcuts, onFieldHomography, onFieldCamera, onFieldZones, onPresent, onExportVideo }: MainMenuProps) {
  const { t } = useTranslation()
  const storeApi = useEditorStoreApi()
  const snapToObjects = useEditorStore((s) => s.snapToObjects)
  const toggleSnapToObjects = useEditorStore((s) => s.toggleSnapToObjects)
  const adminMode = useEditorStore((s) => s.adminMode)
  const resetCanvas = useEditorStore((s) => s.resetCanvas)
  const exportGuide = useEditorStore((s) => s.exportGuide)
  const setExportGuide = useEditorStore((s) => s.setExportGuide)
  // Video export is offered only for real animations (more than one frame).
  const hasAnimation = useEditorStore((s) => s.doc.animation.frames.length > 1)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" aria-label={t('Menu')} className="bg-card shadow-md">
              <Menu />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('Menu')}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuItem onSelect={() => openBoardFromFile(storeApi)}>
          <FolderOpen /> {t('Open…')}
          <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => saveBoardToFile(storeApi.getState().doc)}>
          <Save /> {t('Save to…')}
          <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ImageDown /> {t('Export as…')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => void boardExporter()?.(1440, 1080)}><Image /> 4:3 (1440×1080)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void boardExporter()?.(1920, 1080)}><Image /> 16:9 (1920×1080)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void boardExporter()?.(1080, 1920)}><Image /> 9:16 (1080×1920)</DropdownMenuItem>
            {/* Server-rendered MP4 (Drupal-hosted only) — real animations only. */}
            {hasAnimation && onExportVideo && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onExportVideo()}><Video /> {t('Export video (MP4)…')}</DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onPresent?.()}>
          <Presentation /> {t('Presentation mode')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Command /> {t('Command palette')}
          <DropdownMenuShortcut>⌘/</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Search /> {t('Find on canvas')}
          <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onShowShortcuts?.()}>
          <CircleHelp /> {t('Keyboard Shortcuts')}
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SlidersHorizontal /> {t('Preferences')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggleSnapToObjects() }}>
              <Magnet /> {t('Snap to objects')}
              {snapToObjects && <Check className="ml-auto size-4" />}
              <DropdownMenuShortcut>⌥S</DropdownMenuShortcut>
            </DropdownMenuItem>
            {/* Export guide: overlay a target-aspect frame on the canvas to help
                compose an image export. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ImageDown /> {t('Export guide')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(['off', '4:3', '16:9', '9:16'] as const).map((g) => (
                  <DropdownMenuItem key={g} onSelect={(e) => { e.preventDefault(); setExportGuide(g) }}>
                    {g === 'off' ? t('Off') : g}
                    {exportGuide === g && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => resetCanvas()}>
          <Trash2 /> {t('Reset the canvas')}
        </DropdownMenuItem>

        {/* Admin: authoring-only field tools, hidden from final users. Toggled via
            ?admin=1 or the ⌥⇧A shortcut. */}
        {adminMode && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Wrench /> {t('Admin tools')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => onFieldHomography?.()}>
                  <Grid3x3 /> {t('Field homography')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onFieldCamera?.()}>
                  <Video /> {t('Field camera')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onFieldZones?.()}>
                  <MapPin /> {t('Field zones')}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        {showThemeControl && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('Theme')}</DropdownMenuLabel>
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
  const { t } = useTranslation()
  return (
    <div className="flex gap-1 rounded-md bg-muted p-0.5">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-label={t(opt.label)}
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

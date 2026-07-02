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
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '../lib/cn'
import type { ThemeSetting } from '../lib/use-theme'

interface MainMenuProps {
  theme: ThemeSetting
  onThemeChange: (theme: ThemeSetting) => void
  /** Whether to show the theme switch. Phase 1: always true; later driven by
   *  embed config (a host may pin the theme and hide the control). */
  showThemeControl?: boolean
  /** Open the keyboard-shortcuts help dialog. */
  onShowShortcuts?: () => void
}

export function MainMenu({ theme, onThemeChange, showThemeControl = true, onShowShortcuts }: MainMenuProps) {
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
        <DropdownMenuItem disabled>
          <ImageDown /> Export image…
          <DropdownMenuShortcut>⌘⇧E</DropdownMenuShortcut>
        </DropdownMenuItem>

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

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Trash2 /> Reset the canvas
        </DropdownMenuItem>

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

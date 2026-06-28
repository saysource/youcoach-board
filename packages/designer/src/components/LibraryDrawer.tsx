import { useState } from 'react'
import { X, Sparkles, Maximize, Minimize, Pin, PinOff, ChevronDown, Check, type LucideIcon } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '../lib/cn'

interface LibraryDrawerProps {
  open: boolean
  onClose: () => void
  /** Docked = a real sidebar that the board refits around; otherwise it overlays. */
  pinned: boolean
  onTogglePin: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
}

// The library's categories, grouped by macro-category. A category is identified
// by (group, name) — `name` alone isn't unique ("Futsal" appears twice).
const CATEGORY_GROUPS: { title: string; items: string[] }[] = [
  { title: 'Materials', items: ['Materials', 'Text and Numbers', 'Arrows and Shapes'] },
  {
    title: 'Players',
    items: [
      'Players (Male)',
      'Players (Female)',
      'Goalkeepers (Male)',
      'Goalkeepers (Female)',
      'Futsal',
      'Coaches',
      'Referees',
      'Children',
      'Preparation (Male)',
      'Preparation (Female)',
      'Players (from top)',
    ],
  },
  { title: 'Fields and Background', items: ['Fields 11', 'Futsal'] },
]

interface Category {
  group: string
  name: string
}

const DEFAULT_CATEGORY: Category = { group: 'Players', name: 'Players (Male)' }

// Right-side figures library. When open it hosts the controls that otherwise live
// top-right (AI, fill-viewport), plus a pin (dock/undock) and close. The body is
// a category selector (button → collapsible category list) over the category's
// element palette — empty for now until the palettes land.
export function LibraryDrawer({ open, onClose, pinned, onTogglePin, fullscreen, onToggleFullscreen }: LibraryDrawerProps) {
  const [category, setCategory] = useState<Category>(DEFAULT_CATEGORY)
  const [listOpen, setListOpen] = useState(false)

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-72 flex-col border-l border-border bg-card transition-transform duration-200',
        pinned ? 'shadow-none' : 'shadow-xl',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="flex items-center justify-between gap-1 border-b border-border p-2 pl-3">
        <span className="text-sm font-semibold">Library</span>
        <div className="flex items-center gap-0.5">
          <HeaderButton icon={Sparkles} label="AI tools" disabled />
          <HeaderButton
            icon={fullscreen ? Minimize : Maximize}
            label={fullscreen ? 'Exit full view' : 'Fill the viewport'}
            active={fullscreen}
            onClick={onToggleFullscreen}
          />
          <HeaderButton icon={pinned ? PinOff : Pin} label={pinned ? 'Undock' : 'Dock as sidebar'} active={pinned} onClick={onTogglePin} />
          <HeaderButton icon={X} label="Close library" onClick={onClose} />
        </div>
      </div>

      {/* Category selector: the button shows the current category; pressing it
          swaps the panel body for the full categorized list (and back). */}
      <div className="border-b border-border p-2">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={listOpen}
          onClick={() => setListOpen((v) => !v)}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{category.name}</span>
          <ChevronDown className={cn('transition-transform', listOpen && 'rotate-180')} />
        </Button>
      </div>

      {listOpen ? (
        /* The full categorized list fills the panel so it uses all the space. */
        <div className="flex-1 overflow-y-auto">
          {CATEGORY_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="sticky top-0 z-10 bg-foreground/10 px-3 py-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.title}
              </div>
              {g.items.map((name) => {
                const selected = category.group === g.title && category.name === name
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setCategory({ group: g.title, name })
                      setListOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                      selected && 'font-medium text-foreground',
                    )}
                  >
                    <span className="truncate">{name}</span>
                    {selected && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : (
        /* Elements for the selected category — empty placeholder for now. */
        <div className="flex-1 overflow-y-auto p-3" />
      )}
    </aside>
  )
}

function HeaderButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground')}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

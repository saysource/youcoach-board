import { useState } from 'react'
import { X, Sparkles, Maximize, Minimize, Pin, PinOff, ChevronDown, Check, type LucideIcon } from 'lucide-react'
import { BOARD_WIDTH, BOARD_HEIGHT, IDENTITY_TRANSFORM, type BoardElement } from '@youcoach-board/core'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '../lib/cn'
import { useAssets, type CatalogCategory, type CatalogFigure } from '../lib/assets'
import { useEditorStore } from '../store/context'

interface LibraryDrawerProps {
  open: boolean
  onClose: () => void
  /** Docked = a real sidebar that the board refits around; otherwise it overlays. */
  pinned: boolean
  onTogglePin: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
}

// Right-side figures library. Header hosts the relocated AI / fill-viewport / pin
// / close controls. The body is a category selector (button → full categorized
// list) over the selected category's element palette: facet filters (action /
// facing, or material type) + a thumbnail grid; clicking a thumbnail drops the
// figure centered on the board. Categories come from the catalog (assets).
export function LibraryDrawer({ open, onClose, pinned, onTogglePin, fullscreen, onToggleFullscreen }: LibraryDrawerProps) {
  const { url, catalog, catalogError } = useAssets()
  const createFigure = useEditorStore((s) => s.createFigure)

  const [catId, setCatId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [action, setAction] = useState('all')
  const [facing, setFacing] = useState<string | null>(null)

  // Default to the first category once the catalog loads.
  if (catalog && catId === null) setCatId(catalog.groups[0]?.categories[0] ?? null)
  const cat: CatalogCategory | null = catId && catalog ? (catalog.categories[catId] ?? null) : null

  // Reset facet selections when the category changes (render-phase, no effect).
  const [facetCat, setFacetCat] = useState<string | null>(null)
  if (catId !== facetCat) {
    setFacetCat(catId)
    setAction('all')
    setFacing(cat?.facets?.facing?.[0]?.id ?? null)
  }

  const figures = (cat?.figures ?? []).filter((f) => {
    if (cat?.facets?.facing && facing && (f.facing ?? null) !== facing) return false
    if (action !== 'all' && !(f.actions ?? []).includes(action)) return false
    return true
  })

  function drop(f: CatalogFigure) {
    if (!cat || cat.kind !== 'figure' || !catalog) return
    const colors = cat.colors ? { ...catalog.defaults[cat.colors] } : undefined
    const el: BoardElement = {
      id: crypto.randomUUID(),
      type: 'figure',
      figureId: f.svg,
      x: Math.round(BOARD_WIDTH / 2 - f.w / 2),
      y: Math.round(BOARD_HEIGHT / 2 - f.h / 2),
      width: f.w,
      height: f.h,
      mirror: f.mirror || undefined,
      colors,
      transform: { ...IDENTITY_TRANSFORM },
      stroke: '#1e1e1e',
      strokeWidth: 3,
      strokeStyle: 'solid',
      fill: 'transparent',
    }
    createFigure(el)
  }

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

      {catalogError ? (
        <div className="p-3 text-sm text-muted-foreground">Couldn’t load the library ({catalogError}).</div>
      ) : !catalog ? (
        <div className="p-3 text-sm text-muted-foreground">Loading library…</div>
      ) : (
        <>
          {/* Category selector */}
          <div className="border-b border-border p-2">
            <Button variant="outline" size="sm" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)} className="w-full justify-between font-normal">
              <span className="truncate">{cat?.name ?? 'Select category'}</span>
              <ChevronDown className={cn('transition-transform', listOpen && 'rotate-180')} />
            </Button>
          </div>

          {listOpen ? (
            /* Full categorized list fills the panel. */
            <div className="flex-1 overflow-y-auto">
              {catalog.groups.map((g) => (
                <div key={g.id}>
                  <div className="sticky top-0 z-10 mt-4 bg-foreground/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</div>
                  {g.categories.map((id) => {
                    const selected = id === catId
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setCatId(id)
                          setListOpen(false)
                        }}
                        className={cn('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground', selected && 'font-medium text-foreground')}
                      >
                        <span className="truncate">{catalog.categories[id]?.name ?? id}</span>
                        {selected && <Check className="size-4 shrink-0 text-primary" />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          ) : (
            /* Selected category's palette: facet filters + thumbnail grid. */
            <div className="flex flex-1 flex-col overflow-hidden">
              {(cat?.facets?.action || cat?.facets?.facing) && (
                <div className="flex flex-col gap-2 border-b border-border p-2">
                  {cat.facets.action && (
                    <select
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none"
                    >
                      <option value="all">All actions</option>
                      {cat.facets.action.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {cat.facets.facing && (
                    <div className="flex items-center gap-1">
                      {cat.facets.facing.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          aria-pressed={facing === f.id}
                          onClick={() => setFacing(f.id)}
                          className={cn('flex-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent', facing === f.id && 'bg-primary/15 font-medium')}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="grid flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto p-2">
                {figures.map((f, i) => (
                  <button
                    key={`${f.thumb}-${i}`}
                    type="button"
                    title={cat?.name}
                    onClick={() => drop(f)}
                    className="flex aspect-square items-center justify-center border border-transparent rounded-md p-1 hover:border-primary hover:bg-primary/20"
                  >
                    <img src={url(f.thumb)} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  </button>
                ))}
                {figures.length === 0 && <p className="col-span-3 px-1 py-6 text-center text-xs text-muted-foreground">No figures in this filter.</p>}
              </div>
            </div>
          )}
        </>
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

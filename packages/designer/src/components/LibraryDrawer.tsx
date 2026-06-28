import { useRef, useState } from 'react'
import { X, Sparkles, Maximize, Minimize, Pin, PinOff, ChevronDown, Check, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, List, type LucideIcon } from 'lucide-react'
import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { cn } from '../lib/cn'
import { useAssets, buildFigureElement, FIGURE_DND_MIME, type CatalogCategory, type CatalogFigure, type FigureDragData } from '../lib/assets'
import { useEditorStore } from '../store/context'

const FACING_ORDER = ['left', 'up', 'down', 'right']
const FACING_ICON: Record<string, LucideIcon> = { left: ArrowLeft, up: ArrowUp, down: ArrowDown, right: ArrowRight }

interface LibraryDrawerProps {
  open: boolean
  onClose: () => void
  /** Docked = a real sidebar that the board refits around; otherwise it overlays. */
  pinned: boolean
  onTogglePin: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  /** Selected category (controlled — lives in the shell so the toolbar can jump). */
  categoryId: string | null
  onCategoryChange: (id: string) => void
}

// Right-side figures library. Header hosts the relocated AI / fill-viewport / pin
// / close controls. The body is a category selector (button → full categorized
// list) over the selected category's element palette: facet filters (action /
// facing, or material type) + a thumbnail grid; clicking a thumbnail drops the
// figure centered on the board. Categories come from the catalog (assets).
export function LibraryDrawer({ open, onClose, pinned, onTogglePin, fullscreen, onToggleFullscreen, categoryId, onCategoryChange }: LibraryDrawerProps) {
  const { url, catalog, catalogError } = useAssets()
  const createFigure = useEditorStore((s) => s.createFigure)
  const setBackground = useEditorStore((s) => s.setBackground)
  // Active field's default figure scale — applied to figures as they're added.
  const figureScale = useEditorStore((s) => s.doc.background.figureScale)

  const [listOpen, setListOpen] = useState(false)
  const [facing, setFacing] = useState<string | null>(null)
  // Flash a section title when jumped to. `n` bumps each jump to replay the CSS
  // animation (via the title's key) even when re-selecting the same section.
  const [flash, setFlash] = useState({ id: '', n: 0 })
  const gridRef = useRef<HTMLDivElement | null>(null)

  const catId = categoryId
  const cat: CatalogCategory | null = catId && catalog ? (catalog.categories[catId] ?? null) : null

  // When the category changes (here or via the toolbar's More-tools menu), reset
  // the facing selection and collapse the category list (render-phase, no effect).
  const [facetCat, setFacetCat] = useState<string | null>(null)
  if (catId !== facetCat) {
    setFacetCat(catId)
    setFacing(cat?.facets?.facing?.[0]?.id ?? null)
    setListOpen(false)
  }

  // Facing buttons (arrow-ordered) and action sections. Every action shows as a
  // titled section; only the facing filter (if any) narrows the figures.
  const actions = cat?.facets?.action ?? null
  const facings = cat?.facets?.facing ? [...cat.facets.facing].sort((a, b) => FACING_ORDER.indexOf(a.id) - FACING_ORDER.indexOf(b.id)) : null
  const inFacing = (f: CatalogFigure) => !facings || !facing || (f.facing ?? null) === facing
  const sections = actions
    ? actions.map((a) => ({ id: a.id, label: a.label, figures: (cat?.figures ?? []).filter((f) => inFacing(f) && (f.actions ?? []).includes(a.id)) })).filter((sec) => sec.figures.length)
    : [{ id: 'all', label: '', figures: (cat?.figures ?? []).filter(inFacing) }]

  function jumpTo(id: string) {
    gridRef.current?.querySelector(`[data-section="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setFlash((f) => ({ id, n: f.n + 1 }))
  }

  // Drag payload / drop descriptor for a figure (resolved colors from the
  // category, so the board needn't know the source category).
  function descriptor(f: CatalogFigure): FigureDragData | null {
    if (!cat || cat.kind !== 'figure' || !catalog || !f.svg) return null
    // Legacy sizing (yceditor): a figure's longest side is the board-relative
    // base (boardWidth/10), with the catalog SVG size only giving the aspect
    // ratio; the active field's figureScale then multiplies that. Doing it this
    // way keeps the on-field proportions identical across board sizes (the old
    // editor used an 800×600 viewBox, we use 1200×900).
    const longest = Math.max(f.w, f.h) || 1
    const k = ((BOARD_WIDTH / 10) / longest) * figureScale * (f.sizeFactor ?? 1)
    return {
      figureId: f.svg,
      w: Math.round(f.w * k),
      h: Math.round(f.h * k),
      mirror: !!f.mirror,
      colors: cat.colors ? { ...catalog.defaults[cat.colors] } : undefined,
    }
  }

  // Click a thumbnail: a field sets the board background; any other figure drops
  // centered on the board.
  function drop(f: CatalogFigure) {
    if (cat?.kind === 'field') {
      if (!f.svg) return
      // The field SVG overlays the base background (the field0 image by default)
      // and always renders at its native scale (1). The catalog `scale` is the
      // default scale for figures added while this field is active.
      setBackground({ fieldSvg: f.svg, scale: 1, position: [0, 0], figureScale: f.scale ?? 1 })
      return
    }
    const d = descriptor(f)
    if (d) createFigure(buildFigureElement(d, BOARD_WIDTH / 2, BOARD_HEIGHT / 2))
  }

  // Drag-to-drop: hand the descriptor to the board, which places it at the cursor.
  function onDragStartFigure(e: React.DragEvent, f: CatalogFigure) {
    const d = descriptor(f)
    if (!d) return
    e.dataTransfer.setData(FIGURE_DND_MIME, JSON.stringify(d))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-72 flex-col border-l border-border bg-card/90 transition-transform duration-200',
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
          {/* Category selector + the sub-categories (actions) jump dropdown. */}
          <div className="flex items-center gap-1 border-b border-border p-2">
            <Button variant="outline" size="sm" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)} className="flex-1 justify-between font-normal">
              <span className="truncate">{cat?.name ?? 'Select category'}</span>
              <ChevronDown className={cn('transition-transform', listOpen && 'rotate-180')} />
            </Button>
            {!listOpen && actions && actions.length > 1 && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon-sm" aria-label="Jump to type">
                        <List />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Jump to…</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                  {actions.map((a) => (
                    <DropdownMenuItem key={a.id} onSelect={() => jumpTo(a.id)}>
                      {a.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {listOpen ? (
            /* Full categorized list fills the panel. */
            <div className="flex-1 overflow-y-auto">
              {catalog.groups.map((g) => (
                <div key={g.id}>
                  <div className="sticky top-0 z-10 mt-4 bg-foreground/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm2">{g.name}</div>
                  {g.categories.map((id) => {
                    const selected = id === catId
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onCategoryChange(id)}
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
            /* Selected category's palette: facing (arrows), then a thumbnail
               grid split into a titled section per action. */
            <div className="flex flex-1 flex-col overflow-hidden">
              {facings && (
                <div className="flex items-center gap-1 border-b border-border p-2">
                  {facings.map((f) => {
                    const Icon = FACING_ICON[f.id] ?? ArrowRight
                    return (
                      <button
                        key={f.id}
                        type="button"
                        aria-pressed={facing === f.id}
                        title={f.label}
                        onClick={() => setFacing(f.id)}
                        className={cn('flex h-8 flex-1 items-center justify-center rounded-md border border-border hover:bg-accent [&_svg]:size-4', facing === f.id && 'bg-primary/15')}
                      >
                        <Icon />
                      </button>
                    )
                  })}
                </div>
              )}

              <div ref={gridRef} className="flex-1 overflow-y-auto p-2 pt-0">
                {sections.map((sec) => (
                  <div key={sec.id} data-section={sec.id}>
                    {sec.label && (
                      <div
                        key={`t-${sec.id}-${sec.id === flash.id ? flash.n : 0}`}
                        className={cn(
                          'sticky top-0 z-10 -mx-2 mb-1 bg-foreground/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm first:mt-0',
                          sec.id === flash.id && 'ycb-flash',
                        )}
                      >
                        {sec.label}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 mb-3 last:mb-0">
                      {sec.figures.map((f, i) => (
                        <button
                          key={`${f.thumb}-${i}`}
                          type="button"
                          title={f.tool ? 'Text' : cat?.name}
                          draggable={!!descriptor(f)}
                          onDragStart={(e) => onDragStartFigure(e, f)}
                          onClick={() => drop(f)}
                          className={cn(
                            'flex aspect-square items-center justify-center rounded-md border border-transparent p-1 hover:border-primary hover:bg-primary/20',
                            f.svg ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          )}
                        >
                          <img src={url(f.thumb)} alt="" loading="lazy" draggable={false} className="max-h-full max-w-full object-contain" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {sections.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted-foreground">No figures here.</p>}
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

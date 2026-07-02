import { Fragment, useEffect, useRef, useState } from 'react'
import { X, Sparkles, Maximize, Minimize, Pin, PinOff, ChevronDown, Check, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, List, type LucideIcon } from 'lucide-react'
import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { cn } from '../lib/cn'
import { useAssets, buildFigureElement, figureIndex, figureBaseSize, type CatalogCategory, type CatalogFigure, type FigureDragData, type FieldDragData } from '../lib/assets'
import { clientToBoard } from '../lib/draw'
import { useEditorStore } from '../store/context'

// Movement (px) below which a press is a tap, not a drag; touch hold (ms) to start.
const TAP_SLOP = 8
const TOUCH_HOLD = 220
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
// Non-passive so it can cancel the drawer/page scroll while a touch drag is active.
const preventTouchScroll = (e: TouchEvent) => e.preventDefault()

const FACING_ORDER = ['left', 'up', 'down', 'right']
const FACING_ICON: Record<string, LucideIcon> = { left: ArrowLeft, up: ArrowUp, down: ArrowDown, right: ArrowRight }
// What each facing arrow means, shown as a tooltip (the arrows alone are unclear).
const FACING_DESC: Record<string, string> = {
  left: 'Players facing left',
  up: 'Players facing upward',
  down: 'Players facing downward',
  right: 'Players facing right',
}

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
  /** Background-edit mode: restrict the category list to field categories. */
  fieldsOnly?: boolean
}

// Right-side figures library. Header hosts the relocated AI / fill-viewport / pin
// / close controls. The body is a category selector (button → full categorized
// list) over the selected category's element palette: facet filters (action /
// facing, or material type) + a thumbnail grid; clicking a thumbnail drops the
// figure centered on the board. Categories come from the catalog (assets).
export function LibraryDrawer({ open, onClose, pinned, onTogglePin, fullscreen, onToggleFullscreen, categoryId, onCategoryChange, fieldsOnly = false }: LibraryDrawerProps) {
  const { url, catalog, catalogError } = useAssets()
  const createFigure = useEditorStore((s) => s.createFigure)
  const setBackground = useEditorStore((s) => s.setBackground)
  // Active field's default figure scale — applied to figures as they're added.
  const figureScale = useEditorStore((s) => s.doc.background.figureScale)
  // Remembered custom color per material action, so a new material inherits it.
  const materialColors = useEditorStore((s) => s.materialColors)
  // Remembered size (scale multiplier per figureId) + the current elements/
  // selection, so a new figure inherits the size of its type / of a selected or
  // existing figure in the same category.
  const figureScales = useEditorStore((s) => s.figureScales)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const elements = useEditorStore((s) => s.doc.elements)
  // Last player's skin/kit slots, inherited by newly added players.
  const playerColors = useEditorStore((s) => s.playerColors)

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
    ? actions
        .map((a) => ({ id: a.id, label: a.label, separatorBefore: a.separatorBefore, figures: (cat?.figures ?? []).filter((f) => inFacing(f) && (f.actions ?? []).includes(a.id)) }))
        .filter((sec) => sec.figures.length)
    : [{ id: 'all', label: '', separatorBefore: false, figures: (cat?.figures ?? []).filter(inFacing) }]

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
    const base = figureBaseSize({ w: f.w, h: f.h, sizeFactor: f.sizeFactor ?? 1, category: categoryId ?? '' }, figureScale)
    let colors = cat.colors ? { ...catalog.defaults[cat.colors] } : undefined
    // Inherit the last custom color used for this material's action/category.
    if (f.colors?.length && f.actions?.length) {
      const cached = materialColors[f.actions[0]]
      if (cached) colors = { ...colors, [f.colors[0]]: cached }
    }
    // Players (any category bound to the players colors) inherit the last
    // player's skin/kit slots.
    if (cat.colors === 'players' && Object.keys(playerColors).length) {
      colors = { ...colors, ...playerColors }
    }
    // Inherit the size (as a scale over the default): first this exact figure's
    // remembered scale; else a reference figure of the same category on the board —
    // preferring the SELECTED one, else the first found (e.g. the first player).
    let scale = figureScales[f.svg]
    if (scale === undefined) {
      const idx = figureIndex(catalog)
      const sameCat = (e: (typeof elements)[number]) => e.type === 'figure' && idx.get(e.figureId)?.category === categoryId
      const ref = elements.find((e) => selectedIds.includes(e.id) && sameCat(e)) ?? elements.find(sameCat)
      if (ref && ref.type === 'figure') {
        const rm = idx.get(ref.figureId)
        if (rm) {
          const rb = figureBaseSize(rm, figureScale)
          if (rb.w) scale = ref.width / rb.w
        }
      }
    }
    scale = scale ?? 1
    return {
      figureId: f.svg,
      w: Math.round(base.w * scale),
      h: Math.round(base.h * scale),
      mirror: !!f.mirror,
      colors,
    }
  }

  // Drag/tap payload for a field thumbnail (background category): applied as the
  // board background (position-independent), whether tapped or dropped.
  function fieldDescriptor(f: CatalogFigure): FieldDragData | null {
    if (cat?.kind !== 'field' || !f.svg) return null
    return { fieldSvg: f.svg, figureScale: f.scale ?? 1 }
  }

  // ── Palette → canvas drag (pointer-based, so it works on touch too) ─────────
  // Native HTML5 DnD never fires on touch devices, so we drive the drag with
  // pointer events: press-drag on mouse/pen; long-press-then-drag on touch (a
  // plain swipe still scrolls the list). Releasing over the board places the
  // figure at that point (or applies a field); a tap places it centered.
  type PaletteDrag = {
    pointerId: number
    sx: number
    sy: number
    active: boolean
    canDrag: boolean
    isField: boolean
    field: FieldDragData | null
    desc: FigureDragData | null
    img: HTMLImageElement | null
    ghost: HTMLElement | null
    timer: ReturnType<typeof setTimeout> | null
    onMove: (e: PointerEvent) => void
    onUp: (e: PointerEvent) => void
    onCancel: () => void
  }
  const dragRef = useRef<PaletteDrag | null>(null)

  function boardSurface(): { surface: HTMLElement; svg: SVGSVGElement } | null {
    const surface = document.querySelector('[data-board-surface]') as HTMLElement | null
    const svg = surface?.querySelector('svg') as SVGSVGElement | null
    return surface && svg ? { surface, svg } : null
  }
  function overBoard(b: { surface: HTMLElement } | null, x: number, y: number): boolean {
    if (!b) return false
    const r = b.surface.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }
  function cleanupDrag() {
    const d = dragRef.current
    if (!d) return
    if (d.timer) clearTimeout(d.timer)
    d.ghost?.remove()
    document.removeEventListener('pointermove', d.onMove)
    document.removeEventListener('pointerup', d.onUp)
    document.removeEventListener('pointercancel', d.onCancel)
    document.removeEventListener('touchmove', preventTouchScroll)
    dragRef.current = null
  }
  useEffect(() => cleanupDrag, [])

  function activateDrag(d: PaletteDrag, x: number, y: number) {
    if (d.active) return
    d.active = true
    if (d.timer) {
      clearTimeout(d.timer)
      d.timer = null
    }
    // A clean off-screen clone follows the pointer (no colored ancestor bleeding
    // through the figure's transparent areas).
    if (d.img) {
      const r = d.img.getBoundingClientRect()
      const g = d.img.cloneNode(true) as HTMLImageElement
      g.className = ''
      Object.assign(g.style, {
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        maxWidth: 'none',
        maxHeight: 'none',
        objectFit: 'contain',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        opacity: '0.85',
        zIndex: '9999',
        background: 'transparent',
      })
      document.body.appendChild(g)
      d.ghost = g
    }
    // Stop the drawer/page scrolling while dragging on touch.
    document.addEventListener('touchmove', preventTouchScroll, { passive: false })
  }

  function placeFrom(d: PaletteDrag, x: number, y: number, atPoint: boolean) {
    const b = boardSurface()
    if (d.isField) {
      if (d.field && (!atPoint || overBoard(b, x, y))) setBackground({ fieldSvg: d.field.fieldSvg, scale: 1, position: [0, 0], figureScale: d.field.figureScale })
      return
    }
    if (!d.desc) return
    if (atPoint) {
      if (!b || !overBoard(b, x, y)) return
      const p = clientToBoard(b.svg, x, y)
      createFigure(buildFigureElement(d.desc, clamp(p.x, 0, BOARD_WIDTH), clamp(p.y, 0, BOARD_HEIGHT)))
    } else {
      createFigure(buildFigureElement(d.desc, BOARD_WIDTH / 2, BOARD_HEIGHT / 2))
    }
  }

  function onThumbPointerDown(e: React.PointerEvent, f: CatalogFigure) {
    if (e.button !== 0) return // primary button / touch / pen only
    cleanupDrag() // abandon any stale gesture
    const field = fieldDescriptor(f)
    const desc = descriptor(f)
    const d: PaletteDrag = {
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      active: false,
      canDrag: !!field || !!desc,
      isField: cat?.kind === 'field',
      field,
      desc,
      img: e.currentTarget.querySelector('img'),
      ghost: null,
      timer: null,
      onMove: () => {},
      onUp: () => {},
      onCancel: () => {},
    }
    dragRef.current = d
    d.onMove = (ev) => {
      if (ev.pointerId !== d.pointerId) return
      if (d.active) {
        if (d.ghost) {
          d.ghost.style.left = `${ev.clientX}px`
          d.ghost.style.top = `${ev.clientY}px`
        }
        return
      }
      if (!d.canDrag) return
      const dist = Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy)
      if (ev.pointerType === 'touch') {
        if (dist > TAP_SLOP) cleanupDrag() // moved before the hold fired → a scroll
      } else if (dist > TAP_SLOP) {
        activateDrag(d, ev.clientX, ev.clientY)
      }
    }
    d.onUp = (ev) => {
      if (ev.pointerId !== d.pointerId) return
      const active = d.active
      const dist = Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy)
      const x = ev.clientX
      const y = ev.clientY
      cleanupDrag()
      if (active) placeFrom(d, x, y, true)
      else if (dist <= TAP_SLOP) placeFrom(d, x, y, false) // a tap → centered / apply field
    }
    d.onCancel = () => cleanupDrag()
    document.addEventListener('pointermove', d.onMove)
    document.addEventListener('pointerup', d.onUp)
    document.addEventListener('pointercancel', d.onCancel)
    // Touch: a deliberate hold starts the drag (so a quick swipe still scrolls).
    if (e.pointerType === 'touch' && d.canDrag) d.timer = setTimeout(() => activateDrag(d, e.clientX, e.clientY), TOUCH_HOLD)
  }

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-64 flex-col border-l border-border bg-card/90 transition-transform duration-200',
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
                    <Fragment key={a.id}>
                      {a.separatorBefore && <DropdownMenuSeparator />}
                      <DropdownMenuItem onSelect={() => jumpTo(a.id)}>{a.label}</DropdownMenuItem>
                    </Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {listOpen ? (
            /* Full categorized list fills the panel. */
            <div className="flex-1 overflow-y-auto">
              {catalog.groups
                .map((g) => (fieldsOnly ? { ...g, categories: g.categories.filter((id) => catalog.categories[id]?.kind === 'field') } : g))
                .filter((g) => g.categories.length > 0)
                .map((g) => (
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
                    const desc = FACING_DESC[f.id] ?? f.label
                    return (
                      <Tooltip key={f.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-pressed={facing === f.id}
                            aria-label={desc}
                            onClick={() => setFacing(f.id)}
                            className={cn('flex h-8 flex-1 items-center justify-center rounded-md border border-border hover:bg-accent [&_svg]:size-4', facing === f.id && 'bg-primary/15')}
                          >
                            <Icon />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{desc}</TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              )}

              <div ref={gridRef} className="flex-1 overflow-y-auto p-2 pt-0">
                {sections.map((sec, si) => (
                  <div key={sec.id} data-section={sec.id}>
                    {sec.separatorBefore && si > 0 && <div className="-mx-2 my-2 border-t border-border" />}
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
                    <div className="grid grid-cols-3 gap-0 mb-3 last:mb-0">
                      {sec.figures.map((f, i) => (
                        <button
                          key={`${f.thumb}-${i}`}
                          type="button"
                          title={f.tool ? 'Text' : cat?.name}
                          onPointerDown={(e) => onThumbPointerDown(e, f)}
                          className={cn(
                            'flex aspect-square touch-manipulation items-center justify-center rounded-md border border-transparent p-1 hover:border-primary hover:bg-primary/20',
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

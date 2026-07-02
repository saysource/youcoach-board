import { createContext, useContext } from 'react'
import { IDENTITY_TRANSFORM, BOARD_WIDTH, type BoardElement } from '@youcoach-board/core'

// Host-provided asset access (see specs/catalog.md). The board never hardcodes a
// backend: the embedder says where figures/thumbnails/catalog live, and we
// resolve everything through one function. Defaults serve the standalone dev
// server's public/ folder. (Context + hook live here; the provider component is
// in AssetsProvider.tsx — keeps Fast Refresh happy.)

export interface AssetsConfig {
  /** URL template with a `__path__` placeholder, e.g.
   *  "https://cdn.example/svgs/__path__?token=123". */
  urlTemplate?: string
  /** Full control: map an asset path to a URL (signed/tokened). Beats urlTemplate. */
  resolve?: (path: string) => string
  /** Catalog location (resolved like any asset). Defaults to "catalog.json". */
  catalog?: string
}

// ── Catalog types (mirror catalog.json, the hand-maintained source of truth) ──
export interface CatalogFigure {
  /** Asset path to the SVG. Absent for app-managed `tool` entries (e.g. text). */
  svg?: string
  thumb: string
  w: number
  h: number
  actions?: string[]
  facing?: string
  mirror?: boolean
  scale?: number
  /** Per-figure size multiplier on top of the board-relative base (legacy quirk
   *  for a handful of materials placed at 1/4 size). Defaults to 1. */
  sizeFactor?: number
  color?: string
  /** The recolor-class names this figure's SVG exposes as user-customizable fills,
   *  e.g. `["yc-color-1"]` (marked in the catalog from the SVG contents). Absent or
   *  empty = no custom colors. An array so figures can expose more than one later. */
  colors?: string[]
  /** App-managed element (no SVG to place) — e.g. "text". The app creates it. */
  tool?: string
}
export interface FacetValue {
  id: string
  label: string
  /** Render a divider before this entry (jump menu + section list). */
  separatorBefore?: boolean
}
export interface CatalogCategory {
  name: string
  kind: 'figure' | 'field'
  colors?: 'players' | 'materials'
  facets?: { action?: FacetValue[]; facing?: FacetValue[] }
  figures: CatalogFigure[]
}
export interface Catalog {
  version: number
  imageBase?: string
  defaults: Record<string, Record<string, string>>
  groups: { id: string; name: string; categories: string[] }[]
  categories: Record<string, CatalogCategory>
}

/** For a recolorable figure SVG path, the recolor slots it exposes and its
 *  action/category — used to remember & inherit a material's custom color. */
export function figureColorInfo(catalog: Catalog | null): Map<string, { slots: string[]; action: string | undefined }> {
  const out = new Map<string, { slots: string[]; action: string | undefined }>()
  for (const cat of Object.values(catalog?.categories ?? {})) {
    for (const f of cat.figures) if (f.svg && f.colors?.length) out.set(f.svg, { slots: f.colors, action: f.actions?.[0] })
  }
  return out
}

/** Per-figure catalog facts needed to size a placed figure and group figures by
 *  category (for size inheritance). Keyed by the figure's SVG path. */
export interface FigureMeta {
  w: number
  h: number
  sizeFactor: number
  category: string
}
export function figureIndex(catalog: Catalog | null): Map<string, FigureMeta> {
  const out = new Map<string, FigureMeta>()
  for (const [catId, cat] of Object.entries(catalog?.categories ?? {})) {
    for (const f of cat.figures) if (f.svg) out.set(f.svg, { w: f.w, h: f.h, sizeFactor: f.sizeFactor ?? 1, category: catId })
  }
  return out
}

/** The default on-board size (board units) of a figure at the given field figure
 *  scale — the legacy sizing (longest side = boardWidth/10 · figureScale ·
 *  sizeFactor). A remembered "scale" is a multiplier on top of this. The field's
 *  `scale` (→ figureScale) is the per-field lever; per-figure sizeFactor keeps
 *  small props (e.g. a ball) from being blown up to player size. */
export function figureBaseSize(meta: FigureMeta, figureScale: number): { w: number; h: number } {
  const longest = Math.max(meta.w, meta.h) || 1
  const k = ((BOARD_WIDTH / 10) / longest) * figureScale * (meta.sizeFactor || 1)
  return { w: meta.w * k, h: meta.h * k }
}

/** The `scale` a field declares in the catalog (→ the figures-scale for figures
 *  placed on it). The single source of truth for per-field sizing; undefined for
 *  a field not in the catalog (e.g. a custom upload).
 *
 *  A field svg can appear in several field categories (e.g. fields_all duplicates
 *  fields_11). Search in GROUP order — the same order the drawer resolves fields
 *  in — so we read the copy the UI actually uses (else editing one duplicate has
 *  no effect). */
export function fieldFigureScale(catalog: Catalog | null, fieldSvg: string | null | undefined): number | undefined {
  if (!catalog || !fieldSvg) return undefined
  const ordered: string[] = []
  for (const g of catalog.groups ?? []) for (const id of g.categories) if (catalog.categories[id]?.kind === 'field') ordered.push(id)
  for (const id of Object.keys(catalog.categories)) if (catalog.categories[id]?.kind === 'field' && !ordered.includes(id)) ordered.push(id)
  for (const id of ordered) {
    for (const f of catalog.categories[id].figures) if (f.svg === fieldSvg) return f.scale ?? 1
  }
  return undefined
}

/** Build the asset-path → URL resolver from the host config. */
export function makeResolver(cfg?: AssetsConfig): (path: string) => string {
  if (cfg?.resolve) return cfg.resolve
  if (cfg?.urlTemplate) {
    const tpl = cfg.urlTemplate
    return (p) => tpl.replace('__path__', p)
  }
  return (p) => `/${p}` // dev default: served from public/
}

export interface AssetsValue {
  /** Asset path → URL (for <img>, fetch). */
  url: (path: string) => string
  catalog: Catalog | null
  catalogError: string | null
}

export const AssetsContext = createContext<AssetsValue | null>(null)

export function useAssets(): AssetsValue {
  const v = useContext(AssetsContext)
  if (!v) throw new Error('useAssets must be used within an AssetsProvider')
  return v
}

// ── Figure drag-and-drop (palette → board) ──
// The palette drag is driven by pointer events (see LibraryDrawer), so it works
// on touch too — no native HTML5 DnD / dataTransfer MIME types.

/** Payload carried when dragging a field from the palette. */
export interface FieldDragData {
  fieldSvg: string
  /** Default scale for figures added while this field is active. */
  figureScale: number
}

/** The minimal figure data carried in a palette drag (resolved colors included,
 *  since the board doesn't know the source category). */
export interface FigureDragData {
  figureId: string
  w: number
  h: number
  mirror: boolean
  colors?: Record<string, string>
  /** Marks the figure as a ball (special-cased later, e.g. animation). */
  ball?: boolean
}

/** Build a placed FigureElement from a drag descriptor, centered at (cx, cy). */
export function buildFigureElement(d: FigureDragData, cx: number, cy: number): BoardElement {
  return {
    id: crypto.randomUUID(),
    type: 'figure',
    figureId: d.figureId,
    x: Math.round(cx - d.w / 2),
    y: Math.round(cy - d.h / 2),
    width: d.w,
    height: d.h,
    mirror: d.mirror || undefined,
    colors: d.colors,
    ball: d.ball || undefined,
    transform: { ...IDENTITY_TRANSFORM },
    stroke: '#1e1e1e',
    strokeWidth: 3,
    strokeStyle: 'solid',
    fill: 'transparent',
    fillStyle: 'solid',
  }
}

import { createContext, useContext } from 'react'
import { IDENTITY_TRANSFORM, type BoardElement } from '@youcoach-board/core'

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

// ── Catalog types (mirror catalog.json / gen-catalog.mjs) ──
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
  /** App-managed element (no SVG to place) — e.g. "text". The app creates it. */
  tool?: string
}
export interface FacetValue {
  id: string
  label: string
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
/** dataTransfer MIME for a dragged catalog figure. */
export const FIGURE_DND_MIME = 'application/x-ycb-figure'

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
  }
}

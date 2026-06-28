import { createContext, useContext } from 'react'

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
  svg: string
  thumb: string
  w: number
  h: number
  actions?: string[]
  facing?: string
  mirror?: boolean
  scale?: number
  color?: string
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

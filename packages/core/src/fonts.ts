// Curated text fonts for board text elements. Pure DATA (framework-free): the
// registry maps a stable id — what a document stores in TextElement.fontFamily —
// to a CSS family + fallback stack. The font FILES live in the designer package
// (self-hosted latin woff2 subsets, all SIL OFL); every renderer that loads them
// registers the same prefixed family names, so a doc renders identically across
// hosts, and gracefully falls back to the stack when a host hasn't loaded them.
//
// The family names are prefixed ("YCB …") so an embedding host page that loads
// its own copy/version of e.g. Oswald can never restyle board text.

import { TEXT_FONT } from './elements'

export interface BoardFont {
  /** Stable id stored in the document (TextElement.fontFamily). */
  id: string
  /** Picker label. */
  label: string
  /** The registered CSS family name (prefixed, see above). */
  family: string
  /** Full CSS font-family stack (family + safe fallbacks). */
  stack: string
  /** Weights shipped as files; other weights synthesize from the nearest. */
  weights: number[]
  /** Loose grouping for the picker. */
  category: 'condensed' | 'clean' | 'hand'
}

const font = (id: string, label: string, weights: number[], category: BoardFont['category'], fallback = 'sans-serif'): BoardFont => {
  const family = `YCB ${label}`
  return { id, label, family, stack: `'${family}', ${fallback}`, weights, category }
}

/** The curated selection (mostly condensed — they read like sport broadcast
 *  graphics and fit labels on a crowded board — plus a marker/hand pair). */
export const BOARD_FONTS: BoardFont[] = [
  font('oswald', 'Oswald', [400, 700], 'condensed'),
  font('barlow-condensed', 'Barlow Condensed', [400, 700], 'condensed'),
  font('archivo-narrow', 'Archivo Narrow', [400, 700], 'condensed'),
  font('anton', 'Anton', [400], 'condensed'),
  font('permanent-marker', 'Permanent Marker', [400], 'hand', 'cursive'),
  font('caveat', 'Caveat', [400, 700], 'hand', 'cursive'),
]

/** The registry entry for a stored font id, or undefined (default font). */
export function boardFont(id: string | null | undefined): BoardFont | undefined {
  return id ? BOARD_FONTS.find((f) => f.id === id) : undefined
}

/** CSS font-family for a text element: the id's stack, else the default font.
 *  Unknown ids (a doc from a newer version) fall back to the default. */
export function textFontStack(fontFamily?: string | null): string {
  return boardFont(fontFamily)?.stack ?? TEXT_FONT
}

// Loads the curated board fonts (see core fonts.ts): self-hosted latin woff2
// subsets (SIL OFL, downloaded from Google Fonts) registered via the FontFace
// API under the prefixed family names, so host CSS can never restyle board text.
// Fonts load lazily — when the picker opens or a document uses them — and the
// exporter can inline them into SVG clones as data-URI @font-face rules
// (an SVG rasterized through <img> is an isolated document that can't reach
// document.fonts, so the fonts must travel inside the markup).

import { BOARD_FONTS, boardFont, type BoardDoc } from '@youcoach-board/core'
import oswald400 from '../assets/fonts/oswald-400.woff2'
import oswald700 from '../assets/fonts/oswald-700.woff2'
import barlowCondensed400 from '../assets/fonts/barlow-condensed-400.woff2'
import barlowCondensed700 from '../assets/fonts/barlow-condensed-700.woff2'
import archivoNarrow400 from '../assets/fonts/archivo-narrow-400.woff2'
import archivoNarrow700 from '../assets/fonts/archivo-narrow-700.woff2'
import anton400 from '../assets/fonts/anton-400.woff2'
import permanentMarker400 from '../assets/fonts/permanent-marker-400.woff2'
import caveat400 from '../assets/fonts/caveat-400.woff2'
import caveat700 from '../assets/fonts/caveat-700.woff2'

/** Bundled files per font id (weights matching BOARD_FONTS[].weights). */
const FONT_FILES: Record<string, { weight: number; url: string }[]> = {
  oswald: [
    { weight: 400, url: oswald400 },
    { weight: 700, url: oswald700 },
  ],
  'barlow-condensed': [
    { weight: 400, url: barlowCondensed400 },
    { weight: 700, url: barlowCondensed700 },
  ],
  'archivo-narrow': [
    { weight: 400, url: archivoNarrow400 },
    { weight: 700, url: archivoNarrow700 },
  ],
  anton: [{ weight: 400, url: anton400 }],
  'permanent-marker': [{ weight: 400, url: permanentMarker400 }],
  caveat: [
    { weight: 400, url: caveat400 },
    { weight: 700, url: caveat700 },
  ],
}

const loading = new Map<string, Promise<void>>()

/** Register + load a board font (all its weights); resolves when usable.
 *  Unknown ids resolve immediately (the text falls back to the default font). */
export function loadBoardFont(id: string): Promise<void> {
  const cached = loading.get(id)
  if (cached) return cached
  const meta = boardFont(id)
  const files = FONT_FILES[id]
  if (!meta || !files || typeof FontFace === 'undefined') return Promise.resolve()
  const p = Promise.all(
    files.map(async ({ weight, url }) => {
      const face = new FontFace(meta.family, `url(${url})`, { weight: String(weight), display: 'swap' })
      await face.load()
      document.fonts.add(face)
    }),
  ).then(
    () => undefined,
    () => undefined, // a failed load just leaves the fallback stack
  )
  loading.set(id, p)
  return p
}

/** Load every curated font (the picker opening — the previews need them all). */
export function loadAllBoardFonts(): Promise<void> {
  return Promise.all(BOARD_FONTS.map((f) => loadBoardFont(f.id))).then(() => undefined)
}

/** The distinct font ids a document's text elements use. */
export function docFontIds(doc: BoardDoc): string[] {
  const ids = new Set<string>()
  for (const el of doc.elements) if (el.type === 'text' && el.fontFamily) ids.add(el.fontFamily)
  return [...ids]
}

/** Load the fonts a document uses (fire on doc open/change; cheap when cached). */
export function loadDocFonts(doc: BoardDoc): Promise<void> {
  return Promise.all(docFontIds(doc).map(loadBoardFont)).then(() => undefined)
}

// ── Export embedding ─────────────────────────────────────────────────────────

const dataUriCache = new Map<string, string>()

async function fileDataUri(url: string): Promise<string> {
  const cached = dataUriCache.get(url)
  if (cached) return cached
  const buf = await (await fetch(url)).arrayBuffer()
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const uri = `data:font/woff2;base64,${btoa(bin)}`
  dataUriCache.set(url, uri)
  return uri
}

/** Self-contained @font-face CSS (data-URI sources) for the given font ids —
 *  injected into cloned SVGs at export time so rasterization sees the fonts. */
export async function fontFaceCssFor(ids: string[]): Promise<string> {
  const rules: string[] = []
  for (const id of ids) {
    const meta = boardFont(id)
    const files = FONT_FILES[id]
    if (!meta || !files) continue
    for (const { weight, url } of files) {
      rules.push(`@font-face{font-family:'${meta.family}';font-weight:${weight};src:url(${await fileDataUri(url)}) format('woff2');}`)
    }
  }
  return rules.join('\n')
}

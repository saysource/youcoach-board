// Player customization (skin/hair + kit) helpers.
//
// Player figures carry recolor classes on their SVGs; the board applies
// `figure.colors[slot]` as fill (see figure-svg recoloredInnerHtml). The editor
// preview assets (face.svg, kit.svg) use the SAME slot names, so we recolor them
// the same way. Jersey "style" isn't stored separately — it's how the v_stripe /
// h_stripe slots are colored relative to the jersey.

import type { Catalog } from './assets'
import faceRaw from '../assets/face.svg?raw'
import kitRaw from '../assets/kit.svg?raw'

// The recolor slots a player exposes, in the editor's terms.
export const SKIN_SLOT = 'yc-skin'
export const HAIR_SLOT = 'yc-hair'
export const JERSEY_SLOT = 'yc-color-1' // also class base_tshirt on the figure
export const SHORTS_SLOT = 'yc-color-2' // also class shorts
export const VSTRIPE_SLOT = 'v_stripe'
export const HSTRIPE_SLOT = 'h_stripe'
export const SOCKS_SLOT = 'socks'
/** All slots copied when a new player inherits the last player's look. */
export const PLAYER_SLOTS = [SKIN_SLOT, HAIR_SLOT, JERSEY_SLOT, SHORTS_SLOT, VSTRIPE_SLOT, HSTRIPE_SLOT, SOCKS_SLOT]

/** Jersey styles — reuse the token fill names so the token renderer can draw the
 *  style icons (a jersey shirt, white base + gray stripes). */
export type KitStyle = 'solid' | 'vstripes' | 'hstripes' | 'checker'

/** A player's kit: jersey/shorts/socks/stripe colors + the stripe style. */
export type PlayerKit = { jersey: string; shorts: string; socks: string; stripe: string; style: KitStyle }
/** Number of recent kits kept in the FIFO history grid. */
export const KIT_HISTORY_SIZE = 4
/** An "empty" history slot renders all-black. */
export const EMPTY_KIT: PlayerKit = { jersey: '#000000', shorts: '#000000', socks: '#000000', stripe: '#000000', style: 'solid' }
export const kitKey = (k: PlayerKit) => `${k.style}|${k.jersey}|${k.stripe}|${k.shorts}|${k.socks}`

// ── Skin editor palettes ─────────────────────────────────────────────────────
export const DEFAULT_SKIN = '#f1c39c'
export const DEFAULT_HAIR = '#8f3c00'

/** 8 common (skin, hair) combinations for the simple mode. */
export const SKIN_PRESETS: { skin: string; hair: string }[] = [
  { skin: '#f6d3b0', hair: '#e8c66b' }, // fair / blonde
  { skin: '#f1c39c', hair: '#6b4423' }, // light / brown
  { skin: '#f1c39c', hair: '#1a1a1a' }, // light / black
  { skin: '#eab38a', hair: '#b25a2e' }, // light / ginger
  { skin: '#d99a6c', hair: '#3a2416' }, // medium / dark brown
  { skin: '#b87a4b', hair: '#1a1a1a' }, // tan / black
  { skin: '#8d5524', hair: '#141414' }, // brown / black
  { skin: '#5a3820', hair: '#0d0d0d' }, // dark / black
]

/** Advanced-mode swatches. No custom picker — pick from these only. */
export const HAIR_COLORS = ['#1a1a1a', '#3a2416', '#6b4423', '#8f3c00', '#b25a2e', '#c98a3a', '#e8c66b', '#f0e2a8', '#9a9a9a', '#f2f2f2']
export const SKIN_COLORS = ['#ffe0bd', '#f6d3b0', '#f1c39c', '#eab38a', '#d99a6c', '#c68642', '#b87a4b', '#8d5524', '#6e451f', '#5a3820']

// ── SVG preview recoloring ───────────────────────────────────────────────────
const parseSvg = (raw: string): SVGElement => new DOMParser().parseFromString(raw, 'image/svg+xml').documentElement as unknown as SVGElement
const faceTpl = typeof DOMParser !== 'undefined' ? parseSvg(faceRaw) : null
const kitTpl = typeof DOMParser !== 'undefined' ? parseSvg(kitRaw) : null

export interface SvgPreview {
  viewBox: string
  inner: string
}

// face.svg / kit.svg color via inline `style="fill:…"`, which beats the `fill`
// attribute — so recolor by overriding the inline style (and set the attribute
// too, for good measure).
function paint(n: Element | null | undefined, color: string) {
  if (!n) return
  ;(n as SVGElement).style.setProperty('fill', color)
  n.setAttribute('fill', color)
}

/** Recolor the face (skin/hair by id) for a preview. */
export function facePreview(skin: string, hair: string): SvgPreview | null {
  if (!faceTpl) return null
  const c = faceTpl.cloneNode(true) as SVGElement
  paint(c.querySelector('#skin'), skin)
  paint(c.querySelector('#hair'), hair)
  return { viewBox: faceTpl.getAttribute('viewBox') ?? '0 0 65 81', inner: c.innerHTML }
}

/** Resolve the v/h stripe fills for a style (relative to the jersey color). */
export function stripeFills(style: KitStyle, jersey: string, stripe: string): { v: string; h: string } {
  return {
    v: style === 'vstripes' || style === 'checker' ? stripe : jersey,
    h: style === 'hstripes' || style === 'checker' ? stripe : jersey,
  }
}

/** Recolor the kit preview (body as a neutral silhouette, kit parts colored). */
export function kitPreview(kit: { jersey: string; shorts: string; socks: string; stripe: string; style: KitStyle }): SvgPreview | null {
  if (!kitTpl) return null
  const c = kitTpl.cloneNode(true) as SVGElement
  const set = (sel: string, color: string) => c.querySelectorAll(sel).forEach((n) => paint(n, color))
  const body = '#3a3a3a'
  set('.skin', body)
  set('.hair', body)
  set('.shoes', body)
  set('.base_tshirt', kit.jersey)
  set('.shorts', kit.shorts)
  set('.socks', kit.socks)
  const { v, h } = stripeFills(kit.style, kit.jersey, kit.stripe)
  set('.v_stripe', v)
  set('.h_stripe', h)
  return { viewBox: kitTpl.getAttribute('viewBox') ?? '0 0 100 100', inner: c.innerHTML }
}

/** The set of SVG paths that are player figures (players category only). */
export function playerSvgs(catalog: Catalog | null): Set<string> {
  const out = new Set<string>()
  for (const f of catalog?.categories.players?.figures ?? []) if (f.svg) out.add(f.svg)
  return out
}

import { BOARD_WIDTH, BOARD_HEIGHT, type LogoPosition } from '@youcoach-board/core'
import logoUrl from '../assets/youcoach-logo.svg'
import logoDarkUrl from '../assets/youcoach-logo-dark.svg'

// The YouCoach watermark: geometry shared by the SVG rendering (2D boards,
// BackgroundView) and the WebGL HUD pass (3D fields, Object3DLayer).

export { logoUrl, logoDarkUrl }

export const LOGO_W = 280 // corner width; centered is 2× (see logoRect)
export const LOGO_RATIO = 63 / 398 // logo viewBox is 398×63
export const LOGO_PAD = 40 // identical inset from each relevant border

/** Logo box (board coords) for a position. Centered is twice the size; corners
 *  keep a constant LOGO_PAD inset from their two borders. */
export function logoRect(pos: LogoPosition): { x: number; y: number; w: number; h: number } {
  const w = pos === 'center' ? LOGO_W * 2 : LOGO_W
  const h = w * LOGO_RATIO
  switch (pos) {
    case 'top-left':
      return { x: LOGO_PAD, y: LOGO_PAD, w, h }
    case 'top-right':
      return { x: BOARD_WIDTH - w - LOGO_PAD, y: LOGO_PAD, w, h }
    case 'bottom-left':
      return { x: LOGO_PAD, y: BOARD_HEIGHT - h - LOGO_PAD, w, h }
    case 'bottom-right':
      return { x: BOARD_WIDTH - w - LOGO_PAD, y: BOARD_HEIGHT - h - LOGO_PAD, w, h }
    default:
      return { x: (BOARD_WIDTH - w) / 2, y: (BOARD_HEIGHT - h) / 2, w, h }
  }
}

/** Logo box for an EXPORT frame (w×h px): the board's proportions applied to
 *  the frame — corner width = 280/1200 of the frame width (centered = 2×),
 *  square padding = 40/1200 of the frame width. Exports crop the 4:3 board to
 *  the target aspect, so the logo must be placed relative to the FRAME (a
 *  corner logo would otherwise fall outside a 9:16 crop entirely). */
export function exportLogoRect(pos: LogoPosition, frameW: number, frameH: number): { x: number; y: number; w: number; h: number } {
  const w = (pos === 'center' ? LOGO_W * 2 : LOGO_W) * (frameW / BOARD_WIDTH)
  const h = w * LOGO_RATIO
  const pad = LOGO_PAD * (frameW / BOARD_WIDTH)
  switch (pos) {
    case 'top-left':
      return { x: pad, y: pad, w, h }
    case 'top-right':
      return { x: frameW - w - pad, y: pad, w, h }
    case 'bottom-left':
      return { x: pad, y: frameH - h - pad, w, h }
    case 'bottom-right':
      return { x: frameW - w - pad, y: frameH - h - pad, w, h }
    default:
      return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h }
  }
}

/** Relative luminance (0..1) of a #rgb/#rrggbb color, or null if unparseable. */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** True when the watermark sits on a light surface (a near-white court/surface
 *  color) and needs the DARK logo artwork; false → the white artwork (grass,
 *  dark surfaces). The two variants are distinct designs, not tints. */
export function logoDarkFor(bg: { surfaceColor?: string; courtColor?: string; fieldType?: string; field3d?: unknown; image?: string | null }): boolean {
  const under =
    bg.surfaceColor && bg.surfaceColor !== 'transparent'
      ? bg.surfaceColor
      : bg.field3d && bg.fieldType === 'futsal'
        ? bg.courtColor
        : bg.image
          ? null // the grass photo — dark, white logo reads fine
          : '#ffffff' // no surface, no image: a bare white board
  const l = under ? luminance(under) : null
  return l != null && l > 0.6
}

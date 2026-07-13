import { BOARD_WIDTH, BOARD_HEIGHT, type LogoPosition } from '@youcoach-board/core'
import logoUrl from '../assets/youcoach-logo.svg'

// The YouCoach watermark: geometry shared by the SVG rendering (2D boards,
// BackgroundView) and the WebGL HUD pass (3D fields, Object3DLayer).

export { logoUrl }

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

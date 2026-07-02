import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { buildFigureElement, figureBaseSize, type Catalog } from './assets'
import type { EditorStore } from '../store/editorStore'

/** Add a ball at board center — the first material flagged `material.balls`, sized
 *  like a drawer drop (field figureScale × its sizeFactor). Shared by the More-
 *  tools menu and the "B" keyboard shortcut. */
export function addBall(catalog: Catalog | null, store: EditorStore) {
  const ball = catalog?.categories.materials?.figures.find((f) => f.svg && (f.actions ?? []).includes('material.balls'))
  if (!catalog || !ball?.svg) return
  const s = store.getState()
  const colors = { ...(catalog.defaults.materials ?? {}) }
  const base = figureBaseSize({ w: ball.w, h: ball.h, sizeFactor: ball.sizeFactor ?? 1, category: 'materials' }, s.doc.background.figureScale)
  s.createFigure(buildFigureElement({ figureId: ball.svg, w: Math.round(base.w), h: Math.round(base.h), mirror: false, colors, ball: true }, BOARD_WIDTH / 2, BOARD_HEIGHT / 2))
}

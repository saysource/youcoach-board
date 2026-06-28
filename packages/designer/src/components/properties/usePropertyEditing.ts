import type { BoardElement, ElementPatch, StrokeStyle } from '@youcoach-board/core'
import { useEditorStore } from '../../store/context'

/** Closed shapes can be filled (background color); open ones can't. */
export function isClosed(el: BoardElement): boolean {
  return el.type === 'rect' || el.type === 'ellipse' || (el.type === 'polyline' && el.closed)
}

/** Shared value across a set, or undefined when they differ (mixed). */
function common<T>(els: BoardElement[], get: (el: BoardElement) => T): T | undefined {
  if (els.length === 0) return undefined
  const first = get(els[0])
  return els.every((e) => get(e) === first) ? first : undefined
}

// Reads the selection's current property values (undefined = mixed) and writes
// changes as single undoable `update` ops. Fill only targets closed shapes.
export function usePropertyEditing() {
  const doc = useEditorStore((s) => s.doc)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const updateElements = useEditorStore((s) => s.updateElements)
  const els = doc.elements.filter((e) => selectedIds.includes(e.id))
  const closedEls = els.filter(isClosed)

  function patch(targets: BoardElement[], make: (el: BoardElement) => { before: ElementPatch; after: ElementPatch }) {
    if (targets.length === 0) return
    updateElements(targets.map((el) => ({ id: el.id, ...make(el) })))
  }

  return {
    count: els.length,
    hasClosed: closedEls.length > 0,
    values: {
      stroke: common(els, (e) => e.stroke),
      strokeWidth: common(els, (e) => e.strokeWidth),
      strokeStyle: common(els, (e) => e.strokeStyle),
      fill: common(closedEls, (e) => e.fill),
      opacity: common(els, (e) => e.transform.opacity),
    },
    setStroke: (stroke: string) => patch(els, (e) => ({ before: { stroke: e.stroke }, after: { stroke } })),
    setStrokeWidth: (strokeWidth: number) =>
      patch(els, (e) => ({ before: { strokeWidth: e.strokeWidth }, after: { strokeWidth } })),
    setStrokeStyle: (strokeStyle: StrokeStyle) =>
      patch(els, (e) => ({ before: { strokeStyle: e.strokeStyle }, after: { strokeStyle } })),
    setFill: (fill: string) => patch(closedEls, (e) => ({ before: { fill: e.fill }, after: { fill } })),
    setOpacity: (opacity: number) =>
      patch(els, (e) => ({ before: { transform: e.transform }, after: { transform: { ...e.transform, opacity } } })),
  }
}

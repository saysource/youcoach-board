import type { BoardElement, ElementPatch, StrokeStyle } from '@youcoach-board/core'
import { useEditorStore } from '../../store/context'
import { isCreationTool } from '../../store/editorStore'
import { toolCreatesClosed } from '../../lib/draw'

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

// The properties panel edits one of two subjects:
//   - the SELECTION (1+ elements) — writes single undoable `update` ops, and
//   - the TOOL DEFAULTS (when nothing is selected) — the "next figure" style, so
//     the user can pre-set stroke/fill/… before drawing. Either way it exposes
//     the same { values, setters, hasClosed } shape, so the controls don't care.
export function usePropertyEditing() {
  const doc = useEditorStore((s) => s.doc)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const activeTool = useEditorStore((s) => s.activeTool)
  const updateElements = useEditorStore((s) => s.updateElements)
  const toolDefaults = useEditorStore((s) => s.toolDefaults)
  const setToolDefaults = useEditorStore((s) => s.setToolDefaults)
  const els = doc.elements.filter((e) => selectedIds.includes(e.id))
  const editingSelection = els.length > 0
  // Whether the panel currently has an editable subject (a selection, or a tool
  // that will create a styled figure). Otherwise it shows just the header.
  const editable = editingSelection || isCreationTool(activeTool)

  if (!editingSelection) {
    // Edit the tool defaults. `hasClosed` follows the future element's shape.
    return {
      editingSelection,
      editable,
      count: 0,
      activeTool,
      els,
      hasClosed: toolCreatesClosed(activeTool),
      values: {
        stroke: toolDefaults.stroke as string | undefined,
        strokeWidth: toolDefaults.strokeWidth as number | undefined,
        strokeStyle: toolDefaults.strokeStyle as StrokeStyle | undefined,
        fill: toolDefaults.fill as string | undefined,
        opacity: toolDefaults.opacity as number | undefined,
      },
      setStroke: (stroke: string) => setToolDefaults({ stroke }),
      setStrokeWidth: (strokeWidth: number) => setToolDefaults({ strokeWidth }),
      setStrokeStyle: (strokeStyle: StrokeStyle) => setToolDefaults({ strokeStyle }),
      setFill: (fill: string) => setToolDefaults({ fill }),
      setOpacity: (opacity: number) => setToolDefaults({ opacity }),
    }
  }

  const closedEls = els.filter(isClosed)

  function patch(targets: BoardElement[], make: (el: BoardElement) => { before: ElementPatch; after: ElementPatch }) {
    if (targets.length === 0) return
    updateElements(targets.map((el) => ({ id: el.id, ...make(el) })))
  }
  // Editing the selection also refreshes the next-figure default (last-used).
  const remember = (patch: Partial<typeof toolDefaults>) => setToolDefaults(patch)

  return {
    editingSelection,
    editable,
    count: els.length,
    activeTool,
    els,
    hasClosed: closedEls.length > 0,
    values: {
      stroke: common(els, (e) => e.stroke),
      strokeWidth: common(els, (e) => e.strokeWidth),
      strokeStyle: common(els, (e) => e.strokeStyle),
      fill: common(closedEls, (e) => e.fill),
      opacity: common(els, (e) => e.transform.opacity),
    },
    setStroke: (stroke: string) => {
      patch(els, (e) => ({ before: { stroke: e.stroke }, after: { stroke } }))
      remember({ stroke })
    },
    setStrokeWidth: (strokeWidth: number) => {
      patch(els, (e) => ({ before: { strokeWidth: e.strokeWidth }, after: { strokeWidth } }))
      remember({ strokeWidth })
    },
    setStrokeStyle: (strokeStyle: StrokeStyle) => {
      patch(els, (e) => ({ before: { strokeStyle: e.strokeStyle }, after: { strokeStyle } }))
      remember({ strokeStyle })
    },
    setFill: (fill: string) => {
      patch(closedEls, (e) => ({ before: { fill: e.fill }, after: { fill } }))
      remember({ fill })
    },
    setOpacity: (opacity: number) => {
      patch(els, (e) => ({ before: { transform: e.transform }, after: { transform: { ...e.transform, opacity } } }))
      remember({ opacity })
    },
  }
}

import { createStore } from 'zustand/vanilla'
import {
  type BoardDoc,
  type BoardElement,
  type BoardBackground,
  type Operation,
  type ElementChange,
  type ElementPatch,
  applyOperation,
  invertOperation,
} from '@youcoach-board/core'
import type { ToolId } from '../components/Toolbar'
import { type FigureStyle, DEFAULT_FIGURE_STYLE, figureStyleOf, isShapeTool, isLineTool } from '../lib/draw'

/** Tools that put the editor in figure-creation mode (crosshair cursor,
 *  elements non-interactive, selection cleared). The line/arrow tools draft a
 *  straight line on drag, or a multi-point polyline on click (see
 *  InteractiveBoard); see toolElementType for the drag-create mapping. */
export function isCreationTool(tool: ToolId): boolean {
  return isShapeTool(tool) || isLineTool(tool) || tool === 'draw'
}

export interface EditorState {
  doc: BoardDoc
  activeTool: ToolId
  /** Currently selected element ids (multi-selection). */
  selectedIds: string[]
  /** When true, a creation tool stays active after creating (the lock toggle);
   *  otherwise the editor falls back to the selection tool, per the spec. */
  keepToolActive: boolean

  /** Style for the next element to be created — editable in the properties panel
   *  before anything is selected (so the user can pre-set stroke/fill/… ), and
   *  refreshed to the last created/edited element's style. */
  toolDefaults: FigureStyle

  /** Bumped whenever a `figure` element is created — lets the shell auto-close
   *  the (overlay) library drawer after a figure is dropped. */
  figureAddedTick: number

  /** Style copied via "Copy style", to be applied with "Paste style". */
  styleClipboard: FigureStyle | null

  // Undo/redo: a flat operation stack + a pointer to the last applied operation
  // (VA's model). Everything before/at `pointer` is "done"; everything after is
  // the redo branch, truncated on the next push.
  stack: Operation[]
  pointer: number

  setActiveTool: (tool: ToolId) => void
  toggleKeepTool: () => void
  /** Merge changes into the next-element style defaults. */
  setToolDefaults: (patch: Partial<FigureStyle>) => void
  /** Replace the current selection (pass [] to clear). */
  setSelection: (ids: string[]) => void
  /** Create a figure (records it on the undo stack), select it, and — unless
   *  the tool is locked — switch back to the selection tool. */
  createFigure: (element: BoardElement) => void
  deleteSelected: () => void
  /** Apply a set of element attribute changes as one undoable operation — the
   *  workhorse for move (and later resize / restyle). */
  updateElements: (changes: ElementChange[]) => void
  /** Merge changes into the document background (not on the undo stack for now). */
  setBackground: (patch: Partial<BoardBackground>) => void
  /** Clone the selected elements (offset) as one undoable op; select the clones. */
  duplicateSelected: () => void
  /** Change the selected elements' z-order (one undoable reorder op). */
  arrangeSelected: (mode: 'front' | 'back' | 'forward' | 'backward') => void
  /** Copy the (single) selected element's style; paste it onto the selection. */
  copyStyle: () => void
  pasteStyle: () => void
  /** Begin coalescing property edits (e.g. while a color picker is open):
   *  `updateElements` applies live for feedback but does NOT push to the undo
   *  stack. `commitTransaction` then records the *net* before→after as ONE op,
   *  so dragging a color through hundreds of values is a single undo step. */
  beginTransaction: () => void
  commitTransaction: () => void
  undo: () => void
  redo: () => void
}

/** Keep only the selected ids whose elements still exist in `doc` (used after
 *  undo/redo so removals drop their selection but other edits keep it). */
function keepExisting(ids: string[], doc: BoardDoc): string[] {
  const present = new Set(doc.elements.map((e) => e.id))
  return ids.filter((id) => present.has(id))
}

/** Whether two element patches are equivalent (to drop no-op edits on commit). */
function patchEqual(a: ElementPatch, b: ElementPatch): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (JSON.stringify((a as Record<string, unknown>)[k]) !== JSON.stringify((b as Record<string, unknown>)[k])) return false
  }
  return true
}

export type EditorStore = ReturnType<typeof createEditorStore>

// Created per <BoardDesigner> instance (not a module singleton) so multiple
// embeds on one page stay isolated. `onChange` is notified on every committed
// document change — the editor's outward "the drawing changed" signal.
export function createEditorStore(initialDoc: BoardDoc, onChange?: (doc: BoardDoc) => void) {
  return createStore<EditorState>((set, get) => {
    // In-progress property transaction: net element changes + the background's
    // value at transaction start, kept off the undo stack until commit. Internal
    // (not reactive) bookkeeping.
    let txn: { changes: Record<string, ElementChange>; bgBefore: BoardBackground | null } | null = null

    // Push an operation: apply it, drop any redo branch, advance the pointer.
    function push(op: Operation) {
      const { doc, stack, pointer } = get()
      const nextDoc = applyOperation(doc, op)
      const nextStack = stack.slice(0, pointer + 1)
      nextStack.push(op)
      set({ doc: nextDoc, stack: nextStack, pointer: pointer + 1 })
      onChange?.(nextDoc)
    }

    return {
      doc: initialDoc,
      activeTool: 'select',
      selectedIds: [],
      keepToolActive: false,
      toolDefaults: { ...DEFAULT_FIGURE_STYLE },
      figureAddedTick: 0,
      styleClipboard: null,
      stack: [],
      pointer: -1,

      setActiveTool: (tool) =>
        set((s) => ({
          activeTool: tool,
          // Picking a creation tool clears the current selection (Excalidraw-like).
          selectedIds: isCreationTool(tool) ? [] : s.selectedIds,
        })),

      toggleKeepTool: () => set((s) => ({ keepToolActive: !s.keepToolActive })),

      setToolDefaults: (patch) => set((s) => ({ toolDefaults: { ...s.toolDefaults, ...patch } })),

      setSelection: (ids) => set({ selectedIds: ids }),

      createFigure: (element) => {
        const { doc, keepToolActive, activeTool } = get()
        push({ kind: 'add', element, index: doc.elements.length })
        set((s) => ({
          selectedIds: [element.id],
          activeTool: keepToolActive ? activeTool : 'select',
          // Remember the created element's style as the next-figure default.
          toolDefaults: figureStyleOf(element),
          figureAddedTick: s.figureAddedTick + (element.type === 'figure' ? 1 : 0),
        }))
      },

      deleteSelected: () => {
        const { doc, selectedIds } = get()
        if (selectedIds.length === 0) return
        // Remove highest-index-first so each removal's index stays valid; the
        // transaction's inverse re-adds them low-to-high (see operations.ts).
        const entries = selectedIds
          .map((id) => ({ index: doc.elements.findIndex((e) => e.id === id) }))
          .filter((e) => e.index >= 0)
          .sort((a, b) => b.index - a.index)
        if (entries.length === 0) return
        const ops: Operation[] = entries.map(({ index }) => ({
          kind: 'remove',
          element: doc.elements[index],
          index,
        }))
        push(ops.length === 1 ? ops[0] : { kind: 'transaction', label: 'delete', ops })
        set({ selectedIds: [] })
      },

      updateElements: (changes) => {
        if (changes.length === 0) return
        if (txn) {
          // Apply live for feedback, but accumulate the net change instead of
          // pushing — committed as one op later. Don't fire onChange mid-drag.
          const { doc } = get()
          set({ doc: applyOperation(doc, { kind: 'update', changes }) })
          for (const ch of changes) {
            const prev = txn.changes[ch.id]
            // before: keep each field's earliest value; after: keep the latest.
            txn.changes[ch.id] = prev
              ? { id: ch.id, before: { ...ch.before, ...prev.before }, after: { ...prev.after, ...ch.after } }
              : { ...ch }
          }
          return
        }
        push({ kind: 'update', changes })
      },

      beginTransaction: () => {
        // Idempotent: nested/repeated begins keep the original snapshot, so a
        // continuous control can call it on every change without resetting.
        if (!txn) txn = { changes: {}, bgBefore: null }
      },

      commitTransaction: () => {
        const t = txn
        txn = null
        if (!t) return
        const ops: Operation[] = []
        // The doc already reflects the live edits; record the net element change
        // (dropping fields that ended up unchanged) as a single op.
        const changes = Object.values(t.changes)
          .map((c) => {
            const before: ElementPatch = {}
            const after: ElementPatch = {}
            const keys = new Set([...Object.keys(c.before), ...Object.keys(c.after)]) as Set<keyof ElementPatch>
            for (const k of keys) {
              if (JSON.stringify(c.before[k]) === JSON.stringify(c.after[k])) continue
              ;(before as Record<string, unknown>)[k] = c.before[k]
              ;(after as Record<string, unknown>)[k] = c.after[k]
            }
            return { id: c.id, before, after }
          })
          .filter((c) => !patchEqual(c.before, c.after))
        if (changes.length > 0) ops.push({ kind: 'update', changes })
        // Net background change, if any.
        const bgAfter = get().doc.background
        if (t.bgBefore && JSON.stringify(t.bgBefore) !== JSON.stringify(bgAfter)) {
          ops.push({ kind: 'background', before: t.bgBefore, after: bgAfter })
        }
        if (ops.length === 0) {
          onChange?.(get().doc) // live edits may have netted to nothing
          return
        }
        // applyOperation re-applies absolute 'after' values — a no-op since the doc
        // already reflects them — so this just records the reversible op(s).
        push(ops.length === 1 ? ops[0] : { kind: 'transaction', label: 'edit', ops })
      },

      setBackground: (patch) => {
        const { doc } = get()
        const next = { ...doc.background, ...patch }
        if (txn) {
          // Capture the pre-transaction background once; apply live (no stack push).
          if (txn.bgBefore === null) txn.bgBefore = doc.background
          set({ doc: { ...doc, background: next } })
          return
        }
        push({ kind: 'background', before: doc.background, after: next })
      },

      duplicateSelected: () => {
        const { doc, selectedIds } = get()
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (sel.length === 0) return
        const OFFSET = 16
        const clones = sel.map((e) => {
          const c = structuredClone(e) as BoardElement
          c.id = crypto.randomUUID()
          c.transform = { ...c.transform, x: c.transform.x + OFFSET, y: c.transform.y + OFFSET }
          return c
        })
        const ops: Operation[] = clones.map((element, i) => ({ kind: 'add', element, index: doc.elements.length + i }))
        push(ops.length === 1 ? ops[0] : { kind: 'transaction', label: 'duplicate', ops })
        set({ selectedIds: clones.map((c) => c.id) })
      },

      arrangeSelected: (mode) => {
        const { doc, selectedIds } = get()
        if (selectedIds.length === 0) return
        const ids = doc.elements.map((e) => e.id)
        const sel = new Set(selectedIds)
        const nonSel = ids.filter((id) => !sel.has(id))
        const selOrdered = ids.filter((id) => sel.has(id))
        let order: string[]
        if (mode === 'front') order = [...nonSel, ...selOrdered]
        else if (mode === 'back') order = [...selOrdered, ...nonSel]
        else {
          order = ids.slice()
          if (mode === 'forward') {
            // Move each selected one step toward the end (top); high→low avoids collisions.
            for (let i = order.length - 2; i >= 0; i--) if (sel.has(order[i]) && !sel.has(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]]
          } else {
            for (let i = 1; i < order.length; i++) if (sel.has(order[i]) && !sel.has(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]]
          }
        }
        if (order.every((id, i) => id === ids[i])) return // no change
        push({ kind: 'reorder', order, prevOrder: ids })
      },

      copyStyle: () => {
        const { doc, selectedIds } = get()
        const el = doc.elements.find((e) => selectedIds.includes(e.id))
        if (el) set({ styleClipboard: figureStyleOf(el) })
      },

      pasteStyle: () => {
        const { doc, selectedIds, styleClipboard } = get()
        if (!styleClipboard) return
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (sel.length === 0) return
        const st = styleClipboard
        push({
          kind: 'update',
          changes: sel.map((e) => ({
            id: e.id,
            before: { stroke: e.stroke, strokeWidth: e.strokeWidth, strokeStyle: e.strokeStyle, fill: e.fill, transform: e.transform },
            after: { stroke: st.stroke, strokeWidth: st.strokeWidth, strokeStyle: st.strokeStyle, fill: st.fill, transform: { ...e.transform, opacity: st.opacity } },
          })),
        })
      },

      undo: () => {
        const { stack, pointer, doc, selectedIds } = get()
        if (pointer < 0) return
        const nextDoc = applyOperation(doc, invertOperation(stack[pointer]))
        // Keep the selection across undo, but drop ids of elements the undo
        // removed (e.g. undoing a create) — so only delete-like undos clear it.
        set({ doc: nextDoc, pointer: pointer - 1, selectedIds: keepExisting(selectedIds, nextDoc) })
        onChange?.(nextDoc)
      },

      redo: () => {
        const { stack, pointer, doc, selectedIds } = get()
        if (pointer >= stack.length - 1) return
        const nextDoc = applyOperation(doc, stack[pointer + 1])
        set({ doc: nextDoc, pointer: pointer + 1, selectedIds: keepExisting(selectedIds, nextDoc) })
        onChange?.(nextDoc)
      },
    }
  })
}

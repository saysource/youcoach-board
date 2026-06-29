import { createStore } from 'zustand/vanilla'
import {
  type BoardDoc,
  type BoardElement,
  type BoardBackground,
  type Operation,
  type ElementChange,
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
  undo: () => void
  redo: () => void
}

export type EditorStore = ReturnType<typeof createEditorStore>

// Created per <BoardDesigner> instance (not a module singleton) so multiple
// embeds on one page stay isolated. `onChange` is notified on every committed
// document change — the editor's outward "the drawing changed" signal.
export function createEditorStore(initialDoc: BoardDoc, onChange?: (doc: BoardDoc) => void) {
  return createStore<EditorState>((set, get) => {
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
        push({ kind: 'update', changes })
      },

      setBackground: (patch) => {
        const { doc } = get()
        const next = { ...doc, background: { ...doc.background, ...patch } }
        set({ doc: next })
        onChange?.(next)
      },

      undo: () => {
        const { stack, pointer, doc } = get()
        if (pointer < 0) return
        const nextDoc = applyOperation(doc, invertOperation(stack[pointer]))
        set({ doc: nextDoc, pointer: pointer - 1, selectedIds: [] })
        onChange?.(nextDoc)
      },

      redo: () => {
        const { stack, pointer, doc } = get()
        if (pointer >= stack.length - 1) return
        const nextDoc = applyOperation(doc, stack[pointer + 1])
        set({ doc: nextDoc, pointer: pointer + 1, selectedIds: [] })
        onChange?.(nextDoc)
      },
    }
  })
}

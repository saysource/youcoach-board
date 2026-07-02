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
  getElementBounds,
  BOARD_WIDTH,
  BOARD_HEIGHT,
} from '@youcoach-board/core'
import type { ToolId } from '../components/Toolbar'
import defaultFieldImage from '../assets/field0.jpg'
import { type FigureStyle, type TokenDefaults, type TextDefaults, DEFAULT_FIGURE_STYLE, DEFAULT_TOKEN_DEFAULTS, DEFAULT_TEXT_DEFAULTS, figureStyleOf, isShapeTool, isLineTool, rectToPolyline, measureTextBox, nextTokenText } from '../lib/draw'
import { type PlayerKit, KIT_HISTORY_SIZE, kitKey } from '../lib/player-kit'

/** Tools that put the editor in figure-creation mode (crosshair cursor,
 *  elements non-interactive, selection cleared). The line/arrow tools draft a
 *  straight line on drag, or a multi-point polyline on click (see
 *  InteractiveBoard); see toolElementType for the drag-create mapping. */
export function isCreationTool(tool: ToolId): boolean {
  return isShapeTool(tool) || isLineTool(tool) || tool === 'draw' || tool === 'token' || tool === 'text'
}

// ── Viewport (zoom/pan) ──────────────────────────────────────────────────────
// View transform expressed as the SVG viewBox: zoom ≥ 1 (1 = whole board fills),
// pan in board units, clamped so the view never leaves the board.
export interface Viewport {
  zoom: number
  panX: number
  panY: number
}
const MIN_ZOOM = 0.5
const MAX_ZOOM = 8
const ZOOM_STEP = 1.25
const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
// Clamp one axis of the pan: when the view is larger than the board (zoom < 1)
// center it (letterbox); otherwise keep it within the board edges.
function clampAxis(v: number, size: number, board: number): number {
  return size >= board ? (board - size) / 2 : clampNum(v, 0, board - size)
}
function clampViewport(zoom: number, panX: number, panY: number): Viewport {
  const z = clampNum(zoom, MIN_ZOOM, MAX_ZOOM)
  return { zoom: z, panX: clampAxis(panX, BOARD_WIDTH / z, BOARD_WIDTH), panY: clampAxis(panY, BOARD_HEIGHT / z, BOARD_HEIGHT) }
}
// Zoom by a factor, keeping the anchor board-point fixed on screen (defaults to
// the current view center).
function zoomToward(vp: Viewport, factor: number, anchor?: { x: number; y: number }): Viewport {
  const z = clampNum(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  const curW = BOARD_WIDTH / vp.zoom
  const curH = BOARD_HEIGHT / vp.zoom
  const ax = anchor?.x ?? vp.panX + curW / 2
  const ay = anchor?.y ?? vp.panY + curH / 2
  const fx = (ax - vp.panX) / curW
  const fy = (ay - vp.panY) / curH
  return clampViewport(z, ax - fx * (BOARD_WIDTH / z), ay - fy * (BOARD_HEIGHT / z))
}

// Appearance fields carried by Copy/Paste style — everything EXCEPT geometry
// (position, points, size, scale) and identity/content (figureId, text, label).
// Applied only where both source and target have the field, so it's safe across
// element types. Opacity travels via transform, handled separately.
const STYLE_KEYS: (keyof ElementPatch)[] = [
  'stroke', 'strokeWidth', 'strokeStyle', 'fill', 'fillStyle',
  'colors', 'mirror',
  'closed', 'curve', 'zigzag', 'waveLength', 'waveAmplitude', 'double', 'linesOffset', 'startTip', 'endTip',
  'shape', 'tokenFill', 'color1', 'color2', 'textColor', 'showLabel',
  'bgColor', 'fontSize', 'align', 'bold',
]

/** Alignment / distribution modes for a multi-selection. */
export type AlignMode = 'left' | 'centerX' | 'right' | 'distributeX' | 'top' | 'centerY' | 'bottom' | 'distributeY'

export interface EditorState {
  doc: BoardDoc
  activeTool: ToolId
  /** Currently selected element ids (multi-selection). */
  selectedIds: string[]
  /** Id of the last token selected or created — its live style seeds the next
   *  stamped token ("team kit" inheritance). Kept even when the selection moves
   *  off tokens; cleared lazily if the element no longer exists. */
  /** Style + starting text/label for the NEXT token: inherited from the last
   *  selected/created token, and edited via the panel while the Token tool is up. */
  tokenDefaults: TokenDefaults
  /** Style for the NEXT text element: inherited from the last selected/created
   *  text, and edited via the panel while the Text tool is active. */
  textDefaults: TextDefaults
  /** Id of the most recently selected/created token. A new token copies this
   *  token's CURRENT size (so resizes are reflected); null falls back to any
   *  token on the board, else the field's figure scale. */
  lastTokenId: string | null
  /** Last custom color used per material action/category (e.g. "material.wall" →
   *  "#ffcc00"), so a newly added material of that category inherits it. Updated
   *  when a recolorable material is selected or its color changes. */
  materialColors: Record<string, string>
  /** Last size per figure (as a scale multiplier over its default), keyed by
   *  figureId, so re-adding that figure reuses the size. Updated when a figure is
   *  selected or resized. */
  figureScales: Record<string, number>
  /** The last selected player's skin/kit color slots, so a newly added player
   *  inherits its look (like material color / figure size). */
  playerColors: Record<string, string>
  /** The last few configured kits (FIFO, newest first) shown as presets in the
   *  kit editor. */
  kitHistory: PlayerKit[]
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

  /** Source element copied via "Copy style" — Paste style applies all of its
   *  appearance (everything except geometry: position, points, size, scale). */
  styleClipboard: BoardElement | null

  /** Elements copied via Copy/Cut (clones), pasted as offset copies. */
  clipboard: BoardElement[]

  /** View transform (zoom/pan). Not part of the document. */
  viewport: Viewport

  // Undo/redo: a flat operation stack + a pointer to the last applied operation
  // (VA's model). Everything before/at `pointer` is "done"; everything after is
  // the redo branch, truncated on the next push.
  stack: Operation[]
  pointer: number

  setActiveTool: (tool: ToolId) => void
  toggleKeepTool: () => void
  /** Merge changes into the next-element style defaults. */
  setToolDefaults: (patch: Partial<FigureStyle>) => void
  /** Merge changes into the next-token defaults (style/text/label). */
  setTokenDefaults: (patch: Partial<TokenDefaults>) => void
  /** Merge changes into the next-text defaults (color/bg/size/align). */
  setTextDefaults: (patch: Partial<TextDefaults>) => void
  /** Remember the last custom color for a material action/category. */
  rememberMaterialColor: (action: string, color: string) => void
  /** Remember the last size (scale multiplier) used for a figure. */
  rememberFigureScale: (figureId: string, scale: number) => void
  /** Remember the last selected player's skin/kit color slots. */
  rememberPlayerColors: (colors: Record<string, string>) => void
  /** Push a configured kit to the front of the FIFO history (deduped). */
  pushKit: (kit: PlayerKit) => void
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
  /** Restore the background to its default (one undoable op). */
  resetBackground: () => void
  /** Clone the selected elements (offset) as one undoable op; select the clones. */
  duplicateSelected: () => void
  /** Clone the selection in place (offset 0), select the clones, and return them
   *  — for ⌥-drag duplication. Tokens get the next team number. */
  duplicateInPlace: () => BoardElement[]
  /** Copy the selected elements (clones) to the clipboard. */
  copySelection: () => void
  /** Copy the selection then delete it. */
  cutSelection: () => void
  /** Paste the clipboard as offset clones (new ids), and select them. */
  paste: () => void
  /** Select every element on the board. */
  selectAll: () => void
  /** Move the selected elements by (dx, dy) board units (one undoable op). */
  nudgeSelected: (dx: number, dy: number) => void
  /** Scale the selected elements by a factor about their own centers. */
  resizeSelected: (factor: number) => void
  /** Horizontally mirror the selected figures (toggle their `mirror` flag). */
  flipSelected: () => void
  /** Toggle bold on the selected text elements (⌘B). */
  toggleTextBold: () => void
  /** Zoom the view in / out (about center), reset to 100%, or frame the selection. */
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  zoomToSelection: () => void
  /** Zoom by a factor, keeping the anchor board-point fixed (for ⌘+wheel). */
  zoomBy: (factor: number, anchor?: { x: number; y: number }) => void
  /** Pan the view by (dx, dy) board units (clamped to the board). */
  panBy: (dx: number, dy: number) => void
  /** Change the selected elements' z-order (one undoable reorder op). */
  arrangeSelected: (mode: 'front' | 'back' | 'forward' | 'backward') => void
  /** Align or distribute the selection (needs ≥2 elements; distribute needs ≥3). */
  alignSelected: (mode: AlignMode) => void
  /** Copy the (single) selected element's style; paste it onto the selection. */
  copyStyle: () => void
  pasteStyle: () => void
  /** Convert every selected rectangle into an equivalent closed polyline (one
   *  undoable op); non-rectangles in the selection are left untouched. */
  convertRectsToPolylines: () => void
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
      tokenDefaults: { ...DEFAULT_TOKEN_DEFAULTS },
      textDefaults: { ...DEFAULT_TEXT_DEFAULTS },
      lastTokenId: null,
      materialColors: {},
      figureScales: {},
      playerColors: {},
      kitHistory: [],
      keepToolActive: false,
      toolDefaults: { ...DEFAULT_FIGURE_STYLE },
      figureAddedTick: 0,
      styleClipboard: null,
      clipboard: [],
      viewport: { zoom: 1, panX: 0, panY: 0 },
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

      setTokenDefaults: (patch) => set((s) => ({ tokenDefaults: { ...s.tokenDefaults, ...patch } })),

      setTextDefaults: (patch) => set((s) => ({ textDefaults: { ...s.textDefaults, ...patch } })),

      rememberMaterialColor: (action, color) =>
        set((s) => (s.materialColors[action] === color ? s : { materialColors: { ...s.materialColors, [action]: color } })),

      rememberFigureScale: (figureId, scale) =>
        set((s) => (s.figureScales[figureId] === scale ? s : { figureScales: { ...s.figureScales, [figureId]: scale } })),

      rememberPlayerColors: (colors) =>
        set((s) => (JSON.stringify(s.playerColors) === JSON.stringify(colors) ? s : { playerColors: colors })),

      pushKit: (kit) =>
        set((s) => {
          const rest = s.kitHistory.filter((k) => kitKey(k) !== kitKey(kit))
          if (rest.length === s.kitHistory.length && s.kitHistory[0] && kitKey(s.kitHistory[0]) === kitKey(kit)) return s
          return { kitHistory: [kit, ...rest].slice(0, KIT_HISTORY_SIZE) }
        }),

      setSelection: (ids) =>
        set((s) => {
          // Selecting a token makes its style (+ starting text) the next-token
          // defaults — but not its label (names stay per-token).
          const tok = ids.map((id) => s.doc.elements.find((e) => e.id === id)).find((e) => e?.type === 'token')
          if (tok && tok.type === 'token') {
            const { shape, tokenFill, color1, color2, textColor, showLabel, text } = tok
            return { selectedIds: ids, lastTokenId: tok.id, tokenDefaults: { ...s.tokenDefaults, shape, tokenFill, color1, color2, textColor, showLabel, text } }
          }
          // Selecting a text element makes its style the next-text defaults.
          const txt = ids.map((id) => s.doc.elements.find((e) => e.id === id)).find((e) => e?.type === 'text')
          if (txt && txt.type === 'text') {
            const { textColor, bgColor, fontSize, align, bold } = txt
            return { selectedIds: ids, textDefaults: { ...s.textDefaults, textColor, bgColor, fontSize, align, bold } }
          }
          return { selectedIds: ids }
        }),

      createFigure: (element) => {
        const { doc, keepToolActive, activeTool } = get()
        push({ kind: 'add', element, index: doc.elements.length })
        set((s) => ({
          selectedIds: [element.id],
          lastTokenId: element.type === 'token' ? element.id : s.lastTokenId,
          tokenDefaults:
            element.type === 'token'
              ? { ...s.tokenDefaults, shape: element.shape, tokenFill: element.tokenFill, color1: element.color1, color2: element.color2, textColor: element.textColor, showLabel: element.showLabel, text: element.text }
              : s.tokenDefaults,
          textDefaults:
            element.type === 'text'
              ? { ...s.textDefaults, textColor: element.textColor, bgColor: element.bgColor, fontSize: element.fontSize, align: element.align, bold: element.bold }
              : s.textDefaults,
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

      resetBackground: () => {
        const { doc } = get()
        // Clear the placement (position/scale), restore the default field image
        // (the "transparent" swatch behavior), and recenter the logo.
        const next = { ...doc.background, position: [0, 0] as [number, number], scale: 1, image: defaultFieldImage, logo: 'center' as const }
        if (JSON.stringify(doc.background) === JSON.stringify(next)) return
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

      duplicateInPlace: () => {
        const { doc, selectedIds } = get()
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (sel.length === 0) return []
        const clones = sel.map((e) => {
          const c = structuredClone(e) as BoardElement
          c.id = crypto.randomUUID()
          // A duplicated token joins its team with the next number (like a new one).
          if (c.type === 'token') c.text = nextTokenText(doc.elements, { color1: c.color1, color2: c.color2, textColor: c.textColor, tokenFill: c.tokenFill }, c.text)
          return c
        })
        const ops: Operation[] = clones.map((element, i) => ({ kind: 'add', element, index: doc.elements.length + i }))
        push(ops.length === 1 ? ops[0] : { kind: 'transaction', label: 'duplicate', ops })
        set({ selectedIds: clones.map((c) => c.id) })
        return clones
      },

      copySelection: () => {
        const { doc, selectedIds } = get()
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (sel.length) set({ clipboard: sel.map((e) => structuredClone(e) as BoardElement) })
      },

      cutSelection: () => {
        get().copySelection()
        get().deleteSelected()
      },

      paste: () => {
        const { doc, clipboard } = get()
        if (clipboard.length === 0) return
        const OFFSET = 16
        const clones = clipboard.map((e) => {
          const c = structuredClone(e) as BoardElement
          c.id = crypto.randomUUID()
          c.transform = { ...c.transform, x: c.transform.x + OFFSET, y: c.transform.y + OFFSET }
          return c
        })
        const ops: Operation[] = clones.map((element, i) => ({ kind: 'add', element, index: doc.elements.length + i }))
        push(ops.length === 1 ? ops[0] : { kind: 'transaction', label: 'paste', ops })
        // Advance the clipboard so a repeated paste cascades instead of stacking.
        set({ selectedIds: clones.map((c) => c.id), clipboard: clones.map((c) => structuredClone(c) as BoardElement) })
      },

      selectAll: () => {
        const { doc } = get()
        get().setSelection(doc.elements.map((e) => e.id))
      },

      nudgeSelected: (dx, dy) => {
        const { doc, selectedIds } = get()
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (sel.length === 0) return
        get().updateElements(
          sel.map((e) => ({
            id: e.id,
            before: { transform: e.transform },
            after: { transform: { ...e.transform, x: e.transform.x + dx, y: e.transform.y + dy } },
          })),
        )
      },

      resizeSelected: (factor) => {
        const { doc, selectedIds } = get()
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (sel.length === 0) return
        get().updateElements(
          sel.map((e) => {
            const scale = Math.min(10, Math.max(0.1, e.transform.scale * factor))
            return { id: e.id, before: { transform: e.transform }, after: { transform: { ...e.transform, scale } } }
          }),
        )
      },

      flipSelected: () => {
        const { doc, selectedIds } = get()
        const figs = doc.elements.filter((e) => selectedIds.includes(e.id) && e.type === 'figure') as Extract<BoardElement, { type: 'figure' }>[]
        if (figs.length === 0) return
        get().updateElements(
          figs.map((e) => ({ id: e.id, before: { mirror: e.mirror }, after: { mirror: !e.mirror } })),
        )
      },

      toggleTextBold: () => {
        const { doc, selectedIds } = get()
        const texts = doc.elements.filter((e) => selectedIds.includes(e.id) && e.type === 'text') as Extract<BoardElement, { type: 'text' }>[]
        if (texts.length === 0) return
        // Bold is wider, so re-measure the box and re-center it (matching the panel).
        get().updateElements(
          texts.map((t) => {
            const bold = !t.bold
            const { width, height } = measureTextBox(t.text, t.fontSize, bold)
            return {
              id: t.id,
              before: { bold: t.bold, x: t.x, y: t.y, width: t.width, height: t.height },
              after: { bold, x: t.x + (t.width - width) / 2, y: t.y + (t.height - height) / 2, width, height },
            }
          }),
        )
      },

      zoomIn: () => set((s) => ({ viewport: zoomToward(s.viewport, ZOOM_STEP) })),
      zoomOut: () => set((s) => ({ viewport: zoomToward(s.viewport, 1 / ZOOM_STEP) })),
      zoomBy: (factor, anchor) => set((s) => ({ viewport: zoomToward(s.viewport, factor, anchor) })),
      zoomReset: () => set({ viewport: { zoom: 1, panX: 0, panY: 0 } }),
      panBy: (dx, dy) => set((s) => ({ viewport: clampViewport(s.viewport.zoom, s.viewport.panX + dx, s.viewport.panY + dy) })),

      zoomToSelection: () => {
        const { doc, selectedIds } = get()
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (sel.length === 0) {
          set({ viewport: { zoom: 1, panX: 0, panY: 0 } })
          return
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const e of sel) {
          const b = getElementBounds(e)
          minX = Math.min(minX, b.x)
          minY = Math.min(minY, b.y)
          maxX = Math.max(maxX, b.x + b.width)
          maxY = Math.max(maxY, b.y + b.height)
        }
        const pad = 1.3 // leave breathing room around the selection
        const bw = Math.max(1, maxX - minX) * pad
        const bh = Math.max(1, maxY - minY) * pad
        const z = clampNum(Math.min(BOARD_WIDTH / bw, BOARD_HEIGHT / bh), MIN_ZOOM, MAX_ZOOM)
        set({ viewport: clampViewport(z, (minX + maxX) / 2 - BOARD_WIDTH / z / 2, (minY + maxY) / 2 - BOARD_HEIGHT / z / 2) })
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

      alignSelected: (mode) => {
        const { doc, selectedIds } = get()
        const els = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (els.length < 2) return
        const items = els.map((e) => ({ e, b: getElementBounds(e) }))
        const changes: ElementChange[] = []
        const move = (e: BoardElement, dx: number, dy: number) => {
          if (dx || dy) changes.push({ id: e.id, before: { transform: e.transform }, after: { transform: { ...e.transform, x: e.transform.x + dx, y: e.transform.y + dy } } })
        }
        const minX = Math.min(...items.map((i) => i.b.x))
        const maxX = Math.max(...items.map((i) => i.b.x + i.b.width))
        const minY = Math.min(...items.map((i) => i.b.y))
        const maxY = Math.max(...items.map((i) => i.b.y + i.b.height))
        const cx = (minX + maxX) / 2
        const cy = (minY + maxY) / 2
        if (mode === 'left') items.forEach(({ e, b }) => move(e, minX - b.x, 0))
        else if (mode === 'right') items.forEach(({ e, b }) => move(e, maxX - (b.x + b.width), 0))
        else if (mode === 'centerX') items.forEach(({ e, b }) => move(e, cx - (b.x + b.width / 2), 0))
        else if (mode === 'top') items.forEach(({ e, b }) => move(e, 0, minY - b.y))
        else if (mode === 'bottom') items.forEach(({ e, b }) => move(e, 0, maxY - (b.y + b.height)))
        else if (mode === 'centerY') items.forEach(({ e, b }) => move(e, 0, cy - (b.y + b.height / 2)))
        else if (mode === 'distributeX') {
          if (items.length < 3) return
          const s = items.slice().sort((a, b) => a.b.x + a.b.width / 2 - (b.b.x + b.b.width / 2))
          const totalW = s.reduce((t, i) => t + i.b.width, 0)
          const gap = (s[s.length - 1].b.x + s[s.length - 1].b.width - s[0].b.x - totalW) / (s.length - 1)
          let cur = s[0].b.x
          for (const i of s) { move(i.e, cur - i.b.x, 0); cur += i.b.width + gap }
        } else if (mode === 'distributeY') {
          if (items.length < 3) return
          const s = items.slice().sort((a, b) => a.b.y + a.b.height / 2 - (b.b.y + b.b.height / 2))
          const totalH = s.reduce((t, i) => t + i.b.height, 0)
          const gap = (s[s.length - 1].b.y + s[s.length - 1].b.height - s[0].b.y - totalH) / (s.length - 1)
          let cur = s[0].b.y
          for (const i of s) { move(i.e, 0, cur - i.b.y); cur += i.b.height + gap }
        }
        if (changes.length) push({ kind: 'update', changes })
      },

      copyStyle: () => {
        const { doc, selectedIds } = get()
        const el = doc.elements.find((e) => selectedIds.includes(e.id))
        if (el) set({ styleClipboard: structuredClone(el) })
      },

      pasteStyle: () => {
        const { doc, selectedIds, styleClipboard } = get()
        if (!styleClipboard) return
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (sel.length === 0) return
        const src = styleClipboard as unknown as Record<string, unknown>
        const changes: ElementChange[] = []
        for (const el of sel) {
          const target = el as unknown as Record<string, unknown>
          const before: ElementPatch = {}
          const after: ElementPatch = {}
          for (const k of STYLE_KEYS) {
            if (k in src && k in target) {
              ;(before as Record<string, unknown>)[k] = target[k]
              ;(after as Record<string, unknown>)[k] = src[k]
            }
          }
          // Opacity rides on transform; the target keeps its own geometry.
          before.transform = el.transform
          after.transform = { ...el.transform, opacity: styleClipboard.transform.opacity }
          // Text: re-fit the box if font size or bold came across (both widen it).
          if (el.type === 'text' && ('fontSize' in after || 'bold' in after)) {
            const fontSize = (after.fontSize as number | undefined) ?? el.fontSize
            const bold = (after.bold as boolean | undefined) ?? el.bold
            const { width, height } = measureTextBox(el.text, fontSize, bold)
            before.x = el.x
            after.x = el.x + (el.width - width) / 2
            before.y = el.y
            after.y = el.y + (el.height - height) / 2
            before.width = el.width
            after.width = width
            before.height = el.height
            after.height = height
          }
          changes.push({ id: el.id, before, after })
        }
        push({ kind: 'update', changes })
      },

      convertRectsToPolylines: () => {
        const { doc, selectedIds } = get()
        // Each conversion is remove(rect)+add(polyline) at the SAME index, reusing
        // the rect's id — net-neutral on indices, so original indices stay valid.
        const rects = doc.elements
          .map((el, index) => ({ el, index }))
          .filter(({ el }) => selectedIds.includes(el.id) && el.type === 'rect')
        if (rects.length === 0) return
        const ops: Operation[] = []
        for (const { el, index } of rects) {
          ops.push({ kind: 'remove', element: el, index })
          ops.push({ kind: 'add', element: rectToPolyline(el as Extract<BoardElement, { type: 'rect' }>), index })
        }
        push({ kind: 'transaction', label: 'to polyline', ops })
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

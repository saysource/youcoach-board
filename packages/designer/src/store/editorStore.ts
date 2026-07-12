import { createStore } from 'zustand/vanilla'
import {
  type BoardDoc,
  type BoardElement,
  type BoardBackground,
  type FieldView,
  type AnimationFrame,
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
import { reprojectChanges, reprojectBoardPoints, withGroundAnchors, pinNewShape, groundNudgeDelta, tokenSizeChanges, TOKEN_DEFAULT_SIZE_M } from '../lib/field-anchor'
import { type PlayerKit, KIT_HISTORY_SIZE, kitKey } from '../lib/player-kit'

/** Tools that put the editor in figure-creation mode (crosshair cursor,
 *  elements non-interactive, selection cleared). The line/arrow tools draft a
 *  straight line on drag, or a multi-point polyline on click (see
 *  InteractiveBoard); see toolElementType for the drag-create mapping. */
export function isCreationTool(tool: ToolId): boolean {
  return isShapeTool(tool) || isLineTool(tool) || tool === 'draw' || tool === 'token' || tool === 'text' || tool === 'arrow3d'
}

// ── Viewport (zoom/pan) ──────────────────────────────────────────────────────
// View transform expressed as the SVG viewBox: zoom ≥ 1 (1 = whole board fills),
// pan in board units, clamped so the view never leaves the board.
export interface Viewport {
  zoom: number
  panX: number
  panY: number
}

// Appearance fields carried by Copy/Paste style — everything EXCEPT geometry
// (position, points, size, scale) and identity/content (figureId, text, label).
// Applied only where both source and target have the field, so it's safe across
// element types. Opacity travels via transform, handled separately.
const STYLE_KEYS: (keyof ElementPatch)[] = [
  'stroke', 'strokeWidth', 'strokeStyle', 'fill', 'fillStyle',
  'colors', // NOT `mirror` — flip is orientation, not style
  'closed', 'curve', 'zigzag', 'waveLength', 'waveAmplitude', 'double', 'linesOffset', 'startTip', 'endTip',
  'shape', 'tokenFill', 'color1', 'color2', 'textColor', 'showLabel',
  'bgColor', 'fontSize', 'align', 'bold',
]

/** Alignment / distribution modes for a multi-selection. */
export type AlignMode = 'left' | 'centerX' | 'right' | 'distributeX' | 'top' | 'centerY' | 'bottom' | 'distributeY'

/** Which export-aspect guide frame to overlay on the canvas (for composing an
 *  image export), or 'off'. */
export type ExportGuide = 'off' | '4:3' | '16:9' | '9:16'

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
  /** While a player pose is dragged from the drawer: the id of the selected 3D
   *  player that a drop would REPLACE (its outline turns red), or null. */
  dropReplaceId: string | null
  setDropReplaceId: (id: string | null) => void
  /** When true, a creation tool stays active after creating (the lock toggle);
   *  otherwise the editor falls back to the selection tool, per the spec. */
  keepToolActive: boolean
  /** When true, dragging a selection snaps its bounding box to other elements'
   *  edges/centers and draws alignment guides. Toggled with ⌥S or the menu. */
  snapToObjects: boolean
  /** Admin mode: reveals the authoring-only tools (field homography/camera/zones)
   *  in a dedicated main-menu section. Off for final users; toggled via ?admin=1 in
   *  the URL or the ⌥⇧A shortcut. */
  adminMode: boolean
  /** Export-aspect guide frame overlaid on the canvas (4:3 / 16:9 / 9:16), or 'off'
   *  — a composition aid for framing an image export. */
  exportGuide: ExportGuide
  /** The GLOBAL token size (metric diameter, metres) shared by every token on the
   *  board — tokens are always this size, always perspective-scaled by depth (like
   *  circular objects facing the camera). This holds the value for the NEXT token /
   *  a token-less board; once tokens exist their (synced) `sizeM` is the live truth.
   *  The properties slider maps 2 m … 10 m. */
  tokenSizeM: number

  /** GLOBAL font multipliers, shared by every token on the board: the badge NUMBER
   *  (`tokenTextScale`) and the caption LABEL (`tokenLabelScale`), 1 = default.
   *  Purely visual — applied at render time, not baked into element data — so every
   *  token scales uniformly. The properties sliders map 50 % … 200 %. */
  tokenTextScale: number
  tokenLabelScale: number

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

  /** Animation frames: which frame `doc.elements` mirrors (0 when no frames). */
  currentFrame: number
  /** True while loop playback drives the doc (all editing suspended). */
  playing: boolean
  /** Playback position in frame units (segment + linear progress, 0‥frames−1);
   *  null when not playing. Drives the AnimationBar's timeline indicator. */
  playhead: number | null

  // Undo/redo: a flat operation stack + a pointer to the last applied operation
  // (VA's model). Everything before/at `pointer` is "done"; everything after is
  // the redo branch, truncated on the next push.
  stack: Operation[]
  pointer: number

  setActiveTool: (tool: ToolId) => void
  toggleKeepTool: () => void
  toggleSnapToObjects: () => void
  /** Toggle / set admin mode (authoring tools visibility). */
  toggleAdminMode: () => void
  setAdminMode: (on: boolean) => void
  /** Set the export-aspect guide frame (or 'off'). */
  setExportGuide: (g: ExportGuide) => void
  /** Set the global token size (metric diameter, metres) and resize EVERY token on
   *  the board to it at once (one undo step). */
  setTokenSizeM: (m: number) => void
  /** Set the global token badge-number / caption-label font multipliers (0.5–2). */
  setTokenTextScale: (n: number) => void
  setTokenLabelScale: (n: number) => void
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
  /** Clear every element from the canvas in one undoable step (keeps background,
   *  field and viewport). */
  resetCanvas: () => void
  /** Remove the given elements by id (one undoable op) — used by the eraser. */
  removeElements: (ids: string[]) => void
  /** Apply a set of element attribute changes as one undoable operation — the
   *  workhorse for move (and later resize / restyle). */
  updateElements: (changes: ElementChange[]) => void
  /** Apply prebuilt operations (rect→polyline conversions + ground anchors) as ONE
   *  undoable step — the pitch-pin setup run when entering Edit-Background. */
  pinSetup: (ops: Operation[]) => void
  /** Merge changes into the document background (not on the undo stack for now). */
  setBackground: (patch: Partial<BoardBackground>) => void
  /** Merge changes into the view transform (2D zoom/pan), clamped so zoom stays
   *  in [1, 8] and the view never leaves the board. Not on the undo stack. */
  setViewport: (patch: Partial<Viewport>) => void
  /** Restore the background to its default (one undoable op). */
  resetBackground: () => void
  /** Clone the selected elements (offset) as one undoable op; select the clones. */
  duplicateSelected: () => void
  /** Clone the selection in place (offset 0), select the clones, and return them
   *  — for ⌥-drag duplication. Tokens get the next team number. */
  duplicateInPlace: () => BoardElement[]
  /** Add several elements at once (one undoable op) and select them — e.g. a whole
   *  game-system formation of tokens. */
  placeElements: (elements: BoardElement[]) => void
  /** Copy the selected elements (clones) to the clipboard. */
  copySelection: () => void
  /** Copy the selection then delete it. */
  cutSelection: () => void
  /** Paste the clipboard as offset clones (new ids), and select them. */
  paste: () => void
  /** Select every element on the board. */
  selectAll: () => void
  /** Lock/unlock the selection: locks all if any is unlocked, else unlocks all. */
  toggleLock: () => void
  /** Move the selected elements by (dx, dy) board units (one undoable op). */
  nudgeSelected: (dx: number, dy: number) => void
  /** Scale the selected elements by a factor about their own centers. */
  resizeSelected: (factor: number) => void
  /** Horizontally mirror the selected figures (toggle their `mirror` flag). */
  flipSelected: () => void
  /** Toggle bold on the selected text elements (⌘B). */
  toggleTextBold: () => void
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

  // ── Animation frames (specs/animation.md). Frame-STRUCTURE ops (enter/switch/
  // add/duplicate/remove) clear the undo stack — an undo could otherwise apply a
  // frame-A edit onto frame B's elements. Element edits inside a frame stay
  // normal undoable ops; doc.elements is the live copy of the current frame.
  /** Ensure frames exist (frame 1 = the current elements) and switch to frame 1. */
  enterAnimation: () => void
  /** Switch the edited frame: store the live elements, load frame k's. */
  setCurrentFrame: (k: number) => void
  /** Append a new frame (a copy of the LAST frame, no camera) and switch to it. */
  addFrame: () => void
  /** Insert an identical copy after frame k and switch to it. */
  duplicateFrame: (k: number) => void
  /** Remove frame k (no-op when it's the only frame). */
  removeFrame: (k: number) => void
  /** Store a playback camera pose on frame k (null = keep the previous frame's).
   *  Doesn't touch elements, so history survives. */
  setFrameCamera: (k: number, pose: FieldView | null) => void
  /** Store frame k's movement path for an element (the spline's intermediate
   *  control points, board coords) or clear it (null / empty). Off-stack. */
  setFramePath: (k: number, elementId: string, points: [number, number][] | null) => void
  /** Update the animation playback settings (speed / camera easing). Off-stack. */
  setAnimationSettings: (patch: Partial<Pick<BoardDoc['animation'], 'speed' | 'cameraEasing' | 'loop'>>) => void
  /** Set (merge) or clear an element's per-TURN movement-effect override for
   *  the transition INTO frame k. Off-stack, like setFramePath. */
  setFrameEffects: (k: number, elementId: string, patch: Partial<import('@youcoach-board/core').FrameEffectOverride> | null) => void
  /** Stamp the selected elements' CURRENT (edited) state into EVERY other
   *  frame — as if the object had just been placed (uniform in the whole
   *  animation, all its per-frame positions, entry paths and per-turn
   *  overrides discarded). Cross-frame rewrite → clears the undo history,
   *  like the frame-structure ops. */
  applyToAllFrames: () => void
  /** Revert the selected elements IN THE CURRENT FRAME to the previous frame's
   *  state — as if this frame had just been created (drops their entry path +
   *  per-turn override into this frame). Skips elements absent in the previous
   *  frame; no-op on frame 1. Clears the undo history. */
  resetFrameChanges: () => void
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

    // Keep the CURRENT animation frame's snapshot mirroring the live elements
    // (O(1): a reference copy — operations produce new arrays, never mutate).
    function syncFrames(doc: BoardDoc): BoardDoc {
      const a = doc.animation
      if (a.frames.length === 0) return doc
      if (a.frames[a.current]?.elements === doc.elements) return doc
      const frames = a.frames.slice()
      frames[a.current] = { ...frames[a.current], elements: doc.elements }
      return { ...doc, animation: { ...a, frames } }
    }

    // Push an operation: apply it, drop any redo branch, advance the pointer.
    // `post` lets a caller fold extra NON-undoable doc rewrites (e.g. other
    // frames' camera reprojection) into the same atomic set.
    // Element presence propagates FORWARD through the animation frames: adding
    // an element on frame k means "it enters the scene here" (copied into every
    // following frame), deleting on frame k means "it leaves here" (removed
    // from k onward). Applied on push AND undo/redo, so undoing an add also
    // clears the propagated copies (no orphans). Property edits stay per-frame.
    function propagatePresence(prevElements: BoardElement[], doc: BoardDoc): BoardDoc {
      const a = doc.animation
      if (a.frames.length < 2 || a.current >= a.frames.length - 1) return doc
      const beforeIds = new Set(prevElements.map((e) => e.id))
      const nowIds = new Set(doc.elements.map(e => e.id))
      const added = doc.elements.filter((e) => !beforeIds.has(e.id))
      const removed = prevElements.filter((e) => !nowIds.has(e.id)).map((e) => e.id)
      if (added.length === 0 && removed.length === 0) return doc
      const removedSet = new Set(removed)
      const frames = a.frames.map((f, i) => {
        if (i <= a.current) return f
        let els = removedSet.size ? f.elements.filter((e) => !removedSet.has(e.id)) : f.elements
        const have = new Set(els.map((e) => e.id))
        const toAdd = added.filter((e) => !have.has(e.id))
        if (toAdd.length) els = [...els, ...toAdd.map((e) => structuredClone(e))]
        return els === f.elements ? f : { ...f, elements: els }
      })
      return { ...doc, animation: { ...a, frames } }
    }

    // OBJECT-level element settings, not per-frame: a change made while editing
    // any frame must reach every frame's copy. Enter/exit effects (the out
    // effect plays from the element's LAST frame, the in effect from its first)
    // the line STYLE — stroke style (solid/dashed/dotted) and the structural
    // line kind (curved/zigzag/double + arrow tips) — a text's On-field (3D)
    // placement, and a 3D arrow's shape identity (completeness + thickness +
    // stick/tip geometry) — part of what the object IS, unlike the
    // interpolable geometry/colors (incl. wave freq/amp and the double-line
    // offset, which the spec lists as animatable) which stay per frame.
    // Mirrored on undo/redo like propagatePresence.
    const OBJECT_KEYS = ['effectIn', 'effectOut', 'fillEffectIn', 'fillEffectOut', 'textEffectIn', 'textEffectOut', 'lengthEffectIn', 'lengthEffectOut', 'effectTail', 'effectTailColor', 'effectPulse', 'effectPulseColor', 'effectEase', 'effectPower', 'effectParabolic', 'strokeStyle', 'curve', 'zigzag', 'double', 'startTip', 'endTip', 'text3d', 'splineLength', 'thickness', 'stickWidth', 'tipWidth', 'tipLength'] as const
    function propagateEffects(prevElements: BoardElement[], doc: BoardDoc): BoardDoc {
      const a = doc.animation
      if (a.frames.length < 2) return doc
      const prevById = new Map(prevElements.map((e) => [e.id, e]))
      const changed: Array<{ id: string; patch: Record<string, unknown> }> = []
      for (const e of doc.elements) {
        const p = prevById.get(e.id)
        if (!p) continue
        // Loose access: some keys exist only on specific element types (text3d).
        const ev = e as unknown as Record<string, unknown>
        const pv = p as unknown as Record<string, unknown>
        const patch: Record<string, unknown> = {}
        for (const k of OBJECT_KEYS) if (ev[k] !== pv[k]) patch[k] = ev[k]
        if (Object.keys(patch).length) changed.push({ id: e.id, patch })
      }
      if (changed.length === 0) return doc
      const frames = a.frames.map((f, i) => {
        if (i === a.current) return f
        let els = f.elements
        let touched = false
        for (const { id, patch } of changed) {
          const idx = els.findIndex((e) => e.id === id)
          if (idx < 0) continue
          if (!touched) {
            els = els.slice()
            touched = true
          }
          els[idx] = { ...els[idx], ...patch } as BoardElement
        }
        return touched ? { ...f, elements: els } : f
      })
      return { ...doc, animation: { ...a, frames } }
    }

    function push(op: Operation, post?: (d: BoardDoc) => BoardDoc) {
      if (get().playing) return // playback owns the doc; no edits land
      const { doc, stack, pointer } = get()
      let nextDoc = applyOperation(doc, op)
      if (post) nextDoc = post(nextDoc)
      nextDoc = propagateEffects(doc.elements, propagatePresence(doc.elements, syncFrames(nextDoc)))
      const nextStack = stack.slice(0, pointer + 1)
      nextStack.push(op)
      set({ doc: nextDoc, stack: nextStack, pointer: pointer + 1 })
      onChange?.(nextDoc)
    }

    // Deep-copy a frame's elements for loading into the live doc (edits must
    // never reach the stored snapshot through shared references).
    const copyElements = (els: BoardElement[]) => els.map((e) => structuredClone(e))

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
      dropReplaceId: null,
      keepToolActive: false,
      snapToObjects: true,
      adminMode: false,
      exportGuide: 'off',
      tokenSizeM: TOKEN_DEFAULT_SIZE_M,
      tokenTextScale: 1,
      tokenLabelScale: 1,
      toolDefaults: { ...DEFAULT_FIGURE_STYLE },
      figureAddedTick: 0,
      styleClipboard: null,
      clipboard: [],
      viewport: { zoom: 1, panX: 0, panY: 0 },
      currentFrame: initialDoc.animation.frames.length > 0 ? initialDoc.animation.current : 0,
      playing: false,
      playhead: null,
      stack: [],
      pointer: -1,

      setActiveTool: (tool) =>
        set((s) => ({
          activeTool: tool,
          // Picking a creation tool clears the current selection (Excalidraw-like).
          selectedIds: isCreationTool(tool) ? [] : s.selectedIds,
          // Tokens are stamped repeatedly, so the token tool auto-enables "keep tool
          // active" (it otherwise reverts to select after one drop). Other tools keep
          // the current setting (the user can still toggle it off).
          keepToolActive: tool === 'token' ? true : s.keepToolActive,
        })),

      toggleKeepTool: () => set((s) => ({ keepToolActive: !s.keepToolActive })),

      toggleSnapToObjects: () => set((s) => ({ snapToObjects: !s.snapToObjects })),

      toggleAdminMode: () => set((s) => ({ adminMode: !s.adminMode })),

      setAdminMode: (on) => set({ adminMode: on }),

      setViewport: (patch) =>
        set((s) => {
          const zoom = Math.max(0.1, Math.min(8, patch.zoom ?? s.viewport.zoom))
          // Zoomed IN (view smaller than the board): keep the view inside the board.
          // Zoomed OUT (view bigger than the board): centre the board in the view.
          const clampPan = (v: number, span: number) => {
            const view = span / zoom
            return view >= span ? (span - view) / 2 : Math.max(0, Math.min(span - view, v))
          }
          return {
            viewport: {
              zoom,
              panX: clampPan(patch.panX ?? s.viewport.panX, BOARD_WIDTH),
              panY: clampPan(patch.panY ?? s.viewport.panY, BOARD_HEIGHT),
            },
          }
        }),

      setExportGuide: (g) => set({ exportGuide: g }),

      setTokenSizeM: (m) => {
        const size = Math.max(1, Math.min(10, m))
        set({ tokenSizeM: size })
        // Resize every token on the pitch to the new global size (one undo step).
        const { doc } = get()
        const f3d = doc.background.field3d
        if (!f3d) return
        const changes = tokenSizeChanges(doc.elements, f3d, size)
        if (changes.length) get().updateElements(changes)
      },

      setTokenTextScale: (n) => set({ tokenTextScale: Math.max(0.5, Math.min(2, n)) }),

      setTokenLabelScale: (n) => set({ tokenLabelScale: Math.max(0.5, Math.min(2, n)) }),

      setToolDefaults: (patch) => set((s) => ({ toolDefaults: { ...s.toolDefaults, ...patch } })),

      setTokenDefaults: (patch) => set((s) => ({ tokenDefaults: { ...s.tokenDefaults, ...patch } })),

      setTextDefaults: (patch) => set((s) => ({ textDefaults: { ...s.textDefaults, ...patch } })),

      rememberMaterialColor: (action, color) =>
        set((s) => (s.materialColors[action] === color ? s : { materialColors: { ...s.materialColors, [action]: color } })),

      rememberFigureScale: (figureId, scale) =>
        set((s) => (s.figureScales[figureId] === scale ? s : { figureScales: { ...s.figureScales, [figureId]: scale } })),

      rememberPlayerColors: (colors) =>
        set((s) => (JSON.stringify(s.playerColors) === JSON.stringify(colors) ? s : { playerColors: colors })),

      setDropReplaceId: (id) => set((s) => (s.dropReplaceId === id ? s : { dropReplaceId: id })),

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
        // On a 3D field, pin a freshly-drawn shape to the pitch so it lives on the
        // surface from birth (rect/oval become a ground-pinned polyline). id is kept.
        const el = doc.background.field3d ? pinNewShape(element, doc.background.field3d) : element
        push({ kind: 'add', element: el, index: doc.elements.length })
        set((s) => ({
          selectedIds: [el.id],
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
          .filter((e) => e.index >= 0 && !doc.elements[e.index].locked) // locked elements are protected from delete
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

      resetCanvas: () => {
        const { doc } = get()
        const a = doc.animation
        if (doc.elements.length === 0 && a.frames.length === 0) return
        if (a.frames.length > 0) {
          // Animation authored: resetting wipes the elements AND the whole
          // frame strip. A frame-STRUCTURE op — clears the history like the
          // other frame ops (an undo could resurrect orphaned frames).
          get().commitTransaction()
          const nextDoc = { ...doc, elements: [], animation: { ...a, animated: false, frames: [], current: 0 } }
          set({ doc: nextDoc, currentFrame: 0, stack: [], pointer: -1, selectedIds: [] })
          onChange?.(nextDoc)
          return
        }
        // Remove every element highest-index-first (so each index stays valid); one
        // transaction, so Undo restores the whole canvas.
        const ops: Operation[] = doc.elements
          .map((element, index) => ({ element, index }))
          .sort((a, b) => b.index - a.index)
          .map(({ element, index }) => ({ kind: 'remove', element, index }))
        push(ops.length === 1 ? ops[0] : { kind: 'transaction', label: 'reset canvas', ops })
        set({ selectedIds: [] })
      },

      removeElements: (ids) => {
        const { doc } = get()
        const idSet = new Set(ids)
        const entries = doc.elements
          .map((el, index) => ({ el, index }))
          .filter(({ el }) => idSet.has(el.id))
          .sort((a, b) => b.index - a.index) // highest index first (see deleteSelected)
        if (entries.length === 0) return
        const ops: Operation[] = entries.map(({ el, index }) => ({ kind: 'remove', element: el, index }))
        push(ops.length === 1 ? ops[0] : { kind: 'transaction', label: 'erase', ops })
        set((s) => ({ selectedIds: s.selectedIds.filter((id) => !idSet.has(id)) }))
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
        if (get().playing) return // playback owns the doc
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

      pinSetup: (ops) => {
        if (ops.length === 0) return
        push(ops.length === 1 ? ops[0] : { kind: 'transaction', label: 'pin', ops })
      },

      setBackground: (patch) => {
        const { doc } = get()
        const next = { ...doc.background, ...patch }
        // When the 3D field camera moves, reproject pitch-pinned figures/tokens so
        // they keep their physical ground spot (and scale with the pitch). See
        // lib/field-anchor + specs/start.md "Elements on the 3D space".
        const before3d = doc.background.field3d
        const after3d = next.field3d
        const camMoved = 'field3d' in patch && !!before3d && !!after3d && JSON.stringify(before3d) !== JSON.stringify(after3d)
        const reproj = camMoved
          // Derive ground anchors on the fly so EVERY pinnable element remaps to the
          // new pose — not only those already pinned via Edit-Background.
          ? reprojectChanges(withGroundAnchors(doc.elements, before3d!), before3d!, after3d!)
          : []
        // Animation frames store 2D coords too: keep every OTHER frame's pinned
        // elements relative to the live camera (the current frame is doc.elements,
        // reprojected via `reproj`). Plain doc rewrite — never on the undo stack.
        const reprojFrames = (d: BoardDoc): BoardDoc => {
          const a = d.animation
          if (!camMoved || a.frames.length < 2) return d
          const frames = a.frames.map((f, i) => {
            // Movement-path anchors are free board points: keep THEIR grass spots
            // too (every frame — the current one's elements reproject elsewhere).
            const paths = f.paths
              ? Object.fromEntries(Object.entries(f.paths).map(([id, pts]) => [id, reprojectBoardPoints(pts, before3d!, after3d!)]))
              : undefined
            if (i === a.current) return paths ? { ...f, paths } : f
            const changes = reprojectChanges(withGroundAnchors(f.elements, before3d!), before3d!, after3d!)
            if (changes.length === 0 && !paths) return f
            return {
              ...f,
              ...(paths ? { paths } : {}),
              elements: changes.length ? applyOperation({ ...d, elements: f.elements }, { kind: 'update', changes }).elements : f.elements,
            }
          })
          return { ...d, animation: { ...a, frames } }
        }
        if (txn) {
          // Capture the pre-transaction background once; apply live (no stack push).
          if (txn.bgBefore === null) txn.bgBefore = doc.background
          let d = reprojFrames({ ...doc, background: next })
          if (reproj.length) {
            d = applyOperation(d, { kind: 'update', changes: reproj })
            // Accumulate like updateElements: keep each field's earliest before /
            // latest after, so the whole session commits as one net move.
            for (const ch of reproj) {
              const prev = txn.changes[ch.id]
              txn.changes[ch.id] = prev
                ? { id: ch.id, before: { ...ch.before, ...prev.before }, after: { ...prev.after, ...ch.after } }
                : { ...ch }
            }
          }
          set({ doc: d })
          return
        }
        // No transaction: keep the background + reprojection atomic (one undo step).
        if (reproj.length) {
          push({ kind: 'transaction', label: 'field', ops: [{ kind: 'background', before: doc.background, after: next }, { kind: 'update', changes: reproj }] }, reprojFrames)
        } else {
          push({ kind: 'background', before: doc.background, after: next }, camMoved ? reprojFrames : undefined)
        }
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

      placeElements: (elements) => {
        if (elements.length === 0) return
        const { doc } = get()
        const ops: Operation[] = elements.map((element, i) => ({ kind: 'add', element, index: doc.elements.length + i }))
        push(ops.length === 1 ? ops[0] : { kind: 'transaction', label: 'formation', ops })
        set({ selectedIds: elements.map((e) => e.id) })
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

      toggleLock: () => {
        const { doc, selectedIds } = get()
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id))
        if (sel.length === 0) return
        const lock = sel.some((e) => !e.locked) // any unlocked → lock all; else unlock all
        const changes = sel.filter((e) => !!e.locked !== lock).map((e) => ({ id: e.id, before: { locked: e.locked }, after: { locked: lock } }))
        if (changes.length) get().updateElements(changes)
      },

      nudgeSelected: (dx, dy) => {
        const { doc, selectedIds } = get()
        const field3d = doc.background.field3d
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id) && !e.locked)
        if (sel.length === 0) return
        const changes: ElementChange[] = []
        for (const e of sel) {
          if (e.type === 'object3d' || e.type === 'arrow3d') {
            // 3D elements live in ground metres (x/z), not the 2D transform — convert
            // the board-unit nudge to a ground delta at the element's spot so arrow
            // keys move them on the pitch, screen-relative like the 2D nudge.
            if (!field3d) continue
            const d = groundNudgeDelta(field3d, e.x, e.z, dx, dy)
            if (!d) continue
            changes.push({ id: e.id, before: { x: e.x, z: e.z }, after: { x: e.x + d.dgx, z: e.z + d.dgz } })
          } else {
            changes.push({ id: e.id, before: { transform: e.transform }, after: { transform: { ...e.transform, x: e.transform.x + dx, y: e.transform.y + dy } } })
          }
        }
        if (changes.length) get().updateElements(changes)
      },

      resizeSelected: (factor) => {
        const { doc, selectedIds } = get()
        const sel = doc.elements.filter((e) => selectedIds.includes(e.id) && !e.locked)
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
        const figs = doc.elements.filter((e) => selectedIds.includes(e.id) && !e.locked && e.type === 'figure') as Extract<BoardElement, { type: 'figure' }>[]
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
            const { width, height } = measureTextBox(t.text, t.fontSize, bold, t.fontFamily, t.italic)
            return {
              id: t.id,
              before: { bold: t.bold, x: t.x, y: t.y, width: t.width, height: t.height },
              after: { bold, x: t.x + (t.width - width) / 2, y: t.y + (t.height - height) / 2, width, height },
            }
          }),
        )
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
            const { width, height } = measureTextBox(el.text, fontSize, bold, el.fontFamily, el.italic)
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
        const nextDoc = propagateEffects(doc.elements, propagatePresence(doc.elements, syncFrames(applyOperation(doc, invertOperation(stack[pointer])))))
        // Keep the selection across undo, but drop ids of elements the undo
        // removed (e.g. undoing a create) — so only delete-like undos clear it.
        set({ doc: nextDoc, pointer: pointer - 1, selectedIds: keepExisting(selectedIds, nextDoc) })
        onChange?.(nextDoc)
      },

      redo: () => {
        const { stack, pointer, doc, selectedIds } = get()
        if (pointer >= stack.length - 1) return
        const nextDoc = propagateEffects(doc.elements, propagatePresence(doc.elements, syncFrames(applyOperation(doc, stack[pointer + 1]))))
        set({ doc: nextDoc, pointer: pointer + 1, selectedIds: keepExisting(selectedIds, nextDoc) })
        onChange?.(nextDoc)
      },

      // ── Animation frames ────────────────────────────────────────────────────

      enterAnimation: () => {
        get().commitTransaction()
        const { doc } = get()
        const a = doc.animation
        if (a.frames.length === 0) {
          const frames: AnimationFrame[] = [{ camera: null, elements: doc.elements }]
          const nextDoc = { ...doc, animation: { ...a, animated: true, frames, current: 0 } }
          set({ doc: nextDoc, currentFrame: 0, stack: [], pointer: -1, selectedIds: [] })
          onChange?.(nextDoc)
        } else {
          get().setCurrentFrame(0)
        }
      },

      setCurrentFrame: (k) => {
        get().commitTransaction()
        const { doc } = get()
        const a = doc.animation
        if (k < 0 || k >= a.frames.length) return
        const frames = a.frames.slice()
        frames[a.current] = { ...frames[a.current], elements: doc.elements }
        const nextDoc = { ...doc, elements: copyElements(frames[k].elements), animation: { ...a, frames, current: k } }
        set({ doc: nextDoc, currentFrame: k, stack: [], pointer: -1, selectedIds: [] })
        onChange?.(nextDoc)
      },

      addFrame: () => {
        get().commitTransaction()
        const { doc } = get()
        const a = doc.animation
        if (a.frames.length === 0) {
          get().enterAnimation()
          return
        }
        const frames = a.frames.slice()
        frames[a.current] = { ...frames[a.current], elements: doc.elements }
        // The new frame continues from the LAST one (usually where the drill goes on).
        frames.push({ camera: null, elements: copyElements(frames[frames.length - 1].elements) })
        const k = frames.length - 1
        const nextDoc = { ...doc, elements: copyElements(frames[k].elements), animation: { ...a, animated: true, frames, current: k } }
        set({ doc: nextDoc, currentFrame: k, stack: [], pointer: -1, selectedIds: [] })
        onChange?.(nextDoc)
      },

      duplicateFrame: (k) => {
        get().commitTransaction()
        const { doc } = get()
        const a = doc.animation
        if (k < 0 || k >= a.frames.length) return
        const frames = a.frames.slice()
        frames[a.current] = { ...frames[a.current], elements: doc.elements }
        const src = frames[k]
        frames.splice(k + 1, 0, {
          camera: src.camera ? { ...src.camera, position: [...src.camera.position] as [number, number, number], target: [...src.camera.target] as [number, number, number] } : null,
          elements: copyElements(src.elements),
        })
        const nextDoc = { ...doc, elements: copyElements(frames[k + 1].elements), animation: { ...a, animated: true, frames, current: k + 1 } }
        set({ doc: nextDoc, currentFrame: k + 1, stack: [], pointer: -1, selectedIds: [] })
        onChange?.(nextDoc)
      },

      removeFrame: (k) => {
        get().commitTransaction()
        const { doc } = get()
        const a = doc.animation
        if (a.frames.length <= 1 || k < 0 || k >= a.frames.length) return
        const frames = a.frames.slice()
        frames[a.current] = { ...frames[a.current], elements: doc.elements }
        frames.splice(k, 1)
        // Land on the frame after the removed one (or the new last); removing a
        // frame before the current one shifts it left by one.
        const cur = a.current === k ? Math.min(k, frames.length - 1) : a.current > k ? a.current - 1 : a.current
        const nextDoc = { ...doc, elements: copyElements(frames[cur].elements), animation: { ...a, frames, current: cur } }
        set({ doc: nextDoc, currentFrame: cur, stack: [], pointer: -1, selectedIds: [] })
        onChange?.(nextDoc)
      },

      setFrameCamera: (k, pose) => {
        const { doc } = get()
        const a = doc.animation
        if (k < 0 || k >= a.frames.length) return
        const frames = a.frames.slice()
        frames[k] = { ...frames[k], camera: pose ? { ...pose, position: [...pose.position] as [number, number, number], target: [...pose.target] as [number, number, number] } : null }
        const nextDoc = { ...doc, animation: { ...a, frames } }
        set({ doc: nextDoc })
        onChange?.(nextDoc)
      },

      setAnimationSettings: (patch) => {
        const { doc } = get()
        const nextDoc = { ...doc, animation: { ...doc.animation, ...patch } }
        set({ doc: nextDoc })
        onChange?.(nextDoc)
      },

      setFrameEffects: (k, elementId, patch) => {
        const { doc } = get()
        const a = doc.animation
        if (k < 0 || k >= a.frames.length) return
        const frames = a.frames.slice()
        const effects = { ...(frames[k].effects ?? {}) }
        if (patch === null) delete effects[elementId]
        else {
          const merged = { ...(effects[elementId] ?? {}), ...patch }
          if (Object.keys(merged).length) effects[elementId] = merged
          else delete effects[elementId]
        }
        frames[k] = { ...frames[k], ...(Object.keys(effects).length ? { effects } : { effects: undefined }) }
        const nextDoc = { ...doc, animation: { ...a, frames } }
        set({ doc: nextDoc })
        onChange?.(nextDoc)
      },

      setFramePath: (k, elementId, points) => {
        const { doc } = get()
        const a = doc.animation
        if (k < 0 || k >= a.frames.length) return
        const frames = a.frames.slice()
        const paths = { ...(frames[k].paths ?? {}) }
        if (points && points.length > 0) paths[elementId] = points.map((p) => [...p] as [number, number])
        else delete paths[elementId]
        frames[k] = { ...frames[k], ...(Object.keys(paths).length ? { paths } : { paths: undefined }) }
        const nextDoc = { ...doc, animation: { ...a, frames } }
        set({ doc: nextDoc })
        onChange?.(nextDoc)
      },

      applyToAllFrames: () => {
        get().commitTransaction()
        const { doc, selectedIds } = get()
        const a = doc.animation
        if (a.frames.length < 2 || selectedIds.length === 0) return
        const ids = new Set(selectedIds)
        const frames = a.frames.slice()
        // Sync the live edits into the current frame, then stamp EVERY other
        // frame (any stray position, whichever frame it was set on, is gone).
        frames[a.current] = { ...frames[a.current], elements: doc.elements }
        const source = new Map(doc.elements.filter((e) => ids.has(e.id)).map((e) => [e.id, e]))
        // Drop the entry path/override of a reset element in a frame's record.
        const strip = <T,>(rec: Record<string, T> | undefined): Record<string, T> | undefined => {
          if (!rec) return undefined
          const kept = Object.fromEntries(Object.entries(rec).filter(([id]) => !ids.has(id)))
          return Object.keys(kept).length ? kept : undefined
        }
        for (let k = 0; k < frames.length; k++) {
          const f = frames[k]
          if (k === a.current) {
            frames[k] = { ...f, paths: strip(f.paths), effects: strip(f.effects) }
            continue
          }
          const present = new Set(f.elements.map((e) => e.id))
          let els = f.elements.map((e) => (source.has(e.id) ? (structuredClone(source.get(e.id)!) as BoardElement) : e))
          const missing = [...source.values()].filter((e) => !present.has(e.id))
          if (missing.length) els = [...els, ...missing.map((e) => structuredClone(e) as BoardElement)]
          frames[k] = { ...f, elements: els, paths: strip(f.paths), effects: strip(f.effects) }
        }
        const nextDoc = { ...doc, animation: { ...a, frames } }
        set({ doc: nextDoc, stack: [], pointer: -1 })
        onChange?.(nextDoc)
      },

      resetFrameChanges: () => {
        get().commitTransaction()
        const { doc, selectedIds } = get()
        const a = doc.animation
        if (a.frames.length < 2 || a.current === 0 || selectedIds.length === 0) return
        const ids = new Set(selectedIds)
        // The inherited state: the element as the PREVIOUS frame has it (a new
        // frame starts as a copy). Elements absent there are left untouched.
        const prev = new Map(a.frames[a.current - 1].elements.filter((e) => ids.has(e.id)).map((e) => [e.id, e]))
        const els = doc.elements.map((e) => (prev.has(e.id) ? (structuredClone(prev.get(e.id)!) as BoardElement) : e))
        const frames = a.frames.slice()
        const f = frames[a.current]
        const strip = <T,>(rec: Record<string, T> | undefined): Record<string, T> | undefined => {
          if (!rec) return undefined
          const kept = Object.fromEntries(Object.entries(rec).filter(([id]) => !ids.has(id)))
          return Object.keys(kept).length ? kept : undefined
        }
        frames[a.current] = { ...f, elements: els, paths: strip(f.paths), effects: strip(f.effects) }
        const nextDoc = { ...doc, elements: els, animation: { ...a, frames } }
        set({ doc: nextDoc, stack: [], pointer: -1 })
        onChange?.(nextDoc)
      },
    }
  })
}

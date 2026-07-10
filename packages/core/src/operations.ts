// Undo/redo as a set of reversible OPERATIONS over the document — modeled on
// YouCoach Video Analysis (see specs/start.md "Undo/Redo stack").
//
// Principles from the spec:
//   - We store the OPERATION DATA needed to undo/redo, never a copy of the model.
//   - The workhorse is `update`: it sets a set of attributes on one OR MORE
//     elements, carrying each element's `before`/`after` patch. Moving, resizing
//     and restyling are all just `update`s.
//   - `add` / `remove` cover element lifecycle; `transaction` groups several
//     operations into one atomic undo/redo step.
//
// Everything is a pure function over the document, framework-free and trivially
// testable; the Zustand editor store drives the stack + pointer.

import type { BoardDoc, BoardBackground } from './model'
import type { ArrowTip, BoardElement, ElementTransform, TextAlign, TokenFill } from './elements'

/** A partial set of attributes to overwrite on an element. `transform` is
 *  replaced wholesale (the patch carries the full transform), so applying is a
 *  plain shallow merge — no deep-merge ambiguity. `id`/`type` are immutable. */
export interface ElementPatch {
  locked?: boolean
  // Enter/exit canned animations (specs/animation.md "Special effects").
  effectIn?: string
  effectOut?: string
  fillEffectIn?: string
  fillEffectOut?: string
  textEffectIn?: string
  textEffectOut?: string
  lengthEffectIn?: string
  lengthEffectOut?: string
  transform?: ElementTransform
  stroke?: string
  strokeWidth?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  fill?: string
  fillStyle?: 'solid' | 'striped'
  // Geometry (for future resize); type-checked loosely since it varies by type.
  x?: number
  y?: number
  // Ground z (metres) for 3D elements (object3d/arrow3d), which live in world
  // coordinates rather than the 2D transform.
  z?: number
  width?: number
  height?: number
  points?: Array<[number, number]>
  // Polyline shape options.
  closed?: boolean
  curve?: boolean
  zigzag?: boolean
  waveLength?: number
  waveAmplitude?: number
  double?: boolean
  linesOffset?: number
  startTip?: ArrowTip
  endTip?: ArrowTip
  // Figure options.
  figureId?: string
  colors?: Record<string, string>
  mirror?: boolean
  // 3D object (object3d) model id — patched when a drop swaps a player's pose.
  objectId?: string
  // 3D object (object3d) size: a relative multiplier + whether to follow the global scale.
  size?: number
  useGlobalSize?: boolean
  // World-ground anchor for pitch-pinned elements: a single [x, z] for standing
  // elements (figure/token = their bottom-center), or one [x, z] per point for a
  // pinned polyline (parallel to `points`, so the shape warps onto the field).
  ground?: [number, number] | Array<[number, number]>
  // Real-world height (metres) for absolute pinned scaling (figure/token).
  sizeM?: number
  // Token options.
  shape?: 'token' | 'jersey'
  tokenFill?: TokenFill
  color1?: string
  color2?: string
  textColor?: string
  text?: string
  label?: string
  showLabel?: boolean
  // Text element options (text?/textColor?/x?/y?/width?/height? reuse fields above).
  bgColor?: string
  fontSize?: number
  align?: TextAlign
  bold?: boolean
  fontFamily?: string
  italic?: boolean
  // 3D text: pinned to the field surface, with a reading orientation (0/90/180/270).
  text3d?: boolean
  orientation?: number
}

/** A single element's change within an `update` operation. */
export interface ElementChange {
  id: string
  before: ElementPatch
  after: ElementPatch
}

export type Operation =
  | { kind: 'add'; element: BoardElement; index: number }
  | { kind: 'remove'; element: BoardElement; index: number }
  | { kind: 'update'; changes: ElementChange[] }
  // Reorder (z-order): the full element order by id, before and after. Stores
  // only ids (no element copies), so it stays cheap and trivially reversible.
  | { kind: 'reorder'; order: string[]; prevOrder: string[] }
  // The document background (field, colors, scale, pan, logo) before/after.
  | { kind: 'background'; before: BoardBackground; after: BoardBackground }
  | { kind: 'transaction'; label: string; ops: Operation[] }

function patched(el: BoardElement, p: ElementPatch): BoardElement {
  return { ...el, ...p } as BoardElement
}

/** Apply an operation, returning a new document (never mutates the input). */
export function applyOperation(doc: BoardDoc, op: Operation): BoardDoc {
  switch (op.kind) {
    case 'add': {
      const elements = doc.elements.slice()
      elements.splice(op.index, 0, op.element)
      return { ...doc, elements }
    }
    case 'remove': {
      const elements = doc.elements.slice()
      elements.splice(op.index, 1)
      return { ...doc, elements }
    }
    case 'update': {
      const after = new Map(op.changes.map((c) => [c.id, c.after]))
      return {
        ...doc,
        elements: doc.elements.map((el) => {
          const p = after.get(el.id)
          return p ? patched(el, p) : el
        }),
      }
    }
    case 'reorder': {
      const byId = new Map(doc.elements.map((e) => [e.id, e]))
      const elements = op.order.map((id) => byId.get(id)).filter((e): e is BoardElement => !!e)
      // Safety: keep any element missing from `order` (shouldn't happen) at the end.
      for (const e of doc.elements) if (!op.order.includes(e.id)) elements.push(e)
      return { ...doc, elements }
    }
    case 'background':
      return { ...doc, background: op.after }
    case 'transaction':
      return op.ops.reduce(applyOperation, doc)
  }
}

/** The inverse operation — applying it undoes `op`. */
export function invertOperation(op: Operation): Operation {
  switch (op.kind) {
    case 'add':
      return { kind: 'remove', element: op.element, index: op.index }
    case 'remove':
      return { kind: 'add', element: op.element, index: op.index }
    case 'update':
      return {
        kind: 'update',
        changes: op.changes.map((c) => ({ id: c.id, before: c.after, after: c.before })),
      }
    case 'reorder':
      return { kind: 'reorder', order: op.prevOrder, prevOrder: op.order }
    case 'background':
      return { kind: 'background', before: op.after, after: op.before }
    case 'transaction':
      // Reverse order AND invert each sub-operation.
      return { kind: 'transaction', label: op.label, ops: [...op.ops].reverse().map(invertOperation) }
  }
}

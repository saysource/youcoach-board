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

import type { BoardDoc } from './model'
import type { ArrowTip, BoardElement, ElementTransform } from './elements'

/** A partial set of attributes to overwrite on an element. `transform` is
 *  replaced wholesale (the patch carries the full transform), so applying is a
 *  plain shallow merge — no deep-merge ambiguity. `id`/`type` are immutable. */
export interface ElementPatch {
  transform?: ElementTransform
  stroke?: string
  strokeWidth?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  fill?: string
  // Geometry (for future resize); type-checked loosely since it varies by type.
  x?: number
  y?: number
  width?: number
  height?: number
  points?: Array<[number, number]>
  // Polyline shape options.
  closed?: boolean
  startTip?: ArrowTip
  endTip?: ArrowTip
  // Figure options.
  figureId?: string
  colors?: Record<string, string>
  mirror?: boolean
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
    case 'transaction':
      // Reverse order AND invert each sub-operation.
      return { kind: 'transaction', label: op.label, ops: [...op.ops].reverse().map(invertOperation) }
  }
}

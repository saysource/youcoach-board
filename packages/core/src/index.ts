// Public surface of @youcoach-board/core.
//
// The "board document" is still trivial (a single title) while the editor's
// real concepts are built up phase by phase. Everything downstream (viewer,
// designer, the App2 embed, the exporter) flows through the same things: the
// BoardDoc type, the parse/serialize pair, the board coordinate system, and the
// one shared SVG render primitive.

export type {
  BoardDoc,
  BoardBackground,
  BoardAnimation,
} from './model'
export {
  EMPTY_BOARD,
  BOARD_VERSION,
  DEFAULT_BACKGROUND,
  DEFAULT_ANIMATION,
  parseBoard,
  serializeBoard,
} from './model'
export { BOARD_WIDTH, BOARD_HEIGHT, BOARD_ASPECT } from './geometry'
export { BoardCanvas } from './BoardCanvas'
export type { BoardCanvasProps } from './BoardCanvas'
export { FieldBackground } from './FieldBackground'
export { ElementView } from './ElementView'
export {
  type BoardElement,
  type RectElement,
  type EllipseElement,
  type LineElement,
  type PolylineElement,
  type ElementType,
  type ElementTransform,
  type StrokeStyle,
  type Box,
  IDENTITY_TRANSFORM,
  getElementBounds,
  getLocalBounds,
  normalizeBox,
  parseElement,
  strokeDash,
} from './elements'
export {
  type Operation,
  type ElementChange,
  type ElementPatch,
  applyOperation,
  invertOperation,
} from './operations'

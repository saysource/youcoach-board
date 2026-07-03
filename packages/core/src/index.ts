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
  LogoPosition,
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
  type PolylineElement,
  type DrawElement,
  type FigureElement,
  type TokenElement,
  type TokenShape,
  type TokenFill,
  type TextElement,
  type TextAlign,
  type Arrow3DElement,
  ARROW3D_DEFAULTS,
  type ElementType,
  type ElementTransform,
  type StrokeStyle,
  type FillStyle,
  type ArrowTip,
  type Box,
  type Cubic,
  IDENTITY_TRANSFORM,
  getElementBounds,
  getLocalBounds,
  normalizeBox,
  parseElement,
  catmullRomCubics,
  cubicPointAt,
  curvedPathD,
  zigzagPathD,
  waveParams,
  doubleLinePaths,
  type DoubleLineGeom,
  WAVE_LENGTH_MIN,
  WAVE_LENGTH_MAX,
  WAVE_AMPLITUDE_MAX,
  DEFAULT_WAVE_LENGTH,
  DEFAULT_WAVE_AMPLITUDE,
  LINES_OFFSET_MIN,
  LINES_OFFSET_MAX,
  DEFAULT_LINES_OFFSET,
  TOKEN_GEOMETRY,
  TOKEN_VIEW,
  TOKEN_STRIPE_PERIOD,
  TOKEN_SINGLE_STRIPE,
  TOKEN_CHECKER_SIZE,
  TOKEN_FONT,
  TOKEN_FONT_WEIGHT,
  TOKEN_LABEL_PX,
  TOKEN_LABEL_GAP_PX,
  TOKEN_LABEL_PLACEHOLDER,
  TEXT_FONT,
  TEXT_FONT_WEIGHT,
  TEXT_FONT_WEIGHT_BOLD,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  TEXT_MIN_FONT,
  TEXT_MAX_FONT,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_BG,
  textBoxRadius,
  strokeDash,
} from './elements'
export {
  type Operation,
  type ElementChange,
  type ElementPatch,
  applyOperation,
  invertOperation,
} from './operations'

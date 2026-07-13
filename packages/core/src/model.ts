// The board document model (v3) + (de)serialization.
//
// Framework-free on purpose: no React, no I/O — pure data so it can run in any
// host (browser, node, a future vanilla viewer). `parseBoard` is defensive
// because input arrives from untrusted JSON (files, network, embeds).
//
// v3 vs the old v2 (see specs/start.md "The OLD model"): same spirit, made
// extensible. The document is explicitly versioned, the board has an intrinsic
// coordinate size, and background + animation are first-class structured
// objects (in v2 they were loose top-level keys). Phase 2 renders only the
// elements; background/animation are defined now so the format is stable, and
// will be wired to rendering in later phases.

import { type BoardElement, parseElement } from './elements'
import { BOARD_WIDTH, BOARD_HEIGHT } from './geometry'

export const BOARD_VERSION = 3

/** Where the YouCoach logo sits over the background (0.2 opacity), or null. */
export type LogoPosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** The mown "shading" bands on the pitch: lengthwise (vertical), across
 *  (horizontal), both (cross — a chequered/plaid mow), or off. */
export type FieldBands = 'vertical' | 'horizontal' | 'cross' | 'none'

/** The kind of playing surface. Each type has its own markings, default goals and
 *  set of camera zones. (Futsal is planned; not yet rendered.) */
export type FieldType = 'soccer11' | 'training' | 'futsal'

/** A training-area variant (its internal lines, shaded region and goals). Selected
 *  by a pose, not toggled directly. `plain` = the bare striped rectangle. */
export type TrainingLayout = 'plain' | 'zones' | 'channel' | 'channel_goals' | 'ends' | 'goals4' | 'band_h'

/** Background configuration: a solid color, an optional raster image, and an
 *  optional field SVG overlay whose declared colors the user can tweak. */
/** A real 3D field: a pitch model rendered by three.js, viewed through a posed
 *  camera (metres; corner-origin world frame, fov in degrees). When set on the
 *  background it takes precedence over `fieldSvg` (the legacy hand-drawn fields). */
export interface FieldView {
  /** Which pitch model (e.g. 'soccer11'); reserved for futsal/area later. */
  ref: string
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

export interface BoardBackground {
  /** The surface colour behind/around the pitch: drives BOTH the flat 2D board
   *  background AND the infinite 3D ground plane (world-space horizon). CSS color;
   *  'transparent' = off (the default field image shows, no 3D surround). Unifies
   *  the former `color` + `surroundColor`. */
  surfaceColor: string
  /** Colour of the 3D field markings (lines) — NOT the mown shading bands. Default
   *  white. */
  lineColor: string
  /** Futsal court: colour of the playing surface itself (the drawing's inner
   *  "background"). The master surfaceColor only drives the infinite surround. */
  courtColor: string
  /** Futsal court: colour of the out-of-bounds BORDER frame around the court (the
   *  band between the court's outer perimeter and the surround). */
  borderColor: string
  /** Futsal court: colour of the filled AREAS (goal areas + centre circle disc). */
  areasColor: string
  /** URL of a raster background image (e.g. grass), or null. */
  image: string | null
  /** URL of an overlay field SVG (e.g. an 11v11 pitch), or null. */
  fieldSvg: string | null
  /** A real 3D field (three.js) + its camera pose. When set, wins over fieldSvg. */
  field3d: FieldView | null
  /** Which playing surface the 3D field renders (markings + goals + zones). */
  fieldType: FieldType
  /** Training area only: which variant (lines + shaded region + goals). Pose-driven
   *  (a zone sets it) — not a standalone toggle. */
  trainingLayout: TrainingLayout
  /** Values for the field SVG's configurable colors, keyed by color slot. */
  fieldColors: Record<string, string>
  /** Scale + translation of the field SVG within the board. */
  scale: number
  position: [number, number]
  /** Default scale applied to figures added while this field is active (each
   *  field declares the figure size that reads well on it — e.g. smaller on a
   *  full pitch than on a half field). 1 = the figure's natural catalog size. */
  figureScale: number
  /** Display scale for placed 3D objects (cones, hurdles, goals, …). The models
   *  are authored at real metric size; this multiplies them so small props stay
   *  visible on a top-down board. 1 = real size, up to 20×. */
  objectScale: number
  /** Whether the two 3D goals at the ends of the pitch are shown. */
  showGoals: boolean
  /** Render disc tokens as real 3D pucks on the pitch (the profiled token disc)
   *  instead of flat SVG badges. Labels/interaction stay 2D. */
  tokens3d: boolean
  /** Whether the 3D field markings (lines) are drawn. */
  showLines: boolean
  /** Opacity (0–1) of the mown shading bands (the mowing pattern) on the 3D pitch. */
  bandsOpacity: number
  /** Central point-light intensity as a fraction of the default (1 = default). The
   *  properties slider spans 0 … 1.25 (0 % … +25 %). */
  centerLight: number
  /** Orientation of the mown shading bands / mowing pattern (or none). */
  bands: FieldBands
  /** YouCoach logo placement over the background, or null for none. */
  logo: LogoPosition | null
}

/** One animation frame: a full snapshot of the elements' state, plus an optional
 *  playback camera pose. `doc.elements` is the LIVE working copy of the current
 *  frame (see BoardAnimation.current); the designer keeps them in sync. */
export interface AnimationFrame {
  /** Camera pose the playback flies to for this frame, or null = keep the
   *  previous frame's (frame 1 null = whatever pose playback starts from). */
  camera: FieldView | null
  elements: BoardElement[]
  /** Movement paths INTO this frame, keyed by element id: intermediate control
   *  points (board coords) of the spline the element's centre travels along
   *  from its previous-frame position. Endpoints are derived from the element
   *  positions, so straight moves need no entry. Meaningless on frame 0. */
  paths?: Record<string, [number, number][]>
  /** Per-TURN movement-effect overrides for the transition INTO this frame,
   *  keyed by element id: any field set here wins over the element's
   *  animation-wide setting for just this move. Meaningless on frame 0. */
  effects?: Record<string, FrameEffectOverride>
}

/** One element's movement-effect override for a single transition. */
export interface FrameEffectOverride {
  tail?: boolean
  tailColor?: string
  pulse?: boolean
  pulseColor?: string
  ease?: boolean
  power?: boolean
  parabolic?: boolean
}

/** Animation settings for the whole drill: an ordered list of frame snapshots.
 *  Transitions between consecutive frames last a fixed 1 s (Phase 1). */
export interface BoardAnimation {
  animated: boolean
  /** Total duration in seconds (legacy field; playback derives (frames−1) × 1 s). */
  duration: number
  /** The frame snapshots; [] = no animation authored. */
  frames: AnimationFrame[]
  /** Which frame `doc.elements` mirrors (the frame being edited). */
  current: number
  /** Playback speed multiplier (1 = the fixed 1 s per transition), 0.25‥2. */
  speed: number
  /** Camera-flight timing during playback: ease-in-out ("Easy Ease", the
   *  default) or linear. */
  cameraEasing: 'linear' | 'ease'
  /** Loop the playback (default). When off, playback stops at the last frame
   *  and repositions on the first. */
  loop: boolean
}

/** The persisted board document. `elements` is in paint order (later draws on
 *  top). */
export interface BoardDoc {
  version: number
  title: string
  /** Intrinsic board coordinate size — the user-space all elements live in. */
  width: number
  height: number
  background: BoardBackground
  elements: BoardElement[]
  animation: BoardAnimation
}

export const DEFAULT_BACKGROUND: BoardBackground = {
  surfaceColor: 'transparent',
  lineColor: '#ffffff',
  // Futsal court defaults, sampled from assets/futsal_field.svg.
  courtColor: '#3b9ccc',
  borderColor: '#ff9f48',
  areasColor: '#277ea0',
  image: null,
  fieldSvg: null,
  field3d: null,
  fieldType: 'soccer11',
  trainingLayout: 'plain',
  fieldColors: {},
  scale: 1,
  position: [0, 0],
  figureScale: 1,
  objectScale: 4, // materials are real-size (a cone is a dot on a full pitch); 4× makes them legible by default
  showGoals: true,
  tokens3d: true, // new boards render disc tokens as 3D pucks (saved docs keep their explicit value)
  showLines: true,
  bandsOpacity: 1,
  centerLight: 1,
  bands: 'vertical',
  logo: 'center',
}

const LOGO_POSITIONS: LogoPosition[] = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
const TRAINING_LAYOUTS: TrainingLayout[] = ['plain', 'zones', 'channel', 'channel_goals', 'ends', 'goals4', 'band_h']

export const DEFAULT_ANIMATION: BoardAnimation = { animated: false, duration: 10, frames: [], current: 0, speed: 1, cameraEasing: 'ease', loop: true }

/** A fresh, empty document. */
export const EMPTY_BOARD: BoardDoc = {
  version: BOARD_VERSION,
  title: '',
  width: BOARD_WIDTH,
  height: BOARD_HEIGHT,
  background: { ...DEFAULT_BACKGROUND },
  elements: [],
  animation: { ...DEFAULT_ANIMATION },
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function vec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null
  const [a, b, c] = v
  if (![a, b, c].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return [a as number, b as number, c as number]
}

function parseFieldView(raw: unknown): FieldView | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const position = vec3(o.position)
  const target = vec3(o.target)
  if (!position || !target) return null
  return { ref: typeof o.ref === 'string' ? o.ref : 'soccer11', position, target, fov: num(o.fov, 50) }
}

function parseBackground(raw: unknown): BoardBackground {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_BACKGROUND }
  const o = raw as Record<string, unknown>
  const pos = Array.isArray(o.position) && o.position.length === 2 ? o.position : DEFAULT_BACKGROUND.position
  return {
    // surfaceColor unifies the former `color` + `surroundColor`; migrate old docs
    // (prefer an explicit surroundColor, then the flat color).
    surfaceColor:
      typeof o.surfaceColor === 'string'
        ? o.surfaceColor
        : typeof o.surroundColor === 'string' && o.surroundColor !== 'transparent'
          ? o.surroundColor
          : typeof o.color === 'string'
            ? o.color
            : DEFAULT_BACKGROUND.surfaceColor,
    lineColor: typeof o.lineColor === 'string' ? o.lineColor : DEFAULT_BACKGROUND.lineColor,
    courtColor: typeof o.courtColor === 'string' ? o.courtColor : DEFAULT_BACKGROUND.courtColor,
    borderColor: typeof o.borderColor === 'string' ? o.borderColor : DEFAULT_BACKGROUND.borderColor,
    areasColor: typeof o.areasColor === 'string' ? o.areasColor : DEFAULT_BACKGROUND.areasColor,
    image: typeof o.image === 'string' ? o.image : null,
    fieldSvg: typeof o.fieldSvg === 'string' ? o.fieldSvg : null,
    field3d: parseFieldView(o.field3d),
    fieldType: o.fieldType === 'training' || o.fieldType === 'futsal' ? o.fieldType : 'soccer11',
    trainingLayout: TRAINING_LAYOUTS.includes(o.trainingLayout as TrainingLayout) ? (o.trainingLayout as TrainingLayout) : 'plain',
    fieldColors:
      typeof o.fieldColors === 'object' && o.fieldColors !== null
        ? (o.fieldColors as Record<string, string>)
        : {},
    scale: num(o.scale, DEFAULT_BACKGROUND.scale),
    position: [num(pos[0], 0), num(pos[1], 0)],
    figureScale: num(o.figureScale, DEFAULT_BACKGROUND.figureScale),
    objectScale: num(o.objectScale, DEFAULT_BACKGROUND.objectScale),
    showGoals: o.showGoals !== false,
    tokens3d: o.tokens3d !== false, // default ON — saved docs always carry the explicit choice
    showLines: o.showLines !== false,
    // bandsOpacity supersedes the former linesOpacity (which faded lines + bands).
    bandsOpacity: Math.min(1, Math.max(0, num(o.bandsOpacity, num(o.linesOpacity, DEFAULT_BACKGROUND.bandsOpacity)))),
    centerLight: Math.min(1.25, Math.max(0, num(o.centerLight, DEFAULT_BACKGROUND.centerLight))),
    bands: o.bands === 'horizontal' || o.bands === 'cross' || o.bands === 'none' ? o.bands : DEFAULT_BACKGROUND.bands,
    // Absent → default (center); explicit null → no logo; valid → that position.
    logo: LOGO_POSITIONS.includes(o.logo as LogoPosition) ? (o.logo as LogoPosition) : o.logo === null ? null : DEFAULT_BACKGROUND.logo,
  }
}

function parseAnimation(raw: unknown): BoardAnimation {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_ANIMATION, frames: [] }
  const o = raw as Record<string, unknown>
  const frames: AnimationFrame[] = Array.isArray(o.frames)
    ? o.frames
        .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
        .map((f) => {
          const frame: AnimationFrame = {
            camera: parseFieldView(f.camera),
            elements: Array.isArray(f.elements) ? f.elements.map(parseElement).filter((e): e is BoardElement => e !== null) : [],
          }
          if (typeof f.paths === 'object' && f.paths !== null) {
            const paths: Record<string, [number, number][]> = {}
            for (const [id, pts] of Object.entries(f.paths as Record<string, unknown>)) {
              if (!Array.isArray(pts)) continue
              const clean = pts
                .filter((p): p is [unknown, unknown] => Array.isArray(p) && p.length === 2)
                .map((p) => [num(p[0], 0), num(p[1], 0)] as [number, number])
              if (clean.length) paths[id] = clean
            }
            if (Object.keys(paths).length) frame.paths = paths
          }
          if (typeof f.effects === 'object' && f.effects !== null) {
            const effects: Record<string, FrameEffectOverride> = {}
            for (const [id, raw2] of Object.entries(f.effects as Record<string, unknown>)) {
              if (typeof raw2 !== 'object' || raw2 === null) continue
              const o2 = raw2 as Record<string, unknown>
              const ov: FrameEffectOverride = {
                ...(typeof o2.tail === 'boolean' ? { tail: o2.tail } : {}),
                ...(typeof o2.tailColor === 'string' ? { tailColor: o2.tailColor } : {}),
                ...(typeof o2.pulse === 'boolean' ? { pulse: o2.pulse } : {}),
                ...(typeof o2.pulseColor === 'string' ? { pulseColor: o2.pulseColor } : {}),
                ...(typeof o2.ease === 'boolean' ? { ease: o2.ease } : {}),
                ...(typeof o2.power === 'boolean' ? { power: o2.power } : {}),
                ...(typeof o2.parabolic === 'boolean' ? { parabolic: o2.parabolic } : {}),
              }
              if (Object.keys(ov).length) effects[id] = ov
            }
            if (Object.keys(effects).length) frame.effects = effects
          }
          return frame
        })
    : []
  const current = Math.min(Math.max(0, Math.trunc(num(o.current, 0))), Math.max(0, frames.length - 1))
  return {
    animated: typeof o.animated === 'boolean' ? o.animated : DEFAULT_ANIMATION.animated,
    duration: num(o.duration, DEFAULT_ANIMATION.duration),
    frames,
    current,
    speed: Math.min(2, Math.max(0.25, num(o.speed, DEFAULT_ANIMATION.speed))),
    cameraEasing: o.cameraEasing === 'linear' ? 'linear' : 'ease',
    loop: o.loop !== false,
  }
}

/**
 * Coerce arbitrary input into a valid {@link BoardDoc}.
 *
 * Accepts a JSON string or an already-parsed value (including a partial doc).
 * Anything missing or malformed degrades gracefully — bad elements are dropped,
 * a bad root yields an empty board — rather than throwing. Unknown / older
 * versions are read on a best-effort basis and normalized to the current
 * version (a full v2 element import is a separate, later migration).
 */
export function parseBoard(input: string | unknown): BoardDoc {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      return structuredCloneBoard(EMPTY_BOARD)
    }
  }
  if (typeof raw !== 'object' || raw === null) return structuredCloneBoard(EMPTY_BOARD)
  const o = raw as Record<string, unknown>
  const elements = Array.isArray(o.elements)
    ? o.elements.map(parseElement).filter((e): e is BoardElement => e !== null)
    : []
  const animation = parseAnimation(o.animation)
  return {
    version: BOARD_VERSION,
    title: typeof o.title === 'string' ? o.title : '',
    width: num(o.width, BOARD_WIDTH),
    height: num(o.height, BOARD_HEIGHT),
    background: parseBackground(o.background),
    // With animation frames, the CURRENT frame's snapshot is authoritative for
    // the live elements (heals docs whose live copy drifted from the frame).
    elements: animation.frames.length > 0 ? animation.frames[animation.current].elements : elements,
    animation,
  }
}

function structuredCloneBoard(doc: BoardDoc): BoardDoc {
  return {
    ...doc,
    background: { ...doc.background, fieldColors: { ...doc.background.fieldColors } },
    animation: {
      ...doc.animation,
      frames: doc.animation.frames.map((f) => ({
        camera: f.camera ? { ...f.camera, position: [...f.camera.position] as [number, number, number], target: [...f.camera.target] as [number, number, number] } : null,
        elements: f.elements.slice(),
        ...(f.paths ? { paths: Object.fromEntries(Object.entries(f.paths).map(([id, pts]) => [id, pts.map((p) => [...p] as [number, number])])) } : {}),
        ...(f.effects ? { effects: Object.fromEntries(Object.entries(f.effects).map(([id, ov]) => [id, { ...ov }])) } : {}),
      })),
    },
    elements: doc.elements.slice(),
  }
}

/** Whether the background is a LEGACY 2D field (an SVG drawn flat on the board,
 *  always facing the camera) rather than a real 3D pitch. Mutually exclusive by
 *  construction: applying a legacy field clears `field3d`, applying a 3D zone
 *  clears `fieldSvg`. 3D-only settings (markings, mowing, lights) don't apply. */
export function isLegacyBackground(bg: BoardBackground): boolean {
  return !!bg.fieldSvg && !bg.field3d
}

/** Serialize a document to pretty-printed JSON (the on-disk / wire form). */
export function serializeBoard(doc: BoardDoc): string {
  return JSON.stringify(
    {
      version: doc.version,
      title: doc.title,
      width: doc.width,
      height: doc.height,
      background: doc.background,
      elements: doc.elements,
      animation: doc.animation,
    },
    null,
    2,
  )
}

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

/** Background configuration: a solid color, an optional raster image, and an
 *  optional field SVG overlay whose declared colors the user can tweak. */
export interface BoardBackground {
  color: string
  /** URL of a raster background image (e.g. grass), or null. */
  image: string | null
  /** URL of an overlay field SVG (e.g. an 11v11 pitch), or null. */
  fieldSvg: string | null
  /** Values for the field SVG's configurable colors, keyed by color slot. */
  fieldColors: Record<string, string>
  /** Scale + translation of the field SVG within the board. */
  scale: number
  position: [number, number]
}

/** Animation settings for the whole drill (keyframes live on each element). */
export interface BoardAnimation {
  animated: boolean
  /** Total duration in seconds. */
  duration: number
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
  color: '#2f8a3e',
  image: null,
  fieldSvg: null,
  fieldColors: {},
  scale: 1,
  position: [0, 0],
}

export const DEFAULT_ANIMATION: BoardAnimation = { animated: false, duration: 10 }

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

function parseBackground(raw: unknown): BoardBackground {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_BACKGROUND }
  const o = raw as Record<string, unknown>
  const pos = Array.isArray(o.position) && o.position.length === 2 ? o.position : DEFAULT_BACKGROUND.position
  return {
    color: typeof o.color === 'string' ? o.color : DEFAULT_BACKGROUND.color,
    image: typeof o.image === 'string' ? o.image : null,
    fieldSvg: typeof o.fieldSvg === 'string' ? o.fieldSvg : null,
    fieldColors:
      typeof o.fieldColors === 'object' && o.fieldColors !== null
        ? (o.fieldColors as Record<string, string>)
        : {},
    scale: num(o.scale, DEFAULT_BACKGROUND.scale),
    position: [num(pos[0], 0), num(pos[1], 0)],
  }
}

function parseAnimation(raw: unknown): BoardAnimation {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_ANIMATION }
  const o = raw as Record<string, unknown>
  return {
    animated: typeof o.animated === 'boolean' ? o.animated : DEFAULT_ANIMATION.animated,
    duration: num(o.duration, DEFAULT_ANIMATION.duration),
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
  return {
    version: BOARD_VERSION,
    title: typeof o.title === 'string' ? o.title : '',
    width: num(o.width, BOARD_WIDTH),
    height: num(o.height, BOARD_HEIGHT),
    background: parseBackground(o.background),
    elements,
    animation: parseAnimation(o.animation),
  }
}

function structuredCloneBoard(doc: BoardDoc): BoardDoc {
  return {
    ...doc,
    background: { ...doc.background, fieldColors: { ...doc.background.fieldColors } },
    animation: { ...doc.animation },
    elements: doc.elements.slice(),
  }
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

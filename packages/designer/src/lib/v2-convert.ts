// Converter for the OLD (version 2) drill format — the jQuery/d3 editor's
// JSON (see assets/old_json_v2_tests for reference files + renders).
//
// v2 world: an 800×600 canvas; per-object keyFrames maps keyed by INTEGER
// SECONDS carrying the full spatial state (x/y/scale/rotate/points/rx/ry) plus
// prop_opacity / prop_fontSize; elements transform as
// `translate(x,y) scale(s) rotate(θ)` — anchored at the ORIGIN (top-left),
// not the centre. v3 world: a 1200×900 board (uniform ×1.5) with centre-based
// transforms and global frame snapshots at 1 s steps — v2's integer-second
// keys map 1:1 onto v3 frames (sparse keys are sampled by interpolation, which
// reproduces the original piecewise-linear motion exactly).
//
// Known approximations (agreed): v2 curves are d3 "basis" B-splines while v3
// draws Catmull-Rom through the points; wave/double parameters and arrow-tip
// sizing are calibrated visually, not derived.

import { measureTextBox } from './draw'
import defaultFieldImage from '../assets/field0.jpg'

const S = 1.5 // 800×600 → 1200×900

// ── v2 shapes (loosely typed — the files are hand-me-downs) ─────────────────
interface V2KeyFrame {
  x?: number
  y?: number
  scale?: number
  rotate?: number
  points?: Array<[number, number]>
  rx?: number
  ry?: number
  prop_opacity?: number
  prop_fontSize?: number | string
  prop_bgOpacity?: number
}

interface V2Element {
  type: string
  x?: number
  y?: number
  scale?: number
  rotate?: number
  opacity?: number
  color?: string
  color2?: string
  bgOpacity?: number
  stroke?: number
  lineStyle?: string
  arrowStyle?: string
  lineInterpolation?: string
  lineType?: string
  waveFrequency?: number
  waveAmplitude?: number
  linesOffset?: number
  points?: Array<[number, number]>
  rx?: number
  ry?: number
  text?: string
  textlabel?: string
  fontSize?: number | string
  svg?: string
  elementType?: string
  width?: number
  height?: number
  skin?: string
  hair?: string
  uniform?: { type?: string; c1?: string | null; c2?: string | null; c3?: string | null; c4?: string | null }
  flip?: boolean
  keyFrames?: Record<string, V2KeyFrame>
}

interface V2Doc {
  version?: number | string
  background?: string
  backgroundSvg?: string
  backgroundColor?: string
  backgroundScale?: number
  backgroundPosition?: [number, number]
  backgroundFigureScale?: number
  logoPosition?: string
  animated?: boolean
  animationDuration?: number
  elements?: V2Element[]
}

/** Whether a parsed JSON value looks like a v2 drill. */
export function isV2Board(raw: unknown): raw is V2Doc {
  return typeof raw === 'object' && raw !== null && Number((raw as { version?: unknown }).version) === 2
}

/** v1 files are v2 minus the `version` property (same 800×600 canvas, same
 *  per-element keyFrames model — figures just carry kit colors as `color`/`color2`
 *  instead of `uniform`), so the v2 converter handles them as-is. Recognized
 *  structurally: no version, an `elements` array, and an old-format tell. */
export function isV1Board(raw: unknown): raw is V2Doc {
  if (typeof raw !== 'object' || raw === null) return false
  const doc = raw as { version?: unknown; elements?: unknown; animationDuration?: unknown; animated?: unknown }
  if (doc.version !== undefined && doc.version !== null) return false
  if (!Array.isArray(doc.elements)) return false
  return (
    typeof doc.animationDuration === 'number' ||
    typeof doc.animated === 'boolean' ||
    doc.elements.some((e) => typeof e === 'object' && e !== null && 'keyFrames' in e)
  )
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d)

/** #rrggbb + alpha (0‥1) → #rrggbbaa (or the color as-is at full alpha). */
function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1 || !/^#[0-9a-fA-F]{6}$/.test(color)) return color
  return `${color}${Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, '0')}`
}

/** The v2 element's state at integer second `t`: base fields overlaid with the
 *  interpolation of the two keyframes bracketing `t` (linear, per property —
 *  what the old editor's tweens did). */
function stateAt(el: V2Element, t: number): V2Element {
  const kf = el.keyFrames ?? {}
  const times = Object.keys(kf).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  if (times.length === 0) return el
  const before = times.filter((k) => k <= t)
  const after = times.filter((k) => k > t)
  // v2 keyframes store the ABSOLUTE svg-space scale (display = natural svg ×
  // kfScale) while the element's own `scale` is the UI multiplier that
  // `width`/`height` pair with — so animation applies the RATIO of the
  // keyframe scale to its first-key value on top of the element scale.
  const kf0scale = num(kf[String(times[0])]?.scale, 1) || 1
  const relScale = (s: number | undefined) => (s === undefined ? undefined : (num(el.scale, 1) * s) / kf0scale)
  const a0 = kf[String(before.length ? before[before.length - 1] : times[0])]
  const a: V2KeyFrame = { ...a0, scale: relScale(a0.scale) }
  if (after.length === 0 || before.length === 0) return { ...el, ...a }
  const bT = after[0]
  const aT = before[before.length - 1]
  const b0 = kf[String(bT)]
  const b: V2KeyFrame = { ...b0, scale: relScale(b0.scale) }
  const f = (t - aT) / (bT - aT || 1)
  if (f <= 0) return { ...el, ...a }
  const lerp = (x?: number, y?: number) => (x === undefined || y === undefined ? (y ?? x) : x + (y - x) * f)
  const merged: V2KeyFrame = { ...a, ...b }
  merged.x = lerp(a.x, b.x)
  merged.y = lerp(a.y, b.y)
  merged.scale = lerp(a.scale, b.scale)
  merged.rotate = lerp(a.rotate, b.rotate)
  merged.rx = lerp(a.rx, b.rx)
  merged.ry = lerp(a.ry, b.ry)
  merged.prop_opacity = lerp(a.prop_opacity, b.prop_opacity)
  merged.prop_fontSize = lerp(num(a.prop_fontSize, NaN), num(b.prop_fontSize, NaN))
  if (a.points && b.points && a.points.length === b.points.length) {
    merged.points = a.points.map((p, i) => [p[0] + (b.points![i][0] - p[0]) * f, p[1] + (b.points![i][1] - p[1]) * f])
  }
  return { ...el, ...merged, fontSize: merged.prop_fontSize ?? el.fontSize, opacity: merged.prop_opacity ?? el.opacity }
}

const IDENTITY = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }

/** One v2 element (at a given state) → a v3 element-shaped plain object, or
 *  null for anything unrecognized (dropped, like parseElement would). */
function convertElement(el: V2Element, id: string): Record<string, unknown> | null {
  const opacity = num(el.opacity, 1)
  const rotate = num(el.rotate, 0)
  const scale = num(el.scale, 1)
  const x = num(el.x)
  const y = num(el.y)
  const base = {
    id,
    transform: { ...IDENTITY, rotate, opacity },
    stroke: el.color ?? '#000000',
    strokeWidth: Math.max(1, num(el.stroke, 2) * S),
    strokeStyle: el.lineStyle === 'dashed' || el.lineStyle === 'dotted' ? el.lineStyle : 'solid',
    fill: 'transparent',
    fillStyle: 'solid',
  }

  if (el.type === 'figure' && el.svg) {
    // v2 wraps the figure svg in translate(-w/2, -h/2): (x, y) is the CENTRE
    // (which also makes v2's origin rotation = v3's centre rotation).
    const w = num(el.width, 40) * scale
    const h = num(el.height, 40) * scale
    const colors: Record<string, string> = {}
    if (el.skin) colors['yc-skin'] = el.skin
    if (el.hair) colors['yc-hair'] = el.hair
    // Kit: the old editor always dressed figures from a uniform, defaulted from
    // color/color2 (the v1 shape) — c1 shirt, c2 shorts, c4 socks, c3 the
    // stripes per `type` ('f' = plain shirt hides them). `yc-color-1/2` are the
    // same nodes' companion classes (and the only hook on materials like cones).
    const u = { type: 'f', c1: el.color ?? null, c2: el.color2 ?? null, c3: el.color2 ?? null, c4: el.color2 ?? null, ...(el.uniform ?? {}) }
    if (u.c1 || u.c2 || el.uniform) {
      if (u.c1) { colors['yc-color-1'] = u.c1; colors['base_tshirt'] = u.c1 }
      if (u.c2) { colors['yc-color-2'] = u.c2; colors['shorts'] = u.c2 }
      if (u.c4) colors['socks'] = u.c4
      colors['v_stripe'] = (u.type === 'v' || u.type === 'q') && u.c3 ? u.c3 : 'none'
      colors['h_stripe'] = (u.type === 'h' || u.type === 'q') && u.c3 ? u.c3 : 'none'
    }
    return {
      ...base,
      type: 'figure',
      figureId: el.svg,
      x: x * S - (w * S) / 2,
      y: y * S - (h * S) / 2,
      width: w * S,
      height: h * S,
      ...(Object.keys(colors).length ? { colors } : {}),
      ...(el.flip ? { mirror: true } : {}),
    }
  }

  if (el.type === 'disc') {
    // Discs are centred on (x, y) like figures.
    const w = num(el.width, 40) * scale
    const h = num(el.height, 40) * scale
    return {
      ...base,
      type: 'token',
      shape: 'token',
      tokenFill: 'solid',
      color1: el.color2 ?? '#369cdb',
      color2: el.color2 ?? '#369cdb',
      textColor: el.color ?? '#ffffff',
      text: el.textlabel ?? '',
      label: '',
      showLabel: false,
      x: x * S - (w * S) / 2,
      y: y * S - (h * S) / 2,
      width: w * S,
      height: h * S,
    }
  }

  if (el.type === 'text') {
    const fontSize = Math.max(6, num(el.fontSize, 24) * S)
    const box = measureTextBox(el.text ?? '', fontSize)
    // v2 anchors the text at its horizontal MIDDLE, (x, y) ≈ centre.
    return {
      ...base,
      type: 'text',
      text: el.text ?? '',
      textColor: el.color ?? '#000000',
      bgColor: el.color2 ? withAlpha(el.color2, num(el.bgOpacity, 0)) : 'transparent',
      fontSize,
      align: 'center',
      bold: false,
      x: x * S - box.width / 2,
      y: y * S - box.height / 2,
      width: box.width,
      height: box.height,
    }
  }

  if (el.type === 'ellipse') {
    const rx = num(el.rx, 20) * scale
    const ry = num(el.ry, 20) * scale
    // v2 ellipses are drawn centred on their translate point.
    return {
      ...base,
      type: 'ellipse',
      fill: el.color2 ? withAlpha(el.color2, num(el.bgOpacity, 0)) : 'transparent',
      x: (x - rx) * S,
      y: (y - ry) * S,
      width: rx * 2 * S,
      height: ry * 2 * S,
    }
  }

  if ((el.type === 'polygon' || el.type === 'line') && Array.isArray(el.points) && el.points.length >= 2) {
    const closed = el.type === 'polygon'
    const points = el.points.map((p) => [ (p[0] + x) * S, (p[1] + y) * S ] as [number, number])
    const arrow = el.arrowStyle ?? 'arrow-none'
    const waves = el.lineType === 'waves'
    const double = el.lineType === 'double'
    return {
      ...base,
      type: 'polyline',
      points,
      closed,
      // v2 draws every line through d3 "basis" (a B-spline): with 2 points
      // that's straight; with more it curves — approximate with the smooth
      // (Catmull-Rom) path.
      curve: !closed && points.length > 2,
      zigzag: waves,
      // waveFrequency = "one wave every N px"; -1 amplitude = auto (v3: 0).
      waveLength: Math.max(10, num(el.waveFrequency, 40) * S),
      waveAmplitude: num(el.waveAmplitude, -1) < 0 ? 0 : Math.max(2, num(el.waveAmplitude, 0) * S * 0.5),
      double,
      linesOffset: Math.max(4, num(el.linesOffset, 30) * S * 0.35),
      startTip: !closed && (arrow === 'arrow-left' || arrow === 'arrow-left-right') ? 'arrow' : 'none',
      endTip: !closed && (arrow === 'arrow-right' || arrow === 'arrow-left-right') ? 'arrow' : 'none',
      fill: closed && el.color2 ? withAlpha(el.color2, num(el.bgOpacity, 0.25)) : 'transparent',
    }
  }

  return null
}

/** Convert a whole v2 document to a v3-shaped plain object (fed to parseBoard,
 *  which stays the single defensive gate). */
export function convertV2Board(raw: V2Doc): Record<string, unknown> {
  const elements = raw.elements ?? []
  const ids = elements.map(() => crypto.randomUUID())

  // The old editor discarded backgroundScale on v1 files (forced to 1 on load).
  const bgScale = isV2Board(raw) ? num(raw.backgroundScale, 1) : 1
  const bgPos = raw.backgroundPosition ?? [0, 0]
  const background = {
    // Every v2 drill sits on the same grass photo — the v3 bundle carries it.
    image: raw.background ? defaultFieldImage : null,
    fieldSvg: raw.backgroundSvg || null,
    surfaceColor: raw.backgroundColor || 'transparent',
    scale: bgScale,
    // v2 scaled the field svg about the canvas TOP-LEFT, v3 about the board
    // centre — same meet-fit otherwise (both canvases are 4:3, ×1.5 apart), so
    // the pan converts with a centre·(scale−1) correction.
    position: [num(bgPos[0]) * S + 600 * (bgScale - 1), num(bgPos[1]) * S + 450 * (bgScale - 1)] as [number, number],
    figureScale: num(raw.backgroundFigureScale, 1),
    logo: raw.logoPosition ?? 'center',
    field3d: null,
  }

  // The animation timeline: v2 keyframes sit on integer seconds; one v3 frame
  // per second from 0 to the LAST key anywhere (trailing idle time from
  // animationDuration is dropped — it only parks the loop).
  const lastKey = Math.max(
    0,
    ...elements.flatMap((el) => Object.keys(el.keyFrames ?? {}).map(Number).filter(Number.isFinite)),
  )
  const animated = raw.animated === true && lastKey >= 1

  const elementsAt = (t: number) =>
    elements
      .map((el, i) => convertElement(stateAt(el, t), ids[i]))
      .filter((e): e is Record<string, unknown> => e !== null)

  if (!animated) {
    return { version: 3, title: '', background, elements: elementsAt(0) }
  }
  const frames = []
  for (let t = 0; t <= lastKey; t++) frames.push({ camera: null, elements: elementsAt(t) })
  return {
    version: 3,
    title: '',
    background,
    elements: frames[0].elements,
    animation: { animated: true, duration: lastKey, frames, current: 0, speed: 1, cameraEasing: 'linear', loop: true },
  }
}

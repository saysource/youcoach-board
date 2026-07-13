// Loop playback of the animation frames (specs/animation.md): each transition
// between consecutive frame snapshots lasts a fixed 1 s (linear); elements are
// matched BY ID and their numeric fields interpolated; elements present in only
// one of the two frames fade in/out; the camera flies to each frame's stored
// pose (frame 1's applies instantly at each loop start).
//
// Playback drives the document directly via store.setState — no operations, no
// onChange — so every layer that subscribes to the doc (SVG elements, WebGL
// objects/arrows/tokens, 3D texts) animates in lockstep and the undo stack is
// untouched. Stopping restores the exact pre-play state (the frame being edited
// and the editing camera). One playback per store (WeakMap), like field-anim.

import { applyOperation, BOARD_HEIGHT, BOARD_WIDTH, type AnimationFrame, type BoardElement, type FieldView } from '@youcoach-board/core'
import type { EditorStore } from '../store/editorStore'
import { lerpPose, cancelFieldAnimation, animateFieldTo } from './field-anim'
import { rectToPolyline, ellipseToPolyline } from './draw'
import * as THREE from 'three'
import { projectGround, reprojectBoardPoints, reprojectChanges, withGroundAnchors } from './field-anchor'
import { makeCalibratedCamera } from './field-camera'
import { boardToGround } from './arrow3d'
import { isObject3DBall, isObject3DPlayer } from './objects3d'
import { clipDuration, clipRootOffset, ensurePlayerAnimLoaded, gkCatchFor, GK_KICK, isGkDeepKick, isGoalkeeper, isScissorPose, isThrowInPose, kickStyleFor, PLAYER_CLIPS, playerIdleClip, SCISSOR_KICK, THROW_IN, type GkCatchMeta, type PlayerClipMeta } from './player-anim'
import { elementCenter, pointAlongPath, type PathPoint } from './movement-path'

const TRANSITION_MS = 1000 // 1 s per frame transition at 1× speed

// Element timing is LINEAR (no easing) — objects move at constant speed
// between frames; per-transition easings come with the later "Transitions"
// phase of the spec. The CAMERA flight optionally eases ("Easy Ease" in the
// animation settings).
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** CSS cubic-bezier(x1, y1, x2, y2) evaluated as ease(progress) — binary
 *  search on the parametric x, then the matching y. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const coord = (a: number, b: number) => (u: number) => 3 * u * (1 - u) * (1 - u) * a + 3 * u * u * (1 - u) * b + u * u * u
  const ax = coord(x1, x2)
  const ay = coord(y1, y2)
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let lo = 0
    let hi = 1
    let u = t
    for (let i = 0; i < 24; i++) {
      const x = ax(u)
      if (Math.abs(x - t) < 1e-4) break
      if (x < t) lo = u
      else hi = u
      u = (lo + hi) / 2
    }
    return ay(u)
  }
}

/** A circle of ground points around (gx, gz) projected to board coords — the
 *  perspective-following sonar ring. */
function groundRing(cam: THREE.Camera, gx: number, gz: number, rM: number, n = 28): PathPoint[] {
  const pts: PathPoint[] = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    pts.push(projectGround(cam, gx + Math.cos(ang) * rM, gz + Math.sin(ang) * rM))
  }
  return pts
}

/** The two expanding pulse rings (half a phase apart) at a ground spot. */
function pulseRingsFor(cam: THREE.Camera, gx: number, gz: number, baseR: number, phase: number): Array<{ points: PathPoint[]; opacity: number }> {
  return [0, 0.5].map((shift) => {
    const ph = (phase + shift) % 1
    return { points: groundRing(cam, gx, gz, baseR * (0.9 + 1.8 * ph)), opacity: (1 - ph) * 0.4 }
  })
}

/** The BALL's Easy-Easing curve: a sharp kick that glides out — like a real
 *  pass (cubic-bezier(0.16, 1, 0.3, 1)). Other elements keep ease-in-out. */
const BALL_EASE = cubicBezier(0.16, 1, 0.3, 1)

/** The element's transition easing: Power Shot (ball, the kick-and-glide
 *  bezier) wins over Easy Easing (ease-in-out, any element); identity when
 *  both are off. */
function easeOf(el: BoardElement): (s: number) => number {
  if (el.effectPower && el.type === 'object3d' && isObject3DBall(el.objectId)) return BALL_EASE
  return el.effectEase ? easeInOutCubic : (s) => s
}

/** Parse a hex CSS color (#rgb / #rgba / #rrggbb / #rrggbbaa) to RGBA channels. */
function parseHexColor(s: string): [number, number, number, number] | null {
  if (!s.startsWith('#')) return null
  const h = s.slice(1)
  if (!/^[0-9a-fA-F]+$/.test(h)) return null
  if (h.length === 3 || h.length === 4) {
    const c = [...h].map((d) => parseInt(d + d, 16))
    return [c[0], c[1], c[2], h.length === 4 ? c[3] : 255]
  }
  if (h.length === 6 || h.length === 8) {
    const c = [0, 2, 4, 6].slice(0, h.length / 2).map((i) => parseInt(h.slice(i, i + 2), 16))
    return [c[0], c[1], c[2], h.length === 8 ? c[3] : 255]
  }
  return null
}

/** Interpolate two hex colors per RGBA channel (alpha emitted only if needed). */
function lerpHexColor(a: string, b: string, t: number): string | null {
  const ca = parseHexColor(a)
  const cb = parseHexColor(b)
  if (!ca || !cb) return null
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t))
  const hex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}${c[3] < 255 ? hex(c[3]) : ''}`
}

/** Generic numeric interpolation: numbers lerp; hex-color strings lerp per
 *  channel; same-length arrays and plain objects recurse; anything else
 *  (other strings, booleans, shape mismatches) snaps at the halfway point.
 *  Covers transform, x/y/z, rotation, points, ground anchors, spline fields,
 *  sizeM, colors, opacity, font size, wave/offset params — without per-type
 *  knowledge. */
function lerpValue(a: unknown, b: unknown, t: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t
  if (typeof a === 'string' && typeof b === 'string' && a !== b) {
    const c = lerpHexColor(a, b, t)
    if (c) return c
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => lerpValue(v, b[i], t))
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: Record<string, unknown> = { ...(b as Record<string, unknown>) }
    for (const k of Object.keys(out)) {
      const av = (a as Record<string, unknown>)[k]
      if (av !== undefined) out[k] = lerpValue(av, out[k], t)
    }
    return out
  }
  return t < 0.5 ? a : b
}

/** An element faded to `f` × its own opacity (enter/leave transitions). The
 *  arrow3d element carries a top-level opacity; object3d has none (it pops);
 *  everything else fades via the transform. */
function faded(el: BoardElement, f: number): BoardElement {
  if (el.type === 'arrow3d') return { ...el, opacity: (el.opacity ?? 1) * f }
  if (el.type === 'object3d') return el
  return { ...el, transform: { ...el.transform, opacity: el.transform.opacity * f } }
}

// ── Enter/exit effects (specs/animation.md "Special effects") ────────────────
// VA-compatible parameters: float translates by 15% of the board, slide by
// 75%; zoom scales from/to ~0, drop/lift from/to 4×; progress is
// ease-out-cubic. EVERY standard effect also ramps opacity (0 → the object's
// opacity entering, back to 0 leaving). 'fade' is the default; 'none' pops at
// the frame boundary.
const FLOAT_DELTA = 0.15
const SLIDE_DELTA = 0.75
const ZOOM_SCALE = 0.01
const DROP_SCALE = 4

// On a 3D field the VERTICAL effects act in world space (metres of height off
// the pitch) instead of screen offsets: drop/lift fall from / rise to
// DROP_H; float/slide up/down travel FLOAT_H / SLIDE_H. Negative heights
// emerge from / sink into the pitch (the "up" enters, "down" exits).
const DROP_H = 15
const FLOAT_H = 6
const SLIDE_H = 25
const VERT_IN: Record<string, number> = { drop: DROP_H, float_down: FLOAT_H, slide_down: SLIDE_H, float_up: -FLOAT_H, slide_up: -SLIDE_H }
const VERT_OUT: Record<string, number> = { lift: DROP_H, float_up: FLOAT_H, slide_up: SLIDE_H, float_down: -FLOAT_H, slide_down: -SLIDE_H }

/** Project a WORLD point (x, y, z — y = height) to board units (w-clamped like
 *  projectGround). */
function projectWorld(cam: THREE.Camera, x: number, y: number, z: number): [number, number] {
  const v = new THREE.Vector4(x, y, z, 1)
  v.applyMatrix4(cam.matrixWorldInverse)
  v.applyMatrix4(cam.projectionMatrix)
  const w = v.w > 1e-4 ? v.w : 1e-4
  return [((v.x / w + 1) * BOARD_WIDTH) / 2, ((1 - v.y / w) * BOARD_HEIGHT) / 2]
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/** Opacity ramp for the PATH effects (line formation / arrow length): the
 *  target opacity is reached at 50% of the transition — enter ramps 0 → target
 *  over the first half, exit ramps target → 0 over the second half. */
const pathOpacity = (p: number, dir: 'in' | 'out') => Math.min(1, Math.max(0, (dir === 'in' ? p : 1 - p) / 0.5))

/** Offset direction an effect ENTERS from (exit mirrors it): the element moves
 *  toward its place along the named direction (float_up rises into place). */
const EFFECT_DIR: Record<string, [number, number]> = {
  float_up: [0, 1], float_down: [0, -1], float_left: [1, 0], float_right: [-1, 0],
  slide_up: [0, 1], slide_down: [0, -1], slide_left: [1, 0], slide_right: [-1, 0],
}

/** Path formation: the visible sub-path between arc-length fractions `from`
 *  and `to` (0‥1). Cut points are interpolated, so an end arrow tip rides the
 *  forming end (and a start tip rides a shrinking start). Trimming happens on
 *  the control points (local coords — the transform applies afterwards);
 *  ground pins are dropped (they must stay parallel to `points`, and the
 *  partial has fewer). */
function trimPath(el: Extract<BoardElement, { type: 'polyline' | 'draw' }>, from: number, to: number): BoardElement {
  const pts = el.points
  if (pts.length < 2 || (from <= 0 && to >= 1)) return el
  const lens: number[] = [0]
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = lens[lens.length - 1] || 1
  const at = (target: number): [number, number] => {
    let i = 1
    while (i < lens.length - 1 && lens[i] < target) i++
    const span = lens[i] - lens[i - 1] || 1
    const f = Math.min(1, Math.max(0, (target - lens[i - 1]) / span))
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]
  }
  const a = Math.max(0, from) * total
  const b = Math.min(1, to) * total
  const out: Array<[number, number]> = [at(a)]
  for (let i = 1; i < pts.length - 1; i++) if (lens[i] > a && lens[i] < b) out.push(pts[i])
  out.push(at(b))
  const partial = { ...el, points: out } as BoardElement & { ground?: unknown }
  delete partial.ground
  return partial
}

/** `count` points spaced at equal arc-length fractions along the point path
 *  (endpoints included) — the common ground for morphing two paths whose
 *  point counts differ. */
function resamplePoints(pts: Array<[number, number]>, count: number): Array<[number, number]> {
  if (pts.length < 2 || count < 2) return pts.slice()
  const lens: number[] = [0]
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = lens[lens.length - 1] || 1
  const out: Array<[number, number]> = []
  let seg = 1
  for (let k = 0; k < count; k++) {
    const target = (k / (count - 1)) * total
    while (seg < pts.length - 1 && lens[seg] < target) seg++
    const span = lens[seg] - lens[seg - 1] || 1
    const f = Math.min(1, Math.max(0, (target - lens[seg - 1]) / span))
    out.push([pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * f, pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * f])
  }
  return out
}

/** Best-guess morph between two point paths with DIFFERENT point counts (same
 *  counts lerp pairwise in lerpValue): both are resampled to the larger count
 *  at equal arc-length fractions, then interpolated pairwise. The output is
 *  transient (playback only), so the extra points never persist. */
function morphPoints(a: Array<[number, number]>, b: Array<[number, number]>, t: number): Array<[number, number]> {
  const count = Math.max(a.length, b.length)
  const ra = resamplePoints(a, count)
  const rb = resamplePoints(b, count)
  return ra.map((p, i) => [p[0] + (rb[i][0] - p[0]) * t, p[1] + (rb[i][1] - p[1]) * t])
}

/** Whether the path (line-forming) effect applies: open point paths only —
 *  closed shapes keep the standard effects (border/fill split comes later). */
function pathFormable(el: BoardElement): el is Extract<BoardElement, { type: 'polyline' | 'draw' }> {
  return el.type === 'draw' || (el.type === 'polyline' && !el.closed)
}

/** A CLOSED shape (rect / ellipse / closed polyline): its border and fill
 *  carry independent enter/exit effects (specs/animation.md "Closed paths"). */
function isClosedShape(el: BoardElement): boolean {
  return el.type === 'rect' || el.type === 'ellipse' || (el.type === 'polyline' && el.closed)
}

/** A closed shape's outline as an OPEN point path (loop reclosed by repeating
 *  the first point), so the border can FORM along itself ('path' effect). */
function openBorderPath(el: BoardElement): Extract<BoardElement, { type: 'polyline' }> | null {
  const poly =
    el.type === 'rect' ? (rectToPolyline(el) as Extract<BoardElement, { type: 'polyline' }>)
    : el.type === 'ellipse' ? (ellipseToPolyline(el) as Extract<BoardElement, { type: 'polyline' }>)
    : el.type === 'polyline' && el.closed ? el
    : null
  if (!poly || poly.points.length < 2) return null
  return { ...poly, closed: false, points: [...poly.points, poly.points[0]], fill: 'transparent' }
}

/** Standard effects translated for a pitch-pinned 3D TEXT: fade via opacity
 *  (the overlay honors it), zoom/drop/lift via fontSize (its on-pitch size),
 *  float/slide by offsetting `ground` — the effect's screen offset is
 *  unprojected onto the grass through the live camera. */
function applyText3DEffect(el: Extract<BoardElement, { type: 'text' }>, p: number, dir: 'in' | 'out', name: string, cam?: THREE.Camera | null): BoardElement {
  const e = easeOutCubic(p)
  const f = dir === 'in' ? e : 1 - e
  const t = el.transform
  const fadedEl = { ...el, transform: { ...t, opacity: t.opacity * f } }
  if (name === 'zoom') {
    const scale = dir === 'in' ? ZOOM_SCALE + (1 - ZOOM_SCALE) * e : 1 - (1 - ZOOM_SCALE) * e
    return { ...fadedEl, fontSize: el.fontSize * scale }
  }
  if (name === 'drop' || name === 'lift') {
    const scale = dir === 'in' ? DROP_SCALE - (DROP_SCALE - 1) * e : 1 + (DROP_SCALE - 1) * e
    return { ...fadedEl, fontSize: el.fontSize * scale }
  }
  const d = EFFECT_DIR[name]
  if (d && cam && el.ground) {
    const delta = name.startsWith('slide') ? SLIDE_DELTA : FLOAT_DELTA
    const k = (dir === 'in' ? 1 - e : e) * delta
    const s = dir === 'in' ? 1 : -1
    const [bx, by] = projectGround(cam, el.ground[0], el.ground[1])
    const g = boardToGround(bx + s * d[0] * BOARD_WIDTH * k, by + s * d[1] * BOARD_HEIGHT * k, cam)
    if (g) return { ...fadedEl, ground: [g.x, g.z] }
  }
  return fadedEl // 'fade' + anything unprojectable
}

/** A ground offset for the float/slide directions: the effect's screen offset
 *  unprojected onto the grass through the live camera; null when it misses. */
function groundOffset(gx: number, gz: number, name: string, e: number, dir: 'in' | 'out', cam?: THREE.Camera | null): { x: number; z: number } | null {
  const d = EFFECT_DIR[name]
  if (!d || !cam) return null
  const delta = name.startsWith('slide') ? SLIDE_DELTA : FLOAT_DELTA
  const k = (dir === 'in' ? 1 - e : e) * delta
  const s = dir === 'in' ? 1 : -1
  const [bx, by] = projectGround(cam, gx, gz)
  return boardToGround(bx + s * d[0] * BOARD_WIDTH * k, by + s * d[1] * BOARD_HEIGHT * k, cam)
}

/** Standard effects translated for a 3D ARROW (top-level opacity, geometry in
 *  metres): fade via opacity, zoom/drop/lift scale its geometry, float/slide
 *  offset its tail on the pitch. Every effect ramps opacity. */
function applyArrow3DEffect(el: Extract<BoardElement, { type: 'arrow3d' }>, p: number, dir: 'in' | 'out', name: string, cam?: THREE.Camera | null): BoardElement {
  const e = easeOutCubic(p)
  const f = dir === 'in' ? e : 1 - e
  const fadedEl = { ...el, opacity: (el.opacity ?? 1) * f }
  if (name === 'zoom' || name === 'drop' || name === 'lift') {
    const s =
      name === 'zoom'
        ? dir === 'in' ? ZOOM_SCALE + (1 - ZOOM_SCALE) * e : 1 - (1 - ZOOM_SCALE) * e
        : dir === 'in' ? DROP_SCALE - (DROP_SCALE - 1) * e : 1 + (DROP_SCALE - 1) * e
    return { ...fadedEl, splineWidth: el.splineWidth * s, splineHeight: el.splineHeight * s, stickWidth: el.stickWidth * s, thickness: el.thickness * s, tipWidth: el.tipWidth * s, tipLength: el.tipLength * s }
  }
  const g = groundOffset(el.x, el.z, name, e, dir, cam)
  if (g) return { ...fadedEl, x: g.x, z: g.z }
  return fadedEl
}

/** Standard effects translated for a 3D OBJECT (player/material): fade via the
 *  transient mesh opacity, zoom/drop/lift via the transient scale multiplier,
 *  float/slide by moving it on the pitch. Every effect ramps opacity. */
function applyObject3DEffect(el: Extract<BoardElement, { type: 'object3d' }>, p: number, dir: 'in' | 'out', name: string, cam?: THREE.Camera | null): BoardElement {
  const e = easeOutCubic(p)
  const f = dir === 'in' ? e : 1 - e
  const fadedEl = { ...el, opacity: (el.opacity ?? 1) * f }
  // Vertical effects lift the MESH itself (world metres) — a player really
  // drops onto the pitch / floats off it.
  const H = dir === 'in' ? VERT_IN[name] : VERT_OUT[name]
  if (H !== undefined) return { ...fadedEl, elevation: H * (dir === 'in' ? 1 - e : e) }
  if (name === 'zoom' || name === 'drop' || name === 'lift') {
    const s =
      name === 'zoom'
        ? dir === 'in' ? ZOOM_SCALE + (1 - ZOOM_SCALE) * e : 1 - (1 - ZOOM_SCALE) * e
        : dir === 'in' ? DROP_SCALE - (DROP_SCALE - 1) * e : 1 + (DROP_SCALE - 1) * e
    return { ...fadedEl, effectScale: (el.effectScale ?? 1) * s }
  }
  const g = groundOffset(el.x, el.z, name, e, dir, cam)
  if (g) return { ...fadedEl, x: g.x, z: g.z }
  return fadedEl
}

/** The ARROW LENGTH pass (its own category, composed on top of the standard
 *  effect so the opacity ramp is opt-in): 'path' forms the arrow by animating
 *  its completeness (splineLength) 0 → the authored value (out: back to 0). */
function applyArrowLengthEffect(el: BoardElement, p: number, dir: 'in' | 'out'): BoardElement {
  if (el.type !== 'arrow3d') return el
  const name = (dir === 'in' ? el.lengthEffectIn : el.lengthEffectOut) ?? 'none'
  if (name !== 'path') return el
  const e = easeOutCubic(p)
  // Formation + the half-transition opacity ramp (0 → target in the first
  // half entering; target → 0 in the second half leaving).
  return { ...el, splineLength: el.splineLength * (dir === 'in' ? e : 1 - e), opacity: (el.opacity ?? 1) * pathOpacity(p, dir) }
}

/** The TEXT effect pass (tracking / typewriter), COMPOSED on top of whatever
 *  standard effect already ran (its own category, like border/fill). p is the
 *  RAW transition progress: typewriter deliberately types at a LINEAR pace;
 *  tracking eases like the standard effects. */
function applyTextEffect(el: BoardElement, p: number, dir: 'in' | 'out'): BoardElement {
  if (el.type !== 'text') return el
  const name = (dir === 'in' ? el.textEffectIn : el.textEffectOut) ?? 'none'
  if (name === 'tracking') {
    // Letters glide together from wide spacing (in) / spread apart (out),
    // fading with it. Spacing scales with the font so it reads at any size.
    const e = easeOutCubic(p)
    const spacing = el.fontSize * 1.2 * (dir === 'in' ? 1 - e : e)
    return { ...el, letterSpacing: spacing, transform: { ...el.transform, opacity: el.transform.opacity * (dir === 'in' ? e : 1 - e) } }
  }
  if (name === 'typewriter') {
    // Characters appear (in) / delete (out) at a constant, LINEAR pace.
    const n = Math.round(el.text.length * (dir === 'in' ? p : 1 - p))
    return { ...el, text: el.text.slice(0, n) }
  }
  return el
}

/** An entering/leaving element as its rendered part(s): closed shapes with a
 *  visible border AND fill split into a fill copy + a border copy, each with
 *  its own effect (e.g. the border forms while the fill fades in). The split
 *  is transient — playback output only; the copies' ids never persist. */
function enterExitParts(el: BoardElement, p: number, dir: 'in' | 'out', cam?: THREE.Camera | null, tokens3d?: boolean): BoardElement[] {
  // Strip pitch pins from entering/leaving 2D elements: reprojection would
  // otherwise reposition (and rescale) them from the STORED pin every step,
  // clobbering the effect's transform — zoom/float/slide read as plain fades
  // under a camera flight. Without the pin the ground anchors derive from the
  // live, effect-modified coords each step, so the element stays glued to the
  // pitch AND animates. 3D texts keep theirs (their effects act on it).
  if (!(el.type === 'text' && el.text3d)) el = stripGround(el)
  if (isClosedShape(el)) {
    const borderFx = (dir === 'in' ? el.effectIn : el.effectOut) ?? 'fade'
    const fillFx = (dir === 'in' ? el.fillEffectIn : el.fillEffectOut) ?? 'fade'
    const hasFill = el.fill !== 'transparent'
    const hasBorder = el.stroke !== 'transparent' && el.strokeWidth > 0
    if (hasFill && hasBorder && (borderFx !== fillFx || borderFx === 'path')) {
      return [
        applyEffect({ ...el, id: `${el.id}__fill`, stroke: 'transparent' } as BoardElement, p, dir, fillFx),
        applyEffect({ ...el, fill: 'transparent' } as BoardElement, p, dir, borderFx),
      ]
    }
    return [applyEffect(el, p, dir, hasBorder ? borderFx : fillFx)]
  }
  if (el.type === 'text') return [applyTextEffect(applyEffect(el, p, dir, undefined, cam), p, dir)]
  if (el.type === 'arrow3d') return [applyArrowLengthEffect(applyEffect(el, p, dir, undefined, cam), p, dir)]
  return [applyEffect(el, p, dir, undefined, cam, tokens3d)]
}

/** Apply an element's enter/exit effect at transition progress p (0‥1).
 *  arrow3d supports fade only; object3d pops (no transform/opacity). */
function applyEffect(el: BoardElement, p: number, dir: 'in' | 'out', nameOverride?: string, cam?: THREE.Camera | null, tokens3d?: boolean): BoardElement {
  const name = nameOverride ?? (dir === 'in' ? el.effectIn : el.effectOut) ?? 'fade'
  if (name === 'none') return el
  // A pitch-pinned 3D text ignores the SVG transform (the overlay renders from
  // ground + fontSize), so its effects act on THOSE fields instead.
  if (el.type === 'text' && el.text3d && el.ground) return applyText3DEffect(el, p, dir, name, cam)
  // 3D arrows and 3D objects live in ground metres, not the SVG transform —
  // their effects translate to opacity / their own geometry / ground offsets.
  if (el.type === 'arrow3d') return applyArrow3DEffect(el, p, dir, name, cam)
  if (el.type === 'object3d') return applyObject3DEffect(el, p, dir, name, cam)
  const e = easeOutCubic(p)
  const f = dir === 'in' ? e : 1 - e // visibility factor
  if (name === 'path') {
    // The line/border FORMS along its own path (in: grows from the start, the
    // end tip riding the forming end) or SHORTENS start → end (out: the tail
    // vanishes first, the tip leaving last). A fully consumed line is hidden
    // via opacity (a zero-length stub would still paint its tip). Closed
    // shapes form/unform their reopened outline loop the same way.
    const target = pathFormable(el) ? el : openBorderPath(el)
    if (target) {
      const remaining = dir === 'in' ? e : 1 - e
      if (remaining <= 0.005) return faded(target, 0)
      // Compose the half-transition opacity ramp with the formation.
      return faded(dir === 'in' ? trimPath(target, 0, e) : trimPath(target, e, 1), pathOpacity(p, dir))
    }
  }
  const t = el.transform
  // TRUE 3D vertical motion on a 3D field: drop/lift and the up/down
  // floats/slides move along the world's vertical axis. Disc tokens lift
  // their mesh (transient elevation); SVG-rendered elements take the
  // PROJECTED screen offset of that height at their spot on the pitch.
  const H = dir === 'in' ? VERT_IN[name] : VERT_OUT[name]
  if (cam && H !== undefined) {
    const h = H * (dir === 'in' ? 1 - e : e)
    if (el.type === 'token' && tokens3d && el.shape === 'token') {
      return { ...el, elevation: h, transform: { ...t, opacity: t.opacity * f } }
    }
    const c = elementCenter(el)
    const g = c ? boardToGround(c[0], c[1], cam) : null
    if (g) {
      const [bx, by] = projectWorld(cam, g.x, h, g.z)
      const [b0x, b0y] = projectWorld(cam, g.x, 0, g.z)
      return { ...el, transform: { ...t, x: t.x + (bx - b0x), y: t.y + (by - b0y), opacity: t.opacity * f } }
    }
  }
  // Tokens rendered as 3D discs size from their metric sizeM — scale it too.
  const scaled = (scale: number): BoardElement =>
    el.type === 'token' && el.sizeM
      ? { ...el, sizeM: el.sizeM * scale, transform: { ...t, scale: t.scale * scale, opacity: t.opacity * f } }
      : { ...el, transform: { ...t, scale: t.scale * scale, opacity: t.opacity * f } }
  if (name === 'zoom') {
    return scaled(dir === 'in' ? ZOOM_SCALE + (1 - ZOOM_SCALE) * e : 1 - (1 - ZOOM_SCALE) * e)
  }
  if (name === 'drop' || name === 'lift') {
    // Drop lands from 4× (in); Lift grows to 4× on the way out.
    return scaled(dir === 'in' ? DROP_SCALE - (DROP_SCALE - 1) * e : 1 + (DROP_SCALE - 1) * e)
  }
  const d = EFFECT_DIR[name]
  if (d) {
    const delta = name.startsWith('slide') ? SLIDE_DELTA : FLOAT_DELTA
    const k = (dir === 'in' ? 1 - e : e) * delta
    const off = [d[0] * BOARD_WIDTH * k, d[1] * BOARD_HEIGHT * k]
    // Exits move AWAY along the same axis they'd enter from.
    const s = dir === 'in' ? 1 : -1
    return { ...el, transform: { ...t, x: t.x + s * off[0], y: t.y + s * off[1], opacity: t.opacity * f } }
  }
  return faded(el, f) // 'fade' + unknown names
}

/** The interpolated element list for transition a→b at time t. Matched ids
 *  interpolate; b-only elements fade in, a-only fade out (appended last so
 *  they keep painting until gone). Output order follows b. An element with a
 *  movement path INTO frame b travels along that spline (arc-length pace)
 *  instead of the straight line — all other properties still interpolate. */
/** An element with its per-TURN movement-effect override (if any) merged over
 *  the animation-wide fields — everything downstream (easing, tail, pulse,
 *  their colors) reads the merged values. */
function withTurnEffects(el: BoardElement, overrides?: AnimationFrame['effects']): BoardElement {
  const ov = overrides?.[el.id]
  if (!ov) return el
  return {
    ...el,
    ...(ov.tail !== undefined ? { effectTail: ov.tail } : {}),
    ...(ov.tailColor !== undefined ? { effectTailColor: ov.tailColor } : {}),
    ...(ov.pulse !== undefined ? { effectPulse: ov.pulse } : {}),
    ...(ov.pulseColor !== undefined ? { effectPulseColor: ov.pulseColor } : {}),
    ...(ov.ease !== undefined ? { effectEase: ov.ease } : {}),
    ...(ov.power !== undefined ? { effectPower: ov.power } : {}),
    ...(ov.parabolic !== undefined ? { effectParabolic: ov.parabolic } : {}),
  } as BoardElement
}

function lerpElements(a: BoardElement[], b: BoardElement[], t: number, paths?: AnimationFrame['paths'], liveCam?: FieldView | null, tokens3d?: boolean, segD = 1, objMult = 1, overrides?: AnimationFrame['effects'], elapsedS = 0, prevSeg?: { elements: BoardElement[]; paths?: AnimationFrame['paths'] }, nextSeg?: { elements: BoardElement[]; paths?: AnimationFrame['paths']; effects?: AnimationFrame['effects'] }): BoardElement[] {
  const byId = new Map(a.map((e) => [e.id, e]))
  // Pitch-pinned 3D texts translate their effects into ground metres — build
  // the (lazy) calibrated camera once per pass.
  let cam3: THREE.Camera | null | undefined
  const cam = () => (cam3 === undefined ? (cam3 = liveCam ? makeCalibratedCamera(liveCam) : null) : cam3)
  // 3D player rules for this transition (ball events, previous gaits).
  const rules = buildPlayerRules(a, b, paths, cam, segD, prevSeg, nextSeg, overrides)
  const out: BoardElement[] = []
  for (const eb of b) {
    const ea = byId.get(eb.id)
    if (ea && ea.type === eb.type) {
      // Pitch pins (`ground`) interpolate only when BOTH sides carry compatible
      // ones. One-sided pins (e.g. the token was dragged/resized — and thereby
      // pinned — in one frame only) are stripped: lerpValue would hold the
      // stored pin constant, and reprojection then PARKS the element at that
      // spot for the whole transition instead of letting its 2D coords travel.
      // An element following a MOVEMENT PATH is stripped too: the path bends
      // its 2D coords, and reprojection must derive the grass spot from those
      // (repositioning from the stored pin would erase the bend).
      const mids = paths?.[eb.id]
      const keepGround = !mids?.length && compatibleGround(ea, eb)
      const [na, nb] = keepGround ? [ea, eb] : [stripGround(ea), stripGround(eb)]
      // Per-element "Easy Easing": this element's OWN transition progress is
      // eased instead of the default linear pace (the ball gets its kick-and-
      // glide curve). Per-turn overrides win for THIS transition.
      const ebm = withTurnEffects(eb, overrides)
      const te = easeOf(ebm)(t)
      let el = lerpValue(na, nb, te) as BoardElement
      // Point paths whose point COUNT changed between the frames (a vertex was
      // added/removed): lerpValue can only snap mismatched arrays, so guess the
      // morph instead — resample both to a common count and interpolate.
      if ((ea.type === 'polyline' || ea.type === 'draw') && ea.type === eb.type && ea.points.length !== eb.points.length && ea.points.length >= 2 && eb.points.length >= 2) {
        el = { ...el, points: morphPoints(ea.points, eb.points, te) } as BoardElement
      }
      if (mids?.length) el = alongPath(ea, eb, el, mids, te)
      if (overrides?.[eb.id]) el = withTurnEffects(el, overrides)
      // 3D objects: follow the movement path on the pitch (the spline is board
      // coords — sample it and drop each point back onto the grass), and the
      // BALL rolls while it travels (2 rotations per second of wall time).
      if (eb.type === 'object3d' && ea.type === 'object3d') el = applyObject3DMove(ea, ebm, el as Extract<BoardElement, { type: 'object3d' }>, mids, te, t, segD, objMult, cam(), elapsedS, rules)
      // Token "between" effects: motion tail and/or sonar pulse while it MOVES.
      // Pinned tokens travel a GROUND-space lerp (reprojection positions them
      // from the lerped pin), so their tail must sample that same trajectory —
      // hence the camera when the pins are kept.
      if (eb.type === 'token' && ea.type === 'token') el = applyBetweenEffect(ea, ebm, el, mids, t, easeOf(ebm), cam(), keepGround)
      out.push(el)
    } else out.push(...enterExitParts(eb, t, 'in', cam(), tokens3d))
  }
  const bIds = new Set(b.map((e) => e.id))
  for (const ea of a) if (!bIds.has(ea.id)) out.push(...enterExitParts(ea, t, 'out', cam(), tokens3d))
  return out
}

type Grounded = BoardElement & { ground?: [number, number] | Array<[number, number]> }

/** Both sides pinned, with matching shapes (per-point pins need equal lengths). */
function compatibleGround(a: BoardElement, b: BoardElement): boolean {
  const ga = (a as Grounded).ground
  const gb = (b as Grounded).ground
  if (!ga || !gb) return false
  return typeof ga[0] === 'number' ? typeof gb[0] === 'number' : Array.isArray(gb[0]) && ga.length === gb.length
}

function stripGround(el: BoardElement): BoardElement {
  if ((el as Grounded).ground === undefined) return el
  const copy = { ...el } as Grounded
  delete copy.ground
  return copy
}

/** Whether two poses are numerically identical (JSON comparison is unreliable —
 *  lerpPose rebuilds objects with a different key order). */
function samePose(a: FieldView, b: FieldView): boolean {
  return a.position.every((v, i) => v === b.position[i]) && a.target.every((v, i) => v === b.target[i]) && a.fov === b.fov
}

/** A moving 3D object: movement-path following (board-space spline dropped
 *  back onto the ground plane) and, for the BALL, a physically-derived rolling
 *  rotation — spin angle = run distance / rendered radius (so a longer pass
 *  spins more, a big ball spins less), rate-capped at 4 rev/s of wall time. */
const BALL_RADIUS_M = 0.11 // the ball GLB's real-size radius
const MAX_ROLL_REV_PER_S = 4

// ── 3D player animation rules (specs/animation.md "3D players") ─────────────
// Per transition, each player's clip is chosen from what happens around it:
// its own ground speed picks the gait, a ball glued to its run means dribbling,
// a ball departing from its feet plays a pass (toward a teammate) or a kick,
// and the ball arriving at a player plays a receive. All thresholds in ground
// metres / m/s.
const IDLE_SPEED = 0.25 // below: standing (idle)
const RUN_SPEED = 3.5 // above: Standard Run instead of Jog Forward
const RATE_MIN = 0.6 // stride-match playback-rate clamp
const RATE_MAX = 1.6
const DRIBBLE_R = 1.8 // ball stays within this of the runner → Dribble
// Player↔ball interaction reach: a strike/receive is assumed ONLY when the
// ball sits within 1 m of the player (ground metres) — the author must place
// the ball at the player's feet to mean an interaction.
const INTERACT_R = 1.0
const KICK_MIN_RUN = 3 // the ball must depart at least this far
const KICK_PRE_S = 0.25 // one-shot starts this long before its ball contact
const GAIT_FADE_S = 0.25 // clip-to-clip cross-fade (jog↔run, into one-shots)
const TURN_MIN_RAD = Math.PI / 4 // sharp corner: direction change ≥ 45° (interior ≤ 135°)
const GAIT_RAMP_S = 0.3 // idle↔locomotion envelope: ramp in from rest / out to rest
const FACE_BLEND = 0.15 // transition fraction blending authored ↔ path tangent

/** How close a ball must land to this player to count as an interaction:
 *  the authored pose's catch reach for goalkeeper CATCH poses, the standard
 *  INTERACT_R for every other player pose (field players, GK deep kicks,
 *  idle keepers …), null for non-players. Used by the drag highlight. */
export function interactionReach(objectId: string): number | null {
  if (!isObject3DPlayer(objectId)) return null
  if (isGoalkeeper(objectId)) return gkCatchFor(objectId)?.reach ?? INTERACT_R
  return INTERACT_R
}

/** Ground position along a straight or spline run at eased time q (spline =
 *  the movement path in board coords, sampled and dropped back onto grass). */
function groundPosAt(a: { x: number; z: number }, b: { x: number; z: number }, mids: PathPoint[] | undefined, cam: THREE.Camera | null | undefined): (q: number) => { x: number; z: number } | null {
  return (q: number) => {
    if (!mids?.length || !cam) return { x: a.x + (b.x - a.x) * q, z: a.z + (b.z - a.z) * q }
    const ca = projectGround(cam, a.x, a.z)
    const cb = projectGround(cam, b.x, b.z)
    const [bx, by] = pointAlongPath([ca, ...mids, cb], q)
    return boardToGround(bx, by, cam)
  }
}

/** Arc length of a run in ground metres (splines sampled at 24 points). */
function groundRun(a: { x: number; z: number }, b: { x: number; z: number }, mids: PathPoint[] | undefined, cam: THREE.Camera | null | undefined): number {
  if (!mids?.length || !cam) return Math.hypot(b.x - a.x, b.z - a.z)
  const posAt = groundPosAt(a, b, mids, cam)
  let run = 0
  let prev = posAt(0)
  for (let k = 1; k <= 24; k++) {
    const cur = posAt(k / 24)
    if (prev && cur) run += Math.hypot(cur.x - prev.x, cur.z - prev.z)
    prev = cur
  }
  return run
}

type Obj3D = Extract<BoardElement, { type: 'object3d' }>

/** What EVERY ball does this transition + each player's PREVIOUS gait (for
 *  the segment-boundary cross-fade). Computed once per tick in lerpElements.
 *  Drills routinely run several balls at once (one per station/pair), so all
 *  interactions are evaluated per ball. */
interface PlayerRules {
  /** Every moving ball's trajectory (for the dribble glue-check). */
  balls: Array<{ posAt: (q: number) => { x: number; z: number } | null; run: number }>
  /** playerId → the strike it performs this transition (pass vs kick; kicks
   *  carry the pose-chosen clip — place kick vs strike-in-stride). */
  kickerOf: Map<string, { pass: boolean; meta: PlayerClipMeta }>
  /** ballId → seconds the KICKED ball waits at its spot before departing
   *  (the strike-in-stride foot meets the ball 13 frames in). */
  kickDelayOf?: Map<string, number>
  /** playerIds a ball ARRIVES at this transition. */
  receiverOf: Set<string>
  /** Lookahead: playerId → the strike it performs in the NEXT transition —
   *  outranks a receive this turn (the arrival tail plays the strike's
   *  wind-up instead of a trap). */
  nextKickerOf: Map<string, { pass: boolean }>
  /** goalkeeperId → its SAVE this transition (a ball lands within the pose's
   *  reach); the catch clip is the keeper's authored pose. */
  saveOf?: Map<string, GkCatchMeta>
  /** ballId → the keeper catching it (the ball's end retargets to his hands). */
  caughtBy?: Map<string, { gk: Obj3D; meta: GkCatchMeta }>
  /** The PREVIOUS transition's saves: the keeper plays the catch follow-through
   *  and then RETURNS to his authored spot; a held ball starts from his hands. */
  prevSaveOf?: Map<string, GkCatchMeta>
  prevCaughtBy?: Map<string, { gk: Obj3D; meta: GkCatchMeta }>
  /** Goalkeeper DEEP KICKS this transition (deep-kick pose + ball departing
   *  from his feet, and the previous turn was NOT his save — then the
   *  outbound ball is just the save's bounce). */
  gkKickOf?: Set<string>
  /** Scissor-pose players whose inbound ball departs again NEXT turn: the
   *  bicycle kick plays with its strike frame landing on the segment end, and
   *  the ball's arrival retargets to the in-air strike point (via caughtBy). */
  scissorOf?: Map<string, GkCatchMeta>
  /** The PREVIOUS transition's scissor kicks: the player finishes the clip
   *  (follow-through) and the struck ball departs from the in-air point (via
   *  prevCaughtBy) — with no second kick animation or departure delay. */
  prevScissorOf?: Map<string, GkCatchMeta>
  prevGait?: Map<string, { clip: string; rate: number; moving: boolean }>
  /** The NEXT transition's speed-based gaits — a player coming to REST next
   *  turn ramps its locomotion out toward idle before the boundary. */
  nextGait?: Map<string, { clip: string; rate: number; moving: boolean }>
  /** Players whose run bends SHARPLY at the coming boundary (both legs real
   *  runs, direction change ≥ 45° — corner angle ≤ 135°, down to a full
   *  reversal): the plant-and-turn clip smooths the brutal corner. The player
   *  runs the FULL leg (compressed to arrive at the destination as the clip
   *  starts), turns AT the corner, and the new leg's run waits for the clip
   *  to end before covering its path in the remaining time. */
  turnOf?: Set<string>
  /** …and at the boundary just passed (the turn's exit plays into this leg). */
  prevTurnOf?: Set<string>
  /** playerId → the clip-start point on the PREVIOUS leg — only used to face
   *  the OLD run direction while the clip finishes on the new leg. */
  turnFreezeOf?: Map<string, { x: number; z: number }>
  /** STATIONARY players whose authored rotation changes ≥ 45° this transition
   *  → the turn clip to play (Left/Right by spin direction): they step around
   *  on the spot instead of pivoting like a statue. */
  turnInPlaceOf?: Map<string, string>
  /** Throw-in-pose players whose ball departs this transition: they THROW it.
   *  The player faces the target while the trimmed clip plays; the ball starts
   *  at the overhead release point and flies a soft parabola to the target,
   *  ignoring its Power Shot / Parabolic effects for this turn. */
  throwOf?: Map<string, { thrower: Obj3D; target: [number, number] }>
  /** ballId → the same throw info (the ball's trajectory override). */
  thrownBall?: Map<string, { thrower: Obj3D; target: [number, number] }>
}

/** Who strikes which ball in the transition a→b, and whether it's a PASS
 *  (lands at a teammate, no Power Shot) or a KICK/shot: per BALL, the player
 *  within reach of its start whom the ball then LEAVES. `effects` = the
 *  transition's per-turn overrides (a move-scoped Power Shot counts). */
function detectStrikes(a: BoardElement[], b: BoardElement[], paths: AnimationFrame['paths'], cam: () => THREE.Camera | null, effects?: AnimationFrame['effects']): Array<{ ballId: string; kickerId: string; kickerObjectId: string; pass: boolean; receiverId?: string }> {
  // Goalkeepers never take part in the field-player rules (their save has its
  // own detection); they can't kick, receive, or be a pass target here.
  const playersB = b.filter((e): e is Obj3D => e.type === 'object3d' && isObject3DPlayer(e.objectId) && !isGoalkeeper(e.objectId))
  const ballsB = b.filter((e): e is Obj3D => e.type === 'object3d' && isObject3DBall(e.objectId))
  if (!playersB.length || !ballsB.length) return []
  const byIdA = new Map(a.map((e) => [e.id, e]))
  const out: Array<{ ballId: string; kickerId: string; kickerObjectId: string; pass: boolean; receiverId?: string }> = []
  for (const ballB of ballsB) {
    const ballA = byIdA.get(ballB.id) as Obj3D | undefined
    if (!ballA || ballA.type !== 'object3d') continue
    const mids = paths?.[ballB.id]
    const run = groundRun(ballA, ballB, mids, mids?.length ? cam() : null)
    if (run < KICK_MIN_RUN) continue
    let best: { id: string; objectId: string; d: number } | null = null
    for (const p of playersB) {
      const pa = byIdA.get(p.id) as Obj3D | undefined
      if (!pa || pa.type !== 'object3d') continue
      const d = Math.hypot(pa.x - ballA.x, pa.z - ballA.z)
      const sep = Math.hypot(p.x - ballB.x, p.z - ballB.z)
      if (d <= INTERACT_R && sep > DRIBBLE_R && (!best || d < best.d)) best = { id: p.id, objectId: p.objectId, d }
    }
    if (!best) continue
    let recv: { id: string; d: number } | null = null
    for (const p of playersB) {
      if (p.id === best.id) continue
      const d = Math.hypot(p.x - ballB.x, p.z - ballB.z)
      if (d <= INTERACT_R && (!recv || d < recv.d)) recv = { id: p.id, d }
    }
    const power = !!(effects?.[ballB.id]?.power ?? ballB.effectPower)
    out.push({ ballId: ballB.id, kickerId: best.id, kickerObjectId: best.objectId, pass: !!recv && !power, receiverId: recv?.id })
  }
  return out
}

/** Goalkeeper saves in the transition a→b: per keeper, a ball whose
 *  destination lands within the authored pose's reach (the keeper's own
 *  reach, not the field INTERACT_R). Returns both directions of the match. */
function detectSaves(aEls: BoardElement[], bEls: BoardElement[], paths: AnimationFrame['paths'], cam: () => THREE.Camera | null): { saves: Map<string, GkCatchMeta>; caught: Map<string, { gk: Obj3D; meta: GkCatchMeta }> } | null {
  const byIdA = new Map(aEls.map((e) => [e.id, e]))
  const saves = new Map<string, GkCatchMeta>()
  const caught = new Map<string, { gk: Obj3D; meta: GkCatchMeta }>()
  for (const gk of bEls) {
    if (gk.type !== 'object3d' || !isGoalkeeper(gk.objectId)) continue
    const meta = gkCatchFor(gk.objectId)
    if (!meta) continue
    for (const ballB of bEls) {
      if (ballB.type !== 'object3d' || !isObject3DBall(ballB.objectId)) continue
      const ballA = byIdA.get(ballB.id) as Obj3D | undefined
      if (!ballA || ballA.type !== 'object3d') continue
      const run = groundRun(ballA, ballB, paths?.[ballB.id], paths?.[ballB.id]?.length ? cam() : null)
      if (run < KICK_MIN_RUN) continue
      if (Math.hypot(gk.x - ballB.x, gk.z - ballB.z) <= meta.reach) {
        saves.set(gk.id, meta)
        if (!caught.has(ballB.id)) caught.set(ballB.id, { gk, meta })
        break
      }
    }
  }
  return saves.size ? { saves, caught } : null
}

/** The speed-based locomotion gait (idle / jog / run) + its stride rate. */
function gaitFor(v: number): { clip: string; rate: number; moving: boolean } {
  if (v < IDLE_SPEED) return { clip: PLAYER_CLIPS.idle.clip, rate: 1, moving: false }
  const meta = v < RUN_SPEED ? PLAYER_CLIPS.jog : PLAYER_CLIPS.run
  return { clip: meta.clip, rate: Math.min(RATE_MAX, Math.max(RATE_MIN, v / (meta.nominalSpeed ?? v))), moving: true }
}

function buildPlayerRules(a: BoardElement[], b: BoardElement[], paths: AnimationFrame['paths'], cam: () => THREE.Camera | null, D: number, prev?: { elements: BoardElement[]; paths?: AnimationFrame['paths'] }, next?: { elements: BoardElement[]; paths?: AnimationFrame['paths']; effects?: AnimationFrame['effects'] }, effects?: AnimationFrame['effects']): PlayerRules | undefined {
  const playersB = b.filter((e): e is Obj3D => e.type === 'object3d' && isObject3DPlayer(e.objectId))
  if (playersB.length === 0) return undefined
  const byIdA = new Map(a.map((e) => [e.id, e]))
  const rules: PlayerRules = { balls: [], kickerOf: new Map(), receiverOf: new Set(), nextKickerOf: new Map() }
  for (const ballB of b) {
    if (ballB.type !== 'object3d' || !isObject3DBall(ballB.objectId)) continue
    const ballA = byIdA.get(ballB.id) as Obj3D | undefined
    if (!ballA || ballA.type !== 'object3d') continue
    const mids = paths?.[ballB.id]
    const c = mids?.length ? cam() : null
    rules.balls.push({ posAt: groundPosAt(ballA, ballB, mids, c), run: groundRun(ballA, ballB, mids, c) })
  }
  // Whether `ballId` ARRIVES at the player over the transition x→y: a real run
  // that ends within the standard interaction radius of the player's spot.
  const ballArrives = (x: BoardElement[], y: BoardElement[], xyPaths: AnimationFrame['paths'], ballId: string, py: Obj3D): boolean => {
    const ballY = y.find((e) => e.id === ballId) as Obj3D | undefined
    const ballX = x.find((e) => e.id === ballId) as Obj3D | undefined
    if (!ballX || !ballY || ballX.type !== 'object3d' || ballY.type !== 'object3d') return false
    const run = groundRun(ballX, ballY, xyPaths?.[ballId], xyPaths?.[ballId]?.length ? cam() : null)
    return run >= KICK_MIN_RUN && Math.hypot(py.x - ballY.x, py.z - ballY.z) <= (SCISSOR_KICK.reach ?? INTERACT_R)
  }
  const thisStrikes = detectStrikes(a, b, paths, cam, effects)
  for (const s of thisStrikes) {
    // A throw-in-pose player THROWS the departing ball (no kick, no delay).
    if (isThrowInPose(s.kickerObjectId)) {
      const thrower = a.find((e) => e.id === s.kickerId) as Obj3D | undefined
      const ballB = b.find((e) => e.id === s.ballId) as Obj3D | undefined
      if (thrower?.type === 'object3d' && ballB?.type === 'object3d') {
        const info = { thrower, target: [ballB.x, ballB.z] as [number, number] }
        ;(rules.throwOf = rules.throwOf ?? new Map()).set(s.kickerId, info)
        ;(rules.thrownBall = rules.thrownBall ?? new Map()).set(s.ballId, info)
        if (s.receiverId) rules.receiverOf.add(s.receiverId)
        continue
      }
    }
    const style = kickStyleFor(s.kickerObjectId)
    rules.kickerOf.set(s.kickerId, { pass: s.pass, meta: style.meta })
    // A KICKED ball waits at the kicker's feet until the clip's foot-contact
    // moment (passes keep the classic instant departure).
    if (!s.pass && style.ballDelay > 0) (rules.kickDelayOf = rules.kickDelayOf ?? new Map()).set(s.ballId, style.ballDelay)
    if (s.receiverId) rules.receiverOf.add(s.receiverId)
  }
  // Lookahead: a ball leaving a player again in the NEXT transition outranks
  // a receive this turn — and a SHOT next turn (kick, not pass) plays its
  // strike anticipation in THIS turn's tail (see playerAnimFor).
  if (next) {
    for (const s of detectStrikes(b, next.elements, next.paths, cam, next.effects)) {
      rules.nextKickerOf.set(s.kickerId, { pass: s.pass })
      // SCISSOR KICK (this turn): the pose's inbound ball departs again next
      // turn — play the bicycle kick with its strike frame at the boundary,
      // and retarget the ball's arrival to the in-air strike point.
      const p = b.find((e) => e.id === s.kickerId) as Obj3D | undefined
      if (p?.type === 'object3d' && isScissorPose(p.objectId) && ballArrives(a, b, paths, s.ballId, p)) {
        ;(rules.scissorOf = rules.scissorOf ?? new Map()).set(p.id, SCISSOR_KICK)
        rules.caughtBy = rules.caughtBy ?? new Map()
        if (!rules.caughtBy.has(s.ballId)) rules.caughtBy.set(s.ballId, { gk: p, meta: SCISSOR_KICK })
      }
    }
  }
  // SCISSOR KICK (the turn after): the strike happened ON the boundary — the
  // struck ball flies out FROM the in-air point while the player finishes the
  // clip. His departure is the scissor itself: drop the regular kick (and the
  // kicked-ball departure delay) detected for this transition.
  if (prev) {
    for (const s of thisStrikes) {
      const p = b.find((e) => e.id === s.kickerId) as Obj3D | undefined
      const pA = a.find((e) => e.id === s.kickerId) as Obj3D | undefined
      if (!p || p.type !== 'object3d' || !isScissorPose(p.objectId) || !pA || pA.type !== 'object3d') continue
      if (!ballArrives(prev.elements, a, prev.paths, s.ballId, pA)) continue
      ;(rules.prevScissorOf = rules.prevScissorOf ?? new Map()).set(p.id, SCISSOR_KICK)
      rules.prevCaughtBy = rules.prevCaughtBy ?? new Map()
      if (!rules.prevCaughtBy.has(s.ballId)) rules.prevCaughtBy.set(s.ballId, { gk: pA, meta: SCISSOR_KICK })
      rules.kickerOf.delete(s.kickerId)
      rules.kickDelayOf?.delete(s.ballId)
    }
  }
  // Goalkeeper SAVES this transition, and the PREVIOUS transition's (the
  // keeper then finishes the catch and returns to his spot; a held ball
  // starts from his hands).
  const sv = detectSaves(a, b, paths, cam)
  if (sv) {
    rules.saveOf = sv.saves
    // Merge (a scissor retarget may already claim a ball — first wins).
    rules.caughtBy = rules.caughtBy ?? new Map()
    for (const [k, v] of sv.caught) if (!rules.caughtBy.has(k)) rules.caughtBy.set(k, v)
  }
  if (prev) {
    const pv = detectSaves(prev.elements, a, prev.paths, cam)
    if (pv) {
      rules.prevSaveOf = pv.saves
      rules.prevCaughtBy = rules.prevCaughtBy ?? new Map()
      for (const [k, v] of pv.caught) if (!rules.prevCaughtBy.has(k)) rules.prevCaughtBy.set(k, v)
    }
  }
  // Goalkeeper DEEP KICK: a deep-kick-pose keeper with a ball departing from
  // his feet (the standard interaction radius) KICKS it — unless the previous
  // turn was HIS save (then the outbound ball is just the save's bounce and
  // the keeper plays his follow-through/return instead).
  for (const gk of playersB) {
    if (!isGkDeepKick(gk.objectId) || rules.prevSaveOf?.has(gk.id)) continue
    const gkA = byIdA.get(gk.id) as Obj3D | undefined
    if (!gkA || gkA.type !== 'object3d') continue
    for (const ballB of b) {
      if (ballB.type !== 'object3d' || !isObject3DBall(ballB.objectId)) continue
      const ballA = byIdA.get(ballB.id) as Obj3D | undefined
      if (!ballA || ballA.type !== 'object3d') continue
      const run = groundRun(ballA, ballB, paths?.[ballB.id], paths?.[ballB.id]?.length ? cam() : null)
      if (run < KICK_MIN_RUN) continue
      const d0 = Math.hypot(gkA.x - ballA.x, gkA.z - ballA.z)
      const sep = Math.hypot(gk.x - ballB.x, gk.z - ballB.z)
      if (d0 <= INTERACT_R && sep > DRIBBLE_R) {
        rules.gkKickOf = rules.gkKickOf ?? new Set()
        rules.gkKickOf.add(gk.id)
        break
      }
    }
  }
  // A SHARP path corner between two real runs (direction change ≥ 45° — the
  // corner's interior angle ≤ 135°, all the way down to a full reversal).
  const sharpTurn = (v1x: number, v1z: number, v2x: number, v2z: number): boolean => {
    const l1 = Math.hypot(v1x, v1z)
    const l2 = Math.hypot(v2x, v2z)
    if (l1 / D < IDLE_SPEED || l2 / D < IDLE_SPEED) return false
    return (v1x * v2x + v1z * v2z) / (l1 * l2) <= Math.cos(TURN_MIN_RAD)
  }
  // A player already claimed by an interaction one-shot never turn-plants.
  const busy = (id: string): boolean =>
    rules.kickerOf.has(id) || !!rules.saveOf?.has(id) || !!rules.prevSaveOf?.has(id) || !!rules.scissorOf?.has(id) || !!rules.prevScissorOf?.has(id) || !!rules.gkKickOf?.has(id)
  // Neighbour segments' gaits (straight-line speeds are enough for fades /
  // the idle↔locomotion envelope) + the sharp-turn boundaries around this leg.
  if (prev) {
    const prevById = new Map(prev.elements.map((e) => [e.id, e]))
    const gaits = new Map<string, { clip: string; rate: number; moving: boolean }>()
    for (const p of playersB) {
      const p1 = byIdA.get(p.id) as Obj3D | undefined // player at the shared frame
      const p0 = prevById.get(p.id) as Obj3D | undefined
      if (!p0 || !p1 || p0.type !== 'object3d' || p1.type !== 'object3d') continue
      const g = gaitFor(Math.hypot(p1.x - p0.x, p1.z - p0.z) / D)
      gaits.set(p.id, { clip: g.clip, rate: g.rate, moving: g.moving })
      if (!isGoalkeeper(p.objectId) && !busy(p.id) && sharpTurn(p1.x - p0.x, p1.z - p0.z, p.x - p1.x, p.z - p1.z)) {
        ;(rules.prevTurnOf = rules.prevTurnOf ?? new Set()).add(p.id)
        // Where the turn froze him: the clip-start point on the previous leg.
        const fq = Math.max(0, (D - (PLAYER_CLIPS.changeDir.contactTime ?? 0.833)) / D)
        const mids = prev.paths?.[p.id]
        const fp = groundPosAt(p0, p1, mids, mids?.length ? cam() : null)(fq)
        if (fp) (rules.turnFreezeOf = rules.turnFreezeOf ?? new Map()).set(p.id, fp)
      }
    }
    rules.prevGait = gaits
  }
  if (next) {
    const nextById = new Map(next.elements.map((e) => [e.id, e]))
    const gaits = new Map<string, { clip: string; rate: number; moving: boolean }>()
    for (const p of playersB) {
      const p2 = nextById.get(p.id) as Obj3D | undefined
      if (!p2 || p2.type !== 'object3d') continue
      const g = gaitFor(Math.hypot(p2.x - p.x, p2.z - p.z) / D)
      gaits.set(p.id, { clip: g.clip, rate: g.rate, moving: g.moving })
      const pA = byIdA.get(p.id) as Obj3D | undefined
      if (pA?.type === 'object3d' && !isGoalkeeper(p.objectId) && !busy(p.id) && sharpTurn(p.x - pA.x, p.z - pA.z, p2.x - p.x, p2.z - p.z)) (rules.turnOf = rules.turnOf ?? new Set()).add(p.id)
    }
    rules.nextGait = gaits
  }
  // CONSECUTIVE turns (zig-zag): a leg that both exits one turn and enters the
  // next can't honor both clips (their windows overlap on a 1 s leg) — the
  // coming plant wins, the previous turn's exit is dropped so the anim, the
  // facing and the travel all agree (a stale exit hold would show the player
  // running at the OLD direction).
  if (rules.turnOf && rules.prevTurnOf) {
    for (const id of rules.turnOf) {
      rules.prevTurnOf.delete(id)
      rules.turnFreezeOf?.delete(id)
    }
  }
  // TURN IN PLACE: a stationary player whose authored rotation spins ≥ 45°
  // steps around with the Left/Right Turn clip (by spin direction).
  for (const p of playersB) {
    if (isGoalkeeper(p.objectId) || busy(p.id)) continue
    const pA = byIdA.get(p.id) as Obj3D | undefined
    if (!pA || pA.type !== 'object3d') continue
    if (Math.hypot(p.x - pA.x, p.z - pA.z) / D >= IDLE_SPEED) continue
    let d = (p.rotation - pA.rotation) % (2 * Math.PI)
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    if (Math.abs(d) < TURN_MIN_RAD) continue
    // facing = (sin r, cos r): INCREASING rotation turns the player to his RIGHT
    ;(rules.turnInPlaceOf = rules.turnInPlaceOf ?? new Map()).set(p.id, (d > 0 ? PLAYER_CLIPS.rightTurn : PLAYER_CLIPS.leftTurn).clip)
  }
  return rules
}

/** Shortest-arc angle interpolation (radians). */
function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return a + d * t
}

/** The player's transient pose for this tick: clip + time from the rules
 *  (gait by speed, dribble when the ball travels with the run, pass/kick when
 *  the ball departs from its feet, receive when it arrives), plus facing along
 *  the path tangent while moving. */
function playerAnimFor(a: Obj3D, b: Obj3D, el: Obj3D, posAt: (q: number) => { x: number; z: number } | null, te: number, t: number, D: number, elapsedS: number, rules?: PlayerRules, objMult = 1): Obj3D {
  const run = groundRun(a, b, undefined, null) // straight part; splines below
  const idleClip = playerIdleClip(b.objectId)
  // Facing: while moving, look along the instantaneous tangent; blend from the
  // frame-a authored rotation at the start and back to frame-b's at the end.
  let moved = run
  if (posAt) {
    // Sharp-turn window: the Change Direction clip performs the VISIBLE turn
    // (~150° of authored body rotation) — hold the OLD leg's direction while
    // it plays, and come out already facing the new one (no re-turn after).
    const turnContact = PLAYER_CLIPS.changeDir.contactTime ?? 0.833
    const turningOut = !!rules?.turnOf?.has(b.id)
    const afterTurn = !!rules?.prevTurnOf?.has(b.id)
    const fp = afterTurn ? rules?.turnFreezeOf?.get(b.id) : undefined
    const exitT = Math.min(1, (clipDuration(PLAYER_CLIPS.changeDir.clip) - turnContact) / D)
    const turningIn = afterTurn && t < exitT
    // Turn players sample the tangent at their REMAPPED travel (compressed
    // outgoing leg / corner-hold then delayed new leg).
    let qs = te
    if (turningOut) qs = easeOf(b)(Math.min(1, t / Math.max(1e-3, (D - turnContact) / D)))
    else if (afterTurn) qs = easeOf(b)(Math.min(1, Math.max(0, (t - exitT) / Math.max(0.1, 1 - exitT))))
    const g0 = posAt(Math.max(0, qs - 0.02))
    const g1 = posAt(Math.min(1, qs + 0.02))
    if (turningIn && fp) {
      // The clip is still playing on the new leg: keep the OLD direction (the
      // freeze point → corner), the clip's own rotation does the turning.
      el = { ...el, rotation: Math.atan2(a.x - fp.x, a.z - fp.z) }
    } else if (g0 && g1) {
      const dx = g1.x - g0.x
      const dz = g1.z - g0.z
      if (Math.hypot(dx, dz) > 1e-4 && moved > 0.3) {
        const tangent = Math.atan2(dx, dz)
        const rot = turningOut || afterTurn
          ? tangent // through/after the clip: the leg direction, no boundary blends
          : t < FACE_BLEND ? angleLerp(a.rotation, tangent, t / FACE_BLEND) : t > 1 - FACE_BLEND ? angleLerp(tangent, b.rotation, (t - (1 - FACE_BLEND)) / FACE_BLEND) : tangent
        el = { ...el, rotation: rot }
      }
    }
  }
  // Speed from the true arc when following a spline.
  if (rules && posAt) {
    let arc = 0
    let prev = posAt(0)
    for (let k = 1; k <= 12; k++) {
      const cur = posAt(k / 12)
      if (prev && cur) arc += Math.hypot(cur.x - prev.x, cur.z - prev.z)
      prev = cur
    }
    moved = arc
  }
  const v = moved / D
  let gait = gaitFor(v)
  // Dribble: ANY ball travels WITH the run (stays within reach at every sample).
  if (rules && gait.moving && posAt && !isGoalkeeper(b.objectId)) {
    const dribbling = rules.balls.some((ball) => {
      if (ball.run < 1) return false
      for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const pp = posAt(q)
        const bp = ball.posAt(q)
        if (!pp || !bp || Math.hypot(pp.x - bp.x, pp.z - bp.z) > DRIBBLE_R) return false
      }
      return true
    })
    if (dribbling) gait = { clip: PLAYER_CLIPS.dribble.clip, rate: Math.min(RATE_MAX, Math.max(RATE_MIN, v / (PLAYER_CLIPS.dribble.nominalSpeed ?? v))), moving: true }
  }
  const gaitClip = gait.moving ? gait.clip : idleClip
  let anim: NonNullable<Obj3D['anim']> = { clip: gaitClip, time: elapsedS * gait.rate }
  const wall = t * D
  // One-shots override the gait. The kicker's clip starts just before its
  // ball-contact moment (the ball departs at t = 0); the receiver's is timed
  // to END with the ball's arrival at the segment end.
  const kicks = rules?.kickerOf.get(b.id)
  const receives = !!rules?.receiverOf.has(b.id)
  const nextKicks = rules?.nextKickerOf.get(b.id)
  const save = rules?.saveOf?.get(b.id)
  const prevSave = rules?.prevSaveOf?.get(b.id)
  const scissor = rules?.scissorOf?.get(b.id)
  const prevScissor = rules?.prevScissorOf?.get(b.id)
  if (scissor) {
    // Scissor kick: timed like the save — the in-air strike frame lands
    // exactly ON the segment end, where the retargeted ball arrives.
    const dur = clipDuration(scissor.clip)
    const rt = wall - D + (scissor.contactTime ?? Math.min(dur, D))
    if (rt >= 0) anim = { clip: scissor.clip, time: Math.min(rt, dur - 1e-3) }
  } else if (prevScissor) {
    // The turn after: finish the bicycle kick (follow-through from the strike
    // frame) while the struck ball flies out; back to the gait when it ends.
    const ct = (prevScissor.contactTime ?? 0) + wall
    if (ct < clipDuration(prevScissor.clip)) anim = { clip: prevScissor.clip, time: ct }
  } else if (save) {
    // Goalkeeper SAVE: the catch clip of the authored pose, timed like the
    // receive — its catch moment lands at the segment END, with the ball.
    const dur = clipDuration(save.clip)
    const rt = wall - D + (save.contactTime ?? Math.min(dur, D))
    if (rt >= 0) anim = { clip: save.clip, time: Math.min(rt, dur - 1e-3) }
  } else if (prevSave) {
    // The turn AFTER a save: finish the catch (follow-through — the clip's own
    // root motion keeps the displacement), then RETURN to the authored spot —
    // stepping in place (sidestep for lateral saves, jog backward otherwise)
    // while a transient world offset decays the displacement to zero.
    const dur = clipDuration(prevSave.clip)
    const contact = prevSave.contactTime ?? 0
    const follow = Math.min(dur - contact, 0.4 * D)
    if (wall < follow) {
      anim = { clip: prevSave.clip, time: Math.min(contact + wall, dur - 1e-3) }
    } else {
      const [lx, ly] = clipRootOffset(prevSave.clip, contact + follow)
      // The rendered mesh (and so its root-motion travel) scales with the
      // global object scale — the return offset must match.
      const s = Math.max(1, (b.useGlobalSize ? 1 : b.size) * objMult)
      const r = b.rotation
      const ox = (Math.sin(r) * ly + Math.cos(r) * lx) * s
      const oz = (Math.cos(r) * ly - Math.sin(r) * lx) * s
      const meta = Math.abs(lx) >= Math.abs(ly) ? PLAYER_CLIPS.gkSidestep : PLAYER_CLIPS.jogBack
      const p = Math.min(1, (wall - follow) / Math.max(0.2, D - follow))
      anim = { clip: meta.clip, time: wall - follow }
      if (Math.hypot(ox, oz) > 0.05 && p < 1) el = { ...el, animOffset: [ox * (1 - p), oz * (1 - p)] }
    }
  } else if (rules?.gkKickOf?.has(b.id)) {
    // GK deep kick: like a field kick, the punt starts slightly PRE-contact
    // so the foot lands on the ball just after it departs — no ball hold.
    const start = Math.max(0, (GK_KICK.contactTime ?? 0.4) - KICK_PRE_S)
    const ct = start + wall
    if (ct < clipDuration(GK_KICK.clip)) anim = { clip: GK_KICK.clip, time: ct }
  } else if (kicks) {
    const meta = kicks.pass ? PLAYER_CLIPS.pass : kicks.meta
    // A SHOT (kick — Power Shot or not landing at a player) plays the WHOLE
    // pose-chosen kick clip from the beginning of its own frame (user rule);
    // the previous turn is untouched (a run finishes cleanly). Passes keep the
    // classic slightly-pre-contact start so the contact stays near the departure.
    const start = kicks.pass ? Math.max(0, (meta.contactTime ?? 0.4) - KICK_PRE_S) : 0
    const ct = start + wall
    if (ct < clipDuration(meta.clip)) anim = { clip: meta.clip, time: ct }
  } else if (receives && !nextKicks && !gait.moving) {
    // An interaction animation (pass / kick / receive) plays exactly ONCE, in
    // its own turn — never split or echoed across a frame boundary. So a
    // player whose arriving ball goes OUT again next turn plays NOTHING here
    // (no receive, no anticipation): the strike renders once, next turn.
    // Receive plays only for a STATIONARY player whose ball settles (a moving
    // player keeps its gait — a trap pose mid-run reads wrong). Timed so the
    // clip's contact (trap) moment lands at the segment END, with the ball:
    // time = contact − (remaining wall time).
    const meta = PLAYER_CLIPS.receive
    const dur = clipDuration(meta.clip)
    const rt = wall - D + (meta.contactTime ?? Math.min(dur, D))
    if (rt >= 0) anim = { clip: meta.clip, time: Math.min(rt, dur - 1e-3) }
  } else if (rules?.turnOf?.has(b.id) && gait.moving) {
    // SHARP direction change at the coming boundary: the plant-and-turn clip,
    // its plant frame landing exactly ON the segment end (fading in from the
    // gait) — it smooths the brutal path corner.
    const meta = PLAYER_CLIPS.changeDir
    const rt = wall - D + (meta.contactTime ?? 0.833)
    if (rt >= 0) {
      anim = { clip: meta.clip, time: Math.min(rt, clipDuration(meta.clip) - 1e-3) }
      if (rt < GAIT_FADE_S) anim = { ...anim, prev: { clip: gaitClip, time: elapsedS * gait.rate }, fade: rt / GAIT_FADE_S }
    }
  } else if (rules?.prevTurnOf?.has(b.id) && gait.moving) {
    // …and the turn's EXIT plays into the new leg, then a HARD cut to the
    // gait: the clip's end pose is ~150° body-turned, so crossfading it at
    // the NEW facing would visibly sweep the player back through the old
    // direction before settling.
    const meta = PLAYER_CLIPS.changeDir
    const ct = (meta.contactTime ?? 0.833) + wall
    if (ct < clipDuration(meta.clip)) anim = { clip: meta.clip, time: ct }
  } else if (rules?.throwOf?.has(b.id)) {
    // THROW-IN: the trimmed release clip from the turn start, facing the
    // target for the whole turn (the ball flies where he looks).
    const th = rules.throwOf.get(b.id)!
    if (wall < clipDuration(THROW_IN.clip)) anim = { clip: THROW_IN.clip, time: wall }
    el = { ...el, rotation: Math.atan2(th.target[0] - b.x, th.target[1] - b.z) }
  } else if (rules?.turnInPlaceOf?.has(b.id) && !gait.moving) {
    // TURN IN PLACE: the clip's authored body yaw (~120°) does the visible
    // spin — hold the START rotation while it plays (the element's rotation
    // would otherwise pivot the mesh a second time), land on the authored
    // end rotation when it finishes.
    const clip = rules.turnInPlaceOf.get(b.id)!
    if (wall < clipDuration(clip)) {
      anim = { clip, time: wall }
      el = { ...el, rotation: a.rotation }
    } else {
      el = { ...el, rotation: b.rotation }
    }
  }
  // Blending. A LOCOMOTION segment gets an idle↔motion ENVELOPE: starting
  // from rest ramps the gait in against idle, and coming to rest next turn
  // ramps it back out toward idle before the boundary — so runs start and
  // stop softly instead of cutting at the frame edge. Gait→gait changes
  // between two MOVING segments (jog↔run) keep a clip-to-clip cross-fade,
  // and one-shots fade in from the previous gait (but a one-shot already
  // mid-flight is never diluted).
  const prevG = rules?.prevGait?.get(b.id)
  const nextG = rules?.nextGait?.get(b.id)
  if (anim.clip === gaitClip && gait.moving) {
    let w = 1
    if (!prevG || !prevG.moving) w = Math.min(w, wall / GAIT_RAMP_S)
    if (rules && (!nextG || !nextG.moving)) w = Math.min(w, (D - wall) / GAIT_RAMP_S)
    w = Math.max(0, Math.min(1, w))
    if (w < 1) {
      anim = { ...anim, prev: { clip: idleClip, time: elapsedS }, fade: w }
    } else if (prevG && prevG.moving && prevG.clip !== anim.clip && wall < GAIT_FADE_S) {
      anim = { ...anim, prev: { clip: prevG.clip, time: elapsedS * prevG.rate }, fade: wall / GAIT_FADE_S }
    }
  } else if (anim.clip !== gaitClip && !anim.prev && prevG && wall < GAIT_FADE_S && prevG.clip !== anim.clip && anim.time < GAIT_FADE_S) {
    // One-shots fade in from the previous gait. (An IDLE gait segment never
    // head-fades: the previous segment's ramp-out already landed on idle —
    // re-fading would pop the old gait back in.)
    anim = { ...anim, prev: { clip: prevG.clip, time: elapsedS * prevG.rate }, fade: wall / GAIT_FADE_S }
  }
  return { ...el, anim }
}

function applyObject3DMove(
  ea: BoardElement,
  eb: BoardElement,
  lerped: Extract<BoardElement, { type: 'object3d' }>,
  mids: PathPoint[] | undefined,
  te: number,
  t: number,
  /** Wall-clock seconds this transition lasts (variable frame length). */
  segD: number,
  objMult: number,
  cam?: THREE.Camera | null,
  elapsedS = 0,
  rules?: PlayerRules,
): BoardElement {
  let a = ea as Extract<BoardElement, { type: 'object3d' }>
  let b = eb as Extract<BoardElement, { type: 'object3d' }>
  let el = lerped
  // A ball being CAUGHT (goalkeeper save): its END retargets to the keeper's
  // hand point — [side, height, front] in his local frame — so it lands in
  // his hands whatever the authored spot. Transient; the frames stay the
  // coach's. (side + = the clips' local +x, e.g. the right-dive direction.)
  // Hand points are authored in REAL metres; the rendered keeper is scaled by
  // the global object scale, so the offsets scale with him.
  const gkScale = (gk: Obj3D) => Math.max(1, (gk.useGlobalSize ? 1 : gk.size) * objMult)
  const handPoint = (gk: Obj3D, hand: [number, number, number]): { x: number; z: number } => {
    const s = gkScale(gk)
    const [side, , front] = hand
    const r = gk.rotation
    return { x: gk.x + (Math.sin(r) * front + Math.cos(r) * side) * s, z: gk.z + (Math.cos(r) * front - Math.sin(r) * side) * s }
  }
  const caught = isObject3DBall(b.objectId) ? rules?.caughtBy?.get(b.id) : undefined
  if (caught) b = { ...b, ...handPoint(caught.gk, caught.meta.hand) }
  // A ball caught LAST turn starts from the keeper's hands (whether held —
  // gliding down to its authored spot — or distributed onward).
  const handoff = isObject3DBall(b.objectId) && !caught ? rules?.prevCaughtBy?.get(b.id) : undefined
  if (handoff) a = { ...a, ...handPoint(handoff.gk, handoff.meta.hand) }
  // A THROWN ball starts at the thrower's overhead release point, oriented
  // toward the target (the thrower faces it for the whole throw).
  const thrown = isObject3DBall(b.objectId) && !caught && !handoff ? rules?.thrownBall?.get(b.id) : undefined
  if (thrown) {
    const rot = Math.atan2(thrown.target[0] - thrown.thrower.x, thrown.target[1] - thrown.thrower.z)
    a = { ...a, ...handPoint({ ...thrown.thrower, rotation: rot }, THROW_IN.hand) }
  }
  const dist = Math.hypot(b.x - a.x, b.z - a.z)
  // Ground position at eased time q — along the path spline when one exists.
  const posAt = groundPosAt(a, b, mids, cam)
  // A KICKED ball waits at the kicker's feet until the strike's foot-contact
  // moment, then covers its whole run in the remaining wall time. Retime this
  // ball's progress up front so everything downstream (position, roll, tail,
  // parabola, catch elevation) samples the delayed trajectory.
  const kickDelay = isObject3DBall(b.objectId) ? rules?.kickDelayOf?.get(b.id) : undefined
  if (kickDelay && segD > kickDelay) {
    t = Math.min(1, Math.max(0, (t * segD - kickDelay) / (segD - kickDelay)))
    te = easeOf(b)(t)
    if (!mids?.length) {
      const g = posAt(te)
      if (g) el = { ...el, x: g.x, z: g.z }
    }
  }
  // A thrown ball ignores its Power Shot easing this turn (plain pace).
  if (thrown) te = t
  if ((caught || handoff || thrown) && !mids?.length) {
    const g = posAt(te)
    if (g) el = { ...el, x: g.x, z: g.z }
  }
  // 3D players play their skeletal clips while the animation runs: the rules
  // pick the gait (speed), dribble/pass/kick/receive (ball), and the facing
  // (path tangent). Clip time derives from the ABSOLUTE animation time, so
  // loops stay phase-continuous across segments and scrubbing is deterministic.
  if (isObject3DPlayer(b.objectId)) el = playerAnimFor(a, b, el, posAt, te, t, segD, elapsedS, rules, objMult) as typeof el
  if (mids?.length && cam) {
    const g = posAt(te)
    if (g) el = { ...el, x: g.x, z: g.z }
  }
  // Sharp-turn plant: the player runs the FULL leg — compressed so he ARRIVES
  // at the destination point just as the clip starts — and dances the turn AT
  // the corner (no skating, no shortened path). The new leg then holds the
  // corner while the clip finishes and covers its run in the remaining time.
  if (isObject3DPlayer(b.objectId) && rules) {
    const turnMeta = PLAYER_CLIPS.changeDir
    const contact = turnMeta.contactTime ?? 0.833
    if (rules.turnOf?.has(b.id)) {
      const startT = Math.max(1e-3, (segD - contact) / segD)
      const g = posAt(easeOf(b)(Math.min(1, t / startT)))
      if (g) el = { ...el, x: g.x, z: g.z }
    } else if (rules.prevTurnOf?.has(b.id)) {
      const exit = clipDuration(turnMeta.clip) - contact
      const q2 = Math.min(1, Math.max(0, (t * segD - exit) / Math.max(0.2, segD - exit)))
      const g = posAt(easeOf(b)(q2))
      if (g) el = { ...el, x: g.x, z: g.z }
    }
  }
  // Parabolic shot (ball): the flight height follows a parabola peaking
  // mid-move — a lofted pass. Peak scales with the run (capped).
  const parabolic = isObject3DBall(b.objectId) && b.effectParabolic && !thrown && dist > 0.5
  const peakH = parabolic ? Math.min(12, Math.max(1.5, dist * 0.25)) : 0
  const heightAt = (q: number) => (parabolic ? peakH * 4 * q * (1 - q) : 0)
  if (parabolic) el = { ...el, elevation: (el.elevation ?? 0) + heightAt(te) }
  // A caught ball RISES steadily from the start of its flight up to the
  // hands (blended over whatever trajectory it had — a flat shot climbs a
  // straight line, a lofted one morphs its parabola into the catch height);
  // a ball caught LAST turn descends from the hands as it's put down/played.
  if (caught) {
    el = { ...el, elevation: (el.elevation ?? 0) * (1 - te) + caught.meta.hand[1] * gkScale(caught.gk) * te }
  } else if (handoff) {
    el = { ...el, elevation: Math.max(el.elevation ?? 0, handoff.meta.hand[1] * gkScale(handoff.gk) * (1 - te)) }
  } else if (thrown) {
    // From overhead down to the target, with a SOFT throw arc on top.
    const h0 = THROW_IN.hand[1] * gkScale(thrown.thrower)
    const peak = Math.min(3, Math.max(0.5, dist * 0.12))
    el = { ...el, elevation: h0 * (1 - te) + peak * 4 * te * (1 - te) }
  }
  if (isObject3DBall(b.objectId) && dist > 0.5) {
    // Run distance in ground metres (spline paths: sampled arc length).
    let run = dist
    if (mids?.length && cam) {
      run = 0
      let prev = posAt(0)
      for (let k = 1; k <= 24; k++) {
        const cur = posAt(k / 24)
        if (prev && cur) run += Math.hypot(cur.x - prev.x, cur.z - prev.z)
        prev = cur
      }
    }
    // Physical spin: angle = distance / rendered radius, capped so a long fast
    // pass doesn't blur (max revolutions over the transition's wall time).
    const radius = BALL_RADIUS_M * Math.max(1, (b.useGlobalSize ? 1 : b.size) * objMult)
    const totalAngle = Math.min(run / radius, MAX_ROLL_REV_PER_S * 2 * Math.PI * segD)
    // Roll about the ground axis perpendicular to the CURRENT motion tangent.
    const g0 = posAt(Math.max(0, te - 0.02))
    const g1 = posAt(Math.min(1, te + 0.02))
    if (g0 && g1) {
      const dx = g1.x - g0.x
      const dz = g1.z - g0.z
      const len = Math.hypot(dx, dz)
      if (len > 1e-6) {
        // axis = up × dir → (dz, -dx) in the ground plane.
        el = { ...el, roll: totalAngle * te, rollAxis: [dz / len, -dx / len] }
      }
    }
  }
  // Movement effects (same semantics as tokens): the motion TAIL samples the
  // real trajectory in BOARD coords (an SVG overlay draws it under the WebGL
  // object). The PULSE pings even when stationary; the tail needs motion.
  if ((b.effectTail || b.effectPulse) && cam) {
    if (b.effectPulse) {
      // Base ring radius from the RENDERED size (incl. the global/ball scale),
      // so the ping clears the mesh instead of hiding under it.
      const baseR = (isObject3DBall(b.objectId) ? 0.4 : 0.7) * Math.max(1, (b.useGlobalSize ? 1 : b.size) * objMult)
      el = { ...el, pulseRings: pulseRingsFor(cam, el.x, el.z, baseR, (t / 0.4375) % 1) }
    }
    if (b.effectTail && dist > 0.5) {
      const ease = easeOf(b)
      const span = Math.min(t, 14 * 0.028)
      const s0 = t - span
      const trail: PathPoint[] = []
      for (let k = 0; k <= 13; k++) {
        const q = ease(s0 + (span * k) / 13)
        const g = posAt(q)
        // A parabolic ball's tail follows it through the AIR.
        if (g) trail.push(projectWorld(cam, g.x, heightAt(q), g.z))
      }
      if (trail.length >= 2) el = { ...el, trail }
    }
  }
  return el
}



/** The BETWEEN effect for a moving token ('tail' / 'pulse'): transient render
 *  hints attached to the interpolated element while its centre travels. The
 *  tail samples the SAME trajectory the token follows (movement-path spline or
 *  the straight line) at recent parameter values, so it always trails the true
 *  motion. */
function applyBetweenEffect(ea: BoardElement, eb: BoardElement, lerped: BoardElement, mids: PathPoint[] | undefined, t: number, ease: (s: number) => number, cam?: THREE.Camera | null, keepGround?: boolean): BoardElement {
  if (!eb.effectTail && !eb.effectPulse) return lerped
  const ca = elementCenter(ea)
  const cb = elementCenter(eb)
  if (!ca || !cb) return lerped
  // The PULSE pings even on a stationary element (marking a spot); only the
  // TAIL requires actual motion.
  const moving = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) >= 4
  let el = lerped
  if (eb.effectPulse) {
    const phase = (t / 0.4375) % 1
    // On a 3D field the ping lies ON the pitch: ground rings at the token's
    // CURRENT spot, projected through the resting camera.
    const cl = elementCenter(el)
    const g = cam && cl ? boardToGround(cl[0], cl[1], cam) : null
    if (cam && g) {
      const baseR = ((eb as { sizeM?: number }).sizeM ?? 5) / 2
      el = { ...el, pulseRings: pulseRingsFor(cam, g.x, g.z, baseR, phase) } as BoardElement
    } else el = { ...el, pulse: phase } as BoardElement
  }
  if (eb.effectTail && moving) {
    const ctrl: PathPoint[] = mids?.length ? [ca, ...mids, cb] : [ca, cb]
    const ga = (ea as { ground?: [number, number] }).ground
    const gb = (eb as { ground?: [number, number] }).ground
    const groundCam = keepGround ? cam : null
    const groundLerp = !mids?.length && groundCam && ga && gb && typeof ga[0] === 'number' && typeof gb[0] === 'number'
    // The token's actual position at raw time s (its own easing applied):
    // pinned tokens lerp their GROUND anchor (metres) and project; unpinned
    // ones lerp/spline in board space.
    const pos = (s: number): PathPoint => {
      const q = ease(s)
      if (groundLerp) return projectGround(groundCam!, ga![0] + (gb![0] - ga![0]) * q, ga![1] + (gb![1] - ga![1]) * q)
      return ctrl.length > 2 ? pointAlongPath(ctrl, q) : [ca[0] + (cb[0] - ca[0]) * q, ca[1] + (cb[1] - ca[1]) * q]
    }
    // Sample uniformly over the AVAILABLE span (never clamping several samples
    // onto the start point): early in the transition the tail is simply
    // shorter, but its zero-width tip is always the oldest visible point —
    // never a blunt cut edge.
    const span = Math.min(t, 14 * 0.028)
    const s0 = t - span
    const trail: PathPoint[] = []
    for (let k = 0; k <= 13; k++) trail.push(pos(s0 + (span * k) / 13))
    el = { ...el, trail } as BoardElement
  }
  return el
}

/** Re-position the interpolated element so its centre follows the spline
 *  through [centre(a), ...mids, centre(b)] at arc-length fraction t. */
function alongPath(a: BoardElement, b: BoardElement, lerped: BoardElement, mids: PathPoint[], t: number): BoardElement {
  const ca = elementCenter(a)
  const cb = elementCenter(b)
  const cl = elementCenter(lerped)
  if (!ca || !cb || !cl) return lerped
  const [px, py] = pointAlongPath([ca, ...mids, cb], t)
  const tr = (lerped as Extract<BoardElement, { transform: { x: number; y: number } }>).transform
  return { ...lerped, transform: { ...tr, x: tr.x + px - cl[0], y: tr.y + py - cl[1] } } as BoardElement
}

interface Playback {
  raf: number
  preElements: BoardElement[]
  preCamera: FieldView | null
  stopped: boolean
  // Pause holds the loop in place (frozen on the exact interpolated frame) without
  // resetting; `pausedAccum` is total paused wall-time, subtracted from the clock so
  // the timeline resumes seamlessly.
  paused: boolean
  pauseStart: number
  pausedAccum: number
}

const players = new WeakMap<EditorStore, Playback>()

/** Write one playback state into the doc (no ops / onChange — see header): the
 *  interpolated `elements` and camera `pose`, with pitch-pinned elements + motion
 *  tails reprojected from the resting camera `from` to the in-flight `pose`.
 *  Shared by real-time playback and the deterministic frame-render seek. */
function applyPlaybackState(store: EditorStore, from: FieldView | null, elements: BoardElement[], pose: FieldView | null, playhead: number): void {
  const { doc } = store.getState()
  let els = elements
  if (pose && from && !samePose(pose, from)) {
    const changes = reprojectChanges(withGroundAnchors(els, from), from, pose)
    if (changes.length) els = applyOperation({ ...doc, elements: els }, { kind: 'update', changes }).elements
    els = els.map((e) => {
      const fx = e as { trail?: Array<[number, number]>; pulseRings?: Array<{ points: Array<[number, number]>; opacity: number }> }
      if (!fx.trail && !fx.pulseRings) return e
      return {
        ...e,
        ...(fx.trail ? { trail: reprojectBoardPoints(fx.trail, from, pose) } : {}),
        ...(fx.pulseRings ? { pulseRings: fx.pulseRings.map((r) => ({ ...r, points: reprojectBoardPoints(r.points, from, pose) })) } : {}),
      } as BoardElement
    })
  }
  store.setState({ playhead, doc: { ...doc, elements: els, background: { ...doc.background, field3d: pose ?? doc.background.field3d } } })
}

/** Whether a playback session is active (running OR paused). */
export function isPlaying(store: EditorStore): boolean {
  return players.has(store)
}

/** Whether playback is paused (frozen on the current frame, resumable). */
export function isPaused(store: EditorStore): boolean {
  const pb = players.get(store)
  return !!pb && pb.paused
}

/** Pause in place: the exact interpolated frame stays on screen (unlike
 *  stopPlayback, which resets to the pre-play frame). Resume with resumePlayback. */
export function pausePlayback(store: EditorStore): void {
  const pb = players.get(store)
  if (!pb || pb.paused) return
  pb.paused = true
  pb.pauseStart = performance.now()
  store.setState({ playing: false })
}

/** Resume from a pause, continuing the timeline from where it froze. */
export function resumePlayback(store: EditorStore): void {
  const pb = players.get(store)
  if (!pb || !pb.paused) return
  pb.pausedAccum += performance.now() - pb.pauseStart
  pb.paused = false
  store.setState({ playing: true })
}

/** Start looping playback (no-op with fewer than 2 frames). */
export function startPlayback(store: EditorStore): void {
  if (players.get(store)) return
  const s = store.getState()
  const frames = s.doc.animation.frames
  if (frames.length < 2) return
  cancelFieldAnimation(store)
  s.commitTransaction()
  s.setSelection([])
  // Sync the edited frame one last time, then snapshot the pre-play state.
  s.setCurrentFrame(s.currentFrame)
  const doc0 = store.getState().doc
  const pb: Playback = { raf: 0, preElements: doc0.elements, preCamera: doc0.background.field3d, stopped: false, paused: false, pauseStart: 0, pausedAccum: 0 }
  players.set(store, pb)
  store.setState({ playing: true, playhead: 0 })
  // Warm the skinned-players asset (async 4 MB parse) as soon as a play with
  // 3D players starts — they stay static meshes until it lands.
  if (frames.some((f) => f.elements.some((e) => e.type === 'object3d' && isObject3DPlayer(e.objectId)))) ensurePlayerAnimLoaded()

  // Effective per-frame cameras: null poses inherit the previous frame's; the
  // whole chain seeds from the pose playback starts at (null on 2D boards —
  // then the camera simply never moves).
  const effCam: (FieldView | null)[] = []
  for (let i = 0; i < frames.length; i++) effCam.push(frames[i].camera ?? (i === 0 ? pb.preCamera : effCam[i - 1]))

  // Write one playback step into the doc (no ops / onChange — see header).
  // All frames' 2D coords are relative to the LIVE editing camera (pb.preCamera
  // — the setBackground invariant keeps them there), so pitch-pinned elements
  // reproject preCamera → the in-flight pose each step.
  const apply = (elements: BoardElement[], pose: FieldView | null, playhead: number) => applyPlaybackState(store, pb.preCamera, elements, pose, playhead)

  // Playback starts from the frame being EDITED (falling back to the start
  // when that's the last frame); loop wraps always restart from frame 1.
  let seg = s.currentFrame < frames.length - 1 ? s.currentFrame : 0
  let first = true
  let segStart: number | null = null
  // Variable frame length: the current segment's 1×-speed duration (base 1 s,
  // stretched when a triggered one-shot player clip needs longer), plus the
  // 1×-seconds accumulated over the segments already completed THIS loop
  // (the players' clip clock; resets on wrap).
  let curD = TRANSITION_MS / 1000
  let elapsedBase = 0
  const step = (raw: number) => {
    if (players.get(store) !== pb || pb.stopped) return
    // Paused: hold the loop (the last frame stays on screen) and don't advance.
    if (pb.paused) {
      pb.raf = requestAnimationFrame(step)
      return
    }
    // Subtract time spent paused so the animation clock resumes where it left off.
    const now = raw - pb.pausedAccum
    const fr = store.getState().doc.animation.frames
    if (fr.length < 2) {
      stopPlayback(store)
      return
    }
    // Settings are read live so speed/easing changes apply immediately.
    const anim = store.getState().doc.animation
    const spd = Math.min(2, Math.max(0.25, anim.speed))
    if (segStart === null) {
      curD = segmentDuration(fr[seg], fr[seg + 1], pb.preCamera, seg > 0 ? { elements: fr[seg - 1].elements, paths: fr[seg].paths } : undefined)
      // Starting (from the edited frame) or wrapping the loop: hard cut to the
      // segment's start frame — its camera applies instantly (per spec). 3D
      // players keep their idle pose through the cut (no static flash).
      if (first || seg === 0) apply(withPlayerIdles(fr[seg].elements, elapsedBase / spd), effCam[seg], seg)
      first = false
      segStart = now
    }
    const t = Math.min(1, ((now - segStart) * spd) / (curD * 1000))
    // Wall-clock seconds into this loop — the players' clip time
    // (phase-continuous across segments).
    const elapsedS = (elapsedBase + t * curD) / spd
    const camT = anim.cameraEasing === 'ease' ? easeInOutCubic(t) : t
    const pose = effCam[seg] && effCam[seg + 1] ? lerpPose(effCam[seg]!, effCam[seg + 1]!, camT) : (effCam[seg + 1] ?? effCam[seg])
    apply(lerpElements(fr[seg].elements, fr[seg + 1].elements, t, fr[seg + 1].paths, pb.preCamera, store.getState().doc.background.tokens3d && !!store.getState().doc.background.field3d, curD / spd, store.getState().doc.background.objectScale, fr[seg + 1].effects, elapsedS, seg > 0 ? { elements: fr[seg - 1].elements, paths: fr[seg].paths } : undefined, seg + 2 < fr.length ? { elements: fr[seg + 2].elements, paths: fr[seg + 2].paths, effects: fr[seg + 2].effects } : undefined), pose, seg + t)
    if (t >= 1) {
      if (seg + 1 >= fr.length - 1) {
        // Reached the last frame. Loop wraps (hard cut back to frame 1);
        // loop-off stops automatically and repositions ON frame 1.
        if (!anim.loop) {
          finishPlayback(store)
          return
        }
        seg = 0
        elapsedBase = 0
      } else {
        seg += 1
        elapsedBase += curD
      }
      segStart = null
    }
    pb.raf = requestAnimationFrame(step)
  }
  pb.raf = requestAnimationFrame(step)
}

// ── Deterministic frame render (server-side MP4) ─────────────────────────────
// Instead of real-time capture (drops frames when the layer stack can't composite
// in time), a headless renderer drives the animation frame-by-frame: begin →
// seek(0..N) rendering + screenshot each → end. Same interpolation as playback,
// but the caller controls WHEN each frame is stepped, so it can wait for the WebGL/
// SVG layers to actually paint before capturing. See window.ycbAnim in the app.

interface RenderCtrl {
  preElements: BoardElement[]
  preCamera: FieldView | null
  effCam: (FieldView | null)[]
  durs: number[] // per-segment 1×-speed duration (s)
  realDur: number // total playback length at the current speed (s)
  spd: number
  total: number // number of sample frames (fps × realDur, ≥ 2)
  prevLoop: boolean
  prevFrame: number
}
const renderCtrls = new WeakMap<EditorStore, RenderCtrl>()

/** Enter deterministic render mode and return the number of sample frames
 *  (≈ duration ÷ speed × fps, ≥ 2). Suspends editing (playing=true) until
 *  endAnimationRender. No-op → 0 when there are fewer than 2 frames. */
export function beginAnimationRender(store: EditorStore, fps = 30): number {
  const s = store.getState()
  const frames = s.doc.animation.frames
  if (frames.length < 2) return 0
  cancelFieldAnimation(store)
  stopPlayback(store)
  s.commitTransaction()
  s.setSelection([])
  const prevFrame = s.currentFrame
  s.setCurrentFrame(0)
  const doc0 = store.getState().doc
  const preCamera = doc0.background.field3d
  const effCam: (FieldView | null)[] = []
  for (let i = 0; i < frames.length; i++) effCam.push(frames[i].camera ?? (i === 0 ? preCamera : effCam[i - 1]))
  const spd = Math.min(2, Math.max(0.25, doc0.animation.speed))
  const durs: number[] = []
  for (let i = 0; i < frames.length - 1; i++) durs.push(segmentDuration(frames[i], frames[i + 1], preCamera, i > 0 ? { elements: frames[i - 1].elements, paths: frames[i].paths } : undefined))
  const realDur = durs.reduce((a, b) => a + b, 0) / spd
  const total = Math.max(2, Math.round(realDur * fps) + 1)
  if (frames.some((f) => f.elements.some((e) => e.type === 'object3d' && isObject3DPlayer(e.objectId)))) ensurePlayerAnimLoaded()
  renderCtrls.set(store, { preElements: doc0.elements, preCamera, effCam, durs, realDur, spd, total, prevLoop: doc0.animation.loop, prevFrame })
  store.setState({ playing: true, playhead: 0 })
  return total
}

/** Total sample frames without entering render mode (same value beginAnimationRender returns). */
export function animationFrameCount(store: EditorStore, fps = 30): number {
  const s = store.getState()
  const frames = s.doc.animation.frames
  if (frames.length < 2) return 0
  const preCamera = s.doc.background.field3d
  const spd = Math.min(2, Math.max(0.25, s.doc.animation.speed))
  let base = 0
  for (let i = 0; i < frames.length - 1; i++) base += segmentDuration(frames[i], frames[i + 1], preCamera, i > 0 ? { elements: frames[i - 1].elements, paths: frames[i].paths } : undefined)
  return Math.max(2, Math.round((base / spd) * fps) + 1)
}

/** Render sample frame `n` (0‥total−1) into the doc — the animation state at
 *  playback time n∕(total−1)·duration. Deterministic (no wall-clock); the caller
 *  waits for the layers to paint, then captures. */
export function seekAnimationFrame(store: EditorStore, n: number): void {
  const ctrl = renderCtrls.get(store)
  if (!ctrl) return
  const { effCam, durs, spd, preCamera, realDur, total } = ctrl
  const fr = store.getState().doc.animation.frames
  const tr = total > 1 ? Math.min(realDur, Math.max(0, (n / (total - 1)) * realDur)) : 0
  // Locate the segment (real-time offsets) and the local 0‥1 progress within it.
  let acc = 0
  let seg = 0
  let t = 0
  for (let i = 0; i < durs.length; i++) {
    const segReal = durs[i] / spd
    if (i === durs.length - 1 || tr <= acc + segReal) {
      seg = i
      t = segReal > 0 ? Math.min(1, Math.max(0, (tr - acc) / segReal)) : 1
      break
    }
    acc += segReal
  }
  const anim = store.getState().doc.animation
  const camT = anim.cameraEasing === 'ease' ? easeInOutCubic(t) : t
  const pose = effCam[seg] && effCam[seg + 1] ? lerpPose(effCam[seg]!, effCam[seg + 1]!, camT) : (effCam[seg + 1] ?? effCam[seg])
  const els = lerpElements(fr[seg].elements, fr[seg + 1].elements, t, fr[seg + 1].paths, preCamera, store.getState().doc.background.tokens3d && !!store.getState().doc.background.field3d, durs[seg] / spd, store.getState().doc.background.objectScale, fr[seg + 1].effects, tr, seg > 0 ? { elements: fr[seg - 1].elements, paths: fr[seg].paths } : undefined, seg + 2 < fr.length ? { elements: fr[seg + 2].elements, paths: fr[seg + 2].paths, effects: fr[seg + 2].effects } : undefined)
  applyPlaybackState(store, preCamera, els, pose, seg + t)
}

/** Leave deterministic render mode and restore the pre-render editing state. */
export function endAnimationRender(store: EditorStore): void {
  const ctrl = renderCtrls.get(store)
  if (!ctrl) return
  renderCtrls.delete(store)
  // Restore the doc directly: setCurrentFrame is a no-op when the frame index is
  // unchanged, so it wouldn't undo the seeked elements. Snap back to the frame the
  // user was on (its snapshot) at the resting camera.
  const st = store.getState()
  const frames = st.doc.animation.frames
  const els = frames[ctrl.prevFrame]?.elements ?? ctrl.preElements
  store.setState({ playing: false, playhead: null, currentFrame: ctrl.prevFrame, doc: { ...st.doc, elements: els, background: { ...st.doc.background, field3d: ctrl.preCamera } } })
  st.setAnimationSettings({ loop: ctrl.prevLoop })
}

/** How long the transition INTO frame i+1 lasts at 1× speed, in seconds: the
 *  base 1 s, extended when a triggered one-shot needs longer to complete (the
 *  spec's variable frame length — e.g. a long receive extends its move so the
 *  trap lands with the ball). Cheap; computed fresh at each segment start so
 *  the lazily-parsed clip durations are picked up. */
function segmentDuration(a: AnimationFrame, b: AnimationFrame, preCam: FieldView | null, prev?: { elements: BoardElement[]; paths?: AnimationFrame['paths'] }): number {
  const base = TRANSITION_MS / 1000
  const cam = () => (preCam ? makeCalibratedCamera(preCam) : null)
  const rules = buildPlayerRules(a.elements, b.elements, b.paths, cam, base, prev, undefined, b.effects)
  if (!rules) return base
  let d = base
  for (const [, k] of rules.kickerOf) {
    const meta = k.pass ? PLAYER_CLIPS.pass : k.meta
    // Kicks play the FULL pose-chosen clip from the frame start; passes start
    // pre-contact.
    d = Math.max(d, clipDuration(meta.clip) - (k.pass ? Math.max(0, (meta.contactTime ?? 0.4) - KICK_PRE_S) : 0))
  }
  if (rules.receiverOf.size) d = Math.max(d, PLAYER_CLIPS.receive.contactTime ?? base)
  if (rules.saveOf) for (const [, m] of rules.saveOf) d = Math.max(d, m.contactTime ?? base)
  if (rules.gkKickOf?.size) d = Math.max(d, clipDuration(GK_KICK.clip) - Math.max(0, (GK_KICK.contactTime ?? 0.4) - KICK_PRE_S))
  return d
}

/** 3D players in a raw frame snapshot get their idle pose (hard cuts at play
 *  start / loop wraps — keeps the skinned mesh mounted, no static flash). */
function withPlayerIdles(elements: BoardElement[], atS: number): BoardElement[] {
  return elements.map((e) => (e.type === 'object3d' && isObject3DPlayer(e.objectId) ? { ...e, anim: { clip: playerIdleClip(e.objectId), time: atS } } : e))
}

/** Loop-off end of playback: stop, then land on FRAME 1 (like clicking its
 *  tile — the camera flies to its stored pose, when it has one). */
function finishPlayback(store: EditorStore): void {
  stopPlayback(store)
  const s = store.getState()
  if (s.doc.animation.frames.length === 0) return
  s.setCurrentFrame(0)
  const cam = store.getState().doc.animation.frames[0].camera
  if (cam && store.getState().doc.background.field3d) animateFieldTo(store, cam)
}

/** Stop playback and restore the pre-play state (edited frame + camera). */
export function stopPlayback(store: EditorStore): void {
  const pb = players.get(store)
  if (!pb) return
  pb.stopped = true
  cancelAnimationFrame(pb.raf)
  players.delete(store)
  const { doc } = store.getState()
  store.setState({
    playing: false,
    playhead: null,
    doc: { ...doc, elements: pb.preElements, background: { ...doc.background, field3d: pb.preCamera } },
  })
}

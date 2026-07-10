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
import type * as THREE from 'three'
import { projectGround, reprojectChanges, withGroundAnchors } from './field-anchor'
import { makeCalibratedCamera } from './field-camera'
import { boardToGround } from './arrow3d'
import { elementCenter, pointAlongPath, type PathPoint } from './movement-path'

const TRANSITION_MS = 1000 // 1 s per frame transition at 1× speed

// Element timing is LINEAR (no easing) — objects move at constant speed
// between frames; per-transition easings come with the later "Transitions"
// phase of the spec. The CAMERA flight optionally eases ("Easy Ease" in the
// animation settings).
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

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
function enterExitParts(el: BoardElement, p: number, dir: 'in' | 'out', cam?: THREE.Camera | null): BoardElement[] {
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
  return [applyEffect(el, p, dir, undefined, cam)]
}

/** Apply an element's enter/exit effect at transition progress p (0‥1).
 *  arrow3d supports fade only; object3d pops (no transform/opacity). */
function applyEffect(el: BoardElement, p: number, dir: 'in' | 'out', nameOverride?: string, cam?: THREE.Camera | null): BoardElement {
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
function lerpElements(a: BoardElement[], b: BoardElement[], t: number, paths?: AnimationFrame['paths'], liveCam?: FieldView | null): BoardElement[] {
  const byId = new Map(a.map((e) => [e.id, e]))
  // Pitch-pinned 3D texts translate their effects into ground metres — build
  // the (lazy) calibrated camera once per pass.
  let cam3: THREE.Camera | null | undefined
  const cam = () => (cam3 === undefined ? (cam3 = liveCam ? makeCalibratedCamera(liveCam) : null) : cam3)
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
      let el = lerpValue(na, nb, t) as BoardElement
      // Point paths whose point COUNT changed between the frames (a vertex was
      // added/removed): lerpValue can only snap mismatched arrays, so guess the
      // morph instead — resample both to a common count and interpolate.
      if ((ea.type === 'polyline' || ea.type === 'draw') && ea.type === eb.type && ea.points.length !== eb.points.length && ea.points.length >= 2 && eb.points.length >= 2) {
        el = { ...el, points: morphPoints(ea.points, eb.points, t) } as BoardElement
      }
      if (mids?.length) el = alongPath(ea, eb, el, mids, t)
      out.push(el)
    } else out.push(...enterExitParts(eb, t, 'in', cam()))
  }
  const bIds = new Set(b.map((e) => e.id))
  for (const ea of a) if (!bIds.has(ea.id)) out.push(...enterExitParts(ea, t, 'out', cam()))
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
}

const players = new WeakMap<EditorStore, Playback>()

/** Whether playback is running for this store. */
export function isPlaying(store: EditorStore): boolean {
  return players.has(store)
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
  const pb: Playback = { raf: 0, preElements: doc0.elements, preCamera: doc0.background.field3d, stopped: false }
  players.set(store, pb)
  store.setState({ playing: true, playhead: 0 })

  // Effective per-frame cameras: null poses inherit the previous frame's; the
  // whole chain seeds from the pose playback starts at (null on 2D boards —
  // then the camera simply never moves).
  const effCam: (FieldView | null)[] = []
  for (let i = 0; i < frames.length; i++) effCam.push(frames[i].camera ?? (i === 0 ? pb.preCamera : effCam[i - 1]))

  // Write one playback step into the doc (no ops / onChange — see header).
  // All frames' 2D coords are relative to the LIVE editing camera (pb.preCamera
  // — the setBackground invariant keeps them there), so pitch-pinned elements
  // reproject preCamera → the in-flight pose each step.
  const apply = (elements: BoardElement[], pose: FieldView | null, playhead: number) => {
    const { doc } = store.getState()
    let els = elements
    const from = pb.preCamera
    if (pose && from && !samePose(pose, from)) {
      const changes = reprojectChanges(withGroundAnchors(els, from), from, pose)
      if (changes.length) els = applyOperation({ ...doc, elements: els }, { kind: 'update', changes }).elements
    }
    store.setState({ playhead, doc: { ...doc, elements: els, background: { ...doc.background, field3d: pose ?? doc.background.field3d } } })
  }

  // Playback starts from the frame being EDITED (falling back to the start
  // when that's the last frame); loop wraps always restart from frame 1.
  let seg = s.currentFrame < frames.length - 1 ? s.currentFrame : 0
  let first = true
  let segStart: number | null = null
  const step = (now: number) => {
    if (players.get(store) !== pb || pb.stopped) return
    const fr = store.getState().doc.animation.frames
    if (fr.length < 2) {
      stopPlayback(store)
      return
    }
    if (segStart === null) {
      // Starting (from the edited frame) or wrapping the loop: hard cut to the
      // segment's start frame — its camera applies instantly (per spec).
      if (first || seg === 0) apply(fr[seg].elements, effCam[seg], seg)
      first = false
      segStart = now
    }
    // Settings are read live so speed/easing changes apply immediately.
    const anim = store.getState().doc.animation
    const t = Math.min(1, ((now - segStart) * Math.min(2, Math.max(0.25, anim.speed))) / TRANSITION_MS)
    const camT = anim.cameraEasing === 'ease' ? easeInOutCubic(t) : t
    const pose = effCam[seg] && effCam[seg + 1] ? lerpPose(effCam[seg]!, effCam[seg + 1]!, camT) : (effCam[seg + 1] ?? effCam[seg])
    apply(lerpElements(fr[seg].elements, fr[seg + 1].elements, t, fr[seg + 1].paths, pb.preCamera), pose, seg + t)
    if (t >= 1) {
      if (seg + 1 >= fr.length - 1) {
        // Reached the last frame. Loop wraps (hard cut back to frame 1);
        // loop-off stops automatically and repositions ON frame 1.
        if (!anim.loop) {
          finishPlayback(store)
          return
        }
        seg = 0
      } else seg += 1
      segStart = null
    }
    pb.raf = requestAnimationFrame(step)
  }
  pb.raf = requestAnimationFrame(step)
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

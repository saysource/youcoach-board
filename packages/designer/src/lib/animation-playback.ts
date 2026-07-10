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

import { applyOperation, type AnimationFrame, type BoardElement, type FieldView } from '@youcoach-board/core'
import type { EditorStore } from '../store/editorStore'
import { lerpPose, cancelFieldAnimation, animateFieldTo } from './field-anim'
import { reprojectChanges, withGroundAnchors } from './field-anchor'
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
 *  arrow3d element carries a top-level opacity; everything else fades via the
 *  transform. */
function faded(el: BoardElement, f: number): BoardElement {
  if (el.type === 'arrow3d') return { ...el, opacity: (el.opacity ?? 1) * f }
  return { ...el, transform: { ...el.transform, opacity: el.transform.opacity * f } }
}

/** The interpolated element list for transition a→b at time t. Matched ids
 *  interpolate; b-only elements fade in, a-only fade out (appended last so
 *  they keep painting until gone). Output order follows b. An element with a
 *  movement path INTO frame b travels along that spline (arc-length pace)
 *  instead of the straight line — all other properties still interpolate. */
function lerpElements(a: BoardElement[], b: BoardElement[], t: number, paths?: AnimationFrame['paths']): BoardElement[] {
  const byId = new Map(a.map((e) => [e.id, e]))
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
      if (mids?.length) el = alongPath(ea, eb, el, mids, t)
      out.push(el)
    } else out.push(faded(eb, t))
  }
  const bIds = new Set(b.map((e) => e.id))
  for (const ea of a) if (!bIds.has(ea.id)) out.push(faded(ea, 1 - t))
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
    apply(lerpElements(fr[seg].elements, fr[seg + 1].elements, t, fr[seg + 1].paths), pose, seg + t)
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

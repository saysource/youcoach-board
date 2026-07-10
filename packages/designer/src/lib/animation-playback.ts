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

import { applyOperation, type BoardElement, type FieldView } from '@youcoach-board/core'
import type { EditorStore } from '../store/editorStore'
import { lerpPose, cancelFieldAnimation } from './field-anim'
import { reprojectChanges, withGroundAnchors } from './field-anchor'

const TRANSITION_MS = 1000 // fixed 1 s per frame transition (Phase 1)

// Default transition timing: LINEAR (no easing) — objects move at constant
// speed between frames. Per-transition easings come with the later
// "Transitions" phase of the spec.

/** Generic numeric interpolation: numbers lerp; same-length arrays and plain
 *  objects recurse; anything else (strings, booleans, shape mismatches) snaps
 *  at the halfway point. Covers transform, x/y/z, rotation, points, ground
 *  anchors, spline fields, sizeM — without per-type knowledge. */
function lerpValue(a: unknown, b: unknown, t: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t
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

/** The interpolated element list for transition a→b at eased time t. Matched
 *  ids interpolate; b-only elements fade in, a-only fade out (appended last so
 *  they keep painting until gone). Output order follows b. */
function lerpElements(a: BoardElement[], b: BoardElement[], t: number): BoardElement[] {
  const byId = new Map(a.map((e) => [e.id, e]))
  const out: BoardElement[] = []
  for (const eb of b) {
    const ea = byId.get(eb.id)
    if (ea && ea.type === eb.type) out.push(lerpValue(ea, eb, t) as BoardElement)
    else out.push(faded(eb, t))
  }
  const bIds = new Set(b.map((e) => e.id))
  for (const ea of a) if (!bIds.has(ea.id)) out.push(faded(ea, 1 - t))
  return out
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
    if (pose && from && JSON.stringify(pose) !== JSON.stringify(from)) {
      const changes = reprojectChanges(withGroundAnchors(els, from), from, pose)
      if (changes.length) els = applyOperation({ ...doc, elements: els }, { kind: 'update', changes }).elements
    }
    store.setState({ playhead, doc: { ...doc, elements: els, background: { ...doc.background, field3d: pose ?? doc.background.field3d } } })
  }

  let seg = 0 // transition index: frames[seg] → frames[seg + 1]
  let segStart: number | null = null
  const step = (now: number) => {
    if (players.get(store) !== pb || pb.stopped) return
    const fr = store.getState().doc.animation.frames
    if (fr.length < 2) {
      stopPlayback(store)
      return
    }
    if (segStart === null) {
      // (Re)starting the loop: hard cut to frame 1 — its camera applies instantly.
      if (seg === 0) apply(fr[0].elements, effCam[0], 0)
      segStart = now
    }
    const t = Math.min(1, (now - segStart) / TRANSITION_MS)
    const pose = effCam[seg] && effCam[seg + 1] ? lerpPose(effCam[seg]!, effCam[seg + 1]!, t) : (effCam[seg + 1] ?? effCam[seg])
    apply(lerpElements(fr[seg].elements, fr[seg + 1].elements, t), pose, seg + t)
    if (t >= 1) {
      seg = seg + 1 < fr.length - 1 ? seg + 1 : 0
      segStart = null
    }
    pb.raf = requestAnimationFrame(step)
  }
  pb.raf = requestAnimationFrame(step)
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

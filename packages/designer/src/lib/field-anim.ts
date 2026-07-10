// Smooth field-camera tween: eases background.field3d toward a target pose
// (rAF, exponential ease-out), coalescing the whole flight — including the
// reprojection of pitch-pinned elements — into ONE undo step. Shared by the
// keyboard camera (BoardShell) and the drawer's zone / legacy-field transitions.
//
// One animation per store: a new call RETARGETS the in-flight tween (and
// replaces its completion callback), so rapid choices chain into one motion.

import type { FieldView } from '@youcoach-board/core'
import type { EditorStore } from '../store/editorStore'

// TIME-BASED ease-out (frame-rate independent): the fraction of the remaining
// distance left after dt seconds is DECAY^dt — equivalent to the old 28%-per-
// frame step at 60 fps, but low-FPS environments converge in the same wall time.
const DECAY = Math.pow(0.72, 60)
const EPS = 0.05 // metric closeness that snaps to the target and ends the tween

const lerpPose = (a: FieldView, b: FieldView, t: number): FieldView => {
  const l = (x: number, y: number) => x + (y - x) * t
  return {
    ref: b.ref,
    fov: l(a.fov, b.fov),
    position: [l(a.position[0], b.position[0]), l(a.position[1], b.position[1]), l(a.position[2], b.position[2])],
    target: [l(a.target[0], b.target[0]), l(a.target[1], b.target[1]), l(a.target[2], b.target[2])],
  }
}
const poseClose = (a: FieldView, b: FieldView): boolean => {
  let s = Math.abs(a.fov - b.fov)
  for (let i = 0; i < 3; i++) s += Math.abs(a.position[i] - b.position[i]) + Math.abs(a.target[i] - b.target[i])
  return s < EPS
}

interface Anim {
  raf: number
  to: FieldView
  onDone?: () => void
}
const anims = new WeakMap<EditorStore, Anim>()

/** Tween the saved field pose toward `to`; `onDone` fires when it settles (not
 *  when retargeted away or cancelled). Snaps immediately if there is no current
 *  pose to fly from. */
export function animateFieldTo(store: EditorStore, to: FieldView, onDone?: () => void): void {
  const cur = anims.get(store)
  if (cur) {
    cur.to = to
    cur.onDone = onDone
    return
  }
  const a: Anim = { raf: 0, to, onDone }
  anims.set(store, a)
  store.getState().beginTransaction()
  let last: number | null = null
  const step = (now: number) => {
    if (anims.get(store) !== a) return
    const dt = last == null ? 1 / 60 : Math.max(0.001, (now - last) / 1000)
    last = now
    const s = store.getState()
    const pose = s.doc.background.field3d
    if (!pose || poseClose(pose, a.to)) {
      if (pose) s.setBackground({ field3d: a.to })
      s.commitTransaction()
      anims.delete(store)
      a.onDone?.()
      return
    }
    s.setBackground({ field3d: lerpPose(pose, a.to, 1 - Math.pow(DECAY, dt)) })
    a.raf = requestAnimationFrame(step)
  }
  a.raf = requestAnimationFrame(step)
}

/** Cancel an in-flight tween, committing its undo step; its onDone is skipped. */
export function cancelFieldAnimation(store: EditorStore): void {
  const a = anims.get(store)
  if (!a) return
  cancelAnimationFrame(a.raf)
  anims.delete(store)
  store.getState().commitTransaction()
}

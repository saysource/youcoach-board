// Pinning standing elements (figures + tokens) to the 3D pitch.
//
// A figure lives as a 2D box on the board, but it also stands on a physical spot
// of the grass. We record that spot as `ground = [x, z]` (world metres, y=0 — the
// figure's BOTTOM-CENTER, its "feet"). When the field camera (background.field3d)
// changes, we reproject each pinned element so it keeps its pitch spot: the new
// bottom-center is `projectToBoard(ground, newCamera)`, and its scale follows how
// magnified the pitch is at that spot (ground pixels-per-metre). See
// specs/start.md "Elements on the 3D space".
//
// Framework-free (three.js only) so the store/board just call these pure helpers.

import * as THREE from 'three'
import { type BoardElement, type ElementChange, getLocalBounds } from '@youcoach-board/core'
import { makeCalibratedCamera, type PosedCamera } from './field-camera'
import { projectToBoard, boardToGround } from './arrow3d'

/** Elements that stand on the pitch and carry a ground anchor. */
export type GroundElement = Extract<BoardElement, { type: 'figure' | 'token' }>
export function isGroundElement(el: BoardElement): el is GroundElement {
  return el.type === 'figure' || el.type === 'token'
}

/** The element's local (transform-free) center — the axis the transform scales
 *  about — and its local height. */
function localCenter(el: GroundElement): { cx: number; cy: number; h: number } {
  const lb = getLocalBounds(el)
  return { cx: lb.x + lb.width / 2, cy: lb.y + lb.height / 2, h: lb.height }
}

/** The element's current bottom-center in board units (transform applied). */
export function bottomCenterBoard(el: GroundElement): { x: number; y: number } {
  const { cx, cy, h } = localCenter(el)
  const t = el.transform
  return { x: cx + t.x, y: cy + (h * t.scale) / 2 + t.y }
}

/** Ground pixels-per-metre at (x, z): √(projected area of a 1 m × 1 m ground
 *  quad). Direction-averaged + perspective-correct, and — unlike a vertical
 *  yard-stick — well-defined even in a straight-down top view. */
function groundPPM(cam: THREE.Camera, x: number, z: number): number {
  const o = projectToBoard(new THREE.Vector3(x, 0, z), cam)
  const a = projectToBoard(new THREE.Vector3(x + 1, 0, z), cam)
  const b = projectToBoard(new THREE.Vector3(x, 0, z + 1), cam)
  const area = Math.abs((a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x))
  return Math.sqrt(area) || 1
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** (Re)derive the ground anchor of every standing element from its CURRENT board
 *  bottom-center through `cam`, returning the `update` changes (only where the
 *  anchor actually moved). Run on entering Edit-Background so ordinary
 *  fixed-camera edits (move/duplicate/paste) heal before any reprojection.
 *  A bottom-center that doesn't hit the ground plane (behind/parallel to camera)
 *  is left untouched. */
export function groundSyncChanges(elements: BoardElement[], cfg: PosedCamera): ElementChange[] {
  const cam = makeCalibratedCamera(cfg)
  const changes: ElementChange[] = []
  for (const el of elements) {
    if (!isGroundElement(el)) continue
    const bc = bottomCenterBoard(el)
    const g = boardToGround(bc.x, bc.y, cam)
    if (!g) continue
    const next: [number, number] = [g.x, g.z]
    if (el.ground && Math.abs(el.ground[0] - next[0]) < 1e-4 && Math.abs(el.ground[1] - next[1]) < 1e-4) continue
    changes.push({ id: el.id, before: { ground: el.ground }, after: { ground: next } })
  }
  return changes
}

/** Reproject every pinned standing element from the `before` camera to `after`:
 *  reposition its bottom-center to `projectToBoard(ground, after)` and rescale by
 *  the ground-ppm ratio, as one `update`'s worth of changes. Elements without a
 *  ground anchor (not pinned) are skipped. */
export function reprojectChanges(elements: BoardElement[], before: PosedCamera, after: PosedCamera): ElementChange[] {
  const oldCam = makeCalibratedCamera(before)
  const newCam = makeCalibratedCamera(after)
  const changes: ElementChange[] = []
  for (const el of elements) {
    if (!isGroundElement(el) || !el.ground) continue
    const [gx, gz] = el.ground
    // New scale: how much more/less magnified the pitch is here now.
    const ratio = groundPPM(newCam, gx, gz) / groundPPM(oldCam, gx, gz)
    if (!Number.isFinite(ratio) || ratio <= 0) continue
    const scale = clamp(el.transform.scale * ratio, 0.05, 20)
    // New bottom-center on the board, and the transform that lands it there.
    const bc = projectToBoard(new THREE.Vector3(gx, 0, gz), newCam)
    const { cx, cy, h } = localCenter(el)
    const after2 = { ...el.transform, x: bc.x - cx, y: bc.y - cy - (h * scale) / 2, scale }
    changes.push({ id: el.id, before: { transform: el.transform }, after: { transform: after2 } })
  }
  return changes
}

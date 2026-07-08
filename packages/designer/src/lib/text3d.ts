import type * as THREE from 'three'
import type { TextElement } from '@youcoach-board/core'
import { projectGround, referencePPM } from './field-anchor'

// Geometry for "3D text" — a text element written flat on the pitch surface,
// anchored by its box centre (`ground`), with a user-chosen reading direction
// (`orientation` 0/90/180/270° about the field's X axis, no auto-rotation).

/** Baseline ground direction [x, z] for each orientation about the field X axis. */
export function dirFor(orientation: number): [number, number] {
  switch (((orientation % 360) + 360) % 360) {
    case 90:
      return [0, 1]
    case 180:
      return [-1, 0]
    case 270:
      return [0, -1]
    default:
      return [1, 0]
  }
}

/** The text box's four corners (TL, TR, BR, BL in the box's reading/down frame)
 *  projected to board coordinates through the field camera. Sized from its board
 *  dimensions via the reference scale (so a 3D text is about the size its flat twin
 *  would be at the default view). The perpendicular (text-down) ground direction is
 *  signed so the projected frame is NOT mirrored (determinant > 0) — glyphs read
 *  upright, not backwards — the same trick the tape label uses. */
export function text3dCorners(el: TextElement, cam: THREE.Camera): [number, number][] {
  const [gx, gz] = el.ground!
  const k = 1 / referencePPM() // metres per board unit
  const [dx, dz] = dirFor(el.orientation ?? 0)
  let px = dz
  let pz = -dx // perpendicular (text-down) ground direction
  const o = projectGround(cam, gx, gz)
  const A = projectGround(cam, gx + dx, gz + dz) // image of the reading axis
  const B = projectGround(cam, gx + px, gz + pz) // image of the perpendicular
  if ((A[0] - o[0]) * (B[1] - o[1]) - (A[1] - o[1]) * (B[0] - o[0]) < 0) {
    px = -px
    pz = -pz
  }
  const hw = (el.width / 2) * k
  const hh = (el.height / 2) * k
  const C = (sw: number, sh: number) => projectGround(cam, gx + dx * sw * hw + px * sh * hh, gz + dz * sw * hw + pz * sh * hh)
  return [C(-1, -1), C(1, -1), C(1, 1), C(-1, 1)] // TL, TR, BR, BL
}

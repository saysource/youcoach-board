// A real perspective camera, posed by hand to match a drawn field, as the second
// (and preferred) field-calibration path alongside the homography tool. Unlike a
// homography — which reproduces the drawing on the ground but has no notion of
// "up" — a real camera gives physically-correct height foreshortening + shadows,
// so 3D arrows look right. The trade is that a hand-drawn (not truly perspective)
// field can only be *approximately* matched; in practice that reads better.
//
// World frame matches lib/arrow3d.ts: worldX = pitch length, worldZ = pitch width,
// worldY = height up (metres). The camera is stored as position + look-at target +
// FOV; the calibration tool edits it via intuitive orbit params and converts.

import * as THREE from 'three'
import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'

/** Which canonical pitch a field was calibrated against (sets the metric frame). */
export type PitchType = 'soccer11' | 'futsal' | 'area'

/** The stored, unambiguous camera: metres in the pitch world frame, FOV in degrees.
 *  `ref` records which pitch model those metres belong to. */
export interface CameraConfig {
  ref: PitchType
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

/** The tool's editable form: orbit around a ground target (angles in degrees). */
export interface Orbit {
  targetX: number
  targetZ: number
  distance: number
  azimuth: number
  elevation: number
  fov: number
}

const DEG = Math.PI / 180

/** Build a three.js camera from a stored config (aspect = board 4:3 by default). */
export function makeCalibratedCamera(cfg: CameraConfig, aspect = BOARD_WIDTH / BOARD_HEIGHT): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(cfg.fov, aspect, 0.1, 4000)
  cam.position.set(cfg.position[0], cfg.position[1], cfg.position[2])
  cam.up.set(0, 1, 0)
  cam.lookAt(new THREE.Vector3(cfg.target[0], cfg.target[1], cfg.target[2]))
  cam.updateMatrixWorld()
  return cam
}

/** Orbit params → stored config. Azimuth 0 looks along +Z; +azimuth swings toward
 *  +X; elevation lifts the camera above the ground. */
export function orbitToConfig(o: Orbit, ref: PitchType): CameraConfig {
  const az = o.azimuth * DEG
  const el = o.elevation * DEG
  const ce = Math.cos(el)
  const dir: [number, number, number] = [ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)]
  const target: [number, number, number] = [o.targetX, 0, o.targetZ]
  return {
    ref,
    position: [target[0] + o.distance * dir[0], target[1] + o.distance * dir[1], target[2] + o.distance * dir[2]],
    target,
    fov: o.fov,
  }
}

/** Stored config → orbit params (inverse of orbitToConfig, for seeding the tool). */
export function configToOrbit(c: CameraConfig): Orbit {
  const dx = c.position[0] - c.target[0]
  const dy = c.position[1] - c.target[1]
  const dz = c.position[2] - c.target[2]
  const distance = Math.hypot(dx, dy, dz) || 1
  return {
    targetX: c.target[0],
    targetZ: c.target[2],
    distance,
    azimuth: Math.atan2(dx, dz) / DEG,
    elevation: Math.asin(Math.max(-1, Math.min(1, dy / distance))) / DEG,
    fov: c.fov,
  }
}

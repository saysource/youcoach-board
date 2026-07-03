// The palette "fields" as ZONES: notable spots on the real 3D pitch (centre, box
// centres, corners, goal), each a locked look-at target + a default camera pose.
// Clicking a zone flies the camera to its pose and locks OrbitControls' target to
// the point; the user then orbits freely around it (Edit-Background only).
//
// Poses are authored as intuitive orbit params (azimuth/elevation/distance around
// the target) and converted to a stored {position,target,fov=50} CameraConfig.

import { orbitToConfig, type CameraConfig } from './field-camera'

export interface Zone {
  id: string
  label: string
  /** Locked look-at point (metres, corner-origin world frame). */
  target: [number, number, number]
  /** Default camera pose framing the target. */
  camera: CameraConfig
}

const FOV = 50
// Camera position orbiting a target's ground point (y=0) at az/el/distance.
const orbitPos = (tx: number, tz: number, azimuth: number, elevation: number, distance: number): [number, number, number] =>
  orbitToConfig({ targetX: tx, targetZ: tz, distance, azimuth, elevation, fov: FOV }, 'soccer11').position

// azimuth 0 looks from the +Z touchline; +azimuth swings toward the +X goal.
function zone(id: string, label: string, target: [number, number, number], azimuth: number, elevation: number, distance: number): Zone {
  return { id, label, target, camera: { ref: 'soccer11', position: orbitPos(target[0], target[2], azimuth, elevation, distance), target, fov: FOV } }
}

// Seeded soccer-11 set (pitch 105 × 68; centre 52.5,34). Refine with the tool.
export const FIELD_ZONES: Zone[] = [
  zone('centre', 'Centre', [52.5, 0, 34], 0, 34, 120),
  zone('box-left', 'Left box', [11, 0, 34], 78, 26, 70),
  zone('box-right', 'Right box', [94, 0, 34], -78, 26, 70),
  zone('corner-left', 'Left corner', [3, 0, 6], 45, 30, 55),
  zone('goal-left', 'Left goal', [0, 1.2, 34], 90, 18, 42),
  zone('halfway', 'Halfway', [52.5, 0, 0], 0, 24, 80),
]

export const DEFAULT_ZONE = FIELD_ZONES[0]

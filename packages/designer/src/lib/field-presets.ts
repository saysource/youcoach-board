// The palette "fields": preset camera poses of the real 3D pitch. Each is just a
// viewing angle (fov fixed at 50); selecting one sets background.field3d. Poses are
// authored as intuitive orbit params (azimuth/elevation/distance around the pitch
// centre) and converted to stored position/target/fov.

import { orbitToConfig, type CameraConfig } from './field-camera'
import thumbBroadcast from '../assets/presets/broadcast.png'
import thumbHighWide from '../assets/presets/high-wide.png'
import thumbBehindGoal from '../assets/presets/behind-goal.png'
import thumbCorner from '../assets/presets/corner.png'
import thumbTop from '../assets/presets/top.png'

export interface FieldPreset {
  id: string
  name: string
  /** Pre-rendered thumbnail (bundled asset URL). */
  thumb: string
  camera: CameraConfig
}

const FOV = 50
const CX = 52.5 // pitch centre (105/2)
const CZ = 34 //   (68/2)
// azimuth 0 looks from the +Z touchline; +azimuth swings toward the +X goal.
const pose = (azimuth: number, elevation: number, distance: number): CameraConfig =>
  orbitToConfig({ targetX: CX, targetZ: CZ, distance, azimuth, elevation, fov: FOV }, 'soccer11')

export const FIELD_PRESETS: FieldPreset[] = [
  { id: 'broadcast', name: 'Broadcast', thumb: thumbBroadcast, camera: pose(0, 34, 120) },
  { id: 'high-wide', name: 'High wide', thumb: thumbHighWide, camera: pose(40, 42, 135) },
  { id: 'behind-goal', name: 'Behind goal', thumb: thumbBehindGoal, camera: pose(90, 26, 135) },
  { id: 'corner', name: 'Corner', thumb: thumbCorner, camera: pose(-52, 24, 120) },
  { id: 'top', name: 'Top', thumb: thumbTop, camera: pose(0, 82, 150) },
]

export const DEFAULT_FIELD_PRESET = FIELD_PRESETS[0]

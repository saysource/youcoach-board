// The palette "fields" as ZONES: notable spots on the real 3D pitch, each a locked
// look-at target + a default camera pose. Clicking a zone flies the camera to its
// pose and locks OrbitControls' target to the point; the user then orbits freely
// around it (Edit-Background only). Authored with the Field-zones tool.

import type { CameraConfig } from './field-camera'

export interface Zone {
  id: string
  label: string
  /** Locked look-at point (metres, corner-origin world frame). */
  target: [number, number, number]
  /** Default camera pose framing the target. */
  camera: CameraConfig
}

// Temporary soccer-11 set (authored with the tool). Refine/extend with the tool.
export const FIELD_ZONES: Zone[] = [
  { id: 'centre', label: 'Centre', target: [52.69, 0, 42.31], camera: { ref: 'soccer11', position: [52.1, 90.19, 77.01], target: [52.69, 0, 42.31], fov: 50 } },
  { id: 'middlefield', label: 'Middlefield', target: [44.01, 0, 33.99], camera: { ref: 'soccer11', position: [75.53, 30.55, 34.54], target: [44.01, 0, 33.99], fov: 50 } },
  { id: 'box', label: 'Box', target: [88.97, 0, 34.32], camera: { ref: 'soccer11', position: [75.27, 34.64, 34.26], target: [88.97, 0, 34.32], fov: 50 } },
  { id: 'right-corner', label: 'Right Corner', target: [19.73, 0, 22.05], camera: { ref: 'soccer11', position: [37.89, 31.23, 22.25], target: [19.73, 0, 22.05], fov: 50 } },
  { id: 'goal-area-top-view', label: 'Goal Area (Top view)', target: [6.28, 0, 34.05], camera: { ref: 'soccer11', position: [8.14, 22.07, 34.06], target: [6.28, 0, 34.05], fov: 50 } },
  { id: 'goal-area-perspective-view', label: 'Goal Area (Perspective view)', target: [5.79, 0, 38.36], camera: { ref: 'soccer11', position: [13.15, 6.34, 44.64], target: [5.79, 0, 38.36], fov: 50 } },
  { id: 'corner-left', label: 'Corner Left', target: [87.69, 0, 41.12], camera: { ref: 'soccer11', position: [64.98, 35.24, 52.36], target: [87.69, 0, 41.12], fov: 50 } },
  { id: 'half-field', label: 'Half Field', target: [26.44, 0.23, 34.12], camera: { ref: 'soccer11', position: [27.07, 72.02, 34.12], target: [26.44, 0.23, 34.12], fov: 50 } },
  { id: 'box-top', label: 'Box Top', target: [15.92, 0.32, 33.87], camera: { ref: 'soccer11', position: [16.3, 43.59, 33.87], target: [15.92, 0.32, 33.87], fov: 50 } },
  { id: 'right-corner-top', label: 'Right Corner Top', target: [15.91, 0.32, 21.65], camera: { ref: 'soccer11', position: [16.28, 43.59, 21.65], target: [15.91, 0.32, 21.65], fov: 50 } },
  { id: 'final-defensive-third', label: 'Final/Defensive Third', target: [18.88, 0, 15.14], camera: { ref: 'soccer11', position: [41.53, 23.39, -6.03], target: [18.88, 0, 15.14], fov: 50 } },
  { id: 'left-corner', label: 'Left Corner', target: [19.62, 0, 30.63], camera: { ref: 'soccer11', position: [43.06, 23.75, 22.21], target: [19.62, 0, 30.63], fov: 50 } },
  { id: 'full-top-horizontal', label: 'Full Top Horizontal', target: [52.5, 0, 34], camera: { ref: 'soccer11', position: [52.5, 100, 34.87], target: [52.5, 0, 34], fov: 50 } },
  { id: 'full-top-vertical', label: 'Full Top Vertical', target: [52.5, 0, 34], camera: { ref: 'soccer11', position: [53.68, 134.99, 34], target: [52.5, 0, 34], fov: 50 } },
]

export const DEFAULT_ZONE = FIELD_ZONES[0]

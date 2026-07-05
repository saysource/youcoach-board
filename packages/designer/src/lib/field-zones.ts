// The palette "fields" as ZONES: notable spots on a real 3D field, each a locked
// look-at target + a default camera pose. Clicking a zone flies the camera to its
// pose and locks OrbitControls' target to the point; the user then orbits freely
// around it (Edit-Background only). Authored with the Field-zones tool.
//
// Zones are grouped by FIELD TYPE (soccer 11 / training area / futsal) and, within
// a type, by CATEGORY (a top-down view vs. an angled perspective). A zone may also
// carry BACKGROUND overrides (goals on/off, bands) applied when it's selected — so
// e.g. a training area can offer "with goals" and "without goals" presets.

import type { FieldType, FieldBands, TrainingLayout } from '@youcoach-board/core'
import type { CameraConfig } from './field-camera'

export type ZoneCategory = 'top' | 'perspective'

export interface Zone {
  id: string
  label: string
  fieldType: FieldType
  category: ZoneCategory
  /** Locked look-at point (metres, corner-origin world frame). */
  target: [number, number, number]
  /** Default camera pose framing the target. */
  camera: CameraConfig
  /** Background settings this zone applies on selection (inherited by the doc).
   *  `trainingLayout` (training area) picks the variant: lines + shaded region + goals. */
  background?: Partial<{ showGoals: boolean; bands: FieldBands; trainingLayout: TrainingLayout }>
}

// Camera pitch (degrees above the ground) above which a pose reads as a top view
// rather than an angled perspective.
const TOP_VIEW_PITCH = 70
function pitchCategory(c: CameraConfig): ZoneCategory {
  const dy = c.position[1] - c.target[1]
  const dh = Math.hypot(c.position[0] - c.target[0], c.position[2] - c.target[2])
  return Math.atan2(dy, dh) * (180 / Math.PI) >= TOP_VIEW_PITCH ? 'top' : 'perspective'
}

// Soccer-11 zones (authored with the tool); category derived from the pose.
const SOCCER_ZONES: Omit<Zone, 'category'>[] = [
  { id: 'centre', label: 'Centre', fieldType: 'soccer11', target: [52.69, 0, 42.31], camera: { ref: 'soccer11', position: [52, 90, 80], target: [52, 0, 42], fov: 50 } },
  { id: 'middlefield', label: 'Middlefield', fieldType: 'soccer11', target: [44.01, 0, 33.99], camera: { ref: 'soccer11', position: [75.53, 30.55, 34.54], target: [44.01, 0, 33.99], fov: 50 } },
  { id: 'box', label: 'Box', fieldType: 'soccer11', target: [88.97, 0, 34.32], camera: { ref: 'soccer11', position: [75.27, 34.64, 34.26], target: [88.97, 0, 34.32], fov: 50 } },
  { id: 'right-corner', label: 'Right Corner', fieldType: 'soccer11', target: [19.73, 0, 22.05], camera: { ref: 'soccer11', position: [37.89, 31.23, 22.25], target: [19.73, 0, 22.05], fov: 50 } },
  { id: 'goal-area-top-view', label: 'Goal Area (Top view)', fieldType: 'soccer11', target: [6.28, 0, 34.05], camera: { ref: 'soccer11', position: [8.14, 22.07, 34.06], target: [6.28, 0, 34.05], fov: 50 } },
  { id: 'goal-area-perspective-view', label: 'Goal Area (Perspective)', fieldType: 'soccer11', target: [5.79, 0, 38.36], camera: { ref: 'soccer11', position: [13.15, 6.34, 44.64], target: [5.79, 0, 38.36], fov: 50 } },
  { id: 'corner-left', label: 'Corner Left', fieldType: 'soccer11', target: [87.69, 0, 41.12], camera: { ref: 'soccer11', position: [64.98, 35.24, 52.36], target: [87.69, 0, 41.12], fov: 50 } },
  { id: 'half-field', label: 'Half Field', fieldType: 'soccer11', target: [26.44, 0.23, 34.12], camera: { ref: 'soccer11', position: [27.07, 72.02, 34.12], target: [26.44, 0.23, 34.12], fov: 50 } },
  { id: 'box-top', label: 'Box Top', fieldType: 'soccer11', target: [15.92, 0.32, 33.87], camera: { ref: 'soccer11', position: [16.3, 43.59, 33.87], target: [15.92, 0.32, 33.87], fov: 50 } },
  { id: 'right-corner-top', label: 'Right Corner Top', fieldType: 'soccer11', target: [15.91, 0.32, 21.65], camera: { ref: 'soccer11', position: [16.28, 43.59, 21.65], target: [15.91, 0.32, 21.65], fov: 50 } },
  { id: 'final-defensive-third', label: 'Final/Defensive Third', fieldType: 'soccer11', target: [18.88, 0, 15.14], camera: { ref: 'soccer11', position: [41.53, 23.39, -6.03], target: [18.88, 0, 15.14], fov: 50 } },
  { id: 'left-corner', label: 'Left Corner', fieldType: 'soccer11', target: [19.62, 0, 30.63], camera: { ref: 'soccer11', position: [43.06, 23.75, 22.21], target: [19.62, 0, 30.63], fov: 50 } },
  { id: 'full-top-horizontal', label: 'Full Top Horizontal', fieldType: 'soccer11', target: [52.5, 0, 34], camera: { ref: 'soccer11', position: [52.5, 100, 34.87], target: [52.5, 0, 34], fov: 50 } },
  { id: 'full-top-vertical', label: 'Full Top Vertical', fieldType: 'soccer11', target: [52.5, 0, 34], camera: { ref: 'soccer11', position: [53.68, 134.99, 34], target: [52.5, 0, 34], fov: 50 } },
]

// Training-area variants (40×30, centred on the pitch centre). Each is offered as a
// Top-view and a Perspective pose framing the smaller area; the pose applies the
// variant's markings/shading/goals via `trainingLayout`.
const TRAINING_LAYOUTS: { id: TrainingLayout; label: string; goals: boolean }[] = [
  { id: 'plain', label: 'Plain', goals: false },
  { id: 'ends', label: 'End goals', goals: true },
  { id: 'goals4', label: 'Four goals', goals: true },
  { id: 'band_h', label: 'Middle band', goals: false },
  { id: 'channel_goals', label: 'Channel + goals', goals: true },
  { id: 'channel', label: 'Channel', goals: false },
  { id: 'zones', label: 'Zones', goals: false },
]
const TRAINING_TOP: CameraConfig = { ref: 'soccer11', position: [52.5, 38, 34], target: [52.5, 0, 34], fov: 50 }
// Elevated 3/4 view pulled well back so the whole 40×30 area (and the goal
// variants' goals) fit the canvas with margins — the previous pose sat too low
// and too close, cropping the near edge.
const TRAINING_PERSP: CameraConfig = { ref: 'soccer11', position: [52.5, 32, 4], target: [52.5, 0, 34], fov: 50 }
const TRAINING_ZONES: Zone[] = TRAINING_LAYOUTS.flatMap((l): Zone[] => [
  { id: `training-${l.id}-top`, label: l.label, fieldType: 'training', category: 'top', target: [52.5, 0, 34], camera: TRAINING_TOP, background: { showGoals: l.goals, trainingLayout: l.id } },
  { id: `training-${l.id}-persp`, label: l.label, fieldType: 'training', category: 'perspective', target: [52.5, 0, 34], camera: TRAINING_PERSP, background: { showGoals: l.goals, trainingLayout: l.id } },
])

export const FIELD_ZONES: Zone[] = [
  ...SOCCER_ZONES.map((z) => ({ ...z, category: pitchCategory(z.camera) })),
  ...TRAINING_ZONES,
]

// Field types offered in the drawer, in order. Futsal is defined in the model but
// has no zones/geometry yet, so it's omitted here until its court is provided.
export const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'soccer11', label: 'Soccer 11' },
  { value: 'training', label: 'Training Area' },
]

const CATEGORY_LABELS: Record<ZoneCategory, string> = { top: 'Top View', perspective: 'Perspective' }

/** Zones for a field type. */
export function zonesForField(fieldType: FieldType): Zone[] {
  return FIELD_ZONES.filter((z) => z.fieldType === fieldType)
}

/** The categories present for a field type, in a stable order, with labels. */
export function categoriesForField(fieldType: FieldType): { id: ZoneCategory; label: string }[] {
  const order: ZoneCategory[] = ['top', 'perspective']
  const present = new Set(zonesForField(fieldType).map((z) => z.category))
  return order.filter((c) => present.has(c)).map((c) => ({ id: c, label: CATEGORY_LABELS[c] }))
}

/** The zone to jump to when a field type is first selected. */
export function defaultZoneForField(fieldType: FieldType): Zone | undefined {
  return zonesForField(fieldType)[0]
}

export const DEFAULT_ZONE = FIELD_ZONES[0]

// Canonical pitch reference models for the "Field homography" calibration tool.
// Each model is a set of named notable points in real-world METRES (ground plane,
// height 0) plus the reference lines that connect them (the pitch skeleton), so
// the tool can draw a movable wireframe the user drags onto the drawn field.
//
// Metric frame: x = along the length (0..length), y = across the width (0..width).
// Only soccer-11 is defined for now (FIFA proportions); futsal / small-training
// reuse the same structure later. Values are easy to tweak.

import type { CameraConfig, PitchType } from './field-camera'

export interface RefPoint {
  id: string
  label: string
  /** [x, y] in metres on the ground plane. */
  metric: [number, number]
}

export interface FieldReference {
  id: string
  /** [length, width] in metres. */
  size: [number, number]
  points: RefPoint[]
  /** Reference lines as pairs of point ids. */
  lines: [string, string][]
}

// FIFA soccer-11: 105 × 68 m. Penalty area 16.5 deep × 40.32 wide; goal area
// 5.5 × 18.32; penalty spot 11 m; centre circle r 9.15; goal 7.32 wide.
const L = 105
const W = 68
const cy = W / 2 // 34
const paHalf = 40.32 / 2 // 20.16  → y 13.84 .. 54.16
const gaHalf = 18.32 / 2 // 9.16   → y 24.84 .. 43.16
const goalHalf = 7.32 / 2 // 3.66  → y 30.34 .. 37.66
const R = 9.15

export const SOCCER11: FieldReference = {
  id: 'soccer11',
  size: [L, W],
  points: [
    { id: 'cTL', label: 'Corner ◤', metric: [0, 0] },
    { id: 'cTR', label: 'Corner ◥', metric: [L, 0] },
    { id: 'cBR', label: 'Corner ◢', metric: [L, W] },
    { id: 'cBL', label: 'Corner ◣', metric: [0, W] },
    { id: 'hwT', label: 'Halfway top', metric: [L / 2, 0] },
    { id: 'hwB', label: 'Halfway bottom', metric: [L / 2, W] },
    { id: 'cc', label: 'Centre spot', metric: [L / 2, cy] },
    { id: 'crL', label: 'Circle ◄', metric: [L / 2 - R, cy] },
    { id: 'crR', label: 'Circle ►', metric: [L / 2 + R, cy] },
    { id: 'crT', label: 'Circle ▲', metric: [L / 2, cy - R] },
    { id: 'crB', label: 'Circle ▼', metric: [L / 2, cy + R] },
    { id: 'psL', label: 'Penalty spot (L)', metric: [11, cy] },
    { id: 'psR', label: 'Penalty spot (R)', metric: [L - 11, cy] },
    // Left penalty area (goal line at x=0).
    { id: 'paL_gt', label: 'L pen. area ◤', metric: [0, cy - paHalf] },
    { id: 'paL_it', label: 'L pen. area ◹', metric: [16.5, cy - paHalf] },
    { id: 'paL_ib', label: 'L pen. area ◺', metric: [16.5, cy + paHalf] },
    { id: 'paL_gb', label: 'L pen. area ◣', metric: [0, cy + paHalf] },
    // Right penalty area (goal line at x=L).
    { id: 'paR_gt', label: 'R pen. area ◥', metric: [L, cy - paHalf] },
    { id: 'paR_it', label: 'R pen. area ◸', metric: [L - 16.5, cy - paHalf] },
    { id: 'paR_ib', label: 'R pen. area ◹', metric: [L - 16.5, cy + paHalf] },
    { id: 'paR_gb', label: 'R pen. area ◢', metric: [L, cy + paHalf] },
    // Left goal area.
    { id: 'gaL_gt', label: 'L goal area ◤', metric: [0, cy - gaHalf] },
    { id: 'gaL_it', label: 'L goal area ◹', metric: [5.5, cy - gaHalf] },
    { id: 'gaL_ib', label: 'L goal area ◺', metric: [5.5, cy + gaHalf] },
    { id: 'gaL_gb', label: 'L goal area ◣', metric: [0, cy + gaHalf] },
    // Right goal area.
    { id: 'gaR_gt', label: 'R goal area ◥', metric: [L, cy - gaHalf] },
    { id: 'gaR_it', label: 'R goal area ◸', metric: [L - 5.5, cy - gaHalf] },
    { id: 'gaR_ib', label: 'R goal area ◹', metric: [L - 5.5, cy + gaHalf] },
    { id: 'gaR_gb', label: 'R goal area ◢', metric: [L, cy + gaHalf] },
    // Goal posts (bases, on the ground).
    { id: 'gpL_t', label: 'L post ▲', metric: [0, cy - goalHalf] },
    { id: 'gpL_b', label: 'L post ▼', metric: [0, cy + goalHalf] },
    { id: 'gpR_t', label: 'R post ▲', metric: [L, cy - goalHalf] },
    { id: 'gpR_b', label: 'R post ▼', metric: [L, cy + goalHalf] },
  ],
  lines: [
    // Outer pitch.
    ['cTL', 'cTR'], ['cTR', 'cBR'], ['cBR', 'cBL'], ['cBL', 'cTL'],
    // Halfway.
    ['hwT', 'hwB'],
    // Centre circle (diamond approximation through the four rim points).
    ['crT', 'crR'], ['crR', 'crB'], ['crB', 'crL'], ['crL', 'crT'],
    // Penalty areas (3 sides each; the 4th lies on the goal line).
    ['paL_gt', 'paL_it'], ['paL_it', 'paL_ib'], ['paL_ib', 'paL_gb'],
    ['paR_gt', 'paR_it'], ['paR_it', 'paR_ib'], ['paR_ib', 'paR_gb'],
    // Goal areas.
    ['gaL_gt', 'gaL_it'], ['gaL_it', 'gaL_ib'], ['gaL_ib', 'gaL_gb'],
    ['gaR_gt', 'gaR_it'], ['gaR_it', 'gaR_ib'], ['gaR_ib', 'gaR_gb'],
    // Goal mouths.
    ['gpL_t', 'gpL_b'], ['gpR_t', 'gpR_b'],
  ],
}

// Per-field homographies (metric pitch metres → field-image px), authored with the
// Field-homography tool and pasted here. Keyed by fieldSvg. Later this moves into
// catalog.json; for now a code registry drives the perspective arrows.
export const FIELD_HOMOGRAPHY: Record<string, number[]> = {
  'images/optimized/fields/11/49.svg': [10.72033, -0.033036, 35.370248, 0.037492, 10.552272, 91.378929, 0.000084, -0.000033, 1],
  'images/optimized/fields/11/5.svg': [-6.045488, -15.540906, 938.411057, 0.645298, -2.238379, 153.750796, -0.009101, -0.010827, 1],
}

/** The homography for the currently-loaded field, or null (arrows fall back to the
 *  default fixed camera). */
export function fieldHomography(fieldSvg: string | null | undefined): number[] | null {
  return (fieldSvg && FIELD_HOMOGRAPHY[fieldSvg]) || null
}

// Per-field hand-posed perspective cameras (the "Field camera" tool). When present
// these take precedence over the homography: a real camera renders arrows with
// correct height + shadow. Keyed by fieldSvg; will also move into catalog.json.
export const FIELD_CAMERA: Record<string, CameraConfig> = {
  'images/optimized/fields/11/49.svg': { ref: 'soccer11', position: [52, 152.98, 31.33], target: [52, 0, 34], fov: 31 },
  'images/optimized/fields/11/5.svg': { ref: 'soccer11', position: [90.31, 40.92, 34], target: [36, 0, 34], fov: 32 },
}

/** The posed camera for the currently-loaded field, or null. */
export function fieldCamera(fieldSvg: string | null | undefined): CameraConfig | null {
  return (fieldSvg && FIELD_CAMERA[fieldSvg]) || null
}

// ── Pitch models for the Field-camera wireframe ──────────────────────────────
// Each model is a set of world-ground segments (metric metres; x = length,
// z = width) plus marked spots, drawn through the posed camera. Curves are
// tessellated so they read as smooth ellipses under perspective.

/** A canonical pitch the camera tool poses against; `id` is stored on the camera. */
export interface PitchModel {
  id: PitchType
  label: string
  size: [number, number] // [length x, width z] in metres
  segments: [[number, number], [number, number]][]
  spots: [number, number][]
}

type Seg = [[number, number], [number, number]]
function circle(cxm: number, czm: number, r: number, a0: number, a1: number, steps: number): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    pts.push([cxm + r * Math.cos(a), czm + r * Math.sin(a)])
  }
  return pts
}
function chain(pts: [number, number][], out: Seg[]) {
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]])
}

function soccer11Segments(): Seg[] {
  const segs: Seg[] = []
  chain([[0, 0], [L, 0], [L, W], [0, W], [0, 0]], segs) // touchlines + goal lines
  chain([[L / 2, 0], [L / 2, W]], segs) // halfway
  chain([[0, cy - paHalf], [16.5, cy - paHalf], [16.5, cy + paHalf], [0, cy + paHalf]], segs) // penalty areas
  chain([[L, cy - paHalf], [L - 16.5, cy - paHalf], [L - 16.5, cy + paHalf], [L, cy + paHalf]], segs)
  chain([[0, cy - gaHalf], [5.5, cy - gaHalf], [5.5, cy + gaHalf], [0, cy + gaHalf]], segs) // goal areas
  chain([[L, cy - gaHalf], [L - 5.5, cy - gaHalf], [L - 5.5, cy + gaHalf], [L, cy + gaHalf]], segs)
  chain([[0, cy - goalHalf], [0, cy + goalHalf]], segs) // goal mouths
  chain([[L, cy - goalHalf], [L, cy + goalHalf]], segs)
  chain(circle(L / 2, cy, R, 0, 2 * Math.PI, 48), segs) // centre circle
  const ang = Math.acos((16.5 - 11) / R) // penalty arcs (the "D")
  chain(circle(11, cy, R, -ang, ang, 16), segs)
  chain(circle(L - 11, cy, R, Math.PI - ang, Math.PI + ang, 16), segs)
  return segs
}

// Futsal (FIFA range; the tool default is 42 × 25). Centre circle r 3, goals 3 m,
// penalty mark 6 m + second mark 10 m, and the 6 m goal-area (two quarter arcs
// off the posts joined by a straight line).
function futsalSegments(len: number, wid: number): Seg[] {
  const c = wid / 2
  const gh = 1.5 // goal half-width (3 m goal)
  const r = 6 // goal-area radius
  const segs: Seg[] = []
  chain([[0, 0], [len, 0], [len, wid], [0, wid], [0, 0]], segs) // perimeter
  chain([[len / 2, 0], [len / 2, wid]], segs) // halfway
  chain(circle(len / 2, c, 3, 0, 2 * Math.PI, 40), segs) // centre circle
  chain([[0, c - gh], [0, c + gh]], segs) // goal mouths
  chain([[len, c - gh], [len, c + gh]], segs)
  // Left goal area: quarter arc off each post + connecting line.
  chain(circle(0, c - gh, r, -Math.PI / 2, 0, 10), segs)
  chain(circle(0, c + gh, r, Math.PI / 2, 0, 10), segs)
  chain([[r, c - gh], [r, c + gh]], segs)
  // Right goal area (mirrored).
  chain(circle(len, c - gh, r, -Math.PI / 2, -Math.PI, 10), segs)
  chain(circle(len, c + gh, r, Math.PI / 2, Math.PI, 10), segs)
  chain([[len - r, c - gh], [len - r, c + gh]], segs)
  return segs
}

function futsalSpots(len: number, wid: number): [number, number][] {
  const c = wid / 2
  return [[len / 2, c], [6, c], [len - 6, c], [10, c], [len - 10, c]]
}

// A plain training grid: just the rectangle (its 4 corners are the calibration points).
function rectSegments(len: number, wid: number): Seg[] {
  const segs: Seg[] = []
  chain([[0, 0], [len, 0], [len, wid], [0, wid], [0, 0]], segs)
  return segs
}

const FUTSAL_LEN = 42
const FUTSAL_WID = 25
const AREA_LEN = 40
const AREA_WID = 30

export const PITCH_MODELS: Record<PitchType, PitchModel> = {
  soccer11: { id: 'soccer11', label: 'Soccer 11', size: [L, W], segments: soccer11Segments(), spots: [[L / 2, cy], [11, cy], [L - 11, cy]] },
  futsal: { id: 'futsal', label: 'Futsal', size: [FUTSAL_LEN, FUTSAL_WID], segments: futsalSegments(FUTSAL_LEN, FUTSAL_WID), spots: futsalSpots(FUTSAL_LEN, FUTSAL_WID) },
  area: { id: 'area', label: 'Area (40×30)', size: [AREA_LEN, AREA_WID], segments: rectSegments(AREA_LEN, AREA_WID), spots: [] },
}

export const PITCH_LIST: PitchModel[] = [PITCH_MODELS.soccer11, PITCH_MODELS.futsal, PITCH_MODELS.area]

/** Best-guess pitch type from a field's SVG path (overridable in the tool). */
export function pitchTypeFor(fieldSvg: string | null | undefined): PitchType {
  const s = fieldSvg ?? ''
  if (/futsal/i.test(s)) return 'futsal'
  if (/area|training|grid/i.test(s)) return 'area'
  return 'soccer11'
}

/** Initial board positions for a reference: fit the metric pitch into a centred
 *  box on the board so the user only nudges the seeded wireframe onto the field. */
export function seedLayout(ref: FieldReference, boardW: number, boardH: number): Record<string, [number, number]> {
  const [len, wid] = ref.size
  const margin = 0.1 // 10% board margin
  const availW = boardW * (1 - 2 * margin)
  const availH = boardH * (1 - 2 * margin)
  const s = Math.min(availW / len, availH / wid)
  const offX = (boardW - len * s) / 2
  const offY = (boardH - wid * s) / 2
  const out: Record<string, [number, number]> = {}
  for (const p of ref.points) out[p.id] = [offX + p.metric[0] * s, offY + p.metric[1] * s]
  return out
}

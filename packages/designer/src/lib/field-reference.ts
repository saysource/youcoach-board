// Canonical pitch reference models for the "Field homography" calibration tool.
// Each model is a set of named notable points in real-world METRES (ground plane,
// height 0) plus the reference lines that connect them (the pitch skeleton), so
// the tool can draw a movable wireframe the user drags onto the drawn field.
//
// Metric frame: x = along the length (0..length), y = across the width (0..width).
// Only soccer-11 is defined for now (FIFA proportions); futsal / small-training
// reuse the same structure later. Values are easy to tweak.

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

// Game-system (formation) catalogue, ported from YouCoach app 1. Each formation
// is an ordered list of canonical [x, y] coordinates on a VERTICAL 800×1200
// field — index 0 is the goalkeeper (near y ≈ 1120, the team's own goal), the
// team attacking UP (decreasing y). The point count equals the team size, so a
// system is offered only when it matches the field's team size.

export type FieldPoint = [number, number]

export const FIELD_W = 800
export const FIELD_H = 1200

export const FORMATIONS: Record<string, FieldPoint[]> = {
  // 11 players
  '4-4-2': [[400,1120],[667,1000],[133,1000],[300,800],[300,1000],[500,1000],[667,800],[500,800],[300,660],[133,800],[500,660]],
  '4-2-3-1': [[400,1120],[667,1000],[133,1000],[300,845],[300,1000],[500,1000],[600,775],[500,845],[400,640],[400,775],[200,775]],
  '4-3-3': [[400,1120],[667,1000],[133,1000],[400,875],[300,1000],[500,1000],[667,675],[520,777],[400,660],[272,777],[133,675]],
  '4-3-2-1': [[400,1120],[667,1000],[133,1000],[400,875],[300,1000],[500,1000],[500,745],[600,850],[400,675],[200,850],[300,745]],
  '4-3-1-2': [[400,1120],[667,1000],[133,1000],[400,875],[300,1000],[500,1000],[600,850],[200,850],[300,675],[400,750],[500,675]],
  '4-1-4-1': [[400,1120],[667,1000],[133,1000],[400,875],[300,1000],[500,1000],[667,775],[500,775],[400,675],[300,775],[133,775]],
  '4-4-1-1': [[400,1120],[667,1000],[133,1000],[300,833],[300,1000],[500,1000],[667,833],[500,833],[400,675],[400,790],[133,833]],
  '3-5-2': [[400,1120],[600,1000],[100,800],[400,875],[400,1000],[200,1000],[700,800],[555,800],[300,675],[245,800],[500,675]],
  '3-5-1-1': [[400,1120],[600,1000],[100,800],[400,880],[400,1000],[200,1000],[700,800],[555,800],[400,650],[245,800],[400,765]],
  '3-4-3': [[400,1120],[600,1000],[100,840],[300,840],[400,1000],[200,1000],[700,840],[500,840],[400,650],[133,675],[667,675]],
  '3-4-2-1': [[400,1120],[600,1000],[100,775],[300,844],[400,1000],[200,1000],[700,775],[500,844],[400,675],[275,700],[525,700]],
  '3-4-1-2': [[400,1120],[600,1000],[100,775],[300,844],[400,1000],[200,1000],[667,775],[500,844],[300,660],[400,745],[500,660]],
  '3-3-3-1': [[400,1120],[600,1000],[200,1000],[272,843],[400,1000],[400,885],[667,770],[520,843],[400,655],[400,770],[133,770]],
  '3-3-4': [[400,1120],[600,1000],[200,1000],[250,840],[400,1000],[400,840],[667,675],[550,840],[300,675],[133,675],[500,675]],

  // 5 players (futsal)
  '3-1': [[400,1120],[600,900],[200,900],[400,900],[400,675]],
  '2-2': [[400,1120],[500,900],[300,900],[500,725],[300,725]],
  '1-2-1': [[400,1120],[400,940],[300,810],[500,810],[400,675]],
  '2-1-1': [[400,1120],[500,940],[300,940],[400,810],[400,675]],
}

export type FieldOrientation = 'horizontal' | 'vertical'
export type FormationDir = 'forward' | 'reverse'
export type FieldKind = 'soccer' | 'futsal'
/** How much of the pitch the formation spans: its natural own-half shape, or
 *  stretched across the whole pitch. */
export type Spread = 'half' | 'whole'

export interface FieldSystemConfig {
  orientation: FieldOrientation
  /** Playable area on the 1200×900 board (from the field artwork). */
  rect: { x: number; y: number; w: number; h: number }
  /** Players per team (incl. goalkeeper). */
  teamSize: number
  /** Which field artwork the preview uses. */
  field: FieldKind
}

// Game systems are defined at field level: which fields support them + their
// playable area, orientation and team size. Extendable later to per-field custom
// setups (rondos, N-vs-M situations, …).
export const FIELD_SYSTEMS: Record<string, FieldSystemConfig> = {
  'images/optimized/fields/11/49.svg': { orientation: 'horizontal', rect: { x: 33, y: 90, w: 1120, h: 719 }, teamSize: 11, field: 'soccer' },
  'images/optimized/fields/11/19.svg': { orientation: 'vertical', rect: { x: 327, y: 27, w: 546, h: 851 }, teamSize: 11, field: 'soccer' },
  'images/optimized/fields/futsal/1.svg': { orientation: 'vertical', rect: { x: 409, y: 85, w: 376, h: 732 }, teamSize: 5, field: 'futsal' },
}

export function fieldSystemConfig(fieldSvg: string | null | undefined): FieldSystemConfig | null {
  return (fieldSvg && FIELD_SYSTEMS[fieldSvg]) || null
}

/** Formation codes available on a field (those matching its team size). */
export function availableSystems(cfg: FieldSystemConfig): string[] {
  return Object.keys(FORMATIONS).filter((code) => FORMATIONS[code].length === cfg.teamSize)
}

/** Direction choices for a field, labelled per orientation. */
export function directionOptions(orientation: FieldOrientation): { id: FormationDir; label: string }[] {
  return orientation === 'horizontal'
    ? [{ id: 'forward', label: 'Left → right' }, { id: 'reverse', label: 'Right → left' }]
    : [{ id: 'forward', label: 'Bottom → top' }, { id: 'reverse', label: 'Top → bottom' }]
}

// Margin (in field units) kept beyond the deepest player when stretching to the
// whole pitch, so the forwards don't sit on the far goal line.
const WHOLE_FAR_MARGIN = 90

/** Stretch a formation to span the whole pitch (keeping the GK at the own goal),
 *  or leave its natural own-half shape. */
function spreadPoints(pts: FieldPoint[], spread: Spread): FieldPoint[] {
  if (spread === 'half' || pts.length === 0) return pts
  const ys = pts.map((p) => p[1])
  const own = Math.max(...ys) // own goal (largest y)
  const front = Math.min(...ys) // most advanced player
  const k = (own - WHOLE_FAR_MARGIN) / Math.max(1, own - front)
  return pts.map(([x, y]) => [x, own - (own - y) * k])
}

/** Formation points in the canonical vertical 800×1200 space, with direction and
 *  spread applied (reverse = 180° rotation). Shared by the board placement and
 *  the dialog's field preview so they always match. */
export function formationFieldPoints(code: string, dir: FormationDir, spread: Spread): FieldPoint[] {
  const pts = spreadPoints(FORMATIONS[code] ?? [], spread)
  return pts.map(([fx, fy]) => (dir === 'forward' ? [fx, fy] : [FIELD_W - fx, FIELD_H - fy]))
}

/** Board-coordinate centers for a formation on a field. Vertical fields map the
 *  canonical field directly; horizontal fields rotate it 90° clockwise. */
export function formationCenters(code: string, cfg: FieldSystemConfig, dir: FormationDir, spread: Spread): { x: number; y: number }[] {
  const { rect, orientation } = cfg
  return formationFieldPoints(code, dir, spread).map(([fx, fy]) => {
    const u = fx / FIELD_W // 0..1 across the field width
    const v = fy / FIELD_H // 0..1 along its length
    return orientation === 'vertical'
      ? { x: rect.x + u * rect.w, y: rect.y + v * rect.h }
      : { x: rect.x + (1 - v) * rect.w, y: rect.y + u * rect.h } // 90° CW
  })
}

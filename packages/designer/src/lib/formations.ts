// Game-system (formation) catalogue, ported from YouCoach app 1. Each formation
// is an ordered list of canonical [x, y] coordinates on a VERTICAL 800×1200
// field — index 0 is the goalkeeper (near y ≈ 1120, the team's own goal), the
// team attacking UP (decreasing y). The point count equals the team size, so a
// system is offered only when it matches the field's team size.

import type { FieldType } from '@youcoach-board/core'
import { FIELD_DIMS, FIELD_WORLD_CENTER } from './field3d'

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

/** A game-system-capable field: which team size it fields, its metric ground size
 *  ([length x, width z] in metres, matching the 3D pitch frame) and the artwork the
 *  preview uses. Derived from the current 3D field TYPE (not a 2D SVG path). */
export interface SystemConfig {
  /** Players per team (incl. goalkeeper). */
  teamSize: number
  /** Metric pitch size [length x, width z] in metres — the 3D ground frame. */
  size: [number, number]
  /** World position of the pitch's (0,0) corner. Every 3D field is CENTRED on the
   *  shared pitch centre, so smaller courts (futsal) start away from the origin. */
  origin: [number, number]
  /** Which field artwork the schematic preview uses. */
  kind: FieldKind
}

// Game systems are offered on the 3D pitches that define a regulation team size:
// soccer-11 (105×68 m) and futsal (40×20 m). A training/area field has no fixed
// formations. Size + origin come from the shared FIELD_DIMS (the rendered 3D
// courts, all centred on the pitch centre), so placement never drifts from the
// field the user sees.
export function systemConfigForField(fieldType: FieldType): SystemConfig | null {
  if (fieldType !== 'soccer11' && fieldType !== 'futsal') return null
  const { halfL, halfW } = FIELD_DIMS[fieldType]
  const origin: [number, number] = [FIELD_WORLD_CENTER[0] - halfL, FIELD_WORLD_CENTER[1] - halfW]
  return { teamSize: fieldType === 'futsal' ? 5 : 11, size: [2 * halfL, 2 * halfW], origin, kind: fieldType === 'futsal' ? 'futsal' : 'soccer' }
}

/** Formation codes available on a field (those matching its team size). */
export function availableSystems(cfg: SystemConfig): string[] {
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

/** Metric GROUND spots (x = length, z = width, metres) for a formation on a 3D pitch
 *  of `size` [len, wid]. The canonical schematic (800 wide × 1200 long, GK at the
 *  bottom own goal, attacking UP toward fy=0) maps: long axis → pitch length, short
 *  axis → pitch width. Forward puts the own goal at x=0 (attack toward +x); reverse
 *  is the same shape point-reflected (handled inside formationFieldPoints), so the
 *  ground spots always match the dialog's preview discs exactly. */
export function formationGround(code: string, cfg: SystemConfig, dir: FormationDir, spread: Spread): FieldPoint[] {
  const [len, wid] = cfg.size
  const [ox, oz] = cfg.origin
  return formationFieldPoints(code, dir, spread).map(([fx, fy]) => [ox + len * (1 - fy / FIELD_H), oz + (fx / FIELD_W) * wid])
}

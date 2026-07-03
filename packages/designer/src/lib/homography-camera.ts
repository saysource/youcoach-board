// Turn a field homography (metric pitch metres -> field-image px) into a custom
// projection for the three.js arrow scene, so the arrows' GROUND footprint + shadow
// land exactly on the drawn field, while three.js still shades + shadows them.
//
// The hand-drawn fields aren't exact perspectives, so a real camera can't be
// recovered (see decomp analysis). Instead we build a projective 3×4 (→4×4) matrix
// directly: on the ground plane (worldY=0) it reproduces the homography exactly;
// height (worldY) is lifted along screen-up, foreshortened by the perspective
// denominator w — a tunable heuristic, since ground-only points can't fix vertical.
//
// World frame: worldX = pitch length (metric x), worldZ = pitch width (metric y),
// worldY = height above the pitch (up). All lengths in metres.

import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { multiply3 } from './homography'

export interface Viewport {
  zoom: number
  panX: number
  panY: number
}

/** Height model: kUp scales metres of height → screen-up NDC (bigger = taller);
 *  kZ pushes height toward the camera for correct arrow-over-shadow depth. */
export interface HeightModel {
  kUp: number
  kZ: number
}

export const DEFAULT_HEIGHT: HeightModel = { kUp: 0.02, kZ: 0.02 }

// px-homog → NDC-homog for the visible board sub-rect (matches the SVG viewBox).
function pxToNdc({ zoom, panX, panY }: Viewport): number[] {
  const vw = BOARD_WIDTH / zoom
  const vh = BOARD_HEIGHT / zoom
  return [2 / vw, 0, -(1 + (2 * panX) / vw), 0, -2 / vh, 1 + (2 * panY) / vh, 0, 0, 1]
}

/** The custom projection as a row-major length-16 matrix (clip = P · (X,Y,Z,1)).
 *  Feed to THREE.Matrix4.set(...). */
export function buildProjectionMatrix(H: number[], viewport: Viewport, height: HeightModel = DEFAULT_HEIGHT): number[] {
  const G = multiply3(pxToNdc(viewport), H) // 3×3, columns for (worldX, worldZ, 1)
  const [g00, g01, g02, g10, g11, g12, g20, g21, g22] = G
  const { kUp, kZ } = height
  // Rows: xc, yc, zc, wc — columns: worldX, worldY, worldZ, 1.
  // p_y (worldY column) = (0, -kUp, 0): height → screen-up, /w gives foreshortening.
  // zc: NDC_z = 0.5 − kZ·Y/w  → higher points render nearer (over the ground shadow).
  return [
    g00, 0, g01, g02,
    g10, -kUp, g11, g12,
    0.5 * g20, -kZ, 0.5 * g21, 0.5 * g22,
    g20, 0, g21, g22,
  ]
}

// ── Point mapping (for placement + handle positions) ─────────────────────────
function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('singular homography')
  const D = -(b * i - c * h)
  const E = a * i - c * g
  const F = -(a * h - b * g)
  const Gg = b * f - c * e
  const Hh = -(a * f - c * d)
  const I = a * e - b * d
  return [A / det, D / det, Gg / det, B / det, E / det, Hh / det, C / det, F / det, I / det]
}

/** Ground metric (x, z metres) → board px, via the homography. */
export function metricToBoard(H: number[], x: number, z: number): { x: number; y: number } {
  const w = H[6] * x + H[7] * z + H[8]
  return { x: (H[0] * x + H[1] * z + H[2]) / w, y: (H[3] * x + H[4] * z + H[5]) / w }
}

/** Board px → ground metric (x, z metres), via the inverse homography. */
export function boardToMetric(H: number[], bx: number, by: number): { x: number; z: number } {
  const Hi = invert3(H)
  const w = Hi[6] * bx + Hi[7] * by + Hi[8]
  return { x: (Hi[0] * bx + Hi[1] * by + Hi[2]) / w, z: (Hi[3] * bx + Hi[4] * by + Hi[5]) / w }
}

/** Project a world point (X,Y,Z metres) to FULL-board px (zoom-independent), using
 *  the same height model as the projection — for handle positions. Y=0 equals
 *  metricToBoard(H, X, Z). */
export function worldToBoard(H: number[], X: number, Y: number, Z: number, height: HeightModel = DEFAULT_HEIGHT): { x: number; y: number } {
  const G = multiply3(pxToNdc({ zoom: 1, panX: 0, panY: 0 }), H)
  const [g00, g01, g02, g10, g11, g12, g20, g21, g22] = G
  const cx = g00 * X + g01 * Z + g02
  const cy = g10 * X - height.kUp * Y + g11 * Z + g12
  const cw = g20 * X + g21 * Z + g22
  const ndcX = cx / cw
  const ndcY = cy / cw
  return { x: ((ndcX + 1) / 2) * BOARD_WIDTH, y: ((1 - ndcY) / 2) * BOARD_HEIGHT }
}

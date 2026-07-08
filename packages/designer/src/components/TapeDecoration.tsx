import type * as THREE from 'three'
import type { PolylineElement } from '@youcoach-board/core'
import { boardToGround } from '../lib/arrow3d'
import { projectGround, polyBoardPoints } from '../lib/field-anchor'

// A CAD-style measurement "tape": end ticks + the ground length (metres) labelled
// along the line, all projected onto the field surface so they lean on the pitch
// like ink on paper. The line itself is the polyline (rendered by ElementView).

const TEXT_M = 2.5 // label height in metres
const OFFSET_M = 1.8 // label centre offset above the line (metres)
const TICK_M = 1.0 // half-length of the perpendicular end ticks (metres)

function TapeItem({ el, cam }: { el: PolylineElement; cam: THREE.Camera }) {
  const bpts = polyBoardPoints(el)
  if (bpts.length < 2) return null
  const g1 = boardToGround(bpts[0][0], bpts[0][1], cam)
  const g2 = boardToGround(bpts[bpts.length - 1][0], bpts[bpts.length - 1][1], cam)
  if (!g1 || !g2) return null
  const length = Math.hypot(g2.x - g1.x, g2.z - g1.z)
  const P = (x: number, z: number) => projectGround(cam, x, z)

  // Ground unit vector along the line, and its perpendicular.
  let ux = (g2.x - g1.x) / (length || 1)
  let uz = (g2.z - g1.z) / (length || 1)
  const mx = (g1.x + g2.x) / 2
  const mz = (g1.z + g2.z) / 2
  const om = P(mx, mz)
  // Orient the text left-to-right on screen (flip the along-line direction if it
  // projects leftward, so the label never reads backwards).
  if (P(mx + ux, mz + uz)[0] - om[0] < 0) {
    ux = -ux
    uz = -uz
  }
  // Perpendicular in the ground plane; flip so it projects UPWARD on screen (text
  // sits above the line and reads upright).
  let px = -uz
  let pz = ux
  if (P(mx + px, mz + pz)[1] - om[1] > 0) {
    px = -px
    pz = -pz
  }

  // Label frame: origin a little above the line, local metres → board.
  const ox = mx + px * OFFSET_M
  const oz = mz + pz * OFFSET_M
  const o = P(ox, oz)
  const xa = P(ox + ux, oz + uz) // board delta per 1 m along the line (baseline)
  const ya = P(ox + px, oz + pz) // board delta per 1 m perpendicular
  const ax = xa[0] - o[0]
  const ay = xa[1] - o[1]
  const bx = ya[0] - o[0]
  const by = ya[1] - o[1]
  // The label's local +y (text-down) axis is the perpendicular image, signed so the
  // 2×2 frame is NOT mirrored (determinant > 0). The baseline already points
  // screen-rightward, so a positive determinant guarantees upright, correctly-facing
  // text — without it, perspective can flip the frame's handedness on some line
  // orientations and the label reads "from below" the pitch (upside-down/mirrored).
  const t = ax * by - ay * bx < 0 ? -1 : 1
  const m = `matrix(${ax} ${ay} ${t * bx} ${t * by} ${o[0]} ${o[1]})`

  const stroke = el.stroke
  const tick = (g: { x: number; z: number }) => {
    const a = P(g.x - px * TICK_M, g.z - pz * TICK_M)
    const b = P(g.x + px * TICK_M, g.z + pz * TICK_M)
    return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
  }
  return (
    <g style={{ pointerEvents: 'none' }}>
      {tick(g1)}
      {tick(g2)}
      <text transform={m} fontSize={TEXT_M} textAnchor="middle" dominantBaseline="middle" fill={stroke} stroke="#ffffff" strokeWidth={TEXT_M * 0.09} paintOrder="stroke" style={{ fontWeight: 600 }}>
        {length.toFixed(1)} m
      </text>
    </g>
  )
}

/** Ticks + length labels for every "tape" measurement line, projected onto the
 *  field surface through the given field camera. */
export function TapeDecorations({ elements, cam }: { elements: PolylineElement[]; cam: THREE.Camera }) {
  return (
    <>
      {elements.map((el) => (
        <TapeItem key={el.id} el={el} cam={cam} />
      ))}
    </>
  )
}

import type * as THREE from 'three'
import type { TextElement } from '@youcoach-board/core'
import { TEXT_FONT, TEXT_FONT_WEIGHT, TEXT_FONT_WEIGHT_BOLD, TEXT_LINE_HEIGHT, TEXT_PADDING, textBoxRadius } from '@youcoach-board/core'
import { projectGround, referencePPM } from '../lib/field-anchor'

// "3D text": a text element written flat on the pitch surface (leaning in
// perspective, like ink on paper), anchored by its box centre (`ground`). Unlike a
// tape label it does NOT auto-rotate — the user picks the reading direction with
// `orientation` (0/90/180/270°, about the field's X axis). All the regular text
// properties (colour, background, bold, alignment, multiline) still apply.

/** Baseline ground direction [x, z] for each orientation about the field X axis. */
function dirFor(orientation: number): [number, number] {
  switch (((orientation % 360) + 360) % 360) {
    case 90:
      return [0, 1]
    case 180:
      return [-1, 0]
    case 270:
      return [0, -1]
    default:
      return [1, 0]
  }
}

function Text3DItem({ el, cam }: { el: TextElement; cam: THREE.Camera }) {
  if (!el.ground) return null
  const [gx, gz] = el.ground
  // Metres per board unit: the text's board-unit sizes map to the pitch through the
  // same reference scale used to place tokens/figures, so a 3D text is about the
  // size its flat twin would be at the default view, and scales with the field.
  const k = 1 / referencePPM()
  const [dx, dz] = dirFor(el.orientation ?? 0)
  // Perpendicular ground vector = local +y (text-down before sign fix).
  const px = dz
  const pz = -dx
  const P = (x: number, z: number) => projectGround(cam, x, z)
  const o = P(gx, gz)
  const A = P(gx + dx, gz + dz) // board delta per 1 m along the baseline
  const B = P(gx + px, gz + pz) // board delta per 1 m along the perpendicular
  const ax = A[0] - o[0]
  const ay = A[1] - o[1]
  const bx = B[0] - o[0]
  const by = B[1] - o[1]
  // Sign the text-down axis so the 2×2 frame isn't mirrored (determinant > 0) — the
  // baseline direction stays as the user chose; this only keeps glyphs from reading
  // backwards under perspective (see TapeDecoration for the same trick).
  const s = ax * by - ay * bx < 0 ? -1 : 1
  const m = `matrix(${ax} ${ay} ${s * bx} ${s * by} ${o[0]} ${o[1]})`

  const lines = el.text.length ? el.text.split('\n') : ['']
  const fontM = el.fontSize * k
  const lineH = fontM * TEXT_LINE_HEIGHT
  const halfW = (el.width / 2) * k
  const halfH = (el.height / 2) * k
  const pad = TEXT_PADDING * k
  const anchor = el.align === 'left' ? 'start' : el.align === 'right' ? 'end' : 'middle'
  const tx = el.align === 'left' ? -halfW + pad : el.align === 'right' ? halfW - pad : 0
  const top = -(lines.length * lineH) / 2
  const hasBg = el.bgColor !== 'transparent' && el.bgColor !== ''
  return (
    <g transform={m} style={{ pointerEvents: 'none' }}>
      {hasBg && <rect x={-halfW} y={-halfH} width={halfW * 2} height={halfH * 2} rx={textBoxRadius(el) * k} fill={el.bgColor} />}
      <text textAnchor={anchor} fontSize={fontM} fontWeight={el.bold ? TEXT_FONT_WEIGHT_BOLD : TEXT_FONT_WEIGHT} fill={el.textColor} style={{ fontFamily: TEXT_FONT, whiteSpace: 'pre' }}>
        {lines.map((ln, i) => (
          <tspan key={i} x={tx} y={top + i * lineH + lineH / 2} dominantBaseline="central">
            {ln === '' ? ' ' : ln}
          </tspan>
        ))}
      </text>
    </g>
  )
}

/** Field-surface glyphs for every pitch-pinned 3D text, projected through the field
 *  camera. The (invisible) selection box is still rendered by ElementView. */
export function Text3DDecorations({ elements, cam }: { elements: TextElement[]; cam: THREE.Camera }) {
  return (
    <>
      {elements.map((el) => (
        <Text3DItem key={el.id} el={el} cam={cam} />
      ))}
    </>
  )
}

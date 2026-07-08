import type * as THREE from 'three'
import type { TextElement } from '@youcoach-board/core'
import { TEXT_FONT, TEXT_FONT_WEIGHT, TEXT_FONT_WEIGHT_BOLD, TEXT_LINE_HEIGHT, TEXT_PADDING, textBoxRadius } from '@youcoach-board/core'
import { projectGround, referencePPM } from '../lib/field-anchor'
import { solveHomography } from '../lib/homography'

// "3D text": a text element written flat on the pitch surface, anchored by its box
// centre (`ground`), with a user-chosen reading direction (`orientation`
// 0/90/180/270° about the field's X axis — no auto-rotation). It is drawn as a real
// HTML element carrying a CSS `matrix3d` — the FULL projective (perspective) map of
// its ground rectangle to the screen — so the text foreshortens correctly (parallel
// edges converge), unlike an affine SVG transform. Vector-crisp and still editable.

const SELECT_FRAME = 'var(--color-selection-frame)'

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

/** The text box's four GROUND corners (metres) — TL, TR, BR, BL in the box's own
 *  (reading, down) frame — sized from its board dimensions via the reference scale
 *  (so a 3D text is about the size its flat twin would be at the default view). */
function boardCorners(el: TextElement, cam: THREE.Camera): [number, number][] {
  const [gx, gz] = el.ground!
  const k = 1 / referencePPM() // metres per board unit
  const [dx, dz] = dirFor(el.orientation ?? 0)
  let px = dz
  let pz = -dx // perpendicular (text-down) ground direction
  // Sign the perpendicular so the projected frame is NOT mirrored (determinant > 0)
  // — glyphs read upright, not backwards/upside-down — the tape label's trick.
  const o = projectGround(cam, gx, gz)
  const A = projectGround(cam, gx + dx, gz + dz) // image of the reading axis
  const B = projectGround(cam, gx + px, gz + pz) // image of the perpendicular
  if ((A[0] - o[0]) * (B[1] - o[1]) - (A[1] - o[1]) * (B[0] - o[0]) < 0) {
    px = -px
    pz = -pz
  }
  const hw = (el.width / 2) * k
  const hh = (el.height / 2) * k
  const C = (sw: number, sh: number) => projectGround(cam, gx + dx * sw * hw + px * sh * hh, gz + dz * sw * hw + pz * sh * hh)
  return [C(-1, -1), C(1, -1), C(1, 1), C(-1, 1)] // TL, TR, BR, BL
}

// ── Selection frame: the projected quad (a warped rectangle on the pitch), so the
// frame leans with the text instead of being an axis-aligned box. No handles — a 3D
// text is moved by dragging and sized via the properties slider. ───────────────────
export function Text3DFrames({ elements, cam }: { elements: TextElement[]; cam: THREE.Camera }) {
  return (
    <>
      {elements.map((el) => {
        if (!el.ground) return null
        const pts = boardCorners(el, cam)
        return (
          <polygon
            key={el.id}
            points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
            fill="none"
            stroke={SELECT_FRAME}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )
      })}
    </>
  )
}

// ── The text itself: an HTML element on a `matrix3d` (true perspective). ────────────
function Text3DHtmlItem({ el, cam, boardToPx }: { el: TextElement; cam: THREE.Camera; boardToPx: (b: [number, number]) => { x: number; y: number } }) {
  if (!el.ground) return null
  // Map the div's own box (0,0)-(w,h) onto the projected ground quad. The homography
  // from those 4 correspondences IS the plane→screen perspective; embedded into a
  // CSS matrix3d (a 2D homography lives in the x/y/w rows of a 4×4) the browser
  // renders the text perspective-correct AND crisp (vector, re-rasterised per frame).
  const w = el.width
  const h = el.height
  const src = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  const dst = boardCorners(el, cam).map((b) => boardToPx(b))
  let H: number[]
  try {
    H = solveHomography(src, dst)
  } catch {
    return null
  }
  const m3d = `matrix3d(${H[0]},${H[3]},0,${H[6]}, ${H[1]},${H[4]},0,${H[7]}, 0,0,1,0, ${H[2]},${H[5]},0,${H[8]})`
  const hasBg = el.bgColor !== 'transparent' && el.bgColor !== ''
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: w,
        height: h,
        transform: m3d,
        transformOrigin: '0 0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        boxSizing: 'border-box',
        padding: `0 ${TEXT_PADDING}px`,
        background: hasBg ? el.bgColor : 'transparent',
        borderRadius: textBoxRadius(el),
        fontFamily: TEXT_FONT,
        fontSize: el.fontSize,
        fontWeight: el.bold ? TEXT_FONT_WEIGHT_BOLD : TEXT_FONT_WEIGHT,
        lineHeight: TEXT_LINE_HEIGHT,
        color: el.textColor,
        textAlign: el.align,
        whiteSpace: 'pre',
        overflow: 'visible',
      }}
    >
      {el.text}
    </div>
  )
}

/** The board→overlay-pixel affine (from the SVG's screen CTM, origin-relative). */
export interface BoardCtm {
  a: number
  b: number
  c: number
  d: number
  ex: number
  ey: number
}

/** HTML overlay rendering every pitch-pinned 3D text with a perspective matrix3d.
 *  Positioned over the board (pointer-transparent); the SVG hit-box drives selection
 *  and move. `ctm` maps board coords → this overlay's pixels. */
export function Text3DHtml({ elements, cam, ctm }: { elements: TextElement[]; cam: THREE.Camera; ctm: BoardCtm | null }) {
  if (!ctm) return null
  const boardToPx = (b: [number, number]) => ({ x: ctm.a * b[0] + ctm.c * b[1] + ctm.ex, y: ctm.b * b[0] + ctm.d * b[1] + ctm.ey })
  // z-index 1 keeps the perspective-transformed glyphs ABOVE the WebGL layers (the
  // pitch, 3D arrows/objects are z-index auto) — a 3D-transformed div is composited
  // and would otherwise be painted behind them regardless of DOM order.
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 1 }}>
      {elements.map((el) => (
        <Text3DHtmlItem key={el.id} el={el} cam={cam} boardToPx={boardToPx} />
      ))}
    </div>
  )
}

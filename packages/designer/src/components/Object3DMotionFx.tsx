import type * as THREE from 'three'
import type { BoardElement, Object3DElement } from '@youcoach-board/core'
import { projectGround } from '../lib/field-anchor'
import { isObject3DBall, object3dDefaultColor } from '../lib/objects3d'

// Movement effects for 3D objects during playback (tail / pulse): the meshes
// live in WebGL, so their comet trail and sonar rings are drawn here, in the
// board SVG (under the WebGL canvases), from the transient hints the playback
// attaches. Same visuals as the token version in core's ElementView.

const BALL_R = 0.11
const GENERIC_R = 0.5

function fxColor(el: Object3DElement, key: 'effectTailColor' | 'effectPulseColor'): string {
  return el[key] || (el.fill && el.fill !== 'transparent' ? el.fill : object3dDefaultColor(el.objectId))
}

export function Object3DMotionFx({ elements, cam, objectScale }: { elements: BoardElement[]; cam: THREE.Camera; objectScale: number }) {
  return (
    <g pointerEvents="none">
      {elements.map((el) => {
        if (el.type !== 'object3d' || (el.trail === undefined && el.pulse === undefined && el.pulseRings === undefined)) return null
        // The object's projected board radius: its rendered metric radius seen
        // at its spot on the pitch.
        const rM = (isObject3DBall(el.objectId) ? BALL_R : GENERIC_R) * Math.max(1, (el.useGlobalSize ? 1 : el.size) * objectScale)
        const [cx, cy] = projectGround(cam, el.x, el.z)
        const [ex] = projectGround(cam, el.x + rM, el.z)
        const r = Math.abs(ex - cx) || 8
        const nodes: React.ReactNode[] = []
        if (el.pulseRings) {
          // Ground rings (projected on the pitch) — the ping follows the perspective.
          const pulseColor = fxColor(el, 'effectPulseColor')
          el.pulseRings.forEach((ring, i) => {
            nodes.push(<polygon key={`p${i}`} points={ring.points.map((p) => `${p[0]},${p[1]}`).join(' ')} fill={pulseColor} opacity={ring.opacity} />)
          })
        } else if (el.pulse !== undefined) {
          const pulseColor = fxColor(el, 'effectPulseColor')
          for (const shift of [0, 0.5]) {
            const ph = (el.pulse + shift) % 1
            nodes.push(<circle key={`p${shift}`} cx={cx} cy={cy} r={r * (0.9 + 1.8 * ph)} fill={pulseColor} opacity={(1 - ph) * 0.4} />)
          }
        }
        const pts = el.trail
        if (pts && pts.length >= 2) {
          // Tapered ribbon with quadratic-midpoint smoothed outlines (the
          // token tail construction).
          const left: Array<[number, number]> = []
          const right: Array<[number, number]> = []
          for (let i = 0; i < pts.length; i++) {
            const a = pts[Math.max(0, i - 1)]
            const b = pts[Math.min(pts.length - 1, i + 1)]
            let dx = b[0] - a[0]
            let dy = b[1] - a[1]
            const len = Math.hypot(dx, dy) || 1
            dx /= len
            dy /= len
            const h = r * 0.85 * (i / (pts.length - 1))
            left.push([pts[i][0] - dy * h, pts[i][1] + dx * h])
            right.push([pts[i][0] + dy * h, pts[i][1] - dx * h])
          }
          const smooth = (o: Array<[number, number]>): string => {
            if (o.length < 3) return o.map((q, i) => `${i ? 'L ' : ''}${q[0]},${q[1]}`).join(' ')
            let d = `${o[0][0]},${o[0][1]}`
            for (let i = 1; i < o.length - 1; i++) d += ` Q ${o[i][0]},${o[i][1]} ${(o[i][0] + o[i + 1][0]) / 2},${(o[i][1] + o[i + 1][1]) / 2}`
            return d + ` L ${o[o.length - 1][0]},${o[o.length - 1][1]}`
          }
          nodes.push(<path key="tail" d={`M ${smooth(left)} L ${smooth(right.reverse())} Z`} fill={fxColor(el, 'effectTailColor')} opacity={0.35} />)
        }
        return <g key={el.id}>{nodes}</g>
      })}
    </g>
  )
}

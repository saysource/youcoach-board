// 3D arrow geometry + projection, ported from YouCoach Video Analysis
// (client/src/presentation/figures/arrows3Dutils.ts). The arrow is an extruded
// ribbon following a cubic-bézier arc with a flat arrowhead at the far end,
// living in a fixed 3D scene whose ground plane maps onto the 1200×900 board.
//
// Kept framework-free (three.js only) so the React layer just drives it.

import * as THREE from 'three'
import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'

// ── Fixed camera (matches Layer3D): looks down the pitch from behind/above ──
export const ARROW3D_CAMERA_POS = new THREE.Vector3(0, 10, 50)
export function makeArrow3DCamera(aspect = BOARD_WIDTH / BOARD_HEIGHT): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(10, aspect, 0.1, 100)
  camera.position.copy(ARROW3D_CAMERA_POS)
  camera.lookAt(new THREE.Vector3(0, 0, 0))
  camera.updateMatrixWorld()
  return camera
}

// A shared projection-only camera (aspect = board 4:3) so handle positions can be
// computed without a live renderer.
let projCamera: THREE.PerspectiveCamera | null = null
function projectionCamera(): THREE.PerspectiveCamera {
  if (!projCamera) projCamera = makeArrow3DCamera()
  return projCamera
}

// ── Minimal cubic bézier (get + normal), replacing VA's Bezier dependency ────
interface XY {
  x: number
  y: number
}
class CubicBezier {
  constructor(
    private p0: XY,
    private p1: XY,
    private p2: XY,
    private p3: XY,
  ) {}
  get(t: number): XY {
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    return {
      x: a * this.p0.x + b * this.p1.x + c * this.p2.x + d * this.p3.x,
      y: a * this.p0.y + b * this.p1.y + c * this.p2.y + d * this.p3.y,
    }
  }
  private derivative(t: number): XY {
    const u = 1 - t
    const a = 3 * u * u
    const b = 6 * u * t
    const c = 3 * t * t
    return {
      x: a * (this.p1.x - this.p0.x) + b * (this.p2.x - this.p1.x) + c * (this.p3.x - this.p2.x),
      y: a * (this.p1.y - this.p0.y) + b * (this.p2.y - this.p1.y) + c * (this.p3.y - this.p2.y),
    }
  }
  normal(t: number): XY {
    const d = this.derivative(t)
    const len = Math.hypot(d.x, d.y) || 1
    return { x: -d.y / len, y: d.x / len }
  }
}

interface BezierPoint {
  x: number
  y: number
  t?: number
}

function scaleFn(domain: number[], range: number[]) {
  return (x: number) => {
    if (domain[0] === domain[1]) return range[0]
    const p = (x - domain[0]) / (domain[1] - domain[0])
    return range[0] + (range[1] - range[0]) * p
  }
}

function createFace(topLeft: THREE.Vector3, topRight: THREE.Vector3, bottomRight: THREE.Vector3, bottomLeft: THREE.Vector3) {
  return [
    new THREE.Vector3(topLeft.x, topLeft.y, topLeft.z),
    new THREE.Vector3(bottomLeft.x, bottomLeft.y, bottomLeft.z),
    new THREE.Vector3(topRight.x, topRight.y, topRight.z),
    new THREE.Vector3(bottomLeft.x, bottomLeft.y, bottomLeft.z),
    new THREE.Vector3(bottomRight.x, bottomRight.y, bottomRight.z),
    new THREE.Vector3(topRight.x, topRight.y, topRight.z),
  ]
}

function searchIntersectionImpl(curve: CubicBezier, arrowPosition: BezierPoint, arrowLength: number, start: number, to: number, step: number) {
  const v1 = new THREE.Vector3(0, 0, 0)
  const center = new THREE.Vector3(arrowPosition.x, arrowPosition.y, 0)
  let currentP: XY = { x: arrowPosition.x, y: arrowPosition.y }
  let kc = Math.min(1, start + step)
  for (; kc >= Math.max(0, to - step); kc -= step) {
    currentP = curve.get(kc)
    v1.x = currentP.x
    v1.y = currentP.y
    if (v1.distanceTo(center) <= arrowLength) return { pca: currentP, t: kc, t2: Math.min(1, kc + step) }
  }
  return { pca: currentP, t: 0, t2: kc }
}

function searchIntersection(curve: CubicBezier, arrowPosition: BezierPoint, arrowLength: number): XY | null {
  let res = searchIntersectionImpl(curve, arrowPosition, arrowLength, 1, 0, 0.01)
  for (let k = 0.01; k > 1e-13; k /= 10) {
    if (res == null) return null
    res = searchIntersectionImpl(curve, arrowPosition, arrowLength, res.t2, res.t, k)
  }
  return res.pca
}

/** Build the arrow BufferGeometry. Param order matches Layer3D's call:
 *  (stickWidth, tipWidth, thickness, tipLength, splineWidth, splineHeight, splineLength). */
export function createArrowGeometry(
  curveWide: number,
  tipWide: number,
  curveThickness: number,
  tipLength: number,
  width: number,
  height: number,
  completness: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()

  const p1 = { x: 0, y: 0 }
  const p2 = { x: width, y: 0 }
  const h1 = { x: width / 3, y: height }
  const h2 = { x: (2 * width) / 3, y: height }

  const curve = new CubicBezier(p1, h1, h2, p2)
  const points: (THREE.Vector3 | THREE.Vector3[])[] = []
  const step = 0.01

  let arrowStarted = 0
  let arrowBackCreated = false
  let previousVertexes: THREE.Vector3[] = []

  let pca: XY = { x: tipLength, y: 0 }
  const arrowPosition = curve.get(1 - completness) as BezierPoint

  const found = searchIntersection(curve, arrowPosition, tipLength)
  pca = found ?? { x: tipLength, y: 0 }

  tipWide = Math.max(tipWide, 0)
  const s = scaleFn([arrowPosition.x, pca.x], [-curveWide / 2, tipWide])

  let pointClosure: THREE.Vector3[] = []

  for (let t = 1; t >= 1 - completness; t -= step) {
    let p = curve.get(t)
    let dx = 0
    let dy = 0
    if (height) {
      const nv = curve.normal(t)
      dx = (curveThickness / 2) * nv.x
      dy = (curveThickness / 2) * nv.y
    } else {
      dy = curveThickness / 2
    }

    if (p.x <= pca.x) {
      if (!arrowBackCreated) p = pca
      arrowStarted = s(p.x)
    }

    if (previousVertexes.length === 0) {
      previousVertexes = [
        new THREE.Vector3(-curveWide / 2 - arrowStarted, p.y + dy, p.x + dx),
        new THREE.Vector3(curveWide / 2 + arrowStarted, p.y + dy, p.x + dx),
        new THREE.Vector3(curveWide / 2 + arrowStarted, p.y - dy, p.x - dx),
        new THREE.Vector3(-curveWide / 2 - arrowStarted, p.y - dy, p.x - dx),
      ]
      points.push(createFace(previousVertexes[0], previousVertexes[1], previousVertexes[2], previousVertexes[3]))
    } else {
      const nvx = [
        new THREE.Vector3(-curveWide / 2 - arrowStarted, p.y + dy, p.x + dx),
        new THREE.Vector3(curveWide / 2 + arrowStarted, p.y + dy, p.x + dx),
        new THREE.Vector3(curveWide / 2 + arrowStarted, p.y - dy, p.x - dx),
        new THREE.Vector3(-curveWide / 2 - arrowStarted, p.y - dy, p.x - dx),
      ]
      let pvx = previousVertexes

      if (!arrowBackCreated && p.x <= pca.x) {
        arrowBackCreated = true
        const nvx2 = [
          new THREE.Vector3(-curveWide / 2, p.y + dy, p.x + dx),
          new THREE.Vector3(curveWide / 2, p.y + dy, p.x + dx),
          new THREE.Vector3(curveWide / 2, p.y - dy, p.x - dx),
          new THREE.Vector3(-curveWide / 2, p.y - dy, p.x - dx),
        ]
        points.push(createFace(nvx2[0], nvx2[1], pvx[1], pvx[0]))
        points.push(createFace(nvx2[3], pvx[3], pvx[2], nvx2[2]))
        points.push(createFace(nvx2[1], nvx2[2], pvx[2], pvx[1]))
        points.push(createFace(nvx2[0], pvx[0], pvx[3], nvx2[3]))
        pvx = nvx2

        points.push(
          createFace(
            new THREE.Vector3(-curveWide / 2, p.y + dy, p.x + dx),
            new THREE.Vector3(-curveWide / 2, p.y - dy, p.x - dx),
            new THREE.Vector3(-(curveWide / 2 + arrowStarted), p.y - dy, p.x - dx),
            new THREE.Vector3(-(curveWide / 2 + arrowStarted), p.y + dy, p.x + dx),
          ),
        )
        points.push(
          createFace(
            new THREE.Vector3(curveWide / 2 + arrowStarted, p.y + dy, p.x + dx),
            new THREE.Vector3(curveWide / 2 + arrowStarted, p.y - dy, p.x - dx),
            new THREE.Vector3(curveWide / 2, p.y - dy, p.x - dx),
            new THREE.Vector3(curveWide / 2, p.y + dy, p.x + dx),
          ),
        )
      } else {
        points.push(createFace(nvx[0], nvx[1], pvx[1], pvx[0]))
        points.push(createFace(nvx[3], pvx[3], pvx[2], nvx[2]))
        points.push(createFace(nvx[1], nvx[2], pvx[2], pvx[1]))
        points.push(createFace(nvx[0], pvx[0], pvx[3], nvx[3]))
      }
      previousVertexes = nvx
    }

    pointClosure = [new THREE.Vector3(0, dy + arrowPosition.y, arrowPosition.x + dx), new THREE.Vector3(0, -dy + arrowPosition.y, arrowPosition.x - dx)]
  }

  if (pointClosure.length > 0) {
    const pointBack = previousVertexes
    points.push(pointClosure[0], pointBack[0], pointBack[1])
    points.push(pointClosure[1], pointBack[2], pointBack[3])
    points.push(createFace(pointClosure[0], pointBack[0], pointBack[3], pointClosure[1]))
    points.push(createFace(pointClosure[0], pointClosure[1], pointBack[2], pointBack[1]))
  }

  geometry.setFromPoints(points.flat(10) as THREE.Vector3[])
  geometry.computeVertexNormals()
  return geometry
}

// ── Projection: 3D world → board (0..1200, 0..900) ──────────────────────────
function worldToBoard(point: THREE.Vector3, camera: THREE.Camera): { x: number; y: number } {
  const v = point.clone().project(camera)
  return { x: ((v.x + 1) * BOARD_WIDTH) / 2, y: (-(v.y - 1) * BOARD_HEIGHT) / 2 }
}

/** The arrow's local handle points (tail, head, apex) in world space, given its
 *  ground placement. */
export function arrow3DWorldHandles(x: number, y: number, z: number, splineWidth: number, splineHeight: number): THREE.Vector3[] {
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  g.rotation.set(0, y, 0)
  g.updateMatrixWorld(true)
  const p1 = g.localToWorld(new THREE.Vector3(0, 0, 0))
  const p2 = g.localToWorld(new THREE.Vector3(0, 0, -splineWidth))
  const p3 = g.localToWorld(new THREE.Vector3(0, splineHeight, -splineWidth / 2))
  return [p1, p2, p3]
}

/** The three handle positions (tail, head, height-apex) in board coordinates. */
export function arrow3DHandlePositions(x: number, y: number, z: number, splineWidth: number, splineHeight: number): { x: number; y: number }[] {
  const camera = projectionCamera()
  return arrow3DWorldHandles(x, y, z, splineWidth, splineHeight).map((p) => worldToBoard(p, camera))
}

/** Project a ground point (world x, z at y=0) to board coordinates. */
export function groundToBoard(x: number, z: number): { x: number; y: number } {
  return worldToBoard(new THREE.Vector3(x, 0, z), projectionCamera())
}

/** Raycast a board point onto the ground plane (y=0); returns world {x, z}. */
export function boardToGround(bx: number, by: number, camera: THREE.Camera): { x: number; z: number } | null {
  const ndc = new THREE.Vector2((bx / BOARD_WIDTH) * 2 - 1, -(by / BOARD_HEIGHT) * 2 + 1)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(ndc, camera)
  const hit = new THREE.Vector3()
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  if (!ray.ray.intersectPlane(plane, hit)) return null
  return { x: hit.x, z: hit.z }
}

/** New spline height when dragging the apex handle to board point (bx,by), given
 *  the apex's fixed world z. Mirrors Layer3D's unproject-at-depth trick. */
export function boardToHeight(bx: number, by: number, apexWorldZ: number, camera: THREE.Camera): number {
  const ndc = new THREE.Vector3((bx / BOARD_WIDTH) * 2 - 1, -(by / BOARD_HEIGHT) * 2 + 1, 0.5)
  ndc.unproject(camera)
  ndc.sub(camera.position).normalize()
  const distance = (apexWorldZ - camera.position.z) / ndc.z
  const pos = camera.position.clone().add(ndc.multiplyScalar(distance))
  return Math.max(0, pos.y)
}

// Parametric, toon-shaded soccer goal — shared by the field pitch (field3d.ts)
// and the placeable 3D-object library (objects3d.ts). Framework-free (three only).
//
// Canonical frame: centered in X and Z, base on the ground (y = 0), the MOUTH
// (opening) facing +X and the net at the back (−X). Callers translate/rotate it
// into place. Two back styles:
//   'box'    — vertical back posts + top depth rails (a rectangular box). The
//              regulation stadium goal used on the pitch.
//   'angled' — the back slopes: struts run from each front-top corner down to a
//              ground bar behind, with a sloped back net + triangular sides.
//   'futsal' — the indoor/handball goal: red/white striped front frame, and a
//              THINNER back structure whose side struts are rounded tubes curving
//              from the top corners down to a shallow ground frame.

import * as THREE from 'three'
import { toonGradientMap } from './toon'

export type GoalStyle = 'box' | 'angled' | 'futsal'

export interface GoalOpts {
  width: number // mouth width  (Z span, metres)
  height: number // mouth height (Y, metres)
  depth: number // how far the frame extends back (X, metres)
  style: GoalStyle
  /** Front-post radius; back parts are a bit thinner. Defaults to ~0.025·height. */
  postR?: number
}

// A repeating white net grid. Cell ~ constant metric size (UVs are computed
// per-metre by the callers) so nets read the same at any goal size. Solid white
// cords on transparent gaps — bright and clearly visible.
function netTexture(): THREE.Texture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext('2d')!
  g.clearRect(0, 0, 64, 64)
  g.strokeStyle = '#ffffff'
  g.lineWidth = 14 // thick net cords
  g.strokeRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

const NET_CELL = 0.28 // metres per net cell

const STRIPE_LEN = 0.25 // metres per red/white band on the futsal frame
const STRIPE_RED = 0xd13a2c

export function buildGoal(opts: GoalOpts): THREE.Group {
  const { width: W, height: H, depth: D, style } = opts
  const striped = style === 'futsal'
  // Futsal frame: regulation 8 cm SQUARE bars (postR = half-side); the caller's
  // postR is a pipe radius sized for the bigger goals, so override it here.
  const postR = striped ? 0.04 : (opts.postR ?? Math.max(0.04, H * 0.025))
  const br = postR * (striped ? 0.75 : 0.72) // back parts thinner
  const O = postR / 3 // ink-outline thickness

  const frameMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradientMap() })
  const redMat = new THREE.MeshToonMaterial({ color: STRIPE_RED, gradientMap: toonGradientMap() })
  const inkMat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide })
  // Unlit pure-white net so it stays bright (not darkened by shading); alphaTest
  // keeps the cords crisp and opaque with see-through gaps.
  const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: netTexture(), side: THREE.DoubleSide, alphaTest: 0.45 })

  const goal = new THREE.Group()
  const hw = W / 2
  const fx = D / 2 // front (mouth) plane
  const bx = -D / 2 // back plane
  const up = new THREE.Vector3(0, 1, 0)

  // A cylinder bar between two points, with its black outline shell, grouped so
  // both move together. Handles posts, crossbars, rails and diagonal struts.
  const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 14) => {
    const dir = new THREE.Vector3().subVectors(b, a)
    const len = dir.length()
    const g = new THREE.Group()
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), frameMat)
    m.castShadow = true
    g.add(m, new THREE.Mesh(new THREE.CylinderGeometry(r + O, r + O, len + 2 * O, seg), inkMat))
    g.position.copy(a).add(b).multiplyScalar(0.5)
    g.quaternion.setFromUnitVectors(up, dir.normalize())
    goal.add(g)
    return g
  }
  // A red/white banded SQUARE bar (the futsal frame: posts and crossbar are
  // square-section bars, not pipes): alternating toon box segments under ONE
  // outline shell, so it reads as a single striped bar. `r` is the half-side.
  const stripedBar = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const dir = new THREE.Vector3().subVectors(b, a)
    const len = dir.length()
    const s = 2 * r // square side
    const n = Math.max(3, Math.round(len / STRIPE_LEN))
    const g = new THREE.Group()
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, len / n, s), i % 2 ? frameMat : redMat)
      m.position.y = -len / 2 + ((i + 0.5) * len) / n
      m.castShadow = true
      g.add(m)
    }
    g.add(new THREE.Mesh(new THREE.BoxGeometry(s + 2 * O, len + 2 * O, s + 2 * O), inkMat))
    g.position.copy(a).add(b).multiplyScalar(0.5)
    g.quaternion.setFromUnitVectors(up, dir.normalize())
    goal.add(g)
    return g
  }
  // The futsal back strut, following assets/futsal_goal_side.svg: from the top of
  // the post it runs HORIZONTALLY back about half the depth, rounds an elbow, then
  // slants straight down to the ground at the full depth.
  const bentStrut = (z: number, r: number) => {
    const y0 = H - 0.03 // just under the crossbar top
    const runX = fx - 0.45 * D // where the horizontal run ends (elbow starts)
    const K = v(fx - 0.72 * D, y0, z) // the elbow corner the curve rounds
    const E = v(bx, 0.03, z) // ground contact at the back
    const M = K.clone().lerp(E, 0.3) // elbow blends into the straight slant here
    const path = new THREE.CurvePath<THREE.Vector3>()
    path.add(new THREE.LineCurve3(v(fx, y0, z), v(runX, y0, z)))
    path.add(new THREE.QuadraticBezierCurve3(v(runX, y0, z), K, M))
    path.add(new THREE.LineCurve3(M, E))
    const m = new THREE.Mesh(new THREE.TubeGeometry(path, 40, r, 10), frameMat)
    m.castShadow = true
    goal.add(m, new THREE.Mesh(new THREE.TubeGeometry(path, 40, r + O, 10), inkMat))
  }
  const joint = (p: THREE.Vector3, r: number) => {
    const g = new THREE.Group()
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), frameMat)
    m.castShadow = true
    g.add(m, new THREE.Mesh(new THREE.SphereGeometry(r + O, 14, 10), inkMat))
    g.position.copy(p)
    goal.add(g)
  }
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

  // A flat net polygon (3–4 coplanar corners), triangulated as a fan, with UVs
  // scaled to NET_CELL so the grid density is size-independent.
  const net = (pts: THREE.Vector3[]) => {
    const o = pts[0]
    const uAxis = new THREE.Vector3().subVectors(pts[1], o).normalize()
    const nrm = new THREE.Vector3().subVectors(pts[1], o).cross(new THREE.Vector3().subVectors(pts[pts.length - 1], o)).normalize()
    const vAxis = new THREE.Vector3().crossVectors(nrm, uAxis).normalize()
    const pos: number[] = []
    const uv: number[] = []
    const push = (p: THREE.Vector3) => {
      pos.push(p.x, p.y, p.z)
      const d = new THREE.Vector3().subVectors(p, o)
      uv.push(d.dot(uAxis) / NET_CELL, d.dot(vAxis) / NET_CELL)
    }
    for (let i = 1; i < pts.length - 1; i++) {
      push(pts[0])
      push(pts[i])
      push(pts[i + 1])
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2))
    geo.computeVertexNormals()
    goal.add(new THREE.Mesh(geo, netMat))
  }

  // ── Front frame + ground base (shared by all styles) ─────────────────────
  const frontBar = striped ? stripedBar : bar
  frontBar(v(fx, 0, -hw), v(fx, H, -hw), postR) // left post
  frontBar(v(fx, 0, hw), v(fx, H, hw), postR) // right post
  frontBar(v(fx, H, -hw), v(fx, H, hw), postR) // crossbar
  bar(v(fx, 0, -hw), v(bx, 0, -hw), br) // lateral base pipes (front → back, on the ground)
  bar(v(fx, 0, hw), v(bx, 0, hw), br)
  for (const z of [-hw, hw]) joint(v(fx, 0, z), postR) // front-bottom corners

  if (style === 'box') {
    bar(v(bx, 0, -hw), v(bx, H, -hw), br) // back posts
    bar(v(bx, 0, hw), v(bx, H, hw), br)
    bar(v(bx, H, -hw), v(bx, H, hw), br) // back bar
    bar(v(bx, 0, -hw), v(bx, 0, hw), br) // back base pipe (completes the ground frame)
    bar(v(fx, H, -hw), v(bx, H, -hw), br) // top rails
    bar(v(fx, H, hw), v(bx, H, hw), br)
    for (const z of [-hw, hw]) {
      joint(v(fx, H, z), postR)
      joint(v(bx, H, z), br)
    }
    // Net: back, top, two sides.
    net([v(bx, 0, -hw), v(bx, 0, hw), v(bx, H, hw), v(bx, H, -hw)])
    net([v(fx, H, -hw), v(fx, H, hw), v(bx, H, hw), v(bx, H, -hw)])
    for (const z of [-hw, hw]) net([v(fx, 0, z), v(fx, H, z), v(bx, H, z), v(bx, 0, z)])
  } else if (style === 'futsal') {
    for (const z of [-hw, hw]) bentStrut(z, br) // horizontal-run + elbow + slant struts
    bar(v(bx, 0, -hw), v(bx, 0, hw), br) // ground bar at the back
    // Square corner blocks where posts meet the crossbar (no spheres on square bars).
    for (const z of [-hw, hw]) {
      const s = 2 * postR
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), redMat)
      c.position.set(fx, H, z)
      c.castShadow = true
      goal.add(c, ((): THREE.Mesh => { const o = new THREE.Mesh(new THREE.BoxGeometry(s + 2 * O, s + 2 * O, s + 2 * O), inkMat); o.position.set(fx, H, z); return o })())
    }
    // Net profile from assets/futsal_goal_side.svg (the red path): a flat TOP RUN
    // from the crossbar, a short drop over the elbow, then the long slant down to
    // the back of the ground frame; the sides close the whole profile.
    const p1x = fx - 0.545 * D // end of the top run
    const p2x = fx - 0.775 * D // past the elbow…
    const p2y = 0.816 * H // …where the long slant starts
    net([v(fx, H, -hw), v(fx, H, hw), v(p1x, H, hw), v(p1x, H, -hw)]) // top run
    net([v(p1x, H, -hw), v(p1x, H, hw), v(p2x, p2y, hw), v(p2x, p2y, -hw)]) // elbow band
    net([v(p2x, p2y, -hw), v(p2x, p2y, hw), v(bx, 0, hw), v(bx, 0, -hw)]) // back slant
    for (const z of [-hw, hw]) net([v(fx, 0, z), v(fx, H, z), v(p1x, H, z), v(p2x, p2y, z), v(bx, 0, z)]) // sides
  } else {
    bar(v(fx, H, -hw), v(bx, 0, -hw), br) // sloped back struts
    bar(v(fx, H, hw), v(bx, 0, hw), br)
    bar(v(bx, 0, -hw), v(bx, 0, hw), br) // ground bar at the back
    for (const z of [-hw, hw]) joint(v(fx, H, z), postR)
    // Net: sloped back + two triangular sides.
    net([v(fx, H, -hw), v(fx, H, hw), v(bx, 0, hw), v(bx, 0, -hw)])
    for (const z of [-hw, hw]) net([v(fx, 0, z), v(fx, H, z), v(bx, 0, z)])
  }

  return goal
}

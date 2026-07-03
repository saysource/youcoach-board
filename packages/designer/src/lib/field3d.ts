// A real, procedural 3D soccer pitch (ground + line texture + goals + optional
// corner flags), ported from the reference soccer-field.html. Framework-free
// (three.js only) so the React layer just mounts it.
//
// World frame matches lib/arrow3d.ts and the field cameras: x = pitch length
// (0..105), z = pitch width (0..68), y = up (metres). The reference builds the
// pitch centred on the origin; we translate the whole group to (52.5, 0, 34) so
// the pitch spans 0..105 × 0..68 — the same frame arrows + camera poses use.

import * as THREE from 'three'

// Pitch dims (metres, ~FIFA), matching field-reference.ts.
const L = 105
const W = 68
const HALF_L = L / 2 // 52.5
const HALF_W = W / 2 // 34
const GOAL_W = 7.32
const GOAL_H = 2.44
const GOAL_D = 2.0
const POST_R = 0.06
const PLANE_L = 125 // a green run-off surround
const PLANE_W = 85

// One shared sun so the field and the arrow scene cast agreeing shadows.
export const SUN_POSITION = new THREE.Vector3(120, 165, 70)
export const SUN_TARGET = new THREE.Vector3(HALF_L, 0, HALF_W)

/* ---- field line texture (procedural canvas, centred on the pitch) ---------- */
function makeFieldTexture(): THREE.Texture {
  const PPM = 16
  const cv = document.createElement('canvas')
  cv.width = PLANE_L * PPM
  cv.height = PLANE_W * PPM
  const g = cv.getContext('2d')!
  const cX = cv.width / 2
  const cY = cv.height / 2
  const P = (x: number, z: number): [number, number] => [cX + x * PPM, cY + z * PPM]

  g.fillStyle = '#2e7d32'
  g.fillRect(0, 0, cv.width, cv.height)

  // Mowing stripes inside the pitch.
  const bands = 12
  const bw = L / bands
  for (let b = 0; b < bands; b++) {
    const x0 = -HALF_L + b * bw
    const [px0, pz0] = P(x0, -HALF_W)
    const [px1, pz1] = P(x0 + bw, HALF_W)
    g.fillStyle = b % 2 === 0 ? '#4aa84f' : '#3f9c46'
    g.fillRect(px0, pz0, px1 - px0, pz1 - pz0)
  }

  g.strokeStyle = '#ffffff'
  g.fillStyle = '#ffffff'
  g.lineWidth = 0.2 * PPM
  g.lineJoin = 'round'
  const rect = (x0: number, z0: number, x1: number, z1: number) => {
    const [ax, ay] = P(x0, z0)
    const [bx, by] = P(x1, z1)
    g.strokeRect(ax, ay, bx - ax, by - ay)
  }
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    g.beginPath()
    const [ax, ay] = P(x0, z0)
    const [bx, by] = P(x1, z1)
    g.moveTo(ax, ay)
    g.lineTo(bx, by)
    g.stroke()
  }
  const circle = (x: number, z: number, r: number, s = 0, e = Math.PI * 2) => {
    g.beginPath()
    const [px, pz] = P(x, z)
    g.arc(px, pz, r * PPM, s, e)
    g.stroke()
  }
  const dot = (x: number, z: number, r: number) => {
    g.beginPath()
    const [px, pz] = P(x, z)
    g.arc(px, pz, r * PPM, 0, Math.PI * 2)
    g.fill()
  }

  rect(-HALF_L, -HALF_W, HALF_L, HALF_W) // boundary
  line(0, -HALF_W, 0, HALF_W) // halfway
  circle(0, 0, 9.15) // centre circle
  dot(0, 0, 0.18)
  const penAngle = Math.acos(5.5 / 9.15)
  for (const s of [-1, 1]) {
    const goalLine = s * HALF_L
    rect(goalLine, -20.16, goalLine - s * 16.5, 20.16) // penalty area
    rect(goalLine, -9.16, goalLine - s * 5.5, 9.16) // goal area
    const spotX = goalLine - s * 11
    dot(spotX, 0, 0.18)
    if (s < 0) circle(spotX, 0, 9.15, -penAngle, penAngle)
    else circle(spotX, 0, 9.15, Math.PI - penAngle, Math.PI + penAngle)
  }
  circle(-HALF_L, -HALF_W, 1, 0, Math.PI / 2) // corner arcs
  circle(HALF_L, -HALF_W, 1, Math.PI / 2, Math.PI)
  circle(-HALF_L, HALF_W, 1, -Math.PI / 2, 0)
  circle(HALF_L, HALF_W, 1, Math.PI, Math.PI * 1.5)

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16
  return tex
}

/* ---- goal net texture (transparent grid) ----------------------------------- */
function makeNetTexture(): THREE.Texture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 256
  const g = cv.getContext('2d')!
  g.clearRect(0, 0, 256, 256)
  g.strokeStyle = 'rgba(255,255,255,0.85)'
  g.lineWidth = 3
  for (let i = 0; i <= 256; i += 22) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i, 256)
    g.stroke()
    g.beginPath()
    g.moveTo(0, i)
    g.lineTo(256, i)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(6, 4)
  return tex
}

const postMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 })

function makeGoal(sign: number, netTex: THREE.Texture): THREE.Group {
  const mat = postMat()
  const netMat = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.05, opacity: 0.9, depthWrite: false, roughness: 1 })
  const goal = new THREE.Group()
  const gx = sign * HALF_L
  const half = GOAL_W / 2

  const post = (len: number, horizontal: boolean, r = POST_R) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat)
    if (horizontal) m.rotation.x = Math.PI / 2
    m.castShadow = true
    return m
  }
  for (const z of [-half, half]) {
    const p = post(GOAL_H, false)
    p.position.set(gx, GOAL_H / 2, z)
    goal.add(p)
  }
  const cb = post(GOAL_W, true)
  cb.position.set(gx, GOAL_H, 0)
  goal.add(cb)

  const bx = gx + sign * GOAL_D
  const br = POST_R * 0.7
  for (const z of [-half, half]) {
    const p = post(GOAL_H, false, br)
    p.position.set(bx, GOAL_H / 2, z)
    goal.add(p)
  }
  const backBar = post(GOAL_W, true, br)
  backBar.position.set(bx, GOAL_H, 0)
  goal.add(backBar)

  const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_H), netMat)
  back.rotation.y = Math.PI / 2
  back.position.set(bx, GOAL_H / 2, 0)
  goal.add(back)
  const top = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_D, GOAL_W), netMat)
  top.rotation.x = Math.PI / 2
  top.position.set(gx + (sign * GOAL_D) / 2, GOAL_H, 0)
  goal.add(top)
  for (const z of [-half, half]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_D, GOAL_H), netMat)
    side.position.set(gx + (sign * GOAL_D) / 2, GOAL_H / 2, z)
    goal.add(side)
  }
  return goal
}

function makeFlag(x: number, z: number): THREE.Group {
  const grp = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 }))
  pole.position.set(x, 0.75, z)
  pole.castShadow = true
  grp.add(pole)
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshStandardMaterial({ color: 0xff5252, side: THREE.DoubleSide, roughness: 0.6 }))
  flag.position.set(x + Math.sign(x) * -0.35, 1.28, z)
  flag.castShadow = true
  grp.add(flag)
  return grp
}

/** Build the pitch as one group in the corner-origin world frame (0..105 × 0..68). */
export function buildFieldGroup(opts: { flags?: boolean } = {}): THREE.Group {
  const group = new THREE.Group()

  const field = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_L, PLANE_W), new THREE.MeshStandardMaterial({ map: makeFieldTexture(), roughness: 0.95, metalness: 0 }))
  field.rotation.x = -Math.PI / 2
  field.receiveShadow = true
  group.add(field)

  const netTex = makeNetTexture()
  group.add(makeGoal(-1, netTex))
  group.add(makeGoal(1, netTex))

  if (opts.flags ?? true) {
    for (const x of [-HALF_L, HALF_L]) for (const z of [-HALF_W, HALF_W]) group.add(makeFlag(x, z))
  }

  // Centre-origin children → shift so the pitch spans 0..105 × 0..68.
  group.position.set(HALF_L, 0, HALF_W)
  return group
}

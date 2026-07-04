import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BOARD_WIDTH, BOARD_HEIGHT, type FieldView } from '@youcoach-board/core'
import { projectToBoard } from '../lib/arrow3d'
import { FIELD_ZONES } from '../lib/field-zones'

// Edit-Background overlay for the real 3D field: real OrbitControls (drag = orbit,
// wheel = zoom) around a LOCKED target, plus numbered zone markers. Clicking a
// marker flies the camera to that zone and re-locks the target to its point. The
// live pose is mirrored to `field3d` (via onPose) each frame so the field + arrows
// follow and the final pose persists. Only mounted while editing the background.

const FOV = 50
const DUR = 500 // fly-to tween (ms)
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

interface Pose {
  ref: string
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

interface Fly {
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  fromTgt: THREE.Vector3
  toTgt: THREE.Vector3
  start: number
}

export function FieldEditOverlay({ field3d, viewBox, panMode, onPose, onExitPan }: { field3d: FieldView; viewBox: string; panMode: boolean; onPose: (p: Pose) => void; onExitPan: () => void }) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const camRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const flyRef = useRef<Fly | null>(null)
  const onPoseRef = useRef(onPose)
  useEffect(() => {
    onPoseRef.current = onPose
  })
  // Projected marker positions (board coords), recomputed each frame.
  const [markers, setMarkers] = useState<{ x: number; y: number; behind: boolean }[]>([])

  // Fly the camera to a zone (marker click) or to an externally-set pose (drawer).
  function flyTo(position: [number, number, number], target: [number, number, number]) {
    const cam = camRef.current
    const controls = controlsRef.current
    if (!cam || !controls) return
    flyRef.current = { fromPos: cam.position.clone(), toPos: new THREE.Vector3(...position), fromTgt: controls.target.clone(), toTgt: new THREE.Vector3(...target), start: performance.now() }
  }

  // Init OrbitControls + the render/mirror loop once.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const cam = new THREE.PerspectiveCamera(FOV, BOARD_WIDTH / BOARD_HEIGHT, 0.1, 4000)
    cam.position.set(field3d.position[0], field3d.position[1], field3d.position[2])
    cam.up.set(0, 1, 0)
    const controls = new OrbitControls(cam, el)
    controls.enablePan = false // lock the look-at target
    controls.enableDamping = true
    controls.dampingFactor = 0.09
    controls.rotateSpeed = 0.45
    controls.zoomSpeed = 0.9
    controls.minDistance = 8
    controls.maxDistance = 400
    controls.maxPolarAngle = Math.PI / 2 - 0.04 // stay above the grass
    controls.target.set(field3d.target[0], field3d.target[1], field3d.target[2])
    cam.lookAt(controls.target)
    controls.update()
    camRef.current = cam
    controlsRef.current = controls

    const tmp = new THREE.Vector3()
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const fly = flyRef.current
      if (fly) {
        const t = Math.min(1, (performance.now() - fly.start) / DUR)
        const e = easeInOut(t)
        cam.position.lerpVectors(fly.fromPos, fly.toPos, e)
        controls.target.lerpVectors(fly.fromTgt, fly.toTgt, e)
        cam.lookAt(controls.target)
        if (t >= 1) {
          flyRef.current = null
          controls.update() // resync internal spherical after the manual move
        }
      } else {
        controls.update() // damped orbit
      }
      // Project the zone targets to board coords; flag ones behind the camera.
      setMarkers(
        FIELD_ZONES.map((z) => {
          tmp.set(z.target[0], z.target[1], z.target[2])
          const inFront = tmp.clone().applyMatrix4(cam.matrixWorldInverse).z < -0.01
          const b = projectToBoard(tmp, cam)
          return { x: b.x, y: b.y, behind: !inFront }
        }),
      )
      onPoseRef.current({ ref: field3d.ref, position: [cam.position.x, cam.position.y, cam.position.z], target: [controls.target.x, controls.target.y, controls.target.z], fov: FOV })
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      controls.dispose()
      camRef.current = null
      controlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // An EXTERNAL field3d change (e.g. a zone clicked in the drawer) flies the camera
  // to it. Our own per-frame onPose keeps field3d ≈ the camera, so those don't fly.
  useEffect(() => {
    const cam = camRef.current
    const controls = controlsRef.current
    if (!cam || !controls) return
    const dp = cam.position.distanceTo(new THREE.Vector3(...field3d.position))
    const dt = controls.target.distanceTo(new THREE.Vector3(...field3d.target))
    if (dp < 0.5 && dt < 0.5) return
    flyTo(field3d.position, field3d.target)
  }, [field3d])

  // Pan mode (hand / top views): disable rotation, left-drag pans (screen-space),
  // wheel zooms. Orbit mode re-enables rotation and restores left-drag = rotate.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.enableRotate = !panMode
    controls.enablePan = panMode
    controls.screenSpacePanning = true
    controls.mouseButtons.LEFT = panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
  }, [panMode])

  return (
    <>
      {/* OrbitControls input surface (empty; markers sit above it). */}
      <div ref={surfaceRef} className="absolute inset-0 z-20" style={{ touchAction: 'none', cursor: 'grab' }} />
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 z-20 h-full w-full" style={{ pointerEvents: 'none' }}>
        {markers.map((m, i) =>
          m.behind ? null : (
            <g key={FIELD_ZONES[i].id} transform={`translate(${m.x} ${m.y})`} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onPointerDown={(e) => e.stopPropagation()} onClick={() => { onExitPan(); flyTo(FIELD_ZONES[i].camera.position, FIELD_ZONES[i].target) }}>
              <circle r={16} fill="#0f172a" fillOpacity={0.82} stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <text textAnchor="middle" dominantBaseline="central" fontSize={18} fontWeight={600} fill="#ffffff">
                {i}
              </text>
            </g>
          ),
        )}
      </svg>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BOARD_WIDTH, BOARD_HEIGHT, type FieldView, type FieldType } from '@youcoach-board/core'
import { projectToBoard } from '../lib/arrow3d'
import { orbitStep, panStep, type PitchType } from '../lib/field-camera'
import { zonesForField } from '../lib/field-zones'

// Edit-Background overlay for the real 3D field: real OrbitControls (drag = orbit,
// wheel = zoom) around a LOCKED target, plus numbered zone markers. Clicking a
// marker flies the camera to that zone and re-locks the target to its point. The
// live pose is mirrored to `field3d` (via onPose) each frame so the field + arrows
// follow and the final pose persists. Only mounted while editing the background.

const FOV = 50
const DUR = 500 // fly-to tween (ms)
const ARROW_STEP_DEG = 3 // degrees the camera orbits per arrow-key press (Shift pans)
// The camera must never reach/cross the grass — keep it a little above y=0
// (metres). Pan/dolly/near-horizon orbit can all push it down, so we clamp.
const MIN_CAM_Y = 0.5
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

// Cursor for the orbit surface: the Lucide "rotate-3d" glyph (drawing the field is
// really rotating a 3D scene). Rendered as a white icon over a dark halo so it reads
// on any pitch colour; hotspot at its centre. Used in navigation + Edit-Background.
const R3D_PATHS =
  "<path d='m15.194 13.707 3.814 1.86-1.86 3.814'/><path d='M16.47214 7.52786 A 5 10 0 1 0 13 21.79796'/><path d='M21.79796 11 A 10 5 0 1 0 19 15.57071'/>"
const R3D_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'><g stroke='black' stroke-opacity='0.5' stroke-width='4'>${R3D_PATHS}</g><g stroke='white' stroke-width='2'>${R3D_PATHS}</g></svg>`
const ROTATE_3D_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(R3D_SVG)}") 14 14, grab`

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

export function FieldEditOverlay({ field3d, fieldType, viewBox, panMode, onPose, onExitPan, showMarkers = true, onTap }: { field3d: FieldView; fieldType: FieldType; viewBox: string; panMode: boolean; onPose: (p: Pose) => void; onExitPan: () => void; showMarkers?: boolean; onTap?: () => void }) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  // Track a press so a plain click (no drag) on the orbit surface can be reported
  // as a tap — the caller nudges the "Exit" button, hinting that editing is elsewhere.
  const tapRef = useRef<{ x: number; y: number; t: number } | null>(null)
  // Only the current field type's zones are shown as markers. A ref feeds the
  // rAF loop (created once) the latest list without re-subscribing.
  const zones = zonesForField(fieldType)
  const zonesRef = useRef(zones)
  useEffect(() => {
    zonesRef.current = zones
  })
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
    controls.minDistance = 2
    controls.maxDistance = 400
    controls.screenSpacePanning = true
    controls.zoomToCursor = true // wheel zooms toward the mouse, not the target
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
      // Keep the pivot on/above the ground and the camera a little above it, so it
      // can never be posed at or under the grass (update() re-reads the spherical
      // from position−target next frame, so clamping here is stable).
      if (controls.target.y < 0) controls.target.y = 0
      if (cam.position.y < MIN_CAM_Y) {
        cam.position.y = MIN_CAM_Y
        cam.lookAt(controls.target)
      }
      // Project the zone targets to board coords; flag ones behind the camera.
      setMarkers(
        zonesRef.current.map((z) => {
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

  // Pan mode (hand / top views): rotation off, left-drag pans. Orbit mode:
  // left-drag rotates; pan stays enabled so Shift+drag pans (OrbitControls maps
  // Shift+Left to pan). Wheel zooms in both.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.enableRotate = !panMode
    controls.enablePan = true
    controls.mouseButtons.LEFT = panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
  }, [panMode])

  // Arrow keys orbit the camera (Shift pans), mirroring a mouse drag — the same as
  // normal mode, but driven through THIS overlay's OrbitControls so the mirrored
  // pose (onPose) stays in sync instead of fighting a fly-to. Only bound while the
  // overlay is mounted (navigation + background-edit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.key.startsWith('Arrow')) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const cam = camRef.current
      const controls = controlsRef.current
      if (!cam || !controls) return
      e.preventDefault()
      const ux = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
      const uy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      const ref = (field3d.ref ?? 'soccer11') as PitchType
      const cur = { position: [cam.position.x, cam.position.y, cam.position.z] as [number, number, number], target: [controls.target.x, controls.target.y, controls.target.z] as [number, number, number], fov: cam.fov }
      const next = e.shiftKey ? panStep(cur, ref, ux, -uy) : orbitStep(cur, ref, ux * ARROW_STEP_DEG, -uy * ARROW_STEP_DEG)
      cam.position.set(next.position[0], next.position[1], next.position[2])
      controls.target.set(next.target[0], next.target[1], next.target[2])
      cam.lookAt(controls.target)
      controls.update()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {/* OrbitControls input surface (empty; markers sit above it). In pan mode
          (rotation disabled by a top-field view) show the pan hand; otherwise the
          rotate-3d cursor since a drag orbits the scene. */}
      <div
        ref={surfaceRef}
        className={`absolute inset-0 z-20${panMode ? ' cursor-grab active:cursor-grabbing' : ''}`}
        style={{ touchAction: 'none', cursor: panMode ? undefined : ROTATE_3D_CURSOR }}
        onPointerDown={(e) => { tapRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp } }}
        onPointerUp={(e) => {
          const d = tapRef.current
          tapRef.current = null
          if (d && e.timeStamp - d.t < 300 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) onTap?.()
        }}
      />
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 z-20 h-full w-full" style={{ pointerEvents: 'none' }}>
        {showMarkers && markers.map((m, i) =>
          m.behind || !zones[i] ? null : (
            <g key={zones[i].id} transform={`translate(${m.x} ${m.y})`} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onPointerDown={(e) => e.stopPropagation()} onClick={() => { onExitPan(); flyTo(zones[i].camera.position, zones[i].target) }}>
              <circle r={16} fill="#0f172a" fillOpacity={0.82} stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {/* Camera glyph (Lucide "camera", 24×24) — scaled to ~18px and centred. */}
              <g transform="translate(-9 -9) scale(0.75)" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </g>
            </g>
          ),
        )}
      </svg>
    </>
  )
}

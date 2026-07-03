import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { Copy, RotateCcw, GripHorizontal, Camera } from 'lucide-react'
import { projectToBoard } from '../lib/arrow3d'
import { makeCalibratedCamera, orbitToConfig, configToOrbit, type Orbit } from '../lib/field-camera'
import { pitchSegments, pitchSpots, fieldCamera } from '../lib/field-reference'
import { useEditorStore } from '../store/context'
import { Button } from './ui/button'

// The "Field camera" calibration overlay. Renders the canonical soccer-11 pitch as
// a wireframe seen through a real perspective camera, which the user poses (orbit /
// pan / dolly / FOV) to sit on the drawn field. The resulting camera — position +
// look-at target + FOV — is shown copyable for pasting into FIELD_CAMERA.
//
// Bespoke overlay — NOT document elements (nothing is added to the drawing).

const round = (n: number) => Math.round(n * 100) / 100
const SEGMENTS = pitchSegments()
const SPOTS = pitchSpots()

// A sensible starting pose: elevated, roughly end-on to the pitch, centred.
const DEFAULT_ORBIT: Orbit = { targetX: 52.5, targetZ: 34, distance: 150, azimuth: 90, elevation: 32, fov: 30 }

const storageKey = (fieldSvg: string | null) => `ycb.fieldCamera.${fieldSvg ?? 'nofield'}`

function loadOrbit(fieldSvg: string | null): Orbit {
  // Prefer a saved in-progress pose; else seed from a committed FIELD_CAMERA; else default.
  try {
    const raw = localStorage.getItem(storageKey(fieldSvg))
    if (raw) {
      const o = JSON.parse(raw) as Partial<Orbit>
      if (o && ['targetX', 'targetZ', 'distance', 'azimuth', 'elevation', 'fov'].every((k) => Number.isFinite(o[k as keyof Orbit]))) return o as Orbit
    }
  } catch {
    /* storage unavailable — fall through */
  }
  const committed = fieldCamera(fieldSvg)
  return committed ? configToOrbit(committed) : { ...DEFAULT_ORBIT }
}

interface Slider {
  key: keyof Orbit
  label: string
  min: number
  max: number
  step: number
}
const SLIDERS: Slider[] = [
  { key: 'azimuth', label: 'Rotate', min: -180, max: 180, step: 1 },
  { key: 'elevation', label: 'Tilt', min: 0, max: 89, step: 1 },
  { key: 'distance', label: 'Distance', min: 20, max: 400, step: 1 },
  { key: 'fov', label: 'FOV', min: 8, max: 100, step: 1 },
  { key: 'targetX', label: 'Pan ↔', min: -20, max: 125, step: 0.5 },
  { key: 'targetZ', label: 'Pan ↕', min: -20, max: 88, step: 0.5 },
]

export function FieldCameraLayer({ viewBox }: { viewBox: string }) {
  const fieldSvg = useEditorStore((s) => s.doc.background.fieldSvg)
  const [orbit, setOrbit] = useState<Orbit>(() => loadOrbit(fieldSvg))
  const [panel, setPanel] = useState({ x: 12, y: 56 })
  const [panelDrag, setPanelDrag] = useState(false)
  const [orbiting, setOrbiting] = useState(false)

  const set = (k: keyof Orbit, v: number) => setOrbit((o) => ({ ...o, [k]: v }))

  // Persist the pose per field on every change.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(fieldSvg), JSON.stringify(orbit))
    } catch {
      /* ignore */
    }
  }, [orbit, fieldSvg])

  // Drag on the board to orbit (azimuth/elevation); window listeners with deltas
  // (synthetic-pointer safe, like the homography tool).
  useEffect(() => {
    if (!orbiting) return
    const move = (e: PointerEvent) =>
      setOrbit((o) => ({ ...o, azimuth: o.azimuth + e.movementX * 0.3, elevation: Math.max(0, Math.min(89, o.elevation - e.movementY * 0.3)) }))
    const up = () => setOrbiting(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [orbiting])

  // Panel drag by its header.
  useEffect(() => {
    if (!panelDrag) return
    const move = (e: PointerEvent) => setPanel((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }))
    const up = () => setPanelDrag(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [panelDrag])

  const config = orbitToConfig(orbit)
  const camera = makeCalibratedCamera(config)

  // Project a world ground point (metric x, z) to board coords; null if behind the camera.
  function proj(mx: number, mz: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(mx, 0, mz)
    // Cull points behind the camera (their projection wraps).
    const cam = v.clone().applyMatrix4(camera.matrixWorldInverse)
    if (cam.z >= -0.01) return null
    const p = projectToBoard(v, camera)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    return p
  }

  const line = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) => (a && b ? { a, b } : null)
  const drawn = SEGMENTS.map(([a, b]) => line(proj(a[0], a[1]), proj(b[0], b[1]))).filter(Boolean) as { a: { x: number; y: number }; b: { x: number; y: number } }[]
  const spots = SPOTS.map((s) => proj(s[0], s[1])).filter(Boolean) as { x: number; y: number }[]

  const configText = `'${fieldSvg}': { position: [${config.position.map(round).join(', ')}], target: [${config.target.map(round).join(', ')}], fov: ${round(config.fov)} },`

  function copyConfig() {
    console.log('Field camera (paste into FIELD_CAMERA):\n' + configText)
    navigator.clipboard?.writeText(configText).catch(() => {})
  }

  return (
    <>
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        style={{ cursor: orbiting ? 'grabbing' : 'grab' }}
        onPointerDown={() => setOrbiting(true)}
      >
        {drawn.map((s, i) => (
          <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="#22d3ee" strokeWidth={1.5} strokeOpacity={0.95} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ))}
        {spots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="#22d3ee" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ))}
      </svg>

      {/* Control + readout panel (draggable by its header). */}
      <div className="pointer-events-auto absolute z-30 w-64 rounded-xl border border-border bg-card shadow-lg" style={{ left: panel.x, top: panel.y }}>
        <div className="flex cursor-move items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-xs font-semibold" onPointerDown={() => setPanelDrag(true)}>
          <GripHorizontal className="size-3.5 text-muted-foreground" /> <Camera className="size-3.5" /> Field camera — soccer 11
        </div>
        <div className="p-2.5">
          <div className="mb-2 text-[11px] text-muted-foreground">Drag the board to rotate; use the sliders to fine-tune.</div>
          <div className="grid gap-1.5">
            {SLIDERS.map((sl) => (
              <label key={sl.key} className="flex items-center gap-2 text-[11px]">
                <span className="w-14 shrink-0 text-muted-foreground">{sl.label}</span>
                <input
                  type="range"
                  aria-label={sl.label}
                  min={sl.min}
                  max={sl.max}
                  step={sl.step}
                  value={orbit[sl.key]}
                  onChange={(e) => set(sl.key, e.currentTarget.valueAsNumber)}
                  className="h-1 flex-1 accent-primary"
                />
                <span className="w-9 shrink-0 text-right font-mono tabular-nums">{round(orbit[sl.key])}</span>
              </label>
            ))}
          </div>
          <textarea
            readOnly
            value={configText}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 h-16 w-full resize-none rounded-md border border-border bg-background p-1.5 font-mono text-[10px] leading-tight outline-none"
          />
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" className="flex-1" onClick={copyConfig}>
              <Copy /> Copy camera
            </Button>
            <Button size="sm" variant="outline" aria-label="Reset camera" onClick={() => setOrbit({ ...DEFAULT_ORBIT })}>
              <RotateCcw />
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

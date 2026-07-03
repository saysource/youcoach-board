import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { Copy, RotateCcw, GripHorizontal, Camera } from 'lucide-react'
import { projectToBoard } from '../lib/arrow3d'
import { makeCalibratedCamera, orbitToConfig, configToOrbit, type Orbit, type PitchType } from '../lib/field-camera'
import { PITCH_MODELS, PITCH_LIST, pitchTypeFor, fieldCamera, type PitchModel } from '../lib/field-reference'
import { useEditorStore } from '../store/context'
import { Button } from './ui/button'

// The "Field camera" calibration overlay. Renders a canonical pitch (soccer 11 /
// futsal / area) as a wireframe seen through a real perspective camera, which the
// user poses (orbit / pan / dolly / FOV) to sit on the drawn field. The resulting
// camera — reference type + position + look-at target + FOV — is shown copyable
// for pasting into FIELD_CAMERA.
//
// Bespoke overlay — NOT document elements (nothing is added to the drawing).

const round = (n: number) => Math.round(n * 100) / 100

// A sensible starting pose for a pitch: elevated, roughly end-on, centred.
function defaultOrbit(model: PitchModel): Orbit {
  const [len, wid] = model.size
  return { targetX: len / 2, targetZ: wid / 2, distance: Math.round(len * 1.4), azimuth: 90, elevation: 32, fov: 30 }
}

const storageKey = (fieldSvg: string | null) => `ycb.fieldCamera.${fieldSvg ?? 'nofield'}`

interface Saved {
  type: PitchType
  orbit: Orbit
}

function loadSaved(fieldSvg: string | null): Saved {
  // Prefer a saved in-progress pose; else seed from a committed FIELD_CAMERA; else
  // infer the type from the field path and use a default pose.
  try {
    const raw = localStorage.getItem(storageKey(fieldSvg))
    if (raw) {
      const o = JSON.parse(raw) as Partial<Saved>
      const okOrbit = o.orbit && ['targetX', 'targetZ', 'distance', 'azimuth', 'elevation', 'fov'].every((k) => Number.isFinite(o.orbit![k as keyof Orbit]))
      if (o.type && PITCH_MODELS[o.type] && okOrbit) return { type: o.type, orbit: o.orbit as Orbit }
    }
  } catch {
    /* storage unavailable — fall through */
  }
  const committed = fieldCamera(fieldSvg)
  if (committed) return { type: committed.ref, orbit: configToOrbit(committed) }
  const type = pitchTypeFor(fieldSvg)
  return { type, orbit: defaultOrbit(PITCH_MODELS[type]) }
}

export function FieldCameraLayer({ viewBox }: { viewBox: string }) {
  const fieldSvg = useEditorStore((s) => s.doc.background.fieldSvg)
  const [saved] = useState<Saved>(() => loadSaved(fieldSvg))
  const [type, setType] = useState<PitchType>(saved.type)
  const [orbit, setOrbit] = useState<Orbit>(saved.orbit)
  const [panel, setPanel] = useState({ x: 12, y: 56 })
  const [panelDrag, setPanelDrag] = useState(false)
  const [orbiting, setOrbiting] = useState(false)

  const model = PITCH_MODELS[type]
  const [len, wid] = model.size
  const set = (k: keyof Orbit, v: number) => setOrbit((o) => ({ ...o, [k]: v }))

  // Switching pitch type changes the metric frame, so re-seed the pose for it.
  function changeType(t: PitchType) {
    setType(t)
    setOrbit(defaultOrbit(PITCH_MODELS[t]))
  }

  // Persist the pose + type per field on every change.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(fieldSvg), JSON.stringify({ type, orbit }))
    } catch {
      /* ignore */
    }
  }, [type, orbit, fieldSvg])

  // Drag on the board to orbit (azimuth/elevation); window listeners with deltas.
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

  const config = orbitToConfig(orbit, type)
  const camera = makeCalibratedCamera(config)

  // Project a world ground point (metric x, z) to board coords; null if behind the camera.
  function proj(mx: number, mz: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(mx, 0, mz)
    const cam = v.clone().applyMatrix4(camera.matrixWorldInverse)
    if (cam.z >= -0.01) return null // behind the camera → its projection wraps
    const p = projectToBoard(v, camera)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    return p
  }

  const line = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) => (a && b ? { a, b } : null)
  const drawn = model.segments.map(([a, b]) => line(proj(a[0], a[1]), proj(b[0], b[1]))).filter(Boolean) as { a: { x: number; y: number }; b: { x: number; y: number } }[]
  const spots = model.spots.map((s) => proj(s[0], s[1])).filter(Boolean) as { x: number; y: number }[]

  const sliders: { key: keyof Orbit; label: string; min: number; max: number; step: number }[] = [
    { key: 'azimuth', label: 'Rotate', min: -180, max: 180, step: 0.5 },
    { key: 'elevation', label: 'Tilt', min: 0, max: 89, step: 0.5 },
    { key: 'distance', label: 'Distance', min: Math.round(len * 0.3), max: Math.round(len * 5), step: 0.5 },
    { key: 'fov', label: 'FOV', min: 8, max: 100, step: 0.5 },
    { key: 'targetX', label: 'Pan ↔', min: Math.round(-0.4 * len), max: Math.round(1.4 * len), step: 0.5 },
    { key: 'targetZ', label: 'Pan ↕', min: Math.round(-0.4 * wid), max: Math.round(1.4 * wid), step: 0.5 },
  ]

  const configText = `'${fieldSvg}': { ref: '${config.ref}', position: [${config.position.map(round).join(', ')}], target: [${config.target.map(round).join(', ')}], fov: ${round(config.fov)} },`

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
          <GripHorizontal className="size-3.5 text-muted-foreground" /> <Camera className="size-3.5" /> Field camera
        </div>
        <div className="p-2.5">
          <label className="mb-2 flex items-center gap-2 text-[11px]">
            <span className="w-14 shrink-0 text-muted-foreground">Pitch</span>
            <select value={type} onChange={(e) => changeType(e.currentTarget.value as PitchType)} className="flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-xs outline-none">
              {PITCH_LIST.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <div className="mb-2 text-[11px] text-muted-foreground">Drag the board to rotate; use the sliders to fine-tune.</div>
          <div className="grid gap-1.5">
            {sliders.map((sl) => (
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
            <Button size="sm" variant="outline" aria-label="Reset camera" onClick={() => setOrbit(defaultOrbit(model))}>
              <RotateCcw />
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

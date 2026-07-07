import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GripHorizontal, MapPin, Copy, Plus, Crosshair, Camera, Trash2, RectangleVertical, RectangleHorizontal, Rotate3d } from 'lucide-react'
import { BOARD_WIDTH, BOARD_HEIGHT, type FieldView } from '@youcoach-board/core'
import { projectToBoard, boardToGround } from '../lib/arrow3d'
import { clientToBoard } from '../lib/draw'
import { FIELD_ZONES, type Zone } from '../lib/field-zones'
import { orbitToConfig, type PitchType } from '../lib/field-camera'
import { cn } from '../lib/cn'
import { useEditorStore } from '../store/context'
import { Button } from './ui/button'

// The "Field zones" authoring tool. Orbit the real 3D pitch (drag = orbit around
// the locked target, wheel = zoom, click the grass to re-aim the target), then
// build the zone set: Add captures the current target + camera pose as a zone;
// Set pose re-captures a zone's camera; label/delete/reorder-by-add. The resulting
// FIELD_ZONES array is shown copyable to paste into lib/field-zones.ts.

const FOV = 50
const MIN_CAM_Y = 0.5 // keep the camera a little above the grass (metres)
const round = (n: number) => Math.round(n * 100) / 100
const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2])
const storageKey = 'ycb.fieldZones.wip'

function loadZones(): Zone[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const z = JSON.parse(raw) as Zone[]
      if (Array.isArray(z) && z.every((x) => x && Array.isArray(x.target) && x.camera)) return z
    }
  } catch {
    /* ignore */
  }
  return FIELD_ZONES.map((z) => ({ ...z, target: [...z.target] as [number, number, number], camera: { ...z.camera, position: [...z.camera.position] as [number, number, number], target: [...z.camera.target] as [number, number, number] } }))
}

export function FieldZoneTool({ field3d, viewBox }: { field3d: FieldView; viewBox: string }) {
  const setBackground = useEditorStore((s) => s.setBackground)
  const beginTransaction = useEditorStore((s) => s.beginTransaction)
  const commitTransaction = useEditorStore((s) => s.commitTransaction)

  const surfaceRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const camRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const downRef = useRef<{ x: number; y: number } | null>(null)

  const [zones, setZones] = useState<Zone[]>(() => loadZones())
  const [selected, setSelected] = useState<number>(0)
  const [markers, setMarkers] = useState<{ x: number; y: number; behind: boolean }[]>([])
  const [tgt, setTgt] = useState<{ x: number; y: number } | null>(null)
  const [panel, setPanel] = useState({ x: 12, y: 56 })
  const [panelDrag, setPanelDrag] = useState(false)
  const [topView, setTopView] = useState<'portrait' | 'landscape' | null>(null)
  // Set-position mode: the zone whose target is being (re)placed by clicking the
  // grass, plus the orange disc's board position under the cursor.
  const [setPos, setSetPos] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)

  const zonesRef = useRef(zones)
  useEffect(() => {
    zonesRef.current = zones
    try {
      localStorage.setItem(storageKey, JSON.stringify(zones))
    } catch {
      /* ignore */
    }
  }, [zones])

  // OrbitControls on a scratch camera; mirror the live pose to field3d (in one
  // session transaction) so the pitch renders the orbit.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    beginTransaction()
    const cam = new THREE.PerspectiveCamera(FOV, BOARD_WIDTH / BOARD_HEIGHT, 0.1, 4000)
    cam.position.set(field3d.position[0], field3d.position[1], field3d.position[2])
    cam.up.set(0, 1, 0)
    const controls = new OrbitControls(cam, el)
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.09
    controls.rotateSpeed = 0.45
    controls.screenSpacePanning = true
    controls.zoomToCursor = true // wheel zooms toward the mouse, not the target
    controls.maxPolarAngle = Math.PI / 2 - 0.04
    controls.minDistance = 2
    controls.maxDistance = 400
    controls.target.set(field3d.target[0], field3d.target[1], field3d.target[2])
    cam.lookAt(controls.target)
    controls.update()
    camRef.current = cam
    controlsRef.current = controls

    const tmp = new THREE.Vector3()
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.update()
      // Never let the camera reach/cross the grass (see FieldEditOverlay).
      if (controls.target.y < 0) controls.target.y = 0
      if (cam.position.y < MIN_CAM_Y) {
        cam.position.y = MIN_CAM_Y
        cam.lookAt(controls.target)
      }
      setMarkers(
        zonesRef.current.map((z) => {
          tmp.set(z.target[0], z.target[1], z.target[2])
          const inFront = tmp.clone().applyMatrix4(cam.matrixWorldInverse).z < -0.01
          const b = projectToBoard(tmp, cam)
          return { x: b.x, y: b.y, behind: !inFront }
        }),
      )
      const t = projectToBoard(controls.target, cam)
      setTgt({ x: t.x, y: t.y })
      setBackground({ field3d: { ref: field3d.ref, position: [cam.position.x, cam.position.y, cam.position.z], target: [controls.target.x, controls.target.y, controls.target.z], fov: FOV } })
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      controls.dispose()
      commitTransaction()
      camRef.current = null
      controlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Panel drag.
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

  // Top view (near-overhead, pan+zoom only); azimuth sets the orientation.
  function goTopView(orientation: 'portrait' | 'landscape') {
    const cam = camRef.current
    const controls = controlsRef.current
    if (!cam || !controls) return
    const pose = orbitToConfig({ targetX: 52.5, targetZ: 34, azimuth: orientation === 'portrait' ? 90 : 0, elevation: 89.5, distance: orientation === 'portrait' ? 135 : 100, fov: FOV }, field3d.ref as PitchType)
    cam.position.set(pose.position[0], pose.position[1], pose.position[2])
    controls.target.set(pose.target[0], pose.target[1], pose.target[2])
    cam.lookAt(controls.target)
    controls.update()
    setTopView(orientation)
  }
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.enableRotate = !topView
    controls.enablePan = true // Shift+drag pans in orbit; left-drag pans in top view
    controls.mouseButtons.LEFT = topView ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
  }, [topView])

  // Set-position mode: freeze the camera and let a click on the grass place a
  // zone's target. Esc cancels.
  useEffect(() => {
    const controls = controlsRef.current
    if (controls) controls.enabled = setPos === null
    if (setPos === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSetPos(null)
        setHover(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPos])

  const currentPose = (): Zone['camera'] => {
    const cam = camRef.current!
    const c = controlsRef.current!
    return { ref: field3d.ref as PitchType, position: [round(cam.position.x), round(cam.position.y), round(cam.position.z)], target: [round(c.target.x), round(c.target.y), round(c.target.z)], fov: FOV }
  }
  const currentTarget = (): [number, number, number] => {
    const c = controlsRef.current!
    return [round(c.target.x), round(c.target.y), round(c.target.z)]
  }

  function onSurfaceDown(e: React.PointerEvent) {
    downRef.current = { x: e.clientX, y: e.clientY }
  }
  // In set-position mode the orange disc tracks the ground under the cursor.
  function onSurfaceMove(e: React.PointerEvent) {
    if (setPos === null || !svgRef.current) return
    setHover(clientToBoard(svgRef.current, e.clientX, e.clientY))
  }
  function onSurfaceUp(e: React.PointerEvent) {
    const d = downRef.current
    downRef.current = null
    const cam = camRef.current
    const controls = controlsRef.current
    if (!cam || !controls || !svgRef.current) return
    const b = clientToBoard(svgRef.current, e.clientX, e.clientY)
    const g = boardToGround(b.x, b.y, cam)
    if (!g) return
    if (setPos !== null) {
      // Place the zone's target at the clicked ground point, then leave the mode.
      const i = setPos
      setZones((zs) => zs.map((z, j) => (j === i ? { ...z, target: [round(g.x), 0, round(g.z)] } : z)))
      setSetPos(null)
      setHover(null)
      return
    }
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return // was an orbit drag
    controls.target.set(g.x, 0, g.z)
    cam.lookAt(controls.target)
    controls.update()
  }

  function selectZone(i: number) {
    const z = zonesRef.current[i]
    const cam = camRef.current
    const controls = controlsRef.current
    if (!z || !cam || !controls) return
    setSelected(i)
    setTopView(null)
    cam.position.copy(v3(z.camera.position))
    controls.target.copy(v3(z.target))
    cam.lookAt(controls.target)
    controls.update()
  }

  function addZone() {
    const z: Zone = { id: `zone-${zones.length}`, label: `Zone ${zones.length}`, fieldType: 'soccer11', category: 'top', target: currentTarget(), camera: currentPose() }
    setZones((zs) => [...zs, z])
    setSelected(zones.length)
  }
  function setPose(i: number) {
    setZones((zs) => zs.map((z, j) => (j === i ? { ...z, target: currentTarget(), camera: currentPose() } : z)))
  }
  function del(i: number) {
    setZones((zs) => zs.filter((_, j) => j !== i))
    setSelected((sel) => (sel >= i && sel > 0 ? sel - 1 : sel))
  }
  // Only the label changes while typing — the id (React key) stays stable so the
  // input never remounts/loses focus. The id is slugified from the label at export.
  function relabel(i: number, label: string) {
    setZones((zs) => zs.map((z, j) => (j === i ? { ...z, label } : z)))
  }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const exportText = `export const FIELD_ZONES: Zone[] = [\n${zones
    .map((z) => `  { id: '${slug(z.label) || z.id}', label: '${z.label}', target: [${z.target.map(round).join(', ')}], camera: { ref: '${z.camera.ref}', position: [${z.camera.position.map(round).join(', ')}], target: [${z.camera.target.map(round).join(', ')}], fov: ${z.camera.fov} } },`)
    .join('\n')}\n]`
  function copyExport() {
    console.log(exportText)
    navigator.clipboard?.writeText(exportText).catch(() => {})
  }

  return (
    <>
      <div ref={surfaceRef} className="absolute inset-0 z-20" style={{ touchAction: 'none', cursor: setPos !== null ? 'crosshair' : 'grab' }} onPointerDown={onSurfaceDown} onPointerMove={onSurfaceMove} onPointerUp={onSurfaceUp} />
      <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 z-20 h-full w-full" style={{ pointerEvents: 'none' }}>
        {setPos !== null ? (
          // Set-position mode: an orange disc under the cursor previews the target.
          hover && <circle cx={hover.x} cy={hover.y} r={10} fill="#f59e0b" fillOpacity={0.85} stroke="#ffffff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ) : (
          // The current locked target.
          tgt && <circle cx={tgt.x} cy={tgt.y} r={10} fill="none" stroke="#f59e0b" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        )}
        {markers.map((m, i) => {
          // `markers` is set from the rAF loop, so it can briefly be longer than
          // `zones` right after a delete — guard against the missing zone.
          const z = zones[i]
          if (!z || m.behind) return null
          return (
            <g key={z.id} transform={`translate(${m.x} ${m.y})`} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onPointerDown={(e) => e.stopPropagation()} onClick={() => selectZone(i)}>
              <circle r={15} fill={i === selected ? '#0891b2' : '#0f172a'} fillOpacity={0.85} stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <text textAnchor="middle" dominantBaseline="central" fontSize={17} fontWeight={600} fill="#ffffff">
                {i}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="pointer-events-auto absolute z-30 w-72 rounded-xl border border-border bg-card shadow-lg" style={{ left: panel.x, top: panel.y }}>
        <div className="flex cursor-move items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-xs font-semibold" onPointerDown={() => setPanelDrag(true)}>
          <GripHorizontal className="size-3.5 text-muted-foreground" /> <MapPin className="size-3.5" /> Field zones
        </div>
        <div className="p-2.5">
          <div className="mb-2 text-[11px] text-muted-foreground">Drag to orbit · wheel to zoom · click the grass to aim.</div>
          {/* Camera views (same as Edit-Background): top-down portrait/landscape + 3D orbit. */}
          <div className="mb-2 flex items-center gap-1 rounded-md border border-border p-0.5">
            <ZoneViewBtn label="Top view (portrait)" active={topView === 'portrait'} onClick={() => goTopView('portrait')}>
              <RectangleVertical />
            </ZoneViewBtn>
            <ZoneViewBtn label="Top view (landscape)" active={topView === 'landscape'} onClick={() => goTopView('landscape')}>
              <RectangleHorizontal />
            </ZoneViewBtn>
            <ZoneViewBtn label="3D orbit view" active={topView === null} onClick={() => setTopView(null)}>
              <Rotate3d />
            </ZoneViewBtn>
          </div>
          <div className="mb-2 flex gap-1.5">
            <Button size="sm" className="flex-1" onClick={addZone}>
              <Plus /> Add zone
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPose(selected)} disabled={!zones[selected]}>
              <Camera /> Set pose
            </Button>
          </div>
          {setPos !== null && <div className="mb-2 rounded bg-primary/10 px-2 py-1 text-[11px] text-foreground">Click the pitch to set “{zones[setPos]?.label}”. Esc to cancel.</div>}
          <div className="max-h-44 overflow-y-auto rounded-md border border-border">
            {zones.map((z, i) => (
              <div key={z.id} className={`flex items-center gap-1 border-b border-border px-1.5 py-1 last:border-0 ${i === selected ? 'bg-primary/10' : ''}`}>
                <button type="button" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/80 text-[10px] font-semibold text-background" onClick={() => selectZone(i)}>
                  {i}
                </button>
                <input value={z.label} onChange={(e) => relabel(i, e.currentTarget.value)} className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] outline-none hover:border-border focus:border-border" />
                <button type="button" aria-label="Set target position" title="Set target position (click the pitch)" className={cn('shrink-0 hover:text-foreground', setPos === i ? 'text-primary' : 'text-muted-foreground')} onClick={() => { setSetPos(i); setHover(null) }}>
                  <Crosshair className="size-3.5" />
                </button>
                <button type="button" aria-label="Delete zone" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => del(i)}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <textarea readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} className="mt-2 h-24 w-full resize-none rounded-md border border-border bg-background p-1.5 font-mono text-[10px] leading-tight outline-none" />
          <Button size="sm" className="mt-2 w-full" onClick={copyExport}>
            <Copy /> Copy FIELD_ZONES
          </Button>
        </div>
      </div>
    </>
  )
}

// A compact segmented icon button for the zone tool's camera-view row.
function ZoneViewBtn({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn('flex h-7 flex-1 items-center justify-center rounded [&_svg]:size-4', active ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
    >
      {children}
    </button>
  )
}

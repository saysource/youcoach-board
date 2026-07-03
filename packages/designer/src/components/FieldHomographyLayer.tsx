import { useEffect, useRef, useState } from 'react'
import { BOARD_WIDTH, BOARD_HEIGHT } from '@youcoach-board/core'
import { Move, Eraser, Copy, RotateCcw, GripHorizontal } from 'lucide-react'
import { clientToBoard } from '../lib/draw'
import { solveHomography, residuals, multiply3, type Pt } from '../lib/homography'
import { SOCCER11, seedLayout } from '../lib/field-reference'
import { useEditorStore } from '../store/context'
import { Button } from './ui/button'
import { cn } from '../lib/cn'

// The "Field homography" calibration overlay. Seeds the canonical soccer-11
// notable points as draggable handles connected by reference lines; the user
// drags them onto the drawn field and erases the ones a given field lacks. The
// live 3×3 homography (metric pitch → field-image px) is shown, copyable.
//
// Bespoke handles — NOT document elements (nothing is added to the drawing).

const round = (n: number) => Math.round(n * 1e6) / 1e6
const METRIC = new Map(SOCCER11.points.map((p) => [p.id, p.metric] as const))

// Calibration is authoring state (not document data), so it persists per field in
// localStorage — re-opening the tool for the same field restores the placed points.
const storageKey = (fieldSvg: string | null) => `ycb.fieldHomography.${fieldSvg ?? 'nofield'}`

interface Saved {
  pts: Record<string, [number, number]>
  active: Set<string>
}

function loadSaved(fieldSvg: string | null): Saved | null {
  try {
    const raw = localStorage.getItem(storageKey(fieldSvg))
    if (!raw) return null
    const o = JSON.parse(raw) as { pts?: Record<string, [number, number]>; active?: string[] }
    if (!o || typeof o.pts !== 'object' || !Array.isArray(o.active)) return null
    // Merge onto a fresh seed so any new/missing reference point still has a spot.
    const pts = seedLayout(SOCCER11, BOARD_WIDTH, BOARD_HEIGHT)
    for (const p of SOCCER11.points) {
      const v = o.pts[p.id]
      if (Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) pts[p.id] = [v[0], v[1]]
    }
    const known = new Set(SOCCER11.points.map((p) => p.id))
    return { pts, active: new Set(o.active.filter((id) => known.has(id))) }
  } catch {
    return null
  }
}

export function FieldHomographyLayer({ viewBox }: { viewBox: string }) {
  const bg = useEditorStore((s) => s.doc.background)
  const svgRef = useRef<SVGSVGElement | null>(null)
  // Point positions in board coordinates + which points are still present, seeded
  // from the field's saved calibration when there is one.
  const [saved] = useState<Saved | null>(() => loadSaved(bg.fieldSvg))
  const [pts, setPts] = useState<Record<string, [number, number]>>(() => saved?.pts ?? seedLayout(SOCCER11, BOARD_WIDTH, BOARD_HEIGHT))
  const [active, setActive] = useState<Set<string>>(() => saved?.active ?? new Set(SOCCER11.points.map((p) => p.id)))
  const [erase, setErase] = useState(false)
  const [drag, setDrag] = useState<string | null>(null)
  // Panel position (px within the board container) — draggable so it never keeps
  // an important handle covered.
  const [panel, setPanel] = useState({ x: 12, y: 56 })
  const [panelDrag, setPanelDrag] = useState(false)

  function reseed() {
    setPts(seedLayout(SOCCER11, BOARD_WIDTH, BOARD_HEIGHT))
    setActive(new Set(SOCCER11.points.map((p) => p.id)))
  }

  // Persist the calibration for this field on every change (cheap; ~33 points).
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(bg.fieldSvg), JSON.stringify({ pts, active: [...active] }))
    } catch {
      /* storage may be unavailable (private mode / quota) — ignore */
    }
  }, [pts, active, bg.fieldSvg])

  // Handles: pointer-down starts a drag (or erases); movement is tracked on the
  // SVG itself (robust — no setPointerCapture, which rejects synthetic pointers).
  function onHandleDown(id: string, e: React.PointerEvent) {
    e.stopPropagation()
    if (erase) {
      setActive((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
      return
    }
    setDrag(id)
  }
  function onSvgMove(e: React.PointerEvent) {
    if (!drag || !svgRef.current) return
    const b = clientToBoard(svgRef.current, e.clientX, e.clientY)
    setPts((p) => ({ ...p, [drag]: [b.x, b.y] }))
  }

  // Panel drag: window listeners with movement deltas (also synthetic-safe).
  useEffect(() => {
    if (!panelDrag) return
    const move = (e: PointerEvent) => setPanel((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }))
    const upFn = () => setPanelDrag(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', upFn)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', upFn)
    }
  }, [panelDrag])

  // Solve metric → field-image. First metric → board (from the placed handles),
  // then normalise out the field's board placement (scale/position) so the matrix
  // is intrinsic to the field image, independent of how it's laid on the board.
  const activeIds = SOCCER11.points.filter((p) => active.has(p.id)).map((p) => p.id)
  const src: Pt[] = activeIds.map((id) => ({ x: METRIC.get(id)![0], y: METRIC.get(id)![1] }))
  const dst: Pt[] = activeIds.map((id) => ({ x: pts[id][0], y: pts[id][1] }))
  let matrix: number[] | null = null
  let rms = 0
  let error: string | null = null
  if (activeIds.length >= 4) {
    try {
      const hMetricToBoard = solveHomography(src, dst)
      const cx = BOARD_WIDTH / 2
      const cy = BOARD_HEIGHT / 2
      const s = bg.scale || 1
      const ex = cx + bg.position[0] - s * cx
      const ey = cy + bg.position[1] - s * cy
      const invField = [1 / s, 0, -ex / s, 0, 1 / s, -ey / s, 0, 0, 1]
      matrix = multiply3(invField, hMetricToBoard).map(round)
      rms = residuals(hMetricToBoard, src, dst).rms
    } catch {
      error = 'Points are degenerate (collinear / overlapping) — spread them out.'
    }
  } else {
    error = `Place at least 4 points (${activeIds.length} placed).`
  }
  const matrixText = matrix ? `[${matrix.join(', ')}]` : ''

  function copyMatrix() {
    if (!matrixText) return
    console.log('Field homography (metric m → field image px), row-major 3×3:\n' + matrixText)
    navigator.clipboard?.writeText(matrixText).catch(() => {})
  }

  return (
    <>
      <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" onPointerMove={onSvgMove} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
        {SOCCER11.lines
          .filter(([a, b]) => active.has(a) && active.has(b))
          .map(([a, b], i) => (
            <line key={i} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} stroke="#22d3ee" strokeWidth={1.5} strokeOpacity={0.9} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ))}
        {activeIds.map((id) => (
          <circle
            key={id}
            cx={pts[id][0]}
            cy={pts[id][1]}
            r={9}
            fill={erase ? '#fca5a5' : '#ffffff'}
            stroke={erase ? '#dc2626' : '#0891b2'}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: erase ? 'not-allowed' : 'grab' }}
            onPointerDown={(e) => onHandleDown(id, e)}
          />
        ))}
      </svg>

      {/* Control + readout panel (draggable by its header). */}
      <div className="pointer-events-auto absolute z-30 w-60 rounded-xl border border-border bg-card shadow-lg" style={{ left: panel.x, top: panel.y }}>
        <div className="flex cursor-move items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-xs font-semibold" onPointerDown={() => setPanelDrag(true)}>
          <GripHorizontal className="size-3.5 text-muted-foreground" /> Field homography — soccer 11
        </div>
        <div className="p-2.5">
          <div className="mb-2 flex gap-1 rounded-md bg-muted p-0.5 text-sm">
            <button type="button" aria-pressed={!erase} onClick={() => setErase(false)} className={cn('flex flex-1 items-center justify-center gap-1 rounded px-2 py-1', !erase ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
              <Move className="size-4" /> Move
            </button>
            <button type="button" aria-pressed={erase} onClick={() => setErase(true)} className={cn('flex flex-1 items-center justify-center gap-1 rounded px-2 py-1', erase ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
              <Eraser className="size-4" /> Erase
            </button>
          </div>
          <div className="mb-1 text-[11px] text-muted-foreground">
            {activeIds.length} points{matrix ? ` · RMS ${rms.toFixed(1)}px` : ''}
          </div>
          <textarea
            readOnly
            value={error && !matrix ? error : matrixText}
            onFocus={(e) => e.currentTarget.select()}
            className="h-20 w-full resize-none rounded-md border border-border bg-background p-1.5 font-mono text-[10px] leading-tight outline-none"
          />
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" className="flex-1" disabled={!matrix} onClick={copyMatrix}>
              <Copy /> Copy matrix
            </Button>
            <Button size="sm" variant="outline" aria-label="Reset points" onClick={reseed}>
              <RotateCcw />
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

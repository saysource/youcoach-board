import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Gauge, Highlighter, Rotate3d, Move, X } from 'lucide-react'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Slider } from './ui/slider'
import { cn } from '../lib/cn'
import { useEditorStore, useEditorStoreApi } from '../store/context'
import { startPlayback, stopPlayback, pausePlayback, resumePlayback, isPlaying, isPaused } from '../lib/animation-playback'

// The bar auto-hides after this long with no pointer/keyboard activity; the laser
// trail fades each stroke to nothing over the same window.
const IDLE_MS = 3000
const FADE_MS = 3000

const isTypingTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

// A full-screen red "laser": every pointer sample is a fading dab, so the cursor
// leaves a trail that dissolves along its path over FADE_MS. Captures pointer
// events (so the board underneath isn't edited); the controls bar sits above it.
function LaserTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const points = useRef<{ x: number; y: number; t: number; brk?: boolean }[]>([])
  const drawing = useRef(false)
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = () => window.devicePixelRatio || 1
    const resize = () => {
      canvas.width = window.innerWidth * dpr()
      canvas.height = window.innerHeight * dpr()
    }
    resize()
    window.addEventListener('resize', resize)
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const now = performance.now()
      const pts = points.current
      while (pts.length && now - pts[0].t > FADE_MS) pts.shift()
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0)
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      // Draw each stroke (a run of points between `brk` markers) as ONE continuous
      // path — so round caps land only at the two ends, never at interior joints
      // (which is what made the line look like a string of beads). The stroke fades
      // as a unit by the age of its freshest point, and old tail points are trimmed
      // above, so the trail shrinks from the tail while dimming.
      let i = 0
      while (i < pts.length) {
        let j = i + 1
        while (j < pts.length && !pts[j].brk) j++
        if (j - i >= 2) {
          const op = Math.max(0, 1 - (now - pts[j - 1].t) / FADE_MS)
          if (op > 0) {
            const trace = () => {
              ctx.beginPath()
              ctx.moveTo(pts[i].x, pts[i].y)
              for (let k = i + 1; k < j; k++) ctx.lineTo(pts[k].x, pts[k].y)
            }
            ctx.strokeStyle = `rgba(255,90,90,${op * 0.35})` // soft glow
            ctx.lineWidth = 12
            trace()
            ctx.stroke()
            ctx.strokeStyle = `rgba(230,20,20,${op})` // core
            ctx.lineWidth = 4
            trace()
            ctx.stroke()
          }
        }
        i = j
      }
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  // Draw only while dragging (pointer held): press starts a fresh stroke (`brk`),
  // move extends it, release ends it.
  const end = () => {
    drawing.current = false
  }
  return (
    <div
      className="fixed inset-0 z-40 cursor-crosshair"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        drawing.current = true
        points.current.push({ x: e.clientX, y: e.clientY, t: performance.now(), brk: true })
        // Capture so the stroke keeps drawing if the pointer leaves the element;
        // best-effort (throws when there's no active pointer, e.g. synthetic events).
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          /* capture is optional; window-level moves still reach us */
        }
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return
        // Drop samples closer than 3px to the last one — dense clusters at a near-
        // stationary pointer would otherwise pile up into a visible blob.
        const last = points.current[points.current.length - 1]
        if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 3) return
        points.current.push({ x: e.clientX, y: e.clientY, t: performance.now() })
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  )
}

function SpeedControl({ speed, onChange, disabled }: { speed: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" aria-label="Playback speed" disabled={disabled} className="w-auto gap-1 px-2">
          <Gauge />
          <span className="text-xs tabular-nums">{speed}×</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-52">
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Speed</span>
            <span className="tabular-nums text-foreground">{speed}×</span>
          </div>
          <Slider min={0.25} max={2} step={0.25} value={[speed]} onValueChange={([v]) => onChange(v)} />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0.25×</span>
            <span>2×</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Presentation-mode HUD: a controls bar that appears on activity and fades after
// IDLE_MS, plus the laser overlay. Space toggles play; Esc (owned by BoardShell)
// exits.
export function PresentationOverlay({
  onExit,
  canNavigate = false,
  orbiting = false,
  panning = false,
  onOrbit,
  onPan,
  onExitNav = () => {},
}: {
  onExit: () => void
  /** A 3D field exists, so orbit/pan the camera is possible. */
  canNavigate?: boolean
  /** Orbit mode is active (drag rotates the camera around the scene). */
  orbiting?: boolean
  /** Pan mode is active (drag slides the camera across the ground). */
  panning?: boolean
  onOrbit?: () => void
  onPan?: () => void
  /** Leave orbit/pan mode (called before playback resumes, or when the laser turns on). */
  onExitNav?: () => void
}) {
  const storeApi = useEditorStoreApi()
  const playing = useEditorStore((s) => s.playing)
  const currentFrame = useEditorStore((s) => s.currentFrame)
  const frameCount = useEditorStore((s) => s.doc.animation.frames.length)
  const speed = useEditorStore((s) => s.doc.animation.speed)
  const setCurrentFrame = useEditorStore((s) => s.setCurrentFrame)
  const setAnimationSettings = useEditorStore((s) => s.setAnimationSettings)
  const [visible, setVisible] = useState(true)
  const [laser, setLaser] = useState(false)
  const hideRef = useRef(0)
  const isTouch = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches, [])
  const hasAnim = frameCount > 1

  // Reveal on any pointer/keyboard activity; hide again after IDLE_MS of stillness.
  useEffect(() => {
    const show = () => {
      setVisible(true)
      window.clearTimeout(hideRef.current)
      hideRef.current = window.setTimeout(() => setVisible(false), IDLE_MS)
    }
    const evs = ['pointermove', 'pointerdown', 'keydown'] as const
    show()
    for (const ev of evs) window.addEventListener(ev, show)
    return () => {
      window.clearTimeout(hideRef.current)
      for (const ev of evs) window.removeEventListener(ev, show)
    }
  }, [])

  const togglePlay = () => {
    if (isPaused(storeApi)) {
      onExitNav() // leave orbit/pan so the camera follows playback again
      resumePlayback(storeApi) // resume from the frozen frame
    } else if (isPlaying(storeApi)) {
      pausePlayback(storeApi) // freeze in place
    } else {
      onExitNav()
      startPlayback(storeApi)
    }
  }

  // Leaving presentation stops any running/paused playback (resets to a clean frame).
  useEffect(() => () => stopPlayback(storeApi), [storeApi])

  // Space bar = play/pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.key === ' ') && !isTypingTarget(e.target)) {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeApi])

  const step = (d: 1 | -1) => {
    if (isPlaying(storeApi)) stopPlayback(storeApi)
    setCurrentFrame(Math.min(frameCount - 1, Math.max(0, currentFrame + d)))
  }

  return (
    <>
      {laser && <LaserTrail />}
      <div className={cn('pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 pb-4 transition-opacity duration-300', visible ? 'opacity-100' : 'opacity-0')}>
        <div className={cn('flex items-center gap-1 rounded-xl border border-border bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur', visible ? 'pointer-events-auto' : 'pointer-events-none')}>
          <Button size="icon-sm" aria-label={playing ? 'Pause' : 'Play'} disabled={!hasAnim} onClick={togglePlay} className="hover:bg-primary/25">
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button size="icon-sm" aria-label="Previous frame" disabled={!hasAnim || currentFrame <= 0} onClick={() => step(-1)}>
            <SkipBack />
          </Button>
          <Button size="icon-sm" aria-label="Next frame" disabled={!hasAnim || currentFrame >= frameCount - 1} onClick={() => step(1)}>
            <SkipForward />
          </Button>
          <SpeedControl speed={speed} onChange={(v) => setAnimationSettings({ speed: v })} disabled={!hasAnim} />
          {canNavigate && (
            <>
              <span className="mx-0.5 h-5 w-px bg-border" />
              {/* Orbit / pan the 3D camera to inspect the scene from another angle.
                  Disabled while playing (the animation drives the camera); available
                  when paused or stopped. */}
              <Button size="icon-sm" aria-label="Orbit camera" aria-pressed={orbiting} disabled={playing} onClick={() => { setLaser(false); onOrbit?.() }} className={cn('hover:bg-primary/25', orbiting && 'bg-primary/20 text-primary')}>
                <Rotate3d />
              </Button>
              <Button size="icon-sm" aria-label="Pan camera" aria-pressed={panning} disabled={playing} onClick={() => { setLaser(false); onPan?.() }} className={cn('hover:bg-primary/25', panning && 'bg-primary/20 text-primary')}>
                <Move />
              </Button>
            </>
          )}
          <span className="mx-0.5 h-5 w-px bg-border" />
          <Button size="icon-sm" aria-label="Laser pointer" aria-pressed={laser} onClick={() => setLaser((v) => { const next = !v; if (next) onExitNav(); return next })} className={cn('hover:bg-primary/25', laser && 'bg-red-500/15 text-red-500 hover:bg-red-500/25')}>
            <Highlighter />
          </Button>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <Button size="icon-sm" aria-label="Exit presentation (Esc)" onClick={onExit}>
            <X />
          </Button>
        </div>
        {!isTouch && <div className="select-none text-xs text-muted-foreground">Press ESC to exit presentation mode</div>}
      </div>
    </>
  )
}

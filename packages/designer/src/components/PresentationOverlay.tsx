import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Pause, Settings, X } from 'lucide-react'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { cn } from '../lib/cn'
import { useEditorStore, useEditorStoreApi } from '../store/context'
import { startPlayback, stopPlayback, pausePlayback, resumePlayback, isPlaying, isPaused, seekPlayhead } from '../lib/animation-playback'

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
    // Size to the overlay's own box (the viewer may be EMBEDDED in a page, so
    // never assume the window): re-check cheaply every frame.
    const resize = () => {
      const host = canvas.parentElement!
      const w = host.clientWidth * dpr()
      const h = host.clientHeight * dpr()
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }
    resize()
    window.addEventListener('resize', resize)
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      resize()
      const now = performance.now()
      const pts = points.current
      while (pts.length && now - pts[0].t > FADE_MS) pts.shift()
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
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
  // Pointer samples in the overlay's LOCAL coordinates (embed-safe).
  const local = (e: { clientX: number; clientY: number; currentTarget: EventTarget }) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  return (
    <div
      className="absolute inset-0 z-40 cursor-crosshair"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        drawing.current = true
        points.current.push({ ...local(e), t: performance.now(), brk: true })
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
        const p = local(e)
        // Drop samples closer than 3px to the last one — dense clusters at a near-
        // stationary pointer would otherwise pile up into a visible blob.
        const last = points.current[points.current.length - 1]
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 3) return
        points.current.push({ ...p, t: performance.now() })
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  )
}


// A labelled switch row inside the cog popover.
function SwitchRow({ label, checked, onCheckedChange, disabled }: { label: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn('text-[11px] font-medium text-muted-foreground', disabled && 'opacity-50')}>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

// Presentation/viewer HUD: video controls that appear on pointer activity and
// fade after IDLE_MS — play/pause + a timeline scrubber + a cog menu (orbit /
// pan / laser / speed / fix-the-view) — plus the laser overlay. Space toggles
// play; Esc (owned by BoardShell) exits presentation. In the read-only viewer
// (no onExit) a still drawing shows no controls at all.
export function PresentationOverlay({
  onExit,
  canNavigate = false,
  orbiting = false,
  panning = false,
  onOrbit,
  onPan,
  onExitNav = () => {},
}: {
  /** Exit presentation (the X button + hint). Omit in the viewer — no exit. */
  onExit?: () => void
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
  const { t } = useTranslation()
  const storeApi = useEditorStoreApi()
  const playing = useEditorStore((s) => s.playing)
  const currentFrame = useEditorStore((s) => s.currentFrame)
  const frameCount = useEditorStore((s) => s.doc.animation.frames.length)
  const speed = useEditorStore((s) => s.doc.animation.speed)
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

  const fixedView = useEditorStore((s) => s.fixedView)
  const setFixedView = useEditorStore((s) => s.setFixedView)
  const playhead = useEditorStore((s) => s.playhead)

  const togglePlay = () => {
    if (isPaused(storeApi)) {
      if (!fixedView) onExitNav() // leave orbit/pan so the camera follows playback again
      resumePlayback(storeApi) // resume from the frozen frame
    } else if (isPlaying(storeApi)) {
      pausePlayback(storeApi) // freeze in place
    } else {
      if (!fixedView) onExitNav()
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

  // Timeline position (frame units 0‥frames−1): live playhead during playback/
  // pause, else the edited frame.
  const timeline = playhead ?? currentFrame
  // The viewer shows controls only for real animations; presentation keeps the
  // bar (cog + exit stay useful on a still drawing).
  if (!hasAnim && !onExit) return <>{laser && <LaserTrail />}</>

  return (
    <>
      {laser && <LaserTrail />}
      <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 pb-4 transition-opacity duration-300', visible ? 'opacity-100' : 'opacity-0')}>
        <div className={cn('flex items-center gap-1.5 rounded-xl border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur', visible ? 'pointer-events-auto' : 'pointer-events-none')}>
          {hasAnim && (
            <>
              <Button size="icon-sm" aria-label={playing ? t('Pause') : t('Play')} onClick={togglePlay} className="hover:bg-primary/25">
                {playing ? <Pause /> : <Play />}
              </Button>
              {/* Timeline cursor: scrubbing seeks in place (starts a PAUSED
                  playback when none is running, so Play resumes from there). */}
              <Slider
                min={0}
                max={frameCount - 1}
                step={0.001}
                value={[Math.min(frameCount - 1, Math.max(0, timeline))]}
                onValueChange={([v]) => seekPlayhead(storeApi, v)}
                aria-label={t('Timeline')}
                className="w-56"
              />
            </>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon-sm" aria-label={t('Playback settings')}>
                <Settings />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-56">
              <div className="grid gap-3">
                {canNavigate && (
                  <>
                    {/* Orbit / pan the camera. Free while paused/stopped — or any
                        time with a fixed view (the animation no longer owns it). */}
                    <SwitchRow label={t('Orbit')} checked={orbiting} disabled={playing && !fixedView} onCheckedChange={() => { setLaser(false); onOrbit?.() }} />
                    <SwitchRow label={t('Pan')} checked={panning} disabled={playing && !fixedView} onCheckedChange={() => { setLaser(false); onPan?.() }} />
                  </>
                )}
                <SwitchRow label={t('Laser pointer')} checked={laser} onCheckedChange={(v) => { if (v) onExitNav(); setLaser(v) }} />
                {hasAnim && (
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                      <span>{t('Speed')}</span>
                      <span className="tabular-nums text-foreground">{speed}×</span>
                    </div>
                    <Slider min={0.25} max={2} step={0.25} value={[speed]} onValueChange={([v]) => setAnimationSettings({ speed: v })} />
                  </div>
                )}
                {canNavigate && hasAnim && (
                  <>
                    <div className="h-px w-full bg-border" />
                    {/* Fixed view: playback ignores the frames' camera poses and
                        plays from the perspective the user set with orbit/pan. */}
                    <SwitchRow label={t('Fix the view')} checked={fixedView} onCheckedChange={setFixedView} />
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
          {onExit && (
            <>
              <span className="mx-0.5 h-5 w-px bg-border" />
              <Button size="icon-sm" aria-label={t('Exit presentation (Esc)')} onClick={onExit}>
                <X />
              </Button>
            </>
          )}
        </div>
        {!isTouch && onExit && <div className="select-none text-xs text-muted-foreground">{t('Press ESC to exit presentation mode')}</div>}
      </div>
    </>
  )
}

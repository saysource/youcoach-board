import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { BOARD_WIDTH, BOARD_HEIGHT, type FieldView, type FieldBands } from '@youcoach-board/core'
import { buildFieldGroup, markingsGeometry, bandsGeometry, lineWidthForDistance, SUN_POSITION, SUN_TARGET } from '../lib/field3d'
import { applyViewCamera } from '../lib/field-camera'

// A WebGL layer rendering the real 3D pitch, viewed through the board's field
// camera (background.field3d). Positioned + sized exactly like Arrow3DLayer (over
// the letterboxed board rect), pointer-transparent, and rendered ON DEMAND (no
// animation loop) whenever the camera/viewport/size changes. Transparent so the
// user's image/solid background shows around the pitch.

interface Props {
  camera: FieldView
  viewport: { zoom: number; panX: number; panY: number }
  /** The board background (image wins over color); confined to the board rect. */
  image: string | null
  color: string
  svgRef: React.RefObject<SVGSVGElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Whether the two goals at the ends of the pitch are shown. */
  showGoals?: boolean
  /** Orientation of the mown shading bands (or none). */
  bands?: FieldBands
  /** Bump/flip to force an on-demand redraw when neither camera nor viewport
   *  changed but the layout might have (e.g. entering/leaving Edit-Background) —
   *  avoids a stale pitch until the next camera move. */
  renderTick?: unknown
}

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  cam: THREE.PerspectiveCamera
  lines: THREE.Mesh | null
  goals: THREE.Object3D | null
  bands: THREE.Mesh | null
  bandsOrient: FieldBands
  lineW: number
}

export function FieldSceneLayer({ camera, viewport, image, color, svgRef, containerRef, showGoals = true, bands = 'vertical', renderTick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgRef = useRef<HTMLDivElement | null>(null)
  const ctxRef = useRef<Ctx | null>(null)

  function ensureCtx(): Ctx | null {
    if (ctxRef.current) return ctxRef.current
    const canvas = canvasRef.current
    if (!canvas) return null
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x4a7a3a, 0.75))
    const sun = new THREE.DirectionalLight(0xffffff, 2.4)
    sun.position.copy(SUN_POSITION)
    sun.target.position.copy(SUN_TARGET)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 10
    sun.shadow.camera.far = 400
    const d = 90
    sun.shadow.camera.left = -d
    sun.shadow.camera.right = d
    sun.shadow.camera.top = d
    sun.shadow.camera.bottom = -d
    sun.shadow.bias = -0.0004
    scene.add(sun)
    scene.add(sun.target)
    const group = buildFieldGroup()
    scene.add(group)

    ctxRef.current = { renderer, scene, cam: new THREE.PerspectiveCamera(), lines: (group.getObjectByName('field-lines') as THREE.Mesh) ?? null, goals: group.getObjectByName('field-goals') ?? null, bands: (group.getObjectByName('field-bands') as THREE.Mesh) ?? null, bandsOrient: 'vertical', lineW: 0 }
    return ctxRef.current
  }

  // The letterboxed 4:3 board rect within the SVG, in container-local px.
  function boardRect(): { left: number; top: number; width: number; height: number } | null {
    const svg = svgRef.current
    const container = containerRef.current
    if (!svg || !container) return null
    const sr = svg.getBoundingClientRect()
    const cr = container.getBoundingClientRect()
    if (!sr.width || !sr.height) return null
    const s = Math.min(sr.width / BOARD_WIDTH, sr.height / BOARD_HEIGHT)
    const width = BOARD_WIDTH * s
    const height = BOARD_HEIGHT * s
    return { left: sr.left - cr.left + (sr.width - width) / 2, top: sr.top - cr.top + (sr.height - height) / 2, width, height }
  }

  // The latest props, so render() reads current values even when invoked from the
  // ResizeObserver (whose callback is created once and would otherwise close over
  // the first render's camera — causing a stale reset when the drawer resizes it).
  const propsRef = useRef({ camera, viewport, showGoals, bands })
  useEffect(() => {
    propsRef.current = { camera, viewport, showGoals, bands }
  })

  function render() {
    const ctx = ensureCtx()
    const canvas = canvasRef.current
    const rect = boardRect()
    if (!ctx || !canvas || !rect || rect.width < 1) return
    const { camera: cam, viewport: vp } = propsRef.current
    if (ctx.goals) ctx.goals.visible = propsRef.current.showGoals
    // Rebuild the shading bands when the orientation changes (cheap flat geometry).
    if (ctx.bands && propsRef.current.bands !== ctx.bandsOrient) {
      ctx.bands.geometry.dispose()
      ctx.bands.geometry = bandsGeometry(propsRef.current.bands)
      ctx.bandsOrient = propsRef.current.bands
    }
    for (const el of [canvas, bgRef.current]) {
      if (!el) continue
      el.style.left = `${rect.left}px`
      el.style.top = `${rect.top}px`
      el.style.width = `${rect.width}px`
      el.style.height = `${rect.height}px`
    }
    ctx.renderer.setSize(rect.width, rect.height, false)
    // Thin the lines as the camera moves in (keeps ~constant on-screen thickness).
    if (ctx.lines) {
      const dist = Math.hypot(cam.position[0] - cam.target[0], cam.position[1] - cam.target[1], cam.position[2] - cam.target[2])
      const w = lineWidthForDistance(dist)
      if (Math.abs(w - ctx.lineW) > 0.004) {
        ctx.lines.geometry.dispose()
        ctx.lines.geometry = markingsGeometry(w)
        ctx.lineW = w
      }
    }
    applyViewCamera(ctx.cam, cam, vp)
    ctx.renderer.render(ctx.scene, ctx.cam)
  }

  useEffect(() => {
    render()
    // Re-render once more after layout settles (e.g. the drawer opening on
    // Edit-Background resizes the board rect a frame later), so the pitch never
    // lingers stale until the next camera move.
    const raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, viewport, renderTick, showGoals, bands])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => render())
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {/* The board background (image or solid), confined to the board rect (zIndex
          -2, behind the transparent pitch canvas). */}
      <div ref={bgRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: -2, overflow: 'hidden', backgroundColor: image ? undefined : color }}>
        {image && <img src={image} alt="" className="h-full w-full object-cover" />}
      </div>
      {/* zIndex -1 keeps the pitch below the 2D SVG (static) but above the bg. */}
      <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: -1 }} />
    </>
  )
}

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { BOARD_WIDTH, BOARD_HEIGHT, type FieldView, type FieldBands, type FieldType, type TrainingLayout } from '@youcoach-board/core'
import { buildFieldGroup, markingsGeometry, bandsGeometry, lineWidthForDistance, BAND_OPACITY, CENTER_LIGHT_INTENSITY, FIELD_DIMS, FUTSAL_COURT_FALLBACK, SUN_POSITION, SUN_TARGET, FLOODLIGHTS, makeFloodlight, makeCenterLight } from '../lib/field3d'
import { applyViewCamera } from '../lib/field-camera'

// A WebGL layer rendering the real 3D pitch, viewed through the board's field
// camera (background.field3d). Positioned + sized exactly like Arrow3DLayer (over
// the letterboxed board rect), pointer-transparent, and rendered ON DEMAND (no
// animation loop) whenever the camera/viewport/size changes. Transparent so the
// user's image/solid background shows around the pitch.

interface Props {
  camera: FieldView
  viewport: { zoom: number; panX: number; panY: number }
  /** The board background (image wins over the surface color); confined to the board rect. */
  image: string | null
  svgRef: React.RefObject<SVGSVGElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Whether the two goals at the ends of the pitch are shown. */
  showGoals?: boolean
  /** Orientation of the mown shading bands (or none). */
  bands?: FieldBands
  /** Which playing surface to render (markings + goals). */
  fieldType?: FieldType
  /** Training area variant (lines + shaded region + goals). */
  layout?: TrainingLayout
  /** The surface colour (background.surfaceColor): the flat 2D board background AND
   *  the infinite 3D ground plane ('transparent' = off / grass image shows). */
  surface?: string
  /** Colour of the field markings/lines (background.lineColor); not the bands. */
  lineColor?: string
  /** Whether the field markings/lines are drawn (background.showLines). */
  showLines?: boolean
  /** Opacity (0–1) of the mown shading bands (background.bandsOpacity). */
  bandsOpacity?: number
  /** Futsal court: playing-surface colour (background.courtColor). */
  courtColor?: string
  /** Futsal court: border-frame colour (background.borderColor). */
  borderColor?: string
  /** Futsal court: goal-areas + centre-circle fill colour (background.areasColor). */
  areasColor?: string
  /** Central point-light intensity as a fraction of default (background.centerLight). */
  centerLight?: number
  /** Bump/flip to force an on-demand redraw when neither camera nor viewport
   *  changed but the layout might have (e.g. entering/leaving Edit-Background) —
   *  avoids a stale pitch until the next camera move. */
  renderTick?: unknown
}

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  cam: THREE.PerspectiveCamera
  group: THREE.Group
  ground: THREE.Mesh | null
  court: THREE.Mesh | null
  border: THREE.Mesh | null
  areas: THREE.Mesh | null
  lines: THREE.Mesh | null
  goals: THREE.Object3D | null
  bands: THREE.Mesh | null
  bandsOrient: FieldBands
  centerLight: THREE.PointLight | null
  fieldType: FieldType
  layout: TrainingLayout
  lineW: number
}

export function FieldSceneLayer({ camera, viewport, image: rawImage, svgRef, containerRef, showGoals = true, bands = 'vertical', fieldType = 'soccer11', layout = 'plain', surface: rawSurface = 'transparent', lineColor = '#ffffff', showLines = true, bandsOpacity = 1, centerLight = 1, courtColor = FUTSAL_COURT_FALLBACK, borderColor = '#ff9f48', areasColor = '#277ea0', renderTick }: Props) {
  // Futsal never uses the grass image (field0 is a soccer surface): the backdrop
  // and the infinite surround are always a solid color — the surface color when
  // set, else a dark indoor-hall grey.
  const futsal = fieldType === 'futsal'
  const surface = futsal && (!rawSurface || rawSurface === 'transparent') ? '#282828' : rawSurface
  const image = futsal ? null : rawImage
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgRef = useRef<HTMLDivElement | null>(null)
  const ctxRef = useRef<Ctx | null>(null)

  function ensureCtx(): Ctx | null {
    if (ctxRef.current) return ctxRef.current
    const canvas = canvasRef.current
    if (!canvas) return null
    // logarithmicDepthBuffer: the scene spans a 4000 m ground plane down to the
    // pitch's few-mm-apart surface planes (ground / bands / lines), so a linear
    // 0.1–4000 depth buffer runs out of precision at grazing/distant views and the
    // near-coplanar planes z-fight (visible as flicker in the mowing stripes when
    // rotating). A log depth buffer distributes precision evenly across the range.
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x4a7a3a, 0.75))
    // Four shadowless stadium pylons: their circles of light grade the pitch/
    // surround; the sun below remains the shadow caster.
    for (const f of FLOODLIGHTS) {
      const spot = makeFloodlight(f)
      scene.add(spot)
      scene.add(spot.target)
    }
    // Soft centre glow: brightest at midfield, fading radially (point light).
    const centerLight = makeCenterLight()
    scene.add(centerLight)
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
    const group = buildFieldGroup({ fieldType: propsRef.current.fieldType, goals: propsRef.current.showGoals, bands: propsRef.current.bands, layout: propsRef.current.layout, surround: propsRef.current.surface, court: propsRef.current.courtColor, border: propsRef.current.borderColor, areas: propsRef.current.areasColor })
    scene.add(group)

    ctxRef.current = { renderer, scene, cam: new THREE.PerspectiveCamera(), group, ground: (group.getObjectByName('field-ground') as THREE.Mesh) ?? null, court: (group.getObjectByName('field-court') as THREE.Mesh) ?? null, border: (group.getObjectByName('field-border') as THREE.Mesh) ?? null, areas: (group.getObjectByName('field-areas') as THREE.Mesh) ?? null, lines: (group.getObjectByName('field-lines') as THREE.Mesh) ?? null, goals: group.getObjectByName('field-goals') ?? null, bands: (group.getObjectByName('field-bands') as THREE.Mesh) ?? null, bandsOrient: propsRef.current.bands, centerLight, fieldType: propsRef.current.fieldType, layout: propsRef.current.layout, lineW: 0 }
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
  const propsRef = useRef({ camera, viewport, showGoals, image, bands, fieldType, layout, surface, lineColor, showLines, bandsOpacity, centerLight, courtColor, borderColor, areasColor })
  useEffect(() => {
    propsRef.current = { camera, viewport, showGoals, image, bands, fieldType, layout, surface, lineColor, showLines, bandsOpacity, centerLight, courtColor, borderColor, areasColor }
  })

  function render() {
    const ctx = ensureCtx()
    const canvas = canvasRef.current
    const rect = boardRect()
    if (!ctx || !canvas || !rect || rect.width < 1) return
    const { camera: cam, viewport: vp } = propsRef.current
    // Field type or training layout changed → rebuild the whole field group
    // (markings/goals/bands all depend on them), re-grab sub-objects, reset caches.
    if (propsRef.current.fieldType !== ctx.fieldType || propsRef.current.layout !== ctx.layout) {
      ctx.scene.remove(ctx.group)
      ctx.group.traverse((o) => {
        const m = o as Partial<THREE.Mesh>
        m.geometry?.dispose()
        const mat = (o as THREE.Mesh).material
        if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose())
      })
      const group = buildFieldGroup({ fieldType: propsRef.current.fieldType, goals: propsRef.current.showGoals, bands: propsRef.current.bands, layout: propsRef.current.layout, surround: propsRef.current.surface, court: propsRef.current.courtColor, border: propsRef.current.borderColor, areas: propsRef.current.areasColor })
      ctx.scene.add(group)
      ctx.group = group
      ctx.ground = (group.getObjectByName('field-ground') as THREE.Mesh) ?? null
      ctx.court = (group.getObjectByName('field-court') as THREE.Mesh) ?? null
      ctx.border = (group.getObjectByName('field-border') as THREE.Mesh) ?? null
      ctx.areas = (group.getObjectByName('field-areas') as THREE.Mesh) ?? null
      ctx.lines = (group.getObjectByName('field-lines') as THREE.Mesh) ?? null
      ctx.goals = group.getObjectByName('field-goals') ?? null
      ctx.bands = (group.getObjectByName('field-bands') as THREE.Mesh) ?? null
      ctx.bandsOrient = propsRef.current.bands
      ctx.fieldType = propsRef.current.fieldType
      ctx.layout = propsRef.current.layout
      ctx.lineW = 0
    }
    if (ctx.goals) ctx.goals.visible = propsRef.current.showGoals
    // Field markings: on/off (background.showLines) + colour (background.lineColor),
    // the lines only — NOT the mown bands.
    if (ctx.lines) {
      ctx.lines.visible = propsRef.current.showLines
      ;(ctx.lines.material as THREE.MeshBasicMaterial).color.set(propsRef.current.lineColor)
    }
    // Mown shading bands opacity (background.bandsOpacity). 'cross' draws both band
    // sets in one mesh; halve each so the overlaps (which blend twice) reach a full
    // band while a single strip reads at half intensity.
    const bop = propsRef.current.bandsOpacity
    if (ctx.bands) (ctx.bands.material as THREE.MeshBasicMaterial).opacity = (propsRef.current.bands === 'cross' ? BAND_OPACITY / 2 : BAND_OPACITY) * bop
    // Central point-light intensity, scaled by background.centerLight (0 … 1.25).
    // The futsal court is a LIT colored floor (unlike the grass pitch, where only
    // the surround is lit), so the same wattage overexposes it — damp it there.
    if (ctx.centerLight) ctx.centerLight.intensity = CENTER_LIGHT_INTENSITY * propsRef.current.centerLight * (propsRef.current.fieldType === 'futsal' ? 0.12 : 1)
    // Toggle/recolor the infinite ground plane live.
    if (ctx.ground) {
      const sc = propsRef.current.surface
      const on = !!sc && sc !== 'transparent'
      ctx.ground.visible = on
      if (on) (ctx.ground.material as THREE.MeshStandardMaterial).color.set(sc)
    }
    // Futsal court fills: court / border / areas colors, each its own setting
    // (the master surfaceColor only drives the infinite surround).
    if (ctx.court) (ctx.court.material as THREE.MeshStandardMaterial).color.set(propsRef.current.courtColor)
    if (ctx.border) (ctx.border.material as THREE.MeshStandardMaterial).color.set(propsRef.current.borderColor)
    if (ctx.areas) (ctx.areas.material as THREE.MeshStandardMaterial).color.set(propsRef.current.areasColor)
    // Rebuild the shading bands when the orientation changes (cheap flat geometry).
    if (ctx.bands && propsRef.current.bands !== ctx.bandsOrient) {
      ctx.bands.geometry.dispose()
      ctx.bands.geometry = bandsGeometry(propsRef.current.bands, FIELD_DIMS[ctx.fieldType].halfL, FIELD_DIMS[ctx.fieldType].halfW, ctx.fieldType, ctx.layout)
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
        ctx.lines.geometry = markingsGeometry(w, ctx.fieldType, ctx.layout)
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
  }, [camera, viewport, renderTick, showGoals, image, bands, fieldType, layout, surface, lineColor, showLines, bandsOpacity, centerLight, courtColor, borderColor, areasColor])

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
      <div ref={bgRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: -2, overflow: 'hidden', backgroundColor: image ? undefined : surface }}>
        {image && <img src={image} alt="" className="h-full w-full object-cover" />}
      </div>
      {/* zIndex -1 keeps the pitch below the 2D SVG (static) but above the bg. */}
      <canvas ref={canvasRef} data-layer="field3d" style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: -1 }} />
    </>
  )
}

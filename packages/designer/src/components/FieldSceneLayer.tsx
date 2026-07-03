import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { BOARD_WIDTH, BOARD_HEIGHT, type FieldView } from '@youcoach-board/core'
import { buildFieldGroup, SUN_POSITION, SUN_TARGET } from '../lib/field3d'
import { applyViewCamera } from '../lib/field-camera'

// A WebGL layer rendering the real 3D pitch, viewed through the board's field
// camera (background.field3d). Positioned + sized exactly like Arrow3DLayer (over
// the letterboxed board rect), pointer-transparent, and rendered ON DEMAND (no
// animation loop) whenever the camera/viewport/size changes. Transparent so the
// user's image/solid background shows around the pitch.

interface Props {
  camera: FieldView
  viewport: { zoom: number; panX: number; panY: number }
  svgRef: React.RefObject<SVGSVGElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  cam: THREE.PerspectiveCamera
}

export function FieldSceneLayer({ camera, viewport, svgRef, containerRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
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
    scene.add(buildFieldGroup())

    ctxRef.current = { renderer, scene, cam: new THREE.PerspectiveCamera() }
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
  const propsRef = useRef({ camera, viewport })
  useEffect(() => {
    propsRef.current = { camera, viewport }
  })

  function render() {
    const ctx = ensureCtx()
    const canvas = canvasRef.current
    const rect = boardRect()
    if (!ctx || !canvas || !rect || rect.width < 1) return
    const { camera: cam, viewport: vp } = propsRef.current
    canvas.style.left = `${rect.left}px`
    canvas.style.top = `${rect.top}px`
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.renderer.setSize(rect.width, rect.height, false)
    applyViewCamera(ctx.cam, cam, vp)
    ctx.renderer.render(ctx.scene, ctx.cam)
  }

  useEffect(() => {
    render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, viewport])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => render())
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // zIndex -1 keeps the pitch below the 2D SVG (static) but above the bottom bg.
  return <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: -1 }} />
}

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { BOARD_WIDTH, BOARD_HEIGHT, type Arrow3DElement } from '@youcoach-board/core'
import { createArrowGeometry, makeArrow3DCamera, arrow3DWorldHandles } from '../lib/arrow3d'
import { buildProjectionMatrix, worldToBoard, DEFAULT_HEIGHT } from '../lib/homography-camera'

/** Imperative API the InteractiveBoard uses to hit-test 3D arrows (which aren't
 *  SVG, so they can't be clicked through the normal element handlers). */
export interface Arrow3DLayerHandle {
  /** The topmost arrow whose mesh is under the given board point, or null. */
  pick: (boardX: number, boardY: number) => string | null
}

interface Props {
  elements: Arrow3DElement[]
  selectedIds: string[]
  viewport: { zoom: number; panX: number; panY: number }
  /** The active field's homography (metric→board px). When set, arrows render in
   *  the field's perspective via a custom projection; otherwise the fixed camera. */
  homography: number[] | null
  svgRef: React.RefObject<SVGSVGElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  pickCamera: THREE.PerspectiveCamera
  customCam: THREE.Camera
  meshes: Map<string, THREE.Mesh>
}

// 2D point-in-triangle (for hit-testing arrows under the custom projection).
function pointInTri(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): boolean {
  const d = (p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
  const d1 = d({ x: px, y: py }, a, b)
  const d2 = d({ x: px, y: py }, b, c)
  const d3 = d({ x: px, y: py }, c, a)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

// Track the geometry inputs so we only rebuild the (expensive) mesh when a shape
// field actually changes — moves/rotations/colour just update transforms/material.
interface MeshData {
  splineWidth: number
  splineHeight: number
  splineLength: number
  stickWidth: number
  tipWidth: number
  thickness: number
  tipLength: number
}

function shapeChanged(d: MeshData, e: Arrow3DElement): boolean {
  return (
    d.splineWidth !== e.splineWidth ||
    d.splineHeight !== e.splineHeight ||
    d.splineLength !== e.splineLength ||
    d.stickWidth !== e.stickWidth ||
    d.tipWidth !== e.tipWidth ||
    d.thickness !== e.thickness ||
    d.tipLength !== e.tipLength
  )
}

function meshData(e: Arrow3DElement): MeshData {
  return { splineWidth: e.splineWidth, splineHeight: e.splineHeight, splineLength: e.splineLength, stickWidth: e.stickWidth, tipWidth: e.tipWidth, thickness: e.thickness, tipLength: e.tipLength }
}

function hexColor(fill: string): { color: number; alpha: number } {
  // Accept #rgb / #rrggbb (ignore any alpha channel — opacity is separate).
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill.trim())
  if (!m) return { color: 0xff0000, alpha: 1 }
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  return { color: parseInt(hex, 16), alpha: 1 }
}

export const Arrow3DLayer = forwardRef<Arrow3DLayerHandle, Props>(function Arrow3DLayer({ elements, selectedIds, viewport, homography, svgRef, containerRef }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<Ctx | null>(null)

  // Lazily build the renderer/scene once the canvas exists.
  function ensureCtx(): Ctx | null {
    if (ctxRef.current) return ctxRef.current
    const canvas = canvasRef.current
    if (!canvas) return null
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const scene = new THREE.Scene()
    const camera = makeArrow3DCamera()
    scene.add(camera)

    // Lit from above the pitch. The frustum/plane are sized for the metric pitch
    // (x∈0..105, z∈0..68) used under the homography projection; it also covers the
    // small near-origin world of the default fixed camera.
    const dir = new THREE.DirectionalLight(0xffffff, 3)
    dir.position.set(72, 120, 44)
    dir.target.position.set(52, 0, 34)
    dir.castShadow = true
    const d = 80
    dir.shadow.camera.left = -d
    dir.shadow.camera.right = d
    dir.shadow.camera.top = d
    dir.shadow.camera.bottom = -d
    dir.shadow.camera.near = 1
    dir.shadow.camera.far = 400
    dir.shadow.mapSize.set(2048, 2048)
    scene.add(dir)
    scene.add(dir.target)
    scene.add(new THREE.AmbientLight(0x909090))

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.28 }))
    plane.rotation.set(-0.5 * Math.PI, 0, 0)
    plane.receiveShadow = true
    plane.name = 'ground'
    scene.add(plane)

    ctxRef.current = { renderer, scene, camera, pickCamera: makeArrow3DCamera(), customCam: new THREE.Camera(), meshes: new Map() }
    return ctxRef.current
  }

  // Add / update / remove meshes to mirror `elements`.
  function syncMeshes(ctx: Ctx) {
    const seen = new Set<string>()
    for (const e of elements) {
      seen.add(e.id)
      let mesh = ctx.meshes.get(e.id)
      const { color } = hexColor(e.fill)
      if (!mesh) {
        const geometry = createArrowGeometry(e.stickWidth, e.tipWidth, e.thickness, e.tipLength, e.splineWidth, e.splineHeight, e.splineLength)
        const material = new THREE.MeshPhongMaterial({ color, flatShading: true })
        material.side = THREE.DoubleSide
        material.transparent = true
        mesh = new THREE.Mesh(geometry, material)
        mesh.castShadow = true
        ctx.scene.add(mesh)
        ctx.meshes.set(e.id, mesh)
      } else if (shapeChanged(mesh.userData.data as MeshData, e)) {
        const geometry = createArrowGeometry(e.stickWidth, e.tipWidth, e.thickness, e.tipLength, e.splineWidth, e.splineHeight, e.splineLength)
        mesh.geometry.dispose()
        mesh.geometry = geometry
      }
      // The group transform is baked onto the mesh: rotate about the tail, place at
      // (x,z), and push the arrow's local origin so the tail sits at (x,z).
      mesh.position.set(e.x, 0, e.z)
      mesh.rotation.set(0, e.y, 0)
      mesh.translateZ(-e.splineWidth) // local: head at -splineWidth, tail at 0
      const mat = mesh.material as THREE.MeshPhongMaterial
      mat.color.setHex(color)
      mat.opacity = e.opacity
      mesh.castShadow = e.opacity > 0
      mesh.visible = e.opacity > 0
      mesh.userData = { id: e.id, data: meshData(e) }
    }
    // Remove meshes whose element is gone.
    for (const [id, mesh] of ctx.meshes) {
      if (seen.has(id)) continue
      ctx.scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      ctx.meshes.delete(id)
    }
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

  function render() {
    const ctx = ensureCtx()
    const canvas = canvasRef.current
    const rect = boardRect()
    if (!ctx || !canvas || !rect || rect.width < 1) return
    syncMeshes(ctx)
    canvas.style.left = `${rect.left}px`
    canvas.style.top = `${rect.top}px`
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.renderer.setSize(rect.width, rect.height, false)
    if (homography) {
      // Custom projection built from the field homography: the ground plane (+
      // shadow) reproduces the field perspective exactly; height lifts screen-up.
      const m = buildProjectionMatrix(homography, viewport, DEFAULT_HEIGHT)
      ctx.customCam.projectionMatrix.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12], m[13], m[14], m[15])
      ctx.customCam.projectionMatrixInverse.copy(ctx.customCam.projectionMatrix).invert()
      ctx.customCam.updateMatrixWorld()
      ctx.renderer.render(ctx.scene, ctx.customCam)
    } else {
      // Default fixed camera: render the visible board sub-rect (tracks pan/zoom).
      const zoom = viewport.zoom || 1
      ctx.camera.setViewOffset(BOARD_WIDTH, BOARD_HEIGHT, viewport.panX, viewport.panY, BOARD_WIDTH / zoom, BOARD_HEIGHT / zoom)
      ctx.camera.updateProjectionMatrix()
      ctx.renderer.render(ctx.scene, ctx.camera)
    }
  }

  // Re-render whenever the document/selection/viewport/field change.
  useEffect(() => {
    render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectedIds, viewport, homography])

  // Re-render on container resize (the letterbox rect moves/scales).
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => render())
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    pick(boardX: number, boardY: number): string | null {
      const ctx = ctxRef.current
      if (!ctx) return null
      if (homography) {
        // Custom projection: THREE's raycaster only supports std cameras, so hit-test
        // the arrow's projected triangle (tail–apex–head) in board space, top first.
        for (let i = elements.length - 1; i >= 0; i--) {
          const e = elements[i]
          const [t, h, a] = arrow3DWorldHandles(e.x, e.y, e.z, e.splineWidth, e.splineHeight)
          const T = worldToBoard(homography, t.x, t.y, t.z)
          const H = worldToBoard(homography, h.x, h.y, h.z)
          const A = worldToBoard(homography, a.x, a.y, a.z)
          if (pointInTri(boardX, boardY, T, H, A)) return e.id
        }
        return null
      }
      // Raycast with the full-board (no view-offset) camera so board coords from
      // clientToBoard map directly — pan/zoom is already baked into those coords.
      const ndc = new THREE.Vector2((boardX / BOARD_WIDTH) * 2 - 1, -(boardY / BOARD_HEIGHT) * 2 + 1)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, ctx.pickCamera)
      const hits = ray.intersectObjects([...ctx.meshes.values()], false)
      for (const h of hits) {
        const id = (h.object.userData as { id?: string }).id
        if (id) return id
      }
      return null
    },
  }))

  // The canvas is pointer-transparent: all interaction is driven by the
  // InteractiveBoard (which calls `pick` for selection).
  return <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
})

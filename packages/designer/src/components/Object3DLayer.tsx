import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { BOARD_WIDTH, BOARD_HEIGHT, type Object3DElement } from '@youcoach-board/core'
import { makeArrow3DCamera } from '../lib/arrow3d'
import { applyViewCamera, makeCalibratedCamera, type PosedCamera } from '../lib/field-camera'
import { SUN_POSITION, SUN_TARGET } from '../lib/field3d'
import { buildObject3D } from '../lib/objects3d'

/** Imperative API to hit-test 3D objects (they aren't SVG, so InteractiveBoard
 *  can't click them through the normal element handlers). */
export interface Object3DLayerHandle {
  /** The topmost object whose mesh is under the given board point, or null. */
  pick: (boardX: number, boardY: number) => string | null
}

interface Props {
  elements: Object3DElement[]
  selectedIds: string[]
  viewport: { zoom: number; panX: number; panY: number }
  /** The active field camera (background.field3d / a posed field). Objects render
   *  through it so they sit on the pitch; null → the default fixed near-ortho cam. */
  camera: PosedCamera | null
  svgRef: React.RefObject<SVGSVGElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  fixedCam: THREE.PerspectiveCamera
  calibCam: THREE.PerspectiveCamera
  meshes: Map<string, THREE.Mesh>
}

export const Object3DLayer = forwardRef<Object3DLayerHandle, Props>(function Object3DLayer({ elements, selectedIds, viewport, camera, svgRef, containerRef }, ref) {
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
    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x4a7a3a, 0.7))
    const sun = new THREE.DirectionalLight(0xffffff, 2.6)
    sun.position.copy(SUN_POSITION)
    sun.target.position.copy(SUN_TARGET)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 400
    const d = 80
    sun.shadow.camera.left = -d
    sun.shadow.camera.right = d
    sun.shadow.camera.top = d
    sun.shadow.camera.bottom = -d
    sun.shadow.bias = -0.0004
    scene.add(sun)
    scene.add(sun.target)
    // Transparent ground that only catches the objects' soft shadows.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.22 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    ctxRef.current = { renderer, scene, fixedCam: makeArrow3DCamera(), calibCam: new THREE.PerspectiveCamera(), meshes: new Map() }
    return ctxRef.current
  }

  // Add / update / remove meshes to mirror `elements`.
  function syncMeshes(ctx: Ctx) {
    const dispose = (mesh: THREE.Mesh) => {
      ctx.scene.remove(mesh)
      // Dispose every child's material, and any child geometry that isn't the
      // parent's (e.g. a builder's crease-edge LineSegments own an EdgesGeometry;
      // the outline shells share the parent geometry, disposed once below).
      mesh.traverse((o) => {
        if (o === mesh) return
        const c = o as THREE.Mesh | THREE.LineSegments
        if (c.material) (c.material as THREE.Material).dispose()
        if (c.geometry && c.geometry !== mesh.geometry) c.geometry.dispose()
      })
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    const seen = new Set<string>()
    for (const e of elements) {
      seen.add(e.id)
      let mesh = ctx.meshes.get(e.id)
      if (!mesh || mesh.userData.objectId !== e.objectId) {
        if (mesh) dispose(mesh)
        mesh = buildObject3D(e.objectId)
        // Selection outline: an enlarged, back-faces-only silhouette of the same
        // geometry in the selection colour — a clean coloured ring around the
        // object with no post-processing. Toggled visible when selected.
        const outline = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x2a6cff, side: THREE.BackSide }))
        outline.name = 'outline'
        outline.scale.setScalar(1.09)
        outline.visible = false
        mesh.add(outline)
        ctx.scene.add(mesh)
        ctx.meshes.set(e.id, mesh)
      }
      // Scale by size, then lift by the geometry's actual base so it rests on
      // the ground. Objects vary in height (the cone is short, not a full unit
      // cube), so a fixed size/2 lift would leave short ones floating.
      mesh.scale.setScalar(e.size)
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const baseY = mesh.geometry.boundingBox ? -mesh.geometry.boundingBox.min.y : 0.5
      mesh.position.set(e.x, baseY * e.size, e.z)
      mesh.rotation.set(0, e.rotation, 0)
      const outline = mesh.getObjectByName('outline')
      if (outline) outline.visible = selectedIds.includes(e.id)
      mesh.userData = { id: e.id, objectId: e.objectId }
    }
    for (const [id, mesh] of ctx.meshes) {
      if (seen.has(id)) continue
      dispose(mesh)
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
    if (camera) {
      applyViewCamera(ctx.calibCam, camera, viewport)
      ctx.renderer.render(ctx.scene, ctx.calibCam)
    } else {
      const zoom = viewport.zoom || 1
      ctx.fixedCam.setViewOffset(BOARD_WIDTH, BOARD_HEIGHT, viewport.panX, viewport.panY, BOARD_WIDTH / zoom, BOARD_HEIGHT / zoom)
      ctx.fixedCam.updateProjectionMatrix()
      ctx.renderer.render(ctx.scene, ctx.fixedCam)
    }
  }

  const renderRef = useRef(render)
  useEffect(() => {
    renderRef.current = render
  })

  useEffect(() => {
    render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectedIds, viewport, camera])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => renderRef.current())
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    pick(boardX: number, boardY: number): string | null {
      const ctx = ctxRef.current
      if (!ctx) return null
      // Board coords are full-board (pan/zoom already baked), so raycast with a
      // no-view-offset camera.
      const cam = camera ? makeCalibratedCamera(camera) : ctx.fixedCam
      const ndc = new THREE.Vector2((boardX / BOARD_WIDTH) * 2 - 1, -(boardY / BOARD_HEIGHT) * 2 + 1)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, cam)
      const hits = ray.intersectObjects([...ctx.meshes.values()], false)
      for (const h of hits) {
        const id = (h.object.userData as { id?: string }).id
        if (id) return id
      }
      return null
    },
  }))

  // Pointer-transparent; InteractiveBoard drives interaction (calls `pick`).
  return <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
})

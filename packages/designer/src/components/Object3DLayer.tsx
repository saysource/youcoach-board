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
  meshes: Map<string, THREE.Object3D>
}

// The selection highlight, added as a hidden child named 'outline'. A single
// Mesh gets a back-faces-only inflated silhouette (a clean coloured ring); a
// Group (goal) gets a wireframe bounding box, since it has no single geometry.
const SELECT_COLOR = 0x2a6cff
function selectionOutline(obj: THREE.Object3D, box: THREE.Box3): THREE.Object3D {
  const asMesh = obj as THREE.Mesh
  let outline: THREE.Object3D
  if (asMesh.isMesh && asMesh.geometry) {
    outline = new THREE.Mesh(asMesh.geometry, new THREE.MeshBasicMaterial({ color: SELECT_COLOR, side: THREE.BackSide }))
    outline.scale.setScalar(1.09)
  } else {
    const size = box.getSize(new THREE.Vector3())
    outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), new THREE.LineBasicMaterial({ color: SELECT_COLOR }))
    outline.position.copy(box.getCenter(new THREE.Vector3()))
  }
  outline.name = 'outline'
  outline.visible = false
  return outline
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
    // Clip anything below the pitch (y < 0): the toon outline / selection shells
    // extend slightly past a mesh in every direction, so their underside would
    // otherwise poke below the grass and read as the object being "under" it.
    renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)]
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

  // Add / update / remove objects to mirror `elements`. An object is either a
  // single Mesh (ball/cube/cone…) or a Group (the multi-part goals).
  function syncMeshes(ctx: Ctx) {
    const dispose = (obj: THREE.Object3D) => {
      ctx.scene.remove(obj)
      // Free geometry + material of every descendant (Group has no geometry of
      // its own, so we can't rely on obj.geometry). Shared/singleton textures
      // (the toon ramp) aren't touched by Material.dispose(), so they survive.
      obj.traverse((o) => {
        const m = o as Partial<THREE.Mesh>
        m.geometry?.dispose()
        const mat = (o as THREE.Mesh).material
        if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose())
      })
    }
    const seen = new Set<string>()
    for (const e of elements) {
      seen.add(e.id)
      let obj = ctx.meshes.get(e.id)
      if (!obj || obj.userData.objectId !== e.objectId) {
        if (obj) dispose(obj)
        obj = buildObject3D(e.objectId)
        // Local-space bounds (object is untransformed here): used to lift it onto
        // the ground and to size a Group's selection box.
        obj.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(obj)
        // Rest the VISIBLE mesh on the ground. For a single mesh use its own
        // geometry (the box also includes the slightly-larger outline/crease
        // shells, which would otherwise lift it a few cm and leave a floating
        // gap). Groups (goals) have no single geometry → use the full box.
        const asMesh = obj as THREE.Mesh
        if (asMesh.isMesh && asMesh.geometry) {
          if (!asMesh.geometry.boundingBox) asMesh.geometry.computeBoundingBox()
          obj.userData.baseMinY = asMesh.geometry.boundingBox!.min.y
        } else {
          obj.userData.baseMinY = box.min.y
        }
        obj.add(selectionOutline(obj, box))
        ctx.scene.add(obj)
        ctx.meshes.set(e.id, obj)
      }
      // Scale by size, then lift by the actual base so it rests on the ground
      // (objects vary in height — a fixed size/2 lift would float short ones).
      obj.scale.setScalar(e.size)
      const baseMinY = (obj.userData.baseMinY as number) ?? -0.5
      obj.position.set(e.x, -baseMinY * e.size, e.z)
      obj.rotation.set(0, e.rotation, 0)
      const outline = obj.getObjectByName('outline')
      if (outline) outline.visible = selectedIds.includes(e.id)
      obj.userData.id = e.id
      obj.userData.objectId = e.objectId
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
      // Recursive: goals are Groups, so hits land on child parts (posts, net…).
      // Walk up to the root that carries the element id.
      const hits = ray.intersectObjects([...ctx.meshes.values()], true)
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object
        while (o && !(o.userData as { id?: string }).id) o = o.parent
        const id = o && (o.userData as { id?: string }).id
        if (id) return id
      }
      return null
    },
  }))

  // Pointer-transparent; InteractiveBoard drives interaction (calls `pick`).
  return <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
})

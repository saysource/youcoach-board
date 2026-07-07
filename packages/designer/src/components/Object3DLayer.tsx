import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { BOARD_WIDTH, BOARD_HEIGHT, type Object3DElement } from '@youcoach-board/core'
import { makeArrow3DCamera } from '../lib/arrow3d'
import { applyViewCamera, makeCalibratedCamera, type PosedCamera } from '../lib/field-camera'
import { SUN_POSITION, SUN_TARGET, buildGoalsOverlay } from '../lib/field3d'
import type { FieldType, TrainingLayout } from '@youcoach-board/core'
import { buildObject3D, isObject3DColorable, isObject3DGoal, isObject3DMultiColor, isObject3DPlayer, object3dDefaultColor, onObject3DAssetReady, playerKitTexture, recolorObject3DSlots } from '../lib/objects3d'

// A 3D player is near real human height, so it reads well at a modest multiplier;
// beyond this the materials scale would make players cartoonishly large (esp. on
// the small training area). Cones/hurdles/etc. keep the full materials scale.
const PLAYER_SCALE_CAP = 4

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
  /** Global display multiplier for placed objects (background.objectScale). */
  objectScale: number
  /** The field's goals, re-rendered here as an ALWAYS-ON-TOP overlay so placed 3D
   *  objects never occlude the goal frame (the field layer draws the base + shadow). */
  fieldType: FieldType
  layout: TrainingLayout
  showGoals: boolean
  svgRef: React.RefObject<SVGSVGElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  fixedCam: THREE.PerspectiveCamera
  calibCam: THREE.PerspectiveCamera
  meshes: Map<string, THREE.Object3D>
  composer: EffectComposer
  renderPass: RenderPass
  outlinePass: OutlinePass
  goals: THREE.Group | null
  goalsKey: string
}

const SELECT_COLOR = 0x2a6cff

export const Object3DLayer = forwardRef<Object3DLayerHandle, Props>(function Object3DLayer({ elements, selectedIds, viewport, camera, objectScale, fieldType, layout, showGoals, svgRef, containerRef }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<Ctx | null>(null)

  function ensureCtx(): Ctx | null {
    if (ctxRef.current) return ctxRef.current
    const canvas = canvasRef.current
    if (!canvas) return null
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x000000, 0) // transparent so the field shows through the composer
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

    const fixedCam = makeArrow3DCamera()
    const calibCam = new THREE.PerspectiveCamera()

    // Post-processing: a proper screen-space selection outline (OutlinePass) —
    // uniform pixel width regardless of geometry, unlike an inverted-hull shell.
    // Multisampled target keeps the objects anti-aliased through the composer.
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4 }))
    composer.setPixelRatio(window.devicePixelRatio)
    const renderPass = new RenderPass(scene, fixedCam)
    renderPass.clearAlpha = 0
    composer.addPass(renderPass)
    const outlinePass = new OutlinePass(new THREE.Vector2(1, 1), scene, fixedCam)
    outlinePass.edgeStrength = 6
    outlinePass.edgeThickness = 1
    outlinePass.edgeGlow = 0
    outlinePass.pulsePeriod = 0
    outlinePass.visibleEdgeColor.set(SELECT_COLOR)
    outlinePass.hiddenEdgeColor.set(SELECT_COLOR)
    composer.addPass(outlinePass)
    composer.addPass(new OutputPass())

    ctxRef.current = { renderer, scene, fixedCam, calibCam, meshes: new Map(), composer, renderPass, outlinePass, goals: null, goalsKey: '' }
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
        // Rest the VISIBLE mesh on the ground. For a single mesh use its own
        // geometry (a full-object box also includes the slightly-larger outline/
        // crease shells, which would lift it a few cm and leave a floating gap).
        // Groups (goals) have no single geometry → use the full box.
        const asMesh = obj as THREE.Mesh
        if (obj.userData.originAtGround) {
          // Authored to sit on the ground via its own origin (e.g. the ball, whose
          // centre is ~0.10 m up) — keep that height instead of re-resting it.
          obj.userData.baseMinY = 0
        } else if (asMesh.isMesh && asMesh.geometry) {
          if (!asMesh.geometry.boundingBox) asMesh.geometry.computeBoundingBox()
          // Lift so the outline's underside clears the y=0 clip plane (the outline
          // dips ~outlineOffset below the mesh; ×1.4 gives a touch of clearance so
          // flat models like the ladder aren't sliced at the bottom).
          obj.userData.baseMinY = asMesh.geometry.boundingBox!.min.y - ((obj.userData.outlineOffset as number) ?? 0) * 1.4
        } else {
          obj.userData.baseMinY = new THREE.Box3().setFromObject(obj).min.y
        }
        ctx.scene.add(obj)
        ctx.meshes.set(e.id, obj)
      }
      // Effective scale: a global-tracking or custom multiplier over the real-size
      // mesh, floored at ×1 (never smaller than real). Goals are real-metric
      // structural objects, so they ignore the global "make materials bigger" scale.
      const rel = e.useGlobalSize ? 1 : e.size
      // Goals are real-metric structural objects (ignore the global scale). 3D
      // players are near real height, so they'd balloon at a high materials scale
      // (e.g. the training area's) — cap their multiplier so raising the materials
      // default enlarges cones/hurdles without turning players into giants.
      const mult = isObject3DPlayer(e.objectId) ? Math.min(objectScale, PLAYER_SCALE_CAP) : objectScale
      const scale = isObject3DGoal(e.objectId) ? Math.max(0.05, rel) : Math.max(1, rel * mult)
      obj.scale.setScalar(scale)
      const baseMinY = (obj.userData.baseMinY as number) ?? -0.5
      obj.position.set(e.x, -baseMinY * scale, e.z)
      obj.rotation.set(0, e.rotation, 0)
      obj.userData.id = e.id
      obj.userData.objectId = e.objectId
      // Live tint for colorable materials: recolor the body toon material only
      // (the root mesh) — outline/crease/decal children keep their own colours.
      if (isObject3DColorable(e.objectId)) {
        const m = (obj as THREE.Mesh).material
        if (m instanceof THREE.MeshToonMaterial) {
          const c = e.fill && e.fill !== 'transparent' ? e.fill : object3dDefaultColor(e.objectId)
          m.color.set(c)
        }
      }
      // Live per-part recolor for multi-material objects (flag pole: pole + flag).
      if (isObject3DMultiColor(e.objectId)) recolorObject3DSlots(obj, e.objectId, e.colors)
      // Live kit for 3D players: swap the material's atlas when the element's
      // recolor slots change. Cheap per sync — looks are cached + shared, and
      // while the base images still decode this returns the plain-atlas stand-in
      // (the asset-ready re-render then lands the real one).
      if (isObject3DPlayer(e.objectId)) {
        const m = (obj as THREE.Mesh).material
        if (m instanceof THREE.MeshToonMaterial) {
          const kit = playerKitTexture(e.objectId, e.colors)
          if (m.map !== kit) {
            m.map = kit
            m.needsUpdate = true
          }
        }
      }
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

  // The goals overlay (always-on-top copy of the field's goals). Rebuilt only when
  // the field type / training layout / visibility changes; not in `meshes`, so it's
  // never a pick target (goals aren't selectable).
  function syncGoals(ctx: Ctx) {
    const key = showGoals ? `${fieldType}|${layout}` : ''
    if (ctx.goalsKey === key) return
    if (ctx.goals) {
      ctx.scene.remove(ctx.goals)
      ctx.goals.traverse((o) => {
        const m = o as Partial<THREE.Mesh>
        m.geometry?.dispose()
        const mat = (o as THREE.Mesh).material
        if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose())
      })
    }
    ctx.goals = showGoals ? buildGoalsOverlay(fieldType, layout) : null
    if (ctx.goals) ctx.scene.add(ctx.goals)
    ctx.goalsKey = key
  }

  function render() {
    const ctx = ensureCtx()
    const canvas = canvasRef.current
    const rect = boardRect()
    if (!ctx || !canvas || !rect || rect.width < 1) return
    syncMeshes(ctx)
    syncGoals(ctx)
    canvas.style.left = `${rect.left}px`
    canvas.style.top = `${rect.top}px`
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.renderer.setSize(rect.width, rect.height, false)
    ctx.composer.setSize(rect.width, rect.height)
    let activeCam: THREE.PerspectiveCamera
    if (camera) {
      applyViewCamera(ctx.calibCam, camera, viewport)
      activeCam = ctx.calibCam
    } else {
      const zoom = viewport.zoom || 1
      ctx.fixedCam.setViewOffset(BOARD_WIDTH, BOARD_HEIGHT, viewport.panX, viewport.panY, BOARD_WIDTH / zoom, BOARD_HEIGHT / zoom)
      ctx.fixedCam.updateProjectionMatrix()
      activeCam = ctx.fixedCam
    }
    // Render through the composer so OutlinePass highlights the selection.
    ctx.renderPass.camera = activeCam
    ctx.outlinePass.renderCamera = activeCam
    ctx.outlinePass.selectedObjects = selectedIds.map((id) => ctx.meshes.get(id)).filter((o): o is THREE.Object3D => !!o)
    ctx.composer.render()
  }

  const renderRef = useRef(render)
  useEffect(() => {
    renderRef.current = render
  })

  useEffect(() => {
    render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectedIds, viewport, camera, objectScale, fieldType, layout, showGoals])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => renderRef.current())
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-render when a lazily-decoded asset (a player's kit texture) becomes ready —
  // the layer only renders on state changes, so the decode finishing wouldn't
  // otherwise repaint an already-placed player.
  useEffect(() => onObject3DAssetReady(() => renderRef.current()), [])

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
  return <canvas ref={canvasRef} data-layer="object3d" style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
})

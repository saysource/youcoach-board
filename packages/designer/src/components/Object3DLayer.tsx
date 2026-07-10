import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { BOARD_WIDTH, BOARD_HEIGHT, type Object3DElement, type Arrow3DElement } from '@youcoach-board/core'
import { createArrowGeometry, makeArrow3DCamera } from '../lib/arrow3d'
import { applyViewCamera, makeCalibratedCamera, type PosedCamera } from '../lib/field-camera'
import { SUN_POSITION, SUN_TARGET, FLOODLIGHTS, makeFloodlight, buildGoalsOverlay } from '../lib/field3d'
import type { FieldType, TrainingLayout } from '@youcoach-board/core'
import { buildObject3D, buildTokenDisc, isObject3DColorable, isObject3DGoal, isObject3DMultiColor, isObject3DPlayer, object3dDefaultColor, onObject3DAssetReady, playerKitTexture, recolorObject3DSlots, setTokenDiscFace, type TokenFaceStyle } from '../lib/objects3d'


/** Imperative API to hit-test 3D objects (they aren't SVG, so InteractiveBoard
 *  can't click them through the normal element handlers). */
export interface Object3DLayerHandle {
  /** The topmost object whose mesh is under the given board point, or null. */
  pick: (boardX: number, boardY: number) => string | null
}

/** A token rendered as a 3D disc (background.tokens3d): ground spot (metres),
 *  real diameter, and the badge style painted on the face. */
export interface Token3D {
  id: string
  x: number
  z: number
  sizeM: number
  /** The element's opacity (transform.opacity), applied to the disc material. */
  opacity: number
  style: TokenFaceStyle
}

interface Props {
  elements: Object3DElement[]
  /** Disc tokens to render as 3D pucks ([] unless background.tokens3d). */
  tokens?: Token3D[]
  /** 3D arrows, rendered IN THIS SCENE (real-camera mode) so they share the depth
   *  buffer with objects/tokens — an arrow can pass over a token or behind a
   *  player. [] in the legacy homography/fixed modes (Arrow3DLayer handles those). */
  arrows?: Arrow3DElement[]
  selectedIds: string[]
  /** While a player pose is dragged from the drawer: the id of the player a
   *  drop would REPLACE — its outline shows RED instead of the selection blue. */
  replaceTargetId?: string | null
  /** Ids currently under the eraser (queued for deletion) — rendered at half
   *  opacity as a "will be erased" cue. */
  erasingIds?: Set<string>
  viewport: { zoom: number; panX: number; panY: number }
  /** The active field camera (background.field3d / a posed field). Objects render
   *  through it so they sit on the pitch; null → the default fixed near-ortho cam. */
  camera: PosedCamera | null
  /** Global display multiplier for placed objects (background.objectScale). */
  objectScale: number
  /** Lower bound for the effective object scale. 1 on a real 3D field (objects are
   *  never smaller than real size); relaxed on legacy 2D backgrounds, where matching
   *  the 2D figures' size can need a sub-real multiplier. */
  minScale?: number
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
  outlineCam: THREE.PerspectiveCamera
  meshes: Map<string, THREE.Object3D>
  tokenMeshes: Map<string, THREE.Mesh>
  arrowMeshes: Map<string, THREE.Mesh>
  composer: EffectComposer
  renderPass: RenderPass
  outlinePass: OutlinePass
  goals: THREE.Group | null
  goalsKey: string
}

const SELECT_COLOR = 0x2a6cff
const REPLACE_COLOR = 0xe03131 // drop-would-replace preview

/* ---- 3D arrows (ported from Arrow3DLayer for the shared-scene path) --------- */

// Track the geometry inputs so we only rebuild the (expensive) arrow mesh when a
// shape field actually changes — moves/rotations/colour just update transforms.
interface ArrowMeshData {
  splineWidth: number
  splineHeight: number
  splineLength: number
  stickWidth: number
  tipWidth: number
  thickness: number
  tipLength: number
}

function arrowShapeChanged(d: ArrowMeshData, e: Arrow3DElement): boolean {
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

function arrowMeshData(e: Arrow3DElement): ArrowMeshData {
  return { splineWidth: e.splineWidth, splineHeight: e.splineHeight, splineLength: e.splineLength, stickWidth: e.stickWidth, tipWidth: e.tipWidth, thickness: e.thickness, tipLength: e.tipLength }
}

// Accept #rgb / #rrggbb (ignore any alpha channel — opacity is separate).
function arrowHexColor(fill: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill.trim())
  if (!m) return 0xff0000
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  return parseInt(hex, 16)
}

/** Dim (or restore) every material under `obj` — a per-object opacity cue. Safe:
 *  buildObject3D gives each object its own material instances (only textures are
 *  shared), so this never bleeds onto other objects. */
function setObjectDim(obj: THREE.Object3D, dim: boolean) {
  obj.traverse((o) => {
    const mat = (o as THREE.Mesh).material
    if (!mat) return
    const arr = Array.isArray(mat) ? mat : [mat]
    for (const m of arr) {
      const opacity = dim ? 0.5 : 1
      if (m.opacity !== opacity || m.transparent !== dim) {
        m.opacity = opacity
        m.transparent = dim
        m.needsUpdate = true
      }
    }
  })
}

export const Object3DLayer = forwardRef<Object3DLayerHandle, Props>(function Object3DLayer({ elements, tokens = [], arrows = [], selectedIds, replaceTargetId = null, erasingIds, viewport, camera, objectScale, minScale = 1, fieldType, layout, showGoals, svgRef, containerRef }, ref) {
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
    // Four shadowless stadium pylons (illumination only — matches the field
    // scene, and puts glancing highlights on the token pucks).
    for (const f of FLOODLIGHTS) {
      const spot = makeFloodlight(f)
      scene.add(spot)
      scene.add(spot.target)
    }
    // NOTE: the centre glow (makeCenterLight) lives ONLY in the field scene,
    // where background.centerLight drives it — objects/players must not receive
    // it, or anything placed mid-field gets overexposed (and thumbnails, shot at
    // pitch centre, come out washed).
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
    // Layer 1 carries visual-only helpers (the tokens' contact shadows): the
    // render cameras see it, the OutlinePass mask camera (layer 0 only) doesn't.
    fixedCam.layers.enable(1)
    calibCam.layers.enable(1)

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

    ctxRef.current = { renderer, scene, fixedCam, calibCam, outlineCam: new THREE.PerspectiveCamera(), meshes: new Map(), tokenMeshes: new Map(), arrowMeshes: new Map(), composer, renderPass, outlinePass, goals: null, goalsKey: '' }
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
      // mesh, floored at minScale (×1 on a 3D field — never smaller than real;
      // relaxed on legacy 2D backgrounds to allow figure-size parity).
      const rel = e.useGlobalSize ? 1 : e.size
      // Goals are real-metric structural objects (ignore the global scale). 3D
      // players scale with the same materials multiplier as cones/hurdles/etc., so
      // players and materials stay the same relative size (aligned defaults).
      const mult = objectScale
      const scale = isObject3DGoal(e.objectId) ? Math.max(0.05, rel) : Math.max(minScale, rel * mult)
      obj.scale.setScalar(scale)
      const baseMinY = (obj.userData.baseMinY as number) ?? -0.5
      obj.position.set(e.x, -baseMinY * scale, e.z)
      obj.rotation.set(0, e.rotation, 0)
      setObjectDim(obj, !!erasingIds?.has(e.id))
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

  // Mirror `tokens` into disc meshes: face texture swaps in place; position and
  // scale follow the token; the camera-facing rotation is applied in render().
  function syncTokens(ctx: Ctx) {
    const seen = new Set<string>()
    for (const t of tokens) {
      seen.add(t.id)
      let mesh = ctx.tokenMeshes.get(t.id)
      if (!mesh) {
        mesh = buildTokenDisc(t.style)
        ctx.scene.add(mesh)
        ctx.tokenMeshes.set(t.id, mesh)
      } else {
        setTokenDiscFace(mesh, t.style)
      }
      mesh.position.set(t.x, 0, t.z)
      mesh.scale.setScalar(Math.max(0.05, t.sizeM))
      mesh.userData.id = t.id
      // Element opacity × the eraser's half-opacity cue, applied directly (the
      // generic setObjectDim only knows the 0.5/1 dim, not per-element opacity).
      const op = t.opacity * (erasingIds?.has(t.id) ? 0.5 : 1)
      const mat = mesh.material as THREE.MeshLambertMaterial
      if (mat.transparent !== op < 1) {
        mat.transparent = op < 1
        mat.needsUpdate = true
      }
      mat.opacity = op
      // The contact-shadow quad fades with its token (its material is per-mesh;
      // the crescent texture's own alpha is multiplied by this opacity).
      const shadow = mesh.getObjectByName('token-contact-shadow') as THREE.Mesh | undefined
      if (shadow) (shadow.material as THREE.MeshBasicMaterial).opacity = op
      mesh.visible = op > 0
      mesh.castShadow = op > 0
    }
    for (const [id, mesh] of ctx.tokenMeshes) {
      if (seen.has(id)) continue
      ctx.scene.remove(mesh)
      mesh.geometry.dispose()
      const mat = mesh.material
      ;(Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose()) // face textures are cached, not disposed
      ctx.tokenMeshes.delete(id)
    }
  }

  // Mirror `arrows` into the shared scene (ported from Arrow3DLayer, real-camera
  // mode only) so arrows depth-test against objects/tokens/goals.
  function syncArrows(ctx: Ctx) {
    const seen = new Set<string>()
    for (const e of arrows) {
      seen.add(e.id)
      let mesh = ctx.arrowMeshes.get(e.id)
      const color = arrowHexColor(e.fill)
      if (!mesh) {
        const material = new THREE.MeshPhongMaterial({ color, flatShading: true })
        material.side = THREE.DoubleSide
        material.transparent = true
        mesh = new THREE.Mesh(createArrowGeometry(e.stickWidth, e.tipWidth, e.thickness, e.tipLength, e.splineWidth, e.splineHeight, e.splineLength), material)
        mesh.castShadow = true
        ctx.scene.add(mesh)
        ctx.arrowMeshes.set(e.id, mesh)
      } else if (arrowShapeChanged(mesh.userData.data as ArrowMeshData, e)) {
        mesh.geometry.dispose()
        mesh.geometry = createArrowGeometry(e.stickWidth, e.tipWidth, e.thickness, e.tipLength, e.splineWidth, e.splineHeight, e.splineLength)
      }
      // Rotate about the tail, place at (x,z); push the local origin so the tail
      // sits at (x,z) (head at -splineWidth in local space).
      mesh.position.set(e.x, 0, e.z)
      mesh.rotation.set(0, e.y, 0)
      mesh.translateZ(-e.splineWidth)
      const mat = mesh.material as THREE.MeshPhongMaterial
      mat.color.setHex(color)
      const dim = erasingIds?.has(e.id) ? 0.5 : 1
      mat.opacity = e.opacity * dim
      mesh.castShadow = e.opacity > 0
      mesh.visible = e.opacity > 0
      mesh.userData = { id: e.id, data: arrowMeshData(e) }
    }
    for (const [id, mesh] of ctx.arrowMeshes) {
      if (seen.has(id)) continue
      ctx.scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      ctx.arrowMeshes.delete(id)
    }
  }

  function render() {
    const ctx = ensureCtx()
    const canvas = canvasRef.current
    const rect = boardRect()
    if (!ctx || !canvas || !rect || rect.width < 1) return
    syncMeshes(ctx)
    syncTokens(ctx)
    syncArrows(ctx)
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
    // Face the token discs' texture toward the camera (number upright on screen):
    // yaw from the camera's ground-projected view direction.
    if (ctx.tokenMeshes.size) {
      const dir = new THREE.Vector3()
      activeCam.getWorldDirection(dir)
      const yaw = Math.atan2(dir.x, dir.z) + Math.PI // texture-up toward the top of the screen
      for (const mesh of ctx.tokenMeshes.values()) mesh.rotation.y = yaw
    }
    // Render through the composer so OutlinePass highlights the selection.
    ctx.renderPass.camera = activeCam
    // The outline mask renders through a layer-0-only copy of the camera, so a
    // selected token's contact-shadow quad (layer 1) never joins the silhouette.
    ctx.outlineCam.copy(activeCam)
    ctx.outlineCam.layers.set(0)
    ctx.outlinePass.renderCamera = ctx.outlineCam
    // Drop-replace preview: while a drawer drag hovers a replaceable player,
    // the outline turns RED and highlights only that player; otherwise the
    // normal blue selection outline.
    const replaceMesh = replaceTargetId ? ctx.meshes.get(replaceTargetId) : undefined
    const outlineColor = replaceMesh ? REPLACE_COLOR : SELECT_COLOR
    ctx.outlinePass.visibleEdgeColor.set(outlineColor)
    ctx.outlinePass.hiddenEdgeColor.set(outlineColor)
    ctx.outlinePass.selectedObjects = replaceMesh
      ? [replaceMesh]
      : selectedIds.map((id) => ctx.meshes.get(id) ?? ctx.tokenMeshes.get(id)).filter((o): o is THREE.Object3D => !!o)
    ctx.composer.render()
  }

  const renderRef = useRef(render)
  useEffect(() => {
    renderRef.current = render
  })

  useEffect(() => {
    render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, tokens, arrows, selectedIds, replaceTargetId, erasingIds, viewport, camera, objectScale, minScale, fieldType, layout, showGoals])

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
      // Walk up to the root that carries the element id. Token discs and 3D
      // arrows are picked here too — 3D-object-based selection for all of them.
      const hits = ray.intersectObjects([...ctx.meshes.values(), ...ctx.tokenMeshes.values(), ...ctx.arrowMeshes.values()], true)
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

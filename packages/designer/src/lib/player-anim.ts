// Skeletal animation for 3D players — used during animation PLAYBACK only.
//
// While editing, players stay the static baked meshes (objects3d.ts). When a
// player element carries the transient `anim` hint, Object3DLayer swaps its
// mesh for a SKINNED twin built here from the consolidated Mixamo asset
// (assets/players3d/players3d_mixamo.glb: the 6 characters, each on its own
// rig, plus every animation clip). Poses are applied DETERMINISTICALLY — the
// hint carries the clip name + absolute clip time, we set the action times and
// evaluate with mixer.update(0) — so playback stays scrub-safe and the layer
// remains a pure mirror of the doc (no wall clock down here).

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Object3DElement } from '@youcoach-board/core'
import { toonGradientMap } from './toon'
import { isObject3DPlayer, notifyObject3DAssetReady, playerKitTexture } from './objects3d'
import { PLAYERS3D_MIXAMO_GLB_BASE64 } from './players3d-mixamo-glb'

// ── Clip registry ────────────────────────────────────────────────────────────
// Semantic ids → GLB clip names + the metadata the playback rules need.
// `nominalSpeed` = the ground speed (m/s) the locomotion cycle was authored
// for (stride matching: playback rate = actual speed / nominal). `contactTime`
// = the foot-strikes-ball moment (seconds into the clip) for one-shots.

export interface PlayerClipMeta {
  clip: string
  loop: boolean
  nominalSpeed?: number
  contactTime?: number
  /** Use only this [start, end] slice of the authored clip (seconds; trimmed at
   *  load, times re-based to 0 — contactTime is relative to the window). */
  window?: [number, number]
  /** Strip the root's HORIZONTAL motion at load (pin the hips' ground-plane
   *  components to their first-frame values, keep the vertical bob) — for
   *  clips authored walking forward, which would double-move against our own
   *  path translation. */
  inPlace?: boolean
}

export const PLAYER_CLIPS: Record<string, PlayerClipMeta> = {
  idle: { clip: 'Standing Idle', loop: true },
  gkIdle: { clip: 'Goalkeeper Idle', loop: true },
  jog: { clip: 'Jog Forward', loop: true, nominalSpeed: 2.4 },
  run: { clip: 'Standard Run', loop: true, nominalSpeed: 5.0 },
  // Authored WALKING forward (+4.4 units of root travel) — pinned in place.
  dribble: { clip: 'Dribble', loop: true, nominalSpeed: 2.6, inPlace: true },
  pass: { clip: 'Soccer Pass', loop: false, contactTime: 0.9 }, // 1.63 s clip
  // 'Kick Soccerball' (0.6 s) barely moves the body — the shot uses the far
  // more expressive strike-in-stride clip (1.33 s, in-place, contact ≈ 0.45).
  kick: { clip: 'Strike Foward Jog', loop: false, contactTime: 0.45 },
  // The authored 5.17 s clip walks to the ball first: keep only the trap —
  // frames 25–45 at 30 fps (user-picked in Blender) — pinned in place.
  // contactTime just inside the window's end: the whole selected range plays
  // and finishes as the ball arrives.
  receive: { clip: 'Receive Soccerball', loop: false, contactTime: 0.65, window: [25 / 30, 45 / 30], inPlace: true },
}

const metaByClip = new Map(Object.values(PLAYER_CLIPS).map((m) => [m.clip, m]))

// ── Character lookup ─────────────────────────────────────────────────────────
// Which skinned character a player objectId animates as. Base players map to
// their own body; the static pose_* variants were baked on the B characters
// (goalkeeper poses on the C ones) — see scripts/bundle-glbs.mjs.

// Keys are NORMALIZED node names (the GLB's skinned-mesh nodes are 'Mx Man A'
// … — GLTFLoader sanitizes them, so match on lowercase alphanumerics only).
const CHARACTER_MESH: Record<string, string> = {
  player_man_a: 'mxmana',
  player_man_b: 'mxmanb',
  player_man_c: 'mxmanc',
  player_woman_a: 'mxwomana',
  player_woman_b: 'mxwomanb',
  player_woman_c: 'mxwomanc',
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function characterMeshName(objectId: string): string | null {
  if (CHARACTER_MESH[objectId]) return CHARACTER_MESH[objectId]
  if (objectId.startsWith('pose_gk_man_')) return CHARACTER_MESH.player_man_c
  if (objectId.startsWith('pose_gk_woman_')) return CHARACTER_MESH.player_woman_c
  if (objectId.startsWith('pose_man_')) return CHARACTER_MESH.player_man_b
  if (objectId.startsWith('pose_woman_')) return CHARACTER_MESH.player_woman_b
  return null
}

/** The idle semantic for a player id (goalkeepers get the GK idle). */
export function playerIdleClip(objectId: string): string {
  return objectId.startsWith('pose_gk_') ? PLAYER_CLIPS.gkIdle.clip : PLAYER_CLIPS.idle.clip
}

// ── Loading ──────────────────────────────────────────────────────────────────
// The 4 MB asset parses lazily on first Play. Each character's ARMATURE (the
// top-level node holding its rig + skinned mesh) becomes a template; instances
// are SkeletonUtils clones of it. The mixer must see exactly ONE rig (all six
// share mixamorig:* bone names — clips bind by name), hence per-character
// templates rather than whole-scene clones.

let templates: Map<string, THREE.Object3D> | null = null
let clips: THREE.AnimationClip[] = []
// Clips were exported against ONE rig's bone names — and the six rigs share
// bone names, so the glTF DEDUPLICATES them with _1/_2… suffixes per rig. A
// clip therefore only binds to "its" rig; for every other character we rewrite
// the track names to that rig's own (suffixed) bone names. Cached per
// character; the rewritten tracks SHARE the keyframe arrays (no data copies).
const clipsByCharacter = new Map<string, THREE.AnimationClip[]>()
let loading = false

const stripDedup = (name: string) => name.replace(/_\d+$/, '')

function characterClips(key: string, rig: THREE.Object3D): THREE.AnimationClip[] {
  let out = clipsByCharacter.get(key)
  if (out) return out
  const byBase = new Map<string, string>()
  rig.traverse((o) => {
    if ((o as THREE.Bone).isBone) byBase.set(stripDedup(o.name), o.name)
  })
  out = clips.map((clip) => {
    const tracks = clip.tracks.map((tr) => {
      const dot = tr.name.lastIndexOf('.')
      const node = tr.name.slice(0, dot)
      const target = byBase.get(stripDedup(node))
      if (!target || target === node) return tr
      const c = Object.assign(Object.create(Object.getPrototypeOf(tr)) as THREE.KeyframeTrack, tr)
      c.name = target + tr.name.slice(dot)
      return c
    })
    return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode)
  })
  clipsByCharacter.set(key, out)
  return out
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/** Apply a clip's registry post-processing: trim to its `window` (times
 *  re-based to 0) and/or pin the root's horizontal motion (`inPlace`). The
 *  hips-position track is in the rig's Blender-local space (Z-up: x/y =
 *  ground plane, z = up), so pinning components 0 and 1 keeps the vertical
 *  bob while removing the authored travel. */
function processClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const meta = metaByClip.get(clip.name)
  if (!meta || (!meta.window && !meta.inPlace)) return clip
  const [w0, w1] = meta.window ?? [0, clip.duration]
  const tracks = clip.tracks.map((tr) => {
    let times = Array.from(tr.times)
    let values = Array.from(tr.values)
    const stride = tr.getValueSize()
    // The in-place reference is the clip's FRAME-0 hips position (the rig
    // origin), captured BEFORE trimming — a window that starts mid-walk would
    // otherwise pin the player at the walked-to spot (teleported off origin).
    const ref: [number, number] = [values[0], values[1]]
    if (meta.window) {
      const keep: number[] = []
      for (let i = 0; i < times.length; i++) if (times[i] >= w0 - 1e-3 && times[i] <= w1 + 1e-3) keep.push(i)
      if (keep.length === 0) keep.push(0)
      times = keep.map((i) => Math.max(0, times[i] - w0))
      values = keep.flatMap((i) => values.slice(i * stride, (i + 1) * stride))
    }
    if (meta.inPlace && stride === 3 && tr.name.includes('Hips') && tr.name.endsWith('.position')) {
      for (let k = 0; k < times.length; k++) {
        values[k * 3] = ref[0]
        values[k * 3 + 1] = ref[1]
      }
    }
    const TrackType = Object.getPrototypeOf(tr).constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack
    return new TrackType(tr.name, times, values)
  })
  return new THREE.AnimationClip(clip.name, meta.window ? w1 - w0 : clip.duration, tracks, clip.blendMode)
}

/** Kick the async parse (idempotent). Subscribers of onObject3DAssetReady
 *  re-render when it lands. */
export function ensurePlayerAnimLoaded(): void {
  if (templates || loading) return
  loading = true
  new GLTFLoader().parse(
    base64ToArrayBuffer(PLAYERS3D_MIXAMO_GLB_BASE64),
    '',
    (gltf) => {
      const map = new Map<string, THREE.Object3D>()
      gltf.scene.updateMatrixWorld(true)
      gltf.scene.traverse((o) => {
        if (!(o as THREE.SkinnedMesh).isSkinnedMesh) return
        // The template is the mesh's top-level ancestor (its armature node).
        let root: THREE.Object3D = o
        while (root.parent && root.parent !== gltf.scene) root = root.parent
        map.set(normName(o.name), root)
      })
      clips = gltf.animations.map(processClip)
      templates = map
      if (map.size === 0) console.warn('players3d_mixamo: no skinned meshes found')
      notifyObject3DAssetReady()
    },
    (err) => {
      loading = false
      console.warn('players3d_mixamo failed to parse', err)
    },
  )
}

export function playerAnimReady(): boolean {
  return templates !== null
}

/** A clip's duration in seconds (fallback before the asset is parsed). */
export function clipDuration(clipName: string, fallback = 1.2): number {
  const c = clips.find((x) => x.name === clipName)
  return c ? c.duration : fallback
}

/** Whether this element should render as its skinned twin right now. */
export function wantsSkinnedPlayer(e: Object3DElement): boolean {
  return !!e.anim && isObject3DPlayer(e.objectId)
}

// ── Instances ────────────────────────────────────────────────────────────────

/** Build a skinned player instance (null until the asset is parsed). The clone
 *  SHARES geometry with the template — the layer must not dispose it. */
export function buildSkinnedPlayer(objectId: string): THREE.Object3D | null {
  const meshName = characterMeshName(objectId)
  const tpl = meshName ? templates?.get(meshName) : null
  if (!tpl) return null
  const rig = cloneSkeleton(tpl)
  // The source scene lays the six rigs out side by side and carries Blender's
  // Z-up→Y-up rotation on each rig node: drop the layout offset, KEEP the axis
  // conversion, and wrap in a Group the layer can transform freely (setting
  // rotation on the rig itself would clobber the axis conversion).
  rig.position.set(0, 0, 0)
  rig.traverse((o) => {
    if (!(o as THREE.SkinnedMesh).isSkinnedMesh) return
    const m = o as THREE.SkinnedMesh
    m.castShadow = true
    // Bind-pose culling boxes don't follow the bones — never cull.
    m.frustumCulled = false
    m.material = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradientMap(), map: playerKitTexture(objectId) })
  })
  const root = new THREE.Group()
  root.add(rig)
  root.userData.mixer = new THREE.AnimationMixer(rig)
  root.userData.actions = new Map<string, THREE.AnimationAction>()
  root.userData.clips = characterClips(meshName!, rig)
  return root
}

/** Live kit swap for a skinned instance (same semantics as the static branch). */
export function setSkinnedPlayerKit(root: THREE.Object3D, objectId: string, colors?: Record<string, string>): void {
  const kit = playerKitTexture(objectId, colors)
  root.traverse((o) => {
    const m = (o as THREE.SkinnedMesh).isSkinnedMesh ? ((o as THREE.SkinnedMesh).material as THREE.Material) : null
    if (m instanceof THREE.MeshToonMaterial && m.map !== kit) {
      m.map = kit
      m.needsUpdate = true
    }
  })
}

/** Apply the transient `anim` hint: set each involved action's time + weight
 *  and evaluate once. Loops wrap their time; one-shots clamp on their last
 *  frame. Actions not involved this tick drop to weight 0 (they stay warm in
 *  the per-instance cache). */
export function applySkinnedPose(root: THREE.Object3D, anim: NonNullable<Object3DElement['anim']>): void {
  const mixer = root.userData.mixer as THREE.AnimationMixer | undefined
  const actions = root.userData.actions as Map<string, THREE.AnimationAction> | undefined
  const ownClips = (root.userData.clips as THREE.AnimationClip[] | undefined) ?? clips
  if (!mixer || !actions) return
  const w = anim.prev && anim.fade !== undefined ? Math.min(1, Math.max(0, anim.fade)) : 1
  const active: Array<{ clip: string; time: number; weight: number }> = [{ clip: anim.clip, time: anim.time, weight: w }]
  if (anim.prev && w < 1) active.push({ clip: anim.prev.clip, time: anim.prev.time, weight: 1 - w })
  const activeNames = new Set(active.map((a) => a.clip))
  for (const st of active) {
    let action = actions.get(st.clip)
    if (!action) {
      const clip = ownClips.find((c) => c.name === st.clip)
      if (!clip) continue
      action = mixer.clipAction(clip)
      action.play()
      actions.set(st.clip, action)
    }
    const dur = action.getClip().duration || 1
    const loop = metaByClip.get(st.clip)?.loop ?? true
    action.enabled = true
    action.setEffectiveWeight(st.weight)
    action.time = loop ? ((st.time % dur) + dur) % dur : Math.min(Math.max(0, st.time), dur - 1e-4)
  }
  for (const [name, action] of actions) if (!activeNames.has(name)) action.setEffectiveWeight(0)
  mixer.update(0)
}

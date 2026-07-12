// The "3D materials" registry: real three.js objects placed on the pitch
// (Object3DElement). Each builder returns a UNIT-sized mesh centered at the
// origin (nominal size 1 m); Object3DLayer scales it by the element's `size` and
// lifts it so it rests on the ground. Toon-shaded to match the goal's look.
//
// Framework-free (three.js only). Extend KNOWN_OBJECTS to grow the palette.

import * as THREE from 'three'
import { TOKEN_VIEW, TOKEN_STRIPE_PERIOD, TOKEN_SINGLE_STRIPE, TOKEN_CHECKER_SIZE, TOKEN_FONT, TOKEN_FONT_WEIGHT, TOKEN_GEOMETRY, type TokenFill } from '@youcoach-board/core'
import { toonGradientMap } from './toon'
import { buildGoal, type GoalStyle } from './goal'
import { TOKEN_DISC_GLB_BASE64 } from './token-disc-glb'
// Real modelled assets (Blender → glTF), embedded as base64 so they ship inside
// the JS bundle — no runtime fetch, so they stay embed-safe in every host (App2,
// bare page, …) regardless of asset-serving base paths.
import { CONE_GLB_BASE64 } from './cone-glb'
import { HIGH_CONE_GLB_BASE64 } from './high-cone-glb'
import { CONE_HURDLE_GLB_BASE64 } from './cone-hurdle-glb'
import { HURDLE_LOW_GLB_BASE64 } from './hurdle-low-glb'
import { HURDLE_GLB_BASE64 } from './hurdle-glb'
import { HURDLE_HIGH_GLB_BASE64 } from './hurdle-high-glb'
import { SPEED_LADDER_GLB_BASE64 } from './speed-ladder-glb'
import { MANNEQUIN_GLB_BASE64 } from './mannequin-glb'
import { WALL_MANNEQUIN_GLB_BASE64 } from './wall-mannequin-glb'
import { BALANCE_DOME_GLB_BASE64 } from './balance-dome-glb'
import { AGILITY_POLE_GLB_BASE64 } from './agility-pole-glb'
import { FLAG_POLE_GLB_BASE64 } from './flag-pole-glb'
import { BALL_GLB_BASE64 } from './ball-glb'
import { PLAYER_MAN_A_GLB_BASE64 } from './player-man-a-glb'
import { PLAYER_MAN_B_GLB_BASE64 } from './player-man-b-glb'
import { PLAYER_MAN_C_GLB_BASE64 } from './player-man-c-glb'
import { PLAYER_WOMAN_A_GLB_BASE64 } from './player-woman-a-glb'
import { PLAYER_WOMAN_B_GLB_BASE64 } from './player-woman-b-glb'
import { PLAYER_WOMAN_C_GLB_BASE64 } from './player-woman-c-glb'
import { POSE_MAN_IDLE_GLB_BASE64 } from './pose-man-idle-glb'
import { POSE_MAN_JOG_GLB_BASE64 } from './pose-man-jog-glb'
import { POSE_MAN_RUN_GLB_BASE64 } from './pose-man-run-glb'
import { POSE_MAN_KICK_GLB_BASE64 } from './pose-man-kick-glb'
import { POSE_MAN_LOW_KICK_GLB_BASE64 } from './pose-man-low-kick-glb'
import { POSE_MAN_PASS_GLB_BASE64 } from './pose-man-pass-glb'
import { POSE_MAN_RECEIVE_GLB_BASE64 } from './pose-man-receive-glb'
import { POSE_MAN_DRIBBLING_GLB_BASE64 } from './pose-man-dribbling-glb'
import { POSE_MAN_HEADER_GLB_BASE64 } from './pose-man-header-glb'
import { POSE_MAN_JUMPING_HEADER_GLB_BASE64 } from './pose-man-jumping-header-glb'
import { POSE_MAN_THROW_IN_GLB_BASE64 } from './pose-man-throw-in-glb'
import { POSE_MAN_SCISSOR_GLB_BASE64 } from './pose-man-scissor-glb'
import { POSE_WOMAN_IDLE_GLB_BASE64 } from './pose-woman-idle-glb'
import { POSE_WOMAN_JOG_GLB_BASE64 } from './pose-woman-jog-glb'
import { POSE_WOMAN_RUN_GLB_BASE64 } from './pose-woman-run-glb'
import { POSE_WOMAN_KICK_GLB_BASE64 } from './pose-woman-kick-glb'
import { POSE_WOMAN_LOW_KICK_GLB_BASE64 } from './pose-woman-low-kick-glb'
import { POSE_WOMAN_PASS_GLB_BASE64 } from './pose-woman-pass-glb'
import { POSE_WOMAN_RECEIVE_GLB_BASE64 } from './pose-woman-receive-glb'
import { POSE_WOMAN_DRIBBLING_GLB_BASE64 } from './pose-woman-dribbling-glb'
import { POSE_WOMAN_HEADER_GLB_BASE64 } from './pose-woman-header-glb'
import { POSE_WOMAN_JUMPING_HEADER_GLB_BASE64 } from './pose-woman-jumping-header-glb'
import { POSE_WOMAN_THROW_IN_GLB_BASE64 } from './pose-woman-throw-in-glb'
import { POSE_WOMAN_SCISSOR_GLB_BASE64 } from './pose-woman-scissor-glb'
import { POSE_MAN_DIAGONAL_JOG_GLB_BASE64 } from './pose-man-diagonal-jog-glb'
import { POSE_MAN_DIAGONAL_JOG_2_GLB_BASE64 } from './pose-man-diagonal-jog-2-glb'
import { POSE_MAN_RUN_START_GLB_BASE64 } from './pose-man-run-start-glb'
import { POSE_MAN_DEEP_KICK_GLB_BASE64 } from './pose-man-deep-kick-glb'
import { POSE_MAN_DEEP_KICK_2_GLB_BASE64 } from './pose-man-deep-kick-2-glb'
import { POSE_MAN_DEEP_KICK_3_GLB_BASE64 } from './pose-man-deep-kick-3-glb'
import { POSE_MAN_RECEIVE_2_GLB_BASE64 } from './pose-man-receive-2-glb'
import { POSE_MAN_DECELERATION_GLB_BASE64 } from './pose-man-deceleration-glb'
import { POSE_MAN_SPIN_GLB_BASE64 } from './pose-man-spin-glb'
import { POSE_WOMAN_DIAGONAL_JOG_GLB_BASE64 } from './pose-woman-diagonal-jog-glb'
import { POSE_WOMAN_DIAGONAL_JOG_2_GLB_BASE64 } from './pose-woman-diagonal-jog-2-glb'
import { POSE_WOMAN_RUN_START_GLB_BASE64 } from './pose-woman-run-start-glb'
import { POSE_WOMAN_DEEP_KICK_GLB_BASE64 } from './pose-woman-deep-kick-glb'
import { POSE_WOMAN_DEEP_KICK_2_GLB_BASE64 } from './pose-woman-deep-kick-2-glb'
import { POSE_WOMAN_DEEP_KICK_3_GLB_BASE64 } from './pose-woman-deep-kick-3-glb'
import { POSE_WOMAN_RECEIVE_2_GLB_BASE64 } from './pose-woman-receive-2-glb'
import { POSE_WOMAN_DECELERATION_GLB_BASE64 } from './pose-woman-deceleration-glb'
import { POSE_WOMAN_SPIN_GLB_BASE64 } from './pose-woman-spin-glb'
import { POSE_GK_MAN_IDLE_GLB_BASE64 } from './pose-gk-man-idle-glb'
import { POSE_GK_MAN_CATCH_MIDDLE_GLB_BASE64 } from './pose-gk-man-catch-middle-glb'
import { POSE_GK_MAN_CATCH_JUMPING_GLB_BASE64 } from './pose-gk-man-catch-jumping-glb'
import { POSE_GK_MAN_CATCH_SIDE_LOW_GLB_BASE64 } from './pose-gk-man-catch-side-low-glb'
import { POSE_GK_MAN_CATCH_DIVING_RIGHT_GLB_BASE64 } from './pose-gk-man-catch-diving-right-glb'
import { POSE_GK_MAN_CATCH_DIVING_LEFT_GLB_BASE64 } from './pose-gk-man-catch-diving-left-glb'
import { POSE_GK_MAN_CATCH_MIDDLE_LOW_GLB_BASE64 } from './pose-gk-man-catch-middle-low-glb'
import { POSE_GK_MAN_BODY_BLOCK_GLB_BASE64 } from './pose-gk-man-body-block-glb'
import { POSE_GK_MAN_BODY_BLOCK_2_GLB_BASE64 } from './pose-gk-man-body-block-2-glb'
import { POSE_GK_MAN_DEEP_KICK_GLB_BASE64 } from './pose-gk-man-deep-kick-glb'
import { POSE_GK_MAN_DEEP_KICK_2_GLB_BASE64 } from './pose-gk-man-deep-kick-2-glb'
import { POSE_GK_MAN_DEEP_KICK_3_GLB_BASE64 } from './pose-gk-man-deep-kick-3-glb'
import { POSE_GK_WOMAN_IDLE_GLB_BASE64 } from './pose-gk-woman-idle-glb'
import { POSE_GK_WOMAN_CATCH_MIDDLE_GLB_BASE64 } from './pose-gk-woman-catch-middle-glb'
import { POSE_GK_WOMAN_CATCH_JUMPING_GLB_BASE64 } from './pose-gk-woman-catch-jumping-glb'
import { POSE_GK_WOMAN_CATCH_SIDE_LOW_GLB_BASE64 } from './pose-gk-woman-catch-side-low-glb'
import { POSE_GK_WOMAN_CATCH_DIVING_RIGHT_GLB_BASE64 } from './pose-gk-woman-catch-diving-right-glb'
import { POSE_GK_WOMAN_CATCH_DIVING_LEFT_GLB_BASE64 } from './pose-gk-woman-catch-diving-left-glb'
import { POSE_GK_WOMAN_CATCH_MIDDLE_LOW_GLB_BASE64 } from './pose-gk-woman-catch-middle-low-glb'
import { POSE_GK_WOMAN_BODY_BLOCK_GLB_BASE64 } from './pose-gk-woman-body-block-glb'
import { POSE_GK_WOMAN_BODY_BLOCK_2_GLB_BASE64 } from './pose-gk-woman-body-block-2-glb'
import { POSE_GK_WOMAN_DEEP_KICK_GLB_BASE64 } from './pose-gk-woman-deep-kick-glb'
import { POSE_GK_WOMAN_DEEP_KICK_2_GLB_BASE64 } from './pose-gk-woman-deep-kick-2-glb'
import { POSE_GK_WOMAN_DEEP_KICK_3_GLB_BASE64 } from './pose-gk-woman-deep-kick-3-glb'
// The inflatable mannequin's "fake defender" drawing — a single black line-art
// path, printed onto the front of the (tintable) mannequin body as a decal.
import mannequinDecalRaw from '../assets/materials3d/mannequin_decal.svg?raw'
// Per-player kit atlases (1024×128 flat-colour strips, ~8 KB each), inlined as
// data URIs so they ship inside the bundle like the models. The GLBs carry UVs
// but no image — the kit is applied here at runtime (recolorable in a later phase).
import playerManATex from '../assets/players3d/player_man_a.png?inline'
import playerManBTex from '../assets/players3d/player_man_b.png?inline'
import playerManCTex from '../assets/players3d/player_man_c.png?inline'
import playerWomanATex from '../assets/players3d/player_woman_a.png?inline'
import playerWomanBTex from '../assets/players3d/player_woman_b.png?inline'
import playerWomanCTex from '../assets/players3d/player_woman_c.png?inline'
// The "PLAYER 10" prints (white, alpha elsewhere), extracted from the pack's
// hi-res atlas — drawn back on top after the kit blocks are recolored.
import playerKitPrint from '../assets/players3d/kit_print.png?inline'
// The DEFAULT kit for pose players with no custom colors (assets/players3d/
// texture_neutral.png, downscaled) — a neutral grey strip the kit editor paints over.
import playerNeutralTex from '../assets/players3d/player_neutral.png?inline'
import tokenOverlayUrl from '../assets/token_overlay_gray2.png?inline'
import tokenShadowUrl from '../assets/token_overlay_shadow.png?inline'

// GLB-backed objects: embedded model bytes + toon colour. The models are authored
// at real metric scale with their base on the ground (y=0), so they render as-is
// (size is a plain ×1 multiplier). Add a row (and KNOWN_OBJECTS + catalog) to grow.
const GLB_OBJECTS: Record<string, { data: string; color: number }> = {
  cone: { data: CONE_GLB_BASE64, color: 0xf4611e },
  high_cone: { data: HIGH_CONE_GLB_BASE64, color: 0xf4611e },
  cone_hurdle: { data: CONE_HURDLE_GLB_BASE64, color: 0xf4611e },
  hurdle_low: { data: HURDLE_LOW_GLB_BASE64, color: 0xf2c200 },
  hurdle: { data: HURDLE_GLB_BASE64, color: 0xf2c200 },
  hurdle_high: { data: HURDLE_HIGH_GLB_BASE64, color: 0xf2c200 },
  speed_ladder: { data: SPEED_LADDER_GLB_BASE64, color: 0xf2c200 },
  mannequin: { data: MANNEQUIN_GLB_BASE64, color: 0xe7eaed }, // off-white inflatable; recolorable
  wall_mannequin: { data: WALL_MANNEQUIN_GLB_BASE64, color: 0xffe500 },
  balance_dome: { data: BALANCE_DOME_GLB_BASE64, color: 0x2aa8a8 },
  agility_pole: { data: AGILITY_POLE_GLB_BASE64, color: 0xdc3838 }, // slalom pole; recolorable
}

// Multi-material GLBs rendered with their AUTHORED per-material toon colours (one
// mesh per primitive), so a model can carry more than one colour — e.g. the flag
// pole's pole vs cloth. Unlike GLB_OBJECTS these are NOT recolorable in the picker
// (the colours live in the model's materials); real-metric size like GLB_OBJECTS.
const MULTI_GLB_OBJECTS: Record<string, string> = {
  flag_pole: FLAG_POLE_GLB_BASE64,
}

// Per-part recolor slots for a multi-material object: each slot maps to the GLB
// primitive whose MATERIAL NAME contains the slot id (e.g. slot "pole" ← material
// "Material.Pole"), and carries a default CSS colour. The element stores overrides
// in `colors[slotId]`; absent → the default. Exposed to the properties panel.
export interface Object3DColorSlot {
  id: string
  label: string
  default: string
}
const MULTI_SLOTS: Record<string, Object3DColorSlot[]> = {
  flag_pole: [
    { id: 'pole', label: 'Pole', default: '#f2c200' }, // yellow
    { id: 'flag', label: 'Flag', default: '#dc3838' }, // red
  ],
}

/** The recolor slots a multi-material object exposes (empty if none). */
export function object3dColorSlots(objectId: string): Object3DColorSlot[] {
  return MULTI_SLOTS[objectId] ?? []
}
export function isObject3DMultiColor(objectId: string): boolean {
  return objectId in MULTI_SLOTS
}
/** The default CSS colour for one of an object's slots. */
export function object3dSlotDefault(objectId: string, slot: string): string {
  return MULTI_SLOTS[objectId]?.find((s) => s.id === slot)?.default ?? '#ffffff'
}

/** Live-recolor a multi-material object's per-slot toon meshes from the element's
 *  `colors` overrides (missing slot → its default). Outline/crease children carry
 *  no slot tag and keep their black ink. Called by Object3DLayer each sync. */
export function recolorObject3DSlots(obj: THREE.Object3D, objectId: string, colors: Record<string, string> | undefined): void {
  const slots = MULTI_SLOTS[objectId]
  if (!slots) return
  obj.traverse((o) => {
    const slot = (o.userData as { slot?: string }).slot
    if (!slot) return
    const mat = (o as THREE.Mesh).material
    if (mat instanceof THREE.MeshToonMaterial) mat.color.set(colors?.[slot] ?? object3dSlotDefault(objectId, slot))
  })
}

// 3D players: static Studio Ochi character meshes baked in a neutral standing
// pose, textured with their own kit atlas. Real metric height (~1.5–1.8 m).
// Airborne poses authored RESTING on the ground that should FLOAT: lifted by
// this many metres (scales with the player) so the body hangs mid-action.
const POSE_GROUND_LIFT: Record<string, number> = {
  pose_gk_man_catch_diving_right: 0.5,
  pose_gk_man_catch_diving_left: 0.5,
  pose_gk_woman_catch_diving_right: 0.5,
  pose_gk_woman_catch_diving_left: 0.5,
}

const PLAYER_GLBS: Record<string, { data: string; texture: string }> = {
  player_man_a: { data: PLAYER_MAN_A_GLB_BASE64, texture: playerManATex },
  player_man_b: { data: PLAYER_MAN_B_GLB_BASE64, texture: playerManBTex },
  player_man_c: { data: PLAYER_MAN_C_GLB_BASE64, texture: playerManCTex },
  player_woman_a: { data: PLAYER_WOMAN_A_GLB_BASE64, texture: playerWomanATex },
  player_woman_b: { data: PLAYER_WOMAN_B_GLB_BASE64, texture: playerWomanBTex },
  player_woman_c: { data: PLAYER_WOMAN_C_GLB_BASE64, texture: playerWomanCTex },
  // Static pose variants (Mixamo clip frames baked on the B characters — the
  // drawer's Man/Woman; see specs/positions.md for the clip/frame table).
  pose_man_idle: { data: POSE_MAN_IDLE_GLB_BASE64, texture: playerNeutralTex },
  pose_man_jog: { data: POSE_MAN_JOG_GLB_BASE64, texture: playerNeutralTex },
  pose_man_run: { data: POSE_MAN_RUN_GLB_BASE64, texture: playerNeutralTex },
  pose_man_kick: { data: POSE_MAN_KICK_GLB_BASE64, texture: playerNeutralTex },
  pose_man_low_kick: { data: POSE_MAN_LOW_KICK_GLB_BASE64, texture: playerNeutralTex },
  pose_man_pass: { data: POSE_MAN_PASS_GLB_BASE64, texture: playerNeutralTex },
  pose_man_receive: { data: POSE_MAN_RECEIVE_GLB_BASE64, texture: playerNeutralTex },
  pose_man_dribbling: { data: POSE_MAN_DRIBBLING_GLB_BASE64, texture: playerNeutralTex },
  pose_man_header: { data: POSE_MAN_HEADER_GLB_BASE64, texture: playerNeutralTex },
  pose_man_jumping_header: { data: POSE_MAN_JUMPING_HEADER_GLB_BASE64, texture: playerNeutralTex },
  pose_man_throw_in: { data: POSE_MAN_THROW_IN_GLB_BASE64, texture: playerNeutralTex },
  pose_man_scissor: { data: POSE_MAN_SCISSOR_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_idle: { data: POSE_WOMAN_IDLE_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_jog: { data: POSE_WOMAN_JOG_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_run: { data: POSE_WOMAN_RUN_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_kick: { data: POSE_WOMAN_KICK_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_low_kick: { data: POSE_WOMAN_LOW_KICK_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_pass: { data: POSE_WOMAN_PASS_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_receive: { data: POSE_WOMAN_RECEIVE_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_dribbling: { data: POSE_WOMAN_DRIBBLING_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_header: { data: POSE_WOMAN_HEADER_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_jumping_header: { data: POSE_WOMAN_JUMPING_HEADER_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_throw_in: { data: POSE_WOMAN_THROW_IN_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_scissor: { data: POSE_WOMAN_SCISSOR_GLB_BASE64, texture: playerNeutralTex },
  pose_man_diagonal_jog: { data: POSE_MAN_DIAGONAL_JOG_GLB_BASE64, texture: playerNeutralTex },
  pose_man_diagonal_jog_2: { data: POSE_MAN_DIAGONAL_JOG_2_GLB_BASE64, texture: playerNeutralTex },
  pose_man_run_start: { data: POSE_MAN_RUN_START_GLB_BASE64, texture: playerNeutralTex },
  pose_man_deep_kick: { data: POSE_MAN_DEEP_KICK_GLB_BASE64, texture: playerNeutralTex },
  pose_man_deep_kick_2: { data: POSE_MAN_DEEP_KICK_2_GLB_BASE64, texture: playerNeutralTex },
  pose_man_deep_kick_3: { data: POSE_MAN_DEEP_KICK_3_GLB_BASE64, texture: playerNeutralTex },
  pose_man_receive_2: { data: POSE_MAN_RECEIVE_2_GLB_BASE64, texture: playerNeutralTex },
  pose_man_deceleration: { data: POSE_MAN_DECELERATION_GLB_BASE64, texture: playerNeutralTex },
  pose_man_spin: { data: POSE_MAN_SPIN_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_diagonal_jog: { data: POSE_WOMAN_DIAGONAL_JOG_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_diagonal_jog_2: { data: POSE_WOMAN_DIAGONAL_JOG_2_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_run_start: { data: POSE_WOMAN_RUN_START_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_deep_kick: { data: POSE_WOMAN_DEEP_KICK_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_deep_kick_2: { data: POSE_WOMAN_DEEP_KICK_2_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_deep_kick_3: { data: POSE_WOMAN_DEEP_KICK_3_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_receive_2: { data: POSE_WOMAN_RECEIVE_2_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_deceleration: { data: POSE_WOMAN_DECELERATION_GLB_BASE64, texture: playerNeutralTex },
  pose_woman_spin: { data: POSE_WOMAN_SPIN_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_idle: { data: POSE_GK_MAN_IDLE_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_catch_middle: { data: POSE_GK_MAN_CATCH_MIDDLE_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_catch_jumping: { data: POSE_GK_MAN_CATCH_JUMPING_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_catch_side_low: { data: POSE_GK_MAN_CATCH_SIDE_LOW_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_catch_diving_right: { data: POSE_GK_MAN_CATCH_DIVING_RIGHT_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_catch_diving_left: { data: POSE_GK_MAN_CATCH_DIVING_LEFT_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_catch_middle_low: { data: POSE_GK_MAN_CATCH_MIDDLE_LOW_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_body_block: { data: POSE_GK_MAN_BODY_BLOCK_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_body_block_2: { data: POSE_GK_MAN_BODY_BLOCK_2_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_deep_kick: { data: POSE_GK_MAN_DEEP_KICK_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_deep_kick_2: { data: POSE_GK_MAN_DEEP_KICK_2_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_man_deep_kick_3: { data: POSE_GK_MAN_DEEP_KICK_3_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_idle: { data: POSE_GK_WOMAN_IDLE_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_catch_middle: { data: POSE_GK_WOMAN_CATCH_MIDDLE_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_catch_jumping: { data: POSE_GK_WOMAN_CATCH_JUMPING_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_catch_side_low: { data: POSE_GK_WOMAN_CATCH_SIDE_LOW_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_catch_diving_right: { data: POSE_GK_WOMAN_CATCH_DIVING_RIGHT_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_catch_diving_left: { data: POSE_GK_WOMAN_CATCH_DIVING_LEFT_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_catch_middle_low: { data: POSE_GK_WOMAN_CATCH_MIDDLE_LOW_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_body_block: { data: POSE_GK_WOMAN_BODY_BLOCK_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_body_block_2: { data: POSE_GK_WOMAN_BODY_BLOCK_2_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_deep_kick: { data: POSE_GK_WOMAN_DEEP_KICK_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_deep_kick_2: { data: POSE_GK_WOMAN_DEEP_KICK_2_GLB_BASE64, texture: playerNeutralTex },
  pose_gk_woman_deep_kick_3: { data: POSE_GK_WOMAN_DEEP_KICK_3_GLB_BASE64, texture: playerNeutralTex },
}

// Procedural goals. Built at their real metric size (feet → metres), so they're
// placed with `size` = 1 (see OBJECT3D_SIZES) rather than the unit-scaled default.
const FT = 0.3048
const GOALS: Record<string, { width: number; height: number; style: GoalStyle }> = {
  goal_full: { width: 24 * FT, height: 8 * FT, style: 'box' }, // regulation 11-a-side (matches the pitch)
  goal_9: { width: 16 * FT, height: 7 * FT, style: 'angled' },
  goal_7: { width: 12 * FT, height: 6 * FT, style: 'angled' },
  goal_futsal: { width: 9.8 * FT, height: 6.5 * FT, style: 'angled' },
  goal_small: { width: 6 * FT, height: 4 * FT, style: 'angled' },
}

export const KNOWN_OBJECTS = ['ball', 'cube', 'cone', 'high_cone', 'cone_hurdle', 'hurdle_low', 'hurdle', 'hurdle_high', 'speed_ladder', 'mannequin', 'wall_mannequin', 'balance_dome', 'agility_pole', 'flag_pole', 'goal_full', 'goal_9', 'goal_7', 'goal_futsal', 'goal_small', 'player_man_a', 'player_man_b', 'player_man_c', 'player_woman_a', 'player_woman_b', 'player_woman_c', 'pose_man_idle', 'pose_man_jog', 'pose_man_run', 'pose_man_kick', 'pose_man_low_kick', 'pose_man_pass', 'pose_man_receive', 'pose_man_dribbling', 'pose_man_header', 'pose_man_jumping_header', 'pose_man_throw_in', 'pose_man_scissor', 'pose_woman_idle', 'pose_woman_jog', 'pose_woman_run', 'pose_woman_kick', 'pose_woman_low_kick', 'pose_woman_pass', 'pose_woman_receive', 'pose_woman_dribbling', 'pose_woman_header', 'pose_woman_jumping_header', 'pose_woman_throw_in', 'pose_woman_scissor', 'pose_man_diagonal_jog', 'pose_man_diagonal_jog_2', 'pose_man_run_start', 'pose_man_deep_kick', 'pose_man_deep_kick_2', 'pose_man_deep_kick_3', 'pose_man_receive_2', 'pose_man_deceleration', 'pose_man_spin', 'pose_woman_diagonal_jog', 'pose_woman_diagonal_jog_2', 'pose_woman_run_start', 'pose_woman_deep_kick', 'pose_woman_deep_kick_2', 'pose_woman_deep_kick_3', 'pose_woman_receive_2', 'pose_woman_deceleration', 'pose_woman_spin', 'pose_gk_man_idle', 'pose_gk_man_catch_middle', 'pose_gk_man_catch_jumping', 'pose_gk_man_catch_side_low', 'pose_gk_man_catch_diving_right', 'pose_gk_man_catch_diving_left', 'pose_gk_man_catch_middle_low', 'pose_gk_man_body_block', 'pose_gk_man_body_block_2', 'pose_gk_man_deep_kick', 'pose_gk_man_deep_kick_2', 'pose_gk_man_deep_kick_3', 'pose_gk_woman_idle', 'pose_gk_woman_catch_middle', 'pose_gk_woman_catch_jumping', 'pose_gk_woman_catch_side_low', 'pose_gk_woman_catch_diving_right', 'pose_gk_woman_catch_diving_left', 'pose_gk_woman_catch_middle_low', 'pose_gk_woman_body_block', 'pose_gk_woman_body_block_2', 'pose_gk_woman_deep_kick', 'pose_gk_woman_deep_kick_2', 'pose_gk_woman_deep_kick_3'] as const
export type Object3DKind = (typeof KNOWN_OBJECTS)[number]
export function isKnownObject(id: string): id is Object3DKind {
  return (KNOWN_OBJECTS as readonly string[]).includes(id)
}

// Default placed `size` (a scale multiplier). GLB objects and goals are modelled
// at real metric size, so they drop in at ×1; the procedural ball/cube fall back
// to the caller's nominal default.
export function defaultObject3DSize(objectId: string, fallback: number): number {
  if (objectId in GLB_OBJECTS || objectId in GOALS || objectId in PLAYER_GLBS || objectId in MULTI_GLB_OBJECTS) return 1
  return fallback
}

// Colorable materials: exactly the GLB-backed objects (cones, hurdles, ladder,
// mannequins, balance dome). Goals + ball/cube are not tintable.
export function isObject3DColorable(objectId: string): boolean {
  return objectId in GLB_OBJECTS
}

// A placed goal (real-metric, structural) — exempt from the global object scale so
// the "make materials bigger" default doesn't balloon regulation goals.
/** The procedural soccer ball — the one object that can scale independently
 *  (background.ballScale) since its size is visibility-driven next to tokens. */
export function isObject3DBall(objectId: string): boolean {
  return objectId === 'ball'
}

export function isObject3DGoal(objectId: string): boolean {
  return objectId in GOALS
}

// A 3D player character: no body tint, but skin/hair + kit recoloring via the
// element's `colors` slots (the same slot names as the 2D figure players).
export function isObject3DPlayer(objectId: string): boolean {
  return objectId in PLAYER_GLBS
}

// The authored default tint for a colorable object (as a CSS hex), used to seed a
// freshly placed element's color and as the picker's baseline.
export function object3dDefaultColor(objectId: string): string {
  const c = GLB_OBJECTS[objectId]?.color
  return c === undefined ? '#ffffff' : `#${c.toString(16).padStart(6, '0')}`
}

// Rotationally symmetric objects: a Y-axis rotation has no visible effect, so
// their rotation handle is hidden and rotation is left at 0.
// The mannequin carries a front-facing print, so a Y-rotation IS visible (it turns
// the fake defender to face a different way) — it stays rotatable.
const ROTATION_SYMMETRIC = new Set<string>(['ball', 'cone', 'high_cone', 'balance_dome', 'agility_pole'])
export function isObject3DRotatable(objectId: string): boolean {
  return !ROTATION_SYMMETRIC.has(objectId)
}

/** Decode a base64 string into an ArrayBuffer (sync — no fetch). */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

// glTF accessor component-type → typed-array constructor (only the ones our
// meshes use: float positions/normals, ushort/uint indices).
const COMPONENT: Record<number, { array: Float32ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor }> = {
  5126: { array: Float32Array },
  5123: { array: Uint16Array },
  5125: { array: Uint32Array },
}
const NUM_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

interface GlbJson {
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; material?: number }> }>
  materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] }; doubleSided?: boolean }>
  accessors: Array<{ bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }>
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>
  nodes?: Array<{ mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>
}

/** The world matrix of the node that references `meshIndex`, composed up its
 *  parent chain. Our parser reads mesh primitives directly (ignoring the scene
 *  graph), which only works when the exporter baked transforms into the mesh
 *  (identity node). A Blender export that keeps the object's rotation/translation
 *  on the node (e.g. Z-up "cloth flag" not applied) needs this baked in, or the
 *  model renders mis-oriented/offset. Identity nodes → identity matrix (no-op). */
function nodeWorldMatrix(json: GlbJson, meshIndex: number): THREE.Matrix4 {
  const nodes = json.nodes ?? []
  const start = nodes.findIndex((n) => n.mesh === meshIndex)
  if (start < 0) return new THREE.Matrix4()
  const parent = new Map<number, number>()
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))
  const local = (n: NonNullable<GlbJson['nodes']>[number]) => {
    if (n.matrix) return new THREE.Matrix4().fromArray(n.matrix)
    const t = n.translation ?? [0, 0, 0]
    const r = n.rotation ?? [0, 0, 0, 1]
    const s = n.scale ?? [1, 1, 1]
    return new THREE.Matrix4().compose(new THREE.Vector3(t[0], t[1], t[2]), new THREE.Quaternion(r[0], r[1], r[2], r[3]), new THREE.Vector3(s[0], s[1], s[2]))
  }
  let idx = start
  const world = local(nodes[idx])
  while (parent.has(idx)) {
    idx = parent.get(idx)!
    world.premultiply(local(nodes[idx])) // ancestor · … · parent · node
  }
  return world
}

/** Minimal, synchronous GLB → BufferGeometry parser for our un-compressed assets
 *  (POSITION + NORMAL + indices). Merges ALL primitives of the first mesh into a
 *  single geometry — models split by material (e.g. a hurdle's frame + bars, a
 *  ladder's rails + rungs) have several primitives, and dropping the extras
 *  would leave parts (like the legs) missing. We avoid GLTFLoader because it
 *  resolves asynchronously, whereas `buildObject3D` must be sync. */
function parseGlbGeometry(buf: ArrayBuffer): THREE.BufferGeometry {
  const dv = new DataView(buf)
  let json: GlbJson | null = null
  let bin: ArrayBuffer | null = null
  let off = 12 // skip the 12-byte GLB header (magic, version, length)
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    const start = off + 8
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len))) as GlbJson
    else if (type === 0x004e4942) bin = buf.slice(start, start + len)
    off = start + len + ((4 - (len % 4)) % 4) // chunks are 4-byte aligned
  }
  if (!json || !bin) throw new Error('glb: missing JSON or BIN chunk')

  const read = (accessorIndex: number) => {
    const acc = json!.accessors[accessorIndex]
    const bv = json!.bufferViews[acc.bufferView]
    const comp = COMPONENT[acc.componentType]
    const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
    return new comp.array(bin!, byteOffset, acc.count * NUM_COMPONENTS[acc.type])
  }

  // Gather every primitive, then concatenate into one position/normal/uv/index set.
  const prims = json.meshes[0].primitives.map((p) => ({
    pos: read(p.attributes.POSITION) as Float32Array,
    nrm: p.attributes.NORMAL != null ? (read(p.attributes.NORMAL) as Float32Array) : null,
    uv: p.attributes.TEXCOORD_0 != null ? (read(p.attributes.TEXCOORD_0) as Float32Array) : null,
    idx: p.indices != null ? read(p.indices) : null,
  }))
  const totalVerts = prims.reduce((n, p) => n + p.pos.length / 3, 0)
  const totalIdx = prims.reduce((n, p) => n + (p.idx ? p.idx.length : 0), 0)
  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const indices = new Uint32Array(totalIdx)
  let vOff = 0
  let iOff = 0
  let hasNormals = true
  let hasUvs = true
  for (const p of prims) {
    positions.set(p.pos, vOff * 3)
    if (p.nrm) normals.set(p.nrm, vOff * 3)
    else hasNormals = false
    if (p.uv) uvs.set(p.uv, vOff * 2)
    else hasUvs = false
    if (p.idx) {
      for (let k = 0; k < p.idx.length; k++) indices[iOff + k] = p.idx[k] + vOff
      iOff += p.idx.length
    }
    vOff += p.pos.length / 3
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (hasNormals) geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  if (hasUvs) geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  if (totalIdx) geom.setIndex(new THREE.BufferAttribute(indices, 1))
  if (!hasNormals) geom.computeVertexNormals()
  geom.applyMatrix4(nodeWorldMatrix(json, 0)) // bake the mesh node's transform (identity for most assets)
  return geom
}

/** Like parseGlbGeometry but keeps each primitive SEPARATE, paired with its
 *  material's base colour — for multi-material models we render one mesh per
 *  material (e.g. the two-tone soccer ball's white shell + black patches). */
function parseGlbByMaterial(buf: ArrayBuffer): { geometry: THREE.BufferGeometry; color: THREE.Color; doubleSided: boolean; name: string }[] {
  const dv = new DataView(buf)
  let json: GlbJson | null = null
  let bin: ArrayBuffer | null = null
  let off = 12
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    const start = off + 8
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len))) as GlbJson
    else if (type === 0x004e4942) bin = buf.slice(start, start + len)
    off = start + len + ((4 - (len % 4)) % 4)
  }
  if (!json || !bin) throw new Error('glb: missing JSON or BIN chunk')
  const read = (accessorIndex: number) => {
    const acc = json!.accessors[accessorIndex]
    const bv = json!.bufferViews[acc.bufferView]
    const comp = COMPONENT[acc.componentType]
    const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
    return new comp.array(bin!, byteOffset, acc.count * NUM_COMPONENTS[acc.type])
  }
  const nodeMat = nodeWorldMatrix(json, 0) // bake the mesh node's transform (identity for most assets)
  return json.meshes[0].primitives.map((p) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(read(p.attributes.POSITION) as Float32Array, 3))
    if (p.attributes.NORMAL != null) geometry.setAttribute('normal', new THREE.BufferAttribute(read(p.attributes.NORMAL) as Float32Array, 3))
    else geometry.computeVertexNormals()
    if (p.indices != null) geometry.setIndex(new THREE.BufferAttribute(read(p.indices), 1))
    geometry.applyMatrix4(nodeMat)
    geometry.computeBoundingBox()
    const mat = json!.materials?.[p.material ?? -1]
    const f = mat?.pbrMetallicRoughness?.baseColorFactor
    // Use the base colour as the toon display colour (crisp white / near-black patches).
    const color = f ? new THREE.Color().setRGB(f[0], f[1], f[2], THREE.SRGBColorSpace) : new THREE.Color(0xffffff)
    return { geometry, color, doubleSided: !!mat?.doubleSided, name: mat?.name ?? '' }
  })
}

// Parse a GLB object once per id, lazily, at its authored REAL metric size with
// its base on the ground (y=0) — no re-centering/rescaling. We clone it per
// instance so each mesh owns disposable geometry. The model's smooth normals are
// kept — they give a visible light→dark falloff toward the silhouette.
const geomCache = new Map<string, THREE.BufferGeometry>()
function glbGeometry(id: string, data: string): THREE.BufferGeometry {
  let geom = geomCache.get(id)
  if (!geom) {
    geom = parseGlbGeometry(base64ToArrayBuffer(data))
    geom.computeBoundingBox()
    geomCache.set(id, geom)
  }
  return geom.clone()
}


/** An extreme cel-shaded toon material: a hard, high-contrast 3-tone gradient
 *  that splits the surface into bold light/mid/shadow bands. */
function extremeToon(color: number, side: THREE.Side = THREE.FrontSide): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradientMap(), side })
}

/** Black ink strokes along the geometry's hard edges (creases/rims — e.g. the
 *  cone's base rim), the internal-line counterpart of the silhouette outline.
 *  `thresholdAngle` (deg) keeps only sharp edges, not every triangle seam. */
function creaseEdges(geometry: THREE.BufferGeometry, thresholdAngle = 24): THREE.LineSegments {
  const seg = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, thresholdAngle), new THREE.LineBasicMaterial({ color: 0x111111 }))
  seg.name = 'creaseEdges'
  seg.scale.setScalar(1.003) // nudge off the surface (small, so it isn't displaced on big models)
  seg.raycast = () => {} // decorative — never a click target (else its ~1u line threshold makes a huge hit area)
  return seg
}

// Toon outline thickness as a fraction of a model's MEDIAN dimension (not the
// largest) so it stays proportional to the object's cross-section, not its length
// — a long, thin ladder was getting an outline thicker than its own bars. Stored
// per object so the layer can lift by it (keeping the underside above the y=0 clip).
export const OUTLINE_FRACTION = 0.013

/** The back-faces-only black "ink" outline shell. Instead of a uniform scale
 *  (which displaces the shell sideways on thin, off-centre parts like a hurdle
 *  rail — a one-sided outline), it pushes every vertex OUT along its surface
 *  normal by a fixed distance, giving an even line all the way round. Offset in
 *  model space so it scales with the object; clipping-plane aware (y<0 hidden). */
function outlineMaterial(thickness: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { thickness: { value: thickness } },
    side: THREE.BackSide,
    clipping: true,
    vertexShader: `
      #include <clipping_planes_pars_vertex>
      uniform float thickness;
      void main() {
        vec3 p = position + normalize(normal) * thickness;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: `
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        gl_FragColor = vec4(0.067, 0.067, 0.067, 1.0);
      }
    `,
  })
}

function toonOutline(geometry: THREE.BufferGeometry, thickness: number): THREE.Mesh {
  const outline = new THREE.Mesh(geometry, outlineMaterial(thickness))
  outline.name = 'toonOutline'
  outline.raycast = () => {} // decorative shell — never a click target (pick the real mesh)
  return outline
}

/* ---- inflatable mannequin decal --------------------------------------------- *
 * The GLB carries no UVs, so we can't map an image through the model's own
 * texture coordinates. Instead we rasterize the line-art SVG to a canvas texture
 * (synchronously, via Path2D — no async image load) and PROJECT it onto the
 * front of the body in a small shader: a planar projection (X→u, Y→v) masked by
 * the surface normal so the print lands only on the front hemisphere and fades
 * toward the sides, the way a graphic wraps a real inflatable. The body stays a
 * plain tintable toon mesh; the decal is a fixed-colour overlay on top.          */

let decalTex: THREE.CanvasTexture | null = null
function mannequinDecalTexture(): THREE.CanvasTexture {
  if (decalTex) return decalTex
  const vb = mannequinDecalRaw.match(/viewBox="([\d.\s-]+)"/)
  const [, , vw, vh] = (vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 1604, 4775]) as number[]
  const d = mannequinDecalRaw.match(/\sd="([^"]+)"/)?.[1] ?? ''
  const W = 512
  const H = Math.round((W * vh) / vw)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!
  g.scale(W / vw, H / vh)
  g.fillStyle = '#141414' // fixed dark ink — the drawing does NOT take the body tint
  if (d) {
    const path = new Path2D(d)
    g.fill(path)
    // Beef the strokes up: outline every filled shape so the hairline artwork
    // stays readable at board scales (the raw line-art nearly vanishes there).
    g.strokeStyle = '#141414'
    g.lineWidth = 20 // viewBox units (~1.2% of the artwork width)
    g.lineJoin = 'round'
    g.stroke(path)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  decalTex = tex
  return tex
}

/** Print the decal INSIDE the body's toon material (onBeforeCompile): the ink
 *  multiplies the tinted diffuse before lighting — no overlay mesh, no alpha
 *  blending, no coplanar tricks, so no fringe/ghost artifacts of any kind. A
 *  planar projection (X→u, Y→v) masked by the object-space normal keeps the
 *  print on the front hemisphere, fading toward the sides like a real print. */
function applyMannequinDecal(mat: THREE.MeshToonMaterial, geom: THREE.BufferGeometry): void {
  const bb = geom.boundingBox!
  const tex = mannequinDecalTexture()
  const size = bb.getSize(new THREE.Vector3())
  const aspect = (tex.image as HTMLCanvasElement).width / (tex.image as HTMLCanvasElement).height
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.decalMap = { value: tex }
    shader.uniforms.decalBboxMin = { value: bb.min.clone() }
    shader.uniforms.decalBboxSize = { value: size.clone() }
    shader.uniforms.decalAspect = { value: aspect }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 decalBboxMin; uniform vec3 decalBboxSize; uniform float decalAspect; varying vec2 vDecalUv; varying float vDecalMask;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float dny = (position.y - decalBboxMin.y) / decalBboxSize.y;       // 0..1 bottom→top
          float dnx = (position.x - decalBboxMin.x) / decalBboxSize.x - 0.5; // -0.5..0.5
          float dBand = (decalBboxSize.y * decalAspect) / decalBboxSize.x;   // aspect-correct band
          vDecalUv = vec2(dnx / dBand + 0.5, dny);
          vDecalMask = normalize(normal).z; // object-space front = +Z
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D decalMap; varying vec2 vDecalUv; varying float vDecalMask;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (vDecalUv.x >= 0.0 && vDecalUv.x <= 1.0 && vDecalUv.y >= 0.0 && vDecalUv.y <= 1.0) {
          float dm = smoothstep(0.15, 0.5, vDecalMask); // front only; fades to the sides
          vec4 dtex = texture2D(decalMap, vDecalUv);
          diffuseColor.rgb *= mix(vec3(1.0), dtex.rgb, dtex.a * dm);
        }`,
      )
  }
  // One shader program for every mannequin (the injection is identical).
  mat.customProgramCacheKey = () => 'mannequin-decal'
}

/* ---- 3D-player kit textures --------------------------------------------------
 * The player GLBs ship UVs but no image. The kit is applied at runtime: the
 * character's own atlas (a tiny inlined 1024×128 strip of flat-colour blocks)
 * is the base look, and the element's `colors` slots recolor its blocks on a
 * canvas. The atlas layout (empirically mapped, identical for all six
 * characters; 8 blocks of 128px):
 *   0 hair · 1 skin · 2 sleeves+socks · 3 jersey back (big print) ·
 *   4 jersey front (small print) · 5 shorts · 6 shoes · 7 unused
 * The white "PLAYER 10" prints live in a separate alpha overlay (kit_print.png)
 * drawn back on top, so recoloring never erases them. Texture-space vertical is
 * body-vertical, so stripe styles draw exactly as named.
 *
 * Decoding data-URI images is async — a player placed before its images decode
 * renders with a stand-in for a frame; subscribers (Object3DLayer) are notified
 * to re-render when assets become ready. */
const KIT_W = 1024
const KIT_H = 128
const BLOCK = KIT_W / 8
const HAIR_BLOCK = 0
const SKIN_BLOCK = 1
const SOCKS_BLOCK = 2
const JERSEY_BLOCKS = [3, 4] // back (big print) + front (small print)
const SHORTS_BLOCK = 5
// The sleeve caps/long sleeves: the pack UV'd them inconsistently (into the socks
// block on some characters, the shorts block on others), so our GLB exports remap
// every character's sleeve faces to the last half-block (col 15, unused by the
// pack) — a first-class region we control. Sleeves follow the JERSEY colour.
const SLEEVE_X = 960 // .. KIT_W
// The jersey UV islands span this sub-range of their 128px block (measured from
// the meshes). Vertical stripes are drawn across the ISLAND, not the block, so
// front and back patterns meet continuously at the side seams.
const JERSEY_ISLAND_X0 = 14
const JERSEY_ISLAND_X1 = 114
const V_STRIPE_BANDS = 6 // 3 jersey + 3 stripe

// The recolor slots (same names as the 2D figure players — see player-kit.ts).
const SLOT_SKIN = 'yc-skin'
const SLOT_HAIR = 'yc-hair'
const SLOT_JERSEY = 'yc-color-1'
const SLOT_SHORTS = 'yc-color-2'
const SLOT_VSTRIPE = 'v_stripe'
const SLOT_HSTRIPE = 'h_stripe'
const SLOT_SOCKS = 'socks'
const KIT_SLOTS = [SLOT_SKIN, SLOT_HAIR, SLOT_JERSEY, SLOT_SHORTS, SLOT_VSTRIPE, SLOT_HSTRIPE, SLOT_SOCKS]

/** The neutral look's slot values — sampled from player_neutral.png (the atlas
 *  behind every pose thumbnail). Seeded onto a NEW 3D player when there's no
 *  previous player to inherit from, so the Skin/Kit editors open populated with
 *  the colors the user actually sees (solid jersey — no stripe slots). */
export const PLAYER_NEUTRAL_SLOTS: Record<string, string> = {
  [SLOT_SKIN]: '#efaa8b',
  [SLOT_HAIR]: '#754c29',
  [SLOT_JERSEY]: '#c8c8c8', // the atlas front-jersey block — what the thumbnails show
  [SLOT_SHORTS]: '#4f4f4f',
  [SLOT_SOCKS]: '#4f4f4f',
}

const assetReadyCbs = new Set<() => void>()
/** Subscribe to "a lazily-decoded 3D asset became ready" (returns unsubscribe). */
export function onObject3DAssetReady(cb: () => void): () => void {
  assetReadyCbs.add(cb)
  return () => assetReadyCbs.delete(cb)
}
function notifyAssetReady() {
  for (const cb of assetReadyCbs) cb()
}
/** Fire the asset-ready notification from OUTSIDE this module (the skinned
 *  players GLB in player-anim.ts finishes its async parse). */
export function notifyObject3DAssetReady(): void {
  notifyAssetReady()
}

// Decoded base images: character atlases + the print overlay, keyed by id.
const kitImages = new Map<string, HTMLImageElement>()
function kitImage(key: string, dataUri: string): HTMLImageElement | null {
  let img = kitImages.get(key)
  if (!img) {
    img = new Image()
    img.onload = notifyAssetReady
    img.src = dataUri
    kitImages.set(key, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

/** The cache key a set of colors resolves to (order-stable, kit slots only). */
export function playerKitKey(objectId: string, colors: Record<string, string> | undefined): string {
  if (!colors) return objectId
  return objectId + '|' + KIT_SLOTS.map((s) => colors[s] ?? '').join('|')
}

// One texture per distinct (character, colors) look, shared across instances.
const kitTextures = new Map<string, THREE.Texture>()

/** A stripe color counts only when it's real (older docs stored the jersey color
 *  or 'transparent' in inactive stripe slots — same rule as the 2D kit editor). */
function activeStripe(c: string | undefined, jersey: string | undefined): string | undefined {
  return c && c !== 'transparent' && c !== 'none' && c !== jersey ? c : undefined
}

/** The kit texture for a character + optional recolor slots. Cached by look.
 *  Falls back to the plain character atlas while images are still decoding
 *  (subscribers re-render when they're ready). */
export function playerKitTexture(objectId: string, colors?: Record<string, string>): THREE.Texture {
  const hasCustom = !!colors && KIT_SLOTS.some((s) => colors[s])
  const key = hasCustom ? playerKitKey(objectId, colors) : objectId
  const cached = kitTextures.get(key)
  if (cached) return cached

  // Plain look: the character's own atlas, straight from the PNG.
  if (!hasCustom) {
    const tex = new THREE.TextureLoader().load(PLAYER_GLBS[objectId].texture, notifyAssetReady)
    tex.flipY = false // glTF UV convention (v origin at the top)
    tex.colorSpace = THREE.SRGBColorSpace
    kitTextures.set(key, tex)
    return tex
  }

  // Custom look: needs the decoded base atlas + print overlay; until then serve
  // the plain texture (not cached under this key, so we regenerate when ready).
  const base = kitImage(objectId, PLAYER_GLBS[objectId].texture)
  const print = kitImage('print', playerKitPrint)
  if (!base || !print) return playerKitTexture(objectId)

  const canvas = document.createElement('canvas')
  canvas.width = KIT_W
  canvas.height = KIT_H
  const g = canvas.getContext('2d')!
  g.drawImage(base, 0, 0, KIT_W, KIT_H) // defaults for untouched blocks (shoes …)

  const fillBlock = (b: number, color: string) => {
    g.fillStyle = color
    g.fillRect(b * BLOCK, 0, BLOCK, KIT_H)
  }
  if (colors![SLOT_HAIR]) fillBlock(HAIR_BLOCK, colors![SLOT_HAIR])
  if (colors![SLOT_SKIN]) fillBlock(SKIN_BLOCK, colors![SLOT_SKIN])
  if (colors![SLOT_SOCKS]) fillBlock(SOCKS_BLOCK, colors![SLOT_SOCKS])
  if (colors![SLOT_SHORTS]) fillBlock(SHORTS_BLOCK, colors![SLOT_SHORTS])

  const jersey = colors![SLOT_JERSEY]
  const v = activeStripe(colors![SLOT_VSTRIPE], jersey)
  const h = activeStripe(colors![SLOT_HSTRIPE], jersey)
  if (jersey) {
    for (const b of JERSEY_BLOCKS) {
      fillBlock(b, jersey)
      // Vertical stripes: 6 bands (3 per colour) across the jersey ISLAND, with
      // half-width jersey bands at the edges so the pattern is SYMMETRIC about the
      // island centre. The back island is mirrored, so symmetry is what makes the
      // stripes continuous over the shoulders; the edge halves merge into full
      // bands at the side seams (verified in Blender).
      if (v) {
        g.fillStyle = v
        const span = JERSEY_ISLAND_X1 - JERSEY_ISLAND_X0
        const w = span / V_STRIPE_BANDS
        for (const t of [0.5, 2.5, 4.5]) {
          g.fillRect(b * BLOCK + JERSEY_ISLAND_X0 + t * w, 0, w, KIT_H)
        }
      }
      // Horizontal hoops: 16px bands over the block height (body-horizontal).
      if (h) {
        g.fillStyle = h
        const BAND = 16
        for (let y = BAND; y < KIT_H; y += BAND * 2) g.fillRect(b * BLOCK, y, BLOCK, BAND)
      }
    }
    // Sleeve caps / long sleeves follow the jersey base colour.
    g.fillStyle = jersey
    g.fillRect(SLEEVE_X, 0, KIT_W - SLEEVE_X, KIT_H)
  }
  g.drawImage(print, 0, 0, KIT_W, KIT_H) // restore the "PLAYER 10" prints

  const tex = new THREE.CanvasTexture(canvas)
  tex.flipY = false
  tex.colorSpace = THREE.SRGBColorSpace
  kitTextures.set(key, tex)
  return tex
}

/* ---- 3D tokens ----------------------------------------------------------------
 * The profiled token disc (assets/token_profile.svg revolved in Blender, unit
 * diameter, base at y=0). Its FACE carries a canvas texture with the token's
 * fill style (solid / stripes / checker / plaid) and the number, planar-mapped
 * from above so it also wraps the rim. Textures are cached per look. */

/** The disc-face look: the 2D token's badge style, painted on the 3D face. */
export interface TokenFaceStyle {
  tokenFill: TokenFill
  color1: string
  color2: string
  text: string
  textColor: string
  /** The board-wide token number size multiplier (the "Text size" global). */
  textScale: number
}
export function tokenFaceKey(s: TokenFaceStyle): string {
  return [s.tokenFill, s.color1, s.color2, s.text, s.textColor, String(s.textScale)].join('|')
}

// The shading overlay stamped on every token face (a pre-rendered disc with
// soft top light + dark rim), composited in 'hard-light' over the drawn style —
// it replaces the old glossy Phong material with baked, style-tinted shading.
// Decoded lazily; cached faces are redrawn (and a re-render notified) on load.
let tokenOverlayImg: HTMLImageElement | null = null
let tokenOverlayReady = false
function tokenOverlay(): HTMLImageElement | null {
  if (!tokenOverlayImg) {
    tokenOverlayImg = new Image()
    tokenOverlayImg.onload = () => {
      tokenOverlayReady = true
      for (const [key, e] of tokenFaceTextures) {
        drawTokenFace(e.canvas, faceStyleFromKey(key))
        e.tex.needsUpdate = true
      }
      notifyAssetReady()
    }
    tokenOverlayImg.src = tokenOverlayUrl
  }
  return tokenOverlayReady ? tokenOverlayImg : null
}
function faceStyleFromKey(key: string): TokenFaceStyle {
  const [tokenFill, color1, color2, text, textColor, textScale] = key.split('|')
  return { tokenFill: tokenFill as TokenFill, color1, color2, text, textColor, textScale: Number(textScale) || 1 }
}

// Fake contact shadow under each puck: a small flat quad textured with the
// pre-rendered crescent (token_overlay_shadow.png). The artwork is authored
// against the face texture with their TOP-RIGHT corners aligned, so the
// crescent falls to the bottom-left; and since the quad is a child of the puck
// (which yaws to keep its number upright), the shadow reads bottom-left ON
// SCREEN from any camera — matching the baked top-light face shading.
const TOKEN_SHADOW_W = 556 / 504 // shadow artwork size in disc units
const TOKEN_SHADOW_H = 563 / 503 // (the face texture spans the unit footprint)
let tokenShadowTex: THREE.Texture | null = null
function tokenShadowTexture(): THREE.Texture {
  if (!tokenShadowTex) {
    const img = new Image()
    const tex = new THREE.Texture(img)
    tex.colorSpace = THREE.SRGBColorSpace
    img.onload = () => {
      tex.needsUpdate = true
      notifyAssetReady()
    }
    img.src = tokenShadowUrl
    tokenShadowTex = tex
  }
  return tokenShadowTex
}
let tokenShadowGeom: THREE.PlaneGeometry | null = null

const tokenFaceTextures = new Map<string, { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement }>()
function tokenFaceTexture(s: TokenFaceStyle): THREE.CanvasTexture {
  const key = tokenFaceKey(s)
  const cached = tokenFaceTextures.get(key)
  if (cached) return cached.tex
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  drawTokenFace(canvas, s)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tokenFaceTextures.set(key, { tex, canvas })
  return tex
}

function drawTokenFace(canvas: HTMLCanvasElement, s: TokenFaceStyle): void {
  const SIZE = canvas.width
  const k = SIZE / TOKEN_VIEW // canvas px per token-view unit (badge space is 100)
  const g = canvas.getContext('2d')!
  g.globalCompositeOperation = 'source-over'
  g.fillStyle = s.color1
  g.fillRect(0, 0, SIZE, SIZE)
  g.fillStyle = s.color2
  const P = TOKEN_STRIPE_PERIOD * k
  const C = TOKEN_CHECKER_SIZE * k
  const f = s.tokenFill
  if (f === 'vstripes' || f === 'plaid') for (let x = 0; x < SIZE; x += P) g.fillRect(x, 0, P / 2, SIZE)
  if (f === 'hstripes' || f === 'plaid') for (let y = 0; y < SIZE; y += P) g.fillRect(0, y, SIZE, P / 2)
  if (f === 'checker') {
    for (let y = 0, j = 0; y < SIZE; y += C, j++)
      for (let x = 0, i = 0; x < SIZE; x += C, i++) if ((i + j) % 2 === 0) g.fillRect(x, y, C, C)
  }
  if (f === 'vstripe') g.fillRect(SIZE / 2 - (TOKEN_SINGLE_STRIPE * k) / 2, 0, TOKEN_SINGLE_STRIPE * k, SIZE)
  if (f === 'hstripe') g.fillRect(0, SIZE / 2 - (TOKEN_SINGLE_STRIPE * k) / 2, SIZE, TOKEN_SINGLE_STRIPE * k)
  if (s.text) {
    const t = TOKEN_GEOMETRY.token.text
    g.fillStyle = s.textColor
    g.font = `${TOKEN_FONT_WEIGHT} ${t.size * k * s.textScale}px ${TOKEN_FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(s.text, t.x * k, t.y * k)
  }
  // Stamp the shading overlay over the drawn style: hard-light keeps the style's
  // colors where the overlay is mid-grey and bakes in its highlight/dark rim.
  const overlay = tokenOverlay()
  if (overlay) {
    g.globalCompositeOperation = 'hard-light'
    g.drawImage(overlay, 0, 0, SIZE, SIZE)
    g.globalCompositeOperation = 'source-over'
  }
}

let tokenDiscGeom: THREE.BufferGeometry | null = null
function tokenDiscGeometry(): THREE.BufferGeometry {
  if (!tokenDiscGeom) {
    const geom = parseGlbGeometry(base64ToArrayBuffer(TOKEN_DISC_GLB_BASE64))
    // Half the authored height (the GLB is unit-diameter × 0.2 tall): a slimmer
    // puck; base stays at y=0, the dome just flattens proportionally. Normals
    // must follow the inverse-transpose of the squash (y × 2, renormalized) or
    // the flattened dome would shade as if it were still tall.
    geom.scale(1, 0.5, 1)
    const nrm = geom.getAttribute('normal')
    for (let i = 0; i < nrm.count; i++) {
      const nx = nrm.getX(i)
      const ny = nrm.getY(i) * 2
      const nz = nrm.getZ(i)
      const len = Math.hypot(nx, ny, nz) || 1
      nrm.setXYZ(i, nx / len, ny / len, nz / len)
    }
    nrm.needsUpdate = true
    // Planar UVs from above (unit disc: x/z in [-0.5, 0.5]). The flat top keeps the
    // full 1:1 mapping. The RIM/side (near-horizontal normals) would otherwise sample
    // the texture's outer EDGE texels — the baked ring + gloss — and smear them
    // vertically down the side. Pull those vertices' UVs inward (toward centre) so the
    // side samples the disc's clean interior colour instead; every vertex in a rim
    // column shares one UV (UV ignores height), so there's no vertical streaking.
    const RIM_UV_SCALE = 0.6
    const pos = geom.getAttribute('position')
    const uv = new Float32Array(pos.count * 2)
    for (let i = 0; i < pos.count; i++) {
      const k = nrm.getY(i) > 0.35 ? 1 : RIM_UV_SCALE
      uv[i * 2] = 0.5 + pos.getX(i) * k
      uv[i * 2 + 1] = 0.5 - pos.getZ(i) * k
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geom.computeBoundingBox()
    tokenDiscGeom = geom
  }
  return tokenDiscGeom.clone()
}

/** A unit-diameter 3D token disc with the given face style (toon + ink outline).
 *  The layer scales it by the token's real size and re-orients it to the camera. */
export function buildTokenDisc(style: TokenFaceStyle): THREE.Mesh {
  const geom = tokenDiscGeometry()
  const s = geom.boundingBox!.getSize(new THREE.Vector3())
  const median = [s.x, s.y, s.z].sort((a, b) => a - b)[1]
  const outlineOffset = OUTLINE_FRACTION * (median || 1)
  // Toon-shaded puck (cel gradient), matching the 3D players/materials — but with
  // NO ink outline shell: the face overlay carries its own baked rim. To restore the
  // previous glossy look, swap back to `MeshLambertMaterial({ color: 0xffffff, map: … })`.
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, map: tokenFaceTexture(style), gradientMap: toonGradientMap() })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.castShadow = true
  mesh.userData.outlineOffset = outlineOffset
  mesh.userData.originAtGround = true
  mesh.userData.faceKey = tokenFaceKey(style)
  // Contact shadow: textured quad just above the grass, top-right-aligned with
  // the disc footprint (see TOKEN_SHADOW_* above). Per-mesh material so each
  // token's opacity can dim its own shadow; geometry + texture are shared.
  tokenShadowGeom ??= new THREE.PlaneGeometry(TOKEN_SHADOW_W, TOKEN_SHADOW_H)
  const shadow = new THREE.Mesh(tokenShadowGeom, new THREE.MeshBasicMaterial({ map: tokenShadowTexture(), transparent: true, depthWrite: false }))
  shadow.name = 'token-contact-shadow'
  shadow.rotation.x = -Math.PI / 2
  shadow.position.set(0.5 - TOKEN_SHADOW_W / 2, 0.004, -0.5 + TOKEN_SHADOW_H / 2)
  shadow.renderOrder = -1
  shadow.raycast = () => {} // pure visual effect: no picking…
  shadow.layers.set(1) // …and no selection outline (the OutlinePass camera only sees layer 0)
  mesh.add(shadow)
  // Raycastable: the disc IS the click target (the SVG badge is hidden and inert
  // while tokens3d is on) — Object3DLayer.pick resolves it to the element id.
  return mesh
}

/** Swap the disc's face texture when the token's style changes (cached looks). */
export function setTokenDiscFace(mesh: THREE.Mesh, style: TokenFaceStyle): void {
  const key = tokenFaceKey(style)
  if (mesh.userData.faceKey === key) return
  mesh.userData.faceKey = key
  const m = mesh.material as THREE.MeshLambertMaterial
  m.map = tokenFaceTexture(style)
  m.needsUpdate = true
}

/** Build the renderable for a 3D object id. GLB/primitive kinds are a single
 *  real-size Mesh (base on the ground); goals are a real-size Group. `userData
 *  .outlineOffset` is the ink thickness in world metres, so the layer can lift
 *  the object by it. Object3DLayer handles either. */
export function buildObject3D(objectId: string): THREE.Object3D {
  const goal = GOALS[objectId]
  if (goal) {
    // Depth (how far the frame runs back): the box goal keeps the pitch's ratio;
    // the sloped-back goals run back ~0.9× their height.
    const depth = goal.height * (goal.style === 'box' ? 0.82 : 0.9)
    return buildGoal({ width: goal.width, height: goal.height, depth, style: goal.style })
  }
  const player = PLAYER_GLBS[objectId]
  if (player) {
    const geom = glbGeometry(objectId, player.data)
    const s = geom.boundingBox!.getSize(new THREE.Vector3())
    const median = [s.x, s.y, s.z].sort((a, b) => a - b)[1]
    const outlineOffset = OUTLINE_FRACTION * (median || 1)
    // Kit atlas over a white toon base — the texture's flat colours pick up the
    // same banded toon lighting as the other materials.
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradientMap(), map: playerKitTexture(objectId) })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.castShadow = true
    mesh.add(toonOutline(geom, outlineOffset)) // silhouette ink only — crease strokes
    // would ink every facet seam of the organic low-poly body (noise, not style)
    mesh.userData.outlineOffset = outlineOffset
    // Pose GLBs are baked with their real height: grounded poses touch y=0 (with
    // ink clearance) and airborne ones (scissor kick) FLOAT — keep the authored
    // height instead of re-resting the bounding box on the ground.
    if (objectId.startsWith('pose_')) {
      mesh.userData.originAtGround = true
      const lift = POSE_GROUND_LIFT[objectId]
      if (lift) mesh.userData.groundLift = lift
    }
    return mesh
  }
  const glb = GLB_OBJECTS[objectId]
  if (glb) {
    const geom = glbGeometry(objectId, glb.data)
    const s = geom.boundingBox!.getSize(new THREE.Vector3())
    const median = [s.x, s.y, s.z].sort((a, b) => a - b)[1]
    const outlineOffset = OUTLINE_FRACTION * (median || 1)
    const bodyMat = extremeToon(glb.color)
    // The inflatable mannequin carries a printed "fake defender" on its front —
    // baked into the body material itself (see applyMannequinDecal).
    if (objectId === 'mannequin') applyMannequinDecal(bodyMat, geom)
    const mesh = new THREE.Mesh(geom, bodyMat)
    mesh.castShadow = true
    mesh.add(toonOutline(geom, outlineOffset)) // silhouette ink (shares the mesh geometry)
    mesh.add(creaseEdges(geom)) // internal strokes along the rim/creases
    mesh.userData.outlineOffset = outlineOffset
    return mesh
  }
  const multi = MULTI_GLB_OBJECTS[objectId]
  if (multi) return buildMultiGlb(objectId, multi)
  if (objectId === 'cube') {
    const mat = new THREE.MeshToonMaterial({ color: 0xff8c42 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
    mesh.castShadow = true
    return mesh
  }
  return buildBall() // ball (default)
}

// The real (GLB) soccer ball: a two-tone toon model (white shell + black patches),
// authored to rest with its ORIGIN on the ground and its CENTRE ~0.10 m up, so the
// whole ball sits a little above the surface (never half-buried by the y=0 clip).
let ballPrims: { geometry: THREE.BufferGeometry; color: THREE.Color }[] | null = null
let ballShell: THREE.BufferGeometry | null = null
function buildBall(): THREE.Group {
  if (!ballPrims) ballPrims = parseGlbByMaterial(base64ToArrayBuffer(BALL_GLB_BASE64))
  // The whole-sphere geometry (both primitives merged) — the silhouette ink needs
  // the full ball, not just one material's patches.
  if (!ballShell) {
    ballShell = parseGlbGeometry(base64ToArrayBuffer(BALL_GLB_BASE64))
    ballShell.computeBoundingBox()
  }
  const group = new THREE.Group()
  for (const { geometry, color } of ballPrims) {
    const mesh = new THREE.Mesh(geometry.clone(), extremeToon(color.getHex(THREE.SRGBColorSpace)))
    mesh.castShadow = true
    group.add(mesh)
  }
  const s = ballShell.boundingBox!.getSize(new THREE.Vector3())
  // A bolder ink line than the default fraction — a small ball's silhouette is
  // already a dark toon band, so a thin outline vanishes into it.
  const outlineOffset = OUTLINE_FRACTION * 3 * ([s.x, s.y, s.z].sort((a, b) => a - b)[1] || 1)
  group.add(toonOutline(ballShell.clone(), outlineOffset))
  group.userData.originAtGround = true // keep the authored height (don't re-rest)
  return group
}

// A multi-material GLB (e.g. the flag pole): one toon mesh per primitive, each in
// its material's authored colour and side (double-sided cloth shows on both faces),
// plus ONE whole-object silhouette + crease ink from the merged geometry. Cached
// per id. Rests on the ground via its bbox (no originAtGround).
const multiPrimsCache = new Map<string, ReturnType<typeof parseGlbByMaterial>>()
const multiShellCache = new Map<string, THREE.BufferGeometry>()
function buildMultiGlb(id: string, data: string): THREE.Group {
  let prims = multiPrimsCache.get(id)
  if (!prims) {
    prims = parseGlbByMaterial(base64ToArrayBuffer(data))
    multiPrimsCache.set(id, prims)
  }
  let shell = multiShellCache.get(id)
  if (!shell) {
    shell = parseGlbGeometry(base64ToArrayBuffer(data)) // merged, for a clean silhouette
    shell.computeBoundingBox()
    multiShellCache.set(id, shell)
  }
  const slots = MULTI_SLOTS[id]
  const group = new THREE.Group()
  for (const { geometry, color, doubleSided, name } of prims) {
    // Map the primitive to a recolor slot by its material name (e.g. "Material.Pole"
    // → "pole"); a slotted mesh starts at its slot default (Object3DLayer then
    // applies the element's per-slot overrides live).
    const slot = slots?.find((s) => name.toLowerCase().includes(s.id))
    const c = slot ? new THREE.Color(slot.default).getHex() : color.getHex(THREE.SRGBColorSpace)
    const mesh = new THREE.Mesh(geometry.clone(), extremeToon(c, doubleSided ? THREE.DoubleSide : THREE.FrontSide))
    mesh.castShadow = true
    if (slot) mesh.userData.slot = slot.id
    group.add(mesh)
  }
  const s = shell.boundingBox!.getSize(new THREE.Vector3())
  const outlineOffset = OUTLINE_FRACTION * ([s.x, s.y, s.z].sort((a, b) => a - b)[1] || 1)
  group.add(toonOutline(shell.clone(), outlineOffset)) // one silhouette around the whole model
  group.add(creaseEdges(shell)) // fold / edge strokes
  return group
}

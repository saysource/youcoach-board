// Re-bundle the 3D-object GLBs: copy each source model from assets/objects/ into
// the designer package and regenerate its base64 module. The models are embedded
// as base64 (not fetched at runtime) so the board stays embed-safe on any host.
//
// Run after re-exporting any model:   yarn glb
// Add a NEW model here + in objects3d.ts (GLB_OBJECTS / KNOWN_OBJECTS) + catalog.
//
// Each row: [ sourceFile, bundledFile, EXPORT_CONST, moduleFile ].
// (Source names keep the original spelling; bundled names are the clean ids.)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'assets/objects')
const DEST = join(root, 'packages/designer/src/assets/objects')
const LIB = join(root, 'packages/designer/src/lib')

const MODELS = [
  ['ball.glb', 'ball.glb', 'BALL_GLB_BASE64', 'ball-glb.ts'],
  ['cone.glb', 'cone.glb', 'CONE_GLB_BASE64', 'cone-glb.ts'],
  ['heigh_cone.glb', 'high_cone.glb', 'HIGH_CONE_GLB_BASE64', 'high-cone-glb.ts'],
  ['cone_hardle.glb', 'cone_hurdle.glb', 'CONE_HURDLE_GLB_BASE64', 'cone-hurdle-glb.ts'],
  ['hardle_low.glb', 'hurdle_low.glb', 'HURDLE_LOW_GLB_BASE64', 'hurdle-low-glb.ts'],
  ['hardle.glb', 'hurdle.glb', 'HURDLE_GLB_BASE64', 'hurdle-glb.ts'],
  ['hardle_high.glb', 'hurdle_high.glb', 'HURDLE_HIGH_GLB_BASE64', 'hurdle-high-glb.ts'],
  ['speed_ladder.glb', 'speed_ladder.glb', 'SPEED_LADDER_GLB_BASE64', 'speed-ladder-glb.ts'],
  ['mannequin.glb', 'mannequin.glb', 'MANNEQUIN_GLB_BASE64', 'mannequin-glb.ts'],
  ['wall_mannequin.glb', 'wall_mannequin.glb', 'WALL_MANNEQUIN_GLB_BASE64', 'wall-mannequin-glb.ts'],
  ['balance_dome.glb', 'balance_dome.glb', 'BALANCE_DOME_GLB_BASE64', 'balance-dome-glb.ts'],
  ['agility_pole.glb', 'agility_pole.glb', 'AGILITY_POLE_GLB_BASE64', 'agility-pole-glb.ts'],
  ['flag_pole.glb', 'flag_pole.glb', 'FLAG_POLE_GLB_BASE64', 'flag-pole-glb.ts'],
  ['token_disc.glb', 'token_disc.glb', 'TOKEN_DISC_GLB_BASE64', 'token-disc-glb.ts'],
  // 3D players: static meshes baked in the neutral standing pose (armature applied)
  // from the Studio Ochi pack. assets/players3d/players3d.glb keeps the skinned +
  // animated source for a future animation phase.
  ['../players3d/static/player_man_a.glb', 'player_man_a.glb', 'PLAYER_MAN_A_GLB_BASE64', 'player-man-a-glb.ts'],
  ['../players3d/static/player_man_b.glb', 'player_man_b.glb', 'PLAYER_MAN_B_GLB_BASE64', 'player-man-b-glb.ts'],
  ['../players3d/static/player_man_c.glb', 'player_man_c.glb', 'PLAYER_MAN_C_GLB_BASE64', 'player-man-c-glb.ts'],
  ['../players3d/static/player_woman_a.glb', 'player_woman_a.glb', 'PLAYER_WOMAN_A_GLB_BASE64', 'player-woman-a-glb.ts'],
  ['../players3d/static/player_woman_b.glb', 'player_woman_b.glb', 'PLAYER_WOMAN_B_GLB_BASE64', 'player-woman-b-glb.ts'],
  ['../players3d/static/player_woman_c.glb', 'player_woman_c.glb', 'PLAYER_WOMAN_C_GLB_BASE64', 'player-woman-c-glb.ts'],
  // 3D-player static POSES (Mixamo clip frames baked on Man B / Woman B; see specs/positions.md)
  ['../players3d/static/pose_man_idle.glb', 'pose_man_idle.glb', 'POSE_MAN_IDLE_GLB_BASE64', 'pose-man-idle-glb.ts'],
  ['../players3d/static/pose_man_jog.glb', 'pose_man_jog.glb', 'POSE_MAN_JOG_GLB_BASE64', 'pose-man-jog-glb.ts'],
  ['../players3d/static/pose_man_run.glb', 'pose_man_run.glb', 'POSE_MAN_RUN_GLB_BASE64', 'pose-man-run-glb.ts'],
  ['../players3d/static/pose_man_kick.glb', 'pose_man_kick.glb', 'POSE_MAN_KICK_GLB_BASE64', 'pose-man-kick-glb.ts'],
  ['../players3d/static/pose_man_low_kick.glb', 'pose_man_low_kick.glb', 'POSE_MAN_LOW_KICK_GLB_BASE64', 'pose-man-low-kick-glb.ts'],
  ['../players3d/static/pose_man_pass.glb', 'pose_man_pass.glb', 'POSE_MAN_PASS_GLB_BASE64', 'pose-man-pass-glb.ts'],
  ['../players3d/static/pose_man_receive.glb', 'pose_man_receive.glb', 'POSE_MAN_RECEIVE_GLB_BASE64', 'pose-man-receive-glb.ts'],
  ['../players3d/static/pose_man_dribbling.glb', 'pose_man_dribbling.glb', 'POSE_MAN_DRIBBLING_GLB_BASE64', 'pose-man-dribbling-glb.ts'],
  ['../players3d/static/pose_man_header.glb', 'pose_man_header.glb', 'POSE_MAN_HEADER_GLB_BASE64', 'pose-man-header-glb.ts'],
  ['../players3d/static/pose_man_jumping_header.glb', 'pose_man_jumping_header.glb', 'POSE_MAN_JUMPING_HEADER_GLB_BASE64', 'pose-man-jumping-header-glb.ts'],
  ['../players3d/static/pose_man_throw_in.glb', 'pose_man_throw_in.glb', 'POSE_MAN_THROW_IN_GLB_BASE64', 'pose-man-throw-in-glb.ts'],
  ['../players3d/static/pose_man_scissor.glb', 'pose_man_scissor.glb', 'POSE_MAN_SCISSOR_GLB_BASE64', 'pose-man-scissor-glb.ts'],
  ['../players3d/static/pose_woman_idle.glb', 'pose_woman_idle.glb', 'POSE_WOMAN_IDLE_GLB_BASE64', 'pose-woman-idle-glb.ts'],
  ['../players3d/static/pose_woman_jog.glb', 'pose_woman_jog.glb', 'POSE_WOMAN_JOG_GLB_BASE64', 'pose-woman-jog-glb.ts'],
  ['../players3d/static/pose_woman_run.glb', 'pose_woman_run.glb', 'POSE_WOMAN_RUN_GLB_BASE64', 'pose-woman-run-glb.ts'],
  ['../players3d/static/pose_woman_kick.glb', 'pose_woman_kick.glb', 'POSE_WOMAN_KICK_GLB_BASE64', 'pose-woman-kick-glb.ts'],
  ['../players3d/static/pose_woman_low_kick.glb', 'pose_woman_low_kick.glb', 'POSE_WOMAN_LOW_KICK_GLB_BASE64', 'pose-woman-low-kick-glb.ts'],
  ['../players3d/static/pose_woman_pass.glb', 'pose_woman_pass.glb', 'POSE_WOMAN_PASS_GLB_BASE64', 'pose-woman-pass-glb.ts'],
  ['../players3d/static/pose_woman_receive.glb', 'pose_woman_receive.glb', 'POSE_WOMAN_RECEIVE_GLB_BASE64', 'pose-woman-receive-glb.ts'],
  ['../players3d/static/pose_woman_dribbling.glb', 'pose_woman_dribbling.glb', 'POSE_WOMAN_DRIBBLING_GLB_BASE64', 'pose-woman-dribbling-glb.ts'],
  ['../players3d/static/pose_woman_header.glb', 'pose_woman_header.glb', 'POSE_WOMAN_HEADER_GLB_BASE64', 'pose-woman-header-glb.ts'],
  ['../players3d/static/pose_woman_jumping_header.glb', 'pose_woman_jumping_header.glb', 'POSE_WOMAN_JUMPING_HEADER_GLB_BASE64', 'pose-woman-jumping-header-glb.ts'],
  ['../players3d/static/pose_woman_throw_in.glb', 'pose_woman_throw_in.glb', 'POSE_WOMAN_THROW_IN_GLB_BASE64', 'pose-woman-throw-in-glb.ts'],
  ['../players3d/static/pose_woman_scissor.glb', 'pose_woman_scissor.glb', 'POSE_WOMAN_SCISSOR_GLB_BASE64', 'pose-woman-scissor-glb.ts'],
]

let done = 0
let skipped = 0
for (const [src, bundled, konst, mod] of MODELS) {
  const srcPath = join(SRC, src)
  if (!existsSync(srcPath)) {
    console.warn(`skip ${src} (missing)`)
    skipped++
    continue
  }
  const bytes = readFileSync(srcPath)
  writeFileSync(join(DEST, bundled), bytes) // keep a decoded copy alongside the base64
  const b64 = bytes.toString('base64')
  const module = `// Base64-encoded bytes of assets/objects/${bundled}, embedded so the model ships
// inside the JS bundle — no runtime fetch, so it stays embed-safe in every host.
// GENERATED by scripts/bundle-glbs.mjs — do not edit by hand; run \`yarn glb\`.
// Source: assets/objects/${src}.
export const ${konst} =
  '${b64}'
`
  writeFileSync(join(LIB, mod), module)
  console.log(`bundled ${src} → ${bundled} (${(bytes.length / 1024).toFixed(1)} KB)`)
  done++
}
console.log(`\n${done} model(s) bundled${skipped ? `, ${skipped} skipped` : ''}.`)

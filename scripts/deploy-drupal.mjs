// Deploy the built designer into the Drupal `youcoach_board` module:
//   packages/designer/build/**            → <MODULE>/build/      (the app)
//   packages/designer/public/catalog.json → <MODULE>/resources/  (proxied assets)
//   packages/designer/public/images/**    → <MODULE>/resources/images/
//
// Both target dirs are git-ignored in the module (this script writes that ignore).
// Runs `build:app` first unless --no-build. Target overridable via arg or
// YOUCOACH_BOARD_MODULE env.
//
//   yarn deploy:drupal            # build + copy
//   yarn deploy:drupal --no-build # copy the existing build
//   yarn deploy:drupal /path/to/module
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DESIGNER = resolve(REPO, 'packages/designer')
const BUILD_SRC = resolve(DESIGNER, 'build')
const PUBLIC_SRC = resolve(DESIGNER, 'public')

const args = process.argv.slice(2)
const noBuild = args.includes('--no-build')
const posArg = args.find((a) => !a.startsWith('--'))
const MODULE =
  posArg ??
  process.env.YOUCOACH_BOARD_MODULE ??
  '/Users/gtoffoli/Saysource/progetti/Youcoach/httpdocs/sites/all/modules/saysource/youcoach_board'

const BUILD_DST = resolve(MODULE, 'build')
const RES_DST = resolve(MODULE, 'resources')

const log = (m) => console.log(`[deploy-drupal] ${m}`)
const die = (m) => { console.error(`[deploy-drupal] ERROR: ${m}`); process.exit(1) }

function run(cmd, cmdArgs, cwd) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit' })
  if (r.status !== 0) die(`${cmd} ${cmdArgs.join(' ')} failed (${r.status})`)
}

// rsync when available (fast, incremental, --delete); else a recursive copy.
function mirror(src, dst) {
  mkdirSync(dst, { recursive: true })
  const rsync = spawnSync('rsync', ['-a', '--delete', `${src}/`, `${dst}/`], { stdio: 'inherit' })
  if (rsync.error || rsync.status !== 0) {
    log(`rsync unavailable — falling back to fs copy for ${dst}`)
    rmSync(dst, { recursive: true, force: true })
    cpSync(src, dst, { recursive: true })
  }
}

if (!noBuild) {
  log('building the standalone app (build:app)…')
  run('yarn', ['workspace', '@youcoach-board/designer', 'build:app'], REPO)
}
if (!existsSync(BUILD_SRC)) die(`no build at ${BUILD_SRC} — run without --no-build`)
if (!existsSync(MODULE)) die(`module dir not found: ${MODULE}`)

log(`app  → ${BUILD_DST}`)
mirror(BUILD_SRC, BUILD_DST)

// Copy proxied resources into resources/{catalog.json,images/} — WITHOUT deleting
// the resources root, so the committed .htaccess (proxy-only guard) survives.
log(`resources → ${RES_DST}`)
mkdirSync(RES_DST, { recursive: true })
cpSync(resolve(PUBLIC_SRC, 'catalog.json'), resolve(RES_DST, 'catalog.json'))
mirror(resolve(PUBLIC_SRC, 'images'), resolve(RES_DST, 'images'))

// Defensively (re)write the .htaccess so the resource tree is never web-readable
// except through the proxy, even on a fresh module checkout.
writeFileSync(
  resolve(RES_DST, '.htaccess'),
  '# Served only via /youcoach-board/resource. Direct access denied.\n' +
    '<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n' +
    '<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n',
)

// Keep the (large, generated) build + copied resources out of the module's git
// repo, but keep the scaffolded resources/.htaccess tracked.
const IGNORE = resolve(MODULE, '.gitignore')
const wanted = ['build/', 'resources/catalog.json', 'resources/images/']
const lines = existsSync(IGNORE) ? readFileSync(IGNORE, 'utf8').split('\n') : []
const missing = wanted.filter((w) => !lines.includes(w))
if (missing.length) {
  writeFileSync(IGNORE, [...lines.filter(Boolean), ...missing, ''].join('\n'))
  log(`.gitignore += ${missing.join(', ')}`)
}

log('done.')

// Dev-server crash tracer.
//
// Runs the designer's Vite dev server as a child and records EXACTLY how it
// dies — distinguishing an external kill (SIGTERM from VS Code / launchd /
// runningboard) from an internal crash, and capturing parent/lifecycle context
// at the moment of death. Use instead of `yarn dev` when chasing the "yarn dev
// exits with 143" issue:
//
//   yarn dev:trace
//
// When it dies, share /tmp/ycb-dev-trace.log — it tells us:
//   - whether THIS wrapper got a signal (→ group/external kill, e.g. VS Code)
//     vs the child exiting on its own (→ internal),
//   - which signal (SIGTERM/SIGHUP/SIGINT…),
//   - whether our parent (the shell/terminal) died (ppid → 1),
//   - the last heartbeat (RSS/CPU) before death,
//   - recent runningboard/launchd log lines around the kill.

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const LOG = '/tmp/ycb-dev-trace.log'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = resolve(repoRoot, 'node_modules/.bin/vite')
const designerDir = resolve(repoRoot, 'packages/designer')

const stamp = () => new Date().toISOString()
function log(msg) {
  const line = `[${stamp()}] ${msg}\n`
  process.stdout.write(line)
  try {
    appendFileSync(LOG, line)
  } catch {
    /* ignore */
  }
}
function sh(cmd, args) {
  try {
    return spawnSync(cmd, args, { encoding: 'utf8' }).stdout?.trim() ?? ''
  } catch {
    return ''
  }
}

log('============================================================')
log(`dev-trace START  wrapperPid=${process.pid}  ppid=${process.ppid}`)
log(`node=${process.version}  vite=${viteBin}`)
log(`parent chain:\n${sh('ps', ['-o', 'pid,ppid,stat,command', '-p', String(process.ppid)])}`)

// stdio piped (not inherited) so we can TEE Vite's output into the trace log —
// that way any error/stack Vite prints right before exiting is captured here.
const child = spawn(viteBin, [], { cwd: designerDir, stdio: ['inherit', 'pipe', 'pipe'] })
log(`spawned vite childPid=${child.pid}`)
const tee = (stream, prefix) =>
  stream.on('data', (d) => {
    process.stdout.write(d)
    try {
      appendFileSync(LOG, d)
    } catch {
      /* ignore */
    }
    void prefix
  })
tee(child.stdout, 'out')
tee(child.stderr, 'err')

let lastBeat = ''
const beat = setInterval(() => {
  const ps = sh('ps', ['-o', 'rss,pcpu,stat', '-p', String(child.pid)]).split('\n')[1] || 'gone'
  // Vite 8 uses Rolldown workers/subprocesses — list them so we can see if one
  // dies (which would explain Vite exiting without being signaled itself).
  const kids = sh('pgrep', ['-P', String(child.pid)]).split('\n').filter(Boolean)
  lastBeat = `ppid=${process.ppid} childRSS/CPU=[${ps.trim()}] viteSubprocs=[${kids.join(',') || 'none'}]`
}, 5000)

// A signal arriving HERE means something terminated us (or our process group).
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2']) {
  process.on(sig, () => {
    log(`!!! WRAPPER received ${sig}  (current ppid=${process.ppid})`)
    log(`last heartbeat before signal: ${lastBeat}`)
    log(`parent now:\n${sh('ps', ['-o', 'pid,ppid,stat,command', '-p', String(process.ppid)])}`)
    // Recent OS lifecycle context (who terminated the coalition, app naps, etc.)
    const ctx = sh('log', [
      'show',
      '--last',
      '30s',
      '--style',
      'compact',
      '--predicate',
      'eventMessage CONTAINS[c] "terminat" OR eventMessage CONTAINS[c] "SIGTERM" OR eventMessage CONTAINS[c] "runningboard"',
    ])
    log(`recent OS log (terminate/runningboard):\n${ctx.split('\n').slice(-25).join('\n')}`)
    try {
      child.kill(sig)
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(0), 400)
  })
}

child.on('exit', (code, signal) => {
  clearInterval(beat)
  log(`### CHILD vite EXITED  code=${code}  signal=${signal}`)
  log(`last heartbeat: ${lastBeat}`)
  // If we get here WITHOUT the wrapper itself receiving a signal, vite died on
  // its own (internal crash / self-exit), which points away from VS Code.
  log('dev-trace END')
  process.exit(code ?? (signal ? 1 : 0))
})

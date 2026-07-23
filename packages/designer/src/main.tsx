import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { BoardDoc } from '@youcoach-board/core'
import { BoardDesigner } from './BoardDesigner'
import { boardDocFromText } from './lib/board-file'
import { boardSnapshot } from './lib/export-image'
import type { AssetsConfig } from './lib/assets'
import type { ThemeSetting } from './lib/use-theme'

// Entry point for BOTH the standalone dev harness (`yarn dev`) and the app build
// served by the Drupal `youcoach_board` module (`build:app`). A host page (Drupal)
// may inject `window.__YCB_SETTINGS__` before this script to point asset loading at
// its /resource proxy, pick the UI language, and seed the document; with no global
// we fall back to the dev defaults (public/ folder, empty board, ?lang→English), so
// `yarn dev` is unchanged.
interface BoardSettings {
  /** URL template with a `__path__` placeholder for the resource proxy, e.g.
   *  "/youcoach-board/resource?id=__path__". Omit for the dev public/ folder. */
  resourceBase?: string
  /** UI language ('en' | 'it' | a locale like 'it-IT'); omit to use ?lang→English. */
  language?: string
  initialDoc?: Partial<BoardDoc>
  theme?: ThemeSetting
  showThemeControl?: boolean
  /** Headless video-render page (Drupal /youcoach-board/render/<token>): mounts
   *  the chrome-less RenderShell driven through window.ycbRender. */
  renderMode?: boolean
  /** Host endpoint for server-side MP4 exports; enables "Export video…". */
  exportUrl?: string
  /** Read-only viewer: presentation surface with hover video controls. */
  viewerMode?: boolean
}

declare global {
  interface Window {
    __YCB_SETTINGS__?: BoardSettings
  }
}

const settings = window.__YCB_SETTINGS__ ?? {}

const assetsFor = (resourceBase?: string): AssetsConfig | undefined => (resourceBase ? { urlTemplate: resourceBase, catalog: 'catalog.json' } : undefined)

/** Mount options for the plain-JS embed API: the shared settings plus the
 *  document — either raw (`doc`) or as JSON text (`json`, accepting v3 files
 *  AND legacy v1/v2 drills through the converter). */
interface MountOptions extends BoardSettings {
  doc?: Partial<BoardDoc>
  json?: string
}

/** Mount a board into `el`. Returns an unmount function. Used by non-React
 *  hosts (the Drupal loader); React hosts (App 2) import BoardDesigner from
 *  the library build instead. */
function mount(el: HTMLElement, opts: MountOptions = {}): () => void {
  // The compiled CSS is scoped to `.ycb-root` — the mount element must carry it.
  el.classList.add('ycb-root')
  const fromJson = opts.json != null ? (boardDocFromText(opts.json) ?? undefined) : undefined
  const root = createRoot(el)
  root.render(
    <StrictMode>
      <BoardDesigner
        initialDoc={fromJson ?? opts.doc ?? { title: 'Untitled drill' }}
        language={opts.language}
        theme={opts.theme}
        showThemeControl={opts.showThemeControl ?? true}
        assets={assetsFor(opts.resourceBase)}
        renderMode={opts.renderMode}
        viewerMode={opts.viewerMode}
        exportUrl={opts.exportUrl}
      />
    </StrictMode>,
  )
  return () => root.unmount()
}

// The embed API for plain-JS hosts, announced with an event for loaders that
// run before this (deferred) module: window.YouCoachBoard.mount(el, options)
// and .snapshot(width?, height?) — a PNG Blob of the current drawing, ready
// for a FormData upload next to the document JSON (with several boards on one
// page, the LAST mounted board answers).
declare global {
  interface Window {
    YouCoachBoard?: { mount: typeof mount; snapshot: typeof boardSnapshot }
  }
}
window.YouCoachBoard = { mount, snapshot: boardSnapshot }
window.dispatchEvent(new Event('youcoach-board-ready'))

// Auto-mount the full-page app into the host-provided container (Drupal uses
// #ycb-root) or the dev harness's #root. An EMBED page (youcoach_board_loader)
// has neither — its containers mount through the API above instead.
const mountEl = document.getElementById('ycb-root') ?? document.getElementById('root')
if (mountEl) mount(mountEl, settings)

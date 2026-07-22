import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { BoardDoc } from '@youcoach-board/core'
import { BoardDesigner } from './BoardDesigner'
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

// Mount into the host-provided container (Drupal uses #ycb-root) or the dev
// harness's #root. The compiled CSS is scoped to `.ycb-root`, so the mount element
// must carry that class for anything to be styled.
const mountEl = document.getElementById('ycb-root') ?? document.getElementById('root')!
mountEl.classList.add('ycb-root')

const assets: AssetsConfig | undefined = settings.resourceBase
  ? { urlTemplate: settings.resourceBase, catalog: 'catalog.json' }
  : undefined

createRoot(mountEl).render(
  <StrictMode>
    <BoardDesigner
      initialDoc={settings.initialDoc ?? { title: 'Untitled drill' }}
      language={settings.language}
      theme={settings.theme}
      showThemeControl={settings.showThemeControl ?? true}
      assets={assets}
      renderMode={settings.renderMode}
      viewerMode={settings.viewerMode}
      exportUrl={settings.exportUrl}
    />
  </StrictMode>,
)

import { type BoardDoc } from '@youcoach-board/core'
import { BoardShell } from './components/BoardShell'
import { EditorStoreProvider } from './store/EditorStoreProvider'
import { AssetsProvider } from './lib/AssetsProvider'
import { type AssetsConfig } from './lib/assets'
import type { ThemeSetting } from './lib/use-theme'
// TEMPORARY default field background. Will be replaced once asset locations are
// defined/loaded dynamically (the URL just feeds the doc's background.image).
import defaultFieldImage from './assets/field0.jpg'
import { DEFAULT_ZONE } from './lib/field-zones'

// Base image kept for legacy (fieldSvg) docs; figure scale for the default field.
const DEFAULT_FIELD_FIGURE_SCALE = 0.3

export interface BoardDesignerProps {
  /** Document to start from (a full or partial board). Defaults to empty. */
  initialDoc?: Partial<BoardDoc>
  /** Initial theme (uncontrolled). Defaults to following the OS ("system"). */
  initialTheme?: ThemeSetting
  /** Controlled theme — when set, the host owns it and changes sync live (e.g.
   *  mirror App2's light/dark). Takes precedence over `initialTheme` and the
   *  in-menu switch. Omit to let the board manage its own theme. */
  theme?: ThemeSetting
  /** Whether to show the in-menu theme switch. Later driven by embed config. */
  showThemeControl?: boolean
  /** Where figures/thumbnails/catalog load from. Defaults to the dev server's
   *  public/ folder. Memoize this if you pass it (it keys the catalog fetch). */
  assets?: AssetsConfig
  /** Called whenever the document changes (create / delete / undo / redo). */
  onChange?: (doc: BoardDoc) => void
}

// The editor's public entry point: a per-instance editor store wrapping the
// floating-chrome shell + interactive board.
export function BoardDesigner({ initialDoc, initialTheme, theme, showThemeControl, assets, onChange }: BoardDesignerProps) {
  // A fresh board opens on the real 3D field (a default preset pose) over the base
  // grass image. Legacy docs that carry a hand-drawn `fieldSvg` keep the old SVG.
  const bg = initialDoc?.background
  const legacy = !!bg?.fieldSvg
  const docWithBackground = {
    ...initialDoc,
    background: {
      ...bg,
      image: bg?.image ?? defaultFieldImage,
      fieldSvg: bg?.fieldSvg ?? null,
      field3d: bg?.field3d ?? (legacy ? null : DEFAULT_ZONE.camera),
      figureScale: bg?.figureScale ?? DEFAULT_FIELD_FIGURE_SCALE,
    },
  }
  return (
    <AssetsProvider config={assets}>
      <EditorStoreProvider initialDoc={docWithBackground} onChange={onChange}>
        <BoardShell initialTheme={initialTheme} theme={theme} showThemeControl={showThemeControl} />
      </EditorStoreProvider>
    </AssetsProvider>
  )
}

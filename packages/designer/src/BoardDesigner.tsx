import { type BoardDoc } from '@youcoach-board/core'
import { BoardShell } from './components/BoardShell'
import { EditorStoreProvider } from './store/EditorStoreProvider'
import { AssetsProvider } from './lib/AssetsProvider'
import { type AssetsConfig } from './lib/assets'
import type { ThemeSetting } from './lib/use-theme'
// TEMPORARY default field background. Will be replaced once asset locations are
// defined/loaded dynamically (the URL just feeds the doc's background.image).
import defaultFieldImage from './assets/field0.jpg'

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
  // Default the field background to the bundled image unless the caller set one.
  const docWithBackground = {
    ...initialDoc,
    background: { ...initialDoc?.background, image: initialDoc?.background?.image ?? defaultFieldImage },
  }
  return (
    <AssetsProvider config={assets}>
      <EditorStoreProvider initialDoc={docWithBackground} onChange={onChange}>
        <BoardShell initialTheme={initialTheme} theme={theme} showThemeControl={showThemeControl} />
      </EditorStoreProvider>
    </AssetsProvider>
  )
}

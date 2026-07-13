import { useEffect } from 'react'
import { type BoardDoc } from '@youcoach-board/core'
import { I18nextProvider } from 'react-i18next'
import { BoardShell } from './components/BoardShell'
import { EditorStoreProvider } from './store/EditorStoreProvider'
import { AssetsProvider } from './lib/AssetsProvider'
import { type AssetsConfig } from './lib/assets'
import { i18n, resolveLanguage } from './lib/i18n'
import type { ThemeSetting } from './lib/use-theme'
// The bundled default field background, plus a repair for stale references to it
// saved by a different build (see field-image.ts).
import { DEFAULT_FIELD_IMAGE, resolveFieldImage } from './lib/field-image'
import { topViewForField } from './lib/field-zones'

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
  /** UI language ('en' | 'it' | a locale like 'it-IT'). Omitted → the page
   *  URL's ?lang parameter, then English. Unsupported values fall back to
   *  English. Changing the prop switches the live UI. */
  language?: string
  /** Where figures/thumbnails/catalog load from. Defaults to the dev server's
   *  public/ folder. Memoize this if you pass it (it keys the catalog fetch). */
  assets?: AssetsConfig
  /** Called whenever the document changes (create / delete / undo / redo). */
  onChange?: (doc: BoardDoc) => void
}

// The editor's public entry point: a per-instance editor store wrapping the
// floating-chrome shell + interactive board.
export function BoardDesigner({ initialDoc, initialTheme, theme, showThemeControl, language, assets, onChange }: BoardDesignerProps) {
  // UI language: host prop → URL ?lang → English (see lib/i18n.ts).
  useEffect(() => {
    const lang = resolveLanguage(language)
    if (i18n.language !== lang) void i18n.changeLanguage(lang)
  }, [language])
  // A fresh board opens on the real 3D field (a default preset pose) over the base
  // grass image. Legacy docs that carry a hand-drawn `fieldSvg` keep the old SVG.
  const bg = initialDoc?.background
  const legacy = !!bg?.fieldSvg
  const docWithBackground = {
    ...initialDoc,
    background: {
      ...bg,
      image: resolveFieldImage(bg?.image) ?? DEFAULT_FIELD_IMAGE,
      fieldSvg: bg?.fieldSvg ?? null,
      field3d: bg?.field3d ?? (legacy ? null : topViewForField(bg?.fieldType ?? 'soccer11')),
      figureScale: bg?.figureScale ?? DEFAULT_FIELD_FIGURE_SCALE,
    },
  }
  return (
    <I18nextProvider i18n={i18n}>
      <AssetsProvider config={assets}>
        <EditorStoreProvider initialDoc={docWithBackground} onChange={onChange}>
          <BoardShell initialTheme={initialTheme} theme={theme} showThemeControl={showThemeControl} />
        </EditorStoreProvider>
      </AssetsProvider>
    </I18nextProvider>
  )
}

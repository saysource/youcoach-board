// Public surface of @youcoach-board/designer.
//
// NOTE for hosts: the compiled styles ship separately — import them once:
//   import '@youcoach-board/designer/styles.css'
// They are scoped to the component's `.ycb-root` wrapper and won't touch the
// host page (no global reset, tokens + dark mode live on our root).
export { BoardDesigner } from './BoardDesigner'
// eslint-disable-next-line react-refresh/only-export-components -- package entry, not a component module
export { boardSnapshot } from './lib/export-image'
// Hosts that persist a document (App2 stores it on the drill row) get back
// arbitrary JSON — possibly a legacy v1/v2 drawing from the old editor. This
// is the same parse → convert → repair pipeline "Open…" uses, so `initialDoc`
// can be fed a converted doc instead of a raw shape the store can't read.
// eslint-disable-next-line react-refresh/only-export-components -- package entry, not a component module
export { boardDocFromText } from './lib/board-file'
export type { BoardDesignerProps } from './BoardDesigner'
export type { ThemeSetting } from './lib/use-theme'
export type { BoardDoc } from '@youcoach-board/core'

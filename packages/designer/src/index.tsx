// Public surface of @youcoach-board/designer.
//
// NOTE for hosts: the compiled styles ship separately — import them once:
//   import '@youcoach-board/designer/styles.css'
// They are scoped to the component's `.ycb-root` wrapper and won't touch the
// host page (no global reset, tokens + dark mode live on our root).
export { BoardDesigner } from './BoardDesigner'
// eslint-disable-next-line react-refresh/only-export-components -- package entry, not a component module
export { boardSnapshot } from './lib/export-image'
export type { BoardDesignerProps } from './BoardDesigner'
export type { ThemeSetting } from './lib/use-theme'
export type { BoardDoc } from '@youcoach-board/core'

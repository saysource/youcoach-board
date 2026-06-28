import { createContext, useContext } from 'react'

// Embeddable-styling glue. Radix overlays (dropdown menus, tooltips) render
// through a Portal that defaults to document.body — OUTSIDE our `.ycb-root`,
// where our scoped tokens and `.dark` class don't reach. So BoardShell exposes
// its own root element here, and every primitive portals INTO it instead, which
// keeps all rendered UI inside the scoped subtree.
const BoardRootContext = createContext<HTMLElement | null>(null)

export const BoardRootProvider = BoardRootContext.Provider

/** The element Radix portals should mount into. Null until the root mounts. */
export function usePortalContainer(): HTMLElement | null {
  return useContext(BoardRootContext)
}

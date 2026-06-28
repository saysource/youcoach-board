import { useEffect, useState } from 'react'

// Responsive breakpoint based on the COMPONENT's own width (container query
// style), not the viewport — so an embedded board adapts to the space it's
// given. Thresholds match the spec (Excalidraw-like): >=1180 full, >=768
// compact, else mobile.
export type Breakpoint = 'full' | 'compact' | 'mobile'

export function useBreakpoint(el: HTMLElement | null): Breakpoint {
  const [width, setWidth] = useState(() => el?.clientWidth ?? 1200)
  useEffect(() => {
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return width >= 1180 ? 'full' : width >= 768 ? 'compact' : 'mobile'
}

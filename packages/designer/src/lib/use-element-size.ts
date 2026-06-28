import { useEffect, useState } from 'react'

// Tracks an element's content box (width + height). Used to decide the
// properties-panel layout from the component's own size and the rendered
// canvas width (which is height-driven, since the field is a fixed 4:3 fit).
export function useElementSize(el: HTMLElement | null): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: el?.clientWidth ?? 1200, height: el?.clientHeight ?? 800 }))
  useEffect(() => {
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return size
}

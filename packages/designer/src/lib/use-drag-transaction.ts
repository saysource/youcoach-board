import { useCallback, useRef } from 'react'
import { useEditorStoreApi } from '../store/context'

// Coalesce a drag's many edits into ONE undo step. Call the returned `arm` from
// the control's onValueChange/onChange: the FIRST change of a drag begins an undo
// transaction and registers a one-shot `window` pointerup/pointercancel listener
// to commit it; later changes are no-ops until that release. Listening on
// `window` (not the element) is what makes commit reliable — the control captures
// the pointer, so the release fires on the captured target or even outside the
// window, never as an element-level onPointerUp.
export function useDragTransaction() {
  const storeApi = useEditorStoreApi()
  const armed = useRef(false)
  return useCallback(() => {
    if (armed.current) return
    armed.current = true
    storeApi.getState().beginTransaction()
    const end = () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      armed.current = false
      storeApi.getState().commitTransaction()
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }, [storeApi])
}

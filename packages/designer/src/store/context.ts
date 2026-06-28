import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { EditorState, EditorStore } from './editorStore'

// The React context carrying the per-instance editor store. The Provider lives
// in EditorStoreProvider.tsx; hooks live here so neither file mixes a component
// with non-component exports (keeps Fast Refresh happy).
export const EditorStoreContext = createContext<EditorStore | null>(null)

/** Subscribe to a slice of editor state (re-renders on change). */
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error('useEditorStore must be used within an EditorStoreProvider')
  return useStore(store, selector)
}

/** Get the store handle without subscribing — for actions / one-off reads
 *  (e.g. keyboard handlers) via store.getState(). */
export function useEditorStoreApi(): EditorStore {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error('useEditorStoreApi must be used within an EditorStoreProvider')
  return store
}

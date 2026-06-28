import { useState, type ReactNode } from 'react'
import { parseBoard, type BoardDoc } from '@youcoach-board/core'
import { createEditorStore } from './editorStore'
import { EditorStoreContext } from './context'

interface EditorStoreProviderProps {
  initialDoc?: Partial<BoardDoc> | unknown
  onChange?: (doc: BoardDoc) => void
  children: ReactNode
}

// Provides one editor store per provider instance, so each embedded
// <BoardDesigner> keeps its own document/selection/history. The lazy useState
// initializer creates the store exactly once (on first render).
export function EditorStoreProvider({ initialDoc, onChange, children }: EditorStoreProviderProps) {
  // parseBoard normalizes any partial/untrusted input into a valid BoardDoc.
  const [store] = useState(() => createEditorStore(parseBoard(initialDoc ?? {}), onChange))
  return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>
}

import { useState, type ReactNode } from 'react'
import { parseBoard, type BoardDoc } from '@youcoach-board/core'
import { pinLoadedDoc } from '../lib/board-file'
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
  // parseBoard normalizes any partial/untrusted input into a valid BoardDoc;
  // pinLoadedDoc then grounds it on its 3D field like any loaded document
  // (no-op for editor-authored docs, which are already pinned).
  const [store] = useState(() => {
    const doc = parseBoard(initialDoc ?? {})
    pinLoadedDoc(doc)
    return createEditorStore(doc, onChange)
  })
  return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>
}

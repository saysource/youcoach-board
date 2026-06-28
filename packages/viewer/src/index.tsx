import { BoardCanvas, ElementView, type BoardDoc } from '@youcoach-board/core'

export interface BoardViewerProps {
  doc: BoardDoc
  className?: string
}

// Read-only surface: render the document (background + elements) through the
// shared core primitives and nothing else. No editing affordances, no state.
export function BoardViewer({ doc, className }: BoardViewerProps) {
  return (
    <BoardCanvas doc={doc} className={className}>
      {doc.elements.map((element) => (
        <ElementView key={element.id} element={element} />
      ))}
    </BoardCanvas>
  )
}

export type { BoardDoc }

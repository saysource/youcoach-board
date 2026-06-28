import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BoardDesigner } from './BoardDesigner'

// Standalone dev harness — the "independent tool outside App2" proof.
// `yarn dev` (or `yarn workspace @youcoach-board/designer dev`) serves this.
// The shell fills its container, so we give it the full viewport here.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BoardDesigner initialDoc={{ title: 'Untitled drill' }} />
  </StrictMode>,
)

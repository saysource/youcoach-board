import { Undo2, Redo2 } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface UndoRedoBarProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

// Bottom-left undo/redo control, driven by the editor's command stack.
export function UndoRedoBar({ canUndo, canRedo, onUndo, onRedo }: UndoRedoBarProps) {
  return (
    <div className="pointer-events-auto flex items-center rounded-lg border border-border bg-card shadow-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Redo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>
    </div>
  )
}

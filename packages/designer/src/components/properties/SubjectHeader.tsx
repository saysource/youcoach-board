import { type ComponentType } from 'react'
import { Square, Circle, Minus, MoveRight, Spline, Shapes, MousePointer2, Hand, Pencil, Eraser } from 'lucide-react'
import type { BoardElement } from '@youcoach-board/core'
import { useEditorStore } from '../../store/context'
import type { ToolId } from '../Toolbar'
import { cn } from '../../lib/cn'

type Subject = { icon: ComponentType<{ className?: string }>; label: string }

// What kind of figure a polyline currently is (line / arrow / closed shape /
// multi-point polyline), so the header reflects the actual element.
function polylineSubject(el: Extract<BoardElement, { type: 'polyline' }>): Subject {
  if (el.closed) return { icon: Shapes, label: 'Shape' }
  if (el.points.length === 2) {
    if (el.startTip === 'arrow' || el.endTip === 'arrow') return { icon: MoveRight, label: 'Arrow' }
    return { icon: Minus, label: 'Line' }
  }
  return { icon: Spline, label: 'Polyline' }
}

function elementSubject(el: BoardElement): Subject {
  if (el.type === 'rect') return { icon: Square, label: 'Rectangle' }
  if (el.type === 'ellipse') return { icon: Circle, label: 'Ellipse' }
  if (el.type === 'draw') return { icon: Pencil, label: 'Drawing' }
  return polylineSubject(el)
}

// The active tool, for when nothing is selected. Doubles as the indicator for
// tools that aren't on the main toolbar (e.g. ellipse, players, materials).
const TOOL_SUBJECT: Record<ToolId, Subject> = {
  select: { icon: MousePointer2, label: 'Selection' },
  hand: { icon: Hand, label: 'Pan' },
  rectangle: { icon: Square, label: 'Rectangle' },
  ellipse: { icon: Circle, label: 'Ellipse' },
  arrow: { icon: MoveRight, label: 'Arrow' },
  line: { icon: Minus, label: 'Line' },
  draw: { icon: Pencil, label: 'Draw' },
  eraser: { icon: Eraser, label: 'Eraser' },
}

function subjectFor(els: BoardElement[], activeTool: ToolId): Subject {
  if (els.length === 0) return TOOL_SUBJECT[activeTool]
  if (els.length === 1) return elementSubject(els[0])
  // Multiple: uniform type → that type's icon; otherwise the "mixed" icon (the
  // More-tools glyph).
  const sameType = els.every((e) => e.type === els[0].type)
  return sameType ? elementSubject(els[0]) : { icon: Shapes, label: 'Mixed' }
}

// The top-of-panel indicator: the selected element type, a mixed icon for a
// mixed selection, or the active tool when nothing is selected. With a tool
// selected (no selection) the panel below shows the FUTURE element's style.
export function SubjectHeader({ compact = false }: { compact?: boolean }) {
  const doc = useEditorStore((s) => s.doc)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const activeTool = useEditorStore((s) => s.activeTool)
  const els = doc.elements.filter((e) => selectedIds.includes(e.id))
  const { icon: Icon, label } = subjectFor(els, activeTool)

  if (compact) {
    return (
      <div
        title={label}
        aria-label={label}
        className="flex size-8 items-center justify-center text-muted-foreground [&_svg]:size-5"
      >
        <Icon />
      </div>
    )
  }
  return (
    <div className={cn('flex items-center gap-2 px-1 text-sm font-medium text-foreground', '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground')}>
      <Icon />
      <span className="truncate">{label}</span>
    </div>
  )
}

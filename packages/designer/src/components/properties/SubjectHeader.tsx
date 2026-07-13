import { type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Square, Circle, Diamond, Pentagon, Triangle, Minus, MoveRight, Spline, Shapes, MousePointer2, Pencil, Eraser, Type, Lasso, RulerDimensionLine } from 'lucide-react'
import { TrapezoidIcon, ElbowLineIcon, ElbowArrowIcon, LineZigzagArrowIcon, LineStyleDoubleIcon, TokenIcon } from '../icons'
import type { BoardElement } from '@youcoach-board/core'
import { useEditorStore } from '../../store/context'
import type { ToolId } from '../Toolbar'
import { cn } from '../../lib/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

type Subject = { icon: ComponentType<{ className?: string }>; label: string }

// What kind of figure a polyline currently is (line / arrow / closed shape /
// multi-point polyline), so the header reflects the actual element.
function polylineSubject(el: Extract<BoardElement, { type: 'polyline' }>): Subject {
  // A pitch-warped oval is a polyline internally, but presented as an ellipse.
  if (el.oval) return { icon: Circle, label: 'Oval' }
  if (el.closed) return { icon: Shapes, label: 'Shape' }
  const arrow = el.startTip === 'arrow' || el.endTip === 'arrow'
  if (el.zigzag) return { icon: LineZigzagArrowIcon, label: arrow ? 'Zigzag arrow' : 'Zigzag line' }
  if (el.double) return { icon: LineStyleDoubleIcon, label: arrow ? 'Double arrow' : 'Double line' }
  if (el.curve) return { icon: arrow ? ElbowArrowIcon : ElbowLineIcon, label: arrow ? 'Curved arrow' : 'Curved line' }
  if (el.points.length === 2) return arrow ? { icon: MoveRight, label: 'Arrow' } : { icon: Minus, label: 'Line' }
  return { icon: Spline, label: 'Polyline' }
}

function elementSubject(el: BoardElement): Subject {
  if (el.type === 'rect') return { icon: Square, label: 'Rectangle' }
  if (el.type === 'ellipse') return { icon: Circle, label: 'Ellipse' }
  if (el.type === 'draw') return { icon: Pencil, label: 'Drawing' }
  if (el.type === 'figure') return { icon: Shapes, label: 'Figure' }
  if (el.type === 'token') return { icon: TokenIcon, label: el.shape === 'jersey' ? 'Jersey' : 'Token' }
  if (el.type === 'text') return { icon: Type, label: 'Text' }
  if (el.type === 'arrow3d') return { icon: Spline, label: '3D Arrow' }
  if (el.type === 'object3d') return { icon: Shapes, label: el.objectId === 'cube' ? '3D Cube' : '3D Ball' }
  // Diamond/pentagon/triangle/trapezoid are created as closed polylines, so they
  // surface here through polylineSubject (a closed polyline → "Shape").
  return polylineSubject(el)
}

// The active tool, for when nothing is selected. Doubles as the indicator for
// tools that aren't on the main toolbar (e.g. ellipse, players, materials).
const TOOL_SUBJECT: Record<ToolId, Subject> = {
  select: { icon: MousePointer2, label: 'Selection' },
  rectangle: { icon: Square, label: 'Rectangle' },
  ellipse: { icon: Circle, label: 'Ellipse' },
  diamond: { icon: Diamond, label: 'Diamond' },
  pentagon: { icon: Pentagon, label: 'Pentagon' },
  triangle: { icon: Triangle, label: 'Triangle' },
  trapezoid: { icon: TrapezoidIcon, label: 'Trapezoid' },
  arrow: { icon: MoveRight, label: 'Arrow' },
  line: { icon: Minus, label: 'Line' },
  'elbow-arrow': { icon: ElbowArrowIcon, label: 'Elbow arrow' },
  'elbow-line': { icon: ElbowLineIcon, label: 'Elbow line' },
  'zigzag-arrow': { icon: LineZigzagArrowIcon, label: 'Zigzag arrow' },
  'double-arrow': { icon: LineStyleDoubleIcon, label: 'Double arrow' },
  tape: { icon: RulerDimensionLine, label: 'Tape measure' },
  token: { icon: TokenIcon, label: 'Token' },
  text: { icon: Type, label: 'Text' },
  draw: { icon: Pencil, label: 'Draw' },
  eraser: { icon: Eraser, label: 'Eraser' },
  lasso: { icon: Lasso, label: 'Lasso' },
  arrow3d: { icon: Spline, label: '3D Arrow' },
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
  const { t } = useTranslation()
  const doc = useEditorStore((s) => s.doc)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const activeTool = useEditorStore((s) => s.activeTool)
  const els = doc.elements.filter((e) => selectedIds.includes(e.id))
  const { icon: Icon, label: rawLabel } = subjectFor(els, activeTool)
  const label = t(rawLabel)

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            title={label}
            aria-label={label}
            className="flex size-8 items-center justify-center [&_svg]:size-5 rounded-lg opacity-25"
          >
            <Icon />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" align="center" className="w-max max-w-[200px]">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className={cn('flex items-center gap-2 px-1 text-sm font-medium text-foreground', '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground')}>
      <Icon />
      <span className="truncate">{label}</span>
    </div>
  )
}

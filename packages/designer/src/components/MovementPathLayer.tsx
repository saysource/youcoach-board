import { useState } from 'react'
import type { AnimationFrame, BoardElement } from '@youcoach-board/core'
import { clientToBoard } from '../lib/draw'
import { elementCenter, insertIndexFor, pathable, samplePath, type PathPoint } from '../lib/movement-path'

// Movement-path editor (specs/animation.md Phase 2): for every element of the
// CURRENT frame that also exists in the previous one, a thick semitransparent
// purple spline shows how its centre will travel during playback. The stored
// intermediate anchors are draggable; pressing down on the line inserts a new
// anchor there (and drags it); double-clicking an anchor removes it. Endpoints
// derive from the element positions and are not editable.

const PATH_COLOR = '#a855f7' // purple, per spec
const MIN_MOVE = 4 // board units under which an unbent path isn't shown

interface Props {
  /** Previous frame's snapshot (path start positions). */
  prevElements: BoardElement[]
  /** Live elements of the current frame (path end positions). */
  elements: BoardElement[]
  /** Stored movement paths INTO the current frame. */
  paths: AnimationFrame['paths']
  /** Current render scale (screen px per board unit) for constant-size strokes. */
  scale: number
  /** Commit an element's path (null clears it). */
  onSetPath: (elementId: string, points: PathPoint[] | null) => void
}

export function MovementPathLayer({ prevElements, elements, paths, scale, onSetPath }: Props) {
  const s = scale || 1
  // Anchor being dragged: live points held locally, committed on pointer-up.
  const [drag, setDrag] = useState<{ id: string; index: number; points: PathPoint[] } | null>(null)

  function startDrag(e: React.PointerEvent, id: string, index: number, points: PathPoint[]) {
    e.stopPropagation()
    e.preventDefault()
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement
    if (!svg) return
    // The live points are tracked in the closure; state only mirrors them for
    // rendering (committing happens once, on pointer-up).
    let live = points.map((p) => [...p] as PathPoint)
    setDrag({ id, index, points: live })
    const move = (ev: PointerEvent) => {
      const p = clientToBoard(svg, ev.clientX, ev.clientY)
      live = live.slice()
      live[index] = [p.x, p.y]
      setDrag({ id, index, points: live })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const p = clientToBoard(svg, ev.clientX, ev.clientY)
      live = live.slice()
      live[index] = [p.x, p.y]
      setDrag(null)
      onSetPath(id, live)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <g data-layer="movement-paths">
      {elements.map((el) => {
        if (!pathable(el)) return null
        const prev = prevElements.find((p) => p.id === el.id && p.type === el.type)
        if (!prev) return null
        const a = elementCenter(prev)
        const b = elementCenter(el)
        if (!a || !b) return null
        const stored = paths?.[el.id] ?? []
        const mids = drag?.id === el.id ? drag.points : stored
        if (mids.length === 0 && Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_MOVE) return null
        const ctrl: PathPoint[] = [a, ...mids, b]
        const pts = samplePath(ctrl)
        const d = `M ${pts.map((p) => `${p[0]} ${p[1]}`).join(' L ')}`
        return (
          <g key={el.id}>
            {/* The path itself: thick, semitransparent purple. Pressing on it
                inserts a new anchor at that spot and starts dragging it. */}
            <path
              d={d}
              fill="none"
              stroke={PATH_COLOR}
              strokeWidth={6 / s}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.45}
              style={{ cursor: 'copy', pointerEvents: 'stroke' }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement
                if (!svg) return
                const p = clientToBoard(svg, e.clientX, e.clientY)
                const idx = insertIndexFor(a, stored, b, [p.x, p.y])
                const pts2 = stored.slice()
                pts2.splice(idx, 0, [p.x, p.y])
                startDrag(e, el.id, idx, pts2)
              }}
            />
            {/* Small derived endpoints (not editable). */}
            <circle cx={a[0]} cy={a[1]} r={3 / s} fill={PATH_COLOR} opacity={0.6} pointerEvents="none" />
            <circle cx={b[0]} cy={b[1]} r={3 / s} fill={PATH_COLOR} opacity={0.6} pointerEvents="none" />
            {/* Stored anchors: drag to bend; double-click to remove. */}
            {mids.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={5 / s}
                fill="#ffffff"
                stroke={PATH_COLOR}
                strokeWidth={2.5 / s}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  startDrag(e, el.id, i, mids)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  const pts2 = stored.slice()
                  pts2.splice(i, 1)
                  onSetPath(el.id, pts2.length ? pts2 : null)
                }}
              />
            ))}
          </g>
        )
      })}
    </g>
  )
}

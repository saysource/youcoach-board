import { useState } from 'react'
import '../styles/board.css'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { BoardRootProvider } from '../lib/board-root'
import { useEditorStore } from '../store/context'
import { InteractiveBoard } from './InteractiveBoard'
import { PresentationOverlay } from './PresentationOverlay'

// The read-only VIEWER: the designer's presentation surface with no editor
// chrome and no exit — mounted via BoardDesigner's `viewerMode` prop. Sharing
// the presentation stack (InteractiveBoard presenting + PresentationOverlay)
// means every designer improvement flows to the viewer automatically; the
// measured bundle cost over a dedicated tree-shaken viewer is ~6%.
//
// Controls (PresentationOverlay): with more than one frame, hovering shows the
// video bar — play/pause + timeline scrubber + a cog menu (orbit / pan /
// laser / speed / fix-the-view). A still drawing shows no controls.
//
// NOTE: the overlay + laser position against the viewport, so the viewer is
// meant to fill the page (the Drupal use). Tight embedding in a scrolling host
// page would need container-relative positioning first.
export function ViewerShell() {
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)
  const field3d = useEditorStore((s) => s.doc.background.field3d)
  // Orbit/pan the 3D camera (the cog menu's switches): the same navigation
  // modes BoardShell drives in presentation, owned here.
  const [navigating, setNavigating] = useState(false)
  const [fieldPan, setFieldPan] = useState(false)
  return (
    <div ref={setRootEl} className="ycb-root relative isolate h-full w-full overflow-hidden bg-background text-foreground">
      <TooltipPrimitive.Provider delayDuration={300}>
        <BoardRootProvider value={rootEl}>
          <div className="absolute inset-0">
            <InteractiveBoard presenting navigating={navigating} fieldPanMode={navigating && fieldPan} onExitFieldPan={() => setFieldPan(false)} />
          </div>
          <PresentationOverlay
            canNavigate={!!field3d}
            orbiting={navigating && !fieldPan}
            panning={navigating && fieldPan}
            onOrbit={() => {
              if (navigating && !fieldPan) setNavigating(false)
              else {
                setNavigating(true)
                setFieldPan(false)
              }
            }}
            onPan={() => {
              if (navigating && fieldPan) {
                setNavigating(false)
                setFieldPan(false)
              } else {
                setNavigating(true)
                setFieldPan(true)
              }
            }}
            onExitNav={() => {
              setNavigating(false)
              setFieldPan(false)
            }}
          />
        </BoardRootProvider>
      </TooltipPrimitive.Provider>
    </div>
  )
}

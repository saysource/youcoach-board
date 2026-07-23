import { useEffect, useState } from 'react'
import '../styles/board.css'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { cn } from '../lib/cn'
import { useTheme, type ThemeSetting } from '../lib/use-theme'
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
export function ViewerShell({ initialTheme, theme: controlledTheme }: { initialTheme?: ThemeSetting; theme?: ThemeSetting }) {
  // Scoped styling: the dark class lives on OUR root, never on <html> (embed
  // safety) — so the host tells us its theme (App 2 mirrors its dark mode via
  // the `theme` prop), defaulting to the OS preference.
  const { isDark } = useTheme(initialTheme, controlledTheme)
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)
  const field3d = useEditorStore((s) => s.doc.background.field3d)
  // Orbit/pan the 3D camera (the controls panel's toggles): the same navigation
  // modes BoardShell drives in presentation, owned here.
  const [navigating, setNavigating] = useState(false)
  const [fieldPan, setFieldPan] = useState(false)
  // "Fill the viewport" (embed-friendly fullscreen, like BoardShell's): pin the
  // whole component over the host page — useful when the viewer sits small
  // inside an app page.
  const [fullscreen, setFullscreen] = useState(false)
  // Esc leaves fill-the-viewport (capture phase, like presentation's exit —
  // it must win over any other Escape handling below).
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [fullscreen])
  return (
    <div ref={setRootEl} className={cn('ycb-root isolate overflow-hidden bg-background text-foreground', fullscreen ? 'fixed inset-0 z-[2147483647]' : 'relative h-full w-full', isDark && 'dark')}>
      <TooltipPrimitive.Provider delayDuration={300}>
        <BoardRootProvider value={rootEl}>
          <div className="absolute inset-0">
            <InteractiveBoard presenting navigating={navigating} fieldPanMode={navigating && fieldPan} onExitFieldPan={() => setFieldPan(false)} />
          </div>
          <PresentationOverlay
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((v) => !v)}
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

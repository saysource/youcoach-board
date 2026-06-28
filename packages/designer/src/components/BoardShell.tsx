import { useEffect, useState } from 'react'
import '../styles/board.css'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { BoardRootProvider } from '../lib/board-root'
import { useTheme, type ThemeSetting } from '../lib/use-theme'
import { cn } from '../lib/cn'
import { useEditorStore, useEditorStoreApi } from '../store/context'
import { isCreationTool } from '../store/editorStore'
import { Toolbar } from './Toolbar'
import { MainMenu } from './MainMenu'
import { TopRightControls } from './TopRightControls'
import { LibraryDrawer } from './LibraryDrawer'
import { ZoomBar } from './ZoomBar'
import { UndoRedoBar } from './UndoRedoBar'
import { InteractiveBoard } from './InteractiveBoard'

export interface BoardShellProps {
  initialTheme?: ThemeSetting
  /** Controlled theme — when set, the host owns it (live-synced); the in-menu
   *  switch no longer changes the board. Omit for an uncontrolled board. */
  theme?: ThemeSetting
  /** Whether the theme switch is shown. Later driven by embed config. */
  showThemeControl?: boolean
}

// The editor shell: floating chrome around the interactive board. Document /
// selection / tool / history live in the editor store; theme, drawer and
// fullscreen are local view chrome (not part of the drawing).
export function BoardShell({ initialTheme, theme: controlledTheme, showThemeControl }: BoardShellProps) {
  const { theme, setTheme, isDark } = useTheme(initialTheme, controlledTheme)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  // Editor store: subscribe to what the chrome needs; actions via the api handle.
  const store = useEditorStoreApi()
  const activeTool = useEditorStore((s) => s.activeTool)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)
  const keepToolActive = useEditorStore((s) => s.keepToolActive)
  const toggleKeepTool = useEditorStore((s) => s.toggleKeepTool)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.pointer >= 0)
  const canRedo = useEditorStore((s) => s.pointer < s.stack.length - 1)

  // The root is also the Radix portal container, so menus/tooltips stay inside
  // our scoped, theme-aware subtree. Tracked in state so context updates on mount.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)

  // Keyboard: undo/redo, delete selection, escape to deselect / drop the tool.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      const mod = e.metaKey || e.ctrlKey
      const { undo, redo, deleteSelected, setSelection, setActiveTool, activeTool } = store.getState()

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      } else if (e.key === 'Escape') {
        if (isCreationTool(activeTool)) setActiveTool('select')
        else setSelection([])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])

  return (
    <div
      ref={setRootEl}
      className={cn(
        'ycb-root relative isolate overflow-hidden bg-background text-foreground',
        // "Fill the viewport" simply pins the whole component over the host —
        // the embed-friendly meaning of fullscreen (no native Fullscreen API).
        fullscreen ? 'fixed inset-0 z-[2147483647]' : 'h-full w-full',
        isDark && 'dark',
      )}
      style={fullscreen ? undefined : { minHeight: 480 }}
    >
      <TooltipPrimitive.Provider delayDuration={300}>
        <BoardRootProvider value={rootEl}>
          {/* Interactive board fills the workspace; the field self-centers. */}
          <div className="absolute inset-0 py-10 px-2 sm:px-4 md:px-6 lg:px-8">
            <InteractiveBoard />
          </div>

          {/* Top-left menu */}
          <div className="absolute left-3 top-3 z-30">
            <MainMenu theme={theme} onThemeChange={setTheme} showThemeControl={showThemeControl} />
          </div>

          {/* Top-center toolbar */}
          <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
            <Toolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              locked={keepToolActive}
              onToggleLock={toggleKeepTool}
            />
          </div>

          {/* Top-right controls */}
          <div className="absolute right-3 top-3 z-30">
            <TopRightControls
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreen((v) => !v)}
              drawerOpen={drawerOpen}
              onToggleDrawer={() => setDrawerOpen((v) => !v)}
            />
          </div>

          {/* Bottom-left zoom + undo/redo */}
          <div className="absolute bottom-3 left-3 z-30 flex items-center gap-2">
            <ZoomBar />
            <UndoRedoBar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
          </div>

          {/* Right library drawer */}
          <LibraryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        </BoardRootProvider>
      </TooltipPrimitive.Provider>
    </div>
  )
}

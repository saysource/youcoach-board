import { useEffect, useState } from 'react'
import '../styles/board.css'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { BoardRootProvider } from '../lib/board-root'
import { BOARD_ASPECT } from '@youcoach-board/core'
import { useTheme, type ThemeSetting } from '../lib/use-theme'
import { useElementSize } from '../lib/use-element-size'
import type { Breakpoint } from '../lib/use-breakpoint'
import { cn } from '../lib/cn'
import { useAssets } from '../lib/assets'
import { useEditorStore, useEditorStoreApi } from '../store/context'
import { isCreationTool } from '../store/editorStore'
import { Toolbar } from './Toolbar'
import { MainMenu } from './MainMenu'
import { TopRightControls } from './TopRightControls'
import { LibraryDrawer } from './LibraryDrawer'
import { ZoomBar } from './ZoomBar'
import { UndoRedoBar } from './UndoRedoBar'
import { InteractiveBoard } from './InteractiveBoard'
import { PropertiesPanel, MobileBar } from './properties/PropertiesPanel'

// Board area padding (px) and the space reserved on the left for the full
// properties panel (panel width + margins).
const BOARD_TOP_PAD = 40
const BOARD_SIDE_PAD = 16
// Left space reserved for the full panel: left-2 (8) + w-52 (208) + gap.
const PANEL_RESERVE = 200
// Right-side library drawer width (Tailwind w-72 = 18rem).
const DRAWER_WIDTH = 288

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
  const [drawerPinned, setDrawerPinned] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  // The library's selected category lives here (not in the drawer) so the
  // toolbar's More-tools menu can jump to a category and open the drawer.
  const { catalog } = useAssets()
  const [libraryCatId, setLibraryCatId] = useState<string | null>(null)
  if (catalog && libraryCatId === null) setLibraryCatId(catalog.groups[0]?.categories[0] ?? null)
  function openCategory(catId: string) {
    setLibraryCatId(catId)
    setDrawerOpen(true)
  }

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
  const figureAddedTick = useEditorStore((s) => s.figureAddedTick)

  // Adding a figure (click or drag-drop) closes the drawer when it's a floating
  // overlay — a quick "pick one and go". Pin it to keep it open for several. The
  // drawer stays mounted, so its category/scroll are remembered on reopen.
  const [seenFigureTick, setSeenFigureTick] = useState(figureAddedTick)
  if (figureAddedTick !== seenFigureTick) {
    setSeenFigureTick(figureAddedTick)
    if (drawerOpen && !drawerPinned) setDrawerOpen(false)
  }

  // The root is also the Radix portal container, so menus/tooltips stay inside
  // our scoped, theme-aware subtree. Tracked in state so context updates on mount.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)

  // Responsive layout from the component's own size (container-query style).
  const { width, height } = useElementSize(rootEl)
  const innerH = Math.max(0, height - 2 * BOARD_TOP_PAD)
  // Rendered field width: the 4:3 fit is height-driven when there's horizontal
  // room, so derive it from height (minus the board's vertical padding).
  const canvasWidth = Math.min(Math.max(0, width - 2 * BOARD_SIDE_PAD), innerH * BOARD_ASPECT)
  const mobile = width < 768
  // Full panel only when ~a panel's worth of free width sits beside the field;
  // otherwise the compact toolbar (which overlays minimally).
  const fullPanel = !mobile && width - canvasWidth >= PANEL_RESERVE
  const breakpoint: Breakpoint = mobile ? 'mobile' : fullPanel ? 'full' : 'compact'
  // The full panel is a permanent fixture, so reserve the left space (shifting
  // the field right) whenever in full mode. The compact panel overlays instead.
  const reserveLeft = fullPanel

  // Field's rendered (height-driven) width within the current left reserve.
  const leftPad = reserveLeft ? PANEL_RESERVE : BOARD_SIDE_PAD
  const availWidth = Math.max(0, width - leftPad - BOARD_SIDE_PAD)
  const fieldW = Math.min(availWidth, innerH * BOARD_ASPECT)

  // When the drawer is OPEN as an overlay, keep the field centered but pull its
  // right edge no further than the drawer's left edge, so the drawer doesn't
  // cover it — without ever pushing the field's left edge past the reserve. The
  // upshot: wide containers don't move (already clear); mid widths slide left
  // just enough to meet the drawer; widths too tight to fully clear it sit
  // flush-left, minimizing BOTH the overlap and the unused space on the left.
  // (We grow the right padding to shift the centered field left.) A docked
  // (pinned) drawer instead refits the board into the remaining width (right-72).
  const overlayOpen = drawerOpen && !drawerPinned
  const naturalRight = leftPad + (availWidth + fieldW) / 2 // centered field's right edge
  const targetRight = Math.max(leftPad + fieldW, Math.min(naturalRight, width - DRAWER_WIDTH))
  const boardPaddingRight = overlayOpen ? Math.max(BOARD_SIDE_PAD, width + leftPad - 2 * targetRight + fieldW) : BOARD_SIDE_PAD
  const reserveRight = drawerOpen && drawerPinned

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
          {/* Interactive board fills the workspace; the field self-centers in the
              available area. The drawer (when docked) refits it from the right,
              and the full properties panel reserves space on the left. */}
          <div
            className={cn(
              'absolute inset-y-0 left-0 transition-all duration-200',
              reserveRight ? 'right-72' : 'right-0',
            )}
            style={{
              paddingTop: BOARD_TOP_PAD,
              paddingBottom: BOARD_TOP_PAD,
              paddingLeft: leftPad,
              paddingRight: boardPaddingRight,
            }}
          >
            <InteractiveBoard />
          </div>

          {/* Top-left menu */}
          <div className="absolute left-3 top-3 z-30">
            <MainMenu theme={theme} onThemeChange={setTheme} showThemeControl={showThemeControl} />
          </div>

          {/* Main toolbar — top-center, or bottom-center in mobile mode. */}
          <div className={cn('pointer-events-none absolute left-1/2 z-30 -translate-x-1/2', mobile ? 'bottom-3' : 'top-3')}>
            <Toolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              locked={keepToolActive}
              onToggleLock={toggleKeepTool}
              onOpenCategory={openCategory}
            />
          </div>

          {/* Properties panel: always present (both the full and the compact
              form), showing the selection's or the active tool's properties.
              Mobile uses MobileBar below. */}
          {!mobile && <PropertiesPanel mode={breakpoint} />}

          {/* Mobile: always-visible undo/redo (+ selection props/actions) above
              the bottom toolbar, as translucent floating buttons. */}
          {mobile && <MobileBar />}

          {/* Top-right controls. When the drawer is open they relocate into its
              header, so the corner is hidden. */}
          {!drawerOpen && (
            <div className="absolute right-3 top-3 z-30">
              <TopRightControls
                fullscreen={fullscreen}
                onToggleFullscreen={() => setFullscreen((v) => !v)}
                drawerOpen={drawerOpen}
                onToggleDrawer={() => setDrawerOpen((v) => !v)}
              />
            </div>
          )}

          {/* Bottom-left zoom + undo/redo. Hidden in mobile mode, where the main
              toolbar occupies the bottom and undo/redo live in the property bar. */}
          {!mobile && (
            <div className="absolute bottom-3 left-3 z-30 flex items-center gap-2">
              <ZoomBar />
              <UndoRedoBar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
            </div>
          )}

          {/* Right library drawer (overlay, or docked sidebar when pinned). */}
          <LibraryDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            pinned={drawerPinned}
            onTogglePin={() => setDrawerPinned((v) => !v)}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((v) => !v)}
            categoryId={libraryCatId}
            onCategoryChange={setLibraryCatId}
          />
        </BoardRootProvider>
      </TooltipPrimitive.Provider>
    </div>
  )
}

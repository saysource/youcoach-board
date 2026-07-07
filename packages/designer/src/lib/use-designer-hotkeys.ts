import { useEffect } from 'react'
import type { EditorStore } from '../store/editorStore'
import { isCreationTool } from '../store/editorStore'
import type { ToolId } from '../components/Toolbar'

// Single-key tool shortcuts (no modifier). Letters follow the spec; the number
// row mirrors the toolbar order as a convenient alternate.
const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select', '1': 'select',
  r: 'rectangle', '2': 'rectangle',
  '3': 'diamond',
  o: 'ellipse', '4': 'ellipse',
  s: 'rectangle', // Shapes → activate the rectangle (shape) tool
  a: 'arrow', '5': 'arrow',
  l: 'line', '6': 'line',
  d: 'draw', '7': 'draw',
  t: 'text', '8': 'text',
  k: 'token',
  e: 'eraser', '0': 'eraser',
}

export interface HotkeyDeps {
  storeApi: EditorStore
  /** In background-edit mode ESC finishes it (before other ESC behavior). */
  bgEditing: boolean
  finishBackground: () => void
  /** Enter the background / field editor (bound to F, which also finishes it). */
  editBackground: () => void
  /** Open the players / materials library drawer. */
  openPlayers: () => void
  openMaterials: () => void
  /** Toggle 3D scene navigation (orbit) mode — bound to W. */
  onToggleNav?: () => void
  /** Whether scene navigation is currently active (so ESC can exit it). */
  navigating?: boolean
  /** Quick-add a ball at board center. */
  addBall: () => void
  /** Toggle the alignment grid (optional until implemented). */
  toggleGrid?: () => void
  /** Open the keyboard-shortcuts help dialog. */
  showHelp?: () => void
  /** Move the 3D field camera when nothing is selected (arrow keys): 'orbit'
   *  rotates like a mouse drag, 'pan' (Shift) slides across the ground. ux/uy are
   *  −1/0/1 from Left/Right and Up/Down. */
  moveCamera?: (mode: 'orbit' | 'pan', ux: number, uy: number) => void
  /** Dolly the 3D field camera (+/- keys): dir +1 zooms in, −1 zooms out. */
  zoomCamera?: (dir: 1 | -1) => void
}

// Whether the event originates from a text field (so we don't hijack typing).
function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

/** Install the designer's global keyboard shortcuts. Handlers read the store live
 *  via `storeApi.getState()` so the effect needn't re-bind on every edit. */
export function useDesignerHotkeys(deps: HotkeyDeps) {
  const { storeApi } = deps
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const alt = e.altKey
      const shift = e.shiftKey
      const key = e.key
      const lower = key.length === 1 ? key.toLowerCase() : key
      const s = storeApi.getState()
      // ⌥ combos: on macOS `e.key` becomes a special glyph (⌥S → "ß"), so match
      // the physical key via `e.code` (layout-independent, "KeyS").

      // ── ESC: background mode → navigation → creation tool → clear selection ─
      if (key === 'Escape') {
        if (deps.bgEditing) {
          e.preventDefault()
          deps.finishBackground()
          return
        }
        if (deps.navigating && deps.onToggleNav) {
          e.preventDefault()
          deps.onToggleNav() // exit scene navigation
          return
        }
        if (isCreationTool(s.activeTool)) s.setActiveTool('select')
        else s.setSelection([])
        return
      }

      // ── Modifier combos (⌘ on mac, Ctrl elsewhere) ─────────────────────────
      if (mod) {
        // Copy / paste STYLE (⌘⌥C / ⌘⌥V) — checked before plain copy/paste.
        if (alt && lower === 'c') { e.preventDefault(); s.copyStyle(); return }
        if (alt && lower === 'v') { e.preventDefault(); s.pasteStyle(); return }
        // Z-order: ⌘⌥] front, ⌘⌥[ back, ⌘] forward, ⌘[ backward.
        if (key === ']') { e.preventDefault(); s.arrangeSelected(alt ? 'front' : 'forward'); return }
        if (key === '[') { e.preventDefault(); s.arrangeSelected(alt ? 'back' : 'backward'); return }
        // Resize the selection (⌘⌥⇧ +/-).
        if (alt && shift && (key === '+' || key === '=')) { e.preventDefault(); s.resizeSelected(1.1); return }
        if (alt && shift && (key === '-' || key === '_')) { e.preventDefault(); s.resizeSelected(1 / 1.1); return }

        switch (lower) {
          case 'z': e.preventDefault(); if (shift) s.redo(); else s.undo(); return
          case 'y': e.preventDefault(); s.redo(); return
          case 'a': e.preventDefault(); s.selectAll(); return
          case 'c': e.preventDefault(); s.copySelection(); return
          case 'x': e.preventDefault(); s.cutSelection(); return
          case 'v': e.preventDefault(); s.paste(); return
          case 'd': e.preventDefault(); s.duplicateSelected(); return
          case 'f': e.preventDefault(); s.flipSelected(); return
          case 'b': e.preventDefault(); s.toggleTextBold(); return
          default: return
        }
      }

      // ── ⌥ (no ⌘): toggle snap ──────────────────────────────────────────────
      if (alt && !mod) {
        if (e.code === 'KeyS') { e.preventDefault(); s.toggleSnapToObjects(); return }
        return
      }

      // ── Plain keys (no ⌘/⌥) ────────────────────────────────────────────────
      if (key === 'Delete' || key === 'Backspace') { s.deleteSelected(); return }

      // Arrow keys: with a selection, nudge it (⇧ = ×10); with nothing selected,
      // move the 3D field camera like a mouse drag (⇧ = pan instead of orbit).
      // Navigation + background-edit orbit through the field overlay's own handler,
      // so we only drive the camera here in normal mode.
      if (key.startsWith('Arrow')) {
        const ux = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
        const uy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0
        if (s.selectedIds.length) {
          e.preventDefault()
          s.nudgeSelected(ux * (shift ? 10 : 1), uy * (shift ? 10 : 1))
        } else if (!deps.navigating && !deps.bgEditing) {
          e.preventDefault()
          deps.moveCamera?.(shift ? 'pan' : 'orbit', ux, uy)
        }
        return
      }

      // +/- zoom the 3D scene camera (like arrows, navigation + bg-edit go through
      // the field overlay's own handler). Independent of the selection.
      if (key === '+' || key === '=' || key === '-' || key === '_') {
        if (!deps.navigating && !deps.bgEditing) {
          e.preventDefault()
          deps.zoomCamera?.(key === '+' || key === '=' ? 1 : -1)
        }
        return
      }

      if (lower === 'q') { s.toggleKeepTool(); return }
      // F: enter the background / field editor (and finish it when already in).
      if (lower === 'f') { e.preventDefault(); if (deps.bgEditing) deps.finishBackground(); else deps.editBackground(); return }
      if (lower === 'g' && deps.toggleGrid) { e.preventDefault(); deps.toggleGrid(); return }
      if (lower === 'b') { deps.addBall(); return }
      // Space toggles 3D scene navigation (orbit) mode.
      if (e.code === 'Space' && deps.onToggleNav) { e.preventDefault(); deps.onToggleNav(); return }
      if (lower === 'p') { deps.openPlayers(); return }
      if (lower === 'm') { deps.openMaterials(); return }
      if (key === '?' && deps.showHelp) { e.preventDefault(); deps.showHelp(); return }

      const tool = TOOL_KEYS[lower]
      if (tool) { s.setActiveTool(tool); return }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // deps.* are read fresh inside the handler; re-bind only when identity changes.
  }, [deps, storeApi])
}

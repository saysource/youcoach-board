import { useEffect } from 'react'
import type { EditorStore } from '../store/editorStore'
import { isCreationTool } from '../store/editorStore'
import type { ToolId } from '../components/Toolbar'

// Single-key tool shortcuts (no modifier). Letters follow the spec; the number
// row mirrors the toolbar order as a convenient alternate.
const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select', '1': 'select',
  h: 'hand',
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
  /** Toggle 3D scene navigation (orbit) mode — bound to P. */
  onToggleNav?: () => void
  /** Quick-add a ball at board center. */
  addBall: () => void
  /** Toggle the alignment grid (optional until implemented). */
  toggleGrid?: () => void
  /** Open the keyboard-shortcuts help dialog. */
  showHelp?: () => void
  /** Viewport zoom (optional until implemented). */
  zoom?: (kind: 'in' | 'out' | 'reset' | 'fit' | 'selection') => void
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

      // ── ESC: background mode → creation tool → clear selection ──────────────
      if (key === 'Escape') {
        if (deps.bgEditing) {
          e.preventDefault()
          deps.finishBackground()
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
        // Resize (⌘⌥⇧ +/-) — checked before zoom (which is ⌘ +/- without ⌥).
        if (alt && shift && (key === '+' || key === '=')) { e.preventDefault(); s.resizeSelected(1.1); return }
        if (alt && shift && (key === '-' || key === '_')) { e.preventDefault(); s.resizeSelected(1 / 1.1); return }
        // Zoom (⌘ +/-/0) and fit/selection (⌥1 / ⌥2 handled below without ⌘).
        if (!alt && (key === '+' || key === '=')) { e.preventDefault(); deps.zoom?.('in'); return }
        if (!alt && (key === '-' || key === '_')) { e.preventDefault(); deps.zoom?.('out'); return }
        if (!alt && key === '0') { e.preventDefault(); deps.zoom?.('reset'); return }

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

      // ── ⌥ (no ⌘): zoom to fit / selection, toggle snap ─────────────────────
      if (alt && !mod) {
        if (e.code === 'Digit1') { e.preventDefault(); deps.zoom?.('fit'); return }
        if (e.code === 'Digit2') { e.preventDefault(); deps.zoom?.('selection'); return }
        if (e.code === 'KeyS') { e.preventDefault(); s.toggleSnapToObjects(); return }
        return
      }

      // ── Plain keys (no ⌘/⌥) ────────────────────────────────────────────────
      if (key === 'Delete' || key === 'Backspace') { s.deleteSelected(); return }

      // Arrow keys: nudge the selection (⇧ = coarse); with nothing selected, pan.
      if (key.startsWith('Arrow')) {
        const step = shift ? 10 : 1
        const ux = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
        const uy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0
        e.preventDefault()
        if (s.selectedIds.length) s.nudgeSelected(ux * step, uy * step)
        else s.panBy(ux * 40, uy * 40)
        return
      }

      if (lower === 'q') { s.toggleKeepTool(); return }
      // F: enter the background / field editor (and finish it when already in).
      if (lower === 'f') { e.preventDefault(); if (deps.bgEditing) deps.finishBackground(); else deps.editBackground(); return }
      if (lower === 'g' && deps.toggleGrid) { e.preventDefault(); deps.toggleGrid(); return }
      if (lower === 'b') { deps.addBall(); return }
      // P toggles 3D scene navigation (orbit) mode.
      if (lower === 'p' && deps.onToggleNav) { e.preventDefault(); deps.onToggleNav(); return }
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

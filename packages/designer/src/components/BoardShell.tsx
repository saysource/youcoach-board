import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import '../styles/board.css'
import { Check, Rotate3d, Square } from 'lucide-react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { Button } from './ui/button'
import { BoardRootProvider } from '../lib/board-root'
import { BOARD_ASPECT, BOARD_WIDTH, BOARD_HEIGHT, isLegacyBackground, type FieldView } from '@youcoach-board/core'
import { useTheme, type ThemeSetting } from '../lib/use-theme'
import { useElementSize } from '../lib/use-element-size'
import type { Breakpoint } from '../lib/use-breakpoint'
import { cn } from '../lib/cn'
import { useAssets, figureColorInfo, figureIndex, figureBaseSize, fieldFigureScale } from '../lib/assets'
import { playerSvgs, PLAYER_SLOTS } from '../lib/player-kit'
import { isObject3DPlayer } from '../lib/objects3d'
import { topViewForField, fieldsCategoryIdFor } from '../lib/field-zones'
import { orbitStep, panStep, dollyStep, type PitchType } from '../lib/field-camera'
import { animateFieldTo as tweenFieldTo, cancelFieldAnimation } from '../lib/field-anim'
import { startPlayback, stopPlayback } from '../lib/animation-playback'
import { applyOpenedBoard, loadBoard, openBoardFromFile, saveBoardToFile } from '../lib/board-file'
import { useEditorStore, useEditorStoreApi } from '../store/context'
import { useDesignerHotkeys } from '../lib/use-designer-hotkeys'
import { addBall } from '../lib/quick-add'
import { Toolbar } from './Toolbar'
import { MainMenu } from './MainMenu'
import { TopRightControls } from './TopRightControls'
import { LibraryDrawer } from './LibraryDrawer'
import { UndoRedoBar } from './UndoRedoBar'
import { NavBar } from './NavBar'
import { NavHints, EditHints } from './NavHints'
import { AnimationBar } from './AnimationBar'
import { InteractiveBoard } from './InteractiveBoard'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { GameSystemDialog } from './GameSystemDialog'
import { PresentationOverlay } from './PresentationOverlay'
import { PropertiesPanel, MobileBar } from './properties/PropertiesPanel'

// Board area padding (px) and the space reserved on the left for the full
// properties panel (panel width + margins).
const BOARD_TOP_PAD = 40
const BOARD_LEFT_PAD = 50
const BOARD_RIGHT_PAD = 16
// Left space reserved for the full panel: left-2 (8) + w-52 (208) + gap.
const PANEL_RESERVE = 50

// Until the user first opens/closes the drawer, it auto-opens when the main
// component is at least this wide (px) and collapses below it.
const DRAWER_AUTO_OPEN_WIDTH = 1200

// Degrees the field camera orbits per arrow-key press (Shift pans instead).
const CAM_ROTATE_STEP = 3
// Distance factor the field camera dollies per +/- press (< 1 = zoom in).
const CAM_ZOOM_STEP = 1.15

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
  // The drawer is auto-managed by width until the user opens/closes it; then
  // `drawerTouched` pins their explicit `drawerUserOpen` choice. The effective
  // open state is derived below (and forced open during background-edit).
  const [drawerUserOpen, setDrawerUserOpen] = useState(false)
  const [drawerTouched, setDrawerTouched] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  // Presentation mode: the board fills the whole page (full height, centred), all
  // editing chrome hidden; Esc exits. Enter from the main menu.
  const [presenting, setPresenting] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const [formation, setFormation] = useState<string | null>(null)

  // The library's selected category lives here (not in the drawer) so the
  // toolbar's More-tools menu can jump to a category and open the drawer.
  const { catalog } = useAssets()
  const [libraryCatId, setLibraryCatId] = useState<string | null>(null)
  // Default to the first NON-field category (Players (Men)); the legacy 'fields'
  // categories are hidden from the palette and kept only for loading old drawings.
  if (catalog && libraryCatId === null) {
    const firstCat = catalog.groups.flatMap((g) => g.categories).find((id) => catalog.categories[id]?.kind !== 'field')
    setLibraryCatId(firstCat ?? catalog.groups[0]?.categories[0] ?? null)
  }
  // Remember the last sub-category chosen per group, so re-opening a group (e.g.
  // Players) returns to the user's last pick (Female, Children, …) not the first.
  const [lastCatByGroup, setLastCatByGroup] = useState<Record<string, string>>({})
  const groupOf = (catId: string | null) => (catId ? (catalog?.groups.find((g) => g.categories.includes(catId))?.id ?? null) : null)
  function openCategory(catId: string) {
    const g = groupOf(catId)
    setLibraryCatId((g && lastCatByGroup[g]) || catId)
    setDrawerTouched(true)
    setDrawerUserOpen(true)
  }
  // Drawer category picks update the current category AND the group's memory.
  function selectCategory(catId: string) {
    setLibraryCatId(catId)
    const g = groupOf(catId)
    if (g) setLastCatByGroup((prev) => (prev[g] === catId ? prev : { ...prev, [g]: catId }))
  }

  // Editor store: subscribe to what the chrome needs; actions via the api handle.
  const store = useEditorStoreApi()

  // Dev-only automation hook (thumbnail rigs / e2e scripts): load a document and
  // read state from the console. Never present in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __ycbE2E?: unknown }
    w.__ycbE2E = {
      loadDoc: (json: unknown) => loadBoard(store, json),
      openText: (text: string) => applyOpenedBoard(store, text),
      getState: () => store.getState(),
      play: () => startPlayback(store),
      stop: () => stopPlayback(store),
    }
    return () => {
      delete w.__ycbE2E
    }
  }, [store])

  // Admin mode (authoring-only field tools) can be pre-enabled via ?admin=1 in the
  // URL; it's also togglable at runtime with ⌥⇧A. Read once on mount.
  useEffect(() => {
    const admin = new URLSearchParams(window.location.search).get('admin')
    if (admin != null && admin !== '0' && admin !== 'false') store.getState().setAdminMode(true)
  }, [store])

  // Background-edit mode: an explicit editor state (not derived from the drawer)
  // that disables element actions, swaps in a background toolbar, restricts the
  // drawer to fields, and is committed by "Finish" or ESC.
  const [bgEditing, setBgEditing] = useState(false)
  const backgroundMode = bgEditing
  // The category the drawer was on before Edit Background pointed it at Fields,
  // restored on Finish (matching the old dedicated fields view's behavior).
  const preBgCatRef = useRef<string | null>(null)
  function editBackground() {
    setBgEditing(true)
    const s = store.getState()
    s.setSelection([])
    s.setActiveTool('select')
    // Point the (forced-open) drawer at the regular Fields category matching the
    // current background — the user picks Soccer 11 / Training / Futsal / Legacy
    // Backgrounds from the normal category list.
    const bg = s.doc.background
    preBgCatRef.current = libraryCatId
    setLibraryCatId(fieldsCategoryIdFor(bg.fieldType, isLegacyBackground(bg)))
  }
  function finishBackground() {
    setBgEditing(false)
    if (preBgCatRef.current) setLibraryCatId(preBgCatRef.current)
  }

  // Field-homography calibration mode: a dedicated overlay (bespoke handles) that
  // computes the per-field perspective matrix. Like bg-edit, it disables element
  // actions; exited with "Finish".
  const [homographyEditing, setHomographyEditing] = useState(false)
  function fieldHomography() {
    const s = store.getState()
    s.setSelection([])
    s.setActiveTool('select')
    setHomographyEditing(true)
  }
  function finishHomography() {
    setHomographyEditing(false)
  }

  // Field-camera calibration mode: pose a real perspective camera onto the drawn
  // field (the preferred calibration path). Same dedicated-mode shape as above.
  const [cameraEditing, setCameraEditing] = useState(false)
  function startFieldCamera() {
    const s = store.getState()
    s.setSelection([])
    s.setActiveTool('select')
    setCameraEditing(true)
  }
  function finishFieldCamera() {
    setCameraEditing(false)
  }

  // Field-zones authoring mode: build the notable-spot markers + default poses.
  const [zoneEditing, setZoneEditing] = useState(false)
  function startFieldZones() {
    const s = store.getState()
    s.setSelection([])
    s.setActiveTool('select')
    setZoneEditing(true)
  }
  function finishFieldZones() {
    setZoneEditing(false)
  }

  // Animation mode: shows the frames strip (AnimationBar). Toggled from the main
  // toolbar; activation switches to frame 1 (per spec). The authored frames stay
  // in the document either way — hiding the bar only hides the UI.
  const [animEditing, setAnimEditing] = useState(false)
  const playing = useEditorStore((s) => s.playing)
  // Resetting the canvas (or loading a frameless doc) wipes the frames: close
  // the animation bar with them, so it doesn't linger over an empty strip.
  // Render-phase adjustment (same pattern as navBgSeen below), not an effect.
  const frameCount = useEditorStore((s) => s.doc.animation.frames.length)
  if (animEditing && frameCount === 0) setAnimEditing(false)
  function toggleAnimation() {
    if (animEditing) {
      stopPlayback(store)
      setAnimEditing(false)
      return
    }
    store.getState().enterAnimation()
    // Activation switches to frame 1 — including its stored camera pose (when
    // it has one): fly there with the shared field tween (frame-tile clicks in
    // the AnimationBar do the same for their frame).
    const s = store.getState()
    const cam = s.doc.animation.frames[0]?.camera
    if (cam && s.doc.background.field3d) tweenFieldTo(store, cam)
    setAnimEditing(true)
  }
  const activeTool = useEditorStore((s) => s.activeTool)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)
  const keepToolActive = useEditorStore((s) => s.keepToolActive)
  const toggleKeepTool = useEditorStore((s) => s.toggleKeepTool)

  // Remember, from the (single) selected figure: its material color (per its
  // action/category) and its size (as a scale multiplier, per figureId), so newly
  // added figures inherit them. Resizing keeps the figure selected, so its new
  // size flows through here too.
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const elements = useEditorStore((s) => s.doc.elements)
  const figureScale = useEditorStore((s) => s.doc.background.figureScale)
  // The field's catalog `scale` is the source of truth for figureScale: sync it
  // whenever the field is a catalog field (covers the default field set on load,
  // which otherwise kept a hard-coded default and ignored the catalog value).
  const fieldSvg = useEditorStore((s) => s.doc.background.fieldSvg)
  const setBackground = useEditorStore((s) => s.setBackground)

  // Navigation mode: a free-orbit of the 3D scene that edits the drawing's pose
  // (background.field3d) DIRECTLY — the field pose IS the stored pose, so there's
  // no temporary/final distinction (no Save/Reset). The orbit is coalesced into one
  // undo step by InteractiveBoard's nav transaction. Only when a 3D field exists.
  const savedField3d = useEditorStore((s) => s.doc.background.field3d)
  const navFieldType = useEditorStore((s) => s.doc.background.fieldType)
  const [navigating, setNavigating] = useState(false)
  const [navMarkers, setNavMarkers] = useState(false) // numbered position markers, off by default
  const [navBounce, setNavBounce] = useState(0) // bumps to replay the "Exit" bounce on a bare click
  const navAvailable = !!savedField3d && !bgEditing && !homographyEditing && !cameraEditing && !zoneEditing
  function toggleNav() {
    if (navigating) {
      setNavigating(false)
      return
    }
    if (!navAvailable) return
    setNavBounce(0)
    setNavigating(true)
  }
  // Rotate the field to a straight-down top view (horizontal / vertical), storing it
  // as the drawing's pose. Available even outside navigation as a quick shortcut.
  function topViewNav(orientation: 'landscape' | 'portrait') {
    const ref = savedField3d?.ref ?? 'soccer11'
    setBackground({ field3d: topViewForField(navFieldType, ref, orientation) })
  }
  // A bare click (no drag) while navigating nudges the Exit button, since editing
  // works differently here and users may expect to click the scene to select/move.
  function navTap() {
    setNavBounce((n) => n + 1)
  }
  // A camera-authoring overlay drives field3d from its OWN controls every frame:
  // FieldEditOverlay (navigation / edit-background) and the admin field-zone /
  // field-camera / homography tools. The keyboard nudge below animates field3d,
  // which those loops overwrite each frame — the two fight and the pose tumbles,
  // never settling. So the nudge is for NORMAL 3D mode only; the overlays navigate
  // via their own controls (mouse orbit; FieldEditOverlay also handles the arrows).
  const cameraOverlayActive = navigating || bgEditing || zoneEditing || cameraEditing || homographyEditing
  // Arrow keys move the 3D field camera when nothing is selected (see hotkeys):
  // 'orbit' rotates like a mouse drag, 'pan' (Shift) slides across the ground.
  function moveCamera(mode: 'orbit' | 'pan', ux: number, uy: number) {
    const cur = store.getState().doc.background.field3d
    if (!cur) {
      // 2D mode: no orbit — ⇧+arrows scroll the flat viewport instead.
      if (mode === 'pan') panViewport(ux, uy)
      return
    }
    if (cameraOverlayActive) return
    const ref = (cur.ref ?? 'soccer11') as PitchType
    animateFieldTo(mode === 'orbit' ? orbitStep(cur, ref, ux * CAM_ROTATE_STEP, -uy * CAM_ROTATE_STEP) : panStep(cur, ref, ux, -uy))
  }
  // +/- dolly the 3D field camera (normal mode; nav + bg-edit zoom via the overlay).
  // Without a 3D field the same keys/buttons zoom the flat 2D viewport instead.
  function zoomCamera(dir: 1 | -1) {
    const cur = store.getState().doc.background.field3d
    if (!cur) {
      zoomViewport(dir)
      return
    }
    if (cameraOverlayActive) return
    const ref = (cur.ref ?? 'soccer11') as PitchType
    animateFieldTo(dollyStep(cur, ref, dir > 0 ? 1 / CAM_ZOOM_STEP : CAM_ZOOM_STEP))
  }

  // ── 2D viewport zoom/pan (no 3D field: no orbit — the flat view scrolls) ────
  // The 2D nav bar (magnifiers + pan hand) and ⇧+arrows drive these; the store
  // clamps zoom to [1, 8] and keeps the view inside the board.
  const flatNav = !savedField3d && !bgEditing && !homographyEditing && !cameraEditing && !zoneEditing
  const viewZoom = useEditorStore((s) => s.viewport.zoom)
  const [panMode, setPanMode] = useState(false)
  // The hand tool only exists in 2D mode — deriving keeps it from lingering
  // (without an effect) if a 3D field lands while it's on.
  const panning = panMode && flatNav
  // 3D pan hand (nav toolbar): while orbiting (navigation / Edit Background) a
  // plain drag pans the field camera instead of rotating it. Derived off when
  // no orbit overlay is up, so it never lingers into normal mode.
  const [fieldPan, setFieldPan] = useState(false)
  const fieldPanning = fieldPan && (navigating || bgEditing || presenting)
  // Leave presentation, dropping any orbit/pan it turned on so it doesn't linger
  // into normal editing.
  const exitPresent = () => {
    setNavigating(false)
    setFieldPan(false)
    setPresenting(false)
  }
  useEffect(() => {
    if (!presenting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        exitPresent()
      }
    }
    // Capture phase so it wins over the other Esc handlers (nav/edit exits).
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [presenting])
  // The nav toolbar's +/− magnifiers. In an orbit session (navigation /
  // Edit Background) dolly DIRECTLY: the session already coalesces into one
  // undo step, and the animated tween would commit that transaction early.
  function zoomFieldButton(dir: 1 | -1) {
    const cur = store.getState().doc.background.field3d
    if (!cur) {
      zoomViewport(dir)
      return
    }
    if (navigating || bgEditing) {
      const ref = (cur.ref ?? 'soccer11') as PitchType
      store.getState().setBackground({ field3d: dollyStep(cur, ref, dir > 0 ? 1 / CAM_ZOOM_STEP : CAM_ZOOM_STEP) })
    } else {
      zoomCamera(dir)
    }
  }
  /** Zoom the 2D view in/out one step about the current view centre. Zooming out
   *  goes to 10% (the board shrinks to a tenth); zooming in to 800%. */
  function zoomViewport(dir: 1 | -1) {
    const { viewport, setViewport } = store.getState()
    const zoom = Math.max(0.1, Math.min(8, viewport.zoom * (dir > 0 ? 1.25 : 1 / 1.25)))
    const cx = viewport.panX + BOARD_WIDTH / viewport.zoom / 2
    const cy = viewport.panY + BOARD_HEIGHT / viewport.zoom / 2
    setViewport({ zoom, panX: cx - BOARD_WIDTH / zoom / 2, panY: cy - BOARD_HEIGHT / zoom / 2 })
  }
  /** Reset the 2D zoom to 100% (whole board, centred). */
  function resetZoom() {
    store.getState().setViewport({ zoom: 1, panX: 0, panY: 0 })
  }
  /** Pan the 2D view one keyboard step (board units shrink as you zoom in). */
  function panViewport(ux: number, uy: number) {
    const { viewport, setViewport } = store.getState()
    const step = 60 / viewport.zoom
    setViewport({ panX: viewport.panX + ux * step, panY: viewport.panY + uy * step })
  }
  /** Hand-tool drag: pan the 2D view following the pointer (screen px → board units). */
  function startPanDrag(e: React.PointerEvent<HTMLDivElement>) {
    const surface = rootEl?.querySelector('[data-board-surface]') as HTMLElement | null
    const rect = surface?.getBoundingClientRect()
    if (!rect || e.button !== 0) return
    e.preventDefault()
    let last = { x: e.clientX, y: e.clientY }
    const move = (ev: PointerEvent) => {
      const { viewport, setViewport } = store.getState()
      const k = BOARD_WIDTH / viewport.zoom / rect.width // board units per screen px
      setViewport({ panX: viewport.panX - (ev.clientX - last.x) * k, panY: viewport.panY - (ev.clientY - last.y) * k })
      last = { x: ev.clientX, y: ev.clientY }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  // Smoothly tween the saved field pose (shared animator — the drawer's zone /
  // legacy-field transitions retarget the same tween, so motions chain).
  function animateFieldTo(to: FieldView) {
    tweenFieldTo(store, to)
  }
  // Cancel + commit any in-flight camera tween (and stop playback) on unmount.
  useEffect(() => {
    return () => {
      stopPlayback(store)
      cancelFieldAnimation(store)
    }
  }, [store])
  // Entering any camera-authoring/special mode stops animation playback — those
  // modes own the pose and the toolbar, and playback would fight them.
  useEffect(() => {
    if (cameraOverlayActive) stopPlayback(store)
  }, [cameraOverlayActive, store])
  // Editing the background owns the pose directly — leave navigation and drop the
  // session view (render-phase sync) so finishing shows the freshly-edited saved pose.
  const [navBgSeen, setNavBgSeen] = useState(bgEditing)
  if (bgEditing !== navBgSeen) {
    setNavBgSeen(bgEditing)
    if (bgEditing) setNavigating(false)
  }
  useEffect(() => {
    const s = fieldFigureScale(catalog, fieldSvg)
    if (s !== undefined && s !== figureScale) setBackground({ figureScale: s })
  }, [catalog, fieldSvg, figureScale, setBackground])
  const rememberMaterialColor = useEditorStore((s) => s.rememberMaterialColor)
  const rememberFigureScale = useEditorStore((s) => s.rememberFigureScale)
  const rememberPlayerColors = useEditorStore((s) => s.rememberPlayerColors)
  useEffect(() => {
    const remember = () => {
      if (selectedIds.length !== 1) return
      const el = elements.find((e) => e.id === selectedIds[0])
      // A selected 3D player's skin/kit slots become the next player's defaults too.
      if (el?.type === 'object3d' && isObject3DPlayer(el.objectId) && el.colors) {
        const kit: Record<string, string> = {}
        for (const slot of PLAYER_SLOTS) if (el.colors[slot]) kit[slot] = el.colors[slot]
        if (Object.keys(kit).length) rememberPlayerColors(kit)
        return
      }
      if (!el || el.type !== 'figure') return
      const info = figureColorInfo(catalog).get(el.figureId)
      if (info?.action && info.slots.length) {
        const color = el.colors?.[info.slots[0]]
        if (color) rememberMaterialColor(info.action, color)
      }
      const meta = figureIndex(catalog).get(el.figureId)
      if (meta) {
        const base = figureBaseSize(meta, figureScale)
        if (base.w) rememberFigureScale(el.figureId, el.width / base.w)
      }
      // A selected player's skin/kit slots become the next player's defaults.
      if (playerSvgs(catalog).has(el.figureId) && el.colors) {
        const kit: Record<string, string> = {}
        for (const slot of PLAYER_SLOTS) if (el.colors[slot]) kit[slot] = el.colors[slot]
        if (Object.keys(kit).length) rememberPlayerColors(kit)
      }
    }
    remember()
  }, [selectedIds, elements, catalog, figureScale, rememberMaterialColor, rememberFigureScale, rememberPlayerColors])
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.pointer >= 0)
  const canRedo = useEditorStore((s) => s.pointer < s.stack.length - 1)

  // The root is also the Radix portal container, so menus/tooltips stay inside
  // our scoped, theme-aware subtree. Tracked in state so context updates on mount.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)
  // Bottom-left chrome (undo/redo + nav bar), measured so the animation bar can
  // size its frame window to the space that's actually free next to it.
  const [bottomLeftEl, setBottomLeftEl] = useState<HTMLDivElement | null>(null)
  const { width: bottomLeftW } = useElementSize(bottomLeftEl)

  // Responsive layout from the component's own size (container-query style).
  const { width, height } = useElementSize(rootEl)
  // Effective drawer state: the user's explicit choice once they've touched it,
  // otherwise auto-open when the component is wide enough (`width` is 0 until
  // measured, reading as collapsed). Background-edit always forces it open.
  const drawerOpen = bgEditing || (drawerTouched ? drawerUserOpen : width >= DRAWER_AUTO_OPEN_WIDTH)
  const innerH = Math.max(0, height - 2 * BOARD_TOP_PAD)
  // Rendered field width: the 4:3 fit is height-driven when there's horizontal
  // room, so derive it from height (minus the board's vertical padding).
  const canvasWidth = Math.min(Math.max(0, width - (BOARD_LEFT_PAD + BOARD_RIGHT_PAD)), innerH * BOARD_ASPECT)
  const mobile = width < 768
  // Full panel only when ~a panel's worth of free width sits beside the field;
  // otherwise the compact toolbar (which overlays minimally).
  const fullPanel = !mobile && width - canvasWidth >= PANEL_RESERVE
  const breakpoint: Breakpoint = mobile ? 'mobile' : fullPanel ? 'full' : 'compact'
  // The full panel is a permanent fixture, so reserve the left space (shifting
  // the field right) whenever in full mode. The compact panel overlays instead.
  const reserveLeft = fullPanel

  // Field's rendered (height-driven) width within the current left reserve.
  const leftPad = reserveLeft ? PANEL_RESERVE : BOARD_LEFT_PAD
  const availWidth = Math.max(0, width - leftPad - BOARD_RIGHT_PAD)
  const fieldW = Math.min(availWidth, innerH * BOARD_ASPECT)

  // When the drawer is OPEN as an overlay, keep the field centered but pull its
  // right edge no further than the drawer's left edge, so the drawer doesn't
  // The library drawer is always a docked sidebar: when open, the board refits
  // into the remaining width (right-64) rather than being overlaid.
  const boardPaddingRight = BOARD_RIGHT_PAD
  const reserveRight = drawerOpen
  // The rendered field's top-right corner (gaps from the board container's top/right
  // edges, accounting for the 4:3 letterbox) — where the nav watermark sits.
  const fieldTopGap = BOARD_TOP_PAD + Math.max(0, (innerH - fieldW / BOARD_ASPECT) / 2)
  const fieldRightGap = boardPaddingRight + Math.max(0, (availWidth - fieldW) / 2)

  // Global keyboard shortcuts (see useDesignerHotkeys for the full map). Drawer
  // opens and ball quick-add are wired to the shell's callbacks; grid/zoom/help
  // are added by later phases.
  // P / M open the field-appropriate palettes: the 3D players/materials on a
  // 3D field, their flat 2D counterparts otherwise. openCategory then lands on
  // the group's LAST-used sub-category (e.g. Players 3D (Women)).
  const playersCat = catalog?.groups.find((g) => g.id === (savedField3d ? 'players3d' : 'players'))?.categories[0] ?? null
  const materialsCat = catalog?.groups.find((g) => g.id === (savedField3d ? 'materials3d' : 'materials'))?.categories[0] ?? null
  useDesignerHotkeys({
    storeApi: store,
    bgEditing,
    finishBackground,
    editBackground,
    openPlayers: () => playersCat && openCategory(playersCat),
    openMaterials: () => materialsCat && openCategory(materialsCat),
    onToggleNav: toggleNav,
    navigating,
    addBall: () => addBall(catalog, store),
    showHelp: () => setShortcutsOpen(true),
    toggleGrid: () => setShowGrid((v) => !v),
    moveCamera,
    zoomCamera,
    playing,
    stopPlayback: () => stopPlayback(store),
    openFile: () => openBoardFromFile(store),
    saveFile: () => saveBoardToFile(store.getState().doc),
  })

  return (
    <div
      ref={setRootEl}
      className={cn(
        'ycb-root relative isolate overflow-hidden bg-background text-foreground',
        // "Fill the viewport" simply pins the whole component over the host —
        // the embed-friendly meaning of fullscreen (no native Fullscreen API).
        // Presentation mode pins the same way (whole page for the board).
        fullscreen || presenting ? 'fixed inset-0 z-[2147483647]' : 'h-full w-full',
        isDark && 'dark',
      )}
      // style={fullscreen ? undefined : { minHeight: 480 }}
    >
      <TooltipPrimitive.Provider delayDuration={300}>
        <BoardRootProvider value={rootEl}>
          {/* Interactive board fills the workspace; the field self-centers in the
              available area. The drawer (when docked) refits it from the right,
              and the full properties panel reserves space on the left. */}
          <div
            className={cn(
              'absolute inset-y-0 left-0 transition-all duration-200',
              !presenting && reserveRight ? 'right-64' : 'right-0',
            )}
            style={{
              // Presentation: no padding — the board fills the full page height and
              // self-centres horizontally (4:3 letterbox against the page bg).
              paddingTop: presenting ? 0 : BOARD_TOP_PAD,
              paddingBottom: presenting ? 0 : BOARD_TOP_PAD,
              paddingLeft: presenting ? 0 : leftPad,
              paddingRight: presenting ? 0 : boardPaddingRight,
            }}
          >
            <InteractiveBoard backgroundMode={backgroundMode} homographyMode={homographyEditing} cameraMode={cameraEditing} zoneMode={zoneEditing} showGrid={showGrid} navigating={navigating} navMarkers={navMarkers} onNavTap={navTap} fieldPanMode={fieldPanning} onExitFieldPan={() => setFieldPan(false)} animMode={animEditing} presenting={presenting} />
            {/* Navigation-active indicator: an orbit watermark in the working-area
                top-right corner (decorative, doesn't block input). Kept mounted so
                it fades in/out with navigation mode. */}
            <Rotate3d aria-hidden className="pointer-events-none absolute z-20 text-foreground transition-opacity duration-300" style={{ top: fieldTopGap + 8, right: fieldRightGap + 8, width: 100, height: 100, opacity: navigating ? 0.25 : 0 }} />
            {/* 2D pan hand: a transparent capture layer over the board — dragging
                scrolls the zoomed flat viewport without touching the elements. */}
            {panning && <div className="absolute inset-0 z-20 cursor-grab active:cursor-grabbing" onPointerDown={startPanDrag} />}
          </div>

          {/* All editing chrome — hidden in presentation mode (Esc to exit). */}
          {!presenting && (
            <>
          {/* Top-left menu (+ the navigation control below it on mobile). */}
          <div className="absolute left-3 top-3 z-30 flex flex-col items-start gap-2">
            <MainMenu theme={theme} onThemeChange={setTheme} showThemeControl={showThemeControl} onShowShortcuts={() => setShortcutsOpen(true)} onFieldHomography={fieldHomography} onFieldCamera={startFieldCamera} onFieldZones={startFieldZones} onPresent={() => { store.getState().setSelection([]); setPresenting(true) }} />
            {mobile && <NavBar vertical available={navAvailable || navigating || (bgEditing && !!savedField3d)} navigating={navigating} onToggle={toggleNav} onTopViewH={() => topViewNav('landscape')} onTopViewV={() => topViewNav('portrait')} markers={navMarkers} onToggleMarkers={() => setNavMarkers((v) => !v)} flat={flatNav} zoom={viewZoom} onZoomIn={() => zoomViewport(1)} onZoomOut={() => zoomViewport(-1)} onResetZoom={resetZoom} panning={panning} onTogglePan={() => setPanMode((v) => !v)} editingBg={bgEditing} onZoom3d={zoomFieldButton} pan3d={fieldPanning} onTogglePan3d={() => setFieldPan((v) => !v)} showPan3d={navigating || bgEditing} />}
          </div>

          {/* Main toolbar — top-center, or bottom-center in mobile mode. In
              background-edit mode it's replaced by a single "Finish" button. */}
          <div className={cn('pointer-events-none absolute left-1/2 z-30 -translate-x-1/2', mobile ? 'bottom-3' : 'top-3')}>
            {playing ? (
              <div className="pointer-events-auto select-none rounded-xl border border-border bg-card py-0.5 px-1 shadow-md">
                <Button size="sm" onClick={() => stopPlayback(store)} className="font-medium">
                  <Square /> Stop animation
                </Button>
              </div>
            ) : bgEditing ? (
              <div className="pointer-events-auto select-none rounded-xl border border-border bg-card py-0.5 px-1 shadow-md">
                <Button size="sm" onClick={finishBackground} className="font-medium">
                  <Check /> Finish editing background
                </Button>
              </div>
            ) : navigating ? (
              <div key={navBounce} className={cn('pointer-events-auto select-none rounded-xl border border-border bg-card py-0.5 px-1 shadow-md', navBounce > 0 && 'ycb-nav-bounce')}>
                <Button size="sm" onClick={toggleNav} className="font-medium">
                  <Rotate3d /> Exit navigation mode
                </Button>
              </div>
            ) : homographyEditing ? (
              <div className="pointer-events-auto select-none rounded-xl border border-border bg-card py-0.5 px-1 shadow-md">
                <Button size="sm" onClick={finishHomography} className="font-medium">
                  <Check /> Finish field homography
                </Button>
              </div>
            ) : cameraEditing ? (
              <div className="pointer-events-auto select-none rounded-xl border border-border bg-card py-0.5 px-1 shadow-md">
                <Button size="sm" onClick={finishFieldCamera} className="font-medium">
                  <Check /> Finish field camera
                </Button>
              </div>
            ) : zoneEditing ? (
              <div className="pointer-events-auto select-none rounded-xl border border-border bg-card py-0.5 px-1 shadow-md">
                <Button size="sm" onClick={finishFieldZones} className="font-medium">
                  <Check /> Finish field zones
                </Button>
              </div>
            ) : (
              <Toolbar
                activeTool={activeTool}
                onToolChange={setActiveTool}
                locked={keepToolActive}
                onToggleLock={toggleKeepTool}
                onOpenCategory={openCategory}
                onEditBackground={editBackground}
                onPickFormation={setFormation}
                animActive={animEditing}
                onToggleAnimation={toggleAnimation}
              />
            )}
          </div>

          {/* Animation toolbar (frames strip) — bottom-center, above the mobile
              main toolbar; hidden while any special camera mode is up. The bar
              is centered on the ROOT, so it must clear the widest bottom
              obstacle on BOTH sides: desktop = undo/redo+nav bar (left) vs the
              open drawer (right); mobile = the MobileBar button clusters. */}
          <AnimatePresence>
            {animEditing && !cameraOverlayActive && (
              <div className={cn('absolute left-1/2 z-30 -translate-x-1/2', mobile ? 'bottom-14' : 'bottom-3')}>
                {/* Slide up from the bottom edge on activation (catches the eye)
                    and back down on exit. The motion transform lives on an inner
                    wrapper so it doesn't fight the centering translate above. */}
                <motion.div
                  initial={{ y: 90, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 90, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                >
                  <AnimationBar maxWidth={Math.max(260, width - 2 * (mobile ? 96 : Math.max(12 + bottomLeftW + 8, drawerOpen ? 256 + 12 : 20)))} />
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Properties panel: always present (both the full and the compact
              form), showing the selection's or the active tool's properties.
              Mobile uses MobileBar below. */}
          {!mobile && <PropertiesPanel mode={breakpoint} backgroundMode={backgroundMode} />}

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
                onToggleDrawer={() => { setDrawerTouched(true); setDrawerUserOpen(!drawerOpen) }}
              />
            </div>
          )}

          {/* Bottom-left undo/redo + nav. Hidden in mobile mode, where the main
              toolbar occupies the bottom and undo/redo live in the property bar. */}
          {!mobile && (
            <div ref={setBottomLeftEl} className="absolute bottom-3 left-3 z-30 flex items-center gap-2">
              <UndoRedoBar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
              <NavBar available={navAvailable || navigating || (bgEditing && !!savedField3d)} navigating={navigating} onToggle={toggleNav} onTopViewH={() => topViewNav('landscape')} onTopViewV={() => topViewNav('portrait')} markers={navMarkers} onToggleMarkers={() => setNavMarkers((v) => !v)} flat={flatNav} zoom={viewZoom} onZoomIn={() => zoomViewport(1)} onZoomOut={() => zoomViewport(-1)} onResetZoom={resetZoom} panning={panning} onTogglePan={() => setPanMode((v) => !v)} editingBg={bgEditing} onZoom3d={zoomFieldButton} pan3d={fieldPanning} onTogglePan3d={() => setFieldPan((v) => !v)} showPan3d={navigating || bgEditing} />
            </div>
          )}

          {/* Navigation controls hint (desktop only — touch gestures come later),
              centered along the bottom edge. Shown while navigating AND while
              editing the background, since both orbit the field with the mouse. */}
          {(navigating || backgroundMode) && !mobile && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
              <NavHints />
            </div>
          )}
          {/* Edit mode (3D field, not navigating/calibrating): the 3D-camera key/
              mouse shortcuts, so they're discoverable without entering navigation. */}
          {navAvailable && !navigating && !mobile && !animEditing && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
              <EditHints />
            </div>
          )}

          {/* Right library drawer — always a docked sidebar; closed only by the user. */}
          <LibraryDrawer
            open={drawerOpen}
            onClose={() => { setDrawerTouched(true); setDrawerUserOpen(false) }}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((v) => !v)}
            categoryId={libraryCatId}
            onCategoryChange={selectCategory}
            orbitActive={navigating || backgroundMode}
          />
            </>
          )}

          {presenting && (
            <PresentationOverlay
              onExit={exitPresent}
              canNavigate={!!savedField3d}
              orbiting={navigating && !fieldPan}
              panning={navigating && fieldPan}
              onOrbit={() => { if (navigating && !fieldPan) { setNavigating(false) } else { setNavigating(true); setFieldPan(false) } }}
              onPan={() => { if (navigating && fieldPan) { setNavigating(false); setFieldPan(false) } else { setNavigating(true); setFieldPan(true) } }}
              onExitNav={() => { setNavigating(false); setFieldPan(false) }}
            />
          )}

          <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
          <GameSystemDialog code={formation} onClose={() => setFormation(null)} />
        </BoardRootProvider>
      </TooltipPrimitive.Provider>
    </div>
  )
}

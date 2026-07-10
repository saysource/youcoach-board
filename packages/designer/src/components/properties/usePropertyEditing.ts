import type { ArrowTip, BoardElement, ElementPatch, StrokeStyle, FillStyle, TokenShape, TokenFill, TextAlign } from '@youcoach-board/core'

/** The line renderings, surfaced as one multi-state in the Settings popover. */
export type LineStyle = 'straight' | 'curved' | 'zigzag' | 'double'

/** A token's visual identity (the "team look") — everything but its text/label.
 *  Used by the copy-style buttons that re-style the selection from a board token. */
export type TokenVisualStyle = { shape: TokenShape; tokenFill: TokenFill; color1: string; color2: string; textColor: string }
import { useEditorStore } from '../../store/context'
import { isCreationTool } from '../../store/editorStore'
import { toolCreatesClosed, nextTokenText, measureTextBox } from '../../lib/draw'
import { makeCalibratedCamera } from '../../lib/field-camera'
import { boardToGround } from '../../lib/arrow3d'
import { useAssets } from '../../lib/assets'
import { playerSvgs, SKIN_SLOT, HAIR_SLOT, JERSEY_SLOT, SHORTS_SLOT, VSTRIPE_SLOT, HSTRIPE_SLOT, SOCKS_SLOT, DEFAULT_SKIN, DEFAULT_HAIR, stripeFills, type KitStyle, type PlayerKit } from '../../lib/player-kit'
import { isObject3DColorable, isObject3DMultiColor, isObject3DPlayer, object3dColorSlots, object3dDefaultColor, object3dSlotDefault, type Object3DColorSlot } from '../../lib/objects3d'

/** Closed shapes can be filled (background color); open ones can't. */
export function isClosed(el: BoardElement): boolean {
  return el.type === 'rect' || el.type === 'ellipse' || (el.type === 'polyline' && el.closed)
}

// The properties panel edits one of two subjects:
//   - the SELECTION (1+ elements) — writes single undoable `update` ops, and
//   - the TOOL DEFAULTS (when nothing is selected) — the "next figure" style, so
//     the user can pre-set stroke/fill/… before drawing. Either way it exposes
//     the same { values, setters, hasClosed } shape, so the controls don't care.
export function usePropertyEditing() {
  const doc = useEditorStore((s) => s.doc)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const activeTool = useEditorStore((s) => s.activeTool)
  const updateElements = useEditorStore((s) => s.updateElements)
  const toolDefaults = useEditorStore((s) => s.toolDefaults)
  const setToolDefaults = useEditorStore((s) => s.setToolDefaults)
  const tokenDefaults = useEditorStore((s) => s.tokenDefaults)
  const setTokenDefaults = useEditorStore((s) => s.setTokenDefaults)
  const textDefaults = useEditorStore((s) => s.textDefaults)
  const setTextDefaults = useEditorStore((s) => s.setTextDefaults)
  // The GLOBAL token size (metric diameter): the live value is any token's shared
  // `sizeM`, else the store default; setting it resizes every token at once.
  const storeTokenSizeM = useEditorStore((s) => s.tokenSizeM)
  const setTokenSizeM = useEditorStore((s) => s.setTokenSizeM)
  const tokenSize = (doc.elements.find((e) => e.type === 'token') as Extract<BoardElement, { type: 'token' }> | undefined)?.sizeM ?? storeTokenSizeM
  // Global token font multipliers (badge number / caption label) — store-level, shared.
  const tokenTextScale = useEditorStore((s) => s.tokenTextScale)
  const tokenLabelScale = useEditorStore((s) => s.tokenLabelScale)
  const setTokenTextScale = useEditorStore((s) => s.setTokenTextScale)
  const setTokenLabelScale = useEditorStore((s) => s.setTokenLabelScale)
  const { catalog } = useAssets()
  const els = doc.elements.filter((e) => selectedIds.includes(e.id))
  // Map a figure's SVG path → the recolor-class slots it exposes (from the catalog).
  // The current UI edits a single custom color (the first slot); the array leaves
  // room for figures with several customizable colors later.
  const figureColorSlots = new Map<string, string[]>()
  for (const cat of Object.values(catalog?.categories ?? {})) for (const f of cat.figures) if (f.svg && f.colors?.length) figureColorSlots.set(f.svg, f.colors)
  // Default fill for a slot when a figure has no override yet (search all palettes).
  const defaultColorFor = (slot: string): string => {
    for (const g of Object.values(catalog?.defaults ?? {})) if (g[slot]) return g[slot]
    return '#e03131'
  }
  const editingSelection = els.length > 0
  // Whether the panel currently has an editable subject: a selection, or any
  // creation tool (incl. the Token stamp, which pre-shows its next-token defaults).
  const editable = editingSelection || isCreationTool(activeTool)
  // The Token stamp shows its token editor (bound to the next-token defaults).
  const tokenTool = activeTool === 'token'
  // The Text tool shows its text editor (bound to the next-text defaults).
  const textTool = activeTool === 'text'
  // In creation mode (incl. a LOCKED tool that auto-selected its last creation) the
  // bar targets the NEXT element's defaults, never the incidental selection — so
  // e.g. picking a token preset re-styles the next token, not the last stamped one.
  const editDefaults = !editingSelection || isCreationTool(activeTool)

  if (editDefaults) {
    // Edit the tool defaults. `hasClosed` follows the future element's shape.
    return {
      editingSelection: false,
      editable,
      count: 0,
      activeTool,
      els,
      hasClosed: toolCreatesClosed(activeTool),
      // Polyline/figure-specific affordances are only meaningful on a selection.
      allPoly: false,
      allOpenPoly: false,
      allClosablePoly: false,
      allFigure: false,
      allRect: false,
      allToken: tokenTool,
      allText: textTool,
      allMaterialColor: false,
      allPlayer: false,
      allArrow3d: false,
      allObject3D: false,
      allObject3DColor: false,
      object3dSlots: [] as Object3DColorSlot[],
      values: {
        stroke: toolDefaults.stroke as string | undefined,
        strokeWidth: toolDefaults.strokeWidth as number | undefined,
        strokeStyle: toolDefaults.strokeStyle as StrokeStyle | undefined,
        fill: toolDefaults.fill as string | undefined,
        fillStyle: toolDefaults.fillStyle as FillStyle | undefined,
        opacity: toolDefaults.opacity as number | undefined,
        curve: undefined as boolean | undefined,
        zigzag: undefined as boolean | undefined,
        lineStyle: undefined as LineStyle | undefined,
        waveLength: undefined as number | undefined,
        waveAmplitude: undefined as number | undefined,
        linesOffset: undefined as number | undefined,
        closed: undefined as boolean | undefined,
        startTip: undefined as ArrowTip | undefined,
        endTip: undefined as ArrowTip | undefined,
        // Token-tool defaults (the next token to be stamped); undefined otherwise.
        tokenShape: tokenTool ? tokenDefaults.shape : undefined,
        tokenFill: tokenTool ? tokenDefaults.tokenFill : undefined,
        color1: tokenTool ? tokenDefaults.color1 : undefined,
        color2: tokenTool ? tokenDefaults.color2 : undefined,
        textColor: tokenTool ? tokenDefaults.textColor : textTool ? textDefaults.textColor : undefined,
        text: tokenTool ? tokenDefaults.text : undefined,
        label: tokenTool ? tokenDefaults.label : undefined,
        showLabel: tokenTool ? tokenDefaults.showLabel : undefined,
        // Global token size (metres) + font multipliers — same whether or not a token is selected.
        tokenSize,
        tokenTextScale,
        tokenLabelScale,
        // Text-tool defaults (the next text to be placed); undefined otherwise.
        bgColor: textTool ? textDefaults.bgColor : undefined,
        fontSize: textTool ? textDefaults.fontSize : undefined,
        align: textTool ? textDefaults.align : undefined,
        bold: textTool ? textDefaults.bold : undefined,
        italic: textTool ? textDefaults.italic : undefined,
        fontFamily: textTool ? textDefaults.fontFamily : undefined,
        text3d: textTool ? textDefaults.text3d : undefined,
        orientation: textTool ? textDefaults.orientation : undefined,
        materialColor: undefined as string | undefined,
        // Player skin/kit (selection-only).
        skin: undefined as string | undefined,
        hair: undefined as string | undefined,
        kit: undefined as PlayerKit | undefined,
        // 3D object (selection-only).
        object3dColor: undefined as string | undefined,
        object3dSize: undefined as number | undefined,
        object3dUseGlobal: undefined as boolean | undefined,
        object3dSlotColors: {} as Record<string, string>,
      },
      setStroke: (stroke: string) => setToolDefaults({ stroke }),
      setStrokeWidth: (strokeWidth: number) => setToolDefaults({ strokeWidth }),
      setStrokeStyle: (strokeStyle: StrokeStyle) => setToolDefaults({ strokeStyle }),
      setFill: (fill: string) => setToolDefaults({ fill }),
      setFillStyle: (fillStyle: FillStyle) => setToolDefaults({ fillStyle }),
      setOpacity: (opacity: number) => setToolDefaults({ opacity }),
      setCurve: () => {},
      setLineStyle: () => {},
      setWaveLength: () => {},
      setWaveAmplitude: () => {},
      setLinesOffset: () => {},
      setClosed: () => {},
      setStartTip: () => {},
      setEndTip: () => {},
      flip: () => {},
      // No selection: applying a preset updates the next-token defaults. Switching
      // team also re-sequences the next number for that team (so the panel and the
      // next stamp show the right value straight away, not the old team's).
      applyTokenStyle: (style: TokenVisualStyle) => setTokenDefaults({ ...style, text: nextTokenText(doc.elements, style, tokenDefaults.text) }),
      // Token tool: edit the next-token defaults directly.
      setTokenShape: (shape: TokenShape) => setTokenDefaults({ shape }),
      setTokenFill: (tokenFill: TokenFill) => setTokenDefaults({ tokenFill }),
      setColor1: (color1: string) => setTokenDefaults({ color1 }),
      setColor2: (color2: string) => setTokenDefaults({ color2 }),
      // Text color: routed to whichever tool is active (token badge vs text).
      setTextColor: (textColor: string) => (textTool ? setTextDefaults({ textColor }) : setTokenDefaults({ textColor })),
      setText: (text: string) => setTokenDefaults({ text }),
      setLabel: (label: string) => setTokenDefaults({ label }),
      setShowLabel: (showLabel: boolean) => setTokenDefaults({ showLabel }),
      setTokenSize: (m: number) => setTokenSizeM(m),
      setTokenTextScale: (n: number) => setTokenTextScale(n),
      setTokenLabelScale: (n: number) => setTokenLabelScale(n),
      // Text-tool defaults.
      setBgColor: (bgColor: string) => setTextDefaults({ bgColor }),
      setFontSize: (fontSize: number) => setTextDefaults({ fontSize }),
      setAlign: (align: TextAlign) => setTextDefaults({ align }),
      setBold: (bold: boolean) => setTextDefaults({ bold }),
      setItalic: (italic: boolean) => setTextDefaults({ italic }),
      setFontFamily: (fontFamily?: string) => setTextDefaults({ fontFamily }),
      setText3d: (text3d: boolean) => setTextDefaults({ text3d }),
      setOrientation: (orientation: number) => setTextDefaults({ orientation }),
      setMaterialColor: () => {},
      setObject3DColor: () => {},
      setObject3DUseGlobal: () => {},
      setObject3DSize: () => {},
      setObject3DSlotColor: () => {},
      setSkin: () => {},
      setHair: () => {},
      setSkinHair: () => {},
      setKit: () => {},
    }
  }

  const closedEls = els.filter(isClosed)
  const polys = els.filter((e): e is Extract<BoardElement, { type: 'polyline' }> => e.type === 'polyline')
  const openPolys = polys.filter((p) => !p.closed)
  const figures = els.filter((e) => e.type === 'figure')
  // "Shared" = a property is shown only when it applies to EVERY selected element.
  const allClosed = els.every(isClosed)
  const allPoly = polys.length === els.length
  const allOpenPoly = allPoly && polys.every((p) => !p.closed)
  const allClosablePoly = allPoly && polys.every((p) => p.points.length >= 3)
  const allFigure = figures.length === els.length
  const allRect = els.every((e) => e.type === 'rect')
  const tokens = els.filter((e): e is Extract<BoardElement, { type: 'token' }> => e.type === 'token')
  const allToken = tokens.length === els.length
  const texts = els.filter((e): e is Extract<BoardElement, { type: 'text' }> => e.type === 'text')
  const allText = texts.length === els.length
  const allArrow3d = els.length > 0 && els.every((e) => e.type === 'arrow3d')
  const object3ds = els.filter((e): e is Extract<BoardElement, { type: 'object3d' }> => e.type === 'object3d')
  const allObject3D = object3ds.length === els.length && els.length > 0
  // Colorable = every selected object3d is a tintable material (cones, hurdles…).
  const allObject3DColor = allObject3D && object3ds.every((e) => isObject3DColorable(e.objectId))
  const firstObject3D = object3ds[0]
  // Per-part recolor slots (e.g. flag pole: pole + flag), when the whole selection
  // is the SAME multi-material object. Each slot's shown value is the element's
  // override or the slot default.
  const multiObjectId = firstObject3D && isObject3DMultiColor(firstObject3D.objectId) && object3ds.every((e) => e.objectId === firstObject3D.objectId) ? firstObject3D.objectId : null
  const object3dSlots = multiObjectId ? object3dColorSlots(multiObjectId) : []
  const object3dSlotColors: Record<string, string> = {}
  if (multiObjectId && firstObject3D) for (const s of object3dSlots) object3dSlotColors[s.id] = firstObject3D.colors?.[s.id] ?? object3dSlotDefault(multiObjectId, s.id)
  // Each displayed value is the FIRST selected element's (not blanked when mixed).
  const first = els[0]
  const firstPoly = first.type === 'polyline' ? first : undefined
  const firstToken = first.type === 'token' ? first : undefined
  const firstText = first.type === 'text' ? first : undefined
  const firstFigure = first.type === 'figure' ? first : undefined
  // Every selected element is a figure that exposes at least one custom color.
  const allMaterialColor = els.length > 0 && els.every((e) => e.type === 'figure' && !!figureColorSlots.get(e.figureId)?.length)
  // The slot the single color selector edits (the first custom color of the first figure).
  const materialSlot = firstFigure ? figureColorSlots.get(firstFigure.figureId)?.[0] : undefined

  // Players (2D players category + 3D player characters) get the skin/kit editors.
  const playerSet = playerSvgs(catalog)
  const player3ds = object3ds.filter((e) => isObject3DPlayer(e.objectId))
  const isPlayerEl = (e: BoardElement) => (e.type === 'figure' && playerSet.has(e.figureId)) || (e.type === 'object3d' && isObject3DPlayer(e.objectId))
  const allPlayer = els.length > 0 && els.every(isPlayerEl)
  const playerEls = [...figures, ...player3ds]
  const pc = (firstFigure ?? (firstObject3D && isObject3DPlayer(firstObject3D.objectId) ? firstObject3D : undefined))?.colors ?? {}
  const kitJersey = pc[JERSEY_SLOT] ?? '#ff0000'
  // A stripe slot is "active" only when it carries a real color — inactive stripes
  // are transparent (older docs used the jersey color, so exclude that too).
  const stripeOf = (c?: string) => (c && c !== 'transparent' && c !== 'none' && c !== kitJersey ? c : undefined)
  const kitV = stripeOf(pc[VSTRIPE_SLOT])
  const kitH = stripeOf(pc[HSTRIPE_SLOT])
  const kitStyle: KitStyle = kitV && kitH ? 'checker' : kitV ? 'vstripes' : kitH ? 'hstripes' : 'solid'
  const playerKit: PlayerKit = {
    jersey: kitJersey,
    shorts: pc[SHORTS_SLOT] ?? '#1e1e1e',
    socks: pc[SOCKS_SLOT] ?? '#ff0000',
    stripe: kitV ?? kitH ?? '#1e1e1e',
    style: kitStyle,
  }

  // Recolor slots of a player element (figures and 3D players both carry them).
  const colorsOf = (e: BoardElement) => (e as { colors?: Record<string, string> }).colors

  function patch(targets: BoardElement[], make: (el: BoardElement) => { before: ElementPatch; after: ElementPatch }) {
    if (targets.length === 0) return
    updateElements(targets.map((el) => ({ id: el.id, ...make(el) })))
  }
  // Editing the selection also refreshes the next-figure default (last-used).
  const remember = (patch: Partial<typeof toolDefaults>) => setToolDefaults(patch)

  return {
    editingSelection,
    editable,
    count: els.length,
    activeTool,
    els,
    hasClosed: allClosed,
    allPoly,
    allOpenPoly,
    allClosablePoly,
    allFigure,
    allRect,
    allToken,
    allText,
    allMaterialColor,
    allPlayer,
    allArrow3d,
    allObject3D,
    allObject3DColor,
    object3dSlots,
    values: {
      stroke: first.stroke,
      strokeWidth: first.strokeWidth,
      strokeStyle: first.strokeStyle,
      fill: first.fill,
      fillStyle: first.fillStyle,
      opacity: first.transform.opacity,
      curve: firstPoly?.curve,
      zigzag: firstPoly?.zigzag,
      lineStyle: (firstPoly ? (firstPoly.double ? 'double' : firstPoly.zigzag ? 'zigzag' : firstPoly.curve ? 'curved' : 'straight') : undefined) as LineStyle | undefined,
      waveLength: firstPoly?.waveLength,
      waveAmplitude: firstPoly?.waveAmplitude,
      linesOffset: firstPoly?.linesOffset,
      closed: firstPoly?.closed,
      startTip: firstPoly?.startTip,
      endTip: firstPoly?.endTip,
      tokenShape: firstToken?.shape,
      tokenFill: firstToken?.tokenFill,
      color1: firstToken?.color1,
      color2: firstToken?.color2,
      // Text color is shared by tokens (badge) and text elements.
      textColor: firstToken?.textColor ?? firstText?.textColor,
      text: firstToken?.text,
      label: firstToken?.label,
      showLabel: firstToken?.showLabel,
      tokenSize,
      tokenTextScale,
      tokenLabelScale,
      bgColor: firstText?.bgColor,
      fontSize: firstText?.fontSize,
      align: firstText?.align,
      bold: firstText?.bold,
      italic: firstText?.italic,
      fontFamily: firstText?.fontFamily,
      text3d: firstText?.text3d,
      orientation: firstText?.orientation ?? 0,
      // A material's current custom color (its first slot; falls back to the default).
      materialColor: materialSlot ? (firstFigure!.colors?.[materialSlot] ?? defaultColorFor(materialSlot)) : undefined,
      // Player skin/hair + kit (from the first selected player).
      skin: allPlayer ? (pc[SKIN_SLOT] ?? DEFAULT_SKIN) : undefined,
      hair: allPlayer ? (pc[HAIR_SLOT] ?? DEFAULT_HAIR) : undefined,
      kit: allPlayer ? playerKit : undefined,
      // 3D object: body color (falls back to the authored default), custom size and
      // whether it follows the global object scale.
      object3dColor: firstObject3D ? (firstObject3D.fill && firstObject3D.fill !== 'transparent' ? firstObject3D.fill : object3dDefaultColor(firstObject3D.objectId)) : undefined,
      object3dSize: firstObject3D?.size,
      object3dUseGlobal: firstObject3D?.useGlobalSize,
      object3dSlotColors,
    },
    setStroke: (stroke: string) => {
      patch(els, (e) => ({ before: { stroke: e.stroke }, after: { stroke } }))
      remember({ stroke })
    },
    setStrokeWidth: (strokeWidth: number) => {
      patch(els, (e) => ({ before: { strokeWidth: e.strokeWidth }, after: { strokeWidth } }))
      remember({ strokeWidth })
    },
    setStrokeStyle: (strokeStyle: StrokeStyle) => {
      patch(els, (e) => ({ before: { strokeStyle: e.strokeStyle }, after: { strokeStyle } }))
      remember({ strokeStyle })
    },
    setFill: (fill: string) => {
      patch(closedEls, (e) => ({ before: { fill: e.fill }, after: { fill } }))
      remember({ fill })
    },
    setFillStyle: (fillStyle: FillStyle) => {
      patch(closedEls, (e) => ({ before: { fillStyle: e.fillStyle }, after: { fillStyle } }))
      remember({ fillStyle })
    },
    setOpacity: (opacity: number) => {
      patch(els, (e) => ({ before: { transform: e.transform }, after: { transform: { ...e.transform, opacity } } }))
      remember({ opacity })
    },
    setCurve: (curve: boolean) => patch(polys, (e) => ({ before: { curve: (e as Extract<BoardElement, { type: 'polyline' }>).curve }, after: { curve } })),
    // One tri-state sets both flags: zigzag rides the same smooth path as curved.
    setLineStyle: (style: LineStyle) =>
      patch(polys, (e) => {
        const p = e as Extract<BoardElement, { type: 'polyline' }>
        return {
          before: { curve: p.curve, zigzag: p.zigzag, double: p.double },
          after: { curve: style !== 'straight', zigzag: style === 'zigzag', double: style === 'double' },
        }
      }),
    setWaveLength: (waveLength: number) =>
      patch(polys, (e) => ({ before: { waveLength: (e as Extract<BoardElement, { type: 'polyline' }>).waveLength }, after: { waveLength } })),
    setWaveAmplitude: (waveAmplitude: number) =>
      patch(polys, (e) => ({ before: { waveAmplitude: (e as Extract<BoardElement, { type: 'polyline' }>).waveAmplitude }, after: { waveAmplitude } })),
    setLinesOffset: (linesOffset: number) =>
      patch(polys, (e) => ({ before: { linesOffset: (e as Extract<BoardElement, { type: 'polyline' }>).linesOffset }, after: { linesOffset } })),
    setClosed: (closed: boolean) => patch(polys, (e) => ({ before: { closed: (e as Extract<BoardElement, { type: 'polyline' }>).closed }, after: { closed } })),
    setStartTip: (startTip: ArrowTip) => patch(openPolys, (e) => ({ before: { startTip: (e as Extract<BoardElement, { type: 'polyline' }>).startTip }, after: { startTip } })),
    setEndTip: (endTip: ArrowTip) => patch(openPolys, (e) => ({ before: { endTip: (e as Extract<BoardElement, { type: 'polyline' }>).endTip }, after: { endTip } })),
    flip: () => patch(figures, (e) => ({ before: { mirror: (e as Extract<BoardElement, { type: 'figure' }>).mirror }, after: { mirror: !(e as Extract<BoardElement, { type: 'figure' }>).mirror } })),
    // Material custom color: set each figure's first custom-color slot.
    setMaterialColor: (color: string) =>
      patch(figures, (e) => {
        const f = e as Extract<BoardElement, { type: 'figure' }>
        const slot = figureColorSlots.get(f.figureId)?.[0]
        if (!slot) return { before: {}, after: {} }
        return { before: { colors: f.colors }, after: { colors: { ...f.colors, [slot]: color } } }
      }),
    // 3D object body color (stored as `fill`); no opacity, like the stroke widget.
    setObject3DColor: (color: string) => patch(object3ds, (e) => ({ before: { fill: e.fill }, after: { fill: color } })),
    // Follow the global object scale, or use a custom relative size.
    setObject3DUseGlobal: (useGlobalSize: boolean) => patch(object3ds, (e) => ({ before: { useGlobalSize: (e as Extract<BoardElement, { type: 'object3d' }>).useGlobalSize }, after: { useGlobalSize } })),
    setObject3DSize: (size: number) => patch(object3ds, (e) => ({ before: { size: (e as Extract<BoardElement, { type: 'object3d' }>).size }, after: { size } })),
    setObject3DSlotColor: (slot: string, color: string) => patch(object3ds, (e) => ({ before: { colors: colorsOf(e) }, after: { colors: { ...colorsOf(e), [slot]: color } } })),
    // Player skin/kit: patch the relevant color slots on the selected player(s) —
    // 2D figures and 3D player characters alike (both carry `colors` slots).
    // (The remember-effect re-captures them, so new players inherit the change.)
    setSkin: (skin: string) => patch(playerEls, (e) => ({ before: { colors: colorsOf(e) }, after: { colors: { ...colorsOf(e), [SKIN_SLOT]: skin } } })),
    setHair: (hair: string) => patch(playerEls, (e) => ({ before: { colors: colorsOf(e) }, after: { colors: { ...colorsOf(e), [HAIR_SLOT]: hair } } })),
    setSkinHair: (skin: string, hair: string) =>
      patch(playerEls, (e) => ({ before: { colors: colorsOf(e) }, after: { colors: { ...colorsOf(e), [SKIN_SLOT]: skin, [HAIR_SLOT]: hair } } })),
    setKit: (kit: PlayerKit) =>
      patch(playerEls, (e) => {
        const { v, h } = stripeFills(kit.style, kit.stripe)
        return {
          before: { colors: colorsOf(e) },
          after: { colors: { ...colorsOf(e), [JERSEY_SLOT]: kit.jersey, [SHORTS_SLOT]: kit.shorts, [SOCKS_SLOT]: kit.socks, [VSTRIPE_SLOT]: v, [HSTRIPE_SLOT]: h } },
        }
      }),
    // Editing a selected token also updates the next-token defaults (so the next
    // stamp inherits the change) — except the label, which stays per-token.
    setTokenShape: (shape: TokenShape) => {
      patch(tokens, (e) => ({ before: { shape: (e as Extract<BoardElement, { type: 'token' }>).shape }, after: { shape } }))
      setTokenDefaults({ shape })
    },
    setTokenFill: (tokenFill: TokenFill) => {
      patch(tokens, (e) => ({ before: { tokenFill: (e as Extract<BoardElement, { type: 'token' }>).tokenFill }, after: { tokenFill } }))
      setTokenDefaults({ tokenFill })
    },
    setColor1: (color1: string) => {
      patch(tokens, (e) => ({ before: { color1: (e as Extract<BoardElement, { type: 'token' }>).color1 }, after: { color1 } }))
      setTokenDefaults({ color1 })
    },
    setColor2: (color2: string) => {
      patch(tokens, (e) => ({ before: { color2: (e as Extract<BoardElement, { type: 'token' }>).color2 }, after: { color2 } }))
      setTokenDefaults({ color2 })
    },
    // Text color: applies to tokens (badge) and/or text elements in the selection.
    setTextColor: (textColor: string) => {
      patch(tokens, (e) => ({ before: { textColor: (e as Extract<BoardElement, { type: 'token' }>).textColor }, after: { textColor } }))
      patch(texts, (e) => ({ before: { textColor: (e as Extract<BoardElement, { type: 'text' }>).textColor }, after: { textColor } }))
      if (tokens.length) setTokenDefaults({ textColor })
      if (texts.length) setTextDefaults({ textColor })
    },
    // Text element: background color / font size / alignment. Font size re-measures
    // the box (keeping the center fixed) so it stays fitted to the text.
    setBgColor: (bgColor: string) => {
      patch(texts, (e) => ({ before: { bgColor: (e as Extract<BoardElement, { type: 'text' }>).bgColor }, after: { bgColor } }))
      setTextDefaults({ bgColor })
    },
    setFontSize: (fontSize: number) => {
      patch(texts, (e) => {
        const t = e as Extract<BoardElement, { type: 'text' }>
        const { width, height } = measureTextBox(t.text, fontSize, t.bold, t.fontFamily, t.italic)
        return {
          before: { fontSize: t.fontSize, x: t.x, y: t.y, width: t.width, height: t.height },
          after: { fontSize, x: t.x + (t.width - width) / 2, y: t.y + (t.height - height) / 2, width, height },
        }
      })
      setTextDefaults({ fontSize })
    },
    setAlign: (align: TextAlign) => {
      patch(texts, (e) => ({ before: { align: (e as Extract<BoardElement, { type: 'text' }>).align }, after: { align } }))
      setTextDefaults({ align })
    },
    // Toggle "on the field" (3D). Enabling pins the text's box centre to the pitch
    // (so it appears on the surface immediately); disabling clears the anchor.
    setText3d: (text3d: boolean) => {
      const cfg = doc.background.field3d
      const cam = text3d && cfg ? makeCalibratedCamera(cfg) : null
      patch(texts, (e) => {
        const t = e as Extract<BoardElement, { type: 'text' }>
        if (!text3d) return { before: { text3d: t.text3d, ground: t.ground }, after: { text3d: false, ground: undefined } }
        let ground = t.ground
        if (cam && !ground) {
          const g = boardToGround(t.x + t.width / 2 + t.transform.x, t.y + t.height / 2 + t.transform.y, cam)
          if (g) ground = [g.x, g.z]
        }
        return { before: { text3d: t.text3d, orientation: t.orientation, ground: t.ground }, after: { text3d: true, orientation: t.orientation ?? 0, ground } }
      })
      setTextDefaults({ text3d })
    },
    setOrientation: (orientation: number) => {
      patch(texts, (e) => ({ before: { orientation: (e as Extract<BoardElement, { type: 'text' }>).orientation ?? 0 }, after: { orientation } }))
      setTextDefaults({ orientation })
    },
    // Switching fonts changes the metrics — re-measure the box about its centre.
    setFontFamily: (fontFamily?: string) => {
      patch(texts, (e) => {
        const t = e as Extract<BoardElement, { type: 'text' }>
        const { width, height } = measureTextBox(t.text, t.fontSize, t.bold, fontFamily, t.italic)
        return {
          before: { fontFamily: t.fontFamily, x: t.x, y: t.y, width: t.width, height: t.height },
          after: { fontFamily, x: t.x + (t.width - width) / 2, y: t.y + (t.height - height) / 2, width, height },
        }
      })
      setTextDefaults({ fontFamily })
    },
    // Italic changes the metrics slightly — re-measure the box about its centre.
    setItalic: (italic: boolean) => {
      patch(texts, (e) => {
        const t = e as Extract<BoardElement, { type: 'text' }>
        const { width, height } = measureTextBox(t.text, t.fontSize, t.bold, t.fontFamily, italic)
        return {
          before: { italic: t.italic, x: t.x, y: t.y, width: t.width, height: t.height },
          after: { italic, x: t.x + (t.width - width) / 2, y: t.y + (t.height - height) / 2, width, height },
        }
      })
      setTextDefaults({ italic })
    },
    // Bold toggles weight 800; the box is re-measured (bold is wider) about its center.
    setBold: (bold: boolean) => {
      patch(texts, (e) => {
        const t = e as Extract<BoardElement, { type: 'text' }>
        const { width, height } = measureTextBox(t.text, t.fontSize, bold, t.fontFamily, t.italic)
        return {
          before: { bold: t.bold, x: t.x, y: t.y, width: t.width, height: t.height },
          after: { bold, x: t.x + (t.width - width) / 2, y: t.y + (t.height - height) / 2, width, height },
        }
      })
      setTextDefaults({ bold })
    },
    setText: (text: string) => {
      patch(tokens, (e) => ({ before: { text: (e as Extract<BoardElement, { type: 'token' }>).text }, after: { text } }))
      setTokenDefaults({ text })
    },
    // Copy/paste style: re-style the selected token(s) from a board token in ONE
    // undoable op (text/label untouched); also remembered as the next-token default.
    applyTokenStyle: (style: TokenVisualStyle) => {
      patch(tokens, (e) => {
        const t = e as Extract<BoardElement, { type: 'token' }>
        return {
          before: { shape: t.shape, tokenFill: t.tokenFill, color1: t.color1, color2: t.color2, textColor: t.textColor },
          after: { ...style },
        }
      })
      setTokenDefaults({ ...style })
    },
    setLabel: (label: string) => patch(tokens, (e) => ({ before: { label: (e as Extract<BoardElement, { type: 'token' }>).label }, after: { label } })),
    setShowLabel: (showLabel: boolean) => {
      patch(tokens, (e) => ({ before: { showLabel: (e as Extract<BoardElement, { type: 'token' }>).showLabel }, after: { showLabel } }))
      setTokenDefaults({ showLabel })
    },
    setTokenSize: (m: number) => setTokenSizeM(m),
    setTokenTextScale: (n: number) => setTokenTextScale(n),
    setTokenLabelScale: (n: number) => setTokenLabelScale(n),
  }
}

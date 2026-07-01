import type { ArrowTip, BoardElement, ElementPatch, StrokeStyle, FillStyle, TokenShape, TokenFill, TextAlign } from '@youcoach-board/core'

/** The line renderings, surfaced as one multi-state in the Settings popover. */
export type LineStyle = 'straight' | 'curved' | 'zigzag' | 'double'

/** A token's visual identity (the "team look") — everything but its text/label.
 *  Used by the copy-style buttons that re-style the selection from a board token. */
export type TokenVisualStyle = { shape: TokenShape; tokenFill: TokenFill; color1: string; color2: string; textColor: string }
import { useEditorStore } from '../../store/context'
import { isCreationTool } from '../../store/editorStore'
import { toolCreatesClosed, nextTokenText, measureTextBox } from '../../lib/draw'
import { useAssets } from '../../lib/assets'
import { playerSvgs, SKIN_SLOT, HAIR_SLOT, JERSEY_SLOT, SHORTS_SLOT, VSTRIPE_SLOT, HSTRIPE_SLOT, SOCKS_SLOT, DEFAULT_SKIN, DEFAULT_HAIR, stripeFills, type KitStyle } from '../../lib/player-kit'

/** A player's kit: jersey/shorts/socks/stripe colors + the stripe style. */
export type PlayerKit = { jersey: string; shorts: string; socks: string; stripe: string; style: KitStyle }

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
        // Text-tool defaults (the next text to be placed); undefined otherwise.
        bgColor: textTool ? textDefaults.bgColor : undefined,
        fontSize: textTool ? textDefaults.fontSize : undefined,
        align: textTool ? textDefaults.align : undefined,
        bold: textTool ? textDefaults.bold : undefined,
        materialColor: undefined as string | undefined,
        // Player skin/kit (selection-only).
        skin: undefined as string | undefined,
        hair: undefined as string | undefined,
        kit: undefined as PlayerKit | undefined,
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
      // Text-tool defaults.
      setBgColor: (bgColor: string) => setTextDefaults({ bgColor }),
      setFontSize: (fontSize: number) => setTextDefaults({ fontSize }),
      setAlign: (align: TextAlign) => setTextDefaults({ align }),
      setBold: (bold: boolean) => setTextDefaults({ bold }),
      setMaterialColor: () => {},
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

  // Players (players category only) get the skin/kit editors.
  const playerSet = playerSvgs(catalog)
  const allPlayer = els.length > 0 && els.every((e) => e.type === 'figure' && playerSet.has(e.figureId))
  const pc = firstFigure?.colors ?? {}
  const kitJersey = pc[JERSEY_SLOT] ?? '#ff0000'
  const kitV = pc[VSTRIPE_SLOT]
  const kitH = pc[HSTRIPE_SLOT]
  const kitStyle: KitStyle =
    kitV && kitH && kitV !== kitJersey && kitH !== kitJersey ? 'checker' : kitV && kitV !== kitJersey ? 'vstripes' : kitH && kitH !== kitJersey ? 'hstripes' : 'solid'
  const playerKit: PlayerKit = {
    jersey: kitJersey,
    shorts: pc[SHORTS_SLOT] ?? '#1e1e1e',
    socks: pc[SOCKS_SLOT] ?? '#ff0000',
    stripe: kitV && kitV !== kitJersey ? kitV : kitH && kitH !== kitJersey ? kitH : '#1e1e1e',
    style: kitStyle,
  }

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
      bgColor: firstText?.bgColor,
      fontSize: firstText?.fontSize,
      align: firstText?.align,
      bold: firstText?.bold,
      // A material's current custom color (its first slot; falls back to the default).
      materialColor: materialSlot ? (firstFigure!.colors?.[materialSlot] ?? defaultColorFor(materialSlot)) : undefined,
      // Player skin/hair + kit (from the first selected player).
      skin: allPlayer ? (pc[SKIN_SLOT] ?? DEFAULT_SKIN) : undefined,
      hair: allPlayer ? (pc[HAIR_SLOT] ?? DEFAULT_HAIR) : undefined,
      kit: allPlayer ? playerKit : undefined,
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
    // Player skin/kit: patch the relevant color slots on the selected player(s).
    // (The remember-effect re-captures them, so new players inherit the change.)
    setSkin: (skin: string) => patch(figures, (e) => ({ before: { colors: (e as Extract<BoardElement, { type: 'figure' }>).colors }, after: { colors: { ...(e as Extract<BoardElement, { type: 'figure' }>).colors, [SKIN_SLOT]: skin } } })),
    setHair: (hair: string) => patch(figures, (e) => ({ before: { colors: (e as Extract<BoardElement, { type: 'figure' }>).colors }, after: { colors: { ...(e as Extract<BoardElement, { type: 'figure' }>).colors, [HAIR_SLOT]: hair } } })),
    setSkinHair: (skin: string, hair: string) =>
      patch(figures, (e) => ({ before: { colors: (e as Extract<BoardElement, { type: 'figure' }>).colors }, after: { colors: { ...(e as Extract<BoardElement, { type: 'figure' }>).colors, [SKIN_SLOT]: skin, [HAIR_SLOT]: hair } } })),
    setKit: (kit: PlayerKit) =>
      patch(figures, (e) => {
        const f = e as Extract<BoardElement, { type: 'figure' }>
        const { v, h } = stripeFills(kit.style, kit.jersey, kit.stripe)
        return {
          before: { colors: f.colors },
          after: { colors: { ...f.colors, [JERSEY_SLOT]: kit.jersey, [SHORTS_SLOT]: kit.shorts, [SOCKS_SLOT]: kit.socks, [VSTRIPE_SLOT]: v, [HSTRIPE_SLOT]: h } },
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
        const { width, height } = measureTextBox(t.text, fontSize, t.bold)
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
    // Bold toggles weight 800; the box is re-measured (bold is wider) about its center.
    setBold: (bold: boolean) => {
      patch(texts, (e) => {
        const t = e as Extract<BoardElement, { type: 'text' }>
        const { width, height } = measureTextBox(t.text, t.fontSize, bold)
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
  }
}

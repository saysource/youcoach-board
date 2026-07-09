import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { BOARD_WIDTH, BOARD_HEIGHT, type BoardDoc, type LogoPosition } from '@youcoach-board/core'
import { useAssets } from '../lib/assets'
import { loadSvgTemplate, recoloredInnerHtml, type SvgTemplate } from '../lib/figure-svg'
import logoUrl from '../assets/youcoach-logo.svg'

// Renders the document background into BoardCanvas's background layer: a solid
// color (or the legacy grass image), the chosen field SVG (fetched, scaled and
// panned), and the YouCoach logo (0.2 opacity) which animates between positions.
// The field SVG injection is a designer/viewer concern — core only draws a
// placeholder.

const LOGO_W = 280 // corner width; centered is 2× (see logoRect)
const LOGO_RATIO = 63 / 398 // logo viewBox is 398×63
const LOGO_PAD = 40 // identical inset from each relevant border

// Logo box for a position. Centered is twice the size; corners keep a constant
// LOGO_PAD inset from their two borders.
function logoRect(pos: LogoPosition): { x: number; y: number; w: number; h: number } {
  const w = pos === 'center' ? LOGO_W * 2 : LOGO_W
  const h = w * LOGO_RATIO
  switch (pos) {
    case 'top-left':
      return { x: LOGO_PAD, y: LOGO_PAD, w, h }
    case 'top-right':
      return { x: BOARD_WIDTH - w - LOGO_PAD, y: LOGO_PAD, w, h }
    case 'bottom-left':
      return { x: LOGO_PAD, y: BOARD_HEIGHT - h - LOGO_PAD, w, h }
    case 'bottom-right':
      return { x: BOARD_WIDTH - w - LOGO_PAD, y: BOARD_HEIGHT - h - LOGO_PAD, w, h }
    default:
      return { x: (BOARD_WIDTH - w) / 2, y: (BOARD_HEIGHT - h) / 2, w, h }
  }
}

export function BackgroundView({ doc }: { doc: BoardDoc }) {
  const { url } = useAssets()
  const bg = doc.background
  const fieldUrl = bg.fieldSvg ? url(bg.fieldSvg) : null

  const [tpl, setTpl] = useState<{ url: string; t: SvgTemplate | null }>({ url: fieldUrl ?? '', t: null })
  if (tpl.url !== (fieldUrl ?? '')) setTpl({ url: fieldUrl ?? '', t: null })

  useEffect(() => {
    if (!fieldUrl) return
    let cancelled = false
    loadSvgTemplate(fieldUrl)
      .then((t) => {
        if (!cancelled) setTpl((s) => (s.url === fieldUrl ? { url: fieldUrl, t } : s))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [fieldUrl])

  // A real 3D field owns the background (rendered by FieldSceneLayer below the SVG,
  // over a bottom image/solid layer) — draw nothing here so the pitch shows.
  if (bg.field3d) return null

  const field = fieldUrl ? tpl.t : null
  const cx = BOARD_WIDTH / 2
  const cy = BOARD_HEIGHT / 2
  // Scale about the board center, then pan by the stored offset.
  const fieldTransform = `translate(${cx + bg.position[0]} ${cy + bg.position[1]}) scale(${bg.scale}) translate(${-cx} ${-cy})`

  return (
    <g data-layer="background-content">
      {/* The base surface (grass image / solid colour) is drawn as a FIXED layer in
          InteractiveBoard, NOT here: it's the working area the field recedes over and
          must not zoom. Only the field-lines SVG + logo below scale with the flat
          viewport, so zooming out shrinks the field over a stationary surface — like a
          camera pulling away from a real pitch. */}
      {field && (
        <g transform={fieldTransform}>
          <svg
            x={0}
            y={0}
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            viewBox={field.viewBox}
            preserveAspectRatio="xMidYMid meet"
            dangerouslySetInnerHTML={{ __html: recoloredInnerHtml(field, bg.fieldColors) }}
          />
        </g>
      )}

      {bg.logo &&
        (() => {
          const r = logoRect(bg.logo)
          // attrX/attrY animate the SVG x/y attributes (x/y are reserved for
          // transforms in Motion); width/height animate the size — so moving the
          // logo glides + resizes.
          return (
            <motion.image
              href={logoUrl}
              initial={false}
              animate={{ attrX: r.x, attrY: r.y, width: r.w, height: r.h }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              opacity={0.2}
              preserveAspectRatio="xMidYMid meet"
              pointerEvents="none"
            />
          )
        })()}
    </g>
  )
}

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { BOARD_WIDTH, BOARD_HEIGHT, type BoardDoc } from '@youcoach-board/core'
import { useAssets } from '../lib/assets'
import { loadSvgTemplate, recoloredInnerHtml, type SvgTemplate } from '../lib/figure-svg'
import { logoRect, logoUrl } from '../lib/logo'

// Renders the document background into BoardCanvas's background layer: a solid
// color (or the legacy grass image), the chosen field SVG (fetched, scaled and
// panned), and the YouCoach logo (0.2 opacity) which animates between positions.
// On 3D fields the logo is painted INTO the WebGL canvas instead (see
// Object3DLayer's HUD pass). The field SVG injection is a designer/viewer
// concern — core only draws a placeholder.

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

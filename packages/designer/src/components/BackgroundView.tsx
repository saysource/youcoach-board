import { useEffect, useState } from 'react'
import { BOARD_WIDTH, BOARD_HEIGHT, type BoardDoc, type LogoPosition } from '@youcoach-board/core'
import { useAssets } from '../lib/assets'
import { loadSvgTemplate, recoloredInnerHtml, type SvgTemplate } from '../lib/figure-svg'
import logoUrl from '../assets/youcoach-logo.svg'

// Renders the document background into BoardCanvas's background layer: a solid
// color (or the legacy grass image), the chosen field SVG (fetched, scaled and
// panned), and the YouCoach logo at the chosen corner (0.2 opacity). The field
// SVG injection is a designer/viewer concern — core only draws a placeholder.

const LOGO_W = 320
const LOGO_H = (LOGO_W * 63) / 398 // logo viewBox is 398×63
const LOGO_PAD = 40

function logoXY(pos: LogoPosition): { x: number; y: number } {
  switch (pos) {
    case 'top-left':
      return { x: LOGO_PAD, y: LOGO_PAD }
    case 'top-right':
      return { x: BOARD_WIDTH - LOGO_W - LOGO_PAD, y: LOGO_PAD }
    case 'bottom-left':
      return { x: LOGO_PAD, y: BOARD_HEIGHT - LOGO_H - LOGO_PAD }
    case 'bottom-right':
      return { x: BOARD_WIDTH - LOGO_W - LOGO_PAD, y: BOARD_HEIGHT - LOGO_H - LOGO_PAD }
    default:
      return { x: (BOARD_WIDTH - LOGO_W) / 2, y: (BOARD_HEIGHT - LOGO_H) / 2 }
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

  const field = fieldUrl ? tpl.t : null
  const cx = BOARD_WIDTH / 2
  const cy = BOARD_HEIGHT / 2
  // Scale about the board center, then pan by the stored offset.
  const fieldTransform = `translate(${cx + bg.position[0]} ${cy + bg.position[1]}) scale(${bg.scale}) translate(${-cx} ${-cy})`

  return (
    <g data-layer="background-content">
      {bg.image ? (
        <image href={bg.image} x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} preserveAspectRatio="xMidYMid slice" />
      ) : (
        <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} fill={bg.color} />
      )}

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

      {bg.logo && (
        <image
          href={logoUrl}
          {...logoXY(bg.logo)}
          width={LOGO_W}
          height={LOGO_H}
          opacity={0.2}
          preserveAspectRatio="xMidYMid meet"
          pointerEvents="none"
        />
      )}
    </g>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { FigureElement } from '@youcoach-board/core'
import { useAssets } from '../lib/assets'
import { loadSvgTemplate, recoloredInnerHtml, type SvgTemplate } from '../lib/figure-svg'

// Renders a placed catalog figure: the recolored SVG (fetched/cached) nested into
// the board at the element's box, with the same transform wrapper ElementView
// uses, plus an optional horizontal mirror. Falls back to a light placeholder box
// while the SVG loads. (core's ElementView only draws a placeholder; the real SVG
// injection is a designer/viewer concern — see specs/catalog.md.)
export function FigureView({ element }: { element: FigureElement }) {
  const { url } = useAssets()
  const svgUrl = url(element.figureId)
  // Keep the template keyed to its URL; reset render-phase when the URL changes
  // (no synchronous setState in the effect).
  const [tpl, setTpl] = useState<{ url: string; t: SvgTemplate | null }>({ url: svgUrl, t: null })
  if (tpl.url !== svgUrl) setTpl({ url: svgUrl, t: null })

  useEffect(() => {
    let cancelled = false
    loadSvgTemplate(svgUrl)
      .then((t) => {
        if (!cancelled) setTpl((s) => (s.url === svgUrl ? { url: svgUrl, t } : s))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [svgUrl])

  const template = tpl.t
  const { x, y, width, height } = element
  const t = element.transform
  const cx = x + width / 2
  const cy = y + height / 2
  const transform =
    `translate(${t.x} ${t.y}) rotate(${t.rotate} ${cx} ${cy}) ` +
    `translate(${cx} ${cy}) scale(${t.scale}) translate(${-cx} ${-cy})`

  const inner = useMemo(() => (template ? recoloredInnerHtml(template, element.colors) : ''), [template, element.colors])

  return (
    <g transform={transform} opacity={t.opacity}>
      {/* Transparent hit box so the whole figure area is grabbable. */}
      <rect x={x} y={y} width={width} height={height} fill="transparent" />
      {template ? (
        <g transform={element.mirror ? `translate(${2 * x + width} 0) scale(-1 1)` : undefined}>
          <svg
            x={x}
            y={y}
            width={width}
            height={height}
            viewBox={template.viewBox}
            preserveAspectRatio="xMidYMid meet"
            overflow="visible"
            dangerouslySetInnerHTML={{ __html: inner }}
          />
        </g>
      ) : (
        <rect x={x} y={y} width={width} height={height} fill="rgba(0,0,0,0.05)" stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
      )}
    </g>
  )
}

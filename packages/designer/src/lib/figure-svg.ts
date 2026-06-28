// Fetches, sanitizes and caches figure SVGs, then recolors them per instance by
// setting `fill` on elements carrying the known recolor classes (yc-skin, …).
// See specs/catalog.md. Recolor uses plain fill attributes (not a <style>), so
// it needs no CSS scoping and serializes/exports cleanly.

export interface SvgTemplate {
  /** viewBox of the source SVG (for the placed nested <svg>). */
  viewBox: string
  /** Sanitized root <svg> element, cloned per render before recoloring. */
  root: SVGSVGElement
}

const cache = new Map<string, Promise<SvgTemplate>>()

function sanitize(svg: SVGSVGElement) {
  svg.querySelectorAll('script').forEach((n) => n.remove())
  const walk = (el: Element) => {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase()
      if (n.startsWith('on') || (n === 'href' && attr.value.trim().toLowerCase().startsWith('javascript:'))) {
        el.removeAttribute(attr.name)
      }
    }
    for (const c of Array.from(el.children)) walk(c)
  }
  walk(svg)
}

/** Load + parse + sanitize an SVG once, cached by URL. */
export function loadSvgTemplate(url: string): Promise<SvgTemplate> {
  const hit = cache.get(url)
  if (hit) return hit
  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      return r.text()
    })
    .then((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
      const root = doc.querySelector('svg')
      if (!root || doc.querySelector('parsererror')) throw new Error('invalid svg')
      sanitize(root as SVGSVGElement)
      const vb = root.getAttribute('viewBox')
      const w = root.getAttribute('width')?.replace(/px$/, '')
      const h = root.getAttribute('height')?.replace(/px$/, '')
      const viewBox = vb || (w && h ? `0 0 ${w} ${h}` : '0 0 100 100')
      return { viewBox, root: root as SVGSVGElement }
    })
  cache.set(url, p)
  return p
}

/** Inner markup of the template with the given recolor slots applied. */
export function recoloredInnerHtml(tpl: SvgTemplate, colors?: Record<string, string>): string {
  const clone = tpl.root.cloneNode(true) as SVGSVGElement
  if (colors) {
    for (const [slot, color] of Object.entries(colors)) {
      // class names like "yc-color-1" are valid CSS selectors; escape defensively.
      clone.querySelectorAll(`.${CSS.escape(slot)}`).forEach((n) => n.setAttribute('fill', color))
    }
  }
  const xml = new XMLSerializer()
  return Array.from(clone.childNodes)
    .map((n) => xml.serializeToString(n))
    .join('')
}

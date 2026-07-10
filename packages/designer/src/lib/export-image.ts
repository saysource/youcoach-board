// Export the board as a PNG by compositing the live layer stack into one
// canvas, in paint order: background → field WebGL → main SVG → 3D texts →
// elevated-token SVG → arrow/object WebGL → captions SVG. The WebGL canvases
// blit directly (they render with preserveDrawingBuffer); SVG layers re-raster
// via SVG-in-image (vector-crisp at any export size); the CSS-matrix3d 3D texts
// — which Canvas2D can't transform natively — are drawn perspective-correct by
// subdividing each text into horizontal strips, each mapped with the affine
// approximation of the text's homography (visually exact at ~48 strips).

import type * as THREE from 'three'
import { BOARD_WIDTH, BOARD_HEIGHT, textFontStack, TEXT_FONT_WEIGHT, TEXT_FONT_WEIGHT_BOLD, TEXT_LINE_HEIGHT, TEXT_PADDING, textBoxRadius, type BoardBackground, type TextElement } from '@youcoach-board/core'
import { fontFaceCssFor, loadBoardFont } from './fonts'
import { solveHomography } from './homography'
import { text3dCorners } from './text3d'

/** Everything the exporter needs from the live board (provided by InteractiveBoard). */
export interface ExportEnv {
  container: HTMLDivElement
  svg: SVGSVGElement
  background: BoardBackground
  /** Live, pitch-pinned 3D texts (already filtered like the Text3DHtml overlay). */
  texts: TextElement[]
  cam: THREE.Camera
  /** board coords → container px (the overlay CTM). */
  boardToPx: (b: [number, number]) => { x: number; y: number }
  /** Curated font ids used by the document's texts (embedded into SVG clones). */
  fontIds: string[]
}

// ── Registry: InteractiveBoard registers its exporter; the main menu calls it. ──
type Exporter = (width: number, height: number) => Promise<void>
let currentExporter: Exporter | null = null
export function registerBoardExporter(fn: Exporter | null): void {
  currentExporter = fn
}
export function boardExporter(): Exporter | null {
  return currentExporter
}

/** The letterboxed 4:3 board rect within the container, in container px. */
function boardRect(env: ExportEnv): { x: number; y: number; width: number; height: number } {
  const sr = env.svg.getBoundingClientRect()
  const cr = env.container.getBoundingClientRect()
  const s = Math.min(sr.width / BOARD_WIDTH, sr.height / BOARD_HEIGHT)
  const width = BOARD_WIDTH * s
  const height = BOARD_HEIGHT * s
  return { x: sr.left - cr.left + (sr.width - width) / 2, y: sr.top - cr.top + (sr.height - height) / 2, width, height }
}

function rectOf(env: ExportEnv, el: Element): { x: number; y: number; width: number; height: number } {
  const r = el.getBoundingClientRect()
  const cr = env.container.getBoundingClientRect()
  return { x: r.left - cr.left, y: r.top - cr.top, width: r.width, height: r.height }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** Serialize a live SVG element and rasterize it at `scale`× its layout size —
 *  SVG images rasterize at their INTRINSIC size, so the clone's width/height
 *  must carry the full output scale for a crisp (vector-quality) result. */
async function drawSvg(g: CanvasRenderingContext2D, env: ExportEnv, svg: SVGSVGElement, scale: number, fontCss = ''): Promise<void> {
  const r = rectOf(env, svg)
  if (r.width < 1 || r.height < 1) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', clone.getAttribute('viewBox') ?? `0 0 ${r.width} ${r.height}`)
  clone.setAttribute('width', String(Math.ceil(r.width * scale)))
  clone.setAttribute('height', String(Math.ceil(r.height * scale)))
  if (fontCss) {
    // Curated board fonts as data-URI @font-face rules: the SVG rasterizes in an
    // isolated document, so the fonts must travel INSIDE the markup.
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = fontCss
    clone.insertBefore(style, clone.firstChild)
  }
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    g.drawImage(img, r.x, r.y, r.width, r.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function drawCanvasLayer(g: CanvasRenderingContext2D, env: ExportEnv, selector: string): void {
  const canvas = env.container.querySelector<HTMLCanvasElement>(selector)
  if (!canvas || canvas.width === 0) return
  const r = rectOf(env, canvas)
  if (r.width < 1) return
  g.drawImage(canvas, r.x, r.y, r.width, r.height)
}

/** The board background (photo object-cover, else solid color), like the CSS div. */
async function drawBackground(g: CanvasRenderingContext2D, env: ExportEnv, br: { x: number; y: number; width: number; height: number }): Promise<void> {
  const bg = env.background
  if (bg.image) {
    try {
      const img = await loadImage(bg.image)
      // object-fit: cover
      const s = Math.max(br.width / img.width, br.height / img.height)
      const w = img.width * s
      const h = img.height * s
      g.save()
      g.beginPath()
      g.rect(br.x, br.y, br.width, br.height)
      g.clip()
      g.drawImage(img, br.x + (br.width - w) / 2, br.y + (br.height - h) / 2, w, h)
      g.restore()
      return
    } catch {
      /* fall through to color */
    }
  }
  g.fillStyle = bg.surfaceColor && bg.surfaceColor !== 'transparent' ? bg.surfaceColor : '#ffffff'
  g.fillRect(br.x, br.y, br.width, br.height)
}

/** One 3D text, drawn perspective-correct: rasterize the flat text box, then map
 *  it onto its projected ground quad in horizontal strips (affine per strip). */
function drawText3d(g: CanvasRenderingContext2D, env: ExportEnv, el: TextElement, scale: number): void {
  if (!el.ground) return
  const w = el.width
  const h = el.height
  const dst = text3dCorners(el, env.cam).map((b) => env.boardToPx(b)) // TL TR BR BL, container px
  let H: number[]
  try {
    H = solveHomography(
      [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
      dst,
    )
  } catch {
    return
  }
  const map = (x: number, y: number) => {
    const d = H[6] * x + H[7] * y + H[8]
    return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d }
  }

  // Rasterize the flat text box at the full output scale, replicating
  // Text3DHtmlItem — so the strips sample a raster at least as dense as the
  // destination pixels.
  const q = Math.max(2, Math.ceil(scale))
  const off = document.createElement('canvas')
  off.width = Math.max(1, Math.ceil(w * q))
  off.height = Math.max(1, Math.ceil(h * q))
  const og = off.getContext('2d')!
  og.scale(q, q)
  const hasBg = el.bgColor !== 'transparent' && el.bgColor !== ''
  if (hasBg) {
    og.fillStyle = el.bgColor
    og.beginPath()
    og.roundRect(0, 0, w, h, textBoxRadius(el))
    og.fill()
  }
  og.fillStyle = el.textColor
  og.font = `${el.italic ? 'italic ' : ''}${el.bold ? TEXT_FONT_WEIGHT_BOLD : TEXT_FONT_WEIGHT} ${el.fontSize}px ${textFontStack(el.fontFamily)}`
  og.textBaseline = 'middle'
  og.textAlign = el.align === 'right' ? 'right' : el.align === 'center' ? 'center' : 'left'
  const tx = el.align === 'right' ? w - TEXT_PADDING : el.align === 'center' ? w / 2 : TEXT_PADDING
  const lines = el.text.split('\n')
  const lh = el.fontSize * TEXT_LINE_HEIGHT
  const y0 = h / 2 - ((lines.length - 1) * lh) / 2 // flex column, centered
  lines.forEach((line, i) => og.fillText(line, tx, y0 + i * lh))

  // Strip mapping: each horizontal source strip gets the affine defined by its
  // top-left / top-right / bottom-left projected corners. 48 strips ≈ exact.
  const N = 48
  g.save()
  g.globalAlpha = el.transform.opacity
  for (let i = 0; i < N; i++) {
    const sy0 = (h * i) / N
    const sy1 = (h * (i + 1)) / N
    const A = map(0, sy0)
    const B = map(w, sy0)
    const C = map(0, sy1)
    g.save()
    // local (x, y−sy0) → container px
    g.transform((B.x - A.x) / w, (B.y - A.y) / w, (C.x - A.x) / (sy1 - sy0), (C.y - A.y) / (sy1 - sy0), A.x, A.y)
    // +1px source bleed hides the seam between strips.
    g.drawImage(off, 0, sy0 * q, off.width, (sy1 - sy0) * q + 1, 0, 0, w, sy1 - sy0 + 1 / q)
    g.restore()
  }
  g.restore()
}

/** Supersampling factor: the composite is drawn at SS× the target size and
 *  downscaled with high-quality filtering — strong antialiasing for the SVG and
 *  text layers (true 2× rasterization) and properly filtered edges for the
 *  WebGL layers. 2× of 1920×1080 is a 3840×2160 working canvas (~33 MB). */
const SS = 2

/**
 * Composite the live board into a `width`×`height` PNG and download it.
 * The board (4:3) COVERS the output, centred: the native 4:3 target maps
 * exactly; 16:9 crops top/bottom; portrait 9:16 fills the height and crops
 * the sides.
 */
export async function exportBoardImage(env: ExportEnv, width: number, height: number, filename: string): Promise<void> {
  const br = boardRect(env)
  const big = document.createElement('canvas')
  big.width = width * SS
  big.height = height * SS
  const g = big.getContext('2d')!
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'

  // Container px → (supersampled) output px, object-fit COVER: the board fills
  // the whole output and the excess is cropped about the centre — 16:9 trims
  // top/bottom, portrait 9:16 keeps the full height and trims the sides.
  const k = Math.max((width * SS) / br.width, (height * SS) / br.height)
  g.setTransform(k, 0, 0, k, -br.x * k + (width * SS - br.width * k) / 2, -br.y * k + (height * SS - br.height * k) / 2)

  // Curated fonts: ensure they're loaded (the text3d strips draw via canvas,
  // which uses document.fonts) and build the data-URI @font-face CSS for the
  // SVG clones (which rasterize in isolated documents).
  await Promise.all(env.fontIds.map(loadBoardFont))
  const fontCss = env.fontIds.length ? await fontFaceCssFor(env.fontIds) : ''

  await drawBackground(g, env, br)
  drawCanvasLayer(g, env, 'canvas[data-layer="field3d"]')
  await drawSvg(g, env, env.svg, k, fontCss)
  for (const el of env.texts) drawText3d(g, env, el, k)
  const tokens2d = env.container.querySelector<SVGSVGElement>('svg[data-layer="tokens-2d"]')
  if (tokens2d) await drawSvg(g, env, tokens2d, k)
  drawCanvasLayer(g, env, 'canvas[data-layer="arrow3d"]')
  drawCanvasLayer(g, env, 'canvas[data-layer="object3d"]')
  const captions = env.container.querySelector<SVGSVGElement>('svg[data-layer="captions"]')
  if (captions) await drawSvg(g, env, captions, k)

  // Downscale the supersampled composite to the target size (the AA pass).
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const og = out.getContext('2d')!
  og.imageSmoothingEnabled = true
  og.imageSmoothingQuality = 'high'
  og.drawImage(big, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

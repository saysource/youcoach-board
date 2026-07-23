import { useEffect, useState } from 'react'
import '../styles/board.css'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { BOARD_ASPECT, type BoardDoc } from '@youcoach-board/core'
import { BoardRootProvider } from '../lib/board-root'
import { useAssets } from '../lib/assets'
import { useEditorStoreApi } from '../store/context'
import { InteractiveBoard } from './InteractiveBoard'
import { beginAnimationRender, endAnimationRender, seekAnimationFrame } from '../lib/animation-playback'
import { loadDocFonts } from '../lib/fonts'
import { ensurePlayerAnimLoaded, playerAnimReady } from '../lib/player-anim'
import { isObject3DPlayer, object3dGlbReady, onObject3DAssetReady, preloadObject3D } from '../lib/objects3d'
import { exportLogoRect, logoDarkFor, logoDarkUrl, logoUrl } from '../lib/logo'
import { useEditorStore } from '../store/context'

// The HEADLESS render page: a chrome-less, cover-fit board driven frame-by-frame
// by a server-side puppeteer through `window.ycbRender` (see specs/drupal_backend
// .md "Video export"). The host mounts it via `__YCB_SETTINGS__.renderMode` with
// the exported document as initialDoc. The driver contract:
//
//   await body.ycb-render-ready            // assets loaded, board painted
//   const N = window.ycbRender.beginRender(30)   // 0 → still board, one shot
//   for (n of 0‥N−1) { await window.ycbRender.seekFrame(n); screenshot() }
//   window.ycbRender.endRender()
//
// Cover-fit: the 4:3 board fills the viewport, cropping the long axis when the
// viewport isn't 4:3 (1440×1080 / 2560×1920 map exactly; 1920×1080 crops
// top/bottom). The exporter picks the viewport per requested video size.

// Everything visible must be loaded before the ready signal; afterwards the
// only async work left is a late GLB eviction (guarded again in seekFrame).
const READY_TIMEOUT_MS = 30_000
// Texture/kit/overlay decodes have no queryable predicate — they only fire the
// asset-ready notification. A quiet window this long after the last event (with
// all predicates green) is our "nothing else is coming" heuristic.
const ASSET_QUIET_MS = 300
// Per-frame cap on waiting for a late asset before capturing anyway.
const SEEK_ASSET_TIMEOUT_MS = 5_000

/** Every 3D-object id the animation can show (base doc + every frame). */
function usedObjectIds(doc: BoardDoc): string[] {
  const ids = new Set<string>()
  const collect = (els: BoardDoc['elements']) => {
    for (const el of els) if (el.type === 'object3d') ids.add(el.objectId)
  }
  collect(doc.elements)
  for (const f of doc.animation.frames) collect(f.elements)
  return [...ids]
}

/** True when every model/skinning bundle the doc needs is in memory. */
function docAssetsReady(doc: BoardDoc): boolean {
  const ids = usedObjectIds(doc)
  if (!ids.every(object3dGlbReady)) return false
  const hasPlayers = ids.some(isObject3DPlayer)
  return !hasPlayers || playerAnimReady()
}

/** Resolves after ~3 animation frames (store commit → layer render effects →
 *  GL draw → paint), with a timeout fallback for rAF-throttled headless tabs —
 *  the same heuristic as the ycbAnim dev hook. */
function waitPaint(): Promise<void> {
  return new Promise<void>((res) => {
    let done = false
    let f = 0
    const fin = () => {
      if (!done) {
        done = true
        res()
      }
    }
    const tick = () => (++f >= 3 ? fin() : requestAnimationFrame(tick))
    requestAnimationFrame(tick)
    setTimeout(fin, 400)
  })
}

export function RenderShell() {
  const store = useEditorStoreApi()
  const background = useEditorStore((st) => st.doc.background)
  const { catalog } = useAssets()
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // The driver API. Deterministic: beginAnimationRender precomputes segment
  // durations; seekAnimationFrame lerps elements + camera with no wall clock.
  useEffect(() => {
    const api = {
      /** Enter render mode; the sample-frame count (0 when <2 frames). */
      beginRender: (fps = 30) => beginAnimationRender(store, fps),
      /** Apply sample n (0‥N−1); resolves once it is actually painted. */
      seekFrame: async (n: number) => {
        seekAnimationFrame(store, n)
        // A model evicted/missed by the preload would capture as a stub —
        // wait for its chunk (bounded) before painting.
        if (!docAssetsReady(store.getState().doc)) {
          await new Promise<void>((res) => {
            const off = onObject3DAssetReady(() => {
              if (docAssetsReady(store.getState().doc)) fin()
            })
            const cap = setTimeout(() => fin(), SEEK_ASSET_TIMEOUT_MS)
            const fin = () => {
              off()
              clearTimeout(cap)
              res()
            }
          })
        }
        await waitPaint()
      },
      /** Leave render mode; restore the resting document state. */
      endRender: () => endAnimationRender(store),
    }
    ;(window as unknown as { ycbRender?: unknown }).ycbRender = api
    return () => {
      delete (window as unknown as { ycbRender?: unknown }).ycbRender
    }
  }, [store])

  // Readiness: preload everything the animation will show, then signal with a
  // body class the puppeteer driver can waitForSelector on.
  useEffect(() => {
    if (!catalog) return
    let cancelled = false
    const doc = store.getState().doc
    const ids = usedObjectIds(doc)
    ids.forEach(preloadObject3D)
    if (ids.some(isObject3DPlayer)) ensurePlayerAnimLoaded()

    // Fonts for text elements in the base doc AND in every frame.
    const fonts = Promise.all([doc.elements, ...doc.animation.frames.map((f) => f.elements)].map((els) => loadDocFonts({ ...doc, elements: els }))).catch(() => {})
    // The background photo (grass) — decoded before we call the page ready.
    const bgImage = new Promise<void>((res) => {
      if (!doc.background.image) return res()
      const img = new Image()
      img.onload = () => res()
      img.onerror = () => res()
      img.src = doc.background.image
    })

    let lastAsset = Date.now()
    const off = onObject3DAssetReady(() => {
      lastAsset = Date.now()
    })
    const started = Date.now()
    void Promise.all([fonts, bgImage]).then(async () => {
      // Predicates green + a quiet window on the (predicate-less) texture
      // decodes, or the hard cap — then two paints and the ready class.
      for (;;) {
        if (cancelled) return
        const timedOut = Date.now() - started > READY_TIMEOUT_MS
        if (timedOut || (docAssetsReady(store.getState().doc) && Date.now() - lastAsset > ASSET_QUIET_MS)) {
          await waitPaint()
          await waitPaint()
          if (!cancelled) {
            if (timedOut) document.body.classList.add('ycb-render-timeout')
            document.body.classList.add('ycb-render-ready')
          }
          return
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    })
    return () => {
      cancelled = true
      off()
      document.body.classList.remove('ycb-render-ready', 'ycb-render-timeout')
    }
  }, [catalog, store])

  // Cover-fit: the smallest 4:3 rect that covers the viewport, centred.
  const W = Math.max(size.w, size.h * BOARD_ASPECT)
  const H = W / BOARD_ASPECT
  // The watermark is drawn relative to the FINAL VIDEO FRAME, not the board:
  // the scene copy is hidden (a 16:9/9:16 crop would cut it) and an overlay
  // image sits inside the exporter's crop region — the centred rect of the
  // requested size (settings.renderSize; portrait renders on a wide viewport
  // that ffmpeg centre-crops). No renderSize → the whole viewport.
  const rs = (window.__YCB_SETTINGS__ as { renderSize?: { width: number; height: number } } | undefined)?.renderSize
  const frame = rs
    ? { w: Math.min(rs.width, size.w), h: Math.min(rs.height, size.h) }
    : { w: size.w, h: size.h }
  const frameX = (size.w - frame.w) / 2
  const frameY = (size.h - frame.h) / 2
  const logoR = background.logo ? exportLogoRect(background.logo, frame.w, frame.h) : null
  return (
    <div ref={setRootEl} className="ycb-root fixed inset-0 isolate overflow-hidden bg-background" style={{ cursor: 'none' }}>
      <TooltipPrimitive.Provider delayDuration={300}>
        <BoardRootProvider value={rootEl}>
          <div className="absolute" style={{ width: W, height: H, left: (size.w - W) / 2, top: (size.h - H) / 2 }}>
            <InteractiveBoard presenting hideLogo />
          </div>
          {logoR && (
            <img
              src={logoDarkFor(background) ? logoDarkUrl : logoUrl}
              alt=""
              className="pointer-events-none absolute z-40 opacity-20"
              style={{ left: frameX + logoR.x, top: frameY + logoR.y, width: logoR.w, height: logoR.h }}
            />
          )}
          {/* No interaction ever reaches the board — the driver only evaluates JS. */}
          <div className="absolute inset-0 z-50" />
        </BoardRootProvider>
      </TooltipPrimitive.Provider>
    </div>
  )
}

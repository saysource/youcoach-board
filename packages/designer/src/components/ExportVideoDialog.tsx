import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clapperboard, LoaderCircle, TriangleAlert } from 'lucide-react'
import { serializeBoard } from '@youcoach-board/core'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { cn } from '../lib/cn'
import { useEditorStoreApi } from '../store/context'

// Server-side MP4 export (see specs/drupal_backend.md "Video export"): POST the
// document to the host's export endpoint, then poll the job status until the
// backend's headless renderer has produced the video, and download it. The
// endpoint contract (all host-relative, cookies carry the session):
//   POST   <exportUrl>                    {format,size,data} → {token}
//   GET    <exportUrl>/<token>/status     → {status: sent|processing|completed|error}
//   GET    <exportUrl>/<token>/download   → the MP4 (one-shot: the host deletes it)

const SIZES: Array<{ label: string; width: number; height: number }> = [
  { label: '4:3 (1440×1080)', width: 1440, height: 1080 },
  { label: '16:9 (1920×1080)', width: 1920, height: 1080 },
  { label: '9:16 (1080×1920)', width: 1080, height: 1920 },
]

const POLL_MS = 2000

type Phase = 'idle' | 'submitting' | 'processing' | 'completed' | 'error'

export function ExportVideoDialog({ open, onOpenChange, exportUrl }: { open: boolean; onOpenChange: (open: boolean) => void; exportUrl: string }) {
  const { t } = useTranslation()
  const storeApi = useEditorStoreApi()
  const [size, setSize] = useState(1)
  const [phase, setPhase] = useState<Phase>('idle')
  // Generation guard: bumping it orphans any in-flight fetch/poll loop, so a
  // closed dialog (or a retry) can never resurrect a stale state update.
  const runRef = useRef(0)

  useEffect(() => () => void runRef.current++, [])

  // Closing (button, Esc, overlay) orphans any in-flight request and resets
  // the dialog, so reopening always starts a fresh export.
  function change(o: boolean) {
    if (!o) {
      runRef.current++
      setPhase('idle')
    }
    onOpenChange(o)
  }

  async function start() {
    const run = ++runRef.current
    setPhase('submitting')
    try {
      const { width, height } = SIZES[size]
      const res = await fetch(exportUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'mp4', size: { width, height }, data: serializeBoard(storeApi.getState().doc) }),
      })
      if (!res.ok) throw new Error(`export request failed (${res.status})`)
      const { token: jobToken } = (await res.json()) as { token?: string }
      if (!jobToken) throw new Error('export request returned no token')
      if (run !== runRef.current) return
      setPhase('processing')
      const statusUrl = `${exportUrl}/${encodeURIComponent(jobToken)}/status`
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (run !== runRef.current) return
        let status = ''
        try {
          const s = await fetch(statusUrl, { credentials: 'include' })
          if (s.ok) status = ((await s.json()) as { status?: string }).status ?? ''
        } catch {
          continue // transient network error — keep polling
        }
        if (run !== runRef.current) return
        if (status === 'completed') {
          setPhase('completed')
          // Hand the file to the browser's downloader right away.
          const a = document.createElement('a')
          a.href = `${exportUrl}/${encodeURIComponent(jobToken)}/download`
          a.download = ''
          a.click()
          return
        }
        if (status === 'error' || status === '') {
          setPhase('error')
          return
        }
      }
    } catch {
      if (run === runRef.current) setPhase('error')
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="flex items-center gap-2">
          <Clapperboard className="size-5" /> {t('Export video')}
        </DialogTitle>

        {(phase === 'idle' || phase === 'submitting') && (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-muted-foreground">{t('The animation is rendered on the server as an MP4 video.')}</div>
            <div className="flex flex-col gap-1.5">
              {SIZES.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setSize(i)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    i === size ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-accent',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => change(false)}>
                {t('Cancel')}
              </Button>
              <Button variant="default" size="sm" onClick={() => void start()} disabled={phase === 'submitting'}>
                {phase === 'submitting' ? <LoaderCircle className="animate-spin" /> : <Clapperboard />} {t('Start export')}
              </Button>
            </div>
          </div>
        )}

        {phase === 'processing' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
            <div className="text-sm">{t('Preparing video…')}</div>
            <div className="text-xs text-muted-foreground">{t('This can take a minute — you can keep working, the download starts when ready.')}</div>
          </div>
        )}

        {phase === 'completed' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="size-8 text-green-600" />
            <div className="text-sm">{t('The video is ready and the download has started.')}</div>
            <Button variant="outline" size="sm" onClick={() => change(false)}>
              {t('Close')}
            </Button>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <TriangleAlert className="size-8 text-destructive" />
            <div className="text-sm">{t('The video export failed. Please try again.')}</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => change(false)}>
                {t('Close')}
              </Button>
              <Button variant="default" size="sm" onClick={() => setPhase('idle')}>{t('Try again')}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

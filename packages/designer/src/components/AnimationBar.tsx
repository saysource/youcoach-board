import { useState } from 'react'
import { Camera, ChevronDown, ChevronLeft, ChevronRight, ClipboardCopy, ClipboardPaste, Copy, Play, Plus, Settings, Square, Trash2, Undo2 } from 'lucide-react'
import type { FieldView } from '@youcoach-board/core'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { Separator } from './ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { cn } from '../lib/cn'
import { useEditorStore, useEditorStoreApi } from '../store/context'
import { startPlayback, stopPlayback } from '../lib/animation-playback'
import { animateFieldTo } from '../lib/field-anim'

// The animation toolbar (specs/animation.md): a strip of numbered frame tiles
// (click switches — the camera never moves on a switch), each with a menu of
// frame operations, a "+" tile appending a copy of the LAST frame, and the
// Play/Stop loop toggle. While playing, everything but Stop is disabled.
// Tile geometry (px) used to compute how many frame tiles fit: compact tile
// (size-8 button + border + gap), the wider active tile (number + chevron),
// and the bar's fixed chrome (padding, "+", separator, play, settings).
const TILE_W = 38
const ACTIVE_EXTRA = 16
const CHROME_W = 184

export function AnimationBar({ maxWidth = Infinity }: { maxWidth?: number }) {
  const storeApi = useEditorStoreApi()
  const frames = useEditorStore((s) => s.doc.animation.frames)
  const currentFrame = useEditorStore((s) => s.currentFrame)
  const playing = useEditorStore((s) => s.playing)
  const playhead = useEditorStore((s) => s.playhead)
  const field3d = useEditorStore((s) => s.doc.background.field3d)
  const speed = useEditorStore((s) => s.doc.animation.speed)
  const cameraEasing = useEditorStore((s) => s.doc.animation.cameraEasing)
  const loop = useEditorStore((s) => s.doc.animation.loop)
  // Camera-pose clipboard for copying a stored position between frames (local
  // to the bar — not the OS clipboard, not part of the document).
  const [camClipboard, setCamClipboard] = useState<FieldView | null>(null)

  // While playing, the highlighted tile follows the playhead (nearest frame);
  // otherwise it's the frame being edited.
  const activeFrame = playing && playhead != null ? Math.min(Math.round(playhead), frames.length - 1) : currentFrame

  // Clicking a tile switches to that frame AND flies the camera to its stored
  // pose. Frames without their own pose inherit the previous frame's (the same
  // chain playback uses); with no stored pose at all the camera stays put.
  function selectFrame(i: number) {
    const s = storeApi.getState()
    s.setCurrentFrame(i)
    if (!s.doc.background.field3d) return
    for (let k = i; k >= 0; k--) {
      const cam = frames[k]?.camera
      if (cam) {
        animateFieldTo(storeApi, cam)
        return
      }
    }
  }

  // How many tiles fit in the space the shell says is free. When frames exceed
  // that, only a WINDOW of tiles around the active frame is shown (the scrubber
  // + ellipses cover the rest).
  const maxTiles = Math.max(2, Math.floor((maxWidth - CHROME_W - ACTIVE_EXTRA) / TILE_W))
  const windowed = frames.length > maxTiles
  const half = Math.floor((maxTiles - 1) / 2)
  const start = windowed ? Math.min(Math.max(0, activeFrame - half), frames.length - maxTiles) : 0
  const end = windowed ? start + maxTiles : frames.length

  // From this many frames on (or whenever the strip is windowed), a scrubber
  // bar appears above the tiles: it shows the position within the sequence
  // (and the live playhead during playback) and can be dragged to jump.
  const SCRUBBER_FROM = 7
  const showScrubber = frames.length >= SCRUBBER_FROM || windowed
  // Position gauge: "frame X of N" while editing, the playhead while playing.
  const gauge = frames.length > 0 ? (playing && playhead != null ? (playhead + 1) / frames.length : (activeFrame + 1) / frames.length) : 0

  // Scrub: drag along the bar to switch frames (no camera moves mid-drag; the
  // released frame flies like a tile click).
  function startScrub(e: React.PointerEvent<HTMLDivElement>) {
    if (playing || e.button !== 0) return
    e.preventDefault()
    const track = e.currentTarget
    const frameAt = (clientX: number) => {
      const r = track.getBoundingClientRect()
      const f = Math.min(1, Math.max(0, (clientX - r.x) / r.width))
      return Math.min(frames.length - 1, Math.floor(f * frames.length))
    }
    storeApi.getState().setCurrentFrame(frameAt(e.clientX))
    const move = (ev: PointerEvent) => {
      const k = frameAt(ev.clientX)
      if (k !== storeApi.getState().currentFrame) storeApi.getState().setCurrentFrame(k)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      selectFrame(frameAt(ev.clientX))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div className="pointer-events-auto select-none flex items-center gap-1 rounded-xl border border-border bg-card py-0.5 px-1 shadow-md">
      <div className="relative flex flex-col gap-1 self-stretch justify-center">
      <div className="flex items-center gap-1">
      {/* Step to the previous/next frame (also pans the window when many). */}
      <Button size="icon-sm" aria-label="Previous frame" disabled={playing || activeFrame <= 0} onClick={() => selectFrame(activeFrame - 1)} className="w-4 px-0 hover:bg-primary/25">
        <ChevronLeft />
      </Button>
      {frames.slice(start, end).map((f, idx) => {
        const i = start + idx
        return (
        i === activeFrame && !playing ? (
          /* Active frame: full tile with its options menu. */
          <div key={i} className="flex items-center overflow-hidden rounded-md border border-border">
            <Button
              size="icon-sm"
              aria-label={`Frame ${i + 1}`}
              aria-pressed
              className="relative rounded-r-none text-xs font-semibold tabular-nums bg-primary/40 hover:bg-primary/40"
            >
              {i + 1}
              {/* Tiny badge: this frame stores its own camera pose. */}
              {f.camera && <Camera aria-hidden className="pointer-events-none absolute -top-0.5 -right-0.5 !size-2.5 text-foreground/60" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" aria-label={`Frame ${i + 1} options`} className="w-3.5 rounded-l-none px-0 hover:bg-primary/25">
                  <ChevronDown className="!size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuItem onSelect={() => storeApi.getState().duplicateFrame(i)}>
                  <Copy /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!field3d} onSelect={() => storeApi.getState().setFrameCamera(i, storeApi.getState().doc.background.field3d)}>
                  <Camera /> Set camera position
                </DropdownMenuItem>
                <DropdownMenuItem disabled={i === 0} onSelect={() => storeApi.getState().setFrameCamera(i, frames[i - 1]?.camera ?? null)}>
                  <Undo2 /> Reset camera position
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!f.camera} onSelect={() => setCamClipboard(f.camera)}>
                  <ClipboardCopy /> Copy camera position
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!camClipboard} onSelect={() => storeApi.getState().setFrameCamera(i, camClipboard)}>
                  <ClipboardPaste /> Paste camera position
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={frames.length <= 1} onSelect={() => storeApi.getState().removeFrame(i)}>
                  <Trash2 /> Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          /* Other frames: compact numbered squares — click to select (the
             options menu appears once the frame is active). */
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                aria-label={`Frame ${i + 1}`}
                aria-pressed={i === activeFrame}
                disabled={playing}
                onClick={() => selectFrame(i)}
                className={cn('relative rounded-md border border-border text-xs font-semibold tabular-nums hover:bg-primary/25', i === activeFrame && 'bg-primary/40 hover:bg-primary/40 disabled:opacity-100')}
              >
                {i + 1}
                {f.camera && <Camera aria-hidden className="pointer-events-none absolute -top-0.5 -right-0.5 !size-2.5 text-foreground/60" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Frame {i + 1}</TooltipContent>
          </Tooltip>
        )
        )
      })}
      <Button size="icon-sm" aria-label="Next frame" disabled={playing || activeFrame >= frames.length - 1} onClick={() => selectFrame(activeFrame + 1)} className="w-4 px-0 hover:bg-primary/25">
        <ChevronRight />
      </Button>
      </div>
      {/* Scrubber (many frames): position/playhead gauge + drag-to-jump, under
          the tiles. The round thumb at the end of the fill invites dragging. */}
      {showScrubber && (
        <div className="flex items-center gap-1.5 px-0.5 pb-0.5">
          <div className={cn('relative h-2.5 flex-1', !playing && 'cursor-pointer')} onPointerDown={startScrub}>
            <div className="pointer-events-none absolute inset-0 rounded-full bg-border" />
            <div className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-primary/60" style={{ width: `${gauge * 100}%` }} />
            <div
              className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary shadow"
              style={{ left: `${gauge * 100}%` }}
            />
          </div>
          <span className="text-[10px] font-medium leading-none text-muted-foreground tabular-nums">{frames.length}</span>
        </div>
      )}
      {/* Playback timeline for SHORT strips (the scrubber shows it otherwise):
          a thin track under the tiles filling with the loop's elapsed time. */}
      {!showScrubber && playing && playhead != null && frames.length > 1 && (
        <div className="pointer-events-none absolute -bottom-0.5 left-0.5 right-0.5 h-0.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-foreground/60" style={{ width: `${(playhead / (frames.length - 1)) * 100}%` }} />
        </div>
      )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Add frame" disabled={playing} onClick={() => storeApi.getState().addFrame()} className="hover:bg-primary/25">
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add frame (copy of the last)</TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            aria-label={playing ? 'Stop' : 'Play'}
            disabled={!playing && frames.length < 2}
            onClick={() => (playing ? stopPlayback(storeApi) : startPlayback(storeApi))}
            className={cn('hover:bg-primary/25', playing && 'bg-primary/40 hover:bg-primary/40')}
          >
            {playing ? <Square /> : <Play />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{playing ? 'Stop' : 'Play the animation in a loop'}</TooltipContent>
      </Tooltip>
      {/* Animation settings: playback speed + camera easing (saved in the doc). */}
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button size="icon-sm" aria-label="Animation settings" disabled={playing} className="hover:bg-primary/25">
                <Settings />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Animation settings</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-56 space-y-3 p-3">
          <div className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Playback speed ({speed}x)</span>
            <Slider min={0.25} max={2} step={0.25} value={[speed]} onValueChange={([v]) => storeApi.getState().setAnimationSettings({ speed: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">Loop</span>
            <Switch checked={loop} onCheckedChange={(v) => storeApi.getState().setAnimationSettings({ loop: v })} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Camera easing</span>
            <div className="flex gap-1">
              {(
                [
                  ['linear', 'Linear'],
                  ['ease', 'Easy Ease'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  aria-pressed={cameraEasing === value}
                  onClick={() => storeApi.getState().setAnimationSettings({ cameraEasing: value })}
                  className={cn('flex-1 hover:bg-primary/25', cameraEasing === value && 'bg-primary/40 hover:bg-primary/40')}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

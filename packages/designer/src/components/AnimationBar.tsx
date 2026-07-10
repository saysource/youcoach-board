import { useState } from 'react'
import { Camera, ChevronDown, ClipboardCopy, ClipboardPaste, Copy, Play, Plus, Settings, Square, Trash2, Undo2 } from 'lucide-react'
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
export function AnimationBar() {
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
  // Single source of truth for the open frame menu, so opening one closes the
  // others (the Toolbar's pattern). Close events only clear when they belong to
  // the still-open menu, so an open-then-close race can't cancel the new menu.
  const [openMenu, setOpenMenu] = useState<number | null>(null)

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

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-card py-0.5 px-1 shadow-md">
      <div className="relative flex items-center gap-1">
      {frames.map((f, i) => (
        <div key={i} className="flex items-center overflow-hidden rounded-md border border-border">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                aria-label={`Frame ${i + 1}`}
                aria-pressed={i === activeFrame}
                disabled={playing}
                onClick={() => selectFrame(i)}
                className={cn('relative rounded-r-none text-xs font-semibold tabular-nums hover:bg-primary/25', i === activeFrame && 'bg-primary/40 hover:bg-primary/40 disabled:opacity-100')}
              >
                {i + 1}
                {/* Tiny badge: this frame stores its own camera pose. */}
                {f.camera && <Camera aria-hidden className="pointer-events-none absolute -top-0.5 -right-0.5 !size-2.5 text-foreground/60" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Frame {i + 1}</TooltipContent>
          </Tooltip>
          <DropdownMenu open={openMenu === i} onOpenChange={(o) => setOpenMenu((prev) => (o ? i : prev === i ? null : prev))}>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" aria-label={`Frame ${i + 1} options`} disabled={playing} className="w-3.5 rounded-l-none px-0 hover:bg-primary/25">
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
      ))}
      {/* Timeline indicator: a thin track under the frame tiles that fills with
          the loop's elapsed time while playing. */}
      {playing && playhead != null && frames.length > 1 && (
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

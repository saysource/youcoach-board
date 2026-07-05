import { MouseLeft, Mouse, ArrowBigUp } from 'lucide-react'

// Bottom-centre mouse-controls hint shown while navigating the 3D scene (desktop
// only — touch gestures come later). Blender-style content, Excalidraw-style look:
// left-mouse drag = rotate, wheel = zoom, Shift + left-mouse drag = pan.
export function NavHints() {
  return (
    <div className="pointer-events-none flex items-center gap-3 px-3 py-1.5 text-[11px] text-muted-foreground [&_svg]:size-4 [&_svg]:text-foreground/80">
      <span className="flex items-center gap-1"><MouseLeft /> rotate</span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1"><Mouse /> zoom</span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1"><ArrowBigUp />+<MouseLeft /> pan</span>
    </div>
  )
}

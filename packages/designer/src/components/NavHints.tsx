import { MouseLeft, Mouse, ArrowBigUp } from 'lucide-react'

// A small keycap for the edit-mode hints.
function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-border bg-muted px-1 py-px text-[10px] font-medium leading-none text-foreground/80">{children}</kbd>
}

// Hints for the 3D-camera shortcuts available in normal edit mode (desktop only):
// Space toggles orbit navigation, ⌥ + wheel zooms toward the cursor, and — with
// nothing selected — the arrow keys orbit (⇧ pans). Compact so it fits the board.
export function EditHints() {
  return (
    <div className="pointer-events-none flex items-center gap-2 text-[11px] text-muted-foreground [&_svg]:size-3.5 [&_svg]:text-foreground/70">
      <span className="flex items-center gap-1"><Kbd>Space</Kbd> rotate 3D</span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1"><Kbd>⌥</Kbd>+<Mouse /> zoom</span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1"><Kbd>↑↓←→</Kbd> orbit</span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1"><Kbd>⇧</Kbd>+<Kbd>↑↓←→</Kbd> pan</span>
    </div>
  )
}

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

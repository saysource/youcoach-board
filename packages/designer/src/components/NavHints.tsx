import { type ReactNode } from 'react'

// A subtle key/action label, Excalidraw-style.
function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium not-italic text-foreground/80">{children}</kbd>
}

// Bottom-centre mouse-controls hint shown while navigating the 3D scene (desktop
// only — touch gestures come later). Blender-style content, Excalidraw-style look.
export function NavHints() {
  return (
    <div className="pointer-events-none flex items-center gap-3 px-3 py-1.5 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1"><Kbd>Drag</Kbd> rotate</span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1"><Kbd>Scroll</Kbd> zoom</span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1"><Kbd>Shift</Kbd>+<Kbd>Drag</Kbd> pan</span>
    </div>
  )
}

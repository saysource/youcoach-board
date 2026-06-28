import { Search, X, LibraryBig } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/cn'

interface LibraryDrawerProps {
  open: boolean
  onClose: () => void
}

// Right-side figures library. Phase 1: renders its chrome and an empty state;
// the search and content are inert until the figures palette lands.
export function LibraryDrawer({ open, onClose }: LibraryDrawerProps) {
  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-72 flex-col border-l border-border bg-card shadow-xl transition-transform duration-200',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <span className="text-sm font-semibold">Library</span>
        <Button size="icon-sm" aria-label="Close library" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-muted-foreground">
          <Search className="size-4" />
          <input
            type="text"
            placeholder="Search library"
            disabled
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <LibraryBig className="size-8 opacity-50" />
        <p className="text-sm">No figures yet</p>
        <p className="text-xs">Players, materials and fields will appear here.</p>
      </div>
    </aside>
  )
}

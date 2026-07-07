import { Fragment } from 'react'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

// ⌘/⌥/⇧ on macOS; Ctrl/Alt/Shift elsewhere (the spec's combos are Mac-first).
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl'
const ALT = isMac ? '⌥' : 'Alt'
const SHIFT = isMac ? '⇧' : 'Shift'

type Combo = string[]
interface Row {
  label: string
  combos: Combo[]
}
interface Section {
  title: string
  rows: Row[]
}

const TOOLS: Section = {
  title: 'Tools',
  rows: [
    { label: 'Selection', combos: [['V'], ['1']] },
    { label: 'Rectangle', combos: [['R'], ['2']] },
    { label: 'Diamond', combos: [['3']] },
    { label: 'Ellipse', combos: [['O'], ['4']] },
    { label: 'Arrow', combos: [['A'], ['5']] },
    { label: 'Line', combos: [['L'], ['6']] },
    { label: 'Pen (draw)', combos: [['D'], ['7']] },
    { label: 'Text', combos: [['T'], ['8']] },
    { label: 'Token', combos: [['K']] },
    { label: 'Eraser', combos: [['E'], ['0']] },
    { label: 'Players drawer', combos: [['P']] },
    { label: 'Materials drawer', combos: [['M']] },
    { label: 'Add ball', combos: [['B']] },
    { label: 'Edit background (field)', combos: [['F']] },
    { label: 'Navigate scene (orbit)', combos: [['W']] },
    { label: 'Keep tool active', combos: [['Q']] },
  ],
}

const EDITOR: Section = {
  title: 'Editor',
  rows: [
    { label: 'Undo', combos: [[MOD, 'Z']] },
    { label: 'Redo', combos: [[MOD, SHIFT, 'Z']] },
    { label: 'Cut', combos: [[MOD, 'X']] },
    { label: 'Copy', combos: [[MOD, 'C']] },
    { label: 'Paste', combos: [[MOD, 'V']] },
    { label: 'Duplicate', combos: [[MOD, 'D']] },
    { label: 'Duplicate (drag)', combos: [[ALT, 'drag']] },
    { label: 'Delete', combos: [['Delete']] },
    { label: 'Select all', combos: [[MOD, 'A']] },
    { label: 'Flip figure', combos: [[MOD, 'F']] },
    { label: 'Copy styles', combos: [[MOD, ALT, 'C']] },
    { label: 'Paste styles', combos: [[MOD, ALT, 'V']] },
    { label: 'Bring to front', combos: [[MOD, ALT, ']']] },
    { label: 'Send to back', combos: [[MOD, ALT, '[']] },
    { label: 'Bring forward', combos: [[MOD, ']']] },
    { label: 'Send backward', combos: [[MOD, '[']] },
    { label: 'Resize larger', combos: [[MOD, ALT, SHIFT, '+']] },
    { label: 'Resize smaller', combos: [[MOD, ALT, SHIFT, '−']] },
    { label: 'Move / nudge', combos: [['←', '→', '↑', '↓']] },
    { label: 'Bold text', combos: [[MOD, 'B']] },
    { label: 'Deselect / cancel', combos: [['Esc']] },
  ],
}

const VIEW: Section = {
  title: 'View',
  rows: [
    { label: 'Toggle grid', combos: [['G']] },
    { label: 'Snap to objects', combos: [[ALT, 'S']] },
    { label: 'Keyboard shortcuts', combos: [['?']] },
  ],
}

function Key({ children }: { children: string }) {
  return <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 text-[11px] font-medium text-foreground shadow-sm">{children}</kbd>
}

function ShortcutRow({ row }: { row: Row }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{row.label}</span>
      <span className="flex flex-wrap items-center justify-end gap-1">
        {row.combos.map((combo, ci) => (
          <Fragment key={ci}>
            {ci > 0 && <span className="px-1 text-xs text-muted-foreground">or</span>}
            {combo.map((k, ki) => (
              <Key key={ki}>{k}</Key>
            ))}
          </Fragment>
        ))}
      </span>
    </div>
  )
}

function SectionBlock({ section }: { section: Section }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-foreground">{section.title}</h3>
      <div className="divide-y divide-border/50">
        {section.rows.map((row) => (
          <ShortcutRow key={row.label} row={row} />
        ))}
      </div>
    </div>
  )
}

/** The Help → "Keyboard Shortcuts" dialog: every binding grouped Tools / Editor /
 *  View, with platform-correct key glyphs. */
export function KeyboardShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="mb-4 text-lg font-semibold">Keyboard shortcuts</DialogTitle>
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
          <SectionBlock section={TOOLS} />
          <div className="grid gap-6">
            <SectionBlock section={EDITOR} />
            <SectionBlock section={VIEW} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

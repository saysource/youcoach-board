import { useState } from 'react'
import { ElementView } from '@youcoach-board/core'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { cn } from '../lib/cn'
import { useEditorStore } from '../store/context'
import { makeToken, TOKEN_SIZE, type TokenStyle } from '../lib/draw'
import { fieldSystemConfig, formationCenters, directionOptions, type FieldSystemConfig, type FormationDir } from '../lib/formations'

// The two default team colors when the board doesn't already have teams.
const RED: TokenStyle = { shape: 'token', tokenFill: 'solid', color1: '#e37268', color2: '#e37268', textColor: '#ffffff', showLabel: false }
const BLUE: TokenStyle = { shape: 'token', tokenFill: 'solid', color1: '#799eed', color2: '#799eed', textColor: '#ffffff', showLabel: false }

// Style options: the distinct token styles already on the board (so a formation
// can join an existing team), or red/blue when there aren't at least two.
function styleOptions(elements: { type: string }[]): TokenStyle[] {
  const seen = new Map<string, TokenStyle>()
  for (const e of elements) {
    if (e.type !== 'token') continue
    const t = e as unknown as TokenStyle
    const key = `${t.shape}|${t.tokenFill}|${t.color1}|${t.color2}|${t.textColor}`
    if (!seen.has(key)) seen.set(key, { shape: t.shape, tokenFill: t.tokenFill, color1: t.color1, color2: t.color2, textColor: t.textColor, showLabel: t.showLabel })
  }
  const opts = [...seen.values()]
  return opts.length >= 2 ? opts : [RED, BLUE]
}

// A small token preview for a style swatch.
function TokenSwatch({ style }: { style: TokenStyle }) {
  const el = makeToken('swatch', 50, 50, style, '', 100)
  return (
    <svg width={30} height={30} viewBox="-4 -4 108 108" aria-hidden>
      <ElementView element={el} />
    </svg>
  )
}

function Body({ code, cfg, onClose }: { code: string; cfg: FieldSystemConfig; onClose: () => void }) {
  const elements = useEditorStore((s) => s.doc.elements)
  const figureScale = useEditorStore((s) => s.doc.background.figureScale)
  const placeElements = useEditorStore((s) => s.placeElements)
  const dirs = directionOptions(cfg.orientation)
  const options = styleOptions(elements)
  const [dir, setDir] = useState<FormationDir>('forward')
  const [styleIdx, setStyleIdx] = useState(0)

  function place() {
    const style = options[Math.min(styleIdx, options.length - 1)]
    const size = Math.max(12, Math.round(TOKEN_SIZE * figureScale))
    const tokens = formationCenters(code, cfg, dir).map((c, i) => makeToken(crypto.randomUUID(), c.x, c.y, style, String(i + 1), size))
    placeElements(tokens)
    onClose()
  }

  return (
    <div className="grid gap-4">
      <DialogTitle className="text-base font-semibold">
        Game system <span className="text-primary">{code}</span>
      </DialogTitle>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Direction</span>
        <div className="flex gap-1 rounded-md bg-muted p-0.5">
          {dirs.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={dir === d.id}
              onClick={() => setDir(d.id)}
              className={cn('flex-1 rounded px-2 py-1.5 text-sm transition-colors', dir === d.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Team</span>
        <div className="flex flex-wrap gap-1.5">
          {options.map((s, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Team ${i + 1}`}
              aria-pressed={styleIdx === i}
              onClick={() => setStyleIdx(i)}
              className={cn('flex items-center justify-center rounded-md border p-0.5', styleIdx === i ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-accent')}
            >
              <TokenSwatch style={s} />
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={place}>
          Add {cfg.teamSize} players
        </Button>
      </div>
    </div>
  )
}

/** Pick direction + team style for a game system, then drop its tokens. Open when
 *  `code` is set and the current field supports systems. */
export function GameSystemDialog({ code, fieldSvg, onClose }: { code: string | null; fieldSvg: string | null | undefined; onClose: () => void }) {
  const cfg = fieldSystemConfig(fieldSvg)
  return (
    <Dialog open={code != null && cfg != null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        {/* Keyed by code so direction/style reset for each formation. */}
        {code && cfg && <Body key={code} code={code} cfg={cfg} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

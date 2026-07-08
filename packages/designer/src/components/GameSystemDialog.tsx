import { useState } from 'react'
import { ElementView } from '@youcoach-board/core'
import soccerRaw from '../assets/football_field.svg?raw'
import futsalRaw from '../assets/futsal_field.svg?raw'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { cn } from '../lib/cn'
import { useEditorStore } from '../store/context'
import { makeToken, TOKEN_SIZE, type TokenStyle } from '../lib/draw'
import { pinTokensAtGround } from '../lib/field-anchor'
import {
  systemConfigForField,
  formationGround,
  formationFieldPoints,
  directionOptions,
  type SystemConfig,
  type FieldKind,
  type FormationDir,
  type Spread,
} from '../lib/formations'

// The two default team colors when the board doesn't already have teams.
const RED: TokenStyle = { shape: 'token', tokenFill: 'solid', color1: '#e37268', color2: '#e37268', textColor: '#ffffff', showLabel: false }
const BLUE: TokenStyle = { shape: 'token', tokenFill: 'solid', color1: '#799eed', color2: '#799eed', textColor: '#ffffff', showLabel: false }

// The field artwork (single stroked path) per kind.
const FIELD_PATH: Record<FieldKind, string> = {
  soccer: soccerRaw.match(/<path[^>]*\sd="([^"]+)"/)?.[1] ?? '',
  futsal: futsalRaw.match(/<path[^>]*\sd="([^"]+)"/)?.[1] ?? '',
}

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

// A token preview for a team swatch (sized like the token Fill picker).
function TokenSwatch({ style }: { style: TokenStyle }) {
  const el = makeToken('swatch', 50, 50, style, '', 100)
  return (
    <svg width={48} height={48} viewBox="-4 -4 108 108" aria-hidden>
      <ElementView element={el} />
    </svg>
  )
}

// A mini pitch showing where the formation lands and which way it attacks. Built in
// the canonical vertical 800×1200 schematic (GK at the bottom own goal); this is a
// topology cue, not the actual on-pitch orientation. Long side = 150px, neutral
// (currentColor) so it adapts to light/dark.
const DISC_R = 42
function FieldPreview({ code, kind, dir, spread }: { code: string; kind: FieldKind; dir: FormationDir; spread: Spread }) {
  const discs = formationFieldPoints(code, dir, spread)
  // Arrow along the field length: forward attacks toward y=0 (up), reverse down.
  const up = dir === 'forward'
  const tailY = up ? 760 : 440
  const headY = up ? 450 : 750
  const hy = up ? headY + 60 : headY - 60
  return (
    <svg width={100} height={150} viewBox="0 0 800 1200" className="text-foreground" aria-hidden>
      <path d={FIELD_PATH[kind]} fill="none" stroke="currentColor" strokeWidth={1.25} vectorEffect="non-scaling-stroke" opacity={0.45} />
      <g stroke="currentColor" fill="currentColor" strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" opacity={0.75}>
        <line x1={400} y1={tailY} x2={400} y2={headY} />
        <polygon points={`340,${hy} 400,${headY} 460,${hy}`} stroke="none" />
      </g>
      {discs.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={DISC_R} fill="currentColor" opacity={0.55} />
      ))}
    </svg>
  )
}

function Body({ code, cfg, onClose }: { code: string; cfg: SystemConfig; onClose: () => void }) {
  const elements = useEditorStore((s) => s.doc.elements)
  const field3d = useEditorStore((s) => s.doc.background.field3d)
  const tokenSizeM = useEditorStore((s) => s.tokenSizeM)
  const placeElements = useEditorStore((s) => s.placeElements)
  const dirs = directionOptions('vertical')
  const options = styleOptions(elements)
  const [dir, setDir] = useState<FormationDir>('forward')
  const [styleIdx, setStyleIdx] = useState(0)
  const [spread, setSpread] = useState<Spread>('half')

  function place() {
    if (!field3d) return // systems only appear on a 3D pitch, so this is set
    const style = options[Math.min(styleIdx, options.length - 1)]
    const grounds = formationGround(code, cfg.size, dir, spread)
    // Base tokens (any position); pinning relocates + perspective-sizes each to its
    // ground spot at the shared global token size.
    const base = grounds.map((_, i) => makeToken(crypto.randomUUID(), 0, 0, style, String(i + 1), TOKEN_SIZE))
    placeElements(pinTokensAtGround(base as Parameters<typeof pinTokensAtGround>[0], grounds, field3d, tokenSizeM))
    onClose()
  }

  return (
    <div className="grid gap-4">
      <DialogTitle className="text-base font-semibold">
        Game system <span className="text-primary">{code}</span>
      </DialogTitle>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Direction</span>
        <div className="flex flex-wrap gap-2">
          {dirs.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={dir === d.id}
              onClick={() => setDir(d.id)}
              className={cn('flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors', dir === d.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-accent')}
            >
              <FieldPreview code={code} kind={cfg.kind} dir={d.id} spread={spread} />
              <span className="text-[11px] text-muted-foreground">{d.label}</span>
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

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Coverage</span>
        <div className="flex gap-1 rounded-md bg-muted p-0.5">
          {(['half', 'whole'] as Spread[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={spread === s}
              onClick={() => setSpread(s)}
              className={cn('flex-1 rounded px-2 py-1.5 text-sm capitalize transition-colors', spread === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {s === 'half' ? 'Half pitch' : 'Whole pitch'}
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

/** Pick direction, team style and pitch coverage for a game system, then drop its
 *  tokens onto the 3D pitch. Open when `code` is set and the current field type
 *  supports systems (soccer-11 / futsal). */
export function GameSystemDialog({ code, onClose }: { code: string | null; onClose: () => void }) {
  const fieldType = useEditorStore((s) => s.doc.background.fieldType)
  const cfg = systemConfigForField(fieldType)
  return (
    <Dialog open={code != null && cfg != null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        {/* Keyed by code so choices reset for each formation. */}
        {code && cfg && <Body key={code} code={code} cfg={cfg} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

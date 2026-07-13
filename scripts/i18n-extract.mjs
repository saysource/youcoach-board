// i18n key extraction (natural English keys): collect every literal passed to
// t('…') in the designer sources, regenerate src/i18n/en.json as the identity
// map, and report it.json's missing/stale keys.
//
//   node scripts/i18n-extract.mjs           # rewrite en.json + report
//   node scripts/i18n-extract.mjs --check   # no writes; exit 1 on any gap
//
// DATA-DRIVEN labels (catalog.json names/labels, field-zone names, hotkey
// tables…) are translated at the render site via t(variable) — the extractor
// can't see those, so it ALSO harvests the known data sources below.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'packages/designer/src')

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(name) && !/-glb\.ts$/.test(name)) yield p
  }
}

const keys = new Set()

// 1. t('…') / t("…") literals in the sources (skips template literals — those
//    must use {{interpolation}} keys, which ARE plain literals).
const CALL = /\bt\(\s*(['"])((?:\\.|(?!\1).)+)\1/g
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(CALL)) keys.add(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'))
}

// 2. CATALOG labels are NOT app keys: the catalog carries its own `i18n`
//    block (language → { label → translation }), merged at load by
//    AssetsProvider — so host-served catalogs localize themselves. Here we
//    only VERIFY the bundled catalog's i18n block covers all its labels.
const catalog = JSON.parse(readFileSync(join(root, 'packages/designer/public/catalog.json'), 'utf8'))
const catLabels = new Set()
for (const g of catalog.groups ?? []) if (g.name) catLabels.add(g.name)
for (const cat of Object.values(catalog.categories ?? {})) {
  if (cat.name) catLabels.add(cat.name)
  for (const a of cat.facets?.action ?? []) if (a.label) catLabels.add(a.label)
  for (const f of cat.facets?.facing ?? []) if (f.label) catLabels.add(f.label)
  for (const fig of cat.figures ?? []) if (fig.label) catLabels.add(fig.label)
}
const catMissing = []
for (const [lng, bundle] of Object.entries(catalog.i18n ?? {})) {
  for (const l of catLabels) if (!(l in bundle)) catMissing.push(`${lng}: ${l}`)
}
if (!Object.keys(catalog.i18n ?? {}).length) catMissing.push('catalog has no i18n block')
//    label/name/title fields of in-code data tables (tool lists, hotkey
//    tables, zone/layout names …) — rendered through t(item.label) etc.
//    Filtered to English-looking labels (leading capital, no ALL_CAPS ids).
const LABELY = /^[A-Z][A-Za-z0-9 ()/+&'’.,%×–—-]*$/
const looksEnglish = (v) => LABELY.test(v) && v !== v.toUpperCase()
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/(?:label|name|title):\s*(['"])((?:\\.|(?!\1).)+)\1/g)) {
    const v = m[2]
    if (looksEnglish(v)) keys.add(v)
  }
}

const sorted = [...keys].sort((a, b) => a.localeCompare(b))
const en = Object.fromEntries(sorted.map((k) => [k, k]))

const enPath = join(SRC, 'i18n/en.json')
const itPath = join(SRC, 'i18n/it.json')
const it = JSON.parse(readFileSync(itPath, 'utf8'))
const missing = sorted.filter((k) => !(k in it))
const stale = Object.keys(it).filter((k) => !keys.has(k))

const check = process.argv.includes('--check')
if (!check) writeFileSync(enPath, JSON.stringify(en, null, 1) + '\n')

console.log(`${sorted.length} app keys (${check ? 'check only' : 'en.json rewritten'}); catalog i18n: ${catLabels.size} labels`)
if (missing.length) console.log(`it.json MISSING ${missing.length}:\n  ` + missing.join('\n  '))
if (stale.length) console.log(`it.json STALE ${stale.length}:\n  ` + stale.join('\n  '))
if (catMissing.length) console.log(`catalog i18n MISSING ${catMissing.length}:\n  ` + catMissing.join('\n  '))
if (check && (missing.length || stale.length || catMissing.length || JSON.stringify(en) !== JSON.stringify(JSON.parse(readFileSync(enPath, 'utf8'))))) process.exit(1)

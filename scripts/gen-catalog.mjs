// Generates packages/designer/public/catalog.json from the legacy yceditor data
// (palette categories + figures_groups gestures/directions + fields) and the
// SVGs copied under public/images/optimized. See specs/catalog.md.
//
// Usage (from repo root):
//   node scripts/gen-catalog.mjs [path-to-old/ycdrilleditor.palette.figures.js]
//
// The committed artifact is catalog.json; this script just regenerates it and
// needs the old repo present.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OLD =
  process.argv[2] ||
  '/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/yceditor/js/src/ycdrilleditor.palette.figures.js'
const IMG_BASE = 'images/optimized'
const IMG_DIR = resolve(ROOT, 'packages/designer/public', IMG_BASE)
const OUT = resolve(ROOT, 'packages/designer/public/catalog.json')

// ── Load the legacy data (the file is an IIFE assigning to YCEditor.prototype) ──
const src = readFileSync(OLD, 'utf8')
const YCEditor = function () {}
YCEditor.prototype = {}
const jQuery = function () {
  return {}
}
new Function('jQuery', 'YCEditor', src)(jQuery, YCEditor)
const { palette_categories, palette_fields, figures_groups } = YCEditor.prototype

// ── Config not encoded in the data file ──
const FLAT = {
  futsal: { prefix: '', max: 135 },
  coaches: { prefix: 'a', max: 26 },
  referees: { prefix: '', max: 28 },
  preparation: { prefix: '', max: 308 },
  preparation_female: { prefix: '', max: 15 },
  players_top: { prefix: '', max: 13 },
  discs: { prefix: '', max: 25 },
}
const GROUP_PREFIX = { goalkeepers: 'por', goalkeepers_female: 'por' }
const SKIP = new Set(['shapes']) // Arrows & Shapes are tools, not catalog figures
// Materials the old editor placed at 1/4 the normal base size (palette.js).
const SMALL_MATERIALS = new Set([10, 11, 12, 13, 14, 15, 16, 67, 68, 69, 70])
const MATERIAL_COLORS = new Set(['materials', 'discs'])
// Override the legacy category label (id stays 'discs').
const CATEGORY_LABEL = { discs: 'Text and Tokens' }

const ACTION_LABEL = {
  pass: 'Pass', kick: 'Kicking', run: 'Running', stand: 'Standing', throwin: 'Throw In',
  special: 'Special', dribbling: 'Dribbling', long_pass: 'Long Pass', goalkeeper: 'Goalkeeper',
  with_ball: 'With Ball', materials: 'Materials',
  'material.balls': 'Balls', 'material.bose': 'Bose', 'material.wall': 'Wall',
  'material.target': 'Target', 'material.goals': 'Goals', 'material.speedladder': 'Speed Ladders',
  'material.speedhurdle': 'Speed Hurdles', 'material.special': 'Special',
}
const FACING_LABEL = { left: 'Left', right: 'Right', up: 'Up', down: 'Down' }

const DEFAULTS = {
  players: {
    'yc-color-1': '#1971c2', 'yc-color-2': '#ffffff', 'yc-skin': '#e8b690', 'yc-hair': '#3b2a20',
    socks: '#1971c2', shoes: '#1f1f1f', v_stripe: '#ffffff', h_stripe: '#ffffff',
  },
  materials: { 'yc-color-1': '#e03131', 'yc-color-2': '#ffffff' },
}

// ── Helpers ──
let missing = 0
function sizeOf(rel) {
  const f = resolve(IMG_DIR, rel)
  if (!existsSync(f)) {
    missing++
    return null
  }
  const txt = readFileSync(f, 'utf8')
  const tag = txt.match(/<svg\b[^>]*>/i)?.[0]
  if (!tag) return null
  const vb = tag.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)/i)
  if (vb) return { w: Math.round(+vb[1]), h: Math.round(+vb[2]) }
  const w = tag.match(/\bwidth="([\d.]+)/i)
  const h = tag.match(/\bheight="([\d.]+)/i)
  return w && h ? { w: Math.round(+w[1]), h: Math.round(+h[1]) } : null
}
const exists = (rel) => existsSync(resolve(IMG_DIR, rel))

function groupedFigures(name) {
  const prefix = GROUP_PREFIX[name] || ''
  const byKey = new Map() // `${num}|${dir}` → { num, dir, actions:Set }
  const actionOrder = []
  for (const grp of figures_groups[name]) {
    for (const g of grp.gestures) {
      if (!g.figures?.length) continue
      if (!actionOrder.includes(g.gesture)) actionOrder.push(g.gesture)
      for (const num of g.figures) {
        const key = `${num}|${grp.direction}`
        if (!byKey.has(key)) byKey.set(key, { num, dir: grp.direction, actions: new Set() })
        byKey.get(key).actions.add(g.gesture)
      }
    }
  }
  const figures = []
  const facingSet = new Set()
  for (const { num, dir, actions } of byKey.values()) {
    const rel = `${name}/${prefix}${num}.svg`
    if (!exists(rel)) { missing++; continue }
    const size = sizeOf(rel) || { w: 100, h: 100 }
    const acts = [...actions]
    const svg = `${IMG_BASE}/${rel}`
    const base = `${IMG_BASE}/${name}/${prefix}${num}`
    // Legacy quirk (yceditor palette.js): these specific materials are placed at
    // a quarter of the normal figure base size.
    const small = name === 'materials' && SMALL_MATERIALS.has(num) ? { sizeFactor: 0.25 } : null
    if (dir === 'side') {
      figures.push({ svg, thumb: `${base}_mini.png`, w: size.w, h: size.h, actions: acts, facing: 'left', ...small })
      figures.push({ svg, thumb: `${base}r_mini.png`, w: size.w, h: size.h, actions: acts, facing: 'right', mirror: true, ...small })
      facingSet.add('left').add('right')
    } else if (dir === 'all') {
      figures.push({ svg, thumb: `${base}_mini.png`, w: size.w, h: size.h, actions: acts, ...small })
    } else {
      figures.push({ svg, thumb: `${base}_mini.png`, w: size.w, h: size.h, actions: acts, facing: dir, ...small })
      facingSet.add(dir)
    }
  }
  const facets = {}
  const actionFacet = actionOrder.map((a) => ({ id: a, label: ACTION_LABEL[a] || a }))
  if (actionFacet.length) facets.action = actionFacet
  const facingFacet = ['left', 'right', 'up', 'down'].filter((f) => facingSet.has(f)).map((f) => ({ id: f, label: FACING_LABEL[f] }))
  if (facingFacet.length) facets.facing = facingFacet
  return { figures, facets }
}

function flatFigures(name) {
  const { prefix, max } = FLAT[name]
  const figures = []
  // The Tokens (discs) category leads with the app-managed Text element: a
  // thumbnail only (text/0_mini.png), no SVG — the app creates the element.
  if (name === 'discs') {
    figures.push({ thumb: `${IMG_BASE}/text/0_mini.png`, w: 120, h: 48, tool: 'text' })
  }
  for (let i = 1; i <= max; i++) {
    const rel = `${name}/${prefix}${i}.svg`
    if (!exists(rel)) { missing++; continue }
    const size = sizeOf(rel) || { w: 100, h: 100 }
    figures.push({ svg: `${IMG_BASE}/${rel}`, thumb: `${IMG_BASE}/${name}/${prefix}${i}_mini.png`, w: size.w, h: size.h })
  }
  return { figures }
}

// Top-view pitches (per field type) — drawn from above, suitable for Tokens.
// Everything else in the type is a perspective (angled) view.
const FIELD_TOPVIEW = { '11': new Set([17, 18, 19, 21]) }

function fieldFigures(name) {
  const type = name.slice('fields_'.length) // '11' | 'futsal'
  const topview = FIELD_TOPVIEW[type]
  const figures = (palette_fields[type] || []).map((fd) => {
    const rel = `fields/${type}/${fd.index}.svg`
    const size = sizeOf(rel) || { w: 100, h: 100 }
    const f = { svg: `${IMG_BASE}/${rel}`, thumb: `${IMG_BASE}/fields/${type}/${fd.index}_mini.png`, w: size.w, h: size.h, scale: fd.scale }
    if (fd.color) f.color = fd.color
    if (topview) f.actions = [topview.has(fd.index) ? 'fields.topview' : 'fields.perspective']
    return f
  })
  const result = { figures }
  if (topview) {
    result.facets = { action: [
      { id: 'fields.perspective', label: 'Perspective' },
      { id: 'fields.topview', label: 'Top View' },
    ] }
  }
  return result
}

// ── Build ──
const groupSlug = { Players: 'players', Materials: 'materials', Fields: 'fields' }
const groupName = { players: 'Players', materials: 'Materials', fields: 'Fields and Background' }
const groups = []
const categories = {}

for (const macro of palette_categories) {
  const gid = groupSlug[macro.label] || macro.label.toLowerCase()
  const ids = []
  for (const opt of macro.options) {
    const name = opt.name
    if (SKIP.has(name)) continue
    const label = CATEGORY_LABEL[name] ?? opt.label
    let cat
    if (name.startsWith('fields_')) cat = { name: label, kind: 'field', ...fieldFigures(name) }
    else if (figures_groups[name]) cat = { name: label, kind: 'figure', colors: MATERIAL_COLORS.has(name) ? 'materials' : 'players', ...groupedFigures(name) }
    else if (FLAT[name]) cat = { name: label, kind: 'figure', colors: MATERIAL_COLORS.has(name) ? 'materials' : 'players', ...flatFigures(name) }
    else { console.warn('skip unknown category', name); continue }
    categories[name] = cat
    ids.push(name)
  }
  groups.push({ id: gid, name: groupName[gid] || macro.label, categories: ids })
}

// Virtual "All Fields" category: Field 11 + Futsal combined, as action sections,
// so a background can be picked without switching category. The two stay as
// independent categories too. Listed first in the Fields group.
const f11 = categories['fields_11']
const ffut = categories['fields_futsal']
if (f11 && ffut) {
  // Top-view field-11 pitches get their own section here too; the rest of
  // field 11 stays under "Field 11", and Futsal is its own section.
  const isTopview = (f) => (f.actions ?? []).includes('fields.topview')
  categories['fields_all'] = {
    name: 'All Fields',
    kind: 'field',
    facets: { action: [
      { id: 'field-11', label: 'Field 11' },
      { id: 'fields.topview', label: 'Top View' },
      { id: 'futsal', label: 'Futsal' },
    ] },
    figures: [
      ...f11.figures.map((f) => ({ ...f, actions: isTopview(f) ? ['fields.topview'] : ['field-11'] })),
      ...ffut.figures.map((f) => ({ ...f, actions: ['futsal'] })),
    ],
  }
  const fg = groups.find((g) => g.id === 'fields')
  if (fg) fg.categories.unshift('fields_all')
}

const catalog = { version: 1, imageBase: IMG_BASE, defaults: DEFAULTS, groups, categories }
writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n')

const total = Object.values(categories).reduce((n, c) => n + c.figures.length, 0)
console.log('wrote', OUT)
console.log('groups:', groups.map((g) => `${g.id}(${g.categories.length})`).join(' '))
for (const [id, c] of Object.entries(categories)) {
  console.log(`  ${id}: ${c.figures.length} figures`, c.facets ? `facets=${Object.keys(c.facets).map((k) => `${k}[${c.facets[k].length}]`).join(',')}` : '')
}
console.log('total figures:', total, '| missing svgs skipped:', missing)

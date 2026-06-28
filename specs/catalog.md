# Figure catalog & asset loading

How the board loads pre-built figures (players, materials, fields) from a backend
while staying **backend-free**: the board never knows a specific server — the
host (embedding page / App2 / Drupal viewer / standalone) provides where assets
live, and the board resolves them through that.

## 1. Assets are host-provided

`BoardDesigner` / `BoardViewer` take an optional `assets` config (a designer/
viewer concern — `core` stays pure, no I/O):

```ts
assets?: {
  /** Simple form: the figure's path is substituted into the template.
   *  e.g. "https://local.youcoach.it/svgs/__path__/?token=12345" */
  urlTemplate?: string
  /** Escape hatch: the host fully owns resolution/auth (headers, signing, blobs).
   *  Takes precedence over urlTemplate. */
  resolve?: (path: string) => string | Promise<string | Blob>
  /** Where the catalog comes from — a path resolved like any other asset, or an
   *  absolute URL (lets the backend generate it on the fly, with i18n later). */
  catalog?: string
}
```

Internally everything goes through one `resolveAsset(path)`. `urlTemplate` covers
the token-in-URL case; `resolve` lets a host do header-based or signed auth.

### Security notes
- Token-in-query works but leaks via logs/`Referer` — prefer **short-lived /
  signed** tokens and a strict `Referrer-Policy`. The `resolve` function avoids
  query tokens entirely (header auth).
- The backend must send **CORS** allowing the embedding origins (we fetch SVG
  **text**, not just `<img>`).
- SVGs are untrusted → **sanitize** before injecting into the DOM.

## 2. Two layers: catalog + assets

- **`catalog.json`** — fetched once (static file *or* dynamic URL). Describes
  categories, their figures, color slots and the facets used to build the palette
  filters. Small; safe to load up front.
- **Thumbnails (PNG)** — one tiny PNG per figure (~14 MB for the whole set), used
  in the palette. Only the open category's thumbs need loading. Thumbnails are
  **not** recolored — they're previews.
- **SVGs** — the full set is large (~64 MB), so they are **never** all loaded.
  An SVG is fetched **on demand** (when a figure is placed, optionally prefetched
  per category), then sanitized, cached, and recolored.

## 3. Recoloring

Every SVG is made of `<path>`s; the recolorable ones carry a known class. Colors
are applied **per placed instance** by injecting a scoped `<style>` into the
figure's group (e.g. `#fig-<id> .yc-skin { fill: … }`), so the same cached SVG
renders with different colors per instance and survives serialize/export.

**Player slots:** `yc-hair`, `yc-skin`, `base_tshirt`, `shorts`, `socks`,
`v_stripe`, `h_stripe`.
**Material slots:** `yc-color-1`, `yc-color-2`.

A figure typically uses a subset of its category's slots; the properties panel
shows only the relevant color controls (from the category/figure `slots`).

**Color resolution order** (first defined wins):
instance override → figure default → category `defaults` (in the catalog).

A future "team kit" is just a saved set of slot colors applied to many figures —
no schema change needed.

## 4. Catalog schema

Single catalog. Categories match the drawer's categories; **facets** model the
extra dimensions within a category (players: action + facing; materials: type)
and tell the palette which secondary filters to render.

```jsonc
{
  "version": 1,

  // Default color per slot, per macro-group. Used when nothing overrides.
  "defaults": {
    "players":   { "yc-skin":"#e8b690","yc-hair":"#3b2a20","base_tshirt":"#1971c2",
                   "shorts":"#ffffff","socks":"#1971c2","v_stripe":"#ffffff","h_stripe":"#ffffff" },
    "materials": { "yc-color-1":"#e03131","yc-color-2":"#ffffff" }
  },

  // Secondary filter dimensions. Values carry stable slugs; labels are i18n-ready.
  "facets": {
    "action":  { "label":"Action",
                 "values":["pass","kicking","running","standing","throw-in","special","dribbling"] },
    "facing":  { "label":"Facing", "values":["left","up","down","right"] },
    "material":{ "label":"Type",
                 "values":["balls","materials","bose","wall","target","goals","speed-ladders","speed-hurdles"] }
  },

  "categories": [
    {
      "id": "players-male", "group": "Players", "name": "Players (Male)",
      "facets": ["action","facing"],        // which filters this category shows
      "slots":  ["yc-skin","yc-hair","base_tshirt","shorts","socks","v_stripe","h_stripe"],
      "figures": [
        {
          "id": "pl-m-running-left",         // STABLE id → stored in saved docs
          "name": "Running",
          "facetValues": { "action":"running", "facing":"left" },
          "svg":  "players/male/running-left.svg",
          "thumb":"players/male/running-left.png",
          "width": 120, "height": 200        // intrinsic size → place + size placeholder before SVG loads
        },
        {
          "id": "pl-m-running-right",
          "name": "Running",
          "facetValues": { "action":"running", "facing":"right" },
          "mirrorOf": "pl-m-running-left",    // right = left flipped horizontally (no extra asset)
          "thumb": "players/male/running-right.png", // optional; omit → flip the left thumb
          "width": 120, "height": 200
        }
      ]
    },

    {
      "id": "materials", "group": "Materials", "name": "Materials",
      "facets": ["material"],
      "slots":  ["yc-color-1","yc-color-2"],
      "figures": [
        { "id":"ball-01", "name":"Ball", "facetValues":{ "material":"balls" },
          "svg":"materials/ball-01.svg", "thumb":"materials/ball-01.png", "width":40, "height":40 }
      ]
    }
  ]
}
```

### Field notes
- **`id`** — stable and decoupled from path, so figures can be re-pathed/renamed
  without breaking saved boards.
- **`width`/`height`** — intrinsic size; lets us place at the right size and show
  the thumbnail/placeholder **before** the SVG arrives.
- **`facetValues`** — this figure's value on each of the category's facets; the
  palette builds filter controls from `facets` and filters the grid by them.
- **`mirrorOf`** — for artificial right-facing figures: reuse the referenced
  figure's SVG, rendered horizontally mirrored (apply `scaleX(-1)` about center).
  Saves ~half the player assets. Recolor still works (same SVG). `thumb` may be
  omitted and the palette flips the source thumb.
- **`slots`** — category-level recolor slots; a figure may override with its own
  subset if its SVG doesn't contain them all.
- Names are plain strings now; when **i18n** lands they become keys (or the
  dynamic catalog returns localized strings) — no structural change.

## 5. Figure element model (core)

A placed figure is a new `core` element type — a **reference** plus colors and
facing, never the SVG blob:

```ts
interface FigureElement extends BaseElement {
  type: 'figure'
  figureId: string                 // catalog id
  width: number; height: number    // intrinsic (from catalog), for bounds/placement
  colors?: Record<string, string>  // slot → color overrides
  mirror?: boolean                 // resolved right-facing (or derived from catalog)
  // transform (x/y/rotate/scale/opacity) as every element
}
```

`core` renders a **placeholder** (box at the figure's size) — the real SVG
injection/recolor lives in the designer/viewer (I/O). `getLocalBounds` uses
`width`/`height`; move/resize/rotate/group all work via the shared transform.

## 6. Palette & placement

- The drawer's category button (already built) selects a **category**; below it
  the palette shows that category's **thumbnail grid**, with secondary filter
  controls generated from the category's `facets` (e.g. an Action selector + a
  Facing toggle for players; a Type selector for materials).
- **Click a thumbnail → drop** the figure (centered on the board, at its intrinsic
  size, with default colors). Drag-from-palette comes later.

## 7. Implementation order

1. This spec.
2. `core`: `FigureElement` type + parse/serialize + placeholder render.
3. `designer`/`viewer`: `assets` config + `resolveAsset`; catalog loader; SVG
   fetch → sanitize → cache → recolor; figure render with placeholder-until-loaded
   (+ mirror).
4. Palette: thumbnail grid + facet filters; click-to-drop.
5. Properties panel: per-slot color controls driven by the figure's `slots`.
6. Standalone dev: a small **local fixture** set (a few SVGs + thumbs +
   `catalog.json`) so we can build/verify without the real backend.

# youcoach-board

An embeddable, **backend-free** React tactics/drill designer for the YouCoach family.
This is the early skeleton: it proves the *embedding architecture* with a trivial
one-field document (`{ "title": "…" }`) before any real board concepts land.

## Workspace

Yarn (classic) workspace of three packages:

| Package | Role |
| --- | --- |
| `@youcoach-board/core` | Document model (`parseBoard` / `serializeBoard`) + the single shared render primitive `BoardCanvas`. |
| `@youcoach-board/viewer` | Read-only `BoardViewer` — renders a document through the core primitive. |
| `@youcoach-board/designer` | `BoardDesigner` — edit the title, **Load** / **Save** the JSON. Also runs standalone. |

React / React-DOM are **peer** dependencies and are kept **external** in every library
build, so a host app always supplies the single React instance (never two).

### UI language (i18n)

The designer ships English + Italian catalogs (i18next, embedded JSON — no fetch).
Pick the language with the `language` prop (`<BoardDesigner language="it" />`) or,
when the prop is omitted, with the page URL's `?lang=it` parameter; anything
unsupported falls back to English. Locale forms like `it-IT` resolve to `it`.
`yarn i18n` checks the catalogs against the sources (`scripts/i18n-extract.mjs`
regenerates `en.json` and reports missing/stale Italian keys).

## Commands

```bash
yarn install        # one install for the whole workspace
yarn build          # build core → viewer → designer (each emits dist/ + .d.ts)
yarn dev            # run the designer standalone (the "tool outside App2" proof)
yarn typecheck      # tsc across the workspace
```

## Consuming it from another app (e.g. YouCoach App 2)

**Primary — `file:` dependency on the built package** (mirrors real npm usage):

```jsonc
// app/package.json
"dependencies": {
  "@youcoach-board/viewer": "file:../../youcoach-board/packages/viewer",
  "@youcoach-board/designer": "file:../../youcoach-board/packages/designer"
}
```

Run `yarn build` here first, then `yarn install` in the host. Because React is external,
the host's React renders the components.

**Faster live-dev alternative — Vite alias to source** (no rebuild loop): point the host's
`vite.config` `resolve.alias` and `tsconfig` `paths` for `@youcoach-board/*` at each
package's `src` entry. Use this while iterating; the `file:` path is what proves the built
artifact.

## Adding a 3D object ("material")

The placeable 3D props (cones, hurdles, mannequins, goals…) are glTF models
**embedded as base64** so they ship inside the bundle (no runtime fetch → embed-safe).
To add a new one, e.g. `agility_ring`:

1. **Model it** at **real metric scale** (1 Blender unit = 1 m), with the **origin at
   the base, on the ground** (lowest geometry at Z=0 → Y=0 in glTF), and **apply all
   transforms**. Export to **`assets/objects/agility_ring.glb`**.

2. **Register the file** for bundling — add one row to `MODELS` in
   [`scripts/bundle-glbs.mjs`](scripts/bundle-glbs.mjs):

   ```js
   ['agility_ring.glb', 'agility_ring.glb', 'AGILITY_RING_GLB_BASE64', 'agility-ring-glb.ts'],
   ```

   then run **`yarn glb`** — it copies the model into the package and generates the
   base64 module `packages/designer/src/lib/agility-ring-glb.ts`.

3. **Declare it** in [`packages/designer/src/lib/objects3d.ts`](packages/designer/src/lib/objects3d.ts):
   - `import { AGILITY_RING_GLB_BASE64 } from './agility-ring-glb'`
   - add a row to `GLB_OBJECTS`: `agility_ring: { data: AGILITY_RING_GLB_BASE64, color: 0xf2c200 }` (the toon colour)
   - add `'agility_ring'` to `KNOWN_OBJECTS`
   - *(optional)* add it to `ROTATION_SYMMETRIC` if a Y-spin is invisible (ball/cone-like)

4. **Draw a thumbnail** — a 64×64 SVG at
   **`packages/designer/src/assets/materials3d/agility_ring.svg`**.

5. **List it in the palette** — add an entry under `materials3d.figures` in
   [`packages/designer/public/catalog.json`](packages/designer/public/catalog.json):

   ```json
   { "object3d": "agility_ring", "thumb": "materials3d/agility_ring", "w": 100, "h": 100 }
   ```

That's it — `yarn dev`, open the **3D Materials** drawer, and drag it onto the pitch.
The model renders at its real size (users can scale all objects 1×–8× via the
background options); the black toon outline and ground placement are automatic.

**Re-exporting an existing model:** just replace its `.glb` in `assets/objects/`
(same filename) and run **`yarn glb`** — no code changes.

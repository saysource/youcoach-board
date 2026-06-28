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

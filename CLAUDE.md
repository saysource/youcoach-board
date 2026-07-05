# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YouCoach Board — an embeddable, **backend-free** React tactics/drill designer for soccer (and eventually other sports). It loads/saves drawings as JSON and must run in four modes: standalone tool, embedded React component (inside YouCoach App 2 and YouCoach Video Analysis), and a plain-JS viewer/player on the Drupal website.

The current repo is the **early skeleton**: it deliberately proves the *embedding architecture* end-to-end with a trivial one-field document (`{ "title": "…" }`) before any real board concepts (elements, keyframes, fields, animation) land. Do not assume the rich feature set in `specs/start.md` exists yet — that file is the forward-looking design spec, not a description of the current code.

## Commands

```bash
yarn install        # one install for the whole workspace (yarn classic 1.x)
yarn build          # build core → viewer → designer, in that order; each emits dist/ + rolled-up .d.ts
yarn dev            # run the designer standalone (the "tool outside App2" proof) via Vite
yarn typecheck      # tsc --build across the workspace
yarn lint           # eslint . across the workspace
yarn clean          # remove all dist/ and *.tsbuildinfo

# single package
yarn workspace @youcoach-board/core build
yarn workspace @youcoach-board/designer dev
```

No test runner yet. The gates are `yarn typecheck` and `yarn lint`. `tsconfig.base.json` is strict with `noUnusedLocals`/`noUnusedParameters`/`verbatimModuleSyntax`. ESLint uses the same base flat-config stack as YouCoach App 2's client (js recommended + typescript-eslint + react-hooks + react-refresh); App 2's `eslint-plugin-boundaries` layer is intentionally omitted since this workspace has no core/verticals seams to enforce.

## Architecture

Three packages in a yarn workspace; everything flows through `core`:

- **`@youcoach-board/core`** — the only package with no React UI of its own. Holds the `BoardDoc` document model (`parseBoard`/`serializeBoard` in [model.ts](packages/core/src/model.ts), framework-free pure data) plus `BoardCanvas`, the **single shared render primitive** ([BoardCanvas.tsx](packages/core/src/BoardCanvas.tsx)). Both viewer and designer render the document *through* `BoardCanvas`, so drawing logic lives in exactly one place.
- **`@youcoach-board/viewer`** — read-only `BoardViewer`. No local state, no editing affordances; just wraps the core primitive.
- **`@youcoach-board/designer`** — `BoardDesigner` (edit title, Load/Save JSON round-trip) using plain `useState`. Also has a standalone dev harness ([main.tsx](packages/designer/src/main.tsx)) served by `yarn dev`.

### Invariants to preserve

- **React is always external.** It's a `peerDependency` (`>=18`) in every package and `external` in every Vite lib build (`react`, `react-dom`, `react/jsx-runtime`, and `@youcoach-board/core` for downstream packages). The host app must supply the single React instance — never bundle React into a library (two React copies break hooks).
- **`core` model code stays framework-free** (no React, no I/O) so it can run in a browser, Node, or the future vanilla-JS Drupal viewer. `parseBoard` is intentionally defensive: malformed/untrusted JSON degrades to an empty doc rather than throwing.
- **`BoardCanvas` styles are inline and self-contained** so it renders identically with no host CSS (App2's Tailwind, a bare HTML page, …). The current `<svg>` foreshadows the real tactics board.
- New render behavior belongs in `core` `BoardCanvas`, not duplicated in viewer/designer.

### Consuming from a host app

Primary (mirrors real npm): `file:` dependency on the built package — run `yarn build` here, then `yarn install` in the host. Faster live-dev: point the host's Vite `resolve.alias` + tsconfig `paths` for `@youcoach-board/*` at each package's `src`. See [README.md](README.md) for the exact snippets.

## Reference points for the planned rewrite

`specs/start.md` is the design spec. The planned stack is React + shadcn + Motion + Zustand + Tailwind + Lucide icons. Key external references it cites:

- Old jQuery app being rewritten: `/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/yceditor` (e.g. palette structure in `js/src/ycdrilleditor.palette.figures.js`).
- Effects + 3D Arrow to borrow from YouCoach Video Analysis: `/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/presentation/canvas/Layer3D.tsx` and `.../figures/effects`.
- Tailwind dark/light customizations to copy from `/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client`.
- Design north star: Excalidraw's minimalism (floating toolbars, on-demand drawer). Drawable area is a fixed ratio (canvas vs. SVG choice still open).

## Regenerating field-zone thumbnails (drawer previews)

The fields drawer shows a PNG per zone, bundled from `packages/designer/src/assets/zones/<zone-id>.png` (glob'd by id in [LibraryDrawer.tsx](packages/designer/src/components/LibraryDrawer.tsx); training ids are `training-<layout>-<top|persp>`). Thumbnails are **340×255 (4:3)**, captured from the live app (grass texture + WebGL lines/goals composited) via headless-Chrome CDP (see [[verify-with-cdp]]), then downscaled with `sips -z 255 340`.

Settled capture settings:

- **Stroke: render field lines at 4× width.** At 340px (and the ~115px in-drawer size) the real line width nearly vanishes, so multiply it for thumbnails. The scene thins lines by camera distance in [FieldSceneLayer.tsx](packages/designer/src/components/FieldSceneLayer.tsx) (`w = lineWidthForDistance(dist)`); temporarily change it to `* ((globalThis).__lineMul ?? 1)` and set `window.__lineMul = 4` before capturing. Revert after.
- **Poses** (from [field-zones.ts](packages/designer/src/lib/field-zones.ts)): top = `position [52.5,38,34]`, persp = `position [52.5,32,4]`, both `target [52.5,0,34]`, fov 50.
- **Capture region** = the board `<canvas>` rect (4:3, e.g. `120,40,1093,820` — read it live, don't hardcode). Hide floating chrome first (toolbar/menu/zoom/drawer) so only the board is captured.
- **Driving state:** temporarily expose the store (`(window).__store = store` in [EditorStoreProvider.tsx](packages/designer/src/store/EditorStoreProvider.tsx)) and call `__store.getState().setBackground({ fieldType:'training', trainingLayout, showGoals, field3d:{ ref:'soccer11', position, target, fov:50 } })` per zone. Nudge the pose by a hair each iteration to force a re-render (`render()` is on-demand, not a rAF loop).

Both `window.__store` and the `__lineMul` multiplier are **temporary dev hooks — always revert them before committing.**

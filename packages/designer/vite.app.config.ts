import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { scopeToRoot } from './vite.config'

// Standalone **app** build (distinct from the library build in vite.config.ts).
// This emits a self-contained page — React + @youcoach-board/core bundled in, no
// host required — for the Drupal `youcoach_board` module to serve from
// `<module>/build/`. See specs/drupal_backend.md.
//
//   yarn workspace @youcoach-board/designer build:app  →  packages/designer/build/
//
// The entry is the same index.html → src/main.tsx used by `yarn dev`; main.tsx
// reads an optional `window.__YCB_SETTINGS__` global (injected by Drupal) to point
// asset loading at the /youcoach-board/resource proxy. The library build is
// untouched (still `yarn build`).
export default defineConfig({
  // Relative asset URLs so the app works from any subpath (e.g. /youcoach-board/
  // build/) and its code-split chunks resolve against the entry's own location.
  base: './',
  plugins: [
    tailwindcss(),
    // Scope the compiled Tailwind to `.ycb-root` (main.tsx tags the mount element)
    // so the board's CSS can't collide with Drupal's own theme styles.
    scopeToRoot(),
    react(),
  ],
  build: {
    outDir: 'build',
    emptyOutDir: true,
    // Emit build/.vite/manifest.json so the Drupal module can resolve the hashed
    // entry JS/CSS filenames (the tpl injects them by reading the manifest).
    manifest: true,
    // React + core are bundled here (unlike the library build, which externalizes
    // them for a host to supply): a standalone page has no host.
    sourcemap: false,
  },
})

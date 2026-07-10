import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import postcss, { type AtRule } from 'postcss'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'

// Scope one selector to our embed root: match the `.ycb-root` element itself
// (self form) AND its descendants. Prepending (never appending) keeps pseudo-
// elements valid; the extra `.ycb-root` also raises specificity so the board's
// utilities outrank a host app's same-named ones. Blocks already scoped to
// `.ycb-root` are left alone; `:root`/`:host` collapse onto the root.
function scopeSelector(sel: string): string {
  const s = sel.trim()
  if (!s || s.startsWith('.ycb-root')) return sel
  if (s === ':root' || s === ':host' || s === 'html' || s === 'body') return '.ycb-root'
  const descendant = `.ycb-root ${s}`
  const self = /^[.#:[]/.test(s) ? `.ycb-root${s}` : null // attachable leading token → also match the root itself
  return self ? `${descendant}, ${self}` : descendant
}

// Rewrite the (Tailwind-compiled) stylesheet so every rule is scoped to
// `.ycb-root`, so the designer's Tailwind can't collide with a host app's
// Tailwind (same class names, differing configs). Markup is untouched.
function scopeCss(css: string): string {
  const root = postcss.parse(css)
  root.walkRules((rule) => {
    // Skip @keyframes step selectors (0%/from/to — not element selectors).
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as AtRule).name)) return
    rule.selector = rule.selectors.map(scopeSelector).join(', ')
  })
  return root.toString()
}

function scopeToRoot(): Plugin {
  return {
    name: 'ycb-scope-css',
    enforce: 'post',
    // @tailwindcss/vite expands utilities into the emitted CSS asset (after the
    // transform phase), so rewrite the final bundle asset. Build-only — the
    // standalone dev app needs no scoping (no host to collide with).
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css') && typeof file.source === 'string') {
          file.source = scopeCss(file.source)
        }
      }
    },
  }
}

// One config serves two roles:
//   - `vite` (dev)   → serves index.html, mounting <BoardDesigner/> standalone.
//                      This is the "independent tool outside App2" proof.
//   - `vite build`   → library build of src/index.tsx (React + core external),
//                      the artifact App2 embeds. The Tailwind-compiled CSS is
//                      emitted as a separate asset in dist/ (see the package's
//                      "./styles.css" export) for hosts to import once.
export default defineConfig({
  plugins: [
    tailwindcss(),
    scopeToRoot(),
    react(),
    // No `include` filter: rollupTypes needs the whole `src` in the dts program
    // so it can follow src/index.tsx's imports and flatten the full prop types
    // (e.g. BoardDesignerProps) into a single self-contained dist/index.d.ts.
    // Restricting include to index.tsx left a dangling `import './BoardDesigner'`.
    dts({ rollupTypes: true, tsconfigPath: './tsconfig.json' }),
  ],
  // Dev only: listen on all interfaces so phones/tablets on the same Wi-Fi can
  // open the standalone tool at http://<this-machine-LAN-IP>:5173. (The `server`
  // block is ignored by `vite build`.)
  server: {
    host: true,
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      formats: ['es'],
      fileName: () => 'index.js',
      cssFileName: 'styles',
    },
    rollupOptions: {
      // React is supplied by the host (single instance). Core is external too so
      // its types stay resolvable in the published .d.ts — a consuming app
      // installs @youcoach-board/core alongside this package (both via file: or,
      // later, npm). All other UI deps (radix, lucide, zustand, …) are bundled.
      external: ['react', 'react-dom', 'react/jsx-runtime', '@youcoach-board/core'],
    },
    sourcemap: true,
  },
})

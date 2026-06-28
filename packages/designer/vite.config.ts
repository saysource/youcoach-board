import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'

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
    react(),
    // No `include` filter: rollupTypes needs the whole `src` in the dts program
    // so it can follow src/index.tsx's imports and flatten the full prop types
    // (e.g. BoardDesignerProps) into a single self-contained dist/index.d.ts.
    // Restricting include to index.tsx left a dangling `import './BoardDesigner'`.
    dts({ rollupTypes: true, tsconfigPath: './tsconfig.json' }),
  ],
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

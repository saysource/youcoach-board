import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Same base lint stack as YouCoach App 2's client (js recommended +
// typescript-eslint + react-hooks + react-refresh). App 2's extra
// eslint-plugin-boundaries layer is omitted: it enforces App 2's
// core/verticals seams, which this workspace doesn't have.
export default defineConfig([
  // Build artifacts — not linted.
  globalIgnores(['**/dist', '**/*.tsbuildinfo']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // shadcn UI primitives deliberately co-export variants/sub-components and
    // helpers next to the component (same exemption App 2 uses for its ui/*).
    files: ['packages/*/src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Build/dev tooling runs in Node, not the browser.
    files: ['**/vite.config.ts', '**/*.config.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
])

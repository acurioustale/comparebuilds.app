/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  test: {
    // Pure-logic suites run in Node. Component/store DOM tests (a later phase)
    // will opt into jsdom per-file via a `// @vitest-environment jsdom` pragma.
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Baseline scope: the layers we can exercise without a DOM. `all: true`
      // reports untested files (e.g. the store) at their true low numbers rather
      // than hiding them. Components/api join once jsdom is set up.
      all: true,
      include: ['src/lib/**/*.js', 'src/store/**/*.js'],
      exclude: ['**/*.test.js', '**/wireLayout.snapshot.json'],
    },
  },
})

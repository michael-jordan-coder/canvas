import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // One run covers the whole workspace. Vite resolves the @canvas/* imports through
    // the pnpm links, so the tests import the packages exactly as the app does rather than
    // through a build step.
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
})

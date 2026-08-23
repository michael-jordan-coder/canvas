import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { componentLibrary } from './apps/editor/vite-plugins/componentLibrary.js'

export default defineConfig({
  // The editor's registry is generated from the component sources, so the tests have to be
  // able to resolve the same virtual module the app does. Running the real plugin rather than
  // stubbing it means a test that reads a prop is reading it out of the real component.
  plugins: [
    componentLibrary({
      dir: fileURLToPath(new URL('./apps/editor/src/components/library', import.meta.url)),
      root: fileURLToPath(new URL('./apps/editor/src', import.meta.url)),
    }),
  ],
  test: {
    // One run covers the whole workspace. Vite resolves the @figma-canvas/* imports through
    // the pnpm links, so the tests import the packages exactly as the app does rather than
    // through a build step.
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      // The dev-time plugins that read the component library off disk. They are Node code
      // rather than app code, so they live beside the config that loads them rather than in
      // src, and they still have to be covered: the properties panel is generated from what
      // they extract.
      'apps/*/vite-plugins/**/*.test.ts',
    ],
  },
})

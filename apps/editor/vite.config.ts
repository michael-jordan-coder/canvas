import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { componentLibrary } from './vite-plugins/componentLibrary.js'
import { componentSource } from './vite-plugins/sourceEndpoint.js'

const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    // Reads the component library off disk and serves it as `virtual:component-library`, so
    // the properties panel is generated from the components' own types rather than from a
    // list kept beside them.
    componentLibrary({
      dir: fileURLToPath(new URL('./src/components/library', import.meta.url)),
      root: src,
    }),
    // Lets the editor read a component's own source. Dev only, by being its own plugin: see
    // the note on `componentSource`.
    componentSource({
      dir: fileURLToPath(new URL('./src/components/library', import.meta.url)),
    }),
  ],
  server: {
    // 5173 on purpose. The other repos in this folder fight over 3000.
    port: 5173,
    strictPort: true,
  },
})

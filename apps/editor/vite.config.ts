import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 on purpose. The other repos in this folder fight over 3000.
    port: 5173,
    strictPort: true,
  },
})

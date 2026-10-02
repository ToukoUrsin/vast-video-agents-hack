import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: false,
    // our server proxy (VastDB, Cosmos, W&B); override with API_URL=http://host:port
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:8787' },
  },
})

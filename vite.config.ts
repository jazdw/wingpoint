import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    // Bind to all interfaces so the dev server is reachable from a phone on
    // the same network (Vite prints a "Network" URL). Dev only.
    host: true,
    allowedHosts: true,
  },
})

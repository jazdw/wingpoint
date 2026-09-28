import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Bind address for the dev server.
  //  - default: localhost only
  //  - set DEV_HOST (in `.env.local` or the environment) to a LAN IP such as
  //    192.168.1.182, or to 0.0.0.0 for all interfaces, to test from another
  //    device such as your phone.
  const env = loadEnv(mode, process.cwd(), '')
  const devHost = (process.env.DEV_HOST || env.DEV_HOST || 'localhost').trim()

  return {
    plugins: [react(), cloudflare()],
    server: {
      host: devHost,
      // Vite's host check: only relevant when binding beyond localhost.
      allowedHosts: devHost === 'localhost' ? undefined : true,
    },
  }
})

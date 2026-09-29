import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { cloudflare } from "@cloudflare/vite-plugin";

/** Runtime cache for game data; keep in sync with src/auth.tsx. */
const API_CACHE = 'wp-api'

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
    plugins: [
      react(),
      cloudflare(),
      // Offline support: precache the whole app shell at install time so the
      // installed app opens offline from the first launch.
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false, // registered in src/main.tsx
        manifest: false, // public/manifest.webmanifest is used as-is
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
          navigateFallback: '/index.html',
          // OAuth and API calls must always reach the Worker.
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Game data, so games you've opened can be viewed offline.
              // Cleared on sign-out (see src/auth.tsx).
              urlPattern: ({ url, request }) =>
                request.method === 'GET' &&
                (url.pathname === '/api/games' || /^\/api\/games\/[^/]+$/.test(url.pathname)),
              handler: 'NetworkFirst',
              options: {
                cacheName: API_CACHE,
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 100 },
              },
            },
          ],
        },
      }),
    ],
    server: {
      host: devHost,
      // Vite's host check: only relevant when binding beyond localhost.
      allowedHosts: devHost === 'localhost' ? undefined : true,
    },
  }
})

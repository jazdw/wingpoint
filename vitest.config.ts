import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts so tests don't start the Cloudflare
// Worker runtime or the PWA plugin.
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts'],
    environment: 'node',
  },
})

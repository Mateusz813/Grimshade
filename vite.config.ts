/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // 2026-05-21: expose `package.json` version as a global constant so
  // UI code can `import { APP_VERSION }` from a typed module without
  // dragging package.json into the TS include / rootDir tree. See
  // `src/lib/appVersion.ts` for the typed shim.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5170,
    strictPort: true,
  },
  preview: {
    port: 5170,
    strictPort: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 2026-05-20: bundle the brand icon set so the install prompt +
      // home-screen tile pick up the new artwork from /public/.
      includeAssets: ['apple-touch-icon.png', 'pwa.png', 'favicon.svg'],
      manifest: {
        name: 'Grimshade',
        short_name: 'Grimshade',
        description: 'Browser RPG game',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-cache' },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});

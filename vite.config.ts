/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // CI sets BASE_PATH to `/<repo name>/` for GitHub Pages; locally the app is served from `/`.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      // The new worker waits until the user taps "Reload" on the update banner.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'MyFinance',
        short_name: 'MyFinance',
        description: 'Private, offline-first personal finance tracker.',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        theme_color: '#2f6fed',
        background_color: '#f6f5f8',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'files',
                accept: [
                  'application/pdf',
                  '.pdf',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  '.xlsx',
                ],
              },
            ],
          },
        },
      },
      injectManifest: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
        // The pdf.js worker is ~1.4 MB and must be available offline.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    setupFiles: ['tests/setup/fakeIdb.ts'],
    testTimeout: 30000,
  },
});

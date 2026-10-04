/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The app never loads remote code and talks only to the price APIs (§ services/prices.ts), so the
 * page may connect nowhere else: a stray script could not send the stored finances out. Styles
 * allow inline because React and ECharts set style attributes. Meta CSP cannot set frame-ancestors.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "connect-src 'self' https://finnhub.io https://api.frankfurter.dev https://open.er-api.com https://api.mfapi.in",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default defineConfig({
  // CI sets BASE_PATH to `/<repo name>/` for GitHub Pages; locally the app is served from `/`.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    {
      name: 'csp',
      // Production builds only: the dev server injects inline scripts for hot reload.
      transformIndexHtml: (html, ctx) =>
        ctx.server === undefined
          ? html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
          : html,
    },
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
        theme_color: '#2457c5',
        background_color: '#f5f6fa',
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
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,webmanifest}'],
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

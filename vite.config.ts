import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Lahuen APP',
        short_name: 'Lahuen',
        description: 'CRM + Stock — Cooperativa Lahuen',
        start_url: '/',
        display: 'standalone',
        background_color: '#f5f5f7',
        theme_color: '#16a34a',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
      },
    }),
  ],
});

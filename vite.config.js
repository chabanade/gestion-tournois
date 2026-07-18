import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// Base relative pour un déploiement statique simple (VPS + Caddy, sous-dossier…).
export default defineConfig({
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Cache-first sur les assets, l'app fonctionne hors ligne après 1re visite.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      manifest: {
        name: 'Gestion de tournois',
        short_name: 'Tournois',
        description: 'Gestion de tournois sportifs amateurs — gratuit et hors ligne.',
        theme_color: '#1e6f5c',
        background_color: '#f5f6f8',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});

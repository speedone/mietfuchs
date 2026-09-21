/// <reference types="vitest/config" />
// Nur eine Typ-Referenz (zur Laufzeit entfernt) — so bleibt `test` unten typgeprüft, ohne
// dass der Produktionsbuild vitest auflösen müsste.
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    react(),
    // pdf.js dekodiert JBIG2/JPEG2000 (typisch für Behörden-Scans) und Farbprofile
    // per WebAssembly — diese Dateien müssen mit ausgeliefert werden.
    viteStaticCopy({
      targets: [
        { src: 'node_modules/pdfjs-dist/wasm/*', dest: 'pdfjs/wasm', rename: { stripBase: true } },
        { src: 'node_modules/pdfjs-dist/iccs/*', dest: 'pdfjs/iccs', rename: { stripBase: true } },
        { src: 'node_modules/pdfjs-dist/cmaps/*', dest: 'pdfjs/cmaps', rename: { stripBase: true } },
        { src: 'node_modules/pdfjs-dist/standard_fonts/*', dest: 'pdfjs/standard_fonts', rename: { stripBase: true } },
      ],
    }),
  ],
  // Tests: reine Formularlogik (*.test.ts) und Komponententests (*.test.tsx) mit jsdom.
  // Absichtlich schmal gehalten — geprüft wird, was über gespeicherte Beträge entscheidet.
  test: {
    // Standard ist node — jsdom kostet Startzeit und wird nur von den Komponententests
    // gebraucht, die es per `@vitest-environment jsdom` selbst anfordern.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  server: {
    // Ohne `workspaces`-Feld in der package.json endet Vites Suche am Projektordner, und ein
    // Import aus ../shared käme im Dev-Server als 403 zurück. Der Produktivbuild ist nicht
    // betroffen, dort bündelt Rollup die Datei ohnehin.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), '..'] },
    proxy: {
      // 127.0.0.1 statt localhost: Auf Windows löst "localhost" zuerst zu IPv6 (::1)
      // auf — dort kann eine WSL-Portweiterleitung (wslrelay) Port 3001 belegen und
      // liefert dann 404 für alle /api-Routen. Die explizite IPv4-Adresse trifft
      // zuverlässig den lokalen Express-Server.
      '/api': 'http://127.0.0.1:3001',
      '/uploads': 'http://127.0.0.1:3001',
      // Die Oberfläche liest daraus, was beim Start mit den Daten geschehen ist (#55, siehe
      // components/Database.tsx). Ohne diesen Eintrag beantwortete der Dev-Server die Anfrage
      // selbst mit der index.html, und der Hinweis bliebe ausgerechnet dort aus, wo er
      // entwickelt wird.
      '/healthz': 'http://127.0.0.1:3001',
    },
  },
})

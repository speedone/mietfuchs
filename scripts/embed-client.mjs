// Generiert server/src/embedded-client.js aus client/dist.
// Jede Frontend-Datei wird per Bun-Importattribut `with { type: "file" }` roh ins
// Binary eingebettet (kein Base64-Bloat). Das erzeugte Modul wird NUR in der
// gepackten Bun-Binary geladen (siehe index.js) — im Dev-Betrieb nie importiert,
// weil `type: "file"` ein Bun-spezifisches Feature ist.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'client', 'dist')
const outFile = path.join(root, 'server', 'src', 'embedded-client.js')

// Minimaler MIME-Katalog für die im Frontend-Build vorkommenden Endungen.
const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function walk(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

if (!fs.existsSync(distDir)) {
  console.error(`client/dist fehlt (${distDir}) — erst das Frontend bauen.`)
  process.exit(1)
}

const files = walk(distDir)
const lines = ['// AUTO-GENERIERT von scripts/embed-client.mjs — nicht von Hand bearbeiten.']
const mapEntries = []
files.forEach((full, i) => {
  const urlPath = '/' + path.relative(distDir, full).split(path.sep).join('/')
  // Import-Specifier relativ zu server/src/embedded-client.js
  const spec = './' + path.relative(path.dirname(outFile), full).split(path.sep).join('/')
  lines.push(`import f${i} from ${JSON.stringify(spec)} with { type: 'file' }`)
  mapEntries.push(`  ${JSON.stringify(urlPath)}: f${i},`)
})
lines.push('')
lines.push('export const embeddedFiles = {')
lines.push(...mapEntries)
lines.push('}')
lines.push('')
lines.push(`const MIME = ${JSON.stringify(MIME_MAP, null, 2)}`)
lines.push('export function mimeFor(urlPath) {')
lines.push("  const ext = urlPath.slice(urlPath.lastIndexOf('.')).toLowerCase()")
lines.push("  return MIME[ext] || 'application/octet-stream'")
lines.push('}')

fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8')
console.log(`✓ ${files.length} Dateien eingebettet → ${path.relative(root, outFile)}`)

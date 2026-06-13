// Einmal-Skript: erzeugt die App-Icons (PWA/Home-Screen) nach client/public/.
// Nutzt @napi-rs/canvas, das über pdf-to-img ohnehin installiert ist.
// Aufruf:  node scripts/make-icons.mjs  (aus dem server/-Ordner)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', '..', 'client', 'public')
fs.mkdirSync(OUT, { recursive: true })

// Fuchskopf „Mietfuchs" — identische Geometrie wie client/src/components/Logo.tsx (0..64-Raster).
const FOX = [
  { fill: '#ef6f2e', pts: [[32, 13], [40, 17], [58, 9], [46, 35], [32, 53], [18, 35], [6, 9], [24, 17]] }, // Kopf
  { fill: '#d4541c', pts: [[9, 12], [24, 17], [18, 27]] }, // Ohr links innen
  { fill: '#d4541c', pts: [[55, 12], [40, 17], [46, 27]] }, // Ohr rechts innen
  { fill: '#fff7f2', pts: [[21, 35], [43, 35], [32, 53]] }, // Schnauze
  { fill: '#23282f', pts: [[21, 27], [28, 30], [21, 33]] }, // Auge links
  { fill: '#23282f', pts: [[43, 27], [36, 30], [43, 33]] }, // Auge rechts
  { fill: '#23282f', pts: [[29, 47], [35, 47], [32, 53]] }, // Nase
]

for (const size of [180, 192, 512]) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  const u = size / 100 // Einheit relativ zur Icon-Größe

  // Hintergrund: abgerundetes Indigo-Quadrat
  ctx.fillStyle = '#4f46e5'
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, 18 * u)
  ctx.fill()

  // Fuchs zentriert einpassen (Bounding-Box des Kopfes ≈ x 6..58, y 9..53)
  const f = (size * 0.72) / 52
  ctx.save()
  ctx.translate(size / 2 - 32 * f, size / 2 - 31 * f)
  ctx.scale(f, f)
  for (const { fill, pts } of FOX) {
    ctx.fillStyle = fill
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()

  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`
  fs.writeFileSync(path.join(OUT, name), c.toBuffer('image/png'))
  console.log(`geschrieben: ${name}`)
}

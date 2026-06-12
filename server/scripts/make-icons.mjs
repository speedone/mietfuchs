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

for (const size of [180, 192, 512]) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  const u = size / 100 // Einheit relativ zur Icon-Größe

  // Hintergrund: abgerundetes Indigo-Quadrat
  ctx.fillStyle = '#4f46e5'
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, 18 * u)
  ctx.fill()

  // Haus-Silhouette in Weiß
  ctx.fillStyle = '#ffffff'
  ctx.beginPath() // Dach
  ctx.moveTo(50 * u, 16 * u)
  ctx.lineTo(85 * u, 46 * u)
  ctx.lineTo(15 * u, 46 * u)
  ctx.closePath()
  ctx.fill()
  ctx.fillRect(24 * u, 50 * u, 52 * u, 36 * u) // Körper

  // €-Zeichen im Haus
  ctx.fillStyle = '#4f46e5'
  ctx.font = `bold ${30 * u}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('€', 50 * u, 69 * u)

  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`
  fs.writeFileSync(path.join(OUT, name), c.toBuffer('image/png'))
  console.log(`geschrieben: ${name}`)
}

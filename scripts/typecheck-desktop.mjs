// Typprüfung des Programmfensters (#517), Teil von `npm run typecheck`. desktop/ installiert `npm install` nicht mit:
// electron-builder und Verwandte braucht nur, wer das Fenster baut, und das Docker-Image kennt den Ordner nicht. Fehlt
// die Installation, sagt die Prüfung das und überspringt das Fenster; in der CI (CI gesetzt) ist das ein Fehler, dort
// installiert ci.yml es immer.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (!fs.existsSync(path.join(root, 'desktop', 'node_modules', 'electron'))) {
  const message = 'Programmfenster (desktop/) nicht installiert, Typprüfung übersprungen. Nachholen mit: npm --prefix desktop install'
  if (process.env.CI) {
    console.error(message)
    process.exit(1)
  }
  console.log(message)
  process.exit(0)
}
const tsc = path.join(root, 'server', 'node_modules', 'typescript', 'bin', 'tsc')
execFileSync(process.execPath, [tsc, '-p', path.join(root, 'desktop')], { stdio: 'inherit' })

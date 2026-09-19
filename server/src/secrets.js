// API-Schlüssel externer KI-Dienste (#18). Bewusst getrennt von der db.json: Sie gehen nie an
// den Browser und nicht ins Backup-ZIP, das schnell in einer Cloud oder auf einem USB-Stick
// landet. Nach dem Wiederherstellen auf einem anderen Rechner trägt man den Schlüssel dort neu
// ein. Unter Unix ist die Datei nur für den eigenen Benutzer lesbar (0600).
//
// Je Einstellungs-Platz ein Schlüssel: `text` (Standard) und `images` (eigener Anbieter für
// Fotos und Scans). Für `text` kann der Betreiber den Schlüssel auch über die Umgebung festlegen,
// dann gilt er vor dem gespeicherten und lässt sich in der Oberfläche nicht ändern:
// - NKA_AI_API_KEY enthält den Schlüssel selbst,
// - NKA_AI_API_KEY_FILE den Pfad einer Datei mit dem Schlüssel, etwa eines Docker- oder
//   Compose-Secrets unter /run/secrets/. Die Endung _FILE folgt der Konvention offizieller
//   Docker-Images wie postgres und mysql, ebenso, dass nicht beide zugleich gesetzt sein dürfen.
// Gelesen wird die Umgebung einmal beim Start (`checkKeyEnvironment`).
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './store.js'

export const KEY_SLOTS = ['text', 'images']
const FILE = path.join(DATA_DIR, 'secrets.json')
const MAX_KEY_LENGTH = 4096
const KEY_ENV = 'NKA_AI_API_KEY'
const KEY_FILE_ENV = 'NKA_AI_API_KEY_FILE'

const validFormat = (key) => key.length <= MAX_KEY_LENGTH && !/\s/.test(key)

let cache = null

function read() {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    cache = {} // noch keine Datei oder unlesbar: dann gibt es eben keine Schlüssel
  }
  return cache
}

function write(data) {
  const tmp = `${FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try {
    fs.chmodSync(FILE, 0o600)
  } catch {
    // Windows kennt keine Unix-Rechte
  }
  cache = data
}

// Schlüssel aus der Umgebung als { key, variable }. Wirft mit einer Meldung für das Startprotokoll,
// die den Schlüssel selbst nie enthält.
function loadEnvKey() {
  const direct = process.env[KEY_ENV]?.trim()
  const file = process.env[KEY_FILE_ENV]?.trim()
  if (direct && file) throw new Error(`${KEY_ENV} und ${KEY_FILE_ENV} sind beide gesetzt. Bitte nur eine der beiden Variablen verwenden.`)
  if (direct) {
    if (!validFormat(direct)) throw new Error(`${KEY_ENV} hat ein ungültiges Format (Leerzeichen, Zeilenumbruch oder zu lang).`)
    return { key: direct, variable: KEY_ENV }
  }
  if (!file) return { key: '', variable: null }
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`${KEY_FILE_ENV} zeigt auf ${file}, die Datei lässt sich aber nicht lesen (${err.code ?? err.message}).`)
  }
  const key = content.trim() // Zeilenumbruch am Ende, wie ihn `echo … > datei` schreibt
  if (!key) throw new Error(`Die Datei ${file} aus ${KEY_FILE_ENV} ist leer.`)
  if (!validFormat(key)) throw new Error(`Die Datei ${file} aus ${KEY_FILE_ENV} hat ein ungültiges Format. Sie darf nur den Schlüssel enthalten, in einer Zeile.`)
  return { key, variable: KEY_FILE_ENV }
}

let envState = null
const envKeyState = () => (envState ??= loadEnvKey())

// Beim Start aufrufen: liefert eine Fehlermeldung, wenn die Umgebung unbrauchbar ist, sonst null
export function checkKeyEnvironment() {
  try {
    envKeyState()
    return null
  } catch (err) {
    return err.message
  }
}

// Name der Umgebungsvariable, die den Schlüssel dieses Platzes festlegt, sonst null
export const envVariableFor = (slot) => (slot === 'text' ? envKeyState().variable : null)

export function getKey(slot) {
  if (envVariableFor(slot)) return envKeyState().key
  const stored = read()[slot]
  return typeof stored === 'string' ? stored : ''
}

// Die letzten vier Zeichen zum Wiedererkennen, bei kurzen Schlüsseln nichts: Dort verrieten sie
// zu viel
const HINT_MIN_LENGTH = 12
const hintFor = (key) => (key.length >= HINT_MIN_LENGTH ? `…${key.slice(-4)}` : '')

// Fehler mit Meldung für die Oberfläche und `status` für die Route
const fail = (status, message) => Object.assign(new Error(message), { status })

function assertChangeable(slot) {
  if (!KEY_SLOTS.includes(slot)) throw fail(400, 'Unbekannter Platz für den Schlüssel.')
  const variable = envVariableFor(slot)
  if (variable) throw fail(409, `Der Schlüssel ist über die Umgebungsvariable ${variable} festgelegt.`)
}

export function setKey(slot, key) {
  assertChangeable(slot)
  const value = typeof key === 'string' ? key.trim() : ''
  if (!value) throw fail(400, 'Bitte einen Schlüssel eingeben.')
  if (!validFormat(value)) throw fail(400, 'Der Schlüssel hat ein ungültiges Format.')
  write({ ...read(), [slot]: value })
}

export function deleteKey(slot) {
  assertChangeable(slot)
  const { [slot]: _removed, ...rest } = read()
  write(rest)
}

// Was die Oberfläche erfahren darf: ob ein Schlüssel gesetzt ist, ein Hinweis zum
// Wiedererkennen und welche Umgebungsvariable ihn gegebenenfalls festlegt
export function keyInfo() {
  return Object.fromEntries(
    KEY_SLOTS.map((slot) => {
      const key = getKey(slot)
      return [slot, { set: Boolean(key), hint: hintFor(key), fromEnv: envVariableFor(slot) }]
    }),
  )
}

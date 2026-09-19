import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { migrateAi } from './ai/settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGED = !!globalThis.Bun

// Ordner, in dem das System Daten von Programmen erwartet, die nicht dem Benutzer gehören
function userDataHome(env, home, platform) {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Mietfuchs')
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Mietfuchs')
  // Linux und Verwandte nach der XDG-Spezifikation
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'mietfuchs')
}

// Liegt die Programmdatei an einem Ort, der dem System gehört? Dort haben Daten nichts
// verloren, selbst wenn gerade jemand mit Administratorrechten startet: Beim nächsten Start
// als normaler Benutzer wären sie sonst weg.
function systemLocation(execPath, platform) {
  // Bewusst nach der genannten Plattform trennen, nicht nach der des laufenden Rechners:
  // Sonst hinge das Ergebnis daran, wo geprüft wird.
  if (platform === 'win32') {
    const dir = path.win32.dirname(execPath).toLowerCase().replaceAll('\\', '/')
    return ['/program files', '/program files (x86)', '/windows'].some((p) => dir.includes(p))
  }
  const dir = `${path.posix.dirname(execPath)}/`
  return ['/usr/', '/opt/', '/bin/', '/sbin/', '/Applications/'].some((p) => dir.startsWith(p))
}

// Lässt sich in dem Ordner schreiben? Gibt es ihn noch nicht, zählt der übergeordnete.
function writable(dir) {
  let probe = dir
  while (!fs.existsSync(probe)) {
    const up = path.dirname(probe)
    if (up === probe) return false
    probe = up
  }
  try {
    fs.accessSync(probe, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

// Wo die Daten liegen. Im Dev-/npm-Betrieb server/data. In der gepackten Programmdatei liegt
// der Code in einem virtuellen, schreibgeschützten Dateisystem, die Daten also daneben, in den
// echten Ordner neben der Datei — so bleiben Daten und Programm zusammen, und ein Backup ist
// ein kopierter Ordner. Aus einem Installationspaket (#25) liegt die Programmdatei dagegen in
// /usr/bin, wo niemand schreiben darf; dann gehören die Daten in den Benutzerordner.
// `NKA_DATA_DIR` verlegt den Ordner (absoluter Pfad). Gedacht für Tests gegen einen
// Wegwerf-Ordner und für Betriebsfälle, in denen die Daten woanders liegen sollen.
export function chooseDataDir({
  env = process.env,
  execPath = process.execPath,
  packaged = PACKAGED,
  moduleDir = __dirname,
  home = os.homedir(),
  platform = process.platform,
  canWrite = writable,
} = {}) {
  if (env.NKA_DATA_DIR) return path.resolve(env.NKA_DATA_DIR)
  if (!packaged) return path.join(moduleDir, '..', 'data')
  if (systemLocation(execPath, platform)) return userDataHome(env, home, platform)
  const beside = path.join(path.dirname(execPath), 'data')
  return canWrite(beside) ? beside : userDataHome(env, home, platform)
}

export const DATA_DIR = chooseDataDir()
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
const DB_FILE = path.join(DATA_DIR, 'db.json')

// Standardmodell für die KI-Belegauswertung, gewählt mit dem KI-Prüflauf (#17): Auf Rechnern
// ohne Grafikkarte liest es PDFs mit Textebene fast fehlerfrei, einseitige Scans meist richtig,
// und es braucht rund 3,6 GB Arbeitsspeicher. Das Compose-Profil „ki“ lädt dasselbe Modell,
// ein Test gleicht beides ab.
export const DEFAULT_OLLAMA_MODEL = 'qwen3.5:4b'
// Früherer Standard, den es in der Ollama-Bibliothek nie gab (gemeint war qwen3.6:35b)
const INVALID_OLD_DEFAULT_MODEL = 'qwen3.6-35b'

const DEFAULT_DB = {
  settings: {
    houseName: '',
    address: '',
    landlordName: '',
    iban: '',
    paymentDeadlineDays: 30,
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: DEFAULT_OLLAMA_MODEL,
  },
  units: [],
  tenancies: [],
  costItems: [],
  meters: [],
  readings: [],
  // Gebuchte Mietzahlungen (Geldeingänge) fürs Mietkonto
  payments: [],
  // Abgeschlossene Abrechnungen: eingefrorener Berechnungsstand je Jahr
  closedSettlements: [],
}

let db = null

function load() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  if (fs.existsSync(DB_FILE)) {
    db = { ...structuredClone(DEFAULT_DB), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }
    db.settings = { ...DEFAULT_DB.settings, ...db.settings }
  } else {
    db = structuredClone(DEFAULT_DB)
  }
  // Der frühere Standard existierte nie, wer ihn nicht geändert hat, konnte gar nicht auswerten.
  // Eine eigene Wahl bleibt unangetastet.
  if (db.settings.ollamaModel === INVALID_OLD_DEFAULT_MODEL) db.settings.ollamaModel = DEFAULT_OLLAMA_MODEL
  if (db.settings.ai?.text?.model === INVALID_OLD_DEFAULT_MODEL) db.settings.ai.text.model = DEFAULT_OLLAMA_MODEL
  // KI-Anbieter (#18): `settings.ai` entsteht aus ollamaUrl und ollamaModel, fehlende Felder
  // werden ergänzt (siehe ai/settings.js)
  migrateAi(db.settings)
  // Migrationen älterer Datenformate.
  // Wohnungen: `selfUsed`/`selfPersons` (Eigennutzung in der Verteilbasis) kamen später dazu.
  // Bewusst ohne Rück-Migration — ein automatisch gesetztes Kennzeichen würde die Verteilung
  // bereits abgerechneter Jahre verändern. Die Umstellung passiert in den Stammdaten; das
  // Cockpit weist auf nicht beteiligte Wohnungen mit Wohnfläche hin.
  for (const t of db.tenancies) {
    // fester Monatsbetrag → Vorauszahlungs-Staffel
    if (!Array.isArray(t.prepayments)) {
      t.prepayments =
        t.prepaymentMonthlyCents != null
          ? [{ from: t.start.slice(0, 7), monthlyCents: t.prepaymentMonthlyCents }]
          : []
      delete t.prepaymentMonthlyCents
    }
    if (!t.prepaymentOverrides) t.prepaymentOverrides = {}
    // feste Personenzahl → Personen-Staffel
    if (!Array.isArray(t.personHistory)) {
      t.personHistory = [{ from: t.start, persons: t.persons ?? 1 }]
    }
    // Kaltmiete-Staffel kam später dazu — Altbestand hat sie noch nicht
    if (!Array.isArray(t.baseRents)) t.baseRents = []
  }
  return db
}

export function getDb() {
  return db ?? load()
}

export function save() {
  // Atomar schreiben: erst Temp-Datei, dann ersetzen — schützt vor halben Dateien bei Absturz
  const tmp = DB_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(getDb(), null, 2), 'utf8')
  fs.renameSync(tmp, DB_FILE)
}

export function newId() {
  return crypto.randomBytes(8).toString('hex')
}

// Nach dem Wiederherstellen eines Backups die db.json neu von der Platte lesen
export function reloadDb() {
  db = null
  return load()
}

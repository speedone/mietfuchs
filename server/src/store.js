import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { migrateAi } from './ai/settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// In der gepackten Binary (Bun --compile) liegt der Code in einem virtuellen,
// schreibgeschützten Dateisystem — die Daten müssen daneben, in den echten Ordner
// neben die ausführbare Datei. Im Dev-/npm-Betrieb bleibt es bei server/data.
// `NKA_DATA_DIR` verlegt den Datenordner (absoluter Pfad). Gedacht für Tests gegen einen
// Wegwerf-Ordner und für Betriebsfälle, in denen die Daten woanders liegen sollen.
const PACKAGED = !!globalThis.Bun
export const DATA_DIR = process.env.NKA_DATA_DIR
  ? path.resolve(process.env.NKA_DATA_DIR)
  : PACKAGED
    ? path.join(path.dirname(process.execPath), 'data')
    : path.join(__dirname, '..', 'data')
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

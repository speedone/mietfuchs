import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// In der gepackten Binary (Bun --compile) liegt der Code in einem virtuellen,
// schreibgeschützten Dateisystem — die Daten müssen daneben, in den echten Ordner
// neben die ausführbare Datei. Im Dev-/npm-Betrieb bleibt es bei server/data.
const PACKAGED = !!globalThis.Bun
export const DATA_DIR = PACKAGED
  ? path.join(path.dirname(process.execPath), 'data')
  : path.join(__dirname, '..', 'data')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
const DB_FILE = path.join(DATA_DIR, 'db.json')

const DEFAULT_DB = {
  settings: {
    houseName: '',
    address: '',
    landlordName: '',
    iban: '',
    paymentDeadlineDays: 30,
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen3.6-35b',
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
  // Migrationen älterer Datenformate
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

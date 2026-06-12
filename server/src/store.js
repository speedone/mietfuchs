import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(__dirname, '..', 'data')
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

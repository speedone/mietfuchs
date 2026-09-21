import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { CostItem, Meter, Payment, Reading, Settings, Tenancy, Unit } from '../../shared/types.ts'
import type { ComputedSettlement } from './calc.ts'
import { migrateLegacy } from './legacy.ts'
import { systemLocation, writable } from './paths.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGED = !!globalThis.Bun

// Heimatordner, erst wenn er gebraucht wird: `os.homedir()` wirft, wenn HOME fehlt und der
// laufende Benutzer keinen Eintrag in der Benutzerdatenbank hat (Container mit `--user`).
// Das darf den Start nicht verhindern, solange die Daten ohnehin woanders liegen.
function homeDir(): string {
  try {
    return os.homedir() || ''
  } catch {
    return '' // kein Eintrag für diesen Benutzer
  }
}

// Ordner, in dem das System Daten von Programmen erwartet, die nicht dem Benutzer gehören.
// Die Variablen des Systems gelten nur mit absolutem Pfad, so schreibt es die XDG-Spezifikation
// vor; ein relativer Wert hinge am Arbeitsverzeichnis, und das steht beim Start aus dem
// Startmenü nicht fest.
function userDataHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: () => string = homeDir): string {
  // Wie in paths.ts nach der genannten Plattform rechnen, nicht nach der des laufenden
  // Rechners: Sonst hinge das Ergebnis daran, wo geprüft wird.
  const p = platform === 'win32' ? path.win32 : path.posix
  const fromEnv = (name: string): string | null => {
    const value = env[name]
    return value && p.isAbsolute(value) ? value : null
  }
  const inHome = (...parts: string[]): string => {
    const dir = home()
    if (!dir) {
      throw new Error(
        'Der Heimatordner lässt sich nicht bestimmen (HOME ist nicht gesetzt). ' +
          'Bitte NKA_DATA_DIR auf einen Ordner setzen, in dem Mietfuchs schreiben darf.',
      )
    }
    return p.join(dir, ...parts)
  }
  if (platform === 'win32') return p.join(fromEnv('LOCALAPPDATA') || inHome('AppData', 'Local'), 'Mietfuchs')
  if (platform === 'darwin') return inHome('Library', 'Application Support', 'Mietfuchs')
  return p.join(fromEnv('XDG_DATA_HOME') || inHome('.local', 'share'), 'mietfuchs')
}

type ChooseDataDirOptions = {
  env?: NodeJS.ProcessEnv
  execPath?: string
  packaged?: boolean
  moduleDir?: string
  home?: () => string
  platform?: NodeJS.Platform
  canWrite?: (dir: string) => boolean
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
  home = homeDir,
  platform = process.platform,
  canWrite = writable,
}: ChooseDataDirOptions = {}): string {
  if (env.NKA_DATA_DIR) return path.resolve(env.NKA_DATA_DIR)
  if (!packaged) return path.join(moduleDir, '..', 'data')
  if (systemLocation(execPath, platform)) return userDataHome(env, platform, home)
  const beside = path.join(path.dirname(execPath), 'data')
  return canWrite(beside) ? beside : userDataHome(env, platform, home)
}

export const DATA_DIR = chooseDataDir()
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
const DB_FILE = path.join(DATA_DIR, 'db.json')

// Was POST /api/settlement/:year/close tatsächlich ablegt: das Ergebnis von computeSettlement,
// aber `selfUsedShareCents` optional, weil Schnappschüsse von vor v0.3.0 es noch nicht kennen.
// Zwei Stellen sichern das ab, und das muss so bleiben: GET /api/settlement/:year in index.ts
// mit einem vorangestellten `selfUsedShareCents: 0`, und `snapshotFromDb` in snapshot.ts mit
// `?? 0`, bevor die Steuerübersicht den Wert bekommt. `closed` gehört ohnehin nicht dazu, das
// ergänzt erst das Lesen in index.ts.
export type StoredSettlement = Omit<ComputedSettlement, 'selfUsedShareCents'> & { selfUsedShareCents?: number }

// Die Gestalt der db.json: Fachdaten je Collection plus abgeschlossene Abrechnungen.
export type ClosedSettlement = {
  id: string
  year: number
  closedAt: string
  sentAt: string | null
  settlement: StoredSettlement
}

export type Db = {
  settings: Settings
  units: Unit[]
  tenancies: Tenancy[]
  costItems: CostItem[]
  meters: Meter[]
  readings: Reading[]
  // Gebuchte Mietzahlungen (Geldeingänge) fürs Mietkonto
  payments: Payment[]
  // Abgeschlossene Abrechnungen: eingefrorener Berechnungsstand je Jahr
  closedSettlements: ClosedSettlement[]
}

let db: Db | null = null

function load(): Db {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  // Was in der Datei steht, weiß vorher niemand; der Typ ist hier eine Annahme und keine
  // Prüfung, wie bisher. Geprüft wird dort, wo ein fremder Bestand hereinkommt: beim
  // Wiederherstellen eines Backups, mit dem Validator in db/validate.ts.
  const stored: Partial<Db> | null = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : null
  // Die Vorgabewerte und die Umwandlung der alten Formate stehen in legacy.ts, weil der Umstieg
  // in die Datenbank dieselben Regeln braucht.
  const next = migrateLegacy(stored)
  db = next
  return next
}

export function getDb(): Db {
  return db ?? load()
}

export function save(): void {
  // Atomar schreiben: erst Temp-Datei, dann ersetzen — schützt vor halben Dateien bei Absturz
  const tmp = DB_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(getDb(), null, 2), 'utf8')
  fs.renameSync(tmp, DB_FILE)
}

export function newId(): string {
  return crypto.randomBytes(8).toString('hex')
}

// Nach dem Wiederherstellen eines Backups die db.json neu von der Platte lesen
export function reloadDb(): Db {
  db = null
  return load()
}

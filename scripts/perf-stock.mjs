// Ein großer, erfundener Bestand für die Messung bei wachsenden Datenmengen (perf-check.mjs).
//
//   node scripts/perf-stock.mjs --size m --out /tmp/perf-m      (Bestand anlegen und liegen lassen)
//
// Stufen (`--size`): **m** ist das Ziel (5 Objekte, 60 Einheiten, 10 Abrechnungsjahre mit Mieterwechseln,
// rund 3.000 Belege, 20.000 Ablesungen, 1.500 Kostenpositionen, Zahlungen für zehn Jahre und das laufende,
// eine Ölheizung mit Lieferungen und Vorrat am größten Objekt, Auswertungen der Belegbuchung, rund 10.000
// Gruppen im Verlauf). **s** ist rund ein Zehntel (ein Objekt), **l** rund das Dreifache (zehn Objekte).
//
// **Reproduzierbar**: Ein fester Startwert je Stufe bestimmt jede Zahl, jeden Namen und jedes Datum. Die
// Kennungen vergibt der Server zufällig (`NKA_TEST_IDS=seq` geht nicht, weil der Aufbau den Server einmal
// beendet und der Zähler je Prozess bei 1 beginnt). Die Jahre hängen am Kalender wie im Beispielbestand
// (demo-stock.mjs): das jüngste Abrechnungsjahr ist das Vorjahr.
//
// **Aufbau über die echten Schreibwege**: Objekte, Wohnungen, Mietverhältnisse, Zähler, Kostenpositionen,
// Belege, Heizung, Auswertungen, Änderungen und Abschlüsse gehen über die API eines echten Servers, also
// durch Wächter, Schlange und Änderungsjournal. Nur Ablesungen und Zahlungen schreibt der Aufbau in einem
// eigenen Prozess mit `openDatabase` und `insertEntityIn` (repository.ts; dieselbe Verschmelzung und
// derselbe Wächter wie `POST /api/readings`), solange kein Server läuft: Über die Route kostete jede der
// 20.000 Ablesungen ein Lesen aller Ablesungen (`createEntity` sucht den neuen Datensatz in der ganzen
// Sammlung), und das Journal bekäme 30.000 Gruppen statt der gewollten 10.000. Diese beiden Sammlungen
// stehen deshalb nicht im Verlauf. Ob der Bestand gültig ist, prüft perf-check.mjs mit Backup und
// Wiederherstellen (dieselben Prüfungen wie für jedes Archiv).
//
// **Alles ist erfunden**: Straßen in „12345 Musterstadt“, Namen aus zwei Listen zusammengewürfelt,
// Bankverbindung die veröffentlichte Beispiel-IBAN. Die Belege sind echte kleine PDFs (textPdf aus
// demo-stock.mjs), einige Vorlagen einmal erzeugt und je Beleg mit einer laufenden Nummer kopiert, damit
// jede Datei eine eigene Prüfsumme hat.
//
// Jeder Server bekommt NKA_DATA_DIR, CI=1 und NKA_UPDATE_URL auf einen geschlossenen Port (CLAUDE.md).
//
// **Last**: Stufe m braucht grob 1 bis 2 GB Arbeitsspeicher und rund fünf Minuten, l ein Mehrfaches davon (und ohne
// `--force` bricht l ab, wenn weniger als 4 GB frei sind). Nur allein auf dem Rechner laufen lassen.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../server/src/db/open.ts'
import { insertEntityIn } from '../server/src/db/repository.ts'
import { newId } from '../server/src/ids.ts'
import { textPdf } from './demo-stock.mjs'
import { startFakeOllama } from './fake-ollama.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const LAST_YEAR = new Date().getFullYear() - 1
export const YEARS = Array.from({ length: 10 }, (_, i) => LAST_YEAR - 9 + i)
const FIRST_YEAR = YEARS[0] ?? LAST_YEAR

// Wohnungen je Objekt; das erste ist das größte und hat die Heizanlage.
/** @type {Record<string, { units: number[], assessments: number, journalGroups: number, seed: number }>} */
export const SIZES = {
  s: { units: [6], assessments: 10, journalGroups: 1000, seed: 11 },
  m: { units: [20, 16, 12, 8, 4], assessments: 100, journalGroups: 10000, seed: 22 },
  l: { units: [30, 30, 24, 24, 18, 18, 12, 12, 6, 6], assessments: 300, journalGroups: 30000, seed: 33 },
}

// ---------- Zufall mit festem Startwert ----------
/** @param {number} seed */
function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
  }
}

const FIRST = ['Anna', 'Jonas', 'Lea', 'Paul', 'Mia', 'Felix', 'Emma', 'Lukas', 'Sophie', 'Noah', 'Lina', 'Elias', 'Marie', 'Ben', 'Clara',
  'Jan', 'Lena', 'Tim', 'Laura', 'Max', 'Ida', 'Moritz', 'Greta', 'Theo', 'Nele', 'Finn', 'Hanna', 'Leon', 'Frieda', 'Emil']
const LAST = ['Ahlers', 'Brandt', 'Conrad', 'Dorn', 'Eckert', 'Fiedler', 'Gerber', 'Haas', 'Imhof', 'Jansen', 'Kessler', 'Lorenz', 'Martens',
  'Neumeier', 'Olbrich', 'Pohl', 'Quast', 'Reuter', 'Seidel', 'Thalmann', 'Ulrich', 'Voigt', 'Wendt', 'Xander', 'Ypsen', 'Zeller']
const STREETS = ['Ahornweg', 'Birkenstraße', 'Eichenallee', 'Fichtenring', 'Lärchenweg', 'Pappelplatz', 'Ulmenstraße', 'Weidenhof', 'Erlenweg', 'Buchenstraße']

const pad = (n) => String(n).padStart(2, '0')
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
const addMonths = (y, m, k) => {
  const t = y * 12 + (m - 1) + k
  return [Math.floor(t / 12), (t % 12) + 1]
}

// ---------- Server ----------
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => {
    const port = /** @type {net.AddressInfo} */ (s.address()).port
    s.close(() => resolve(port))
  })
})

// Alle Server, die dieses Skript (oder perf-check.mjs) gestartet hat und die noch laufen. Bricht der Lauf mit Strg+C
// oder SIGTERM ab, beendet der Horcher unten sie, statt sie verwaist stehen zu lassen.
/** @type {Set<import('node:child_process').ChildProcess>} */
const running = new Set()
let signalsHooked = false
function hookSignals() {
  if (signalsHooked) return
  signalsHooked = true
  for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.once(sig, () => {
      for (const child of running) child.kill('SIGKILL')
      process.exit(130)
    })
  }
}

// Die Umgebung des Aufrufers ohne seine NKA_*-Angaben: Ein `NKA_DATA_DIR` oder `NKA_TEST_TODAY` aus der eigenen Shell
// soll nicht in die Messung geraten. Gesetzt wird nur, was der Aufruf ausdrücklich mitgibt.
function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NKA_')))
}

// Ein Server aus dem Repo wie `npm start`, mit den drei Angaben jedes Prüfstarts. `nodeArgs` etwa für
// `--cpu-prof`; damit das Profil geschrieben wird, beendet SIGTERM den Prozess über `process.exit`. Scheitert der
// Start, ist das Kind beendet, bevor der Fehler fliegt. `stop()` schickt SIGTERM und nach 10 s SIGKILL.
/**
 * @param {string} dataDir
 * @param {{ nodeArgs?: string[], env?: Record<string, string> }} [options]
 */
export async function startPerfServer(dataDir, { nodeArgs = [], env = {} } = {}) {
  hookSignals()
  const port = await freePort()
  const began = performance.now()
  const child = spawn(process.execPath, [
    '--import', 'data:text/javascript,process.on("SIGTERM",()=>process.exit(0))',
    ...nodeArgs, 'src/index.ts',
  ], {
    cwd: path.join(ROOT, 'server'),
    env: {
      ...cleanEnv(),
      ...env,
      NKA_DATA_DIR: dataDir,
      NKA_PORT: String(port),
      // Nach dem `...env` des Aufrufers, damit nichts davon überschrieben wird (CLAUDE.md)
      CI: '1',
      NKA_UPDATE_URL: 'http://127.0.0.1:9/',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  running.add(child)
  child.once('exit', () => running.delete(child))
  let log = ''
  child.stdout?.on('data', (d) => { log += d })
  child.stderr?.on('data', (d) => { log += d })
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(undefined)
    const hard = setTimeout(() => child.kill('SIGKILL'), 10000)
    child.once('exit', () => { clearTimeout(hard); resolve(undefined) })
    child.kill('SIGTERM')
  })
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 120000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Der Server ist beim Start beendet worden:\n${log}`)
    try {
      if ((await fetch(`${base}/healthz`)).ok) break
    } catch {
      // startet noch
    }
    if (Date.now() > deadline) {
      await stop()
      throw new Error(`Der Server antwortet nicht:\n${log}`)
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  const startMs = performance.now() - began
  return { base, pid: child.pid ?? 0, startMs, stop, log: () => log }
}

// ---------- API ----------
export function client(base) {
  /** @returns {Promise<{ status: number, body: any }>} */
  async function send(method, urlPath, body) {
    const init = body instanceof FormData
      ? { method, body }
      : { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }
    const res = await fetch(`${base}${urlPath}`, init)
    const text = await res.text()
    /** @type {any} */
    let parsed = text
    try { parsed = text ? JSON.parse(text) : null } catch { /* kein JSON */ }
    return { status: res.status, body: parsed }
  }
  /** @returns {Promise<any>} */
  async function call(method, urlPath, body) {
    const r = await send(method, urlPath, body)
    if (r.status >= 400) throw new Error(`${method} ${urlPath}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`)
    return r.body
  }
  return {
    send,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
  }
}

// ---------- Belege ----------
function pdfTemplates() {
  const kinds = ['Rechnung', 'Jahresabrechnung', 'Gebührenbescheid', 'Abschlagsrechnung', 'Beitragsrechnung', 'Wartungsprotokoll', 'Gutschrift', 'Kostenvoranschlag']
  return kinds.map((k) => textPdf(`<div>Beispielfirma GmbH · Musterweg 1 · 12345 Musterstadt</div><h1>${k}</h1>` +
    '<div>Erfundener Beleg für die Messung von Mietfuchs mit großem Bestand.</div>' +
    '<div>Pos. 1 Leistung laut Vertrag 100,00 EUR</div><div>Rechnungsbetrag 100,00 EUR</div>'))
}

// ---------- Der Bestand ----------
/**
 * @param {{ size: string, dataDir: string, log?: (text: string) => void }} options
 */
export async function buildStock({ size, dataDir, log = (t) => console.log(t) }) {
  const plan = SIZES[size]
  if (!plan) throw new Error(`Unbekannte Stufe „${size}“ (s, m oder l)`)
  const r = rng(plan.seed)
  const began = performance.now()
  const step = (t) => log(`[${((performance.now() - began) / 1000).toFixed(1)} s] ${t}`)
  const counts = { properties: 0, units: 0, tenancies: 0, meters: 0, readings: 0, payments: 0, costItems: 0, uploads: 0, assessments: 0, deliveries: 0, edits: 0, closed: 0 }
  let writes = 0 // je erfolgreichem Schreibaufruf eine Gruppe im Verlauf (ungefähr)
  fs.mkdirSync(dataDir, { recursive: true })
  const ollama = await startFakeOllama({ sequence: ['WASSER', 'MUELL', 'GARTEN', 'GRUNDSTEUER'] })
  /** @type {Awaited<ReturnType<typeof startPerfServer>> | null} */
  let server = null
  try {
    server = await startPerfServer(dataDir, { env: { NKA_OLLAMA_URL: ollama.url, NKA_OLLAMA_MODEL: 'qwen3.5:4b' } })
    let api = client(server.base)
    const w = async (p) => { const x = await p; writes++; return x }

    await w(api.put('/api/settings', { landlordName: 'Vermietung Beispiel', iban: 'DE02 1203 0000 0000 2020 51', paymentDeadlineDays: 30, updateCheck: 'off' }))

    // ---- Objekte, Wohnungen, Mietverhältnisse, Zähler ----
    /** @type {{ id: string, name: string, units: any[], tenancies: any[], meters: { id: string, unitId: string | null, type: string, perMonth: number }[], heating: boolean }[]} */
    const props = []
    const [first] = await api.get('/api/properties')
    for (const [pi, unitCount] of plan.units.entries()) {
      const street = `${STREETS[pi % STREETS.length]} ${3 + pi * 4}${pi >= STREETS.length ? ` ${String.fromCharCode(97 + Math.floor(pi / STREETS.length))}` : ''}`
      const body = { name: street, kind: 'mfh', address: `${street}, 12345 Musterstadt` }
      const prop = pi === 0 ? await w(api.put(`/api/properties/${first.id}`, body)) : await w(api.post('/api/properties', body))
      counts.properties++
      const P = prop.id
      /** @type {{ id: string, name: string, units: any[], tenancies: any[], meters: { id: string, unitId: string | null, type: string, perMonth: number }[], heating: boolean }} */
      const entry = { id: P, name: street, units: [], tenancies: [], meters: [], heating: pi === 0 }
      props.push(entry)
      for (let u = 0; u < unitCount; u++) {
        const floor = Math.floor(u / 4)
        const selfUsed = pi === 1 && u === unitCount - 1
        const unit = await w(api.post(`/api/units?property=${P}`, {
          name: `Whg. ${pi + 1}.${pad(u + 1)}`, areaM2: r.int(38, 112), rooms: r.int(1, 5), floor: floor === 0 ? 'EG' : `${floor}. OG`,
          participates: !selfUsed, ...(selfUsed ? { selfUsed: true, selfPersons: 2 } : {}),
        }))
        entry.units.push(unit)
        counts.units++
        // Mietverhältnisse: das erste begann vor dem ersten Jahr, danach Wechsel nach 1,5 bis 5 Jahren
        if (!selfUsed) {
          let [y, m] = [FIRST_YEAR - r.int(0, 6), r.int(1, 12)]
          for (;;) {
            const months = r.int(18, 60)
            const [ey, em] = addMonths(y, m, months - 1)
            const open = ey * 12 + em >= (LAST_YEAR + 1) * 12 + new Date().getMonth()
            const persons = r.int(1, 4)
            const prepay = 100 + persons * 40 + r.int(0, 60)
            const rent = Math.round(unit.areaM2 * r.int(70, 110) / 10) * 100
            const start = `${y}-${pad(m)}-01`
            const [y2, m2] = addMonths(y, m, 24)
            const t = await w(api.post(`/api/tenancies?property=${P}`, {
              unitId: unit.id, tenantName: `${r.pick(FIRST)} ${r.pick(LAST)}`, start, end: open ? null : monthEnd(ey, em),
              personHistory: [{ from: start, persons }],
              prepayments: [{ from: `${y}-${pad(m)}`, monthlyCents: prepay * 100 }, ...(months > 24 ? [{ from: `${y2}-${pad(m2)}`, monthlyCents: (prepay + 20) * 100 }] : [])],
              prepaymentOverrides: {}, baseRents: [{ from: `${y}-${pad(m)}`, monthlyCents: rent }],
              email: `mieter${counts.tenancies + 1}@example.org`,
            }))
            entry.tenancies.push(t)
            counts.tenancies++
            if (open) break
            ;[y, m] = addMonths(ey, em, 1 + r.int(0, 2))
          }
        }
        /** @type {[string, string, number][]} */
        const meterKinds = [['kaltwasser', 'm³', 3.2], ['warmwasser', 'm³', 1.4], ['waerme', 'kWh', 520]]
        for (const [type, unitName, perMonth] of meterKinds) {
          const meter = await w(api.post(`/api/meters?property=${P}`, {
            name: `${type === 'kaltwasser' ? 'Kaltwasser' : type === 'warmwasser' ? 'Warmwasser' : 'Wärme'} ${unit.name}`,
            unitId: unit.id, type, unit: unitName, meterNumber: `${type.slice(0, 2).toUpperCase()}-${pi + 1}${pad(u + 1)}`,
          }))
          entry.meters.push({ id: meter.id, unitId: unit.id, type, perMonth })
          counts.meters++
        }
      }
      const main = await w(api.post(`/api/meters?property=${P}`, { name: 'Hauptwasserzähler', unitId: null, type: 'kaltwasser', unit: 'm³', meterNumber: `HW-${pi + 1}` }))
      entry.meters.push({ id: main.id, unitId: null, type: 'kaltwasser', perMonth: 0 })
      counts.meters++
    }
    step(`${counts.properties} Objekte, ${counts.units} Wohnungen, ${counts.tenancies} Mietverhältnisse, ${counts.meters} Zähler`)

    // ---- Ablesungen und Zahlungen im eigenen Prozess (siehe Kopf) ----
    await server.stop()
    const opened = await openDatabase({ dataDir })
    /** @type {[string, Record<string, unknown>][]} */
    const readings = []
    for (const prop of props) {
      const mainId = prop.meters.find((m) => m.unitId === null)?.id
      const totals = new Map()
      for (const meter of prop.meters.filter((m) => m.unitId !== null)) {
        let value = r.int(100, 900)
        readings.push([meter.id, { meterId: meter.id, date: monthEnd(FIRST_YEAR - 1, 12), value }])
        for (const y of YEARS) {
          for (let mo = 1; mo <= 12; mo++) {
            const winter = meter.type === 'waerme' ? (mo <= 3 || mo >= 10 ? 1.8 : 0.3) : 1
            value = Math.round((value + meter.perMonth * winter * (0.6 + r.next() * 0.8)) * 10) / 10
            const date = monthEnd(y, mo)
            readings.push([meter.id, { meterId: meter.id, date, value }])
            if (meter.type === 'kaltwasser') totals.set(date, (totals.get(date) ?? 0) + value)
          }
        }
      }
      if (mainId) {
        let first = true
        for (const [date, sum] of [[monthEnd(FIRST_YEAR - 1, 12), 0], ...totals.entries()]) {
          readings.push([mainId, { meterId: mainId, date, value: first ? 5000 : Math.round((5000 + sum * 1.02) * 10) / 10 }])
          first = false
        }
      }
    }
    /** @type {Record<string, unknown>[]} */
    const payments = []
    const now = new Date()
    const lastPaid = now.getFullYear() * 12 + now.getMonth() // Monate bis einschließlich des Vormonats
    for (const prop of props) {
      for (const t of prop.tenancies) {
        const [sy, sm] = t.start.split('-').map(Number)
        const endKey = t.end ? Number(t.end.slice(0, 4)) * 12 + Number(t.end.slice(5, 7)) : lastPaid
        const monthly = (t.baseRents[0]?.monthlyCents ?? 0) + (t.prepayments[0]?.monthlyCents ?? 0)
        for (let k = Math.max(sy * 12 + sm, FIRST_YEAR * 12 + 1); k <= endKey; k++) {
          const y = Math.floor((k - 1) / 12)
          const mo = ((k - 1) % 12) + 1
          // Ab und zu zu wenig, sonst die Monatsmiete der ersten Staffel (der Abstand zur zweiten zeigt das Mietkonto)
          const amount = r.next() < 0.03 ? Math.round(monthly * 0.6) : monthly
          payments.push({ tenancyId: t.id, date: `${y}-${pad(mo)}-0${r.int(1, 5)}`, amountCents: amount })
        }
      }
    }
    const batch = 2000
    const insertAll = async (coll, rows) => {
      for (let i = 0; i < rows.length; i += batch) {
        await opened.write(async (db) => db.transaction(async (tx) => {
          for (const body of rows.slice(i, i + batch)) await insertEntityIn(tx, coll, newId(), body)
        }))
      }
    }
    await insertAll('readings', readings.map(([, body]) => body))
    counts.readings = readings.length
    await insertAll('payments', payments)
    counts.payments = payments.length
    opened.close()
    step(`${counts.readings} Ablesungen, ${counts.payments} Zahlungen (eigener Prozess)`)

    server = await startPerfServer(dataDir, { env: { NKA_OLLAMA_URL: ollama.url, NKA_OLLAMA_MODEL: 'qwen3.5:4b' } })
    api = client(server.base)

    // ---- Belege ----
    const templates = pdfTemplates()
    let pdfNo = 0
    const upload = async (name, propertyId, year) => {
      const fd = new FormData()
      const template = templates[pdfNo % templates.length] ?? templates[0]
      const bytes = Buffer.concat([template, Buffer.from(`% Beleg ${++pdfNo}\n`, 'latin1')])
      fd.append('file', new Blob([bytes], { type: 'application/pdf' }), name)
      fd.append('propertyId', propertyId)
      fd.append('year', String(year))
      const res = await w(api.post('/api/upload', fd))
      counts.uploads++
      return res.file
    }

    // ---- Heizung am größten Objekt: Ölkessel mit Lieferungen und Vorrat ----
    const heated = props.find((p) => p.heating)
    /** @type {string | null} */
    let plantId = null
    if (heated) {
      const created = await w(api.post(`/api/heating-plants?property=${heated.id}`, { name: 'Ölkessel Keller', energy: 'oil', method: 'manual', assignItemIds: [] }))
      plantId = created.plant.id
    }

    // ---- Kostenpositionen mit Beleg, je Objekt und Jahr ----
    const BASE = [
      ['Grundsteuer', 'Grundsteuer B', 'Stadt Musterstadt', 'area', 50, {}],
      ['Wasser/Abwasser', 'Frischwasser', 'Stadtwerke Musterstadt', 'meter', 45, { meterType: 'kaltwasser' }],
      ['Wasser/Abwasser', 'Abwasser', 'Stadtwerke Musterstadt', 'meter', 50, { meterType: 'kaltwasser' }],
      ['Niederschlagswasser', 'Niederschlagswasser', 'Stadtwerke Musterstadt', 'area', 12, {}],
      ['Müllabfuhr', 'Restmüll und Biotonne', 'Abfallwirtschaft Musterkreis', 'persons', 40, {}],
      ['Straßenreinigung', 'Straßenreinigung', 'Stadt Musterstadt', 'area', 8, {}],
      ['Gebäudereinigung', 'Treppenhausreinigung', 'Reinigung Beispiel', 'area', 35, { labor: 0.8 }],
      ['Gartenpflege', 'Gartenpflege Saison', 'Gärtnerei Beispiel', 'area', 25, { labor: 0.7 }],
      ['Beleuchtung/Allgemeinstrom', 'Allgemeinstrom', 'Stadtwerke Musterstadt', 'area', 15, {}],
      ['Schornsteinfeger', 'Feuerstättenschau', 'Schornsteinfeger Beispiel', 'area', 5, { labor: 0.6 }],
      ['Sach- und Haftpflichtversicherung', 'Wohngebäudeversicherung', 'Beispiel Versicherung AG', 'area', 45, {}],
      ['Hauswart', 'Hausmeisterdienst', 'Hausservice Beispiel', 'area', 60, { labor: 0.85 }],
      ['Heizung und Warmwasser', 'Gas und Wartung', 'Energie Musterstadt', 'meter', 180, { meterType: 'waerme' }],
    ]
    const EXTRA = [
      ['Nicht umlagefähig', 'Reparatur Dachrinne', 'Dachdeckerei Beispiel', 'area', 20, {}],
      ['Gebäudereinigung', 'Grundreinigung Keller', 'Reinigung Beispiel', 'area', 6, { labor: 0.8 }],
      ['Hauswart', 'Winterdienst', 'Hausservice Beispiel', 'area', 10, { labor: 0.9 }],
      ['Beleuchtung/Allgemeinstrom', 'Allgemeinstrom Nachzahlung', 'Stadtwerke Musterstadt', 'area', 3, {}],
      ['Sonstige Betriebskosten', 'Wartung Rauchwarnmelder', 'Rauchmelderdienst Beispiel', 'units', 4, {}],
      ['Gartenpflege', 'Baumschnitt', 'Gärtnerei Beispiel', 'area', 6, { labor: 0.7 }],
      ['Nicht umlagefähig', 'Verwaltungskosten', 'Büro Beispiel', 'area', 12, {}],
      ['Nicht umlagefähig', 'Reparatur Haustür', 'Tischlerei Beispiel', 'area', 8, {}],
      ['Zuführung Erhaltungsrücklage', 'Rücklage Dach', 'Eigenleistung', 'area', 30, {}],
    ]
    /** @type {{ id: string, propertyId: string }[]} */
    const costIds = []
    let litresInTank = 2000
    const pricePerLitreCents = 95
    for (const prop of props) {
      const area = prop.units.reduce((s, u) => s + u.areaM2, 0)
      const perYear = 10 + Math.round(1.6 * prop.units.length)
      for (const y of YEARS) {
        const growth = 1 + (y - FIRST_YEAR) * 0.03
        const list = BASE.filter(([cat]) => !(prop.heating && cat === 'Heizung und Warmwasser'))
        const rows = []
        for (let i = 0; rows.length < perYear; i++) rows.push(i < list.length ? list[i] : EXTRA[(i - list.length) % EXTRA.length])
        for (const [n, [category, description, vendor, key, perM2Cents, extra]] of rows.entries()) {
          const amountCents = Math.round(area * perM2Cents * growth * (0.85 + r.next() * 0.3))
          const file = await upload(`${description} ${y} ${prop.name} ${n + 1}.pdf`, prop.id, y)
          const { labor, ...rest } = /** @type {any} */ (extra)
          const item = await w(api.post(`/api/costItems?property=${prop.id}`, {
            year: y, category, description: n >= list.length ? `${description} (${n - list.length + 1})` : `${description} ${y}`, vendor,
            amountCents, key, invoiceFile: file, ...(labor ? { labor35aCents: Math.round(amountCents * labor) } : {}), ...rest,
          }))
          costIds.push({ id: item.id, propertyId: prop.id })
          counts.costItems++
        }
        if (prop.heating && plantId) {
          const quantity = r.int(5000, 9000)
          const priceCents = Math.round(quantity * pricePerLitreCents * growth)
          const delivery = await w(api.post(`/api/heating-plants/${plantId}/deliveries`, {
            label: `Heizöl ${y}`, deliveredAt: `${y}-09-15`, quantity, quantityUnit: 'l', emissionsKg: Math.round(quantity * 2.6763 * 10) / 10,
            co2CostCents: y >= 2021 ? Math.round(quantity * 2.6763 / 1000 * (y >= 2024 ? 4500 : 3000)) : 0,
          }))
          counts.deliveries++
          const file = await upload(`Heizöllieferung ${y} ${prop.name}.pdf`, prop.id, y)
          const item = await w(api.post(`/api/costItems?property=${prop.id}`, {
            year: y, category: 'Heizung und Warmwasser', description: `Heizöl ${y}`, vendor: 'Heizöl Beispiel GmbH', amountCents: priceCents,
            key: 'area', heatingPlantId: plantId, heatingPart: 'fuel', fuelDeliveryId: delivery.id, invoiceFile: file,
          }))
          costIds.push({ id: item.id, propertyId: prop.id })
          counts.costItems++
          const opening = litresInTank
          const closing = Math.max(300, opening + quantity - r.int(5500, 8500))
          // Den Anfangsbestand nimmt nur die erste Heizperiode; danach ergibt er sich aus dem Endbestand davor.
          await w(api.put(`/api/heating-plants/${plantId}/periods/${y}-01/stock`, {
            stockUnit: 'l', closingQuantity: closing, closingMeasuredOn: `${y}-12-31`,
            ...(y === FIRST_YEAR ? {
              openingQuantity: opening, openingCostCents: opening * pricePerLitreCents, openingEmissionsKg: Math.round(opening * 2.6763 * 10) / 10,
              openingCo2Cents: 0, openingInvoicedBefore2023: true,
            } : {}),
          }))
          litresInTank = closing
        }
        // Posteingang: Belege ohne Zuordnung, etwa Abschläge und Bescheide, je Objekt und Jahr so viele wie Positionen
        for (let k = 0; k < perYear; k++) await upload(`Abschlag ${pad((k % 12) + 1)}.${y} ${prop.name} ${k + 1}.pdf`, prop.id, y)
      }
      step(`${prop.name}: ${counts.costItems} Positionen, ${counts.uploads} Belege bisher`)
    }

    // ---- Auswertungen der Belegbuchung (nachgebautes Ollama) ----
    const inboxNames = (await api.get('/api/uploads')).filter((u) => u.year === LAST_YEAR && u.propertyId && String(u.originalName).startsWith('Abschlag'))
    const markers = ['WASSER', 'MUELL', 'GARTEN', 'GRUNDSTEUER']
    for (let i = 0; i < plan.assessments && i < inboxNames.length; i++) {
      const u = inboxNames[i]
      const fd = new FormData()
      fd.append('existingFile', u.file)
      fd.append('propertyId', u.propertyId)
      fd.append('year', String(LAST_YEAR))
      fd.append('pdfText', `${markers[i % markers.length]} Rechnung ${LAST_YEAR} Rechnungsbetrag 100,00 EUR `.repeat(3))
      const res = await w(api.post('/api/extract', fd))
      if (res?.assessment) counts.assessments++
    }
    step(`${counts.assessments} Auswertungen`)

    // ---- Änderungen für den Verlauf, bis rund die gewollte Zahl Gruppen erreicht ist ----
    const closings = props.length * (YEARS.length - 1)
    const editsWanted = Math.max(0, plan.journalGroups - writes - closings)
    for (let i = 0; i < editsWanted; i++) {
      const c = costIds[(i * 7) % costIds.length]
      if (!c) break
      await w(api.put(`/api/costItems/${c.id}`, { vendor: `Firma ${r.pick(LAST)} ${i % 3 === 0 ? 'GmbH' : 'KG'}` }))
      counts.edits++
    }
    step(`${counts.edits} Änderungen`)

    // ---- Abschlüsse: alle Jahre außer dem jüngsten ----
    for (const prop of props) {
      for (const y of YEARS.slice(0, -1)) {
        /** @type {Record<string, unknown>} */
        const answer = {}
        for (let attempt = 0; attempt < 4; attempt++) {
          const res = await api.send('POST', `/api/settlement/${y}/close?property=${prop.id}`, answer)
          if (res.status < 300) { writes++; counts.closed++; break }
          if (res.status !== 409) throw new Error(`Abschluss ${prop.name} ${y}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`)
          if (res.body?.errorToken) answer.despiteErrors = res.body.errorToken
          if (res.body?.fuelGaps) answer.fuelEstimates = 'estimate'
          if (attempt === 3) throw new Error(`Abschluss ${prop.name} ${y}: ${JSON.stringify(res.body).slice(0, 300)}`)
        }
      }
    }
    step(`${counts.closed} Abrechnungen abgeschlossen`)
    await server.stop()

    // Gezählt wird in der Datenbank selbst, nicht über die Schreibaufrufe
    const check = new DatabaseSync(path.join(dataDir, 'mietfuchs.sqlite'), { readOnly: true })
    const groups = Number(check.prepare('SELECT count(*) AS n FROM change_groups').get()?.n)
    check.close()
    const summary = { size, years: [FIRST_YEAR, LAST_YEAR], ...counts, writes, journalGroups: groups, propertyList: props.map((p) => ({ id: p.id, name: p.name, units: p.units.length })), plantId, seconds: Math.round((performance.now() - began) / 1000) }
    fs.writeFileSync(path.join(dataDir, 'perf-stock.json'), JSON.stringify(summary, null, 2))
    return summary
  } catch (err) {
    // Die letzten Zeilen des Servers gehören zur Meldung, sonst bleibt ein Absturz stumm
    throw new Error(`${err instanceof Error ? err.message : err}\nLetzte Ausgabe des Servers:\n${server?.log().slice(-3000) ?? ''}`, { cause: err })
  } finally {
    await server?.stop()
    ollama.stop()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? fallback : process.argv[i + 1]
  }
  const size = arg('size', 'm')
  const out = arg('out', null)
  if (size === 'l' && os.freemem() < 4 * 1024 ** 3 && !process.argv.includes('--force')) {
    throw new Error(`Stufe l braucht mehrere GB Arbeitsspeicher, frei sind ${(os.freemem() / 1024 ** 3).toFixed(1)} GB. Mit --force trotzdem.`)
  }
  if (!out) throw new Error('Bitte mit --out <Ordner> aufrufen (ein leerer Wegwerf-Ordner, nie der echte Datenordner).')
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) throw new Error(`${out} ist nicht leer.`)
  const summary = await buildStock({ size, dataDir: out })
  console.log(JSON.stringify(summary, null, 2))
}

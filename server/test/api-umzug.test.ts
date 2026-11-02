// Umzug der Daten ins Programmfenster (#517) gegen den echten Server. Das Fenster ist mit NKA_RUNTIME=desktop
// nachgestellt; Heimatordner (NKA_TEST_HOME), Ortsdatei (NKA_TEST_LOCATIONS_FILE) und der Port der alten Fassung
// (NKA_TEST_OLD_PORT) kommen hinein, damit kein Test den echten Benutzerordner liest. Die Regeln ohne Server stehen in
// relocation.test.ts, der Lauf mit echten alten Programmdateien in scripts/fenster-umzug-praxislauf.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { Settings, Tenancy } from '../../shared/types.ts'
import type { Db } from '../src/store.ts'
import { straightenForDatabase } from '../src/legacy/migrate.ts'
import { openDatabaseWithStock } from '../testing/database.ts'
import { listening, portOf, startServerIn } from '../testing/api.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-umzug-'))
const programName = process.platform === 'win32' ? 'mietfuchs-win.exe' : process.platform === 'darwin' ? 'mietfuchs-macos-intel' : 'mietfuchs-linux'
const PDF = Buffer.from('%PDF-1.4\n% Rechnung Müllabfuhr\n')

const someDb = (): Db => ({
  settings: { houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V. Vermieter', iban: '', paymentDeadlineDays: 30, ollamaUrl: 'http://localhost:11434', ollamaModel: 'modell', updateCheck: 'on' },
  units: [
    { id: 'u1', name: 'EG', areaM2: 80, participates: true },
    { id: 'u2', name: 'OG', areaM2: 40, participates: true },
  ],
  tenancies: (['Müller', 'Schmidt'] as const).map((tenantName, i) => ({
    id: `t${i + 1}`, unitId: `u${i + 1}`, tenantName, persons: 1,
    personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
    prepayments: [{ from: '2024-01', monthlyCents: 10000 }], prepaymentOverrides: {},
    baseRents: [{ from: '2024-01', monthlyCents: 50000 }],
  })),
  costItems: [{ id: 'c1', year: 2024, category: 'Müllabfuhr', description: 'Gebühren', amountCents: 120000, key: 'area', invoiceFile: 'rechnung.pdf' }],
  meters: [], readings: [], payments: [], closedSettlements: [],
})

type Old = { home: string, program: string, data: string }

// Ein alter Ordner wie draußen: Programmdatei im Download-Ordner, daneben `data` mit Datenbank und Beleg.
async function oldFolder(kind: 'database' | 'json' = 'database', home = tempDir()): Promise<Old> {
  const program = path.join(home, 'Downloads', 'mietfuchs-0.14')
  const data = path.join(program, 'data')
  fs.mkdirSync(path.join(data, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(program, programName), 'Programmdatei')
  fs.writeFileSync(path.join(data, 'uploads', 'rechnung.pdf'), PDF)
  if (kind === 'json') fs.writeFileSync(path.join(data, 'db.json'), JSON.stringify(someDb()))
  else (await openDatabaseWithStock(data, straightenForDatabase(someDb()))).close()
  return { home, program, data }
}

// Alles im alten Ordner mit Inhalt und Zeit, um zu zeigen, dass der Umzug daran nichts ändert außer dem Vermerk.
function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else {
        const st = fs.statSync(full)
        out[path.relative(dir, full)] = `${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}@${st.mtimeMs}`
      }
    }
  }
  walk(dir)
  return out
}
const withoutMarker = (print: Record<string, string>) =>
  Object.fromEntries(Object.entries(print).filter(([name]) => name !== 'umgezogen.json' && name !== 'UMGEZOGEN.txt'))

const desktopEnv = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NKA_RUNTIME: 'desktop', NKA_HOST: '127.0.0.1', NKA_TEST_HOME: home, NKA_TEST_OLD_PORT: '9', ...extra,
})

type Candidate = { id: string, dataDir: string, kind: string, modifiedAt: string | null, properties: number | null, tenancies: number | null, running: boolean, source: string }
type Offer = { offered: boolean, candidates?: Candidate[], searched?: boolean, complete?: boolean }

async function post(base: string, urlPath: string, body: unknown = {}): Promise<{ status: number, body: Record<string, unknown> }> {
  const res = await fetch(`${base}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

// Übernehmen wie die Oberfläche (K11): erst den Ort über `/inspect` bekannt machen (wie nach dem Ordner-Dialog), dann
// mit seiner Kennung übernehmen. Lehnt schon `/inspect` ab, ist das die Antwort.
async function adopt(base: string, dataDir: string, extra: Record<string, unknown> = {}): Promise<{ status: number, body: Record<string, unknown> }> {
  const known = await post(base, '/api/relocation/inspect', { folder: dataDir })
  const id = (known.body.candidate as Candidate | undefined)?.id
  if (!id) return known
  return post(base, '/api/relocation/adopt', { id, ...extra })
}

test('Umzug: nur im Fenster, nicht im Browserbetrieb, nicht mit Bestand', async () => {
  const old = await oldFolder()
  const npm = await startServerIn(tempDir(), { NKA_TEST_HOME: old.home })
  try {
    assert.deepEqual(await npm.api<Offer>('/api/relocation'), { offered: false })
    assert.deepEqual(await npm.api<Offer>('/api/relocation/candidates'), { offered: false })
    assert.equal((await adopt(npm.base, old.data)).status, 409)
  } finally {
    npm.stop()
  }
  const desk = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    assert.equal((await desk.api<Offer>('/api/relocation')).offered, true)
    // Ein eigener Bestand: dann gibt es nichts umzuziehen
    await desk.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Neu', areaM2: 50, participates: true }) })
    assert.deepEqual(await desk.api<Offer>('/api/relocation'), { offered: false })
    assert.equal((await adopt(desk.base, old.data)).status, 409)
  } finally {
    desk.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Umzug: findet den Ordner neben der Programmdatei, kopiert, vergleicht, vermerkt, Original unverändert', async () => {
  const old = await oldFolder()
  const before = fingerprint(old.data)
  const locations = path.join(old.home, 'standorte', 'standorte.json')
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_TEST_LOCATIONS_FILE: locations }))
  try {
    const offer = await s.api<Offer>('/api/relocation/candidates')
    assert.equal(offer.offered, true)
    assert.equal(offer.searched, true)
    assert.equal(offer.complete, true)
    assert.equal(offer.candidates?.length, 1)
    const [found] = offer.candidates ?? []
    assert.equal(found?.dataDir, old.data)
    assert.equal(found?.kind, 'database')
    assert.equal(found?.tenancies, 2)
    assert.equal(found?.properties, 1)
    assert.equal(found?.running, false)
    assert.equal(found?.source, 'search')
    assert.ok(found?.modifiedAt)

    // Mit der Kennung des Fundes, wie die Oberfläche (K11)
    const adopted = await post(s.base, '/api/relocation/adopt', { id: found?.id })
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
    assert.deepEqual(adopted.body.counts, { properties: 1, tenancies: 2, costItems: 1, receipts: 1 })

    // Im neuen Ordner: Bestand, Beleg, Einstellungen samt Zustimmung zur Update-Prüfung (der Umzug bringt den
    // Stand von jetzt, nicht einen früheren)
    const tenancies = await s.api<Tenancy[]>('/api/tenancies')
    assert.deepEqual(tenancies.map((t) => t.tenantName).sort(), ['Müller', 'Schmidt'])
    const receipt = await fetch(`${s.base}/uploads/rechnung.pdf`)
    assert.equal(receipt.status, 200)
    assert.ok(Buffer.from(await receipt.arrayBuffer()).equals(PDF))
    assert.equal((await s.api<Settings>('/api/settings')).updateCheck, 'on')
    // Vermerk im alten Ordner, sonst nichts verändert
    const marker = JSON.parse(fs.readFileSync(path.join(old.data, 'umgezogen.json'), 'utf8'))
    assert.equal(marker.movedTo, s.dataDir)
    assert.match(fs.readFileSync(path.join(old.data, 'UMGEZOGEN.txt'), 'utf8'), /umgezogen/)
    assert.deepEqual(withoutMarker(fingerprint(old.data)), before)
    // Entscheidung im neuen Ordner, neuer Ort in der Ortsdatei, kein zweites Angebot
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'umzug.json'), 'utf8')).decision, 'moved')
    const remembered = JSON.parse(fs.readFileSync(locations, 'utf8'))
    assert.equal(remembered.locations[0].dataDir, s.dataDir)
    assert.deepEqual(await s.api<Offer>('/api/relocation'), { offered: false })
    // Im Verlauf steht der Umzug als Schranke, nicht als „Backup eingespielt“
    const journal = await s.api<{ title: string, barrier: string | null }[]>('/api/journal')
    assert.deepEqual(journal.filter((g) => g.barrier).map((g) => g.title), ['Daten aus dem bisherigen Mietfuchs übernommen'])
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Logo und Briefpapier (#415) kommen mit wie im Backup; eines, das sich nicht als Bild lesen lässt, bleibt im alten
// Ordner, und der Umzug sagt es, statt still eine Lücke zu lassen.
test('Umzug: Briefpapier kommt mit, ein unlesbares bleibt mit Hinweis im alten Ordner', async () => {
  const old = await oldFolder()
  const design = path.join(old.data, 'briefpapier')
  fs.mkdirSync(design)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)])
  fs.writeFileSync(path.join(design, 'logo-0123456789abcdef.png'), png)
  fs.writeFileSync(path.join(design, 'paper-fedcba9876543210.pdf'), 'kein PDF')
  const s = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    const adopted = await adopt(s.base, old.data)
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
    assert.ok(fs.readFileSync(path.join(s.dataDir, 'briefpapier', 'logo-0123456789abcdef.png')).equals(png))
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'briefpapier', 'paper-fedcba9876543210.pdf')))
    assert.match((adopted.body.notes as string[]).join(' '), /paper-fedcba9876543210\.pdf/)
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Umzug: eine alte db.json wird in der Kopie umgestiegen, das Original bleibt db.json', async () => {
  const old = await oldFolder('json')
  const before = fingerprint(old.data)
  const s = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    const [found] = (await s.api<Offer>('/api/relocation/candidates')).candidates ?? []
    assert.equal(found?.kind, 'json')
    const adopted = await adopt(s.base, old.data)
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
    assert.deepEqual((await s.api<Tenancy[]>('/api/tenancies')).map((t) => t.tenantName).sort(), ['Müller', 'Schmidt'])
    assert.ok(fs.existsSync(path.join(old.data, 'db.json')), 'die db.json heißt im alten Ordner weiter so')
    assert.ok(!fs.existsSync(path.join(old.data, 'db.json.abgeloest')))
    assert.deepEqual(withoutMarker(fingerprint(old.data)), before)
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'db.json')), 'keine db.json im neuen Ordner')
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Umzug: zuerst die Orte aus der Ortsdatei, dann wird nicht gesucht', async () => {
  const old = await oldFolder()
  const remembered = await oldFolder('database', tempDir())
  const locations = path.join(old.home, 'standorte.json')
  fs.writeFileSync(locations, JSON.stringify({ version: 1, locations: [{ dataDir: remembered.data, exe: path.join(remembered.program, programName), appVersion: '0.14.1', lastSeen: '2026-11-01T08:00:00.000Z' }] }))
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_TEST_LOCATIONS_FILE: locations }))
  try {
    const offer = await s.api<Offer>('/api/relocation/candidates')
    assert.equal(offer.searched, false)
    assert.deepEqual(offer.candidates?.map((c) => [c.dataDir, c.source]), [[remembered.data, 'remembered']])
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
    fs.rmSync(remembered.home, { recursive: true, force: true })
  }
})

test('Umzug: läuft das alte Mietfuchs noch, erst beenden, dann kopieren', async () => {
  const old = await oldFolder()
  let quitCalls = 0
  let alive = true
  const fake = http.createServer((req, res) => {
    if (!alive) {
      res.destroy()
      return
    }
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return void res.end(JSON.stringify({ app: 'mietfuchs', status: 'ok', database: { file: path.join(old.data, 'mietfuchs.sqlite') } }))
    }
    if (req.method === 'POST' && req.url === '/api/quit') {
      quitCalls++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      alive = false
      return
    }
    res.writeHead(404)
    res.end()
  })
  await listening(fake, '127.0.0.1')
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_TEST_OLD_PORT: String(portOf(fake)) }))
  try {
    const [found] = (await s.api<Offer>('/api/relocation/candidates')).candidates ?? []
    assert.equal(found?.running, true)
    const refused = await adopt(s.base, old.data)
    assert.equal(refused.status, 409)
    assert.match(String(refused.body.error), /altes Mietfuchs.*beenden|beenden Sie/i)
    assert.equal(fs.existsSync(path.join(old.data, 'umgezogen.json')), false)
    const quit = await post(s.base, '/api/relocation/quit-old')
    assert.equal(quit.status, 200)
    assert.equal(quit.body.stopped, true)
    assert.equal(quitCalls, 1)
    assert.equal((await adopt(s.base, old.data)).status, 200)
  } finally {
    s.stop()
    fake.close()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Umzug: scheitert etwas, bleibt der neue Ordner leer und der alte unberührt', async () => {
  const home = tempDir()
  // Eine beschädigte Datenbank, eine aus einer neueren Version und eine db.json, die nicht zu Mietfuchs passt
  const broken = path.join(home, 'Downloads', 'kaputt')
  fs.mkdirSync(path.join(broken, 'data', 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(broken, programName), 'x')
  fs.writeFileSync(path.join(broken, 'data', 'mietfuchs.sqlite'), 'SQLite format 3\0 aber kaputt')
  fs.writeFileSync(path.join(broken, 'data', 'uploads', 'beleg.pdf'), PDF)
  const wrongJson = path.join(home, 'Desktop', 'fremd')
  fs.mkdirSync(path.join(wrongJson, 'data'), { recursive: true })
  fs.writeFileSync(path.join(wrongJson, programName), 'x')
  fs.writeFileSync(path.join(wrongJson, 'data', 'db.json'), JSON.stringify({ units: 'keine Liste', tenancies: [] }))
  const newer = await oldFolder('database', tempDir())
  {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path.join(newer.data, 'mietfuchs.sqlite'))
    db.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('aus-der-zukunft', 99999999999999)")
    db.close()
  }
  const prints = [broken, wrongJson, newer.program].map((dir) => fingerprint(dir))
  const s = await startServerIn(tempDir(), desktopEnv(home))
  try {
    for (const dataDir of [path.join(broken, 'data'), path.join(wrongJson, 'data'), newer.data]) {
      const refused = await adopt(s.base, dataDir)
      assert.equal(refused.status, 400, `${dataDir}: ${JSON.stringify(refused.body)}`)
      assert.match(String(refused.body.error), /unverändert/)
      // Nichts von einem nächsten Start: Der Umzug versucht es nicht von selbst erneut
      assert.doesNotMatch(String(refused.body.error), /nächsten Start/)
      assert.deepEqual(await s.api<Tenancy[]>('/api/tenancies'), [])
      assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'uploads')), [])
      assert.equal((await s.api<Offer>('/api/relocation')).offered, true, 'der Bildschirm bleibt')
    }
    assert.match(String((await adopt(s.base, newer.data)).body.error), /neueren Mietfuchs-Version/)
    assert.deepEqual([broken, wrongJson, newer.program].map((dir) => fingerprint(dir)), prints)
    // Reste der Kopie bleiben nicht liegen
    assert.deepEqual(fs.readdirSync(s.dataDir).filter((n) => n.startsWith('restore-') || n.includes('.restore-')), [])
    // Ein Ordner ohne Bestand und der eigene Ordner werden schon bei der Wahl abgelehnt, ein relativer Pfad ebenso
    assert.equal((await adopt(s.base, path.join(home, 'Downloads'))).status, 404)
    assert.equal((await adopt(s.base, s.dataDir)).status, 404)
    assert.equal((await adopt(s.base, 'data')).status, 400)
  } finally {
    s.stop()
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(newer.home, { recursive: true, force: true })
  }
})

test('Umzug: Ordner gewählt, neu anfangen', async () => {
  const old = await oldFolder()
  const elsewhere = tempDir()
  const s = await startServerIn(tempDir(), desktopEnv(elsewhere))
  try {
    // Nichts gefunden: Der Bildschirm bietet Backup und Ordnerwahl an
    assert.deepEqual((await s.api<Offer>('/api/relocation/candidates')).candidates, [])
    const chosen = await post(s.base, '/api/relocation/inspect', { folder: old.program })
    assert.equal(chosen.status, 200)
    assert.equal((chosen.body.candidate as Candidate).dataDir, old.data)
    assert.equal((chosen.body.candidate as Candidate).source, 'chosen')
    const nothing = await post(s.base, '/api/relocation/inspect', { folder: elsewhere })
    assert.equal(nothing.status, 404)
    assert.match(String(nothing.body.error), /Programmdatei/)
    assert.equal((await post(s.base, '/api/relocation/decline')).status, 200)
    assert.deepEqual(await s.api<Offer>('/api/relocation'), { offered: false })
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'umzug.json'), 'utf8')).decision, 'fresh')
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
    fs.rmSync(elsewhere, { recursive: true, force: true })
  }
})

test('Vermerk: ein umgezogener Ordner öffnet nur lesend, Schreibrouten sagen warum', async () => {
  const old = await oldFolder()
  fs.writeFileSync(path.join(old.data, 'db.json'), JSON.stringify(someDb()))
  fs.writeFileSync(path.join(old.data, 'umgezogen.json'), JSON.stringify({ version: 1, movedTo: 'C:\\Users\\Anna\\Mietfuchs', at: '2026-11-01T10:15:00.000Z', appVersion: '0.15.0' }))
  // Der Server bekommt den Ordner selbst als Datenordner, wie eine Programmdatei daneben
  const s = await startServerIn(old.data, {})
  try {
    const health = await s.api<{ moved?: { movedTo: string, at: string } }>('/healthz')
    assert.equal(health.moved?.movedTo, 'C:\\Users\\Anna\\Mietfuchs')
    assert.deepEqual((await s.api<Tenancy[]>('/api/tenancies')).map((t) => t.tenantName).sort(), ['Müller', 'Schmidt'])
    const refused = await post(s.base, '/api/units', { name: 'Neu', areaM2: 1, participates: true })
    assert.equal(refused.status, 423)
    assert.match(String(refused.body.error), /ins neue Mietfuchs umgezogen \(am 1\. November 2026 nach C:\\Users\\Anna\\Mietfuchs\)/)
    const put = await fetch(`${s.base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(put.status, 423)
    // Kein Umstieg der liegengebliebenen db.json, keine Sicherung, nichts im Ordner geändert
    assert.ok(fs.existsSync(path.join(old.data, 'db.json')))
    assert.ok(!fs.existsSync(path.join(old.data, 'vorversionen')))
  } finally {
    s.child.kill()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Durchsicht im Praxislauf (0.3.1): Ein umgezogener Ordner mit einer alten db.json zeigte nichts an, weil der Umstieg
// dort zu Recht nicht läuft. Gezeigt wird jetzt eine Kopie außerhalb des Ordners; der Ordner selbst bleibt, wie er ist,
// auch eine Datenbank wird darin nicht migriert.
// Der letzte Schritt der Kette (Index im Journal) und wie seine Wirkung zurückgenommen wird; siehe den Test darunter.
const LAST_STEP_INDEX = 84
const undoLastStep = (db: { exec: (sql: string) => void }): void => db.exec('ALTER TABLE settings DROP COLUMN desktop_hint_dismissed')

test('Vermerk: auch eine alte db.json wird angezeigt, ohne dass sich im Ordner etwas ändert', async () => {
  for (const kind of ['json', 'database'] as const) {
    const old = await oldFolder(kind)
    fs.writeFileSync(path.join(old.data, 'umgezogen.json'), JSON.stringify({ version: 1, movedTo: '/neu', at: '2026-11-01T10:15:00.000Z', appVersion: '0.15.0' }))
    if (kind === 'database') {
      // Eine Datenbank aus einer früheren Fassung: Der letzte Schritt der Kette fehlt noch, Marke und Wirkung. Fügt ein
      // neuer letzter Schritt eine Spalte an, scheiterte er sonst an der schon vorhandenen; seine Wirkung nimmt
      // `undoLastStep` zurück (heute 0084_umstieg_hinweis, eine Spalte der Einstellungen).
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(path.join(old.data, 'mietfuchs.sqlite'))
      const last = db.prepare('SELECT max(id) AS id FROM __drizzle_migrations').get()
      assert.equal(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()?.n, LAST_STEP_INDEX + 1, 'Kette gewachsen: undoLastStep auf den neuen letzten Schritt umstellen')
      undoLastStep(db)
      db.prepare('DELETE FROM __drizzle_migrations WHERE id = ?').run(Number(last?.id))
      db.close()
    }
    const before = fingerprint(old.data)
    const s = await startServerIn(old.data, {})
    try {
      assert.deepEqual((await s.api<Tenancy[]>('/api/tenancies')).map((t) => t.tenantName).sort(), ['Müller', 'Schmidt'], kind)
    } finally {
      s.child.kill()
      await new Promise((resolve) => s.child.once('exit', resolve))
    }
    // startServerIn legt den Belegordner an, wenn er fehlt; er war schon da
    assert.deepEqual(fingerprint(old.data), before, `${kind}: nichts im Ordner verändert`)
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Durchsicht D1: Ein Beleg, der vor dem Übernehmen schon im neuen Fenster lag, ließ die Prüfung nach dem Umschalten
// scheitern; der neue Ordner trug dann den Bestand, ohne Vermerk im alten. Er gehört dazu und stört den Vergleich nicht.
test('Durchsicht D1: ein Beleg, der schon im neuen Ordner lag, hält den Umzug nicht auf', async () => {
  const old = await oldFolder()
  const s = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    fs.writeFileSync(path.join(s.dataDir, 'uploads', 'schon-da.pdf'), PDF)
    const adopted = await adopt(s.base, old.data)
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
    assert.ok(fs.existsSync(path.join(old.data, 'umgezogen.json')))
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Durchsicht D3: Ein Beleg als Verweis (unter Windows auch ein Platzhalter von OneDrive) fiel aus Kopie und Vergleich
// heraus; die Datenbank nannte danach eine fehlende Datei.
test('Durchsicht D3: ein Beleg als Verweis kommt als Datei mit', async () => {
  const old = await oldFolder()
  const elsewhere = path.join(old.home, 'woanders.pdf')
  fs.writeFileSync(elsewhere, PDF)
  fs.symlinkSync(elsewhere, path.join(old.data, 'uploads', 'verweis.pdf'))
  const s = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    const adopted = await adopt(s.base, old.data)
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
    assert.equal((adopted.body.counts as { receipts: number }).receipts, 2)
    const copied = path.join(s.dataDir, 'uploads', 'verweis.pdf')
    assert.ok(fs.lstatSync(copied).isFile() && fs.readFileSync(copied).equals(PDF))
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Durchsicht D5: Der Vermerk galt nur, wenn er beim Start schon da war. Zieht ein anderes Fenster die Daten um, während
// diese Fassung läuft, nimmt sie ab dann keine Änderung mehr an.
test('Durchsicht D5: ein Vermerk, der während des Laufs entsteht, sperrt sofort', async () => {
  const old = await oldFolder()
  const s = await startServerIn(old.data, {})
  try {
    fs.writeFileSync(path.join(old.data, 'umgezogen.json'), JSON.stringify({ version: 1, movedTo: '/neu', at: '2026-11-01T10:15:00.000Z', appVersion: '0.15.0' }))
    assert.equal((await post(s.base, '/api/units', { name: 'Neu', areaM2: 1, participates: true })).status, 423)
  } finally {
    s.child.kill()
    await new Promise((resolve) => s.child.once('exit', resolve))
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Durchsicht D6: Wer die Programmdatei in einen Ordner „Mietfuchs“ im Benutzerordner gelegt hatte, hat ihre Daten in
// `…\Mietfuchs\data`, also unter dem Datenordner des Fensters. Das ist nicht der Datenordner selbst.
test('Durchsicht D6: Daten in „data“ unter dem eigenen Datenordner lassen sich übernehmen', async () => {
  const home = tempDir()
  const own = path.join(home, 'Mietfuchs')
  fs.mkdirSync(own)
  fs.writeFileSync(path.join(own, programName), 'Programmdatei')
  const data = path.join(own, 'data')
  fs.mkdirSync(path.join(data, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(data, 'uploads', 'rechnung.pdf'), PDF)
  ;(await openDatabaseWithStock(data, straightenForDatabase(someDb()))).close()
  const s = await startServerIn(own, desktopEnv(home))
  try {
    const adopted = await adopt(s.base, data)
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
  } finally {
    s.child.kill()
    await new Promise((resolve) => s.child.once('exit', resolve))
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// Durchsicht D1, zweiter Teil: Endet das Fenster zwischen dem Umschalten und dem Vermerk (Absturz, Strom weg), holt der
// nächste Start den Vermerk nach; die Entscheidung steht schon vorher im neuen Ordner.
test('Durchsicht D1: ein fehlender Vermerk wird beim nächsten Start nachgeholt', async () => {
  const old = await oldFolder()
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'umzug.json'), JSON.stringify({ version: 1, decision: 'moved', at: '2026-11-01T10:15:00.000Z', from: old.data }))
  const s = await startServerIn(dir, desktopEnv(old.home))
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(old.data, 'umgezogen.json'), 'utf8'))
    assert.equal(marker.movedTo, s.dataDir)
    assert.equal(marker.at, '2026-11-01T10:15:00.000Z')
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Ergänzung 1: die Orte, die das Fenster nennt (OneDrive)
test('Ergänzung: gesucht wird auch an den Orten, die das Fenster nennt', async () => {
  const home = tempDir()
  const old = await oldFolder('database', home)
  const desk = path.join(home, 'OneDrive - Firma', 'Schreibtisch')
  fs.mkdirSync(desk, { recursive: true })
  fs.renameSync(old.program, path.join(desk, 'mietfuchs-0.14'))
  const s = await startServerIn(tempDir(), desktopEnv(home, { NKA_SEARCH_DIRS: JSON.stringify([desk]) }))
  try {
    const [found] = (await s.api<Offer>('/api/relocation/candidates')).candidates ?? []
    assert.equal(found?.dataDir, path.join(desk, 'mietfuchs-0.14', 'data'))
  } finally {
    s.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// Ergänzung 2: Wurde im alten Mietfuchs nach dem Umzug noch etwas geändert, sagt es das neue und bietet an, den neueren
// Stand noch einmal zu übernehmen, nie von selbst. Der Stand von jetzt wird dabei gesichert (vor-restore).
test('Ergänzung: Änderungen im alten Mietfuchs nach dem Umzug werden erkannt und auf Wunsch übernommen', async () => {
  const old = await oldFolder()
  const s = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    assert.equal((await adopt(s.base, old.data)).status, 200)
    assert.deepEqual(await s.api<{ offered: boolean, newer?: unknown }>('/api/relocation'), { offered: false })
    // Eine alte Fassung, die den Vermerk nicht kennt, ändert etwas. Geänderte Erwartung (Durchsicht Daten K5): Wie jede
    // Änderung eines Nutzers legt sie eine Gruppe im Journal an; eine Migration allein gilt nicht mehr als neuerer Stand
    const { DatabaseSync } = await import('node:sqlite')
    const group = "INSERT INTO change_groups (at, method, route, description, schema_steps) VALUES ('2026-11-02T10:00:00.000Z', 'PUT', '/api/tenancies', 'geändert', 1)"
    const db = new DatabaseSync(path.join(old.data, 'mietfuchs.sqlite'))
    db.exec("UPDATE tenancies SET tenant_name = 'Schmidt-Lange' WHERE tenant_name = 'Schmidt'")
    db.exec(group)
    db.close()
    const offer = await s.api<{ offered: boolean, newer?: { from: string, modifiedAt: string, place: unknown, running: boolean } }>('/api/relocation')
    assert.equal(offer.newer?.from, old.data)
    // Praxistest M: Ort in Worten und ob das alte Mietfuchs noch läuft (dann „Altes Mietfuchs beenden“)
    assert.deepEqual(offer.newer?.place, { folder: 'mietfuchs-0.14', within: 'Downloads' })
    assert.equal(offer.newer?.running, false)
    // Nie von selbst
    assert.deepEqual((await s.api<Tenancy[]>('/api/tenancies')).map((t) => t.tenantName).sort(), ['Müller', 'Schmidt'])
    const again = await post(s.base, '/api/relocation/readopt')
    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.deepEqual((await s.api<Tenancy[]>('/api/tenancies')).map((t) => t.tenantName).sort(), ['Müller', 'Schmidt-Lange'])
    assert.ok(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')), 'der Stand vorher ist gesichert')
    assert.deepEqual(await s.api('/api/relocation'), { offered: false })
    // Abwinken: danach kein Hinweis mehr für diesen Stand
    const db2 = new DatabaseSync(path.join(old.data, 'mietfuchs.sqlite'))
    db2.exec("UPDATE tenancies SET tenant_name = 'Müller-Neu' WHERE tenant_name = 'Müller'")
    db2.exec(group)
    db2.close()
    assert.ok((await s.api<{ newer?: unknown }>('/api/relocation')).newer)
    assert.equal((await post(s.base, '/api/relocation/newer/dismiss')).status, 200)
    assert.deepEqual(await s.api('/api/relocation'), { offered: false })
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Ergänzung 4: großer Bestand. Vorher Platz prüfen, beim Kopieren Fortschritt, Abbrechen sicher.
test('Ergänzung: zu wenig Platz wird vor dem Kopieren gesagt', async () => {
  const old = await oldFolder()
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_TEST_FREE_BYTES: '1000' }))
  try {
    const refused = await adopt(s.base, old.data)
    assert.equal(refused.status, 400)
    assert.match(String(refused.body.error), /nicht genug Platz.*MB/)
    assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'uploads')), [])
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

test('Ergänzung: Fortschritt beim Kopieren, Abbrechen lässt beide Ordner, wie sie waren', async () => {
  const old = await oldFolder()
  for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(old.data, 'uploads', `beleg-${i}.pdf`), PDF)
  const before = fingerprint(old.data)
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_TEST_COPY_DELAY_MS: '250' }))
  try {
    const adopting = adopt(s.base, old.data)
    let progress: { phase: string, files: number, totalFiles: number, bytes: number, totalBytes: number } | null = null
    for (let i = 0; i < 100; i++) {
      progress = await s.api('/api/relocation/progress')
      if (progress && progress.files >= 2) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(progress?.phase, 'copy')
    // Neun Belege und die Datenbank
    assert.equal(progress?.totalFiles, 10)
    assert.ok((progress?.totalBytes ?? 0) > 0)
    assert.equal((await post(s.base, '/api/relocation/cancel')).status, 200)
    const result = await adopting
    assert.equal(result.status, 400)
    assert.match(String(result.body.error), /abgebrochen/)
    // Praxistest K-05: Die Oberfläche zeigt einen Abbruch neutral statt als Fehler
    assert.equal(result.body.cancelled, true)
    assert.deepEqual(await s.api<Tenancy[]>('/api/tenancies'), [])
    assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'uploads')), [])
    assert.deepEqual(fingerprint(old.data), before)
    assert.equal((await s.api<{ phase: string }>('/api/relocation/progress')).phase, 'idle')
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Praxistest vor 0.15.0 (Szenario K): Ohne den Testgriff NKA_TEST_COPY_DELAY_MS kopierte die Schleife mit
// fs.copyFileSync und gab den Server bis zum Ende nicht frei. Fortschritt und „Abbrechen“ kamen erst an, wenn alles
// kopiert war; auf einem langsamen Datenträger stand das Fenster minutenlang ohne Zahl und ohne Ausweg.
test('Praxistest K: Fortschritt und Abbrechen auch ohne Testgriff, der Server bleibt beim Kopieren ansprechbar', async () => {
  const old = await oldFolder()
  const page = Buffer.alloc(200 * 1024, 7)
  for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(old.data, 'uploads', `beleg-${i}.pdf`), Buffer.concat([PDF, page]))
  const before = fingerprint(old.data)
  const s = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    const adopting = adopt(s.base, old.data)
    let between: { files: number, totalFiles: number } | null = null
    // Nach Zeit begrenzt, nicht nach Anzahl: Vor der Kopie liest der Server die 600 Belege ein, und auf einer langsamen
    // Maschine (Windows mit Virenscanner) dauert das länger als 2000 sofort beantwortete Abfragen (Durchsicht)
    const deadline = Date.now() + 30_000
    while (!between && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2))
      const p = await s.api<{ phase: string, files: number, totalFiles: number }>('/api/relocation/progress')
      // Mitten in den Belegen, nicht erst bei der Datenbank am Ende (deren Prüfsumme gab den Server schon vorher frei)
      if (p.phase === 'copy' && p.files >= 10 && p.files < p.totalFiles / 2) between = p
    }
    assert.ok(between, 'kein Zwischenstand während der Kopie: der Server war bis zum Ende blockiert')
    assert.equal((await post(s.base, '/api/relocation/cancel')).status, 200)
    const result = await adopting
    assert.equal(result.status, 400, JSON.stringify(result.body))
    assert.match(String(result.body.error), /abgebrochen/)
    assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'uploads')), [])
    assert.deepEqual(fingerprint(old.data), before)
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Ergänzung: Auch die Store-Fassung bietet den Umzug an (wer von der Programmdatei in den Store wechselt, stünde sonst
// ohne Daten da). Sie liest die Ortsdatei, schreibt sie aber nicht: Unter AppData lenkt Windows das Schreiben einer
// Store-App in ihren Paketordner um, die Programmdatei sähe es nie. Nachgestellt mit NKA_TEST_STORE=1 (eine
// Store-Angabe in NKA_RUNTIME zählt bewusst nicht, runtime.test.ts).
test('Ergänzung: Store-Fassung übernimmt, liest die Ortsdatei und schreibt sie nicht', async () => {
  const old = await oldFolder()
  const locations = path.join(old.home, 'standorte.json')
  const content = JSON.stringify({ version: 1, locations: [{ dataDir: old.data, exe: path.join(old.program, programName), appVersion: '0.14.1', lastSeen: '2026-11-01T08:00:00.000Z' }] })
  fs.writeFileSync(locations, content)
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_TEST_STORE: '1', NKA_TEST_LOCATIONS_FILE: locations }))
  try {
    const offer = await s.api<Offer>('/api/relocation/candidates')
    assert.deepEqual(offer.candidates?.map((c) => [c.dataDir, c.source]), [[old.data, 'remembered']])
    assert.equal((await adopt(s.base, old.data)).status, 200)
    assert.ok(fs.existsSync(path.join(old.data, 'umgezogen.json')))
    assert.equal(fs.readFileSync(locations, 'utf8'), content, 'die Ortsdatei bleibt, wie sie war')
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Ergänzung: Wer statt eines Ordners die Programmdatei, die db.json oder ein Backup wählt, kommt trotzdem ans Ziel.
test('Ergänzung: gewählt werden auch Programmdatei, db.json und Backup; ein Backup wird eingespielt', async () => {
  const old = await oldFolder('json')
  // Ein Backup des alten Bestands, wie es „Backup herunterladen“ liefert
  const source = await startServerIn(tempDir(), {})
  const zip = path.join(old.home, 'mietfuchs-backup.zip')
  try {
    await source.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Aus dem Backup', areaM2: 10, participates: true }) })
    fs.writeFileSync(zip, Buffer.from(await (await fetch(`${source.base}/api/backup`)).arrayBuffer()))
  } finally {
    source.stop()
  }
  const s = await startServerIn(tempDir(), desktopEnv(tempDir()))
  try {
    for (const chosen of [path.join(old.program, programName), path.join(old.data, 'db.json')]) {
      const r = await post(s.base, '/api/relocation/inspect', { folder: chosen })
      assert.equal(r.status, 200, `${chosen}: ${JSON.stringify(r.body)}`)
      assert.equal((r.body.candidate as Candidate).dataDir, old.data)
    }
    const asBackup = await post(s.base, '/api/relocation/inspect', { folder: zip })
    const backup = asBackup.body.backup as { id: string, name: string } | undefined
    assert.equal(backup?.name, 'mietfuchs-backup.zip')
    const restored = await post(s.base, '/api/relocation/restore-backup', { id: backup?.id })
    assert.equal(restored.status, 200, JSON.stringify(restored.body))
    assert.deepEqual((await s.api<{ name: string }[]>('/api/units')).map((u) => u.name), ['Aus dem Backup'])
    assert.ok(fs.existsSync(zip), 'das Backup selbst bleibt liegen')
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Ergänzung: Von Hand (Einstellungen „Daten aus bisherigem Mietfuchs übernehmen …“) geht der Umzug auch mit eigenem
// Bestand, aber nur mit ausdrücklichem `replace` (Rückfrage in der Oberfläche); der Stand von jetzt wird gesichert.
test('Ergänzung: mit eigenem Bestand nur mit replace, der Stand vorher ist gesichert', async () => {
  const old = await oldFolder()
  const s = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Eigene', areaM2: 10, participates: true }) })
    const list = await s.api<Offer & { ownStock: boolean }>('/api/relocation/candidates')
    assert.equal(list.offered, false)
    assert.equal(list.ownStock, true)
    assert.equal(list.candidates?.[0]?.dataDir, old.data)
    const refused = await adopt(s.base, old.data)
    assert.equal(refused.status, 409)
    assert.equal(refused.body.replace, true)
    const replaced = await adopt(s.base, old.data, { replace: true })
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body))
    assert.deepEqual((await s.api<{ name: string }[]>('/api/units')).map((u) => u.name).sort(), ['EG', 'OG'])
    assert.ok(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')))
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Absicherung: Mit „Zugriff aus dem Heimnetz“ (NKA_HOST=0.0.0.0) erreichen Handy und andere Rechner den Server. Die
// Umzugsrouten nehmen Pfade an und kopieren; sie antworten deshalb nur Anfragen von diesem Rechner (Loopback).
test('Absicherung: Umzugsrouten nur vom eigenen Rechner, aus dem Heimnetz 403', async (t) => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address
  if (!lan) return t.skip('Dieser Rechner hat keine Adresse außer Loopback; ohne sie lässt sich keine Anfrage aus dem Heimnetz nachstellen.')
  const old = await oldFolder()
  const s = await startServerIn(tempDir(), desktopEnv(old.home, { NKA_HOST: '0.0.0.0' }))
  try {
    const port = new URL(s.base).port
    const fromLan = `http://${lan}:${port}`
    const routes: [string, string, unknown][] = [
      ['GET', '/api/relocation/candidates', null],
      ['POST', '/api/relocation/inspect', { folder: old.program }],
      ['POST', '/api/relocation/adopt', { id: 'erfunden' }],
      ['POST', '/api/relocation/restore-backup', { id: 'erfunden' }],
      ['POST', '/api/relocation/quit-old', {}],
      ['POST', '/api/relocation/readopt', {}],
      ['POST', '/api/relocation/newer/dismiss', {}],
      ['POST', '/api/relocation/decline', {}],
      ['POST', '/api/relocation/cancel', {}],
    ]
    for (const [method, url, body] of routes) {
      const res = await fetch(`${fromLan}${url}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      assert.equal(res.status, 403, `${method} ${url}`)
      assert.equal(((await res.json()) as { error: string }).error, 'Daten übernehmen geht nur am Rechner, auf dem Mietfuchs läuft.', `${method} ${url}`)
    }
    assert.ok(!fs.existsSync(path.join(old.data, 'umgezogen.json')))
    // Vom eigenen Rechner wie bisher
    assert.equal((await s.api<Offer>('/api/relocation/candidates')).candidates?.[0]?.dataDir, old.data)
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Durchsicht vor 0.15.0 (K11): Übernehmen und Einspielen nehmen keinen Pfad mehr, nur die Kennung eines Fundes, den
// der Server selbst kennt: aus der Suche oder der Ortsdatei (`/api/relocation/candidates`) oder aus dem Ordner-Dialog,
// dessen Wahl `/api/relocation/inspect` prüft und mit Kennung zurückgibt. Ein Pfad allein, auch ein gültiger, und eine
// unbekannte Kennung sind eine 400, und es wird nichts kopiert.
test('Absicherung: Übernehmen und Einspielen nur mit der Kennung eines bekannten Fundes', async () => {
  const old = await oldFolder()
  const zip = path.join(old.home, 'mietfuchs-backup.zip')
  const source = await startServerIn(tempDir(), {})
  try {
    await source.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Aus dem Backup', areaM2: 10, participates: true }) })
    fs.writeFileSync(zip, Buffer.from(await (await fetch(`${source.base}/api/backup`)).arrayBuffer()))
  } finally {
    source.stop()
  }
  const s = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    const UNKNOWN = /kennt Mietfuchs nicht/
    for (const body of [{ dataDir: old.data }, { id: 'erfunden' }, { id: old.data }, {}]) {
      const refused = await post(s.base, '/api/relocation/adopt', body)
      assert.equal(refused.status, 400, JSON.stringify(body))
      assert.match(String(refused.body.error), UNKNOWN)
    }
    for (const body of [{ file: zip }, { id: 'erfunden' }]) {
      const refused = await post(s.base, '/api/relocation/restore-backup', body)
      assert.equal(refused.status, 400, JSON.stringify(body))
      assert.match(String(refused.body.error), UNKNOWN)
    }
    assert.deepEqual(await s.api<Tenancy[]>('/api/tenancies'), [])
    assert.ok(!fs.existsSync(path.join(old.data, 'umgezogen.json')))

    // Die Kennung eines Fundes der Suche ist stabil, solange der Server läuft, und gilt nur für einen Ordner
    const [found] = (await s.api<Offer>('/api/relocation/candidates')).candidates ?? []
    if (!found) return assert.fail('Die Suche hat den alten Ordner nicht gefunden.')
    assert.match(found.id, /^[0-9a-f-]{36}$/)
    assert.equal((await s.api<Offer>('/api/relocation/candidates')).candidates?.[0]?.id, found.id)
    // Der Ordner-Dialog: Die Wahl kommt als Pfad, die Antwort trägt die Kennung; derselbe Ordner, dieselbe Kennung
    const chosen = await post(s.base, '/api/relocation/inspect', { folder: old.program })
    assert.equal((chosen.body.candidate as Candidate).id, found.id)
    // Eine Kennung lässt sich neu beschreiben (die Oberfläche fragt, ob das alte Mietfuchs inzwischen läuft)
    const again = await post(s.base, '/api/relocation/inspect', { id: found.id })
    assert.equal((again.body.candidate as Candidate).dataDir, old.data)
    assert.equal((await post(s.base, '/api/relocation/inspect', { id: 'erfunden' })).status, 400)
    // Ein Backup aus dem Dialog: eine eigene Kennung, die nicht als Ordner gilt (und umgekehrt)
    const asBackup = await post(s.base, '/api/relocation/inspect', { folder: zip })
    const backupId = (asBackup.body.backup as { id?: string } | undefined)?.id
    if (!backupId) return assert.fail(`Keine Kennung für das Backup: ${JSON.stringify(asBackup.body)}`)
    assert.equal((await post(s.base, '/api/relocation/adopt', { id: backupId })).status, 400)
    assert.equal((await post(s.base, '/api/relocation/restore-backup', { id: found.id })).status, 400)

    const adopted = await post(s.base, '/api/relocation/adopt', { id: found.id })
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
    assert.deepEqual((await s.api<Tenancy[]>('/api/tenancies')).map((t) => t.tenantName).sort(), ['Müller', 'Schmidt'])
    const restored = await post(s.base, '/api/relocation/restore-backup', { id: backupId, replace: true })
    assert.equal(restored.status, 200, JSON.stringify(restored.body))
    assert.deepEqual((await s.api<{ name: string }[]>('/api/units')).map((u) => u.name), ['Aus dem Backup'])
  } finally {
    s.stop()
    fs.rmSync(old.home, { recursive: true, force: true })
  }
})

// Praxistest J: Dass ein Fund beschädigt ist, sagt schon seine Beschreibung, und der Rat führt nicht ins alte Mietfuchs (das öffnet die Datei ebenso wenig)
test('Praxistest J: beschädigter Fund vorab erkannt, Rat ohne Sackgasse', async () => {
  const home = tempDir()
  const broken = path.join(home, 'Downloads', 'mietfuchs-0.14.1')
  fs.mkdirSync(path.join(broken, 'data', 'vorversionen'), { recursive: true })
  fs.writeFileSync(path.join(broken, programName), 'x')
  fs.writeFileSync(path.join(broken, 'data', 'mietfuchs.sqlite'), 'SQLite format 3\0 aber kaputt')
  fs.writeFileSync(path.join(broken, 'data', 'vorversionen', 'vorversion-2026-10-01-120000.sqlite'), 'alt')
  const s = await startServerIn(tempDir(), desktopEnv(home))
  try {
    const offer = await s.api<{ candidates: (Candidate & { problem: string | null, priorVersions: number, place: unknown, names: string[] })[] }>('/api/relocation/candidates')
    const [found] = offer.candidates
    assert.equal(found?.problem, 'damaged')
    assert.equal(found?.priorVersions, 1)
    assert.deepEqual(found?.place, { folder: 'mietfuchs-0.14.1', within: 'Downloads' })
    const refused = await post(s.base, '/api/relocation/adopt', { id: found?.id })
    assert.equal(refused.status, 400)
    const text = String(refused.body.error)
    assert.match(text, /beschädigt/)
    assert.match(text, /Datei bleibt unverändert/)
    assert.match(text, /Backup/)
    assert.match(text, /vorversionen/)
    assert.doesNotMatch(text, /Öffnen Sie das alte Mietfuchs/)
    assert.doesNotMatch(text, /weiterarbeiten/)
  } finally {
    s.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// Praxistest G: Die Absage passt zum Knopf „Ordner der alten Programmdatei wählen …“; „Erneut suchen“ sucht wirklich neu
test('Praxistest G: falscher Ordner gewählt, verständliche Absage; erneut suchen ohne gemerkte Funde', async () => {
  const home = tempDir()
  fs.mkdirSync(path.join(home, 'Downloads'), { recursive: true })
  const s = await startServerIn(tempDir(), desktopEnv(home))
  try {
    const empty = await post(s.base, '/api/relocation/inspect', { folder: path.join(home, 'Downloads') })
    assert.equal(empty.status, 404)
    assert.equal(empty.body.error, 'In diesem Ordner liegen keine Mietfuchs-Daten. Wählen Sie den Ordner, in dem Ihre alte Mietfuchs-Programmdatei liegt.')
    assert.deepEqual((await s.api<Offer>('/api/relocation/candidates')).candidates, [])
    // Inzwischen ist die alte Programmdatei da (etwa vom USB-Stick zurückkopiert)
    await oldFolder('database', home)
    assert.deepEqual((await s.api<Offer>('/api/relocation/candidates')).candidates, [], 'eine Minute gemerkt')
    assert.equal((await s.api<Offer>('/api/relocation/candidates?fresh=1')).candidates?.length, 1, 'erneut suchen sucht neu')
  } finally {
    s.stop()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

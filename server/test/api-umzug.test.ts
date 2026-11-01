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

type Candidate = { dataDir: string, kind: string, modifiedAt: string | null, properties: number | null, tenancies: number | null, running: boolean, source: string }
type Offer = { offered: boolean, candidates?: Candidate[], searched?: boolean, complete?: boolean }

async function post(base: string, urlPath: string, body: unknown = {}): Promise<{ status: number, body: Record<string, unknown> }> {
  const res = await fetch(`${base}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

test('Umzug: nur im Fenster, nicht im Browserbetrieb, nicht mit Bestand', async () => {
  const old = await oldFolder()
  const npm = await startServerIn(tempDir(), { NKA_TEST_HOME: old.home })
  try {
    assert.deepEqual(await npm.api<Offer>('/api/relocation'), { offered: false })
    assert.deepEqual(await npm.api<Offer>('/api/relocation/candidates'), { offered: false })
    assert.equal((await post(npm.base, '/api/relocation/adopt', { dataDir: old.data })).status, 409)
  } finally {
    npm.stop()
  }
  const desk = await startServerIn(tempDir(), desktopEnv(old.home))
  try {
    assert.equal((await desk.api<Offer>('/api/relocation')).offered, true)
    // Ein eigener Bestand: dann gibt es nichts umzuziehen
    await desk.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Neu', areaM2: 50, participates: true }) })
    assert.deepEqual(await desk.api<Offer>('/api/relocation'), { offered: false })
    assert.equal((await post(desk.base, '/api/relocation/adopt', { dataDir: old.data })).status, 409)
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

    const adopted = await post(s.base, '/api/relocation/adopt', { dataDir: old.data })
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
    const adopted = await post(s.base, '/api/relocation/adopt', { dataDir: old.data })
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
    const adopted = await post(s.base, '/api/relocation/adopt', { dataDir: old.data })
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
    const refused = await post(s.base, '/api/relocation/adopt', { dataDir: old.data })
    assert.equal(refused.status, 409)
    assert.match(String(refused.body.error), /altes Mietfuchs.*beenden|beenden Sie/i)
    assert.equal(fs.existsSync(path.join(old.data, 'umgezogen.json')), false)
    const quit = await post(s.base, '/api/relocation/quit-old')
    assert.equal(quit.status, 200)
    assert.equal(quit.body.stopped, true)
    assert.equal(quitCalls, 1)
    assert.equal((await post(s.base, '/api/relocation/adopt', { dataDir: old.data })).status, 200)
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
      const refused = await post(s.base, '/api/relocation/adopt', { dataDir })
      assert.equal(refused.status, 400, `${dataDir}: ${JSON.stringify(refused.body)}`)
      assert.match(String(refused.body.error), /unverändert/)
      // Nichts von einem nächsten Start: Der Umzug versucht es nicht von selbst erneut
      assert.doesNotMatch(String(refused.body.error), /nächsten Start/)
      assert.deepEqual(await s.api<Tenancy[]>('/api/tenancies'), [])
      assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'uploads')), [])
      assert.equal((await s.api<Offer>('/api/relocation')).offered, true, 'der Bildschirm bleibt')
    }
    assert.match(String((await post(s.base, '/api/relocation/adopt', { dataDir: newer.data })).body.error), /neueren Mietfuchs-Version/)
    assert.deepEqual([broken, wrongJson, newer.program].map((dir) => fingerprint(dir)), prints)
    // Reste der Kopie bleiben nicht liegen
    assert.deepEqual(fs.readdirSync(s.dataDir).filter((n) => n.startsWith('restore-') || n.includes('.restore-')), [])
    // Ein Ordner ohne Bestand, der eigene Ordner und ein relativer Pfad werden abgelehnt
    assert.equal((await post(s.base, '/api/relocation/adopt', { dataDir: path.join(home, 'Downloads') })).status, 404)
    assert.equal((await post(s.base, '/api/relocation/adopt', { dataDir: s.dataDir })).status, 400)
    assert.equal((await post(s.base, '/api/relocation/adopt', { dataDir: 'data' })).status, 400)
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
test('Vermerk: auch eine alte db.json wird angezeigt, ohne dass sich im Ordner etwas ändert', async () => {
  for (const kind of ['json', 'database'] as const) {
    const old = await oldFolder(kind)
    fs.writeFileSync(path.join(old.data, 'umgezogen.json'), JSON.stringify({ version: 1, movedTo: '/neu', at: '2026-11-01T10:15:00.000Z', appVersion: '0.15.0' }))
    if (kind === 'database') {
      // Eine Datenbank aus einer früheren Fassung: Ein Schritt der Kette fehlt noch
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(path.join(old.data, 'mietfuchs.sqlite'))
      db.exec('DELETE FROM __drizzle_migrations WHERE id = (SELECT max(id) FROM __drizzle_migrations)')
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
    const adopted = await post(s.base, '/api/relocation/adopt', { dataDir: old.data })
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
    const adopted = await post(s.base, '/api/relocation/adopt', { dataDir: old.data })
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
    const adopted = await post(s.base, '/api/relocation/adopt', { dataDir: data })
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

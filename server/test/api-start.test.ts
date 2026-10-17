// Integrationstests gegen den echten Server: Start, Datenbank und Umstieg beim Start, zweiter Start, Update-Hinweis und Versanddatum.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { LEGACY_JSON_NAME } from '../src/db/changeover.ts'
import { connect, loadMigrations } from '../src/db/client.ts'
import { readClosedSettlements } from '../src/db/read.ts'
import { LAW_AS_OF } from '../../shared/law/register.ts'
import { calendarPeriod } from '../../shared/period.ts'
import type { CostItem, Settlement, TaxReport, Tenancy, Unit, UpdateStatus } from '../../shared/types.ts'
import {
  type ClientSettings, type GitHub, type HealthReport, type Server, dataDirAtBaseline, databaseOfV080, errorFrom, fakeGitHub, inDatabase, jsonOf, listenInTestRange, listening, portOf, removeDataDir, restore, serverRoot, startServer, startServerIn, startServerRaw, storedDb, waitForExit,
} from '../testing/api.ts'

let srv: Awaited<ReturnType<typeof startServerIn>>

before(async () => {
  srv = await startServer()
})

after(() => srv?.stop())

test('Healthcheck: /healthz antwortet als JSON mit Status ok', async () => {
  // Antwortete hier die index.html, stünde die Route hinter dem Frontend-Catch-All — dann
  // meldete ein kaputter Container HTTP 200.
  const report = await srv.api<HealthReport>('/healthz')
  assert.equal(report.status, 'ok')
  assert.equal(report.checks.data.ok, true)
  assert.equal(report.checks.uploads.ok, true)
})

// ---------- Die Datenbank beim Start (#55) ----------

test('Start: die Datenbank entsteht neben den Daten und steht im Zustandsbericht', async () => {
  // Geöffnet wird sie schon jetzt, obwohl noch keine fachlichen Daten darin liegen. Nur so
  // bündelt Bun das eingebaute SQLite in die Programmdatei, und nur so sagen die Prüfläufe auf
  // 22 Distributionen etwas über den Weg, den ein Vermieter wirklich geht.
  const report = await srv.api<HealthReport>('/healthz')
  if (!report.database) assert.fail(`der Zustandsbericht nennt die Datenbank nicht: ${JSON.stringify(report)}`)
  assert.equal(report.database.open, true, report.database.detail)
  assert.equal(report.database.file, path.join(srv.dataDir, 'mietfuchs.sqlite'))
  assert.ok(report.database.migrations >= 1, 'beim ersten Start laufen die Migrationen')
  assert.ok(fs.existsSync(report.database.file), 'die Datei liegt wirklich da')
})

test('Start: ohne db.json gibt es nichts zu übernehmen', async () => {
  // Der Wegwerf-Ordner ist leer, die db.json entsteht erst beim ersten Speichern. Der Umstieg
  // läuft trotzdem und sagt, dass er nichts zu tun hatte.
  const report = await srv.api<HealthReport>('/healthz')
  assert.equal(report.database?.changeover.state, 'none', JSON.stringify(report.database))
})

// ---------- Der Umstieg beim Start (#55) ----------

test('Start: eine vorhandene db.json wandert beim ersten Start in die Datenbank', async () => {
  // Der Weg, den ein Vermieter beim Update wirklich geht: Er startet die neue Version, und
  // seine Daten sind da. Kein Befehl, keine Rückfrage.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [{
      id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2,
      personHistory: [{ from: '2024-01-01', persons: 2 }], start: '2024-01-01', end: null,
      prepayments: [{ from: '2024-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [],
    }],
    costItems: [{ id: 'c1', year: 2024, category: 'Müllabfuhr', description: 'Abfall', amountCents: 12000, key: 'area' }],
    meters: [], readings: [], payments: [], closedSettlements: [],
  }))
  const s = await startServerIn(dataDir)
  try {
    const report = await s.api<HealthReport>('/healthz')
    assert.equal(report.database?.changeover.state, 'done', JSON.stringify(report.database))
    assert.match(String(report.database?.changeover.message), /Datenbank/)
    // Der Umstieg wendet zwar die ganze Kette an, aber auf eine neue Datei; eine Sicherung
    // davor gibt es nicht, der Rückweg ist die abgelöste db.json (#154). Also auch keine
    // zweite Meldung neben der des Umstiegs.
    assert.equal(report.database?.migrated, null)
    assert.deepEqual(fs.readdirSync(dataDir).filter((name) => name.includes('.vor-')), [])
    // Die db.json heißt danach anders, und das Protokoll liegt daneben. Ihr Inhalt bleibt der
    // Rückweg, aber unter einem Namen, den niemand für den laufenden Stand hält: Seit die Routen
    // die Datenbank schreiben, läge sie sonst tot im Ordner und sähe doch aus wie vorher.
    assert.equal(fs.existsSync(path.join(dataDir, 'db.json')), false, 'die db.json heißt noch wie vorher')
    assert.ok(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), 'die abgelöste db.json fehlt')
    assert.ok(fs.existsSync(path.join(dataDir, 'umstieg-protokoll.txt')), 'das Protokoll fehlt')
    assert.equal((await storedDb(s)).units.length, 1)
    // Und die Oberfläche bekommt die übernommenen Daten, also die aus der Datenbank.
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), ['u1'])
    // Und die Datei für den Umstieg ist weg.
    assert.equal(fs.existsSync(path.join(dataDir, 'mietfuchs.sqlite.umstieg')), false)
  } finally {
    s.stop()
  }
})

test('Start: ein Bestand, der nicht übernommen werden kann, sperrt die Datenrouten', async () => {
  // **Hier kehrt sich die Regel um, und zwar seit die Routen die Datenbank lesen.** Vorher lief
  // Mietfuchs nach einem gescheiterten Umstieg mit der db.json weiter, und Blockieren wäre
  // schlimmer gewesen als Weitermachen. Jetzt stünde bei einem „Weiter" eine leere Datenbank als
  // Antwort da: Der Vermieter sähe ein leeres Haus, und speicherte er etwas hinein, gäbe es
  // danach zwei Bestände. Seine db.json wäre für immer abgehängt, denn der nächste Umstieg
  // unterbleibt, sobald in der Datenbank etwas steht. Deshalb gilt die zweite Zusage aus
  // changeover.ts vor der ersten: nie Daten verlieren, notfalls auf Kosten des Weiterarbeitens.
  //
  // Ein negativer Zählerstand ist über die Oberfläche erzeugbar, also genau der Fall, der einem
  // echten Vermieter passieren kann.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [], costItems: [],
    meters: [{ id: 'm1', name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }],
    readings: [{ id: 'r1', meterId: 'm1', date: '2024-12-31', value: -5 }],
    payments: [], closedSettlements: [],
  }))
  const s = await startServerIn(dataDir)
  try {
    const report = await jsonOf<HealthReport>(await fetch(`${s.base}/healthz`))
    assert.equal(report.status, 'error', 'ein Container soll das sehen')
    assert.equal(report.database?.changeover.state, 'failed', JSON.stringify(report.database))
    assert.match(String(report.database?.changeover.message), /Küche/, 'die Meldung nennt die Ablesung')

    // Die Datenrouten antworten, statt eine leere Datenbank für den Bestand auszugeben.
    const units = await fetch(`${s.base}/api/units`)
    assert.equal(units.status, 503)
    assert.match(await errorFrom(units), /nicht.*übernommen|db\.json/i, 'die Meldung erklärt nichts')

    // Und der Bestand liegt unberührt da, unter seinem eigenen Namen: Gescheitert heißt, dass
    // nichts angefasst wurde.
    assert.ok(fs.existsSync(path.join(dataDir, 'db.json')), 'die db.json ist weg')
    assert.equal(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), false, 'ein gescheiterter Umstieg benennt nichts um')
  } finally {
    s.stop()
  }
})

test('Start: eine unbrauchbare Datenbank sperrt die Datenrouten', async () => {
  // Dieselbe Umkehr wie beim gescheiterten Umstieg, nur eine Stufe früher: Ohne Datenbank gibt
  // es die Daten nicht, und etwas anderes vorzugeben wäre schlimmer als die Sperre.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite'), 'das ist keine Datenbank, sondern Text')
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
  }))
  const s = await startServerIn(dataDir)
  try {
    const report = await jsonOf<HealthReport>(await fetch(`${s.base}/healthz`))
    assert.equal(report.status, 'error', 'ein Container soll das sehen')
    if (!report.database) assert.fail('der Zustandsbericht nennt die Datenbank nicht')
    assert.equal(report.database.open, false)
    assert.match(report.database.detail, /beschädigt/)
    // Die Wohnungen gibt es nicht, und die Route sagt das, statt eine leere Liste zu liefern.
    const units = await fetch(`${s.base}/api/units`)
    assert.equal(units.status, 503)
    // Ohne geöffnete Datenbank gibt es keinen Umstieg. Wer eine db.json hat, soll erfahren,
    // warum seine Daten nicht umgezogen sind, und zwar an derselben Stelle wie sonst auch.
    assert.equal(report.database.changeover.state, 'failed')
    assert.match(report.database.changeover.message, /nicht öffnen/)
  } finally {
    s.stop()
  }
})

// ---------- Start aus dem Startmenü (#45) ----------

test('Healthcheck: /healthz nennt Mietfuchs beim Namen', async () => {
  // Daran erkennt ein zweiter Start, dass auf dem Port schon Mietfuchs läuft
  assert.equal((await srv.api<HealthReport>('/healthz')).app, 'mietfuchs')
})

test('Beenden: im npm-Betrieb gibt es die Route nicht', async () => {
  // Dort beendet die Umgebung den Dienst, und ein Neustart käme von selbst
  const res = await fetch(`${srv.base}/api/quit`, { method: 'POST' })
  assert.equal(res.status, 404)
  assert.match(await errorFrom(res), /Programmdatei/)
})

test('Beenden: als Programmdatei antwortet Mietfuchs erst und endet dann', async () => {
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), { NKA_RUNTIME: 'binary' })
  try {
    // Erst die Bestätigung, dann das Ende: Sonst sähe der Browser einen Verbindungsabbruch
    assert.deepEqual(await s.api('/api/quit', { method: 'POST' }), { ok: true })
    assert.equal(await waitForExit(s.child), 0)
  } finally {
    s.stop()
  }
})

test('Belegter Port: läuft dort schon Mietfuchs, endet der zweite Start ohne Fehler', async () => {
  // Ein zweiter Klick im Startmenü ist kein Fehler. Der zweite Start öffnet nur die Oberfläche
  // (hier mit CI=true unterdrückt) und beendet sich.
  const port = new URL(srv.base).port
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const zweiter = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: 'binary' })
  try {
    assert.equal(await waitForExit(zweiter.child), 0)
    assert.match(zweiter.out(), /läuft bereits/)
  } finally {
    zweiter.child.kill()
    removeDataDir(dataDir)
  }
})

test('Belegter Port: sitzt dort etwas anderes, bleibt es bei der Fehlermeldung', async () => {
  const fremder = http.createServer((req, res) => res.end('nicht Mietfuchs'))
  // Auf allen Adressen lauschen, nicht nur auf 127.0.0.1: Windows lässt sonst eine zweite
  // Bindung an 0.0.0.0 auf demselben Port zu, und der Port wäre gar nicht belegt.
  await listening(fremder)
  const port = String(portOf(fremder))
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const start = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: 'binary' })
  try {
    // Die Programmdatei lässt die Meldung zehn Sekunden stehen, bevor sie endet. Geprüft wird
    // deshalb die Meldung, nicht das Ende.
    const deadline = Date.now() + 15000
    while (!/bereits belegt/.test(start.out()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.match(start.out(), /bereits belegt/)
  } finally {
    start.child.kill()
    fremder.close()
    removeDataDir(dataDir)
  }
})

// ---------- Zweiter Start auf belegtem Port fasst die Daten nicht an (#244) ----------

// Jede Datei im Datenordner mit ihrer Prüfsumme, Unterordner eingeschlossen. Daran sieht der
// Test jede Veränderung: eine migrierte Datenbank, eine Sicherung `vor-*`, die Merkdatei
// `sicherung-vor-update.json`, eine abgelöste db.json oder ein Protokoll des Umstiegs.
function folderFingerprint(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    result[path.relative(dir, file)] = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }
  return result
}

// Ein Datenordner, in dem der nächste Start etwas zu tun hätte: eine Datenbank, der Schritte
// fehlen (wie nach einem Update), oder eine db.json, die umsteigen will.
async function dataDirWithPendingWork(kind: 'migration' | 'changeover'): Promise<string> {
  if (kind === 'migration') {
    const dataDir = await dataDirAtBaseline()
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true })
    return dataDir
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
  }))
  return dataDir
}

// Ein freier Port: vom System vergeben, dann wieder freigegeben.
async function freePort(): Promise<number> {
  const probe = http.createServer()
  const port = await listenInTestRange(probe)
  await new Promise((resolve) => probe.close(resolve))
  return port
}

for (const kind of ['migration', 'changeover'] as const) {
  test(`Belegter Port (#244): läuft dort schon Mietfuchs, rührt der zweite Start die Daten nicht an (${kind === 'migration' ? 'ausstehende Migration' : 'ausstehender Umstieg'})`, async () => {
    // Das Update, während die alte Version noch läuft: Die neue Version darf die Datei nicht
    // unter der laufenden migrieren und keine Sicherung anlegen, hinter der die alte
    // weiterschreibt. Sie sieht nur, dass dort Mietfuchs läuft, und endet.
    const port = new URL(srv.base).port
    const dataDir = await dataDirWithPendingWork(kind)
    const vorher = folderFingerprint(dataDir)
    const zweiter = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: 'binary' })
    try {
      assert.equal(await waitForExit(zweiter.child), 0, zweiter.out())
      assert.match(zweiter.out(), /läuft bereits/)
      assert.deepEqual(folderFingerprint(dataDir), vorher, zweiter.out())
    } finally {
      zweiter.child.kill()
      removeDataDir(dataDir)
    }
  })
}

test('Belegter Port (#244): sitzt dort etwas anderes, wird vor der Fehlermeldung nichts migriert', async () => {
  const fremder = http.createServer((req, res) => res.end('nicht Mietfuchs'))
  await listening(fremder)
  const port = String(portOf(fremder))
  const dataDir = await dataDirWithPendingWork('migration')
  const vorher = folderFingerprint(dataDir)
  // Im npm-Betrieb endet der Start sofort mit Fehler; das ist der kürzere Weg zum Ende.
  const start = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: '' })
  try {
    assert.equal(await waitForExit(start.child), 1, start.out())
    assert.match(start.out(), /bereits belegt/)
    assert.deepEqual(folderFingerprint(dataDir), vorher, start.out())
  } finally {
    start.child.kill()
    fremder.close()
    removeDataDir(dataDir)
  }
})

test('Belegter Port (#244): ein zweiter Start, während der erste noch die Datenbank öffnet, erkennt Mietfuchs', async () => {
  // Das Rennen zweier gleichzeitiger Starts: Der erste bindet den Port, bevor er die Datenbank
  // anfasst. Solange er noch öffnet, antwortet /healthz mit „startet“ und nennt sich beim Namen.
  // Der Testgriff hält den ersten Start in diesem Fenster fest.
  const port = String(await freePort())
  const ersterOrdner = await dataDirWithPendingWork('migration')
  const erster = startServerRaw(ersterOrdner, { NKA_PORT: port, NKA_RUNTIME: 'binary', NKA_TEST_START_DELAY_MS: '3000' })
  const dataDir = await dataDirWithPendingWork('migration')
  try {
    const deadline = Date.now() + 15000
    let report: { app?: string, status?: string } = {}
    let status = 0
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`)
        status = res.status
        report = await jsonOf<typeof report>(res)
        break
      } catch {
        await new Promise((r) => setTimeout(r, 50))
      }
    }
    assert.equal(status, 503, erster.out())
    assert.deepEqual([report.app, report.status], ['mietfuchs', 'starting'])
    // Der erste hat in diesem Augenblick noch nichts angefasst.
    assert.equal(fs.readdirSync(ersterOrdner).some((name) => name.includes('.vor-')), false)
    // Eine Datenroute, **jetzt** gefragt, also mitten im Starten: Sie wartet, bis der Start fertig
    // ist, und bekommt dann eine gewöhnliche Antwort statt einer 503 (Durchsicht zu #244, K1).
    // Ebenso ein Schreibvorgang mit Rumpf, der dabei nicht verloren gehen darf.
    const gefragt = Date.now()
    const waehrendLesen = fetch(`http://127.0.0.1:${port}/api/units`).then(async (res) => ({ status: res.status, nach: Date.now() - gefragt }))
    const waehrendSchreiben = fetch(`http://127.0.0.1:${port}/api/units`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'mitten im Start', areaM2: 50, participates: true }),
    }).then(async (res) => ({ status: res.status, body: await res.text() }))
    const vorher = folderFingerprint(dataDir)
    const zweiter = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: 'binary' })
    try {
      assert.equal(await waitForExit(zweiter.child), 0, zweiter.out())
      assert.deepEqual(folderFingerprint(dataDir), vorher, zweiter.out())
    } finally {
      zweiter.child.kill()
    }
    const lesen = await waehrendLesen
    assert.equal(lesen.status, 200, `nach ${lesen.nach} ms: ${erster.out()}`)
    const schreiben = await waehrendSchreiben
    assert.equal(schreiben.status, 201, schreiben.body)
    assert.match(erster.out(), /Mietfuchs-Server läuft auf/)
    const namen = (await jsonOf<Unit[]>(await fetch(`http://127.0.0.1:${port}/api/units`))).map((u) => u.name)
    assert.deepEqual(namen, ['mitten im Start'])
    assert.ok(fs.readdirSync(ersterOrdner).some((name) => name.includes('.vor-')), 'der erste Start hat danach migriert')
  } finally {
    erster.child.kill()
    await waitForExit(erster.child).catch(() => null)
    removeDataDir(ersterOrdner)
    removeDataDir(dataDir)
  }
})

test('Belegter Port (#244): antwortet Mietfuchs dort erst nach Sekunden, wartet der zweite Start und erkennt es', async () => {
  // Rechnet der erste Start gerade einen langen Abschnitt, der die Ereignisschleife blockiert
  // (die Regression des Umstiegs über viele Jahre, ein großer Migrationsschritt), antwortet sein
  // /healthz erst danach. Der zweite Start darf ihn deshalb nicht nach dem ersten Zeitlimit für ein
  // fremdes Programm halten (Durchsicht zu #244, K2). Nachgestellt mit einem Dienst, der ab der
  // **ersten Anfrage** fünf Sekunden lang nichts beantwortet und danach jede Anfrage als
  // Mietfuchs, so wie eine Ereignisschleife, die danach wieder frei ist. Das Zeitlimit einer
  // einzelnen Frage (zwei Sekunden) liegt darunter; also kommt die Antwort nur bei einer zweiten
  // oder späteren Frage an, und das zählt der Dienst mit (Durchsicht Runde 2, N1: ab dem Start
  // gerechnet hing es an der Startzeit von Node, ob schon die erste Frage durchkam).
  let frei = Infinity
  let anfragen = 0
  const langsam = http.createServer((req, res) => {
    anfragen++
    if (frei === Infinity) frei = Date.now() + 5000
    setTimeout(() => {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ app: 'mietfuchs', status: 'starting' }))
    }, Math.max(0, frei - Date.now()))
  })
  const port = String(await listenInTestRange(langsam))
  const dataDir = await dataDirWithPendingWork('migration')
  const vorher = folderFingerprint(dataDir)
  const zweiter = startServerRaw(dataDir, { NKA_PORT: port, NKA_RUNTIME: 'binary' })
  try {
    assert.equal(await waitForExit(zweiter.child, 30000), 0, zweiter.out())
    assert.match(zweiter.out(), /läuft bereits/)
    assert.doesNotMatch(zweiter.out(), /anderes Programm/)
    assert.ok(anfragen >= 2, `nur ${anfragen} Anfrage(n): Der zweite Start hat nicht nachgefragt`)
    assert.deepEqual(folderFingerprint(dataDir), vorher, zweiter.out())
  } finally {
    zweiter.child.kill()
    langsam.closeAllConnections()
    langsam.close()
    removeDataDir(dataDir)
  }
})

// Dieselbe Falle wie bei PUT /api/settings, hier in den generischen CRUD-Routen: express.json()
// lässt auch eine Liste als Rumpf durch. Deren Indizes landeten als Schlüssel „0“, „1“ … im
// Datensatz und blieben in der db.json stehen. Geprüft an /api/units, die Routen entstehen für
// alle sechs Collections in derselben Schleife.

// Die Spalten der Wohnungstabelle, wie SQLite sie wirklich führt. Das ist der einzige Ort, an
// dem sich ein zusätzliches Feld zeigen könnte: Ein eingelesener Datensatz hat immer genau die
// Schlüssel, die read.ts hinschreibt.
const UNIT_COLUMNS = ['id', 'property_id', 'name', 'area_m2', 'participates', 'self_used', 'self_persons', 'mea', 'rooms', 'floor', 'notes']

async function unitColumns(dataDir: string): Promise<string[]> {
  const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
  try {
    return connection.rows(`SELECT name FROM pragma_table_info('units')`).map((zeile) => String(zeile[0]))
  } finally {
    connection.close()
  }
}

test('Anlegen: ein Rumpf, der kein Objekt ist, legt keine Indizes als Felder an', async () => {
  const res = await fetch(`${srv.base}/api/units`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(['unsinn', 'noch mehr']),
  })
  assert.equal(res.status, 201)
  const created = await jsonOf<Unit>(res)
  try {
    // **Gefragt werden die Spalten und nicht der eingelesene Bestand.** read.ts baut jede Zeile
    // als Objektliteral mit festen Schlüsseln; ein `'0' in stored` darüber könnte gar nicht mehr
    // wahr werden und prüfte deshalb nichts. Die Spalten der Tabelle sind die einzige Stelle, an
    // der sich ein zusätzliches Feld überhaupt zeigen könnte, und sie sagen zugleich, warum es
    // seit #60 keines mehr geben kann: Für ein unbekanntes Feld gibt es keinen Ort.
    assert.deepEqual(await unitColumns(srv.dataDir), UNIT_COLUMNS, 'die Tabelle hat eine Spalte zu viel')
    assert.ok(!('0' in created))
    const listed = (await srv.api<Unit[]>('/api/units')).find((u) => u.id === created.id)
    assert.ok(listed && !('0' in listed))
    // Und aus einem Rumpf, der kein Objekt ist, wird ein leerer Datensatz und kein Unsinn.
    assert.equal(created.name, '')
  } finally {
    await srv.api(`/api/units/${created.id}`, { method: 'DELETE' })
  }
})

test('Ändern: ein Rumpf, der kein Objekt ist, lässt den Datensatz unangetastet', async () => {
  const unit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'Rumpfprobe', areaM2: 50, participates: true }),
  })
  try {
    const res = await fetch(`${srv.base}/api/units/${unit.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['unsinn', 'noch mehr']),
    })
    assert.equal(res.status, 200)
    const updated = await jsonOf<Unit>(res)
    // Zuerst die Platte: Der Schaden bestand im dauerhaften Speichern. Gefragt werden die
    // Spalten, siehe die Begründung beim Anlegen darüber.
    assert.deepEqual(await unitColumns(srv.dataDir), UNIT_COLUMNS, 'die Tabelle hat eine Spalte zu viel')
    const stored = (await storedDb(srv)).units.find((u) => u.id === unit.id)
    assert.equal(stored?.name, 'Rumpfprobe', 'der Datensatz ist angetastet worden')
    assert.equal(stored?.areaM2, 50)
    assert.ok(!('0' in updated))
    assert.equal(updated.name, 'Rumpfprobe')
  } finally {
    await srv.api(`/api/units/${unit.id}`, { method: 'DELETE' })
  }
})

test('Wohnungen: Eigennutzungs-Felder überleben Anlegen und Ändern', async () => {
  const unit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 }),
  })
  assert.equal(unit.selfUsed, true)
  assert.equal(unit.selfPersons, 2)
  const updated = await srv.api<Unit>(`/api/units/${unit.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true, selfUsed: false, selfPersons: null }),
  })
  assert.equal(updated.selfUsed, false)
  // **Geleert heißt seit dem Umstieg „nicht da" und nicht mehr `null`.** Die Oberfläche schickt
  // zum Leeren weiterhin `null` (unitForm.ts), aber `Unit.selfPersons` ist als `number | undefined`
  // beschrieben und kennt gar kein `null`. Die db.json legte jeden Wert unbesehen ab und gab
  // deshalb `null` zurück, was dem eigenen Typ widersprach; die Spalte kennt nur NULL, und
  // read.ts macht daraus das fehlende Feld, das der Typ vorsieht. Für die Berechnung ist beides
  // dasselbe, nämlich keine Zahl.
  assert.equal(updated.selfPersons, undefined)
  await srv.api(`/api/units/${unit.id}`, { method: 'DELETE' })
})

test('Staffel: zwei Einträge zum selben Stichtag werden angenommen, der letzte gilt', async () => {
  // **Das ist über die Oberfläche erzeugbar und deshalb keine Spitzfindigkeit.** Stammdaten.tsx
  // setzt für eine Staffelzeile ohne Monat den Einzugsmonat ein und prüft nie auf Doppelung;
  // zwei so ausgefüllte Zeilen ergeben zwei Einträge zum selben Stichtag. Über die db.json war
  // das hingenommen, in der Datenbank ist der Stichtag Teil des Primärschlüssels.
  //
  // Angenommen wird es trotzdem, und zwar nach derselben Regel, die legacy/migrate.ts beim Umstieg
  // anwendet und calc.ts beim Rechnen: **Es gilt der letzte.** Alles andere wäre ein Rückschritt
  // gegenüber der db.json, und zwar bei einer ganz gewöhnlichen Eingabe.
  const unit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'Staffelprobe', areaM2: 60, participates: true }),
  })
  try {
    const tenancy = await srv.api<Tenancy>('/api/tenancies', {
      method: 'POST',
      body: JSON.stringify({
        unitId: unit.id, tenantName: 'Doppelt', start: '2024-01-01', end: null, persons: 1,
        personHistory: [{ from: '2024-01-01', persons: 1 }, { from: '2024-01-01', persons: 3 }],
        prepayments: [{ from: '2024-01', monthlyCents: 10000 }, { from: '2024-01', monthlyCents: 25000 }],
        baseRents: [{ from: '2024-01', monthlyCents: 50000 }, { from: '2024-01', monthlyCents: 60000 }],
        prepaymentOverrides: {},
      }),
    })
    assert.deepEqual(tenancy.prepayments, [{ from: '2024-01', monthlyCents: 25000 }])
    assert.deepEqual(tenancy.baseRents, [{ from: '2024-01', monthlyCents: 60000 }])
    assert.deepEqual(tenancy.personHistory, [{ from: '2024-01-01', persons: 3 }])

    // Und beim Ändern genauso: Derselbe Weg, dieselbe Regel.
    const geaendert = await srv.api<Tenancy>(`/api/tenancies/${tenancy.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        prepayments: [{ from: '2025-01', monthlyCents: 11100 }, { from: '2025-01', monthlyCents: 22200 }],
      }),
    })
    assert.deepEqual(geaendert.prepayments, [{ from: '2025-01', monthlyCents: 22200 }])
  } finally {
    await srv.api(`/api/units/${unit.id}`, { method: 'DELETE' })
  }
})

test('Fehler der Datenbank kommen als Satz an, nicht als SQL mit den Daten des Nutzers', async () => {
  // **Der teuerste Teil einer durchgereichten Drizzle-Meldung sind nicht das SQL, sondern die
  // Werte.** Sie lautet „Failed query: insert into … params: t1,2024-01,200", enthält also die
  // eigenen Daten des Nutzers in einer Fehlermeldung. db/errors.ts ist dafür geschrieben; dieser
  // Test hält fest, dass es an den Routen auch wirklich angewendet wird. Ohne ihn war es
  // importiert und niemals aufgerufen.
  //
  // Ausgelöst über einen Verweis ins Leere, weil das der Fall ist, den ein fremdes Skript an der
  // Schnittstelle am ehesten erzeugt.
  const res = await fetch(`${srv.base}/api/readings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meterId: 'gibt-es-nicht', date: '2024-12-31', value: 100 }),
  })
  assert.equal(res.status, 400, 'ein Verweis ins Leere kommt aus der Anfrage und nicht vom Server')
  const fehler = await errorFrom(res)
  assert.doesNotMatch(fehler, /Failed query|insert into|params:/, 'SQL oder Werte in der Meldung')
  assert.doesNotMatch(fehler, /gibt-es-nicht/, 'die Eingabe des Nutzers steht in der Meldung')
  assert.match(fehler, /verweist auf etwas|gibt es nicht|nicht mehr/i, 'die Meldung erklärt nichts')
})

test('Abrechnung: Eigenanteil kommt über die Route beim Frontend an', async () => {
  const selfUsedUnit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 }),
  })
  const rentedUnit = await srv.api<Unit>('/api/units', {
    method: 'POST',
    body: JSON.stringify({ name: 'OG', areaM2: 150, participates: true }),
  })
  const tenancy = await srv.api<Tenancy>('/api/tenancies', {
    method: 'POST',
    body: JSON.stringify({
      unitId: rentedUnit.id, tenantName: 'Familie A', start: '2020-01-01', end: null,
      personHistory: [{ from: '2020-01-01', persons: 2 }], prepayments: [], baseRents: [], prepaymentOverrides: {},
    }),
  })
  const costItem = await srv.api<CostItem>('/api/costItems', {
    method: 'POST',
    body: JSON.stringify({ year: 2031, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' }),
  })

  const s = await srv.api<Settlement>('/api/settlement/2031')
  assert.equal(s.statements[0].totalShareCents, 150000) // 150 von 230 m²
  assert.equal(s.landlord.totalCents, 80000)
  assert.equal(s.selfUsedShareCents, 80000)

  const tax = await srv.api<TaxReport>('/api/taxreport/2031')
  assert.equal(tax.selfUsedShareCents, 80000)
  assert.equal(tax.selfOccupiedExists, true)

  await srv.api(`/api/costItems/${costItem.id}`, { method: 'DELETE' })
  await srv.api(`/api/tenancies/${tenancy.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${selfUsedUnit.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${rentedUnit.id}`, { method: 'DELETE' })
})

test('Löschen einer Wohnung entfernt ihren vereinbarten Prozentanteil', async () => {
  const a = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'A', areaM2: 50, participates: true }) })
  const b = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'B', areaM2: 50, participates: true }) })
  const item = await srv.api<CostItem>('/api/costItems', {
    method: 'POST',
    body: JSON.stringify({
      year: 2032, category: 'Sonstige Betriebskosten', description: 'Vereinbart',
      amountCents: 100000, key: 'custom', customShares: { [a.id]: 40, [b.id]: 60 },
    }),
  })
  await srv.api(`/api/units/${b.id}`, { method: 'DELETE' })
  const items = await srv.api<CostItem[]>('/api/costItems')
  const itemAfter = items.find((x) => x.id === item.id)
  // Verschwundene Position und fehlender Schlüssel wären andere Befunde als ein
  // zurückgebliebener Anteil, deshalb hier prüfen statt einen leeren Schlüssel einzusetzen.
  if (!itemAfter) assert.fail('die Kostenposition ist verschwunden')
  if (!itemAfter.customShares) assert.fail('der vereinbarte Schlüssel der Position fehlt ganz')
  assert.deepEqual(Object.keys(itemAfter.customShares), [a.id], 'Anteil der gelöschten Wohnung bleibt zurück')

  await srv.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
  await srv.api(`/api/units/${a.id}`, { method: 'DELETE' })
})

test('Standardmodell: eine neue Installation nutzt qwen3.5:4b', async () => {
  assert.equal((await srv.api<ClientSettings>('/api/settings')).ollamaModel, 'qwen3.5:4b')
})

test('Standardmodell: das frühere, nie vorhandene qwen3.6-35b wird umgestellt, andere Modelle bleiben', async () => {
  // „qwen3.6-35b“ gab es in der Ollama-Bibliothek nie (gemeint war qwen3.6:35b), wer es nicht
  // geändert hat, konnte also gar nicht auswerten. Eine eigene Wahl bleibt unangetastet.
  const cases: [string, string][] = [['qwen3.6-35b', 'qwen3.5:4b'], ['gemma4:12b', 'gemma4:12b']]
  for (const [stored, expected] of cases) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-alt-'))
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ settings: { ollamaModel: stored } }))
    const s = await startServerIn(dataDir)
    try {
      assert.equal((await s.api<ClientSettings>('/api/settings')).ollamaModel, expected, stored)
    } finally {
      s.stop()
    }
  }
})

test('Vor dieser Version eingefrorene Abrechnung liefert einen Eigenanteil von 0', async () => {
  // Altbestand nachbauen: ein Snapshot, der das Feld noch nicht kennt. Die Route muss die
  // in types.ts zugesagte Form trotzdem einhalten, sonst rechnet das Frontend mit undefined.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-alt-'))
  fs.writeFileSync(
    path.join(dataDir, 'db.json'),
    JSON.stringify({
      settings: {}, units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [],
      closedSettlements: [
        {
          id: 'alt', year: 2030, closedAt: '2031-01-05', sentAt: null,
          settlement: { year: 2030, daysInYear: 365, statements: [], landlord: { rows: [], totalCents: 0 }, totalCostsCents: 0, warnings: [] },
        },
      ],
    }),
  )
  const legacyServer = await startServerIn(dataDir)
  try {
    const s = await legacyServer.api<Settlement>('/api/settlement/2030')
    assert.equal(s.selfUsedShareCents, 0)
    assert.equal(s.closed?.closedAt, '2031-01-05')
  } finally {
    legacyServer.stop()
  }
})

// ---------- Versanddatum der abgeschlossenen Abrechnung (§556 BGB) ----------
//
// An diesem Datum hängt die Frist aus §556 BGB, und die Oberfläche vergleicht es als
// Zeichenkette mit dem 31.12. des Folgejahrs. Ein beliebiger Wert aus dem Rumpf der Anfrage
// darf dort deshalb nie ankommen — er bliebe dauerhaft in der db.json stehen.

// Der eingefrorene Stand eines Jahres, so wie er auf der Platte steht. Gelesen wird die
// gespeicherte Fassung und nicht die Sicht des Schnappschusses: Geprüft wird hier `sentAt`,
// und das liest die Berechnung gar nicht.
const closedOf = async (s: { dataDir: string }, year: number) =>
  (await inDatabase(s, readClosedSettlements)).find((c) => c.period === calendarPeriod(year))

// Alles, was kein Datum als JJJJ-MM-TT ist: falscher Typ, deutsche Schreibweise, Zeitstempel
// und Tage, die es im Kalender nicht gibt.
const NO_DATES: unknown[] = [
  42, true, { tag: 1 }, ['2041-03-14'], 'morgen', '14.03.2041', '2041-03-14T10:00:00Z', '2041-02-30', '2041-13-01',
]

// Eine Anfrage, die scheitern soll — s.api wirft sonst schon am Status.
const closeRequest = (method: string, year: number, body: unknown): Promise<Response> =>
  fetch(`${srv.base}/api/settlement/${year}/close`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('Versanddatum: ohne Angabe abgeschlossen, mit Datum nachgetragen, leer wieder gelöscht', async () => {
  await srv.api('/api/settlement/2040/close', { method: 'POST', body: JSON.stringify({}) })
  assert.equal((await closedOf(srv, 2040))?.sentAt, null)

  // So schickt es die Oberfläche aus <input type="date">
  await srv.api('/api/settlement/2040/close', { method: 'PUT', body: JSON.stringify({ sentAt: '2041-03-14' }) })
  assert.equal((await closedOf(srv, 2040))?.sentAt, '2041-03-14')

  // Ein geleertes Feld heißt „doch noch nicht versendet"
  await srv.api('/api/settlement/2040/close', { method: 'PUT', body: JSON.stringify({ sentAt: null }) })
  assert.equal((await closedOf(srv, 2040))?.sentAt, null)

  await srv.api('/api/settlement/2040/close', { method: 'DELETE' })
})

test('Abschließen friert Hinweise und Rechtsstand mit ein (#112)', async () => {
  // Gespeichert und nicht beim Lesen neu gerechnet: Eine spätere Änderung am Regelverzeichnis
  // darf eine versandte Abrechnung nicht rückwirkend anders erklären.
  await srv.api('/api/settlement/2044/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const gespeichert = (await closedOf(srv, 2044))?.settlement
    if (!gespeichert || typeof gespeichert !== 'object') return assert.fail('keine eingefrorene Abrechnung')
    const stand = Reflect.get(gespeichert, 'legalBasis')
    assert.equal(Reflect.get(stand, 'asOf'), LAW_AS_OF)
    assert.ok(Array.isArray(Reflect.get(stand, 'rules')))
    assert.ok(Array.isArray(Reflect.get(stand, 'values')), 'seit Heizung PR 1 frieren die Rechtswerte mit ein')
    assert.ok(Array.isArray(Reflect.get(gespeichert, 'notices')))
    const geliefert = await srv.api<{ legalBasis?: { asOf: string }, notices?: unknown[] }>('/api/settlement/2044')
    assert.equal(geliefert.legalBasis?.asOf, LAW_AS_OF)
    assert.ok(Array.isArray(geliefert.notices))
  } finally {
    await srv.api('/api/settlement/2044/close', { method: 'DELETE' })
  }
})

test('Abschließen friert die Rechtswerte ein, und direkt danach weicht keiner ab (Heizung PR 1)', async () => {
  const u = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Recht', areaM2: 50, participates: true }) })
  await srv.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({
    unitId: u.id, tenantName: 'Rechtswert', persons: 1, personHistory: [], start: '2049-01-01', end: '2049-12-31',
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }) })
  await srv.api('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2049, category: 'Heizung und Warmwasser', description: 'Heizöl', amountCents: 50000, key: 'area' }) })
  await srv.api('/api/settlement/2049/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const gespeichert = (await closedOf(srv, 2049))?.settlement
    if (!gespeichert || typeof gespeichert !== 'object') return assert.fail('keine eingefrorene Abrechnung')
    const values = Reflect.get(Reflect.get(gespeichert, 'legalBasis'), 'values')
    if (!Array.isArray(values)) return assert.fail('keine Rechtswerte eingefroren')
    const cut = values.find((v) => Reflect.get(v, 'id') === 'hkv.cut.not-by-consumption')
    assert.equal(Reflect.get(cut, 'text'), '15 %')
    const geliefert = await srv.api<Settlement>('/api/settlement/2049')
    assert.ok(geliefert.legalBasis?.values?.some((v) => v.id === 'hkv.cut.not-by-consumption'))
    assert.deepEqual(geliefert.deviation?.valueChanges, [])
  } finally {
    await srv.api('/api/settlement/2049/close', { method: 'DELETE' })
  }
})

test('Abgeschlossenes Jahr: weicht die heutige Berechnung ab, sagt die Antwort es je Mieter (#56)', async () => {
  const u = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Abw', areaM2: 50, participates: true }) })
  const t = await srv.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({
    unitId: u.id, tenantName: 'Abweichung', persons: 1, personHistory: [], start: '2047-01-01', end: '2047-12-31',
    prepayments: [{ from: '2047-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [],
  }) })
  const k = await srv.api<{ id: string }>('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2047, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'direct', directUnitId: u.id }) })
  await srv.api('/api/settlement/2047/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const vorher = await srv.api<Settlement>('/api/settlement/2047')
    assert.deepEqual(vorher.deviation?.deviations, [], 'direkt nach dem Abschluss weicht nichts ab')
    assert.equal(vorher.deviation?.comparable, true)
    await srv.api(`/api/costItems/${k.id}`, { method: 'PUT', body: JSON.stringify({ amountCents: 40000 }) })
    const nachher = await srv.api<Settlement>('/api/settlement/2047')
    const d = nachher.deviation?.deviations.find((x) => x.tenancyId === t.id)
    assert.deepEqual([d?.differenceCents, d?.direction], [10000, 'tenant'])
    assert.equal(nachher.deviation?.deadline, '2048-12-31')
    const eingefroren = nachher.statements.find((st) => st.tenancyId === t.id)
    assert.equal(eingefroren?.totalShareCents, 50000, 'der eingefrorene Stand bleibt, wie er war')
  } finally {
    await srv.api('/api/settlement/2047/close', { method: 'DELETE' })
  }
})

// #311: Eine abgeschlossene Abrechnung mit Einzug zur Monatsmitte bleibt, wie sie versendet wurde.
// Der alte Stand (März ohne Vorauszahlung) ist mit einer Staffel ab April nachgestellt; danach wird
// die Staffel auf März gesetzt, und die heutige Rechnung setzt den März anteilig an.
test('Abgeschlossenes Jahr mit Einzug am 15.03.: eingefroren bleibt 1.350 €, die Abweichung nennt 82,26 € zugunsten des Mieters (#311)', async () => {
  const u = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Teilmonat', areaM2: 50, participates: true }) })
  const t = await srv.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({
    unitId: u.id, tenantName: 'Einzug Mitte März', persons: 1, personHistory: [], start: '2046-03-15', end: '2046-12-31',
    prepayments: [{ from: '2046-04', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [],
  }) })
  await srv.api('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2046, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'direct', directUnitId: u.id }) })
  await srv.api('/api/settlement/2046/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    await srv.api(`/api/tenancies/${t.id}`, { method: 'PUT', body: JSON.stringify({ prepayments: [{ from: '2046-03', monthlyCents: 15000 }] }) })
    const s = await srv.api<Settlement>('/api/settlement/2046')
    const eingefroren = s.statements.find((st) => st.tenancyId === t.id)
    assert.equal(eingefroren?.prepaymentCents, 135000, 'der eingefrorene Stand bleibt, wie er war')
    const d = s.deviation?.deviations.find((x) => x.tenancyId === t.id)
    assert.deepEqual([d?.differenceCents, d?.direction], [8226, 'tenant'])
  } finally {
    await srv.api('/api/settlement/2046/close', { method: 'DELETE' })
  }
})

test('Wiederöffnen behält den verschickten Stand im Verlauf, erneutes Abschließen legt einen weiteren daneben (#56)', async () => {
  const u = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Verlauf', areaM2: 50, participates: true }) })
  await srv.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({
    unitId: u.id, tenantName: 'Verlauf', persons: 1, personHistory: [], start: '2048-01-01', end: '2048-12-31',
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }) })
  const k = await srv.api<{ id: string }>('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2048, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 30000, key: 'direct', directUnitId: u.id }) })
  await srv.api('/api/settlement/2048/close', { method: 'POST', body: JSON.stringify({ sentAt: '2049-02-01' }) })
  await srv.api('/api/settlement/2048/close', { method: 'DELETE' })
  let history = await srv.api<{ closedAt: string, sentAt: string | null, reopenedAt: string, settlement: { totalCostsCents: number } }[]>('/api/settlement/2048/history')
  assert.equal(history.length, 1, 'der verschickte Stand ist nicht verloren')
  assert.equal(history[0]?.sentAt, '2049-02-01')
  assert.equal(history[0]?.settlement.totalCostsCents, 30000)
  assert.match(history[0]?.reopenedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
  await srv.api(`/api/costItems/${k.id}`, { method: 'PUT', body: JSON.stringify({ amountCents: 25000 }) })
  await srv.api('/api/settlement/2048/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const gueltig = await srv.api<Settlement>('/api/settlement/2048')
    assert.equal(gueltig.totalCostsCents, 25000, 'gültig ist der neue Abschluss')
    history = await srv.api('/api/settlement/2048/history')
    assert.equal(history.length, 1, 'der gültige Stand steht nicht im Verlauf')
  } finally {
    await srv.api('/api/settlement/2048/close', { method: 'DELETE' })
  }
  history = await srv.api('/api/settlement/2048/history')
  assert.deepEqual(history.map((h) => h.settlement.totalCostsCents), [25000, 30000], 'neueste zuerst')
})

test('Abschließen: ein zweites Mal für dasselbe Jahr wird abgelehnt, und zwar mit einem Satz', async () => {
  // Die Route fragt vor dem Einfrieren, ob es für das Jahr schon eine abgeschlossene Abrechnung
  // gibt. Fiele diese Frage weg, käme statt einer Erklärung der Verstoß gegen den eindeutigen
  // Index heraus. Beides hat keinen Test gehabt: weder der 409 noch die Meldung.
  await srv.api('/api/settlement/2043/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const zweites = await fetch(`${srv.base}/api/settlement/2043/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(zweites.status, 409)
    const fehler = await errorFrom(zweites)
    assert.match(fehler, /2043/, 'die Meldung nennt das Jahr nicht')
    assert.doesNotMatch(fehler, /UNIQUE|Failed query|insert into/, 'die Meldung kommt aus der Datenbank')
    // Und der erste Stand steht unverändert da.
    assert.equal((await closedOf(srv, 2043))?.sentAt, null)
  } finally {
    await srv.api('/api/settlement/2043/close', { method: 'DELETE' })
  }
})

test('Versanddatum: was kein Datum ist, kommt nicht in die db.json', async () => {
  await srv.api('/api/settlement/2041/close', { method: 'POST', body: JSON.stringify({ sentAt: '2042-05-02' }) })
  for (const sentAt of NO_DATES) {
    const res = await closeRequest('PUT', 2041, { sentAt })
    assert.equal(res.status, 400, `angenommen: ${JSON.stringify(sentAt)}`)
    assert.match(await errorFrom(res), /Versanddatum/)
  }
  assert.equal((await closedOf(srv, 2041))?.sentAt, '2042-05-02', 'das gespeicherte Datum wurde überschrieben')

  await srv.api('/api/settlement/2041/close', { method: 'DELETE' })
})

test('Versanddatum: ein ungültiges Datum friert die Abrechnung gar nicht erst ein', async () => {
  for (const sentAt of NO_DATES) {
    const res = await closeRequest('POST', 2042, { sentAt })
    assert.equal(res.status, 400, `angenommen: ${JSON.stringify(sentAt)}`)
  }
  assert.equal(await closedOf(srv, 2042), undefined)
})

// ---------- Update-Hinweis ----------
// Ein nachgebauter GitHub-Server liefert die echte Antwort der Releases-API, umgeschrieben auf
// eine neuere Version. Er zählt mit, damit sich belegen lässt, dass ohne Zustimmung nichts
// hinausgeht.

const serverVersion: string = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8')).version
async function withUpdateServer(env: NodeJS.ProcessEnv, fn: (s: Server, github: GitHub) => Promise<void>) {
  const github = await fakeGitHub()
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-update-'))
  const s = await startServerIn(dataDir, { NKA_UPDATE_URL: github.url, ...env })
  try {
    await fn(s, github)
  } finally {
    s.stop()
    github.stop()
  }
}

test('Update-Hinweis: ohne Zustimmung fragt der Server GitHub nicht', async () => {
  await withUpdateServer({}, async (s, github) => {
    const status = await s.api<UpdateStatus>('/api/update')
    assert.equal(status.enabled, false)
    assert.equal(status.available, false)
    // auch „Jetzt prüfen" darf ohne Zustimmung nichts anfragen
    await s.api('/api/update/check', { method: 'POST', body: '{}' })
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'off' }) })
    await s.api('/api/update')
    assert.equal(github.requests.length, 0)
  })
})

test('Update-Hinweis: mit Zustimmung meldet der Server die neue Version', async () => {
  await withUpdateServer({}, async (s, github) => {
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'on' }) })
    const status = await s.api<UpdateStatus>('/api/update')
    assert.equal(github.requests.length, 1)
    assert.equal(status.enabled, true)
    assert.equal(status.current, serverVersion)
    assert.equal(status.latest, '9.9.9')
    assert.equal(status.available, true)
    assert.equal(status.mode, 'npm') // der Test startet den Server mit node, ohne Programmdatei
    assert.equal(status.releaseUrl, 'https://github.com/speedone/mietfuchs/releases/tag/v9.9.9')
    // Bis zum nächsten Tag kommt das gemerkte Ergebnis. „Jetzt prüfen" fragt neu, aber höchstens
    // einmal pro Minute; wann genau, prüft update.test.ts mit gestellter Uhr.
    await s.api('/api/update')
    assert.equal(github.requests.length, 1)
    const rechecked = await s.api<UpdateStatus>('/api/update/check', { method: 'POST', body: '{}' })
    assert.equal(github.requests.length, 1)
    assert.equal(rechecked.latest, '9.9.9')
  })
})

test('Update-Hinweis: im Docker-Container lautet die Betriebsart docker', async () => {
  await withUpdateServer({ NKA_RUNTIME: 'docker' }, async (s) => {
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ updateCheck: 'on' }) })
    const status = await s.api<UpdateStatus>('/api/update')
    assert.equal(status.mode, 'docker')
    assert.equal(status.downloadUrl, null)
  })
})

test('Version: /healthz und der Update-Hinweis nennen die Version aus package.json', async () => {
  const report = await srv.api<HealthReport>('/healthz')
  const status = await srv.api<UpdateStatus>('/api/update')
  assert.equal(report.version, serverVersion)
  assert.equal(status.current, serverVersion)
})

// ---------- Kein Serverstart ohne CI ----------

test('Jeder Serverstart einer Prüfung setzt CI', () => {
  // **Ohne `CI` reißt ein Testlauf Browserfenster auf dem Rechner des Entwicklers auf.**
  // Der Server öffnet beim Start den Standard-Browser, sobald `STANDALONE` gilt, also in der
  // Betriebsart `binary` oder `package` (siehe version.ts). Genau die stellt ein Test weiter
  // oben mit `NKA_RUNTIME: 'binary'` nach, und weil `startServerIn` kein `CI` setzte, ging bei
  // jedem vollen Lauf ein Tab auf — auf einem Zufallsport, denn `NKA_PORT` ist dort `'0'`.
  //
  // **Geprüft wird der Quelltext, und das ist hier das richtige Mittel.** Am Verhalten ließe es
  // sich nur messen, indem der Test einen Browser öffnet, und das ist genau das, was er
  // verhindern soll. Die Regel steht in CLAUDE.md bei den drei Variablen, die zu jedem
  // Prüf-Serverstart gehören: NKA_DATA_DIR gegen echte Daten, CI gegen das Fenster,
  // NKA_UPDATE_URL gegen Anfragen zu GitHub.
  //
  // Gelesen wird der Block `env: { … }` jedes Serverstarts, und zwar mit Klammerzählung statt
  // mit einem festen Fenster: Ein Suchbereich „die nächsten N Zeichen" ginge irgendwann daneben,
  // und ein Wächter, der zu früh aufhört, meldet nichts und schützt nichts.
  //
  // Seit #263 stehen die Serverstarts nicht mehr in einer Datei, sondern in testing/api.ts und in
  // den Teilen api-*.test.ts. Gelesen wird deshalb jede Quelldatei unter test/ und testing/; eine
  // neue Datei mit einem Serverstart ist so ohne weiteres Zutun dabei.
  const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const dateien = ['test', 'testing'].flatMap((ordner) =>
    fs.readdirSync(path.join(serverDir, ordner))
      .filter((name) => /\.(ts|mjs)$/.test(name))
      .map((name) => path.join(ordner, name)))
  // Das Muster steht bewusst zweigeteilt da: Stünde es an einem Stück, fände der Wächter sich
  // selbst und meldete seine eigene Zeile. Nachgemessen, das war der erste Lauf.
  const marke = `spawn(process.execPath, ['src/` + `index.ts']`
  const ohneCI: string[] = []
  const gefunden: string[] = []
  for (const datei of dateien) {
    const quelle = fs.readFileSync(path.join(serverDir, datei), 'utf8')
    for (let von = quelle.indexOf(marke); von !== -1; von = quelle.indexOf(marke, von + 1)) {
      const zeile = `${datei}:${quelle.slice(0, von).split('\n').length}`
      gefunden.push(zeile)
      const envStart = quelle.indexOf('env: {', von)
      if (envStart === -1) return assert.fail(`Serverstart ohne env-Block in ${zeile}`)
      let tiefe = 0
      let envEnde = -1
      for (let i = quelle.indexOf('{', envStart); i < quelle.length; i++) {
        if (quelle[i] === '{') tiefe++
        else if (quelle[i] === '}' && --tiefe === 0) { envEnde = i; break }
      }
      if (envEnde === -1) return assert.fail(`env-Block nach ${zeile} ist nicht geschlossen`)
      // CI muss **hinter** dem `...env` des Aufrufers stehen, sonst könnte ein Aufrufer es
      // versehentlich überschreiben (Durchsicht zu #244: `startServerRaw` hatte es davor).
      const block = quelle.slice(envStart, envEnde)
      const letztesCI = Math.max(-1, ...[...block.matchAll(/\bCI:\s*['"]/g)].map((m) => m.index))
      if (letztesCI === -1 || letztesCI < block.lastIndexOf('...env')) ohneCI.push(zeile)
    }
  }
  assert.deepEqual(
    ohneCI,
    [],
    'Serverstart ohne CI an diesen Stellen. Ohne CI öffnet der Server ein Browserfenster, sobald ' +
      'er sich für die Programmdatei hält. Siehe CLAUDE.md, Abschnitt zu den Tests.',
  )
  // Und der Wächter muss überhaupt etwas gefunden haben, sonst prüft er nichts: mindestens die
  // beiden Starts in testing/api.ts (startServerIn und startServerRaw).
  assert.ok(
    gefunden.filter((zeile) => zeile.startsWith(path.join('testing', 'api.ts'))).length >= 2,
    `die Serverstarts in testing/api.ts wurden nicht gefunden (gefunden: ${gefunden.join(', ') || 'keine'}); der Wächter wäre wirkungslos`,
  )
})

// ---------- Sicherung vor dem Update anzeigen (#154) ----------

test('Update: nach nachgeholten Schritten nennt /healthz die Sicherung, auch nach einem Neustart, bis die Oberfläche sie wegklickt', async () => {
  const dataDir = await dataDirAtBaseline()
  const schritte = (await loadMigrations()).length - 1
  const erster = await startServerIn(dataDir)
  let genannt: { steps: number, backup: string, at: string }
  try {
    const report = await erster.api<HealthReport>('/healthz')
    // Nur der Name: Die Oberfläche sagt „im Datenordner“, einen Pfad braucht sie nicht.
    genannt = report.database?.migrated ?? assert.fail('keine Sicherung genannt')
    const { at, ...rest } = genannt
    assert.deepEqual(rest, { steps: schritte, backup: 'mietfuchs.sqlite.vor-0001_objekte' })
    // Der Zeitpunkt der Sicherung unterscheidet sie von einer früheren gleichen Namens.
    assert.equal(at, fs.statSync(path.join(dataDir, 'mietfuchs.sqlite.vor-0001_objekte')).mtime.toISOString())
    assert.ok(fs.existsSync(path.join(dataDir, 'mietfuchs.sqlite.vor-0001_objekte')), 'die genannte Sicherung fehlt')
    // #180: Auch auf der Konsole, mit vollem Pfad, denn dort liest es jemand, der die Datei sucht.
    assert.ok(erster.output().includes(path.join(dataDir, 'mietfuchs.sqlite.vor-0001_objekte')), erster.output())
  } finally {
    erster.child.kill()
    await waitForExit(erster.child)
  }
  // #180: Ein Neustart, bevor jemand die Oberfläche geöffnet hat (Docker, npm), nimmt den Hinweis
  // nicht mit. Er nennt dieselbe Sicherung mit demselben Zeitpunkt, die Konsole aber nicht noch
  // einmal: Nachgeholt hat dieser Start nichts.
  const zweiter = await startServerIn(dataDir)
  try {
    const report = await zweiter.api<HealthReport>('/healthz')
    assert.deepEqual(report.database?.migrated, genannt, JSON.stringify(report.database))
    assert.ok(!zweiter.output().includes('vor-0001_objekte'), zweiter.output())
    // Ein fremder Schlüssel (ein Tab von vor einem weiteren Update) räumt nichts weg.
    const fremd = await fetch(`${zweiter.base}/api/database/migrated/seen`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'mietfuchs.sqlite.vor-0001_objekte@1970-01-01T00:00:00.000Z' }),
    })
    assert.equal(fremd.status, 200)
    assert.deepEqual((await zweiter.api<HealthReport>('/healthz')).database?.migrated, genannt)
    // Weggeklickt: danach nicht mehr, auch nicht nach dem nächsten Start.
    const gesehen = await fetch(`${zweiter.base}/api/database/migrated/seen`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: `${genannt.backup}@${genannt.at}` }),
    })
    assert.equal(gesehen.status, 200)
    assert.equal((await zweiter.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    zweiter.child.kill()
    await waitForExit(zweiter.child)
  }
  const dritter = await startServerIn(dataDir)
  try {
    assert.equal((await dritter.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    dritter.stop()
  }
})

test('Update: nach einem gelungenen Umstieg aus der db.json nennt niemand die Sicherung der leeren Datenbank (Durchsicht zu #180)', async () => {
  // Ein früher gescheiterter Umstieg hat eine leere Datenbank auf 0000 hinterlassen, daneben liegt
  // die db.json. Die neue Version holt die Schritte nach (Sicherung der leeren Datei) und steigt
  // dann um. Die Sicherung ist kein Rückweg: Sie enthielte nichts, die db.json heißt schon „abgelöst“.
  const dataDir = await dataDirAtBaseline()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
  }))
  // Eine Merkdatei aus einem früheren Update darf den Umstieg ebenso wenig überleben.
  fs.writeFileSync(path.join(dataDir, 'sicherung-vor-update.json'), JSON.stringify({ steps: 1, backup: 'mietfuchs.sqlite.vor-0001_objekte', at: 'früher' }))
  const erster = await startServerIn(dataDir)
  try {
    const report = await erster.api<HealthReport>('/healthz')
    assert.equal(report.database?.changeover.state, 'done', JSON.stringify(report.database))
    assert.equal(report.database?.migrated, null, JSON.stringify(report.database))
    assert.ok(!erster.output().includes('Sicherung Ihrer Daten'), erster.output())
    assert.equal(fs.existsSync(path.join(dataDir, 'sicherung-vor-update.json')), false, 'die Merkdatei liegt noch da')
  } finally {
    erster.child.kill()
    await waitForExit(erster.child)
  }
  const zweiter = await startServerIn(dataDir)
  try {
    assert.equal((await zweiter.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    zweiter.stop()
  }
})

test('Update: der gelesene Hinweis wird mit fehlendem Schlüssel abgelehnt', async () => {
  const s = await startServer()
  try {
    const res = await fetch(`${s.base}/api/database/migrated/seen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 400)
  } finally {
    s.stop()
  }
})

test('Update: nach dem Wiederherstellen nennt /healthz keine Sicherung, die zu diesem Stand nicht gehört', async () => {
  // Das Archiv von v0.8.0 wird auf einer Zwischenkopie migriert, ohne Sicherung davor; der
  // bisherige Stand liegt als mietfuchs.sqlite.vor-restore daneben.
  const dataDir = await dataDirAtBaseline()
  const s = await startServerIn(dataDir)
  try {
    assert.notEqual((await s.api<HealthReport>('/healthz')).database?.migrated, null)
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', await databaseOfV080(2025))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal((await s.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    s.child.kill()
    await waitForExit(s.child)
  }
  // Und ein Neustart holt den Hinweis auf die Sicherung vor dem Update nicht zurück (#180).
  const danach = await startServerIn(dataDir)
  try {
    assert.equal((await danach.api<HealthReport>('/healthz')).database?.migrated, null)
  } finally {
    danach.stop()
  }
})

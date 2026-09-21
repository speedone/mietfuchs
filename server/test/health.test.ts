// Betriebszustand für Container-Orchestratoren (/healthz).
//
// Ein Healthcheck soll mehr sagen als „der Prozess läuft": Er meldet einen Fehler, wenn die
// db.json unlesbar ist oder der Datenordner nicht beschreibbar — etwa schreibgeschützt
// eingehängt oder mit falschen Rechten. Ein nicht eingehängtes Volume erkennt er nicht:
// Docker legt dann ein anonymes an, und das ist beschreibbar.
//
// Geprüft wird die Funktion, nicht die Route: index.ts startet den Server beim Import. Dass
// die Route als JSON antwortet und nicht vom Frontend verdeckt wird, prüft api.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { healthReport, type DatabaseState } from '../src/health.ts'

// Ein Datenordner, wie der Server ihn vorfindet
function makeDataDir(contents: { db?: string } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-health-'))
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true })
  if (contents.db !== undefined) fs.writeFileSync(path.join(dir, 'db.json'), contents.db, 'utf8')
  return dir
}

test('Healthcheck: gesunder Datenordner meldet ok', () => {
  const dir = makeDataDir({ db: JSON.stringify({ units: [], settings: {} }) })
  const report = healthReport({ dataDir: dir, version: '0.3.1' })
  assert.equal(report.status, 'ok')
  assert.equal(report.version, '0.3.1')
  assert.equal(report.checks.data.ok, true)
  assert.equal(report.checks.uploads.ok, true)
})

test('Healthcheck: Erstinbetriebnahme ohne db.json ist gesund', () => {
  // Beim ersten Start gibt es noch keine db.json — store.ts legt sie erst beim ersten
  // Schreiben an. Als Fehler gemeldet, hinge jeder frisch gestartete Container in einer
  // Neustart-Schleife.
  const report = healthReport({ dataDir: makeDataDir(), version: '0.3.1' })
  assert.equal(report.status, 'ok')
  assert.match(report.checks.data.detail, /noch nicht angelegt/)
})

test('Healthcheck: unbrauchbarer Datenordner ist ein Fehler', () => {
  // Der Pfad zeigt auf eine Datei statt auf einen Ordner — darin lässt sich nichts ablegen
  const file = path.join(makeDataDir(), 'keinOrdner')
  fs.writeFileSync(file, '')
  const report = healthReport({ dataDir: file, version: '0.3.1' })
  assert.equal(report.status, 'error')
  assert.equal(report.checks.uploads.ok, false)
})

test('Healthcheck: unlesbare db.json ist ein Fehler', () => {
  const report = healthReport({ dataDir: makeDataDir({ db: '{ das ist kein JSON' }), version: '0.3.1' })
  assert.equal(report.status, 'error')
  assert.equal(report.checks.data.ok, false)
})

// **Die angekündigte Umkehr ist eingetreten.** Bis die Routen aus der Datenbank lasen, durfte
// sie den Status nicht bestimmen: Mietfuchs arbeitete mit der db.json weiter, und ein Fehler an
// der Datenbank hätte nur Container in eine Neustart-Schleife geschickt. Seit die Routen aus ihr
// lesen, ist ein Start ohne sie ein Start ohne Daten, und genau das soll der Bericht sagen.

const dbState = (dir: string, state: Partial<DatabaseState> & Pick<DatabaseState, 'open' | 'changeover'>): DatabaseState => ({
  file: path.join(dir, 'mietfuchs.sqlite'), migrations: 1, detail: 'geöffnet', ...state,
})

test('Healthcheck: eine Datenbank, die sich nicht öffnen ließ, ist ein Fehler', () => {
  const dir = makeDataDir({ db: '{}' })
  const report = healthReport({
    dataDir: dir,
    version: '0.7.1',
    database: dbState(dir, {
      open: false, migrations: 0, detail: 'ist beschädigt',
      changeover: { state: 'none', message: 'Es ist nichts zu übernehmen.', notes: [] },
    }),
  })
  assert.equal(report.status, 'error')
  assert.equal(report.checks.database?.ok, false)
  assert.match(String(report.database?.detail), /beschädigt/)
})

test('Healthcheck: ein gescheiterter Umstieg ist ein Fehler, obwohl die Datenbank offen ist', () => {
  // Der gefährliche Fall: Die Datenbank steht, ist aber leer, und die Daten des Vermieters
  // liegen noch in der db.json. Ein „ok" hieße hier, dass jede Datenroute mit 503 antwortet,
  // während der Bericht Betriebsbereitschaft meldet.
  const dir = makeDataDir({ db: '{}' })
  const report = healthReport({
    dataDir: dir,
    version: '0.7.1',
    database: dbState(dir, {
      open: true,
      changeover: { state: 'failed', message: 'Der Umstieg ist nicht gelungen.', notes: [] },
    }),
  })
  assert.equal(report.status, 'error')
  assert.equal(report.checks.database?.ok, false)
  assert.equal(report.database?.changeover.state, 'failed', 'der Grund steht weiterhin im Bericht')
  assert.equal(report.database?.migrations, 1)
})

test('Healthcheck: eine offene Datenbank mit erledigtem Umstieg ist in Ordnung', () => {
  const dir = makeDataDir({ db: '{}' })
  for (const state of ['none', 'done'] as const) {
    const report = healthReport({
      dataDir: dir,
      version: '0.7.1',
      database: dbState(dir, { open: true, changeover: { state, message: 'alles da', notes: [] } }),
    })
    assert.equal(report.status, 'ok', `Umstieg ${state}`)
    assert.equal(report.checks.database?.ok, true, `Umstieg ${state}`)
  }
})

test('Healthcheck: nicht beschreibbarer Belegordner ist ein Fehler', (t) => {
  // Als root greifen Dateirechte nicht — dann lässt sich das nicht prüfen. Unter Windows
  // ebenso wenig: chmod setzt dort keine Schreibsperre, der Schreibversuch gelingt trotzdem.
  if (process.getuid?.() === 0) return t.skip('läuft als root')
  if (process.platform === 'win32') return t.skip('chmod sperrt unter Windows keinen Ordner')
  const dir = makeDataDir({ db: '{}' })
  fs.chmodSync(path.join(dir, 'uploads'), 0o500)
  try {
    const report = healthReport({ dataDir: dir, version: '0.3.1' })
    assert.equal(report.status, 'error')
    assert.equal(report.checks.uploads.ok, false)
  } finally {
    fs.chmodSync(path.join(dir, 'uploads'), 0o700)
  }
})

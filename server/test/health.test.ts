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
import { healthReport } from '../src/health.ts'

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

test('Healthcheck: die Datenbank steht im Bericht, bestimmt den Status aber nicht', () => {
  // Die Datenbank (#55) ist an diesem Stand noch leer, und Mietfuchs arbeitet ohne sie weiter.
  // Stünde sie unter `checks`, meldete /healthz einen Fehler, sobald sie sich nicht öffnen
  // lässt, und ein Container liefe in eine Neustart-Schleife, obwohl die Anwendung tut, was
  // sie soll. Beim Umstieg der Bestände gehört sie dorthin, heute noch nicht.
  const dir = makeDataDir({ db: '{}' })
  const zu = healthReport({
    dataDir: dir,
    version: '0.7.1',
    database: { open: false, file: path.join(dir, 'mietfuchs.sqlite'), migrations: 0, detail: 'ist beschädigt' },
  })
  assert.equal(zu.status, 'ok')
  assert.equal(zu.database?.open, false)
  assert.match(String(zu.database?.detail), /beschädigt/)

  const offen = healthReport({
    dataDir: dir,
    version: '0.7.1',
    database: { open: true, file: path.join(dir, 'mietfuchs.sqlite'), migrations: 1, detail: 'geöffnet' },
  })
  assert.equal(offen.status, 'ok')
  assert.equal(offen.database?.migrations, 1)
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

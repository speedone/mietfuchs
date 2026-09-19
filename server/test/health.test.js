// Betriebszustand für Container-Orchestratoren (/healthz).
//
// Ein Healthcheck soll mehr sagen als „der Prozess läuft": Er meldet einen Fehler, wenn die
// db.json unlesbar ist oder der Datenordner nicht beschreibbar — etwa schreibgeschützt
// eingehängt oder mit falschen Rechten. Ein nicht eingehängtes Volume erkennt er nicht:
// Docker legt dann ein anonymes an, und das ist beschreibbar.
//
// Geprüft wird die Funktion, nicht die Route: index.js startet den Server beim Import. Dass
// die Route als JSON antwortet und nicht vom Frontend verdeckt wird, prüft api.test.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { healthReport } from '../src/health.js'

// Ein Datenordner, wie der Server ihn vorfindet
function datenordner(inhalt = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-health-'))
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true })
  if (inhalt.db !== undefined) fs.writeFileSync(path.join(dir, 'db.json'), inhalt.db, 'utf8')
  return dir
}

test('Healthcheck: gesunder Datenordner meldet ok', () => {
  const dir = datenordner({ db: JSON.stringify({ units: [], settings: {} }) })
  const bericht = healthReport({ dataDir: dir, version: '0.3.1' })
  assert.equal(bericht.status, 'ok')
  assert.equal(bericht.version, '0.3.1')
  assert.equal(bericht.checks.data.ok, true)
  assert.equal(bericht.checks.uploads.ok, true)
})

test('Healthcheck: Erstinbetriebnahme ohne db.json ist gesund', () => {
  // Beim ersten Start gibt es noch keine db.json — store.js legt sie erst beim ersten
  // Schreiben an. Als Fehler gemeldet, hinge jeder frisch gestartete Container in einer
  // Neustart-Schleife.
  const bericht = healthReport({ dataDir: datenordner(), version: '0.3.1' })
  assert.equal(bericht.status, 'ok')
  assert.match(bericht.checks.data.detail, /noch nicht angelegt/)
})

test('Healthcheck: unbrauchbarer Datenordner ist ein Fehler', () => {
  // Der Pfad zeigt auf eine Datei statt auf einen Ordner — darin lässt sich nichts ablegen
  const datei = path.join(datenordner(), 'keinOrdner')
  fs.writeFileSync(datei, '')
  const bericht = healthReport({ dataDir: datei, version: '0.3.1' })
  assert.equal(bericht.status, 'error')
  assert.equal(bericht.checks.uploads.ok, false)
})

test('Healthcheck: unlesbare db.json ist ein Fehler', () => {
  const bericht = healthReport({ dataDir: datenordner({ db: '{ das ist kein JSON' }), version: '0.3.1' })
  assert.equal(bericht.status, 'error')
  assert.equal(bericht.checks.data.ok, false)
})

test('Healthcheck: nicht beschreibbarer Belegordner ist ein Fehler', (t) => {
  // Als root greifen Dateirechte nicht — dann lässt sich das nicht prüfen. Unter Windows
  // ebenso wenig: chmod setzt dort keine Schreibsperre, der Schreibversuch gelingt trotzdem.
  if (process.getuid?.() === 0) return t.skip('läuft als root')
  if (process.platform === 'win32') return t.skip('chmod sperrt unter Windows keinen Ordner')
  const dir = datenordner({ db: '{}' })
  fs.chmodSync(path.join(dir, 'uploads'), 0o500)
  try {
    const bericht = healthReport({ dataDir: dir, version: '0.3.1' })
    assert.equal(bericht.status, 'error')
    assert.equal(bericht.checks.uploads.ok, false)
  } finally {
    fs.chmodSync(path.join(dir, 'uploads'), 0o700)
  }
})

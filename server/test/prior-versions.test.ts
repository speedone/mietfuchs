// Automatische Vorversionen der Datenbank (#318): die Auswahl ohne Server.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PRIOR_DIR, createPriorVersion, listPriorVersions, priorVersionDue, priorVersionName, priorVersionTime, priorVersionsToDrop, type PriorVersion,
} from '../src/db/priorVersions.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { units } from '../src/db/schema.ts'

const version = (iso: string): PriorVersion => ({ name: priorVersionName(new Date(iso)), createdAt: new Date(iso).toISOString(), size: 1 })

test('Vorversionen: Der Name trägt den Zeitpunkt in UTC und lässt sich zurücklesen', () => {
  const at = new Date('2026-10-23T08:15:09Z')
  assert.equal(priorVersionName(at), 'vorversion-2026-10-23-081509.sqlite')
  assert.equal(priorVersionTime('vorversion-2026-10-23-081509.sqlite')?.toISOString(), at.toISOString())
})

test('Vorversionen: Fremde Namen, Pfade und unmögliche Tage gelten nicht', () => {
  for (const name of [
    '../vorversion-2026-10-23-081509.sqlite',
    'vorversionen/vorversion-2026-10-23-081509.sqlite',
    'vorversion-2026-02-31-081509.sqlite',
    'vorversion-2026-10-23-081509.sqlite.tmp',
    'mietfuchs.sqlite',
    '.entsteht-vorversion-2026-10-23-081509.sqlite',
  ]) assert.equal(priorVersionTime(name), null, name)
})

test('Vorversionen: fällig ohne Vorversion und erst, wenn die jüngste älter als sieben Tage ist', () => {
  const now = new Date('2026-10-23T12:00:00Z')
  assert.equal(priorVersionDue([], now), true)
  assert.equal(priorVersionDue([version('2026-10-16T12:00:00Z')], now), false) // genau sieben Tage
  assert.equal(priorVersionDue([version('2026-10-16T11:59:59Z')], now), true)
  assert.equal(priorVersionDue([version('2026-10-01T00:00:00Z'), version('2026-10-20T00:00:00Z')], now), false)
  // Uhr zurückgestellt: eine jüngste aus der Zukunft gilt als frisch.
  assert.equal(priorVersionDue([version('2026-12-01T00:00:00Z')], now), false)
})

test('Vorversionen: Behalten werden die vier jüngsten, die älteste fällt weg', () => {
  const list = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'].map((d) => version(`${d}T00:00:00Z`))
  assert.deepEqual(priorVersionsToDrop(list), [list[0].name])
  assert.deepEqual(priorVersionsToDrop(list.slice(1)), [])
})

test('Vorversionen: die Liste zeigt nur eigene Dateien, die jüngste zuerst', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorversionen-'))
  try {
    fs.mkdirSync(path.join(dir, PRIOR_DIR))
    for (const name of ['vorversion-2026-09-01-000000.sqlite', 'vorversion-2026-10-01-000000.sqlite', 'notiz.txt', '.entsteht-vorversion-2026-10-02-000000.sqlite']) {
      fs.writeFileSync(path.join(dir, PRIOR_DIR, name), 'x')
    }
    assert.deepEqual(listPriorVersions(dir).map((v) => v.name), ['vorversion-2026-10-01-000000.sqlite', 'vorversion-2026-09-01-000000.sqlite'])
    assert.deepEqual(listPriorVersions(path.join(dir, 'gibt-es-nicht')), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Vorversionen: Eine leere Datenbank bekommt keine, eine mit Bestand schon, und es bleiben vier', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorversionen-'))
  const opened = await openFreshDatabase(dir)
  try {
    assert.equal(await createPriorVersion(opened, dir, new Date('2026-10-23T08:00:00Z')), null)
    assert.deepEqual(listPriorVersions(dir), [])

    await opened.write((db) => db.insert(units).values({ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true, selfUsed: false }))
    const names: (string | null)[] = []
    for (const day of ['2026-09-01', '2026-09-09', '2026-09-17', '2026-09-25', '2026-10-03']) {
      names.push(await createPriorVersion(opened, dir, new Date(`${day}T08:00:00Z`)))
    }
    assert.ok(names.every((n) => n !== null))
    // Am selben Tag noch einmal: nicht fällig.
    assert.equal(await createPriorVersion(opened, dir, new Date('2026-10-04T08:00:00Z')), null)
    const list = listPriorVersions(dir)
    assert.equal(list.length, 4)
    assert.equal(list[0].name, 'vorversion-2026-10-03-080000.sqlite')
    assert.ok(!list.some((v) => v.name === names[0]), 'die älteste fällt weg')
    // Kein Zwischenstand bleibt liegen.
    assert.deepEqual(fs.readdirSync(path.join(dir, PRIOR_DIR)).filter((n) => n.startsWith('.')), [])
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

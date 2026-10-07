// Einträge des Vermieters für Rechtswerte, die noch nicht veröffentlicht sind (Heizung PR 17, Entwurf 4.5,
// 5.9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { lawOverrides } from '../src/db/schema.ts'
import { LawOverrideError, lawOverrideSlots, readLawOverrides, removeLawOverride, saveLawOverride } from '../src/db/lawOverrides.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-rechtswerte-'))
function rejects(connection: Connection, sql: string): string | null {
  try {
    connection.exec(sql)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const refused = (text: RegExp) => (e: unknown) => e instanceof LawOverrideError && e.status === 400 && text.test(e.message)

test('Tabelle: 1. Januar, Quelle Pflicht, JSON gültig, ein Eintrag je Parameter und Jahr', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    const ins = (from: string, json: string, source: string) =>
      `INSERT INTO law_overrides (param_id, valid_from, value_json, source, entered_at) VALUES ('co2.price', '${from}', '${json}', '${source}', '2026-12-20')`
    assert.equal(rejects(c, ins('2027-01-01', '64.2', 'UBA')), null)
    assert.match(rejects(c, ins('2027-01-01', '65', 'UBA')) ?? '', /UNIQUE|PRIMARY/)
    assert.match(rejects(c, ins('2028-02-01', '65', 'UBA')) ?? '', /law_overrides_valid_from_valid/)
    assert.match(rejects(c, ins('2028-01-01', '65', '  ')) ?? '', /law_overrides_source_complete/)
    assert.match(rejects(c, ins('2028-01-01', 'kaputt', 'UBA')) ?? '', /law_overrides_value_is_json/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Speichern: nur überschreibbar, nur wo null, Zahl über 0, Quelle Pflicht', async () => {
  await withDatabase(async (opened) => {
    const slot = await opened.write((db) => saveLawOverride(db, 'co2.price', 2027, { value: 64.2, source: ' UBA, Bekanntmachung vom 15.12.2026 ' }, '2026-12-20'))
    assert.deepEqual([slot.status, slot.override?.value, slot.override?.source, slot.official], ['entered', 64.2, 'UBA, Bekanntmachung vom 15.12.2026', null])
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2026, { value: 61, source: 'x' }, '2026-12-20')), refused(/steht der amtliche Wert schon/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'hkv.cut.not-by-consumption', 2027, { value: 10, source: 'x' }, '2026-12-20')), refused(/lässt sich nicht eintragen/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2027, { value: 0, source: 'x' }, '2026-12-20')), refused(/größer als 0/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2027, { value: '64', source: 'x' }, '2026-12-20')), refused(/größer als 0/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2027, { value: 64, source: '' }, '2026-12-20')), refused(/Quelle/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2020, { value: 30, source: 'x' }, '2026-12-20')), refused(/für 2020 nicht/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2027.5, { value: 30, source: 'x' }, '2026-12-20')), refused(/vierstellige/))
    assert.deepEqual((await opened.read((db) => readLawOverrides(db))).map((o) => [o.paramId, o.validFrom, o.value]), [['co2.price', '2027-01-01', 64.2]])
    // Ein zweites Speichern ersetzt den Eintrag, der Tag des Eintrags wandert mit.
    const neu = await opened.write((db) => saveLawOverride(db, 'co2.price', 2027, { value: 64.5, source: 'UBA' }, '2026-12-22'))
    assert.deepEqual([neu.override?.value, neu.override?.enteredAt], [64.5, '2026-12-22'])
    // Im Bestand, damit die Berechnung ihn bekommt.
    assert.deepEqual((await opened.read(readStock)).lawOverrides.map((o) => o.value), [64.5])
    assert.equal(await opened.write((db) => removeLawOverride(db, 'co2.price', 2027)), true)
    assert.equal(await opened.write((db) => removeLawOverride(db, 'co2.price', 2027)), false)
  })
})

test('Abweichung 10: ein Eintrag, der keine Zahl ist, wird gelesen und nicht benutzt; ein unbekannter nicht gezeigt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await saveLawOverride(db, 'co2.price', 2027, { value: 64.2, source: 'UBA' }, '2026-12-20')
      await db.insert(lawOverrides).values({ paramId: 'co2.price', validFrom: '2028-01-01', valueJson: '"teuer"', source: 'x', enteredAt: '2027-12-20' })
      await db.insert(lawOverrides).values({ paramId: 'gibt.es-nicht', validFrom: '2027-01-01', valueJson: '5', source: 'x', enteredAt: '2026-12-20' })
    })
    const read = await opened.read((db) => readLawOverrides(db))
    assert.deepEqual(read.map((o) => [o.paramId, o.validFrom]), [['co2.price', '2027-01-01'], ['gibt.es-nicht', '2027-01-01']])
    // Die Einstellungen zeigen nur Parameter, die das Programm kennt.
    assert.ok(!lawOverrideSlots(read, '2026-12-20').some((s) => s.paramId === 'gibt.es-nicht'))
  })
})

test('Zeilen der Einstellungen: offen bis ins Folgejahr, eingetragen, überholt', () => {
  const eintrag = { paramId: 'co2.price', validFrom: '2026-01-01', value: 61, source: 'alt', enteredAt: '2025-12-20' }
  const slots = lawOverrideSlots([eintrag], '2026-10-05')
  const preis = slots.filter((s) => s.paramId === 'co2.price').map((s) => [s.year, s.status, s.official])
  assert.deepEqual(preis, [[2026, 'superseded', 60], [2027, 'open', null]])
  assert.deepEqual(slots.filter((s) => s.paramId === 'co2.price-ets').map((s) => [s.year, s.status]), [[2027, 'open']])
  // Im Folgejahr kommt das nächste Jahr dazu, ein Eintrag steht als eingetragen.
  const spaeter = lawOverrideSlots([{ paramId: 'co2.price', validFrom: '2027-01-01', value: 64.2, source: 'UBA', enteredAt: '2026-12-20' }], '2027-02-01')
  assert.deepEqual(spaeter.filter((s) => s.paramId === 'co2.price').map((s) => [s.year, s.status]), [[2027, 'entered'], [2028, 'open']])
})

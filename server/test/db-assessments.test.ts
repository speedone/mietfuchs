// Die gespeicherten Auswertungen in der Datenbank (Belegbuchung, #170): speichern, erneut
// auswerten, und was das Löschen einer Position mit ihren Zeilen macht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { createEntity, removeEntity } from '../src/db/repository.ts'
import {
  bookedLines, forgetAssessment, placeAssessment, readAssessmentOfFile, saveAssessment, writeLine, type AssessmentRecord, type NewAssessment,
} from '../src/db/assessments.ts'
import { changeOf, lineState, type NewLine } from '../src/assessment.ts'
import { assessmentLines } from '../src/db/schema.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-auswertung-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const line = (description: string, amountCents: number | null, extra: Partial<NewLine> = {}): NewLine =>
  ({ description, category: 'Wasser/Abwasser', categoryGuessed: false, amountCents, labor35aCents: null, ...extra })
const head = (file: string, lines: NewLine[], extra: Partial<NewAssessment> = {}): NewAssessment => ({
  file, propertyId: 'objekt-1', year: 2025, detectedYear: 2025, vendor: 'Stadtwerke', invoiceDate: '2026-02-15',
  totalGrossCents: 150000, amountsAdjusted: null, laborFromTotal: false, lines, ...extra,
})
let n = 0
const ids = () => ({ id: `a${++n}`, now: new Date(Date.UTC(2026, 9, 2, 0, 0, n)).toISOString() })
const item = (db: Database, id: string) => createEntity(db, 'costItems', id, {
  propertyId: 'objekt-1', year: 2025, category: 'Wasser/Abwasser', description: `Position ${id}`, amountCents: 150000, key: 'area',
})
const lineOf = (r: AssessmentRecord, idx: number) => r.lines.find((l) => l.idx === idx) ?? assert.fail(`keine Zeile ${idx}`)
const link = (db: Database, r: AssessmentRecord, idx: number, costItemId: string) =>
  writeLine(db, r.assessment.id, idx, { ...changeOf(lineOf(r, idx)), booking: 'linked', costItemId })
const reread = async (opened: OpenedDatabase, file: string) =>
  (await opened.read((db) => readAssessmentOfFile(db, file))) ?? assert.fail(`keine Auswertung zu ${file}`)
const causes = (err: unknown): string => {
  let all = ''
  for (let c: unknown = err; c instanceof Error; c = c.cause) all += ` ${c.message}`
  return all
}

test('Auswertung speichern: jede Zeile ist offen, ein nicht gelesener Betrag bleibt null, 0 bleibt 0', async () => {
  await withDatabase(async (opened) => {
    const saved = await opened.write((db) => saveAssessment(db, head('wasser.pdf', [line('Frischwasser', 70000), line('Abwasser', null, { labor35aCents: 0 })]), ids()))
    assert.equal(saved.assessment.file, 'wasser.pdf')
    assert.deepEqual(saved.lines.map((l) => [l.idx, l.amountCents, l.labor35aCents, lineState(l)]), [[0, 70000, null, 'open'], [1, null, 0, 'open']])
  })
})

test('Erneut auswerten ersetzt nur offene und verworfene Zeilen; gebuchte bleiben mit ihrer Nummer', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    const first = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000), line('Abwasser', 80000), line('Gebühr', 500)]), ids()))
    await opened.write((db) => link(db, first, 0, 'c1'))
    await opened.write((db) => writeLine(db, first.assessment.id, 2, { ...changeOf(lineOf(first, 2)), dismissed: true }))
    const second = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000), line('Abwasser neu', 81000)], { year: 2024 }), ids()))
    assert.equal(second.assessment.id, first.assessment.id, 'eine Auswertung je Beleg')
    // Frischwasser ist gebucht und kommt nicht doppelt; die neue Zeile bekommt eine unbenutzte Nummer.
    assert.deepEqual(second.lines.map((l) => [l.idx, l.description, lineState(l)]), [[0, 'Frischwasser', 'linked'], [3, 'Abwasser neu', 'open']])
    assert.equal(second.assessment.year, 2025, 'mit gebuchter Zeile bleibt das Jahr')
  })
})

test('Löschen der Position setzt die Zeile wieder auf offen', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    const saved = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000)]), ids()))
    await opened.write((db) => link(db, saved, 0, 'c1'))
    assert.equal(lineState(lineOf(await reread(opened, 'w.pdf'), 0)), 'linked')
    await opened.write((db) => removeEntity(db, 'costItems', 'c1'))
    assert.equal(lineState(lineOf(await reread(opened, 'w.pdf'), 0)), 'open')
  })
})

test('Position mit Zeilen aus zwei Belegen gelöscht: beide Zeilen offen, die übrigen bleiben gebucht', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    await opened.write((db) => item(db, 'c2'))
    const a = await opened.write((db) => saveAssessment(db, head('abschlag.pdf', [line('Abschlag', 50000)]), ids()))
    const b = await opened.write((db) => saveAssessment(db, head('rest.pdf', [line('Rest', 30000), line('Kanal', 9000)]), ids()))
    await opened.write((db) => link(db, a, 0, 'c1'))
    await opened.write((db) => link(db, b, 0, 'c1'))
    await opened.write((db) => link(db, b, 1, 'c2'))
    await opened.write((db) => removeEntity(db, 'costItems', 'c1'))
    assert.equal(lineState(lineOf(await reread(opened, 'abschlag.pdf'), 0)), 'open')
    const rest = await reread(opened, 'rest.pdf')
    assert.deepEqual([lineState(lineOf(rest, 0)), lineState(lineOf(rest, 1))], ['open', 'linked'])
    assert.deepEqual((await opened.read(bookedLines)).map((l) => [l.file, l.costItemId]), [['rest.pdf', 'c2']])
  })
})

test('Beleg vergessen nimmt die Auswertung samt Zeilen mit', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000)]), ids()))
    await opened.write((db) => forgetAssessment(db, 'w.pdf'))
    assert.equal(await opened.read((db) => readAssessmentOfFile(db, 'w.pdf')), null)
    assert.equal((await opened.read((db) => db.select().from(assessmentLines))).length, 0)
  })
})

test('Objekt einer Auswertung: änderbar, solange nichts gebucht ist; das Jahr bleibt änderbar', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    const saved = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000)]), ids()))
    assert.equal(await opened.write((db) => placeAssessment(db, saved.assessment.id, { propertyId: null, year: 2024 })), 'ok')
    assert.equal(await opened.write((db) => placeAssessment(db, 'gibt-es-nicht', { year: 2024 })), 'missing')
    await opened.write((db) => placeAssessment(db, saved.assessment.id, { propertyId: 'objekt-1', year: 2025 }))
    await opened.write((db) => link(db, saved, 0, 'c1'))
    assert.equal(await opened.write((db) => placeAssessment(db, saved.assessment.id, { propertyId: null })), 'booked')
    assert.equal(await opened.write((db) => placeAssessment(db, saved.assessment.id, { year: 2026 })), 'ok')
  })
})

test('Die Datenbank lehnt eine gebuchte Zeile ohne Art ab', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    const saved = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('Frischwasser', 70000)]), ids()))
    await assert.rejects(
      opened.write((db) => writeLine(db, saved.assessment.id, 0, { ...changeOf(lineOf(saved, 0)), booking: null, costItemId: 'c1' })),
      (err: unknown) => /assessment_lines_booking_complete/.test(causes(err)),
    )
  })
})

test('Erneut auswerten vergibt nie eine Nummer zweimal, auch wenn die letzte Zeile zwischendurch weg war', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => item(db, 'c1'))
    const first = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('A', 70000), line('B', 80000)]), ids()))
    await opened.write((db) => link(db, first, 0, 'c1'))
    // Nur A ist noch da: B (Nummer 1) wird ersetzt, A bleibt gebucht und kommt nicht doppelt.
    await opened.write((db) => saveAssessment(db, head('w.pdf', [line('A', 70000)]), ids()))
    const third = await opened.write((db) => saveAssessment(db, head('w.pdf', [line('A', 70000), line('C', 90000)]), ids()))
    assert.deepEqual(third.lines.map((l) => [l.idx, l.description]), [[0, 'A'], [2, 'C']], 'C darf nicht die frühere Nummer von B erben')
  })
})

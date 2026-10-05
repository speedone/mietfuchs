// Belegbuchung im Abrechnungszeitraum des Objekts (#208).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bookingPeriod, bookingTaxYear, periodForYear } from '../../shared/assessment.ts'
import { CALENDAR_RULES, periodKey } from '../../shared/period.ts'
import type { CostItem, LineDecision, PeriodRules } from '../../shared/types.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createEntity, orphanPeriodKeys } from '../src/db/repository.ts'
import { heatingPlants, properties } from '../src/db/schema.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { readStock } from '../src/db/read.ts'
import { placeAssessment, saveAssessment } from '../src/db/assessments.ts'
import { bookAssessment, previewBooking, viewAssessment } from '../src/db/booking.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }

test('Zielzeitraum: Kalenderobjekt wie bisher, Mai bis April nach dem gewählten oder der größten Überschneidung', () => {
  assert.equal(bookingPeriod(CALENDAR_RULES, { year: 2025, requestedPeriod: periodKey('2024-01') }).key, '2025-01', 'gewählt war 2024, gebucht wird ins Jahr des Belegs')
  assert.equal(bookingPeriod(CALENDAR_RULES, { year: 2025, requestedPeriod: null }).key, '2025-01')
  assert.equal(periodForYear(MAI, 2025).key, '2025-05', 'Mai bis Dezember 2025 sind 245 Tage, Januar bis April 120')
  assert.equal(bookingPeriod(MAI, { year: 2025, requestedPeriod: periodKey('2024-05') }).key, '2024-05', 'der gewählte berührt 2025')
  assert.equal(bookingPeriod(MAI, { year: 2025, requestedPeriod: periodKey('2023-05') }).key, '2025-05', 'der gewählte berührt 2025 nicht')
  assert.equal(periodForYear({ startMonth: 9, changes: [] }, 2025).key, '2024-09', 'September bis August: Januar bis August 2025 überwiegt')
})

test('Jahr der Zahlung einer Buchung: aus dem Rechnungsdatum, nur bei einem Zeitraum über zwei Kalenderjahre', () => {
  const p = periodForYear(MAI, 2025)
  assert.equal(bookingTaxYear(p, { year: 2025, invoiceDate: '2026-02-10' }), 2026)
  assert.equal(bookingTaxYear(p, { year: 2025, invoiceDate: null }), 2025)
  assert.equal(bookingTaxYear(p, { year: 2025, invoiceDate: '2031-01-01' }), 2025, 'außerhalb der erlaubten Spanne gilt das Jahr des Belegs')
  assert.equal(bookingTaxYear(periodForYear(CALENDAR_RULES, 2025), { year: 2025, invoiceDate: '2026-02-10' }), null)
})

async function withWorld(work: (opened: OpenedDatabase, uploadDir: string) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-buchung-zeitraum-'))
  const uploadDir = path.join(dataDir, 'uploads')
  fs.mkdirSync(uploadDir, { recursive: true })
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }))
    await work(opened, uploadDir)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('Mai bis April: Die Buchung legt die Position im gewählten Zeitraum an, mit Jahr der Zahlung aus dem Rechnungsdatum', async () => {
  await withWorld(async (opened, uploadDir) => {
    await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
    fs.writeFileSync(path.join(uploadDir, 'wasser.pdf'), '%PDF wasser')
    const r = await opened.write((db) => saveAssessment(db, {
      file: 'wasser.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedYear: 2025, requestedPeriod: periodKey('2025-05'), vendor: 'Stadtwerke', invoiceDate: '2026-02-10',
      totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false,
      lines: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 70000, labor35aCents: null }],
    }, { id: 'a-wasser', now: '2026-10-02T00:00:00Z' }))
    const v = await opened.read((db) => viewAssessment(db, r.assessment.id, uploadDir))
    assert.deepEqual([v.targetPeriod, v.targetLabel], ['2025-05', '2025/2026'])
    const decisions: LineDecision[] = [{ idx: 0, action: 'create', fields: { description: 'Frischwasser', category: 'Wasser/Abwasser', amountCents: 70000, labor35aCents: null, key: 'area', allocation: null, externalTotalCents: null } }]
    const preview = await opened.read((db) => previewBooking(db, r.assessment.id, decisions, uploadDir))
    assert.deepEqual(preview.errors, [])
    const outcome = await opened.write((db) => bookAssessment(db, r.assessment.id, decisions, preview.token, { uploadDir, newId: () => 'neu-1' }))
    assert.equal(outcome.kind, 'done')
    const item = (await opened.read(readStock)).costItems.find((c: CostItem) => c.id === 'neu-1') ?? assert.fail('keine Position')
    assert.deepEqual([item.period, item.taxYear], ['2025-05', 2026])
  })
})

test('Das Jahr der Buchung von Hand setzen: beim Kalenderobjekt sein Kalenderzeitraum, bei Mai bis April der mit der größten Überschneidung', async () => {
  await withWorld(async (opened, uploadDir) => {
    fs.writeFileSync(path.join(uploadDir, 'b.pdf'), '%PDF b')
    await opened.write((db) => saveAssessment(db, {
      file: 'b.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedYear: 2025, vendor: null, invoiceDate: null,
      totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, lines: [],
    }, { id: 'a-b', now: '2026-10-02T00:00:00Z' }))
    await opened.write((db) => placeAssessment(db, 'a-b', { year: 2024 }))
    assert.equal((await opened.read((db) => viewAssessment(db, 'a-b', uploadDir))).requestedPeriod, '2024-01')
    await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
    await opened.write((db) => placeAssessment(db, 'a-b', { year: 2026 }))
    assert.equal((await opened.read((db) => viewAssessment(db, 'a-b', uploadDir))).requestedPeriod, '2026-05')
  })
})

// Nachprüfung von #222: Der gewählte Zeitraum entsteht aus dem gewählten Jahr nach den Regeln des
// Objekts. Ein fester 'JJJJ-01' wäre bei Mai bis April ein verwaister Schlüssel, und jedes spätere
// Backup lehnte das Wiederherstellen ab (`orphanPeriodKeys`).
test('Mai bis April: Eine Auswertung mit gewähltem Jahr bekommt einen Zeitraum des Objekts, kein verwaister Schlüssel', async () => {
  await withWorld(async (opened, uploadDir) => {
    await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
    fs.writeFileSync(path.join(uploadDir, 'c.pdf'), '%PDF c')
    await opened.write((db) => saveAssessment(db, {
      file: 'c.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: null, requestedYear: 2025, vendor: null, invoiceDate: null,
      totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, lines: [],
    }, { id: 'a-c', now: '2026-10-02T00:00:00Z' }))
    assert.equal((await opened.read((db) => viewAssessment(db, 'a-c', uploadDir))).requestedPeriod, '2025-05')
    // Ein mitgeschickter Zeitraum, den es für das Objekt nicht gibt, gilt nicht.
    fs.writeFileSync(path.join(uploadDir, 'd.pdf'), '%PDF d')
    await opened.write((db) => saveAssessment(db, {
      file: 'd.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: null, requestedYear: 2025, requestedPeriod: periodKey('2025-01'), vendor: null, invoiceDate: null,
      totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, lines: [],
    }, { id: 'a-d', now: '2026-10-02T00:00:00Z' }))
    assert.equal((await opened.read((db) => viewAssessment(db, 'a-d', uploadDir))).requestedPeriod, '2025-05')
    assert.deepEqual(await opened.read(orphanPeriodKeys), [])
  })
})

test('Heizposition mit eigener Heizperiode: das Jahr der Zahlung kommt aus dem Rechnungsdatum, geklemmt in die Heizperiode (Entwurf 3.10)', async () => {
  // Kalenderobjekt, Anlage Mai bis April: Die Buchung unter 2026 kommt in die Heizperiode 2025/2026
  // (Zahlung 2025 bis 2027 zulässig).
  const faelle: [string | null, number][] = [['2025-11-20', 2025], ['2029-01-15', 2027], [null, 2026]]
  for (const [i, [invoiceDate, erwartet]] of faelle.entries()) {
    await withWorld(async (opened, uploadDir) => {
      await opened.write(async (db) => {
        await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
        await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp1'))
      })
      fs.writeFileSync(path.join(uploadDir, 'messdienst.pdf'), '%PDF messdienst')
      const r = await opened.write((db) => saveAssessment(db, {
        file: 'messdienst.pdf', propertyId: 'objekt-1', year: 2026, detectedYear: 2026, requestedYear: 2026, requestedPeriod: periodKey('2026-01'), vendor: 'Messdienst', invoiceDate,
        totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false,
        lines: [{ description: 'Heizkosten 2025/2026', category: 'Heizung und Warmwasser', categoryGuessed: false, amountCents: 100000, labor35aCents: null }],
      }, { id: `a-${i}`, now: '2026-10-02T00:00:00Z' }))
      const decisions: LineDecision[] = [{ idx: 0, action: 'create', fields: { description: 'Heizkosten 2025/2026', category: 'Heizung und Warmwasser', amountCents: 100000, labor35aCents: null, key: 'area', allocation: null, externalTotalCents: null } }]
      const preview = await opened.read((db) => previewBooking(db, r.assessment.id, decisions, uploadDir))
      const outcome = await opened.write((db) => bookAssessment(db, r.assessment.id, decisions, preview.token, { uploadDir, newId: () => `neu-${i}` }))
      assert.equal(outcome.kind, 'done')
      const item = (await opened.read(readStock)).costItems.find((c: CostItem) => c.id === `neu-${i}`) ?? assert.fail('keine Position')
      assert.deepEqual([item.period, item.heatingPlantId, item.taxYear], ['2025-05', 'hp1', erwartet], `Rechnungsdatum ${invoiceDate}`)
    })
  }
})

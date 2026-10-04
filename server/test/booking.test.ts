// Planen und Buchen einer Auswertung (Belegbuchung, #170) gegen eine echte Datenbank. Die vier
// Abnahmefälle aus den drei Durchsichten stehen hier als „Abnahme A“ bis „Abnahme D“; dieselben
// Fälle laufen in Task 8 noch einmal über die Routen und im Browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CostItem, LineDecision, LineFields } from '../../shared/types.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity, createProperty, removeEntity, updateEntity } from '../src/db/repository.ts'
import { readStock } from '../src/db/read.ts'
import { saveAssessment, type AssessmentRecord, type NewAssessment } from '../src/db/assessments.ts'
import { BookingRefusal, bookAssessment, previewBooking, viewAssessment, type BookingOutcome } from '../src/db/booking.ts'
import { parseDecisions } from '../src/bookingPlan.ts'
import { recordUpload } from '../src/db/uploads.ts'
import type { NewLine } from '../src/assessment.ts'

type World = { opened: OpenedDatabase; uploadDir: string }

async function withWorld(work: (w: World) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-buchung-'))
  const uploadDir = path.join(dataDir, 'uploads')
  fs.mkdirSync(uploadDir, { recursive: true })
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }))
    await work({ opened, uploadDir })
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

let seq = 0
const newId = () => `neu-${++seq}`
const line = (description: string, category: string, amountCents: number | null, labor35aCents: number | null = null): NewLine =>
  ({ description, category, categoryGuessed: false, amountCents, labor35aCents })
const fields = (description: string, category: string, amountCents: number | null, extra: Partial<LineFields> = {}): LineFields =>
  ({ description, category, amountCents, labor35aCents: null, key: 'area', allocation: null, externalTotalCents: null, ...extra })

async function receipt(w: World, file: string, lines: NewLine[], extra: Partial<NewAssessment> = {}): Promise<AssessmentRecord> {
  fs.writeFileSync(path.join(w.uploadDir, file), `%PDF ${file}`)
  return w.opened.write((db) => saveAssessment(db, {
    file, propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedYear: 2025, vendor: 'Stadtwerke', invoiceDate: '2026-02-15',
    totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, lines, ...extra,
  }, { id: `a-${file}`, now: new Date(Date.UTC(2026, 9, 2, 0, 0, ++seq)).toISOString() }))
}
const estimate = (w: World, id: string, patch: Record<string, unknown> = {}) => w.opened.write((db) => createEntity(db, 'costItems', id, {
  propertyId: 'objekt-1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser/Abwasser 2025', amountCents: 150000, key: 'area', ...patch,
}))
const plan = (w: World, r: AssessmentRecord, decisions: LineDecision[]) =>
  w.opened.read((db) => previewBooking(db, r.assessment.id, decisions, w.uploadDir))
async function book(w: World, r: AssessmentRecord, decisions: LineDecision[], token?: string): Promise<BookingOutcome> {
  const t = token ?? (await plan(w, r, decisions)).token
  return w.opened.write((db) => bookAssessment(db, r.assessment.id, decisions, t, { uploadDir: w.uploadDir, newId }))
}
const items = async (w: World): Promise<CostItem[]> => (await w.opened.read(readStock)).costItems
const itemOf = async (w: World, id: string): Promise<CostItem> => (await items(w)).find((i) => i.id === id) ?? assert.fail(`keine Position ${id}`)
const view = (w: World, r: AssessmentRecord) => w.opened.read((db) => viewAssessment(db, r.assessment.id, w.uploadDir))
function done(o: BookingOutcome): { changed: boolean } {
  if (o.kind !== 'done') return assert.fail(`nicht gebucht: ${JSON.stringify(o)}`)
  return o
}
const link = (idx: number, costItemId: string): LineDecision => ({ idx, action: 'link', costItemId })

test('Abnahme A: Wasser 700 € + 800 € gegen eine Schätzung von 1.500 € ergibt eine Position über 1.500 €', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'wasser.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    const decisions = [link(0, 'wa'), link(1, 'wa')]
    const preview = await plan(w, r, decisions)
    assert.deepEqual(preview.errors, [])
    assert.deepEqual(preview.items.map((i) => [i.costItemId, i.lines, i.beforeCents, i.afterCents]), [['wa', [0, 1], 150000, 150000]])
    done(await book(w, r, decisions, preview.token))
    const wasser = (await items(w)).filter((i) => i.category === 'Wasser/Abwasser')
    assert.deepEqual(wasser.map((i) => [i.id, i.amountCents, i.invoiceFile]), [['wa', 150000, 'wasser.pdf']])
  })
})

test('Summenregel: eine Schätzung, die nicht der Summe entspricht, wird mit Ansage ersetzt', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa', { amountCents: 140000 })
    const r = await receipt(w, 'wasser.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    const preview = await plan(w, r, [link(0, 'wa'), link(1, 'wa')])
    assert.ok(preview.notices.some((n) => /bisherige Betrag von 1\.400,00\s€ stammt aus keinem Beleg.*1\.500,00\s€/.test(n)), preview.notices.join('\n'))
  })
})

test('Abnahme B: Restmüll 700 € mit Gutschrift −50 € ergibt zwei Positionen; die Gutschrift wird nie verknüpft', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'muell.pdf', [line('Restmüll', 'Müllabfuhr', 70000), line('Gutschrift Tonnentausch', 'Müllabfuhr', -5000)])
    const decisions: LineDecision[] = [
      { idx: 0, action: 'create', fields: fields('Restmüll', 'Müllabfuhr', 70000) },
      { idx: 1, action: 'create', fields: fields('Gutschrift Tonnentausch', 'Müllabfuhr', -5000) },
    ]
    const preview = await plan(w, r, decisions)
    assert.deepEqual(preview.errors, [])
    assert.deepEqual(preview.confirm, [], 'Zeilen desselben Belegs sind keine Doppelung')
    done(await book(w, r, decisions, preview.token))
    const all = await items(w)
    assert.deepEqual(all.map((i) => i.amountCents).sort((a, b) => a - b), [-5000, 70000])
    const restmuell = all.find((i) => i.amountCents === 70000) ?? assert.fail('Restmüll fehlt')
    const zweite = await receipt(w, 'gutschrift.pdf', [line('Gutschrift', 'Müllabfuhr', -5000)])
    const p = await plan(w, zweite, [link(0, restmuell.id)])
    assert.match(p.errors[0]?.message ?? '', /Gutschrift.*nie mit einer Position verrechnet/)
  })
})

test('Verknüpfen, das eine Summe von 0 € ergäbe, ist ein Fehler', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    const p = await plan(w, r, [{ idx: 0, action: 'link', costItemId: 'wa', amountCents: 0 }])
    assert.match(p.errors.map((e) => e.message).join(' '), /Summe der Zeilen an „Wasser\/Abwasser 2025“ wäre 0,00\s€/)
  })
})

test('Abnahme C: Schätzung mit §35a 1.000 €, Rechnung ohne Lohnanteil: Der Lohnanteil wird mit Ansage entfernt', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'gp', { category: 'Gartenpflege', description: 'Gartenpflege 2025', amountCents: 150000, labor35aCents: 100000 })
    const r = await receipt(w, 'garten.pdf', [line('Gartenpflege Saison', 'Gartenpflege', 145000)])
    const preview = await plan(w, r, [link(0, 'gp')])
    assert.ok(preview.notices.some((n) => /Lohnanteil von 1\.000,00\s€ wird entfernt/.test(n)), preview.notices.join('\n'))
    assert.deepEqual(preview.items.map((i) => [i.afterCents, i.beforeLabor35aCents, i.afterLabor35aCents]), [[145000, 100000, null]])
    done(await book(w, r, [link(0, 'gp')], preview.token))
    const gp = await itemOf(w, 'gp')
    assert.equal(gp.amountCents, 145000)
    assert.equal(gp.labor35aCents ?? null, null)
  })
})

test('§35a: gelesene Lohnanteile gelten als Summe; eine ausdrückliche 0 setzt auf 0 mit Ansage', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'sf', { category: 'Schornsteinfeger', description: 'Schornsteinfeger 2025', amountCents: 20000, labor35aCents: 5000 })
    const r = await receipt(w, 'sf.pdf', [line('Kehren', 'Schornsteinfeger', 12000, 9000), line('Messung', 'Schornsteinfeger', 8000, null)])
    done(await book(w, r, [link(0, 'sf'), link(1, 'sf')]))
    assert.deepEqual([(await itemOf(w, 'sf')).amountCents, (await itemOf(w, 'sf')).labor35aCents], [20000, 9000])

    await estimate(w, 'sf2', { category: 'Schornsteinfeger', description: 'Kehren Nebengebäude', amountCents: 9000, labor35aCents: 5000 })
    const r2 = await receipt(w, 'sf2.pdf', [line('Kehren Nebengebäude', 'Schornsteinfeger', 9000, 0)])
    const p = await plan(w, r2, [link(0, 'sf2')])
    assert.ok(p.notices.some((n) => /Lohnanteil wird auf 0,00\s€ gesetzt/.test(n)), p.notices.join('\n'))
    assert.equal(p.items[0]?.afterLabor35aCents, 0)
  })
})

test('Abnahme D: zweimal hintereinander buchen ergibt eine Position', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    const decisions: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) }]
    const token = (await plan(w, r, decisions)).token
    assert.equal(done(await book(w, r, decisions, token)).changed, true)
    assert.equal(done(await book(w, r, decisions, token)).changed, false)
    assert.equal((await items(w)).length, 1)
  })
})

test('zwei gleichzeitige Buchungen ergeben eine Position; eine andere Entscheidung für dieselbe Zeile ist ein Widerspruch', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    const decisions: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) }]
    const token = (await plan(w, r, decisions)).token
    const [a, b] = await Promise.all([book(w, r, decisions, token), book(w, r, decisions, token)])
    assert.deepEqual([done(a).changed, done(b).changed].sort(), [false, true])
    assert.equal((await items(w)).length, 1)
    const anders = await book(w, r, [{ idx: 0, action: 'dismiss' }], 'egal')
    assert.equal(anders.kind, 'conflict')
  })
})

test('Summenregel über zwei Belege: Abschlag und Restrechnung ergeben die Summe, der Beleg der Position bleibt der erste', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'st', { category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom 2025', amountCents: 90000 })
    const a = await receipt(w, 'abschlag.pdf', [line('Abschlag', 'Beleuchtung/Allgemeinstrom', 50000)])
    done(await book(w, a, [link(0, 'st')]))
    const b = await receipt(w, 'rest.pdf', [line('Restrechnung', 'Beleuchtung/Allgemeinstrom', 30000)])
    const p = await plan(w, b, [link(0, 'st')])
    assert.deepEqual(p.items.map((i) => [i.beforeCents, i.afterCents]), [[50000, 80000]])
    done(await book(w, b, [link(0, 'st')], p.token))
    const st = await itemOf(w, 'st')
    assert.deepEqual([st.amountCents, st.invoiceFile], [80000, 'abschlag.pdf'])
  })
})

test('Von Hand geänderter Betrag einer verknüpften Position wird bei der nächsten Buchung mit Ansage ersetzt', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const a = await receipt(w, 'a.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    done(await book(w, a, [link(0, 'wa')]))
    await w.opened.write((db) => updateEntity(db, 'costItems', 'wa', { amountCents: 75000 }))
    const b = await receipt(w, 'b.pdf', [line('Abwasser', 'Wasser/Abwasser', 80000)])
    const p = await plan(w, b, [link(0, 'wa')])
    assert.ok(p.notices.some((n) => /von Hand auf 750,00\s€ geändert.*1\.500,00\s€/.test(n)), p.notices.join('\n'))
  })
})

test('Gemeinschaftsabrechnung und Einzelbeträge sind keine Verknüpfungsziele; die Vorschau nennt die Position zum Öffnen', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'hg', { category: 'Hauswart', description: 'Hausgeld Hauswart', amountCents: 12000, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1200000 } })
    await estimate(w, 'hz', { category: 'Heizung und Warmwasser', description: 'Heizung laut Messdienst', amountCents: 90000, key: 'amounts', tenancyAmounts: {} })
    const r = await receipt(w, 'x.pdf', [line('Hausmeister', 'Hauswart', 12000), line('Heizung', 'Heizung und Warmwasser', 90000)])
    const p = await plan(w, r, [link(0, 'hg'), link(1, 'hz')])
    assert.deepEqual(p.errors.map((e) => e.openItemId), ['hg', 'hz'])
  })
})

test('Ziel aus anderem Objekt oder Jahr ergibt einen Fehler, kein stilles Umbiegen', async () => {
  await withWorld(async (w) => {
    await w.opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus' }))
    await estimate(w, 'fremd', { propertyId: 'objekt-2' })
    await estimate(w, 'alt', { year: 2024 })
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    assert.match((await plan(w, r, [link(0, 'fremd')])).errors[0]?.message ?? '', /anderen Objekt/)
    assert.match((await plan(w, r, [link(0, 'alt')])).errors[0]?.message ?? '', /gehört zu 2024, der Beleg zu 2025/)
  })
})

test('release rechnet die Summe neu; bleibt keine Zeile, behält die Position ihren Betrag', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    done(await book(w, r, [link(0, 'wa'), link(1, 'wa')]))
    const p = await plan(w, r, [{ idx: 1, action: 'release' }])
    assert.deepEqual(p.items.map((i) => [i.beforeCents, i.afterCents]), [[150000, 70000]])
    done(await book(w, r, [{ idx: 1, action: 'release' }], p.token))
    assert.equal((await itemOf(w, 'wa')).amountCents, 70000)
    const letzte = await plan(w, r, [{ idx: 0, action: 'release' }])
    assert.ok(letzte.notices.some((n) => /behält ihren Betrag von 700,00\s€/.test(n)), letzte.notices.join('\n'))
    done(await book(w, r, [{ idx: 0, action: 'release' }], letzte.token))
    assert.equal((await itemOf(w, 'wa')).amountCents, 70000)
    assert.deepEqual((await view(w, r)).lines.map((l) => l.state), ['open', 'open'])
  })
})

test('Eine angelegte Zeile löst man durch Löschen der Position; danach ist sie wieder offen', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    done(await book(w, r, [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) }]))
    assert.match((await plan(w, r, [{ idx: 0, action: 'release' }])).errors[0]?.message ?? '', /indem Sie die Position löschen/)
    const id = (await items(w))[0]?.id ?? assert.fail('keine Position')
    await w.opened.write((db) => removeEntity(db, 'costItems', id))
    assert.equal((await view(w, r)).lines[0]?.state, 'open')
  })
})

test('Geänderter Stand zwischen Vorschau und Buchung ergibt einen Widerspruch mit neuer Vorschau', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa', { amountCents: 140000 })
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    const preview = await plan(w, r, [link(0, 'wa')])
    await w.opened.write((db) => updateEntity(db, 'costItems', 'wa', { amountCents: 145000 }))
    const stale = await book(w, r, [link(0, 'wa')], preview.token)
    if (stale.kind !== 'stale') return assert.fail(`erwartet stale, bekommen ${stale.kind}`)
    assert.equal(stale.preview.items[0]?.beforeCents, 145000)
    assert.equal((await itemOf(w, 'wa')).amountCents, 145000, 'nichts gebucht')
    done(await book(w, r, [link(0, 'wa')], stale.preview.token))
  })
})

test('Die Vorschau stimmt wörtlich mit dem Ergebnis der Buchung überein', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa', { amountCents: 140000 })
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    const decisions = [link(0, 'wa'), link(1, 'wa')]
    const preview = await plan(w, r, decisions)
    const outcome = await book(w, r, decisions, preview.token)
    if (outcome.kind !== 'done') return assert.fail(outcome.kind)
    assert.deepEqual(outcome.preview, preview)
  })
})

test('Zeile mit Kandidat: Anlegen nur nach ausdrücklicher Bestätigung', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'gs', { category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 61000 })
    const r = await receipt(w, 'gs.pdf', [line('Abgabenbescheid', 'Grundsteuer', 61240)])
    const ohne: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Abgabenbescheid', 'Grundsteuer', 61240) }]
    const p = await plan(w, r, ohne)
    assert.match(p.confirm[0]?.message ?? '', /„Grundsteuer 2025“ \(610,00\s€, ohne Beleg\)/)
    assert.equal((await book(w, r, ohne, p.token)).kind, 'refused')
    const mit: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Abgabenbescheid', 'Grundsteuer', 61240), despiteCandidates: true }]
    done(await book(w, r, mit))
    assert.equal((await items(w)).length, 2)
  })
})

test('Eine Auswertung ohne Objekt lässt sich nicht buchen', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)], { propertyId: null })
    const p = await plan(w, r, [{ idx: 0, action: 'create', fields: fields('Frischwasser', 'Wasser/Abwasser', 70000) }])
    assert.match(p.errors[0]?.message ?? '', /Zu welchem Objekt gehört dieser Beleg/)
  })
})

test('Ist die Datei des Belegs gelöscht, gibt es weder Vorschau noch Buchung', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'weg.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    fs.rmSync(path.join(w.uploadDir, 'weg.pdf'))
    const decisions: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Frischwasser', 'Wasser/Abwasser', 70000) }]
    const gone = (err: unknown) => err instanceof BookingRefusal && err.status === 404 && /gibt es im Belegordner nicht mehr/.test(err.message)
    await assert.rejects(plan(w, r, decisions), gone)
    await assert.rejects(book(w, r, decisions, 'egal'), gone)
    assert.equal((await items(w)).length, 0)
  })
})

test('Gleicher Inhalt als zweite Datei: rot, und Verknüpfen mit der Position, die ihn schon enthält, ist ein Fehler', async () => {
  await withWorld(async (w) => {
    const row = (file: string) => ({ file, originalName: file, mimeType: 'application/pdf', size: 10, sha256: 'gleich', uploadedAt: '2026-10-02T00:00:00.000Z', propertyId: null, year: null, invoiceDate: null, kind: 'receipt' as const })
    await w.opened.write((db) => recordUpload(db, row('a.pdf')))
    await w.opened.write((db) => recordUpload(db, row('b.pdf')))
    await estimate(w, 'wa')
    const a = await receipt(w, 'a.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    done(await book(w, a, [link(0, 'wa')]))
    const b = await receipt(w, 'b.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    assert.match((await plan(w, b, [link(0, 'wa')])).errors[0]?.message ?? '', /enthält diesen Beleg schon/)
    const shown = (await view(w, b)).lines[0]?.suggestion ?? assert.fail('kein Vorschlag')
    assert.equal(shown.level, 'rot')
    assert.ok(shown.reasons.some((x) => /gleicher Inhalt wie „a\.pdf“/.test(x)))
    assert.equal(shown.preselected, false)
  })
})

test('Vorschläge: mit Kandidat nicht vorab angehakt, rot nicht, grün schon', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'gs', { category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 61000 })
    const r = await receipt(w, 'mix.pdf', [
      line('Abgabenbescheid', 'Grundsteuer', 61240), line('Hausmeister', 'Hauswart', 30000), line('Unklar', 'Sonstige Betriebskosten', 1000),
    ])
    const v = await view(w, r)
    assert.deepEqual(v.lines.map((l) => [l.suggestion?.preselected, l.suggestion?.candidates.map((c) => c.id)]), [[false, ['gs']], [true, []], [false, []]])
    assert.equal(v.lines[2]?.suggestion?.level, 'rot')
    assert.equal(v.open, true)
  })
})

// ---------- Entscheidungen des Steuerers zu Task 3 ----------

test('Restmüll an die Gutschrift-Position verknüpfen ist ein Fehler', async () => {
  await withWorld(async (w) => {
    const g = await receipt(w, 'gutschrift.pdf', [line('Gutschrift Tonnentausch', 'Müllabfuhr', -5000)])
    done(await book(w, g, [{ idx: 0, action: 'create', fields: fields('Gutschrift Tonnentausch', 'Müllabfuhr', -5000) }]))
    const gutschrift = (await items(w))[0] ?? assert.fail('Gutschrift fehlt')
    const r = await receipt(w, 'muell.pdf', [line('Restmüll', 'Müllabfuhr', 70000)])
    const p = await plan(w, r, [link(0, gutschrift.id)])
    assert.match(p.errors[0]?.message ?? '', /Gutschrift/)
    assert.equal((await book(w, r, [link(0, gutschrift.id)], p.token)).kind, 'refused')
    assert.equal((await itemOf(w, gutschrift.id)).amountCents, -5000, 'nichts verrechnet')
    // Auch wenn die Position inzwischen von Hand einen positiven Betrag trägt: Die Gutschrift hängt an ihr.
    await w.opened.write((db) => updateEntity(db, 'costItems', gutschrift.id, { amountCents: 100 }))
    assert.match((await plan(w, r, [link(0, gutschrift.id)])).errors[0]?.message ?? '', /Gutschrift/)
    // Und die Ansicht bietet sie nicht als Ziel an.
    assert.deepEqual((await view(w, r)).lines[0]?.suggestion?.candidates.map((c) => c.id), [])
  })
})

test('Eine Position mit negativem Betrag ist kein Verknüpfungsziel, auch ohne Beleg', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'gut', { category: 'Müllabfuhr', description: 'Müllabfuhr Gutschrift', amountCents: -5000 })
    const r = await receipt(w, 'muell.pdf', [line('Restmüll', 'Müllabfuhr', 70000)])
    assert.match((await plan(w, r, [link(0, 'gut')])).errors[0]?.message ?? '', /Gutschrift/)
    assert.deepEqual((await view(w, r)).lines[0]?.suggestion?.candidates.map((c) => c.id), [])
    const anlegen: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Restmüll', 'Müllabfuhr', 70000) }]
    assert.deepEqual((await plan(w, r, anlegen)).confirm, [], 'eine Gutschrift ist keine mögliche Doppelung')
  })
})

test('Eine verworfene Zeile mit älterer Vorschau anlegen ergibt einen veralteten Stand, nichts wird gebucht', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    const anlegen: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) }]
    const tabB = await plan(w, r, anlegen)
    done(await book(w, r, [{ idx: 0, action: 'dismiss' }]))
    const stale = await book(w, r, anlegen, tabB.token)
    if (stale.kind !== 'stale') return assert.fail(`erwartet stale, bekommen ${stale.kind}`)
    assert.notEqual(stale.preview.token, tabB.token)
    assert.equal((await items(w)).length, 0, 'nichts gebucht')
    assert.equal((await view(w, r)).lines[0]?.state, 'dismissed')
  })
})

test('Lösen der Zeile des Belegs, den die Position trägt, gibt ihr den Beleg der verbleibenden Zeile, mit Ansage', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const a = await receipt(w, 'a.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    done(await book(w, a, [link(0, 'wa')]))
    const b = await receipt(w, 'b.pdf', [line('Abwasser', 'Wasser/Abwasser', 80000)])
    done(await book(w, b, [link(0, 'wa')]))
    assert.deepEqual([(await itemOf(w, 'wa')).amountCents, (await itemOf(w, 'wa')).invoiceFile], [150000, 'a.pdf'])
    const p = await plan(w, a, [{ idx: 0, action: 'release' }])
    assert.ok(p.notices.some((n) => /trägt künftig den Beleg „b\.pdf“/.test(n)), p.notices.join('\n'))
    done(await book(w, a, [{ idx: 0, action: 'release' }], p.token))
    assert.deepEqual([(await itemOf(w, 'wa')).amountCents, (await itemOf(w, 'wa')).invoiceFile], [80000, 'b.pdf'])
    // Bleibt keine Zeile, behält die Position ihren Stand, auch den Beleg.
    done(await book(w, b, [{ idx: 0, action: 'release' }]))
    assert.deepEqual([(await itemOf(w, 'wa')).amountCents, (await itemOf(w, 'wa')).invoiceFile], [80000, 'b.pdf'])
  })
})

test('Ein von Hand angehängter Beleg wird beim Lösen nie ersetzt', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa', { invoiceFile: 'hand.pdf' })
    const a = await receipt(w, 'a.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    done(await book(w, a, [link(0, 'wa')]))
    const b = await receipt(w, 'b.pdf', [line('Abwasser', 'Wasser/Abwasser', 80000)])
    done(await book(w, b, [link(0, 'wa')]))
    const p = await plan(w, a, [{ idx: 0, action: 'release' }])
    assert.ok(!p.notices.some((n) => /trägt künftig/.test(n)), p.notices.join('\n'))
    done(await book(w, a, [{ idx: 0, action: 'release' }], p.token))
    assert.deepEqual([(await itemOf(w, 'wa')).amountCents, (await itemOf(w, 'wa')).invoiceFile], [80000, 'hand.pdf'])
  })
})

test('Eine Position ohne Beleg bekommt beim Lösen den Beleg einer verbleibenden Zeile, nie den gelösten', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const a = await receipt(w, 'a.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    done(await book(w, a, [link(0, 'wa')]))
    const b = await receipt(w, 'b.pdf', [line('Abwasser', 'Wasser/Abwasser', 80000)])
    done(await book(w, b, [link(0, 'wa')]))
    await w.opened.write((db) => updateEntity(db, 'costItems', 'wa', { invoiceFile: null }))
    assert.equal((await itemOf(w, 'wa')).invoiceFile ?? null, null, 'Vorbedingung: Beleg von Hand entfernt')
    done(await book(w, a, [{ idx: 0, action: 'release' }]))
    assert.deepEqual([(await itemOf(w, 'wa')).amountCents, (await itemOf(w, 'wa')).invoiceFile], [80000, 'b.pdf'])
  })
})

// ---------- Fixrunde 1 ----------

test('Verknüpfen mit anders berichtigtem Betrag oder Lohnanteil ist ein Widerspruch, gleich berichtigt ohne Änderung', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000)])
    const erst: LineDecision = { idx: 0, action: 'link', costItemId: 'wa', amountCents: 72000, labor35aCents: 1000 }
    done(await book(w, r, [erst]))
    assert.equal(done(await book(w, r, [erst])).changed, false)
    assert.equal(done(await book(w, r, [link(0, 'wa')])).changed, false, 'ohne Berichtigung gilt die gespeicherte')
    assert.equal((await book(w, r, [{ ...erst, amountCents: 75000 }])).kind, 'conflict')
    assert.equal((await book(w, r, [{ ...erst, labor35aCents: 2000 }])).kind, 'conflict')
    assert.equal((await itemOf(w, 'wa')).amountCents, 72000)
  })
})

test('Ein Widerspruch wird nicht von einer unveränderten Zeile derselben Anfrage verdeckt', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    done(await book(w, r, [link(0, 'wa'), link(1, 'wa')]))
    const o = await book(w, r, [link(0, 'wa'), { idx: 1, action: 'link', costItemId: 'wa', amountCents: 81000 }])
    assert.equal(o.kind, 'conflict')
    assert.equal((await itemOf(w, 'wa')).amountCents, 150000)
  })
})

test('Anlegen mit anderen Feldern als gebucht ist ein Widerspruch', async () => {
  await withWorld(async (w) => {
    await w.opened.write((db) => createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true }))
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    const gs = fields('Grundsteuer 2025', 'Grundsteuer', 61240)
    done(await book(w, r, [{ idx: 0, action: 'create', fields: gs }]))
    assert.equal(done(await book(w, r, [{ idx: 0, action: 'create', fields: gs }])).changed, false)
    const anders: LineFields[] = [
      { ...gs, amountCents: 61000 },
      { ...gs, description: 'Grundsteuer B' },
      { ...gs, category: 'Versicherung' },
      { ...gs, labor35aCents: 100 },
      { ...gs, key: 'units' },
      { ...gs, key: 'direct', allocation: { key: 'direct', meterType: null, directUnitId: 'u2', customShares: null, participantUnitIds: null, externalBasis: null } },
    ]
    for (const f of anders) {
      const o = await book(w, r, [{ idx: 0, action: 'create', fields: f }], 'egal')
      assert.equal(o.kind, 'conflict', JSON.stringify(f))
    }
    assert.equal((await items(w)).length, 1)
  })
})

test('Gutschrift-Zeile: Kandidaten sind nur Gutschrift-Positionen, in Ansicht und Vorschau dieselben', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'mp', { category: 'Müllabfuhr', description: 'Restmüll 2025', amountCents: 70000 })
    await estimate(w, 'mg', { category: 'Müllabfuhr', description: 'Gutschrift Tonne', amountCents: -5000 })
    const r = await receipt(w, 'm.pdf', [line('Gutschrift Tonnentausch', 'Müllabfuhr', -5000), line('Biomüll', 'Müllabfuhr', 30000)])
    const v = await view(w, r)
    const shown = v.lines.map((l) => (l.suggestion ?? assert.fail('kein Vorschlag')).candidates.map((c) => c.id))
    assert.deepEqual(shown, [['mg'], ['mp']])
    for (const l of v.lines) {
      const s = l.suggestion ?? assert.fail('kein Vorschlag')
      const p = await plan(w, r, [{ idx: l.idx, action: 'create', fields: s.fields }])
      const msg = p.confirm[0]?.message ?? assert.fail('keine Rückfrage')
      const named = [...msg.matchAll(/„([^“]+)“ \(/g)].map((m) => m[1])
      assert.deepEqual(named, s.candidates.map((c) => c.description), msg)
    }
    const gutschrift = (await plan(w, r, [{ idx: 0, action: 'create', fields: fields('Gutschrift Tonnentausch', 'Müllabfuhr', -5000) }])).confirm[0]?.message ?? ''
    assert.doesNotMatch(gutschrift, /verknüpf/)
  })
})

test('Prüfmarke: ein anderer Schlüssel zwischen Vorschau und Buchung ergibt einen veralteten Stand', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    const p = await plan(w, r, [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) }])
    const o = await book(w, r, [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240, { key: 'units' }) }], p.token)
    assert.equal(o.kind, 'stale')
    assert.equal((await items(w)).length, 0)
  })
})

test('Verknüpfen mit berichtigtem Betrag und Lohnanteil: Position und Zeile tragen die Berichtigung', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'gp', { category: 'Gartenpflege', description: 'Gartenpflege 2025', amountCents: 150000 })
    const r = await receipt(w, 'g.pdf', [line('Gartenpflege', 'Gartenpflege', 140000, 30000)])
    const d: LineDecision = { idx: 0, action: 'link', costItemId: 'gp', amountCents: 145000, labor35aCents: 40000 }
    const p = await plan(w, r, [d])
    assert.deepEqual(p.items.map((i) => [i.afterCents, i.afterLabor35aCents]), [[145000, 40000]])
    done(await book(w, r, [d], p.token))
    const gp = await itemOf(w, 'gp')
    assert.deepEqual([gp.amountCents, gp.labor35aCents], [145000, 40000])
    const l = (await view(w, r)).lines[0] ?? assert.fail('keine Zeile')
    assert.deepEqual([l.state, l.amountCents, l.labor35aCents], ['linked', 145000, 40000])
  })
})

test('Verknüpfen einer Zeile ohne gelesenen Betrag ist ein Fehler, bis der Betrag eingetragen ist', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', null)])
    const p = await plan(w, r, [link(0, 'wa')])
    assert.match(p.errors[0]?.message ?? '', /Betrag ist nicht gelesen/)
    assert.equal((await book(w, r, [link(0, 'wa')], p.token)).kind, 'refused')
    done(await book(w, r, [{ idx: 0, action: 'link', costItemId: 'wa', amountCents: 70000 }]))
    assert.equal((await itemOf(w, 'wa')).amountCents, 70000)
  })
})

test('Angelegte und verknüpfte Zeile an derselben Position: Lösen der verknüpften lässt die angelegte stehen', async () => {
  await withWorld(async (w) => {
    const a = await receipt(w, 'a.pdf', [line('Grundsteuer', 'Grundsteuer', 61240)])
    done(await book(w, a, [{ idx: 0, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) }]))
    const id = (await items(w))[0]?.id ?? assert.fail('keine Position')
    const b = await receipt(w, 'b.pdf', [line('Nachveranlagung', 'Grundsteuer', 1000)])
    done(await book(w, b, [link(0, id)]))
    assert.equal((await itemOf(w, id)).amountCents, 62240)
    done(await book(w, b, [{ idx: 0, action: 'release' }]))
    assert.deepEqual([(await itemOf(w, id)).amountCents, (await itemOf(w, id)).invoiceFile], [61240, 'a.pdf'])
  })
})

test('Löschen einer verknüpften Position macht ihre Zeilen offen; neu verknüpft zählt nur, was verknüpft ist', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'w.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Abwasser', 'Wasser/Abwasser', 80000)])
    done(await book(w, r, [link(0, 'wa'), link(1, 'wa')]))
    await w.opened.write((db) => removeEntity(db, 'costItems', 'wa'))
    assert.deepEqual((await view(w, r)).lines.map((l) => l.state), ['open', 'open'])
    await estimate(w, 'wa2', { amountCents: 100000 })
    done(await book(w, r, [link(0, 'wa2')]))
    assert.equal((await itemOf(w, 'wa2')).amountCents, 70000)
  })
})

test('Scheitert ein Schritt mitten in der Buchung, ist nichts geschrieben', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    await estimate(w, 'andere', { category: 'Hauswart', description: 'Hauswart 2025', amountCents: 30000 })
    const r = await receipt(w, 'x.pdf', [line('Frischwasser', 'Wasser/Abwasser', 70000), line('Grundsteuer', 'Grundsteuer', 61240), line('Versicherung', 'Versicherung', 40000)])
    const decisions: LineDecision[] = [
      link(0, 'wa'),
      { idx: 1, action: 'create', fields: fields('Grundsteuer 2025', 'Grundsteuer', 61240) },
      { idx: 2, action: 'create', fields: fields('Versicherung 2025', 'Versicherung', 40000) },
    ]
    const token = (await plan(w, r, decisions)).token
    // Die zweite neue Position bekommt die Kennung einer vorhandenen, unbeteiligten: Das Einfügen
    // scheitert, nachdem die erste schon eingefügt ist.
    const ids = ['frisch', 'andere']
    await assert.rejects(w.opened.write((db) => bookAssessment(db, r.assessment.id, decisions, token, { uploadDir: w.uploadDir, newId: () => ids.shift() ?? 'leer' })))
    assert.deepEqual((await items(w)).map((i) => [i.id, i.amountCents]), [['wa', 150000], ['andere', 30000]])
    assert.deepEqual((await view(w, r)).lines.map((l) => l.state), ['open', 'open', 'open'])
  })
})

test('parseDecisions liest gültige Entscheidungen und lehnt unlesbare ab', () => {
  const allocation = { key: 'direct', meterType: null, directUnitId: 'u1', customShares: null, participantUnitIds: null, externalBasis: null }
  const f = { description: 'Grundsteuer', category: 'Grundsteuer', amountCents: 100, labor35aCents: null, key: 'direct', allocation, externalTotalCents: null }
  assert.deepEqual(parseDecisions([
    { idx: 0, action: 'create', fields: f, despiteCandidates: true },
    { idx: 1, action: 'link', costItemId: 'c1', amountCents: 500, labor35aCents: null },
    { idx: 2, action: 'link', costItemId: 'c1' },
    { idx: 3, action: 'dismiss' },
    { idx: 4, action: 'release' },
  ]), { decisions: [
    { idx: 0, action: 'create', fields: { ...f, key: 'direct', allocation: { ...allocation, key: 'direct' } }, despiteCandidates: true },
    { idx: 1, action: 'link', costItemId: 'c1', amountCents: 500, labor35aCents: null },
    { idx: 2, action: 'link', costItemId: 'c1' },
    { idx: 3, action: 'dismiss' },
    { idx: 4, action: 'release' },
  ] })
  const { meterType: _ohne, ...unvollstaendig } = allocation
  const kaputt: unknown[] = [
    'keine Liste',
    [{ action: 'dismiss' }],
    [{ idx: -1, action: 'dismiss' }],
    [{ idx: 1.5, action: 'dismiss' }],
    [{ idx: 0, action: 'buchen' }],
    [{ idx: 0, action: 'link' }],
    [{ idx: 0, action: 'link', costItemId: '' }],
    [{ idx: 0, action: 'link', costItemId: 'c1', amountCents: 1.5 }],
    [{ idx: 0, action: 'link', costItemId: 'c1', amountCents: '700' }],
    [{ idx: 0, action: 'create', fields: { ...f, key: 'erfunden' } }],
    [{ idx: 0, action: 'create', fields: { ...f, amountCents: 1.5 } }],
    [{ idx: 0, action: 'create', fields: { ...f, allocation: unvollstaendig } }],
    [{ idx: 0, action: 'create', fields: { ...f, allocation: { ...allocation, meterType: 'gas' } } }],
    [{ idx: 0, action: 'create', fields: f, despiteCandidates: 'ja' }],
  ]
  for (const raw of kaputt) assert.ok('error' in parseDecisions(raw), JSON.stringify(raw))
})

test('Dasselbe Anlegen mit Verteilung (direkt, laut Gemeinschaftsabrechnung) noch einmal ist ohne Änderung', async () => {
  await withWorld(async (w) => {
    const none = { meterType: null, directUnitId: null, customShares: null, participantUnitIds: null, externalBasis: null }
    const r = await receipt(w, 'x.pdf', [line('Reparatur', 'Sonstige Betriebskosten', 20000), line('Hausmeister', 'Hauswart', 12000)])
    const decisions: LineDecision[] = [
      { idx: 0, action: 'create', fields: fields('Reparatur EG', 'Sonstige Betriebskosten', 20000, { key: 'direct', allocation: { ...none, key: 'direct', directUnitId: 'u1' } }) },
      { idx: 1, action: 'create', fields: fields('Hausmeister', 'Hauswart', 12000, {
        key: 'external', allocation: { ...none, key: 'external', externalBasis: { measure: 'mea', total: 1000 } }, externalTotalCents: 1200000,
      }) },
    ]
    const p = await plan(w, r, decisions)
    assert.deepEqual([p.errors, p.confirm], [[], []])
    done(await book(w, r, decisions, p.token))
    assert.equal(done(await book(w, r, decisions)).changed, false)
    assert.equal((await items(w)).length, 2)
  })
})

// ---------- Schlussdurchsicht ----------

test('I1: Ein Beleg aus einem anderen Jahr als dem gewählten ist gelb und nicht vorab angehakt', async () => {
  await withWorld(async (w) => {
    // Rechnung vom 10.02.2025 ohne Leistungszeitraum, ausgewertet auf der Seite des Jahres 2024
    const r = await receipt(w, 'wasser.pdf', [line('Hausmeister', 'Hauswart', 30000)], { year: 2025, detectedYear: 2025, requestedYear: 2024, invoiceDate: '2025-02-10' })
    const s = (await view(w, r)).lines[0]?.suggestion ?? assert.fail('kein Vorschlag')
    assert.equal(s.level, 'gelb')
    assert.equal(s.preselected, false)
    assert.ok(s.reasons.some((x) => /2025/.test(x) && /2024/.test(x)), s.reasons.join('\n'))
    // Aus dem Jahr des Belegs ausgewertet: grün und vorab angehakt, wie bisher.
    const g = await receipt(w, 'gleich.pdf', [line('Hausmeister', 'Hauswart', 30000)], { year: 2025, detectedYear: 2025, requestedYear: 2025 })
    const t = (await view(w, g)).lines[0]?.suggestion ?? assert.fail('kein Vorschlag')
    assert.deepEqual([t.level, t.preselected], ['gruen', true])
  })
})

test('I2: Verwerfen allein ergibt einen Hinweis in der Vorschau', async () => {
  await withWorld(async (w) => {
    const r = await receipt(w, 'gs.pdf', [line('Grundsteuer', 'Grundsteuer', 61240), line('Mahngebühr', 'Grundsteuer', 500)])
    const p = await plan(w, r, [{ idx: 1, action: 'dismiss' }])
    assert.deepEqual([p.items, p.errors, p.notices], [[], [], ['„Mahngebühr“ wird verworfen.']])
    const o = await book(w, r, [{ idx: 1, action: 'dismiss' }], p.token)
    if (o.kind !== 'done') return assert.fail(`nicht gebucht: ${o.kind}`)
    assert.deepEqual(o.preview.notices, ['„Mahngebühr“ wird verworfen.'])
  })
})

test('M2: Bei Einzelbeträgen und Gemeinschaftsabrechnung sagt die Vorschau, die Zeile danach zu verwerfen', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'hz', { category: 'Heizung und Warmwasser', description: 'Heizung laut Messdienst', amountCents: 90000, key: 'amounts', tenancyAmounts: {} })
    const r = await receipt(w, 'x.pdf', [line('Heizung', 'Heizung und Warmwasser', 90000)])
    const p = await plan(w, r, [link(0, 'hz')])
    assert.match(p.errors[0]?.message ?? '', /verwerfen Sie diese Zeile/)
  })
})

test('M3: Hängt der Beleg schon von Hand an einer Position, ist sie Kandidat jeder Zeile; rot, und Anlegen nur nach Bestätigung', async () => {
  await withWorld(async (w) => {
    // Nachgereicht: Der Beleg hängt an der Position, ohne dass eine Zeile gebucht ist. Andere Kostenart als die Zeile.
    await estimate(w, 'hm', { category: 'Hauswart', description: 'Hausmeister 2025', amountCents: 30000, invoiceFile: 'beleg.pdf' })
    const r = await receipt(w, 'beleg.pdf', [line('Treppenhausreinigung', 'Gebäudereinigung', 30000)])
    const s = (await view(w, r)).lines[0]?.suggestion ?? assert.fail('kein Vorschlag')
    assert.equal(s.level, 'rot')
    assert.equal(s.preselected, false)
    assert.ok(s.reasons.includes('Dieser Beleg hängt schon an „Hausmeister 2025“.'), s.reasons.join('\n'))
    assert.deepEqual(s.candidates.map((c) => c.id), ['hm'])
    const anlegen: LineDecision[] = [{ idx: 0, action: 'create', fields: fields('Treppenhausreinigung', 'Gebäudereinigung', 30000) }]
    const p = await plan(w, r, anlegen)
    assert.match(p.confirm[0]?.message ?? '', /hängt schon an „Hausmeister 2025“/)
    assert.equal((await book(w, r, anlegen, p.token)).kind, 'refused')
    assert.equal((await items(w)).length, 1, 'ohne Bestätigung entsteht keine zweite Position')
    done(await book(w, r, [{ idx: 0, action: 'create', fields: fields('Treppenhausreinigung', 'Gebäudereinigung', 30000), despiteCandidates: true }]))
    assert.equal((await items(w)).length, 2)
  })
})

// Integrationsdurchsicht vor 0.10 (N1): Verknüpfen ändert den Betrag einer Position. Liegt sie in
// einem Jahr mit abgeschlossener Abrechnung, sagt die Vorschau es; geändert wird trotzdem, denn
// die Abrechnung bleibt eingefroren und zeigt die Änderung als Abweichung.
test('Verknüpfen in ein Jahr mit abgeschlossener Abrechnung: die Vorschau sagt es', async () => {
  await withWorld(async (w) => {
    await estimate(w, 'wa')
    const r = await receipt(w, 'wasser.pdf', [line('Frischwasser', 'Wasser/Abwasser', 160000)])
    const ohne = await plan(w, r, [link(0, 'wa')])
    assert.equal(ohne.notices.some((n) => n.includes('abgeschlossen')), false, 'offenes Jahr: kein Hinweis')
    await w.opened.write((db) => closeSettlement(db, { id: 's', propertyId: 'objekt-1', year: 2025, closedAt: '2026-03-01T00:00:00.000Z', sentAt: null, settlement: {} }))
    const mit = await plan(w, r, [link(0, 'wa')])
    assert.ok(mit.notices.includes('„Wasser/Abwasser 2025“: Die Abrechnung 2025 ist abgeschlossen; die Änderung erscheint dort als Abweichung.'), JSON.stringify(mit.notices))
    // Bleibt der Betrag, wie er ist, ändert sich nichts, und es gibt nichts zu sagen.
    const gleich = await receipt(w, 'gleich.pdf', [line('Wasser', 'Wasser/Abwasser', 150000)])
    await estimate(w, 'wb', { description: 'Wasser B' })
    const p2 = await plan(w, gleich, [link(0, 'wb')])
    assert.equal(p2.notices.some((n) => n.includes('abgeschlossen')), false, JSON.stringify(p2.notices))
  })
})

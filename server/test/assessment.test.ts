// Reine Regeln der gespeicherten Auswertung (Belegbuchung, #170): was aus der Antwort der KI an
// Zeilen wird und in welchem Zustand eine Zeile ist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { describeAssessment, detectedYear, lineDraft, lineState, linesFromExtraction, openTargets, withoutBooked, type DescribeContext, type NewLine } from '../src/assessment.ts'
import { categoryDeviationPct } from '../../shared/assessment.ts'
import type { CostItem, StoredAssessment, StoredAssessmentLine, Unit } from '../../shared/types.ts'
import type { Allocation } from '../../shared/allocation.ts'
import { costItemBody } from '../../shared/costItem.ts'
import { calendarPeriod } from '../../shared/period.ts'

test('Zeilen aus der KI: Kostenart zugeordnet, Cent, nicht gelesener Lohnanteil bleibt null, 0 bleibt 0', () => {
  const lines = linesFromExtraction({
    vendor: 'Stadtwerke',
    positions: [
      { description: 'Frischwasser', category: 'Wasser', amountEur: 612.4, labor35aEur: null },
      { description: 'Kanalgebühr', category: 'Gebühren', amountEur: 80, labor35aEur: 0 },
      { description: 'Unlesbar', category: 'Wasser/Abwasser' },
    ],
  })
  assert.deepEqual(lines, [
    { description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 61240, labor35aCents: null },
    { description: 'Kanalgebühr', category: 'Wasser/Abwasser', categoryGuessed: true, amountCents: 8000, labor35aCents: 0 },
    { description: 'Unlesbar', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: null, labor35aCents: null },
  ])
})

test('Jahr aus dem Beleg: erst der Leistungszeitraum, dann das Rechnungsdatum, sonst keines', () => {
  assert.equal(detectedYear({ periodStart: '2025-01-01', invoiceDate: '2026-02-15' }), 2025)
  assert.equal(detectedYear({ invoiceDate: '2026-02-15' }), 2026)
  assert.equal(detectedYear({}), null)
})

const stored = (patch: Partial<StoredAssessmentLine>): StoredAssessmentLine => ({
  assessmentId: 'a1', idx: 0, description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false,
  amountCents: 70000, labor35aCents: null, booking: null, costItemId: null, dismissed: false, reassessed: false, ...patch,
})

test('Zustand einer Zeile: abgeleitet aus Position, Art und Verwerfen', () => {
  assert.equal(lineState(stored({})), 'open')
  assert.equal(lineState(stored({ dismissed: true })), 'dismissed')
  assert.equal(lineState(stored({ costItemId: 'c1', booking: 'created' })), 'created')
  assert.equal(lineState(stored({ costItemId: 'c1', booking: 'linked' })), 'linked')
  // Nach dem Löschen der Position bleibt `booking` stehen, die Zeile ist trotzdem offen.
  assert.equal(lineState(stored({ costItemId: null, booking: 'linked' })), 'open')
})

test('Erneut ausgewertet: eine Zeile, die einer gebuchten gleicht, kommt nicht noch einmal', () => {
  const fresh: NewLine[] = [
    { description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 70000, labor35aCents: null },
    { description: 'Abwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 80000, labor35aCents: null },
  ]
  // Die gebuchte Zeile trägt eine von Hand geänderte Beschreibung; gleich sind Betrag und Kostenart.
  const booked = [stored({ description: 'Wasser 2025 (geändert)', costItemId: 'c1', booking: 'created' })]
  assert.deepEqual(withoutBooked(fresh, booked).map((l) => l.description), ['Abwasser'])
})

// ---------- Entwurf einer KI-Zeile (bisher aiPositionBody in client/src/costForm.memory.test.ts) ----------

const UNITS3: Unit[] = ['u1', 'u2', 'u3'].map((id) => ({ id, propertyId: 'objekt-1', name: id.toUpperCase(), areaM2: 50, participates: true }))
const fieldsOf = (description: string, category: string, amountCents: number, key: Allocation['key'], allocation: Allocation | null, externalTotalCents: number | null = null) =>
  ({ description, category, amountCents, labor35aCents: null, key, allocation, externalTotalCents })
const ALLOC = (patch: Partial<Allocation>): Allocation => ({ key: 'area', meterType: null, directUnitId: null, customShares: null, participantUnitIds: null, externalBasis: null, ...patch })

test('Entwurf einer KI-Zeile: Teilnehmer, Beleg und Rechnungssteller wie bisher bei der KI-Übernahme', () => {
  const draft = lineDraft(fieldsOf('Aufzugswartung', 'Aufzug', 48000, 'area', ALLOC({ participantUnitIds: ['u1', 'u2'] })), { vendor: 'Lift GmbH', invoiceFile: 'b.pdf' }, UNITS3)
  const built = costItemBody(draft, UNITS3, 2026)
  if (!('body' in built)) return assert.fail(built.error)
  assert.deepEqual([built.body.key, built.body.participantUnitIds, built.body.amountCents, built.body.vendor, built.body.invoiceFile, built.body.year], ['area', ['u1', 'u2'], 48000, 'Lift GmbH', 'b.pdf', 2026])
})

test('Entwurf einer KI-Zeile: die Gemeinschaftsabrechnung verlangt die Kosten der Gemeinschaft', () => {
  const alloc = ALLOC({ key: 'external', externalBasis: { measure: 'mea', total: 1000 } })
  const ohne = costItemBody(lineDraft(fieldsOf('Hauswart', 'Hauswart', 12000, 'external', alloc), { vendor: 'WEG', invoiceFile: 'h.pdf' }, UNITS3), UNITS3, 2026)
  assert.match('error' in ohne ? ohne.error : '', /Gemeinschaft/)
  const mit = costItemBody(lineDraft(fieldsOf('Hauswart', 'Hauswart', 12000, 'external', alloc, 12000000), { vendor: 'WEG', invoiceFile: 'h.pdf' }, UNITS3), UNITS3, 2026)
  assert.ok('body' in mit && JSON.stringify(mit.body.externalBasis) === JSON.stringify({ measure: 'mea', total: 1000, totalCents: 12000000 }))
})

test('Entwurf einer KI-Zeile ohne Gedächtnis: nur der Schlüssel, Nebenfelder leer; 0 € ist keine Position', () => {
  const built = costItemBody(lineDraft(fieldsOf('Müll', 'Müllabfuhr', 6000, 'persons', null), { vendor: 'Stadt', invoiceFile: 'm.pdf' }, UNITS3), UNITS3, 2026)
  if (!('body' in built)) return assert.fail(built.error)
  assert.deepEqual(built.body, {
    year: 2026, category: 'Müllabfuhr', description: 'Müll', vendor: 'Stadt', amountCents: 6000, labor35aCents: undefined, key: 'persons',
    directUnitId: null, meterType: null, customShares: null, participantUnitIds: null, externalBasis: null, tenancyAmounts: null,
    selfAmounts: null, invoiceFile: 'm.pdf',
  })
  const null0 = costItemBody(lineDraft(fieldsOf('Müll', 'Müllabfuhr', 0, 'persons', null), { vendor: 'Stadt', invoiceFile: 'm.pdf' }, UNITS3), UNITS3, 2026)
  assert.match('error' in null0 ? null0.error : '', /0 €/)
})

test('Entwurf einer KI-Zeile „Nicht umlagefähig“: ein gemerkter Schlüssel wird keine Einheit für die Steuer (#163)', () => {
  // Wechselt eine Zeile mit gemerktem Schlüssel (hier nur U1 und U2, oder direkt U3) die Kostenart
  // zu „Nicht umlagefähig“, zeigt die Zeile „— trägt der Vermieter“ und keine Einheit. Gebucht
  // werden muss dann auch keine: Sonst wäre die Position für die Steuer still nur diesen Einheiten
  // zugeordnet, und ihr privater Teil verschöbe sich, ohne dass jemand es gewählt hätte.
  for (const alloc of [ALLOC({ participantUnitIds: ['u1', 'u2'] }), ALLOC({ key: 'direct', directUnitId: 'u3' })]) {
    const built = costItemBody(lineDraft(fieldsOf('Dachrinne', 'Nicht umlagefähig', 30000, alloc.key, alloc), { vendor: 'Dachdecker', invoiceFile: 'd.pdf' }, UNITS3), UNITS3, 2026)
    if (!('body' in built)) return assert.fail(built.error)
    assert.deepEqual([built.body.key, built.body.directUnitId, built.body.participantUnitIds], ['area', null, null])
  }
})

// ---------- Abweichung zum Vorjahr beim Verknüpfen mit einer Schätzung ----------

const assessmentOf = (patch: Partial<StoredAssessment> = {}): StoredAssessment => ({
  id: 'a1', file: 'grundsteuer.pdf', propertyId: 'objekt-1', year: 2026, detectedYear: 2026, requestedPeriod: calendarPeriod(2026), vendor: 'Stadt Musterstadt',
  invoiceDate: '2026-02-15', totalGrossCents: 51240, amountsAdjusted: null, laborFromTotal: false, nextIdx: 1, createdAt: '2026-02-20T10:00:00Z', ...patch,
})
const grundsteuer = (patch: Partial<CostItem>): CostItem => ({
  id: 'x', propertyId: 'objekt-1', year: 2026, category: 'Grundsteuer', description: 'Grundsteuer', vendor: 'Stadt Musterstadt', amountCents: 49800, key: 'area', ...patch,
})
const describeWith = (items: CostItem[], booked: DescribeContext['booked'] = []) => {
  const line = stored({ description: 'Grundsteuer 2026', category: 'Grundsteuer', amountCents: 51240 })
  const view = describeAssessment({ assessment: assessmentOf(), lines: [line] }, {
    items, units: UNITS3, meters: [], propertyKind: null, originalName: 'grundsteuer.pdf', twinOf: null, twinNames: new Map(), booked,
  })
  const s = view.lines[0]?.suggestion
  if (!s) return assert.fail('Die offene Zeile hat keinen Vorschlag')
  return s
}

test('Ampel: Rechnung zu einer übernommenen Schätzung vergleicht den Stand nach dem Verknüpfen mit dem Vorjahr', () => {
  // Vorjahr 498 €, dieses Jahr aus dem Vorjahr übernommen 498 € ohne Beleg, Rechnung 512,40 €.
  // Verknüpft ersetzt die Rechnung die Schätzung (Summenregel): 512,40 € gegen 498 €, rund +3 %.
  const s = describeWith([
    grundsteuer({ id: 'v', year: 2025, invoiceFile: 'gs-2025.pdf' }),
    grundsteuer({ id: 'u' }),
  ])
  assert.deepEqual(s.candidates.map((c) => c.id), ['u'])
  assert.ok(!s.reasons.some((r) => /gegenüber Vorjahr/.test(r)), `keine Abweichung erwartet: ${s.reasons.join(' | ')}`)
})

test('Ampel: Ersetzt die Rechnung die Schätzung und weicht stark vom Vorjahr ab, nennt sie die Abweichung nach dem Verknüpfen', () => {
  // Schätzung 498 €, Rechnung 800 €: nach dem Verknüpfen 800 € gegen 498 €, +61 %, nicht +161 %.
  const line = stored({ description: 'Grundsteuer 2026', category: 'Grundsteuer', amountCents: 80000 })
  const view = describeAssessment({ assessment: assessmentOf(), lines: [line] }, {
    items: [grundsteuer({ id: 'v', year: 2025, invoiceFile: 'gs-2025.pdf' }), grundsteuer({ id: 'u' })],
    units: UNITS3, meters: [], propertyKind: null, originalName: 'grundsteuer.pdf', twinOf: null, twinNames: new Map(), booked: [],
  })
  assert.ok(view.lines[0]?.suggestion?.reasons.includes('+61 % gegenüber Vorjahr'), view.lines[0]?.suggestion?.reasons.join(' | '))
})

test('Ampel: Trägt die Position des Jahres einen Beleg, zählt die Rechnung hinzu (zweite Rechnung)', () => {
  // Beleg von Hand angehängt, keine gebuchte Zeile: Die Zeile ist eher eine zweite Rechnung.
  const s = describeWith([
    grundsteuer({ id: 'v', year: 2025, invoiceFile: 'gs-2025.pdf' }),
    grundsteuer({ id: 'u', invoiceFile: 'gs-2026-a.pdf' }),
  ])
  assert.ok(s.reasons.includes('+103 % gegenüber Vorjahr'), s.reasons.join(' | '))
})

test('Ampel: Hängt an der Position des Jahres schon eine gebuchte Zeile, zählt die Rechnung hinzu, auch ohne Beleg', () => {
  // Verknüpfen addiert dann zur Summe der Zeilen (Summenregel), es ersetzt keine Schätzung.
  const s = describeWith([
    grundsteuer({ id: 'v', year: 2025, invoiceFile: 'gs-2025.pdf' }),
    grundsteuer({ id: 'u' }),
  ], [{ costItemId: 'u', amountCents: 49800 }])
  assert.ok(s.reasons.includes('+103 % gegenüber Vorjahr'), s.reasons.join(' | '))
})

test('Ampel: Eine Position mit Einzelbeträgen oder laut Gemeinschaftsabrechnung ist kein Ziel und wird nicht ersetzt', () => {
  // Solche Positionen werden nur im Formular verknüpft (formOnly), die Zeile ersetzt sie nicht.
  for (const key of ['amounts', 'external'] as const) {
    const s = describeWith([
      grundsteuer({ id: 'v', year: 2025, invoiceFile: 'gs-2025.pdf' }),
      grundsteuer({ id: 'u', key }),
    ])
    assert.ok(s.reasons.includes('+103 % gegenüber Vorjahr'), `${key}: ${s.reasons.join(' | ')}`)
  }
})

test('Ampel: Passen zwei Schätzungen derselben Kostenart, wird keine abgezogen', () => {
  // Restmüll 300 € und Biomüll 100 €, beide Müllabfuhr und ohne Beleg, Rechnung 310 €. Welche sie
  // ersetzt, ist offen; ohne Abzug 710 € gegen 400 €, +78 %. Mit Abzug der ersten stünde +3 % da.
  const muell = (patch: Partial<CostItem>): CostItem => grundsteuer({ category: 'Müllabfuhr', key: 'persons', vendor: 'Stadt Musterstadt', ...patch })
  const line = stored({ description: 'Abfallgebühren 2026', category: 'Müllabfuhr', amountCents: 31000 })
  const view = describeAssessment({ assessment: assessmentOf({ totalGrossCents: 31000 }), lines: [line] }, {
    items: [
      muell({ id: 'r25', year: 2025, description: 'Restmüll', amountCents: 30000, invoiceFile: 'm-2025.pdf' }),
      muell({ id: 'b25', year: 2025, description: 'Biomüll', amountCents: 10000, invoiceFile: 'm-2025.pdf' }),
      muell({ id: 'r', description: 'Restmüll', amountCents: 30000 }),
      muell({ id: 'b', description: 'Biomüll', amountCents: 10000 }),
    ],
    units: UNITS3, meters: [], propertyKind: null, originalName: 'muell.pdf', twinOf: null, twinNames: new Map(), booked: [],
  })
  const s = view.lines[0]?.suggestion
  assert.deepEqual(s?.candidates.map((c) => c.id), ['r', 'b'])
  assert.ok(s?.reasons.includes('+78 % gegenüber Vorjahr'), s?.reasons.join(' | '))
})

test('Ampel (Abnahme B2): Zeilen, die dieselbe Schätzung ersetzen, rechnen gemeinsam', () => {
  // Wasser: Vorjahr 1.400 €, Schätzung 1.500 €, die Rechnung hat zwei Zeilen à 700 € und 800 €.
  // Verknüpft ersetzen beide zusammen die Schätzung: 1.500 € gegen 1.400 €, +7 %. Jede Zeile für
  // sich neben der Schätzung zeigte +57 % und +64 %.
  const wasser = (patch: Partial<CostItem>): CostItem => grundsteuer({ category: 'Wasser/Abwasser', description: 'Wasser', vendor: 'Stadtwerke', ...patch })
  const lines = [
    stored({ idx: 0, description: 'Frischwasser', category: 'Wasser/Abwasser', amountCents: 70000 }),
    stored({ idx: 1, description: 'Abwasser', category: 'Wasser/Abwasser', amountCents: 80000 }),
  ]
  const view = describeAssessment({ assessment: assessmentOf({ nextIdx: 2, totalGrossCents: 150000 }), lines }, {
    items: [wasser({ id: 'v', year: 2025, amountCents: 140000, invoiceFile: 'w-2025.pdf' }), wasser({ id: 'u', amountCents: 150000 })],
    units: UNITS3, meters: [], propertyKind: null, originalName: 'wasser.pdf', twinOf: null, twinNames: new Map(), booked: [],
  })
  // +7 % liegt unter der Schwelle von 25 %, ein Hinweis entfällt also.
  for (const l of view.lines) assert.ok(!l.suggestion?.reasons.some((r) => /gegenüber Vorjahr/.test(r)), `Zeile ${l.idx}: ${l.suggestion?.reasons.join(' | ')}`)
  // Mit einem Vorjahr von 1.000 € sichtbar: 1.500 € gegen 1.000 €, +50 % bei beiden Zeilen (vorher
  // +120 % und +130 %).
  const high = describeAssessment({ assessment: assessmentOf({ nextIdx: 2, totalGrossCents: 150000 }), lines }, {
    items: [wasser({ id: 'v', year: 2025, amountCents: 100000, invoiceFile: 'w-2025.pdf' }), wasser({ id: 'u', amountCents: 150000 })],
    units: UNITS3, meters: [], propertyKind: null, originalName: 'wasser.pdf', twinOf: null, twinNames: new Map(), booked: [],
  })
  for (const l of high.lines) assert.ok(l.suggestion?.reasons.includes('+50 % gegenüber Vorjahr'), `Zeile ${l.idx}: ${l.suggestion?.reasons.join(' | ')}`)
})

test('Ampel (#170): offene Zeilen zweier Belege, die dieselbe Schätzung ersetzen, rechnen gemeinsam', () => {
  // Die Wasserrechnung kommt in zwei Belegen, 700 € und 800 €, gegen eine Schätzung von 1.500 €
  // und 1.400 € im Vorjahr. Zusammen ersetzen sie die Schätzung: +7 %. Jeder Beleg für sich an
  // Stelle der Schätzung zeigte −50 % und −43 %.
  const wasser = (patch: Partial<CostItem>): CostItem => grundsteuer({ category: 'Wasser/Abwasser', description: 'Wasser', vendor: 'Stadtwerke', ...patch })
  const erster = { assessment: assessmentOf({ id: 'a1', file: 'wasser-1.pdf', vendor: 'Stadtwerke', totalGrossCents: 70000 }), lines: [stored({ assessmentId: 'a1', amountCents: 70000 })] }
  const zweiter = { assessment: assessmentOf({ id: 'a2', file: 'wasser-2.pdf', vendor: 'Stadtwerke', totalGrossCents: 80000 }), lines: [stored({ assessmentId: 'a2', description: 'Abwasser', amountCents: 80000 })] }
  const sieh = (vorjahr: number) => {
    const items = [wasser({ id: 'v', year: 2025, amountCents: vorjahr, invoiceFile: 'w-2025.pdf' }), wasser({ id: 'u', amountCents: 150000 })]
    const base = { items, units: UNITS3, meters: [], propertyKind: null, twinOf: null, twinNames: new Map<string, string>(), booked: [] }
    const peerTargets = [erster, zweiter].flatMap((r) => openTargets(r, base))
    assert.deepEqual(peerTargets.map((t) => [t.assessmentId, t.costItemId, t.amountCents]), [['a1', 'u', 70000], ['a2', 'u', 80000]])
    return [erster, zweiter].map((r) => describeAssessment(r, { ...base, originalName: r.assessment.file, peerTargets }))
  }
  for (const view of sieh(140000)) {
    const reasons = view.lines[0]?.suggestion?.reasons ?? assert.fail('kein Vorschlag')
    assert.ok(!reasons.some((r) => /gegenüber Vorjahr/.test(r)), `${view.id}: ${reasons.join(' | ')}`)
  }
  // Mit einem Vorjahr von 1.000 € sichtbar: dieselbe Zahl in beiden Belegen, +50 %.
  for (const view of sieh(100000)) {
    assert.ok(view.lines[0]?.suggestion?.reasons.includes('+50 % gegenüber Vorjahr'), `${view.id}: ${view.lines[0]?.suggestion?.reasons.join(' | ')}`)
  }
  // Ist der zweite Beleg verworfen, ersetzt der erste die Schätzung allein: 700 € gegen 1.400 €.
  const base = {
    items: [wasser({ id: 'v', year: 2025, amountCents: 140000, invoiceFile: 'w-2025.pdf' }), wasser({ id: 'u', amountCents: 150000 })],
    units: UNITS3, meters: [], propertyKind: null, twinOf: null, twinNames: new Map<string, string>(), booked: [],
  }
  const verworfen = { ...zweiter, lines: [{ ...zweiter.lines[0]!, dismissed: true }] }
  assert.deepEqual(openTargets(verworfen, base), [])
  const allein = describeAssessment(erster, { ...base, originalName: 'wasser-1.pdf', peerTargets: openTargets(verworfen, base) })
  assert.ok(allein.lines[0]?.suggestion?.reasons.includes('-50 % gegenüber Vorjahr'), allein.lines[0]?.suggestion?.reasons.join(' | '))
})

test('Ampel: Zielen zwei offene Zeilen auf dieselbe Schätzung, verschweigt keine die Abweichung', () => {
  // Vorjahr 700 €, Schätzung 700 €, zwei Zeilen à 700 €: Verknüpft man beide, stehen 1.400 € da,
  // +100 %. Jede Zeile für sich gegen die Schätzung gerechnet zeigte 0 %.
  const lines = [
    stored({ idx: 0, description: 'Grundsteuer A', category: 'Grundsteuer', amountCents: 70000 }),
    stored({ idx: 1, description: 'Grundsteuer B', category: 'Grundsteuer', amountCents: 70000 }),
  ]
  const view = describeAssessment({ assessment: assessmentOf({ nextIdx: 2, totalGrossCents: 140000 }), lines }, {
    items: [grundsteuer({ id: 'v', year: 2025, amountCents: 70000, invoiceFile: 'gs-2025.pdf' }), grundsteuer({ id: 'u', amountCents: 70000 })],
    units: UNITS3, meters: [], propertyKind: null, originalName: 'grundsteuer.pdf', twinOf: null, twinNames: new Map(), booked: [],
  })
  for (const l of view.lines) assert.ok(l.suggestion?.reasons.includes('+100 % gegenüber Vorjahr'), `Zeile ${l.idx}: ${l.suggestion?.reasons.join(' | ')}`)
  // Ist die zweite verworfen, ersetzt die erste die Schätzung allein: 700 € gegen 700 €.
  const one = describeAssessment({ assessment: assessmentOf({ nextIdx: 2, totalGrossCents: 140000 }), lines: [lines[0]!, { ...lines[1]!, dismissed: true }] }, {
    items: [grundsteuer({ id: 'v', year: 2025, amountCents: 70000, invoiceFile: 'gs-2025.pdf' }), grundsteuer({ id: 'u', amountCents: 70000 })],
    units: UNITS3, meters: [], propertyKind: null, originalName: 'grundsteuer.pdf', twinOf: null, twinNames: new Map(), booked: [],
  })
  assert.ok(!one.lines[0]?.suggestion?.reasons.some((r) => /gegenüber Vorjahr/.test(r)), one.lines[0]?.suggestion?.reasons.join(' | '))
})

test('Abweichung zum Vorjahr: ein ersetzter Betrag fällt aus der Summe des Jahres', () => {
  const items = [grundsteuer({ id: 'v', year: 2025 }), grundsteuer({ id: 'u' })]
  assert.ok(Math.abs((categoryDeviationPct(items, 'Grundsteuer', 2026, 51240) ?? 0) - 102.89) < 0.01)
  assert.ok(Math.abs((categoryDeviationPct(items, 'Grundsteuer', 2026, 51240, 49800) ?? 0) - 2.89) < 0.01)
})

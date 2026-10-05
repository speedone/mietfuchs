// Rückstand im Mietkonto und die angerechnete Vorauszahlung (#133). Die Abrechnung rechnet die
// Vorauszahlung laut Staffel an, solange keine Jahreskorrektur gesetzt ist. Zeigt das Mietkonto
// im selben Jahr einen Rückstand, muss die Abrechnung darauf hinweisen; umgerechnet wird nicht,
// denn welcher Teil einer Zahlung die Vorauszahlung betraf, weiß nur der Vermieter.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotPayment, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'

// Der Fall aus dem Issue: ab 01.03.2025, 450 € Kaltmiete und 80 € Vorauszahlung, also 530 € im
// Monat. Gebucht sind März bis November, der Dezember fehlt.
const tenancy = (over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id: 't', unitId: 'a', tenantName: 'Mieter', persons: 1, personHistory: [], start: '2025-03-01', end: null,
  prepayments: [{ from: '2025-03', monthlyCents: 8000 }], prepaymentOverrides: {},
  baseRents: [{ from: '2025-03', monthlyCents: 45000 }], ...over,
})
const paidMarchToNovember = (tenancyId = 't'): SnapshotPayment[] =>
  Array.from({ length: 9 }, (_, i) => ({ tenancyId, date: `2025-${String(i + 3).padStart(2, '0')}-03`, amountCents: 53000 }))

const settle = (s: Partial<SnapshotSource>, asOf?: string): ComputedSettlement => computeSettlement(snapshotOf({
  units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }],
  tenancies: [tenancy()],
  costItems: [{ id: 'g', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 73056, key: 'area' }],
  meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025), asOf ? { asOf } : {})

const arrears = (s: ComputedSettlement) => s.notices.filter((n) => n.code === 'prepayment.arrears')

test('Rückstand im Mietkonto ohne Jahreskorrektur: Hinweis mit offenem Betrag, der zum Mietverhältnis führt', () => {
  const s = settle({ payments: paidMarchToNovember() })
  const found = arrears(s)
  assert.equal(found.length, 1, `Hinweise: ${s.notices.map((n) => n.code).join(', ')}`)
  const [n] = found
  assert.equal(n.level, 'warning')
  // Der Knopf führt ins Mietkonto, dort steht der Rückstand und lässt sich eine Zahlung nachtragen.
  assert.deepEqual(n.subject, { kind: 'rentLedger', id: 't' })
  assert.match(n.text, /Ob die Vorauszahlung betroffen ist, sehen Sie im Mietkonto/)
  assert.match(n.text, /530,00/)
  assert.match(n.text, /800,00/)
  assert.ok(n.terms?.includes('prepayment'))
  // Nicht umgerechnet: angerechnet bleibt die Staffel.
  const st = s.statements.find((x) => x.tenancyId === 't')
  assert.equal(st?.prepaymentCents, 80000)
})

test('Rückstand mit gesetzter Jahreskorrektur: kein Hinweis, der Vermieter hat entschieden', () => {
  const s = settle({ tenancies: [tenancy({ prepaymentOverrides: { '2025-01': 72000 } })], payments: paidMarchToNovember() })
  assert.equal(arrears(s).length, 0)
})

test('Mietkonto ausgeglichen: kein Hinweis', () => {
  const s = settle({ payments: [...paidMarchToNovember(), { tenancyId: 't', date: '2025-12-03', amountCents: 53000 }] })
  assert.equal(arrears(s).length, 0)
})

test('Keine Zahlung im Jahr erfasst: kein Hinweis, das Mietkonto wird dann nicht geführt', () => {
  const s = settle({ payments: [] })
  assert.equal(arrears(s).length, 0)
})

test('Ein Mieter zahlt nichts, der andere ist gebucht: Hinweis für den, der nichts gezahlt hat', () => {
  const s = settle({
    units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }, { id: 'b', name: 'OG', areaM2: 50, participates: true }],
    tenancies: [tenancy(), tenancy({ id: 'u', unitId: 'b', tenantName: 'Zweiter' })],
    payments: [...paidMarchToNovember('t'), { tenancyId: 't', date: '2025-12-03', amountCents: 53000 }],
  })
  const found = arrears(s)
  assert.deepEqual(found.map((n) => n.subject?.id), ['u'])
})

test('Pauschale statt Abrechnung: kein Hinweis, es wird keine Vorauszahlung angerechnet', () => {
  const s = settle({
    tenancies: [tenancy({ costModel: 'flatRate', heatingModel: 'flatRate', prepayments: [], flatRates: [{ from: '2025-03', monthlyCents: 8000 }] })],
    payments: paidMarchToNovember(),
  })
  assert.equal(arrears(s).length, 0)
})

test('Gemischtes Modell (kalt pauschal, Heizung abgerechnet): der Text behauptet nicht, die Vorauszahlung fehle', () => {
  const s = settle({
    tenancies: [tenancy({
      costModel: 'flatRate', flatRates: [{ from: '2025-03', monthlyCents: 5000 }],
      baseRents: [{ from: '2025-03', monthlyCents: 40000 }],
    })],
    costItems: [{ id: 'h', period: calendarPeriod(2025), category: 'Heizung und Warmwasser', description: 'Heizung', amountCents: 73056, key: 'area' }],
    // Soll 400 + 80 + 50 = 530 € je Monat von März bis Dezember; gezahlt neun Mal 530 €.
    payments: paidMarchToNovember(),
  })
  const [n] = arrears(s)
  if (!n) return assert.fail(`kein Hinweis: ${s.notices.map((x) => x.code).join(', ')}`)
  assert.equal(n.text,
    'Im Mietkonto 2025 von Mieter (EG) sind 530,00 € offen. Die Abrechnung rechnet die Vorauszahlung laut Vertrag an (800,00 €); maßgeblich ist aber, was tatsächlich gezahlt wurde. ' +
    'Zahlungen zählen nach ihrem Datum; eine im Dezember vorab gezahlte Januarmiete steht im Vorjahr. ' +
    'Ob die Vorauszahlung betroffen ist, sehen Sie im Mietkonto: Im Soll stehen auch Kaltmiete und Pauschale, der Rückstand kann ebenso sie betreffen. ' +
    'Fehlt nur eine Buchung, tragen Sie die Zahlung im Mietkonto nach; hat der Mieter wirklich weniger Vorauszahlung geleistet, tragen Sie den gezahlten Betrag in der Abrechnung bei „abzüglich geleisteter Vorauszahlungen“ mit „✎ anpassen“ ein.')
})

// Laufendes Jahr (#133, Durchsicht): Das Mietkonto führt das Soll für alle zwölf Monate, auch für
// die noch nicht fälligen. Mit Stichtag zählen nur die Monate vor dem Monat des Stichtags.
const paidMarchTo = (lastMonth: number): SnapshotPayment[] =>
  Array.from({ length: lastMonth - 2 }, (_, i) => ({ tenancyId: 't', date: `2025-${String(i + 3).padStart(2, '0')}-03`, amountCents: 53000 }))

test('Laufendes Jahr, bis zum Vormonat pünktlich gezahlt: kein Hinweis', () => {
  const s = settle({ payments: paidMarchTo(9) }, '2025-10-15')
  assert.equal(arrears(s).length, 0, s.notices.map((n) => n.text).join(' | '))
})

test('Laufendes Jahr, ein fälliger Monat fehlt: Hinweis mit genau diesem Betrag', () => {
  const s = settle({ payments: paidMarchTo(8) }, '2025-10-15')
  const [n] = arrears(s)
  if (!n) return assert.fail('kein Hinweis')
  assert.match(n.text, /sind 530,00 € offen/)
})

test('Stichtag nach dem Abrechnungsjahr: das ganze Jahr zählt', () => {
  const s = settle({ payments: paidMarchToNovember() }, '2026-02-01')
  assert.equal(arrears(s).length, 1)
})

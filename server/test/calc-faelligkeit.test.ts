// Mietkonto und Hinweis `prepayment.arrears` mit der Fälligkeit am Mietverhältnis (#334, Entwurf E3, E6, E7): Ein Monat
// zählt ab dem Tag nach dem spätesten erwarteten Eingang als Rückstand. Die Beispiele mit Feiertagen reichen
// `holidaysChecked: () => true` hinein (so rechnet Mietfuchs, sobald alle Landesgesetze amtlich gelesen sind), die sichere
// Grenze `() => false`; die Voreinstellung folgt dem Register (rent-due.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, rentLedger, type LedgerOptions } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotPayment, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { calendarPeriod } from '../../shared/period.ts'
import type { FederalState, RentLedgerRow, RentMonth } from '../../shared/types.ts'

const CHECKED = { holidaysChecked: (): boolean => true }
const UNCHECKED = { holidaysChecked: (): boolean => false }
let seq = 0
const pay = (tenancyId: string, date: string, amountCents: number): SnapshotPayment => ({ id: `p${String(++seq).padStart(4, '0')}`, tenancyId, date, amountCents, kind: 'rent' })
// 600 € Kaltmiete und 200 € Vorauszahlung.
const tenancy = (over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id: 't', unitId: 'a', tenantName: 'Mieter', persons: 1, personHistory: [], start: '2026-01-01', end: null,
  prepayments: [{ from: '2020-01', monthlyCents: 20000 }], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: 60000 }], ...over,
})
// Ein zweites Mietverhältnis zahlt seit Januar 2026: Das Objekt führt das Mietkonto (Beginn der Erfassung).
const other = tenancy({ id: 'o', unitId: 'b', tenantName: 'Nachbar' })
const otherPaid = (to = 12): SnapshotPayment[] => Array.from({ length: to }, (_, i) => pay('o', `2026-${String(i + 1).padStart(2, '0')}-02`, 80000))

const snapshot = (tenancies: SnapshotTenancy[], payments: SnapshotPayment[], year: number, state: FederalState | null = 'NW', items = false): Snapshot => {
  const source: SnapshotSource = {
    units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }, { id: 'b', name: 'OG', areaM2: 50, participates: true }],
    tenancies, costItems: items ? [{ id: 'g', period: calendarPeriod(year), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 73056, key: 'area' }] : [],
    meters: [], readings: [], payments, closedSettlements: [],
  }
  return { ...snapshotOf(source, year), property: { kind: 'mfh', cableBuiltBeforeDec2021: null, state } }
}
const rowOf = (s: Snapshot, options: LedgerOptions, id = 't'): RentLedgerRow => rentLedger(s, options).rows.find((r) => r.tenancyId === id) ?? assert.fail(`keine Zeile ${id}`)
const monthOf = (r: RentLedgerRow, month: number): RentMonth => r.months[month - 1] ?? assert.fail(`kein Monat ${month}`)

test('Einzug Fr 09.10.2026, nichts gezahlt (NW): bis 19.10. zählt der Oktober nicht als Rückstand, ab 20.10. schon', () => {
  const t = tenancy({ start: '2026-10-09' })
  const s = snapshot([t, other], otherPaid(), 2026)
  // Soll anteilig 23/31 von 800 €.
  const october = Math.round(60000 * 23 / 31) + Math.round(20000 * 23 / 31)
  for (const asOf of ['2026-10-09', '2026-10-13', '2026-10-19']) {
    const r = rowOf(s, { asOf, ...CHECKED })
    const mo = monthOf(r, 10)
    assert.equal(mo.status, 'notDue', asOf)
    assert.deepEqual([mo.dueOn, mo.creditExpectedBy, mo.arrearsFrom], ['2026-10-13', '2026-10-19', '2026-10-20'], asOf)
    assert.equal(r.arrearsCents, 0, asOf)
    assert.equal(r.openMonths, 0, asOf)
    assert.equal(r.dueSollCents, 0, asOf)
  }
  const r20 = rowOf(s, { asOf: '2026-10-20', ...CHECKED })
  assert.equal(monthOf(r20, 10).status, 'open')
  assert.equal(r20.arrearsCents, october)
  assert.equal(r20.openMonths, 1)
  assert.equal(r20.dueSollCents, october)
  // November: fällig Mi 04.11., erwartet bis Di 10.11.
  assert.deepEqual([monthOf(r20, 11).status, monthOf(r20, 11).dueOn, monthOf(r20, 11).creditExpectedBy], ['notDue', '2026-11-04', '2026-11-10'])
  assert.equal(rowOf(s, { asOf: '2026-11-11', ...CHECKED }).arrearsCents, october + 80000)
  // Ohne geprüfte Feiertage die sichere Grenze: Einzugsmonat ab dem 01.12., November (voller Monat) ab dem 01.12.
  const u = rowOf(s, { asOf: '2026-11-30', ...UNCHECKED })
  assert.equal(monthOf(u, 10).status, 'notDue')
  assert.equal(monthOf(u, 10).arrearsFrom, '2026-12-01')
  assert.equal(monthOf(u, 10).dueOn, '2026-10-13', 'die Auskunft nennt den Fälligkeitstag trotzdem')
  assert.equal(u.arrearsCents, 0)
  assert.equal(rowOf(s, { asOf: '2026-12-01', ...UNCHECKED }).arrearsCents, october + 80000)
})

test('Voller Monat: Eingang am 05.11. pünktlich, am 20.11. nach dem erwarteten Eingang nur als Auskunft', () => {
  const t = tenancy()
  const paidJanToOct = Array.from({ length: 10 }, (_, i) => pay('t', `2026-${String(i + 1).padStart(2, '0')}-02`, 80000))
  const early = snapshot([t], [...paidJanToOct, pay('t', '2026-11-05', 80000)], 2026)
  const e = monthOf(rowOf(early, { asOf: '2026-11-12', ...CHECKED }), 11)
  assert.equal(e.status, 'paid')
  assert.equal(e.paidAfterExpected, undefined)
  const late = snapshot([t], [...paidJanToOct, pay('t', '2026-11-20', 80000)], 2026)
  // Am 11.11., noch ohne die Zahlung, ist der November offen (erwartet bis 10.11.); am 10.11. noch nicht.
  const before = snapshot([t], paidJanToOct, 2026)
  assert.equal(monthOf(rowOf(before, { asOf: '2026-11-10', ...CHECKED }), 11).status, 'notDue')
  assert.equal(monthOf(rowOf(before, { asOf: '2026-11-11', ...CHECKED }), 11).status, 'open')
  assert.equal(rowOf(before, { asOf: '2026-11-11', ...CHECKED }).arrearsCents, 80000)
  const l = rowOf(late, { asOf: '2026-11-25', ...CHECKED })
  assert.equal(monthOf(l, 11).status, 'paid')
  assert.equal(monthOf(l, 11).paidAfterExpected, '2026-11-20')
  assert.equal(l.arrearsCents, 0)
  // Pünktlich bezahlte Monate tragen die Auskunft nicht.
  assert.equal(monthOf(l, 10).paidAfterExpected, undefined)
})

test('Ohne Bundesland der späteste Tag aller Länder: Januar 2027 am 07.01., nicht am 06.01.', () => {
  const s = snapshot([tenancy()], [pay('t', '2026-12-02', 80000)], 2027, null)
  const mo = monthOf(rowOf(s, { asOf: '2027-01-02', ...CHECKED }), 1)
  assert.equal(mo.dueOn, '2027-01-07')
  // Do 07. → Fr 08., Mo 11., Di 12., Mi 13.
  assert.equal(mo.creditExpectedBy, '2027-01-13')
  const nw = monthOf(rowOf(snapshot([tenancy()], [pay('t', '2026-12-02', 80000)], 2027, 'NW'), { asOf: '2027-01-02', ...CHECKED }), 1)
  assert.equal(nw.dueOn, '2027-01-06')
})

test('Altvertrag von 1998 ohne Angabe: März 2026 nie im März Rückstand, erst nach dem erwarteten Eingang', () => {
  const t = tenancy({ start: '1998-04-01', contractDate: '1998-03-15' })
  const s = snapshot([t], [pay('t', '2026-01-02', 80000), pay('t', '2026-02-02', 80000)], 2026)
  for (const asOf of ['2026-03-31', '2026-04-01', '2026-04-09']) {
    assert.equal(monthOf(rowOf(s, { asOf, ...CHECKED }), 3).status, 'notDue', asOf)
  }
  assert.equal(monthOf(rowOf(s, { asOf: '2026-04-09', ...CHECKED }), 3).dueOn, '2026-04-01')
  assert.equal(monthOf(rowOf(s, { asOf: '2026-04-10', ...CHECKED }), 3).status, 'open')
  assert.equal(rowOf(s, { asOf: '2026-04-10', ...CHECKED }).arrearsCents, 80000)
  // Bisher (#133) war der März ab dem 01.04. Rückstand; ohne geprüfte Feiertage jetzt erst ab dem 01.05.
  assert.equal(monthOf(rowOf(s, { asOf: '2026-04-30', ...UNCHECKED }), 3).status, 'notDue')
  assert.equal(monthOf(rowOf(s, { asOf: '2026-05-01', ...UNCHECKED }), 3).status, 'open')
  // Mit Vorauszahlungsklausel (zu Beginn eingestellt) wie ein neuer Vertrag.
  const clause = snapshot([{ ...t, rentDue: 'startWorkday' }], [pay('t', '2026-01-02', 80000), pay('t', '2026-02-02', 80000)], 2026)
  assert.equal(monthOf(rowOf(clause, { asOf: '2026-03-13', ...CHECKED }), 3).status, 'open')
})

test('Fester Tag 15: März 2026 fällig Mo 16.03. (der 15. ist ein Sonntag), Rückstand ab 21.03.', () => {
  const s = snapshot([tenancy({ rentDue: 'dayOfMonth', rentDueDay: 15 })], [pay('t', '2026-01-15', 80000), pay('t', '2026-02-16', 80000)], 2026)
  const r = rowOf(s, { asOf: '2026-03-20', ...CHECKED })
  assert.deepEqual([monthOf(r, 3).status, monthOf(r, 3).dueOn, monthOf(r, 3).creditExpectedBy], ['notDue', '2026-03-16', '2026-03-20'])
  assert.equal(monthOf(rowOf(s, { asOf: '2026-03-21', ...CHECKED }), 3).status, 'open')
})

test('Vergangenes Jahr und ohne Stichtag: alles fällig wie bisher', () => {
  const t = tenancy({ start: '2025-01-01' })
  const s = snapshot([t], [pay('t', '2025-01-02', 80000)], 2025)
  const r = rowOf(s, { asOf: '2026-11-07', ...CHECKED })
  assert.ok(r.months.slice(1).every((m) => m.status === 'open'))
  assert.equal(r.arrearsCents, 11 * 80000)
  const plain = rowOf(s, {})
  assert.ok(plain.months.slice(1).every((m) => m.status === 'open'))
  assert.equal(plain.arrearsCents, 11 * 80000)
  assert.ok(plain.months.every((m) => m.dueOn === undefined && m.creditExpectedBy === undefined && m.arrearsFrom === undefined), 'ohne Stichtag keine Auskunft')
  assert.equal(rentLedger(s).asOf, undefined)
  assert.equal(rentLedger(s, { asOf: '2026-11-07' }).asOf, '2026-11-07')
})

test('Hinweis prepayment.arrears: der laufende Monat zählt erst nach dem erwarteten Eingang', () => {
  // Bezahlt Januar bis September 2026, Oktober offen. Oktober 2026: Do 01. (1), Fr 02. (2), Mo 05. (3); erwartet bis
  // Fr 09.10., Rückstand ab 10.10.
  const s = snapshot([tenancy()], Array.from({ length: 9 }, (_, i) => pay('t', `2026-${String(i + 1).padStart(2, '0')}-02`, 80000)), 2026, 'NW', true)
  const notice = (asOf: string, options = CHECKED) => computeSettlement(s, { asOf, ...options }).notices.filter((n) => n.code === 'prepayment.arrears')
  assert.equal(notice('2026-10-09').length, 0)
  const [n] = notice('2026-10-10')
  assert.match(n?.text ?? '', /sind 200,00 € nicht gezahlt/)
  // Die Fristregeln stehen in den Rechtswerten, aber nur, wenn der Hinweis erscheint.
  const ids = (asOf: string) => (computeSettlement(s, { asOf, ...CHECKED }).legalBasis?.values ?? []).map((v) => v.id)
  assert.ok(ids('2026-10-10').includes('bgb.transfer-execution-days'))
  assert.ok(ids('2026-10-10').includes('bgb.rent-due-workday'))
  assert.ok(!ids('2026-10-09').includes('bgb.transfer-execution-days'))
  // Ohne geprüfte Feiertage wie bisher erst im Folgemonat.
  assert.equal(notice('2026-10-31', UNCHECKED).length, 0)
  assert.equal(notice('2026-11-01', UNCHECKED).length, 1)
  // Altvertrag ohne Angabe: der Oktober erst ab Dezember (sichere Grenze) bzw. nach dem erwarteten Eingang im November.
  const old = snapshot([tenancy({ start: '1999-01-01' })], Array.from({ length: 9 }, (_, i) => pay('t', `2026-${String(i + 1).padStart(2, '0')}-28`, 80000)), 2026, 'NW', true)
  const oldNotice = (asOf: string, options = CHECKED) => computeSettlement(old, { asOf, ...options }).notices.filter((x) => x.code === 'prepayment.arrears').length
  assert.equal(oldNotice('2026-11-06'), 0)
  // 01.11.2026 ist Sonntag (Allerheiligen in NW): fällig Mo 02.11., erwartet bis Fr 06.11., Rückstand ab 07.11.
  assert.equal(oldNotice('2026-11-07'), 1)
  assert.equal(oldNotice('2026-11-30', UNCHECKED), 0)
  assert.equal(oldNotice('2026-12-01', UNCHECKED), 1)
})

// Durchsicht S2: seit wann ein Monat gedeckt ist, mit Teilzahlung und Rücklastschrift.
test('Gedeckt nach dem erwarteten Eingang: Teilzahlung, Rücklastschrift, Rücklastschrift nach dem Jahr', () => {
  const t = tenancy()
  const janToOct = Array.from({ length: 10 }, (_, i) => pay('t', `2026-${String(i + 1).padStart(2, '0')}-02`, 80000))
  const after = (payments: SnapshotPayment[]) => monthOf(rowOf(snapshot([t], [...janToOct, ...payments], 2026), { asOf: '2026-11-25', ...CHECKED }), 11)
  // Pünktlich gezahlt, zurückgebucht, nach dem erwarteten Eingang (10.11.) erneut gezahlt: gedeckt seit dem 20.11.
  const back = after([pay('t', '2026-11-03', 80000), pay('t', '2026-11-09', -80000), pay('t', '2026-11-20', 80000)])
  assert.deepEqual([back.status, back.paidAfterExpected], ['paid', '2026-11-20'])
  // 500 € pünktlich, 300 € am 18.11.: gedeckt erst am 18.11.
  const parts = after([pay('t', '2026-11-05', 50000), pay('t', '2026-11-18', 30000)])
  assert.deepEqual([parts.status, parts.paidAfterExpected], ['paid', '2026-11-18'])
  // Zurückgebucht und am selben Tag neu gezahlt, alles vor dem erwarteten Eingang: pünktlich.
  const same = after([pay('t', '2026-11-03', 80000), pay('t', '2026-11-06', -80000), pay('t', '2026-11-06', 80000)])
  assert.deepEqual([same.status, same.paidAfterExpected], ['paid', undefined])
  // Eine Rücklastschrift erst im Folgejahr zählt im Jahr 2026 nicht.
  const later = after([pay('t', '2026-11-20', 80000), pay('t', '2027-01-05', -80000)])
  assert.deepEqual([later.status, later.paidAfterExpected], ['paid', '2026-11-20'])
})

// Durchsicht der Oberfläche (M1): Die Zeile nennt die wirksame Regel, damit die Einzelheiten stimmen; nur mit Stichtag.
test('Die Zeile nennt die Regel der Fälligkeit: gesetzlich oder vereinbart, fester Tag, erste Miete bei Beginn', () => {
  const ruleOf = (t: SnapshotTenancy, options: LedgerOptions = { asOf: '2026-11-07' }) => rowOf(snapshot([t], [pay('t', '2026-01-02', 80000)], 2026), options).dueRule
  assert.deepEqual(ruleOf(tenancy()), { rule: 'startWorkday', agreed: false })
  assert.deepEqual(ruleOf(tenancy({ start: '1998-04-01' })), { rule: 'inArrears', agreed: false })
  assert.deepEqual(ruleOf(tenancy({ rentDue: 'inArrears' })), { rule: 'inArrears', agreed: true })
  assert.deepEqual(ruleOf(tenancy({ rentDue: 'dayOfMonth', rentDueDay: 15, firstRentAtStart: true })), { rule: 'dayOfMonth', agreed: true, day: 15, firstRentAtStart: true })
  assert.equal(ruleOf(tenancy(), {}), undefined, 'ohne Stichtag keine Auskunft')
})

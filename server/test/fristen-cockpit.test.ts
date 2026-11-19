// „Demnächst fällig“ im Cockpit (#190): Einwendungsfrist im Register und die reine Liste `upcomingDeadlines`.
// Jedes „heute“ ist hineingereicht; kein Test hängt am Tag, an dem er läuft.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { objectionDeadline, settlementDeadline, CALENDAR_RULES, parsePeriodKey, periodOfKey } from '../../shared/period.ts'
import { shiftMonths, valueAt } from '../../shared/law/register.ts'
import { bgbObjectionMonths } from '../../shared/law/bgb-betrkv.ts'
import { practiceObjectionEndOfMonth } from '../../shared/law/practice.ts'
import { GLOSSARY } from '../../shared/glossary.ts'
import { upcomingDeadlines, UPCOMING_HORIZON_DAYS, type UpcomingInput, type UpcomingMeter, type UpcomingTenancy } from '../src/upcomingDeadlines.ts'
import type { DepositEntry, PeriodKey, PeriodRules, UpcomingDeadline } from '../../shared/types.ts'

const tenancy = (over: Partial<UpcomingTenancy> = {}): UpcomingTenancy => ({
  id: 't1', tenantName: 'Erika Mustermann', start: '2020-01-01', end: null, ...over,
})
const meter = (over: Partial<UpcomingMeter> = {}): UpcomingMeter => ({
  id: 'm1', name: 'Kaltwasser EG', type: 'kaltwasser', calibratedUntil: null, ...over,
})
const input = (over: Partial<UpcomingInput> = {}): UpcomingInput => ({
  rules: CALENDAR_RULES, tenancies: [tenancy()], costPeriods: new Set<PeriodKey>(), closed: [], meters: [], readings: [], deposits: [], ...over,
})
const kinds = (items: readonly UpcomingDeadline[], kind: UpcomingDeadline['kind']) => items.filter((i) => i.kind === kind)
const key = (text: string): PeriodKey => parsePeriodKey(text) ?? assert.fail(`kein Zeitraum: ${text}`)

// ---------- Register und Einwendungsfrist ----------

test('Register: Einwendungsfrist 12 Monate (§ 556 Abs. 3 Satz 5 BGB) und Ende am Monatsletzten als Auslegung', () => {
  assert.equal(valueAt(bgbObjectionMonths, '2026-03-15'), 12)
  assert.equal(bgbObjectionMonths.norm, '§ 556 Abs. 3 Satz 5 BGB')
  assert.equal(bgbObjectionMonths.versions[0]?.source.checked, 'checked')
  assert.equal(valueAt(practiceObjectionEndOfMonth, '2026-03-15'), true)
  assert.equal(practiceObjectionEndOfMonth.versions[0]?.source.rank, 'interpretation')
})

test('Einwendungsfrist: Monatsletzter des zwölften Monats nach dem Versand, auch am 31.01. und 29.02.', () => {
  assert.equal(objectionDeadline('2025-03-15'), '2026-03-31')
  assert.equal(objectionDeadline('2025-01-31'), '2026-01-31')
  assert.equal(objectionDeadline('2024-02-29'), '2025-02-28')
  assert.equal(objectionDeadline('2025-11-30'), '2026-11-30')
  assert.equal(objectionDeadline('2025-12-01'), '2026-12-31')
})

test('Einwendungsfrist: nie vor dem Tag gleicher Zahl nach § 188 BGB, stets im selben Monat (Invariante über zwei Jahre)', () => {
  for (let d = Date.UTC(2023, 0, 1); d <= Date.UTC(2024, 11, 31); d += 86400000) {
    const sent = new Date(d).toISOString().slice(0, 10)
    const sameDay = shiftMonths(sent, 12)
    const end = objectionDeadline(sent)
    assert.ok(end >= sameDay, `${sent}: ${end} vor ${sameDay}`)
    assert.equal(end.slice(0, 7), sameDay.slice(0, 7), sent)
  }
})

// ---------- Abrechnungsfrist ----------

test('Abrechnungsfrist: offener Zeitraum 2025 mit der Frist des Servers, im Fenster von 90 Tagen', () => {
  const p = periodOfKey(CALENDAR_RULES, key('2025-01'))
  if (!p) return assert.fail('Zeitraum fehlt')
  const list = upcomingDeadlines(input(), '2026-11-20')
  assert.deepEqual(kinds(list.items, 'settlement'), [
    { kind: 'settlement', id: 'settlement:2025-01', date: settlementDeadline(p), period: '2025-01', label: '2025', closed: false },
  ])
  assert.equal(list.today, '2026-11-20')
  assert.equal(list.until, '2027-02-18')
  assert.equal(UPCOMING_HORIZON_DAYS, 90)
})

test('Abrechnungsfrist: außerhalb des Fensters keine Zeile, am letzten Tag des Fensters eine', () => {
  assert.equal(kinds(upcomingDeadlines(input(), '2026-10-01').items, 'settlement').length, 0)
  // 31.12.2026 ist genau der 90. Tag nach dem 02.10.2026.
  assert.equal(kinds(upcomingDeadlines(input(), '2026-10-02').items, 'settlement').length, 1)
})

test('Abrechnungsfrist: abgeschlossen ohne Versanddatum bleibt, versendet entfällt', () => {
  const closed = upcomingDeadlines(input({ closed: [{ period: key('2025-01'), sentAt: null }] }), '2026-11-20')
  assert.deepEqual(kinds(closed.items, 'settlement').map((i) => i.kind === 'settlement' && i.closed), [true])
  const sent = upcomingDeadlines(input({ closed: [{ period: key('2025-01'), sentAt: '2026-05-04' }] }), '2026-11-20')
  assert.equal(kinds(sent.items, 'settlement').length, 0)
})

test('Abrechnungsfrist abgelaufen: nur mit erfassten Kosten oder Abschluss und höchstens drei Jahre zurück', () => {
  const today = '2027-02-10'
  // Ohne Daten: Zeiträume aus der Zeit vor Mietfuchs wären Lärm.
  assert.deepEqual(kinds(upcomingDeadlines(input(), today).items, 'settlement').map((i) => i.date), [])
  // 2023 endete am 31.12.2023, mehr als drei Jahre vor dem 10.02.2027.
  const withCosts = upcomingDeadlines(input({ costPeriods: new Set([key('2025-01'), key('2023-01'), key('2024-01')]) }), today)
  assert.deepEqual(kinds(withCosts.items, 'settlement').map((i) => i.id), ['settlement:2024-01', 'settlement:2025-01'])
  const closed = upcomingDeadlines(input({ closed: [{ period: key('2024-01'), sentAt: null }] }), today)
  assert.deepEqual(kinds(closed.items, 'settlement').map((i) => i.id), ['settlement:2024-01'])
})

test('Abrechnungsfrist: nur Pauschale oder Inklusivmiete braucht keine Abrechnung, vor dem ersten Mietverhältnis keine', () => {
  const flat = input({ tenancies: [tenancy({ costModel: 'flatRate', heatingModel: 'inclusive' })] })
  assert.equal(kinds(upcomingDeadlines(flat, '2026-11-20').items, 'settlement').length, 0)
  const heatingOnly = input({ tenancies: [tenancy({ costModel: 'flatRate' })] })
  assert.equal(kinds(upcomingDeadlines(heatingOnly, '2026-11-20').items, 'settlement').length, 1)
  const later = input({ tenancies: [tenancy({ start: '2026-02-01' })] })
  assert.equal(kinds(upcomingDeadlines(later, '2026-11-20').items, 'settlement').length, 0)
  assert.equal(kinds(upcomingDeadlines(input({ tenancies: [] }), '2026-11-20').items, 'settlement').length, 0)
})

test('Abrechnungsfrist: abweichender Zeitraum Mai bis April rechnet mit settlementDeadline', () => {
  const rules: PeriodRules = { startMonth: 5, changes: [] }
  const list = upcomingDeadlines(input({ rules }), '2027-03-01')
  const rows = kinds(list.items, 'settlement')
  assert.deepEqual(rows.map((r) => [r.date, r.kind === 'settlement' && r.label]), [['2027-04-30', '2025/2026']])
})

// ---------- Einwendungsfrist ----------

test('Einwendungsfrist: nach dem Versand, solange sie läuft und im Fenster endet', () => {
  const sent = input({ closed: [{ period: key('2025-01'), sentAt: '2026-01-20' }] })
  assert.deepEqual(kinds(upcomingDeadlines(sent, '2026-11-20').items, 'objection'), [
    { kind: 'objection', id: 'objection:2025-01', date: '2027-01-31', period: '2025-01', label: '2025', sentAt: '2026-01-20' },
  ])
  // Zu früh (Ende mehr als 90 Tage entfernt) und abgelaufen: keine Zeile.
  assert.equal(kinds(upcomingDeadlines(sent, '2026-06-01').items, 'objection').length, 0)
  assert.equal(kinds(upcomingDeadlines(sent, '2027-01-31').items, 'objection').length, 1)
  assert.equal(kinds(upcomingDeadlines(sent, '2027-02-01').items, 'objection').length, 0)
})

test('Einwendungsfrist: ein Versanddatum nach heute zählt nicht', () => {
  const future = input({ closed: [{ period: key('2025-01'), sentAt: '2026-12-01' }] })
  assert.equal(kinds(upcomingDeadlines(future, '2026-11-20').items, 'objection').length, 0)
})

// ---------- Kaution nach Auszug ----------

test('Kaution nach Auszug: aus den Buchungen, ohne Frist, mit dem Mietende als Tag', () => {
  const entries: DepositEntry[] = [{ id: 'd1', tenancyId: 't1', date: '2020-01-05', kind: 'received', amountCents: 150000 }]
  const list = upcomingDeadlines(input({ tenancies: [tenancy({ end: '2026-08-31' })], deposits: entries }), '2026-11-20')
  assert.deepEqual(kinds(list.items, 'deposit'), [
    { kind: 'deposit', id: 'deposit:t1', date: '2026-08-31', tenancyId: 't1', tenantName: 'Erika Mustermann', balanceCents: 150000 },
  ])
  const refunded: DepositEntry[] = [...entries, { id: 'd2', tenancyId: 't1', date: '2026-09-15', kind: 'refunded', amountCents: 150000 }]
  assert.equal(kinds(upcomingDeadlines(input({ tenancies: [tenancy({ end: '2026-08-31' })], deposits: refunded }), '2026-11-20').items, 'deposit').length, 0)
})

// ---------- Eichfrist ----------

test('Eichfrist: Ende am 31.12. des Jahres, in der Liste zwölf Monate vorher', () => {
  const m = meter({ calibratedUntil: 2026 })
  assert.deepEqual(kinds(upcomingDeadlines(input({ meters: [m] }), '2026-11-20').items, 'calibration'), [
    { kind: 'calibration', id: 'calibration:m1', date: '2026-12-31', meterId: 'm1', meterName: 'Kaltwasser EG' },
  ])
  assert.equal(kinds(upcomingDeadlines(input({ meters: [meter({ calibratedUntil: 2027 })] }), '2026-11-20').items, 'calibration').length, 0)
  assert.equal(kinds(upcomingDeadlines(input({ meters: [meter({ calibratedUntil: 2027 })] }), '2026-12-31').items, 'calibration').length, 1)
  assert.equal(kinds(upcomingDeadlines(input({ meters: [meter()] }), '2026-11-20').items, 'calibration').length, 0)
})

test('Eichfrist abgelaufen: im ersten Jahr danach oder solange der Zähler weiter abgelesen wird', () => {
  const m = meter({ calibratedUntil: 2024 })
  assert.equal(kinds(upcomingDeadlines(input({ meters: [m] }), '2025-06-01').items, 'calibration').length, 1)
  assert.equal(kinds(upcomingDeadlines(input({ meters: [m] }), '2026-11-20').items, 'calibration').length, 0)
  const read = input({ meters: [m], readings: [{ meterId: 'm1', date: '2025-12-31' }] })
  assert.equal(kinds(upcomingDeadlines(read, '2026-11-20').items, 'calibration').length, 1)
  // Eine Ablesung am letzten Tag der Frist zeigt nicht, dass er danach noch misst.
  const atEnd = input({ meters: [m], readings: [{ meterId: 'm1', date: '2024-12-31' }] })
  assert.equal(kinds(upcomingDeadlines(atEnd, '2026-11-20').items, 'calibration').length, 0)
})

// ---------- Ordnung ----------

test('Ordnung: nach Tag, dann Art, dann Kennung; Kennungen eindeutig und stabil', () => {
  const all = input({
    tenancies: [tenancy({ end: '2026-08-31' })],
    deposits: [{ id: 'd1', tenancyId: 't1', date: '2020-01-05', kind: 'received', amountCents: 1000 }],
    closed: [{ period: key('2024-01'), sentAt: '2025-01-20' }],
    meters: [meter({ id: 'm2', name: 'B', calibratedUntil: 2026 }), meter({ id: 'm1', name: 'A', calibratedUntil: 2026 })],
  })
  const first = upcomingDeadlines(all, '2026-11-20')
  assert.deepEqual(first.items.map((i) => i.id), ['deposit:t1', 'calibration:m1', 'calibration:m2', 'settlement:2025-01'])
  assert.deepEqual(upcomingDeadlines(all, '2026-11-20'), first)
  assert.equal(new Set(first.items.map((i) => i.id)).size, first.items.length)
})

// ---------- Lexikon ----------

test('Lexikon „Einwendungsfrist“: Zahl aus dem Register, Beispiel mit objectionDeadline nachgerechnet', () => {
  const term = GLOSSARY.objectionDeadline
  assert.match(term.short, /bis zum Ablauf des 12\. Monats nach Zugang/)
  assert.equal(term.norm, '§ 556 Abs. 3 Satz 5 und 6 BGB')
  assert.equal(objectionDeadline('2026-01-20'), '2027-01-31')
  assert.match(term.example, /am 20\.01\.2026 versendet\. Mietfuchs zeigt die Einwendungsfrist bis etwa 31\.01\.2027/)
  // Ein Zugang am 02.02.2026 endet nach jeder Lesart später (02.02.2027 bzw. 28.02.2027).
  assert.ok(objectionDeadline('2026-02-02') > '2027-01-31' && shiftMonths('2026-02-02', 12) > '2027-01-31')
})

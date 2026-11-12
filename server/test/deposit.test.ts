// Der Stand der Kaution aus den Kautionsbuchungen und die Höchstgrenze nach § 551 Abs. 1 BGB (#228).
import assert from 'node:assert/strict'
import test from 'node:test'
import { depositLimit, depositProblem, depositState } from '../../shared/deposit.ts'
import type { DepositEntry, DepositEntryKind, Tenancy } from '../../shared/types.ts'
import { rngOf } from '../testing/revertFlows.ts'

let seq = 0
const entry = (kind: DepositEntryKind, amountCents: number, date = '2025-03-01'): DepositEntry => ({
  id: `d${++seq}`, tenancyId: 't1', date, kind, amountCents, ...(kind === 'applied' ? { purpose: 'damage' as const } : {}),
})

const tenancy = (patch: Partial<Tenancy> = {}): Tenancy => ({
  id: 't1', unitId: 'u1', tenantName: 'Erika Mustermann', persons: 1, personHistory: [], start: '2025-03-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2025-03', monthlyCents: 80000 }], ...patch,
})

test('Stand der Kaution: ohne Buchung gilt der gespeicherte Stand', () => {
  assert.deepEqual(depositState({ depositCents: 240000, depositStatus: 'erhalten' }, []), {
    derived: false, status: 'erhalten', receivedCents: 0, interestCents: 0, appliedCents: 0, refundedCents: 0, balanceCents: 0,
  })
  assert.equal(depositState({ depositCents: 240000 }, []).status, 'offen')
})

test('Stand der Kaution: drei Raten ergeben erst teilweise, dann erhalten', () => {
  const t = { depositCents: 240000, depositStatus: 'offen' as const }
  const rates = [entry('received', 80000), entry('received', 80000, '2025-04-01'), entry('received', 80000, '2025-05-01')]
  assert.equal(depositState(t, rates.slice(0, 1)).status, 'teilweise')
  assert.equal(depositState(t, rates.slice(0, 2)).status, 'teilweise')
  const all = depositState(t, rates)
  assert.equal(all.status, 'erhalten')
  assert.equal(all.balanceCents, 240000)
  assert.equal(all.derived, true)
})

test('Stand der Kaution: ohne vereinbarte Kaution ist ein Eingang erhalten', () => {
  assert.equal(depositState({}, [entry('received', 50000)]).status, 'erhalten')
})

test('Stand der Kaution: Ertrag erhöht den Stand, vollständig ausgezahlt ist zurückgezahlt', () => {
  const t = { depositCents: 240000 }
  const withInterest = [entry('received', 240000), entry('interest', 1234, '2025-12-31')]
  const state = depositState(t, withInterest)
  assert.equal(state.balanceCents, 241234)
  assert.equal(state.status, 'erhalten')
  const paidOut = depositState(t, [...withInterest, entry('refunded', 241234, '2026-06-30')])
  assert.equal(paidOut.status, 'zurückgezahlt')
  assert.equal(paidOut.balanceCents, 0)
})

test('Stand der Kaution: nur Ertrag ohne Eingang bleibt offen', () => {
  assert.equal(depositState({ depositCents: 240000 }, [entry('interest', 100)]).status, 'offen')
})

test('Stand der Kaution: verrechnet und ausgezahlt bis null ist zurückgezahlt, mit Rest erhalten', () => {
  const t = { depositCents: 100000 }
  const base = [entry('received', 100000), entry('applied', 30000, '2026-01-10')]
  assert.equal(depositState(t, base).status, 'erhalten')
  const done = depositState(t, [...base, entry('refunded', 70000, '2026-02-01')])
  assert.equal(done.status, 'zurückgezahlt')
  assert.equal(done.appliedCents, 30000)
})

test('depositProblem: der erste Tag, an dem der Stand unter null fiele', () => {
  const wrong = [entry('received', 100000, '2025-03-01'), entry('refunded', 100000, '2025-02-01')]
  assert.deepEqual(depositProblem(wrong), { date: '2025-02-01', balanceCents: -100000 })
  assert.equal(depositProblem([entry('received', 100000, '2025-02-01'), entry('refunded', 100000, '2025-03-01')]), null)
  // Am selben Tag entscheidet die Reihenfolge der Liste.
  assert.equal(depositProblem([entry('received', 100000), entry('refunded', 100000)]), null)
  assert.deepEqual(depositProblem([entry('refunded', 100000), entry('received', 100000)]), { date: '2025-03-01', balanceCents: -100000 })
})

test('Höchstgrenze der Kaution: das Dreifache der Kaltmiete am Mietbeginn', () => {
  assert.equal(depositLimit(tenancy()), 240000)
  // Eine spätere Staffel ändert nichts: Maßgeblich ist die Miete, mit der das Mietverhältnis beginnt.
  assert.equal(depositLimit(tenancy({ baseRents: [{ from: '2025-03', monthlyCents: 80000 }, { from: '2026-03', monthlyCents: 90000 }] })), 240000)
  // Eine Staffel, die vor dem Beginn anfängt, gilt am Beginn.
  assert.equal(depositLimit(tenancy({ baseRents: [{ from: '2024-01', monthlyCents: 70000 }] })), 210000)
  // Inklusivmiete: die ganze Miete steht in der Staffel der Kaltmiete.
  assert.equal(depositLimit(tenancy({ costModel: 'inclusive', heatingModel: 'inclusive', baseRents: [{ from: '2025-03', monthlyCents: 100000 }] })), 300000)
  // Pauschale: ohne die als Pauschale ausgewiesenen Betriebskosten.
  assert.equal(depositLimit(tenancy({ costModel: 'flatRate' })), 240000)
})

test('Höchstgrenze der Kaution: kein Wert bei teilweise inklusiver Miete oder ohne Kaltmiete am Beginn', () => {
  assert.equal(depositLimit(tenancy({ costModel: 'inclusive' })), null)
  assert.equal(depositLimit(tenancy({ heatingModel: 'inclusive' })), null)
  assert.equal(depositLimit(tenancy({ baseRents: [] })), null)
  assert.equal(depositLimit(tenancy({ baseRents: [{ from: '2025-06', monthlyCents: 80000 }] })), null)
})

test('Stand der Kaution, Invariante: der Stand ist die Summe der Buchungen', () => {
  const rng = rngOf(228)
  const kinds: DepositEntryKind[] = ['received', 'interest', 'applied', 'refunded']
  for (let run = 0; run < 200; run++) {
    const entries: DepositEntry[] = []
    const count = 1 + Math.floor(rng() * 8)
    for (let i = 0; i < count; i++) {
      const kind = kinds[Math.floor(rng() * kinds.length)]
      if (!kind) assert.fail('keine Art gezogen')
      entries.push(entry(kind, 1 + Math.floor(rng() * 300000), `2025-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-15`))
    }
    const s = depositState({ depositCents: 240000 }, entries)
    assert.equal(s.balanceCents, s.receivedCents + s.interestCents - s.appliedCents - s.refundedCents, `Lauf ${run}`)
    const sum = (k: DepositEntryKind) => entries.filter((e) => e.kind === k).reduce((a, e) => a + e.amountCents, 0)
    assert.equal(s.receivedCents, sum('received'), `Lauf ${run}`)
    assert.equal(s.refundedCents, sum('refunded'), `Lauf ${run}`)
    // Was depositProblem durchlässt, ist an keinem Tag negativ, also auch am Ende nicht.
    if (depositProblem(entries) === null) assert.ok(s.balanceCents >= 0, `Lauf ${run}`)
  }
})

// #317: der Plan für „In die Staffel übernehmen“, ohne Datenbank. Monat aus dem Schreiben, Sätze zu Versand und Zugang,
// gesperrte Fälle und die neue Staffel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planPrepaymentSteps, stepMonthProblem, stepToken, stepWrites, type StepInput } from '../src/prepaymentSteps.ts'

const tenancy = { id: 't1', end: null, prepayments: [{ from: '2024-01', monthlyCents: 4000 }] }
const input = (over: Partial<StepInput> = {}): StepInput => ({
  scope: 'all', separate: false, periodTo: '2025-12-31', closedAt: '2026-03-02T10:00:00.000Z', sentAt: '2026-03-03', today: '2026-03-10',
  errors: [], letters: [{ tenancyId: 't1', tenantName: 'Erika', unitName: 'EG', cents: 5000, from: '2026-05' }],
  tenancies: [tenancy], months: {}, ...over,
})
const one = (over: Partial<StepInput> = {}) => planPrepaymentSteps(input(over)).items[0] ?? assert.fail('kein Eintrag')

test('#317: der Monat aus dem Schreiben, Betrag in die Staffel der übrigen Nebenkosten', () => {
  const it = one()
  assert.equal(it.from, '2026-05')
  assert.equal(it.schedule, 'prepayments')
  assert.equal(it.currentCents, 4000)
  assert.equal(it.state, 'pending')
  assert.deepEqual(it.notes, [])
  assert.equal(it.overdue, false)
  // Ist der Monat erreicht, heißt es „angekündigt, aber nicht übernommen“.
  assert.equal(one({ today: '2026-05-01' }).overdue, true)
  // Steht der Betrag schon, ist nichts zu tun.
  const taken = one({ tenancies: [{ ...tenancy, prepayments: [...tenancy.prepayments, { from: '2026-05', monthlyCents: 5000 }] }] })
  assert.equal(taken.state, 'taken')
  assert.equal(taken.overdue, false)
})

test('#317: Heizkostenabrechnung nach Weg d schreibt die Heizstaffel', () => {
  const it = one({ scope: 'heating', tenancies: [{ ...tenancy, heatingPrepayments: [{ from: '2025-01', monthlyCents: 6000 }] }] })
  assert.equal(it.schedule, 'heatingPrepayments')
  assert.equal(it.currentCents, 6000)
})

test('#317: zwei Staffeln bei einer Gesamtabrechnung werden nicht geraten', () => {
  const two = { ...tenancy, heatingPrepayments: [{ from: '2025-01', monthlyCents: 6000 }] }
  const it = one({ tenancies: [two] })
  assert.equal(it.state, 'blocked')
  assert.match(it.blocked ?? '', /zwei Staffeln/)
  // Wird die Heizung getrennt abgerechnet, gilt der Vorschlag ohne sie.
  assert.equal(one({ tenancies: [two], separate: true }).state, 'pending')
  // Endet das Mietverhältnis vorher, gibt es keine Stufe.
  assert.match(one({ tenancies: [{ ...tenancy, end: '2026-04-30' }] }).blocked ?? '', /endet am 30\.04\.2026, vor Mai 2026/)
  assert.match(one({ tenancies: [] }).blocked ?? '', /gibt es nicht mehr/)
})

test('#317: Sätze zu Versand und Zugang', () => {
  assert.match(one({ sentAt: null }).notes.join(' '), /Versanddatum ist nicht eingetragen/)
  // Versand im März: Mai ist der übernächste Monat, kein Satz. Im April versandt: später als die Vorgabe.
  assert.match(one({ sentAt: '2026-04-02' }).notes.join(' '), /später als die Vorgabe.*Juni 2026/)
  // Im Mai versandt: der Monat hatte schon begonnen.
  assert.match(one({ sentAt: '2026-05-04' }).notes.join(' '), /schon begonnen.*VIII ZR 271\/10/)
  // Ein geänderter Monat nennt den des Schreibens.
  const moved = one({ months: { t1: '2026-07' } })
  assert.equal(moved.from, '2026-07')
  assert.match(moved.notes.join(' '), /Das Schreiben nennt Mai 2026, übernommen wird ab Juli 2026/)
  // Ein Schreiben von vor #317: übernächster Monat nach dem Versand.
  const old = one({ letters: [{ tenancyId: 't1', tenantName: 'Erika', unitName: 'EG', cents: 5000, from: null }] })
  assert.equal(old.from, '2026-05')
  assert.match(old.notes.join(' '), /nennt keinen Monat/)
})

test('#317: der Monat liegt nach dem abgerechneten Zeitraum', () => {
  assert.equal(stepMonthProblem('2026-01', '2025-12-31'), null)
  assert.match(stepMonthProblem('2025-12', '2025-12-31') ?? '', /im abgerechneten Zeitraum/)
  assert.match(stepMonthProblem('2026-13', '2025-12-31') ?? '', /ungültig/)
})

test('#317: die neue Staffel ersetzt eine Stufe desselben Monats, spätere bleiben; die Marke hängt am Plan', () => {
  const t = { ...tenancy, prepayments: [{ from: '2024-01', monthlyCents: 4000 }, { from: '2026-05', monthlyCents: 4500 }, { from: '2027-01', monthlyCents: 4800 }] }
  const plan = planPrepaymentSteps(input({ tenancies: [t] }))
  assert.deepEqual(plan.items[0]?.existing.map((e) => e.from), ['2026-05', '2027-01'])
  assert.deepEqual(stepWrites(plan, [t], ['t1']), [{ tenancyId: 't1', schedule: 'prepayments', entries: [{ from: '2024-01', monthlyCents: 4000 }, { from: '2026-05', monthlyCents: 5000 }, { from: '2027-01', monthlyCents: 4800 }] }])
  assert.deepEqual(stepWrites(plan, [t], []), [])
  assert.notEqual(stepToken(plan), stepToken(planPrepaymentSteps(input())))
})

// Durchsicht zu PR #435
test('M1 (3): ein Monat des Schreibens im abgerechneten Zeitraum wird nie geschrieben', () => {
  const june = [{ tenancyId: 't1', tenantName: 'Erika', unitName: 'EG', cents: 5000, from: '2025-06' }]
  const it = one({ letters: june })
  assert.equal(it.state, 'blocked')
  assert.equal(it.fixMonth, true)
  assert.match(it.blocked ?? '', /Juni 2025 liegt im abgerechneten Zeitraum.*„Ab Monat“/)
  assert.deepEqual(stepWrites(planPrepaymentSteps(input({ letters: june })), [tenancy], ['t1']), [])
  // Mit einem geänderten Monat geht es.
  assert.equal(one({ letters: june, months: { t1: '2026-05' } }).state, 'pending')
})

test('S2: Stufen zwischen Zeitraumende und Monat stehen im Plan', () => {
  const t = { ...tenancy, prepayments: [{ from: '2024-01', monthlyCents: 4000 }, { from: '2026-02', monthlyCents: 4400 }] }
  assert.deepEqual(one({ tenancies: [t] }).earlier, [{ from: '2026-02', monthlyCents: 4400 }])
  assert.deepEqual(one().earlier, [])
})

test('K1: getrennte Heizung ohne Heizstaffel ab dem Monat bekommt einen Satz', () => {
  assert.match(one({ separate: true }).notes.join(' '), /keine Heizvorauszahlung/)
  assert.doesNotMatch(one({ separate: true, tenancies: [{ ...tenancy, heatingPrepayments: [{ from: '2025-01', monthlyCents: 6000 }] }] }).notes.join(' '), /keine Heizvorauszahlung/)
})

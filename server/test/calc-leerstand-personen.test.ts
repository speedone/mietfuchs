// Personenschlüssel bei Leerstand (#177). Den Anteil einer leerstehenden Wohnung trägt der
// Vermieter (BGH, Urteil vom 31.05.2006, VIII ZR 159/05, entschieden am Flächenschlüssel). Beim
// Personenschlüssel hatte die leere Wohnung 0 Personentage und fiel aus der Verteilbasis, ihr
// Anteil ging also an die übrigen Mieter. Jetzt zählt sie für jeden Tag ohne Mietverhältnis mit
// `practice.vacancy-persons` Personen (Rechtsregister, shared/law/practice.ts), und dieser Anteil
// bleibt beim Vermieter. Wie viele Personen das sind, ist eine Auslegung von Mietfuchs und keine
// belegte Regel; die Rechnungen unten nehmen deshalb den Wert aus dem Register und nicht seine
// heutige Zahl, und genau ein Test hält die Zahl fest.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, occupiedDays, type ComputedSettlement } from '../src/calc.ts'
import { valueAt } from '../../shared/law/register.ts'
import { practiceVacancyPersons } from '../../shared/law/practice.ts'
import { compareWithFrozen } from '../src/settlementDiff.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { assertLandlordParts } from '../testing/landlordParts.ts'
import { GLOSSARY } from '../../shared/glossary.ts'

const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 60, participates: true, ...over })
const tenancy = (id: string, unitId: string, persons: number, start = '2020-01-01', end: string | null = null): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons, personHistory: [{ from: start, persons }], start, end,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const muell = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'muell', period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Müll', amountCents: 60000, key: 'persons', ...over,
})
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025))

const shareOf = (s: ComputedSettlement, tenancyId: string): number => {
  const st = s.statements.find((x) => x.tenancyId === tenancyId) ?? assert.fail(`keine Abrechnung für ${tenancyId}`)
  return st.totalShareCents
}

const V = valueAt(practiceVacancyPersons, '2025-01-01')
// Rohanteil kaufmännisch gerundet: Bei Leerstand schöpfen die Mieter die Summe nicht aus, dann
// rundet die Berechnung je Anteil statt nach dem Restverfahren.
const part = (amount: number, personDays: number, basis: number) => Math.round((amount * personDays) / basis)
const personen = (n: number) => `${n} ${n === 1 ? 'Person' : 'Personen'}`

function assertSound(s: ComputedSettlement, tenancyCount: number): void {
  const tenants = s.statements.reduce((a, st) => a + st.totalShareCents, 0)
  assert.equal(tenants + s.landlord.totalCents, s.totalCostsCents)
  assertLandlordParts(s, tenancyCount, 'Leerstand')
}

test('Leerstand: heute zählt ein Leerstandstag mit einer Person (Auslegung, #177)', () => {
  assert.equal(V, 1)
})

test('Leerstand beim Personenschlüssel: eine ganzjährig leere Wohnung zählt mit, ihren Anteil trägt der Vermieter', () => {
  // Mit einer Person je Leerstandstag: A 2 × 365 = 730, B 1 × 365 = 365, C leer 1 × 365 = 365;
  // Basis 1.460 Personentage. A = 600 € × 730/1.460 = 300 €, B = 150 €, Vermieter = 150 €.
  // Bisher A 400 €, B 200 €: Der Leerstand ging an die Mieter.
  const basis = 730 + 365 + 365 * V
  const s = settle({
    units: [unit('A'), unit('B'), unit('C')],
    tenancies: [tenancy('ta', 'A', 2), tenancy('tb', 'B', 1)],
    costItems: [muell()],
  })
  assertSound(s, 2)
  const a = part(60000, 730, basis)
  const b = part(60000, 365, basis)
  assert.equal(shareOf(s, 'ta'), a)
  assert.equal(shareOf(s, 'tb'), b)
  assert.equal(s.landlord.totalCents, 60000 - a - b)
  assert.equal(s.landlord.rows[0]?.landlordParts?.[0]?.reason, 'vacancy')
  assert.equal(s.landlord.rows[0]?.landlordParts?.[0]?.cents, part(60000, 365 * V, basis))
  assert.equal(s.selfUsedShareCents, 0)
  const row = s.statements.find((x) => x.tenancyId === 'ta')?.rows[0] ?? assert.fail('keine Zeile')
  assert.equal(row.basisText, `730 von ${basis.toLocaleString('de-DE')} Personentagen (davon ${(365 * V).toLocaleString('de-DE')} Leerstand)`)
  const vacancyStep = row.steps?.find((x) => x.label === 'davon Leerstand') ?? assert.fail(`kein Schritt zum Leerstand: ${JSON.stringify(row.steps)}`)
  assert.equal(vacancyStep.value, `C: 365 Tage × ${personen(V)} = ${365 * V} Personentage`)
  assert.equal(vacancyStep.term, 'vacancy')
  const notice = s.notices.find((n) => n.code === 'basis.vacancy-persons') ?? assert.fail(`kein Hinweis: ${JSON.stringify(s.notices)}`)
  assert.equal(notice.level, 'hint')
  assert.match(notice.text, /VIII ZR 159\/05/)
  assert.match(notice.text, /Auslegung/)
  assert.match(notice.text, /VIII ZR 180\/12/)
  assert.match(notice.text, /fiktive Person/)
  assert.doesNotMatch(notice.text, /üblich|vorgeschrieben/)
  assert.match(notice.text, /„Müll“/)
  assert.match(notice.text, /C \(365 Tage\)/)
  // Eine Auskunft, nichts zu beheben: kein „Hier beheben →“ (Endprüfung rc.4).
  assert.equal(notice.subject, undefined)
})

test('Leerstand beim Personenschlüssel: mehrere leere Wohnungen stehen als deutsche Aufzählung da', () => {
  const zwei = settle({
    units: [unit('A'), unit('C'), unit('G')],
    tenancies: [tenancy('ta', 'A', 2), tenancy('tc', 'C', 1, '2020-01-01', '2025-06-30')],
    costItems: [muell()],
  })
  const n2 = zwei.notices.find((n) => n.code === 'basis.vacancy-persons') ?? assert.fail(`kein Hinweis: ${JSON.stringify(zwei.notices)}`)
  assert.match(n2.text, /standen C \(184 Tage\) und G \(365 Tage\) leer\./)
  const drei = settle({
    units: [unit('A'), unit('B'), unit('C'), unit('D')],
    tenancies: [tenancy('ta', 'A', 2)],
    costItems: [muell({ id: 'm1', description: 'Müll' }), muell({ id: 'm2', description: 'Wasser' })],
  })
  const n3 = drei.notices.find((n) => n.code === 'basis.vacancy-persons') ?? assert.fail(`kein Hinweis: ${JSON.stringify(drei.notices)}`)
  assert.match(n3.text, /^Bei „Müll“ und „Wasser“ \(nach Personen\) standen B \(365 Tage\), C \(365 Tage\) und D \(365 Tage\) leer\./)
})

test('Leerstand beim Personenschlüssel: Teiljahr zwischen zwei Mietern', () => {
  // C: X bis 30.04. mit 1 Person (120 Tage), leer 01.05.–31.08. (123 Tage), Y ab 01.09. mit 2
  // Personen (122 Tage = 244 Personentage). Mit einer Person je Leerstandstag ist die Basis
  // 730 + 365 + 120 + 244 + 123 = 1.582:
  //   A = 60.000 × 730/1.582 = 27.686,47 ct
  //   B = 60.000 × 365/1.582 = 13.843,24 ct
  //   X = 60.000 × 120/1.582 =  4.551,20 ct
  //   Y = 60.000 × 244/1.582 =  9.254,11 ct
  //   Leerstand = 60.000 × 123/1.582 = 4.664,98 ct
  // Abgerundet 59.998 ct; die zwei Restcent gehen an die größten Reste (#202), den Leerstand (0,98)
  // und A (0,47): A 27.687, B 13.843, X 4.551, Y 9.254, Leerstand 4.665 ct. Vorher rundete jeder
  // Mieter für sich (A 27.686), und der eine Cent stand als Rundung beim Vermieter.
  const basis = 730 + 365 + 120 + 244 + 123 * V
  const s = settle({
    units: [unit('A'), unit('B'), unit('C')],
    tenancies: [tenancy('ta', 'A', 2), tenancy('tb', 'B', 1), tenancy('tx', 'C', 1, '2020-01-01', '2025-04-30'), tenancy('ty', 'C', 2, '2025-09-01')],
    costItems: [muell()],
  })
  assertSound(s, 4)
  assert.equal(basis, 1582, 'die Zahlen oben gelten für eine Person je Leerstandstag')
  assert.deepEqual(['ta', 'tb', 'tx', 'ty'].map((id) => shareOf(s, id)), [27687, 13843, 4551, 9254])
  assert.equal(s.landlord.totalCents, 4665)
  assert.deepEqual(s.landlord.rows[0]?.landlordParts, [{ reason: 'vacancy', cents: 4665 }])
  const row = s.statements.find((x) => x.tenancyId === 'ty')?.rows[0] ?? assert.fail('keine Zeile')
  assert.equal(row.steps?.find((x) => x.label === 'davon Leerstand')?.value, `C: 123 Tage × ${personen(V)} = ${123 * V} Personentage`)
})

test('Leerstand beim Personenschlüssel: eine Garage mit 0 m² und 0 Personen bleibt, wie sie war', () => {
  // Die Garage ist im Jahr nur bis Juni vermietet, mit 0 Personen. Sie ist Garage-artig (#135) und
  // bekommt für die leere Zeit keine Person.
  const s = settle({
    units: [unit('wohnung', { areaM2: 80 }), unit('garage', { areaM2: 0 })],
    tenancies: [tenancy('tw', 'wohnung', 2), tenancy('tg', 'garage', 0, '2020-01-01', '2025-06-30')],
    costItems: [muell()],
  })
  assertSound(s, 2)
  assert.equal(shareOf(s, 'tw'), 60000)
  assert.equal(shareOf(s, 'tg'), 0)
  assert.equal(s.landlord.totalCents, 0)
  assert.ok(!s.notices.some((n) => n.code === 'basis.vacancy-persons'), JSON.stringify(s.notices))
})

test('Leerstand beim Personenschlüssel: die selbstgenutzte Wohnung zählt weiter mit ihren eigenen Personen', () => {
  const s = settle({
    units: [unit('eigen', { participates: false, selfUsed: true, selfPersons: 2 }), unit('miete')],
    tenancies: [tenancy('tm', 'miete', 2)],
    costItems: [muell()],
  })
  assertSound(s, 1)
  assert.equal(shareOf(s, 'tm'), 30000)
  assert.equal(s.selfUsedShareCents, 30000)
  assert.deepEqual(s.landlord.rows[0]?.landlordParts, [{ reason: 'selfUse', cents: 30000 }])
  assert.ok(!s.notices.some((n) => n.code === 'basis.vacancy-persons'))
})

test('Leerstand beim Personenschlüssel: neben der selbstgenutzten Wohnung ist Leerstand kein Eigenanteil', () => {
  // eigen 2 × 365 = 730, miete 2 × 365 = 730, leer 1 × 365 = 365; Basis 1.825.
  // Mieter = 60.000 × 730/1.825 = 24.000, Eigenanteil = 24.000, Leerstand = 12.000.
  const basis = 730 + 730 + 365 * V
  const s = settle({
    units: [unit('eigen', { participates: false, selfUsed: true, selfPersons: 2 }), unit('miete'), unit('leer')],
    tenancies: [tenancy('tm', 'miete', 2)],
    costItems: [muell()],
  })
  assertSound(s, 1)
  assert.equal(shareOf(s, 'tm'), part(60000, 730, basis))
  assert.equal(s.selfUsedShareCents, part(60000, 730, basis))
  assert.deepEqual(s.landlord.rows[0]?.landlordParts?.map((p) => p.reason), ['selfUse', 'vacancy'])
  assert.equal(s.landlord.rows[0]?.landlordParts?.[1]?.cents, part(60000, 365 * V, basis))
})

test('Leerstand beim Personenschlüssel: Teilnehmer der Position schließen die leere Wohnung aus', () => {
  const s = settle({
    units: [unit('A'), unit('B'), unit('C')],
    tenancies: [tenancy('ta', 'A', 2), tenancy('tb', 'B', 1)],
    costItems: [muell({ participantUnitIds: ['A', 'B'] })],
  })
  assertSound(s, 2)
  assert.equal(shareOf(s, 'ta'), 40000)
  assert.equal(shareOf(s, 'tb'), 20000)
  assert.equal(s.landlord.totalCents, 0)
  assert.ok(!s.notices.some((n) => n.code === 'basis.vacancy-persons'))
})

test('Leerstand beim Personenschlüssel: eine Wohnung außerhalb der Abrechnungseinheit zählt nicht', () => {
  const s = settle({
    units: [unit('A'), unit('B'), unit('aussen', { participates: false })],
    tenancies: [tenancy('ta', 'A', 2), tenancy('tb', 'B', 1)],
    costItems: [muell()],
  })
  assert.equal(shareOf(s, 'ta'), 40000)
  assert.equal(shareOf(s, 'tb'), 20000)
})

test('Leerstand beim Personenschlüssel: andere Schlüssel melden nichts', () => {
  const s = settle({
    units: [unit('A'), unit('B'), unit('C')],
    tenancies: [tenancy('ta', 'A', 2), tenancy('tb', 'B', 1)],
    costItems: [muell({ key: 'area' })],
  })
  assert.ok(!s.notices.some((n) => n.code === 'basis.vacancy-persons'))
})

test('Lexikon: Leerstand nennt Grundsatz, fiktive Person und die Auslegung, ohne auf eine offene Lücke zu verweisen', () => {
  const v = GLOSSARY.vacancy
  const all = `${v.short} ${v.example} ${v.norm ?? ''} ${v.needed}`
  assert.match(v.norm ?? '', /VIII ZR 159\/05/)
  assert.match(v.norm ?? '', /VIII ZR 180\/12/)
  assert.match(v.needed, /Auslegung von Mietfuchs/)
  assert.match(v.needed, /nicht abschließend geklärt/)
  assert.doesNotMatch(all, /#177|derzeit nicht|üblich|vorgeschrieben/)
  assert.match(GLOSSARY.personDays.needed, /leer/)
})

test('Leerstand beim Personenschlüssel: steht das ganze Haus leer, gibt es keinen Hinweis, der Vermieter trägt alles', () => {
  const s = settle({ units: [unit('A'), unit('B')], costItems: [muell()] })
  assert.equal(s.landlord.totalCents, 60000)
  assert.deepEqual(s.landlord.rows[0]?.landlordParts, [{ reason: 'vacancy', cents: 60000 }])
  assert.deepEqual(s.notices, [])
})

const muell1200 = (over: Partial<SnapshotCostItem> = {}) => muell({ amountCents: 120000, ...over })

test('Leerstand beim Personenschlüssel: eine leere Garage mit 0 m² ist keine Wohnung und kein Leerstand, dazu ein Hinweis', () => {
  const s = settle({
    units: [unit('W1'), unit('W2'), unit('Garage', { areaM2: 0 })],
    tenancies: [tenancy('t1', 'W1', 2), tenancy('t2', 'W2', 2)],
    costItems: [muell1200()],
  })
  assertSound(s, 2)
  assert.equal(shareOf(s, 't1'), 60000)
  assert.equal(shareOf(s, 't2'), 60000)
  assert.equal(s.landlord.totalCents, 0)
  assert.ok(!s.notices.some((n) => n.code === 'basis.vacancy-persons'), JSON.stringify(s.notices))
  const hint = s.notices.find((n) => n.code === 'basis.vacancy-no-area') ?? assert.fail(`kein Hinweis: ${JSON.stringify(s.notices)}`)
  assert.equal(hint.level, 'hint')
  assert.equal(hint.text, 'Garage hat 0 m² und keine Bewohner und wird beim Personenschlüssel nicht als Leerstand angesetzt. Ist Garage eine Wohnung, tragen Sie die Wohnfläche ein.')
  assert.deepEqual(hint.subject, { kind: 'unit', id: 'Garage' })
  const row = s.statements[0]?.rows[0] ?? assert.fail('keine Zeile')
  assert.equal(row.basisText, '730 von 1.460 Personentagen')
  assert.equal(row.steps?.find((x) => x.label === 'davon Leerstand'), undefined)
})

test('Leerstand beim Personenschlüssel: sechs Wohnungen und vier leere Stellplätze, die Mieter zahlen je ein Sechstel', () => {
  const s = settle({
    units: [...[1, 2, 3, 4, 5, 6].map((i) => unit(`W${i}`)), ...[1, 2, 3, 4].map((i) => unit(`Stellplatz ${i}`, { areaM2: 0 }))],
    tenancies: [1, 2, 3, 4, 5, 6].map((i) => tenancy(`t${i}`, `W${i}`, 1)),
    costItems: [muell1200()],
  })
  assertSound(s, 6)
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((i) => shareOf(s, `t${i}`)), [20000, 20000, 20000, 20000, 20000, 20000])
  assert.equal(s.landlord.totalCents, 0)
  const hints = s.notices.filter((n) => n.code === 'basis.vacancy-no-area')
  assert.equal(hints.length, 1)
  assert.match(hints[0]?.text ?? '', /^Stellplatz 1, Stellplatz 2, Stellplatz 3 und Stellplatz 4 haben 0 m² und keine Bewohner/)
})

test('Leerstand beim Personenschlüssel: eine leere Garage mit eingetragener Fläche zählt als Leerstand', () => {
  const s = settle({
    units: [unit('W1'), unit('W2'), unit('Garage', { areaM2: 15 })],
    tenancies: [tenancy('t1', 'W1', 2), tenancy('t2', 'W2', 2)],
    costItems: [muell1200()],
  })
  assertSound(s, 2)
  const basis = 730 + 730 + 365 * V
  assert.equal(shareOf(s, 't1'), part(120000, 730, basis))
  assert.ok(s.notices.some((n) => n.code === 'basis.vacancy-persons'))
  assert.ok(!s.notices.some((n) => n.code === 'basis.vacancy-no-area'))
})

test('Leerstand beim Personenschlüssel: ein einzelner Leerstandstag heißt „1 Tag“', () => {
  const s = settle({
    units: [unit('A'), unit('B')],
    tenancies: [tenancy('ta', 'A', 2), tenancy('tx', 'B', 1, '2020-01-01', '2025-06-29'), tenancy('ty', 'B', 1, '2025-07-01')],
    costItems: [muell()],
  })
  assertSound(s, 3)
  const row = s.statements.find((x) => x.tenancyId === 'ta')?.rows[0] ?? assert.fail('keine Zeile')
  assert.equal(row.steps?.find((x) => x.label === 'davon Leerstand')?.value, `B: 1 Tag × ${personen(V)} = ${V} ${V === 1 ? 'Personentag' : 'Personentage'}`)
  assert.match(s.notices.find((n) => n.code === 'basis.vacancy-persons')?.text ?? '', /B \(1 Tag\)/)
})

test('Belegte Tage: Überlappung, Verschachtelung, nahtloser Wechsel und ein Tag Lücke', () => {
  const t = (start: string, end: string | null) => ({ start, end })
  const y = ['2025-01-01', '2025-12-31'] as const
  assert.equal(occupiedDays([], ...y), 0)
  assert.equal(occupiedDays([t('2020-01-01', null)], ...y), 365)
  // Überlappung: bis 30.06. und ab 15.06. — jeder Tag nur einmal
  assert.equal(occupiedDays([t('2020-01-01', '2025-06-30'), t('2025-06-15', null)], ...y), 365)
  // Verschachtelt: ein kurzes Mietverhältnis innerhalb eines langen
  assert.equal(occupiedDays([t('2025-03-01', '2025-08-31'), t('2025-04-01', '2025-04-30')], ...y), 184)
  // nahtlos: Auszug 30.06., Einzug 01.07.
  assert.equal(occupiedDays([t('2020-01-01', '2025-06-30'), t('2025-07-01', null)], ...y), 365)
  // ein Tag Lücke: Auszug 29.06., Einzug 01.07.
  assert.equal(occupiedDays([t('2025-07-01', null), t('2020-01-01', '2025-06-29')], ...y), 364)
  // außerhalb des Jahres
  assert.equal(occupiedDays([t('2020-01-01', '2024-12-31'), t('2026-01-01', null)], ...y), 0)
})

test('Leerstand beim Personenschlüssel: eine nach altem Stand abgeschlossene Abrechnung zeigt die Abweichung zugunsten der Mieter', () => {
  const source = {
    units: [unit('A'), unit('B'), unit('C')],
    tenancies: [tenancy('ta', 'A', 2), tenancy('tb', 'B', 1)],
    costItems: [muell()],
  }
  // Der alte Stand: C fiel aus der Verteilbasis (A 400 €, B 200 €). Nachgestellt mit C außerhalb der
  // Abrechnungseinheit, was beim Personenschlüssel genau dasselbe ergab.
  const frozen = settle({ ...source, units: [unit('A'), unit('B'), unit('C', { participates: false })] })
  assert.equal(shareOf(frozen, 'ta'), 40000)
  const current = settle(source)
  const cmp = compareWithFrozen(frozen, current, 2025, '2026-03-01')
  assert.equal(cmp.comparable, true)
  assert.deepEqual(cmp.deviations.map((d) => [d.tenancyId, d.direction, d.differenceCents]), [
    ['ta', 'tenant', 40000 - shareOf(current, 'ta')],
    ['tb', 'tenant', 20000 - shareOf(current, 'tb')],
  ])
})

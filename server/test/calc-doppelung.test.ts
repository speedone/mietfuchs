// Sicherheitsnetz in der Abrechnung (Zusammenspiel #141 und #170): Stehen zwei Positionen derselben
// Kostenart im Jahr, von denen eine keinen Beleg hat, ist es oft dieselbe Rechnung zweimal, einmal
// als Übernahme aus dem Vorjahr mit Schätzbetrag und einmal aus dem Beleg. Die Abrechnung sagt es
// als Hinweis; verteilt wird wie erfasst, keine Zahl ändert sich.

import { calendarPeriod, startYearOf } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, NOTICE_KINDS } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'
import { GLOSSARY } from '../../shared/glossary.ts'

const item = (over: Partial<SnapshotCostItem> & Pick<SnapshotCostItem, 'id' | 'period'>): SnapshotCostItem => ({
  category: 'Grundsteuer', description: `Grundsteuer ${startYearOf(over.period)}`, amountCents: 60000, key: 'area', ...over,
})
const source = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [
    { id: 'u1', name: 'EG', areaM2: 50, participates: true },
    { id: 'u2', name: 'OG', areaM2: 70, participates: true },
  ],
  tenancies: [
    { id: 't1', unitId: 'u1', tenantName: 'Arnold', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
    { id: 't2', unitId: 'u2', tenantName: 'Berger', persons: 3, personHistory: [{ from: '2020-01-01', persons: 3 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
  ],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const settle = (costItems: SnapshotCostItem[]) => computeSettlement(snapshotOf(source(costItems), 2026))
const dupes = (costItems: SnapshotCostItem[]) => settle(costItems).notices.filter((n) => n.code === 'cost.possible-duplicate')

test('Übernommen und dann aus dem Beleg erfasst: Hinweis mit beiden Positionen und Beträgen, „Hier beheben“ an der ohne Beleg', () => {
  const found = dupes([
    item({ id: 'vj', period: calendarPeriod(2025) }),
    item({ id: 'schaetzung', period: calendarPeriod(2026), amountCents: 61000 }),
    item({ id: 'echt', period: calendarPeriod(2026), description: 'Abgabenbescheid Stadt', amountCents: 61240, vendor: 'Stadt', invoiceFile: 'gs.pdf' }),
  ])
  assert.equal(found.length, 1)
  const n = found[0]
  assert.equal(n?.level, 'hint')
  assert.deepEqual(n?.subject, { kind: 'costItem', id: 'schaetzung' })
  assert.match(n?.text ?? '', /„Grundsteuer 2026“ \(610,00 €, ohne Beleg\)/)
  assert.match(n?.text ?? '', /„Abgabenbescheid Stadt“ \(612,40 €\)/)
  assert.match(n?.text ?? '', /zweimal/)
  for (const t of n?.terms ?? []) assert.ok(t in GLOSSARY, `Begriff ${t} fehlt im Lexikon`)
  assert.ok((NOTICE_KINDS['cost.possible-duplicate']?.terms.length ?? 0) > 0)
})

test('Kein Hinweis: beide mit Beleg, Gliederung wie im Vorjahr, breite Kostenart mit verschiedenen Rechnungen', () => {
  assert.equal(dupes([
    item({ id: 'a', period: calendarPeriod(2026), invoiceFile: 'a.pdf' }),
    item({ id: 'b', period: calendarPeriod(2026), description: 'Nachzahlung', invoiceFile: 'b.pdf' }),
  ]).length, 0)
  assert.equal(dupes([
    item({ id: 'r1', period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Restmüll 2025' }),
    item({ id: 'b1', period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Biomüll 2025' }),
    item({ id: 'r2', period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Restmüll 2026' }),
    item({ id: 'b2', period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Biomüll 2026' }),
  ]).length, 0)
  assert.equal(dupes([
    item({ id: 's1', period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Wartung Hebeanlage' }),
    item({ id: 's2', period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Reinigung Dachrinne' }),
  ]).length, 0)
})

test('Keine Zahl ändert sich: dieselbe Verteilung mit und ohne den Hinweis', () => {
  const items = [item({ id: 'schaetzung', period: calendarPeriod(2026), amountCents: 61000 }), item({ id: 'echt', period: calendarPeriod(2026), description: 'Bescheid', amountCents: 61240, invoiceFile: 'gs.pdf' })]
  const withHint = settle(items)
  const without = settle(items.map((i) => ({ ...i, invoiceFile: 'x.pdf' })))
  assert.equal(withHint.notices.some((n) => n.code === 'cost.possible-duplicate'), true)
  assert.equal(without.notices.some((n) => n.code === 'cost.possible-duplicate'), false)
  assert.deepEqual(withHint.statements, without.statements)
  assert.equal(withHint.totalCostsCents, without.totalCostsCents)
})

test('L2: bei drei Positionen heißt es nicht „beide“', () => {
  const found = dupes([
    item({ id: 'a', period: calendarPeriod(2026), amountCents: 61000 }),
    item({ id: 'b', period: calendarPeriod(2026), description: 'Bescheid', amountCents: 61240, invoiceFile: 'gs.pdf' }),
    item({ id: 'c', period: calendarPeriod(2026), description: 'Nachtrag', amountCents: 1000 }),
  ])
  assert.equal(found.length, 1)
  const text = found[0]?.text ?? ''
  assert.doesNotMatch(text, /beide/)
  assert.match(text, /„Grundsteuer 2026“ \(610,00 €, ohne Beleg\), „Bescheid“ \(612,40 €\) und „Nachtrag“ \(10,00 €, ohne Beleg\) stehen 2026 alle unter „Grundsteuer“/)
})

test('M1 Integrationsdurchsicht: der Rat führt nicht zum bloßen Zuordnen, das den Hinweis verstummen ließe', () => {
  // Wer der Schätzung nur den Beleg zuordnet, lässt den Hinweis verschwinden (er verlangt eine
  // Position ohne Beleg), die Summe bleibt aber doppelt. Der Rat muss deshalb zum Löschen führen.
  const items = [
    item({ id: 'schaetzung', period: calendarPeriod(2026), amountCents: 150000 }),
    item({ id: 'echt', period: calendarPeriod(2026), description: 'Bescheid', amountCents: 150000, invoiceFile: 'gs.pdf' }),
  ]
  const text = dupes(items)[0]?.text ?? ''
  assert.doesNotMatch(text, /Beleg zuordnen/)
  assert.match(text, /eine der beiden Positionen löschen/)
  // Der Mechanismus, gegen den der Rat schützt: bloßes Zuordnen bringt den Hinweis zum Schweigen.
  const zugeordnet = items.map((i) => ({ ...i, invoiceFile: 'gs.pdf' }))
  assert.equal(dupes(zugeordnet).length, 0)
  assert.equal(settle(zugeordnet).totalCostsCents, 300000)
})

// #455, Durchsicht von Task 8 (I1): Die Teile einer aufgeteilten Rechnung im selben Zeitraum sind eine Rechnung. Trägt
// ein Teil den Beleg, ist die Rechnung belegt; der andere Teil darf weder „ohne Beleg“ heißen noch der Ort von „Hier
// beheben“ sein, sonst löschte der Vermieter einen echten Teil der Rechnung.
test('Teile einer Rechnung im selben Zeitraum: als eine Rechnung genannt, belegt über einen Teil, nicht Ziel des Rats', () => {
  const found = dupes([
    item({ id: 'vj', period: calendarPeriod(2025) }),
    item({ id: 'teil1', period: calendarPeriod(2026), description: 'Grundsteuer (anteilig)', amountCents: 12000, sourceId: 'q1', invoiceFile: 'gs.pdf' }),
    item({ id: 'teil2', period: calendarPeriod(2026), description: 'Grundsteuer (anteilig)', amountCents: 24500, sourceId: 'q1', key: 'persons' }),
    item({ id: 'schaetzung', period: calendarPeriod(2026), amountCents: 61000 }),
  ])
  assert.equal(found.length, 1)
  const n = found[0]
  assert.deepEqual(n?.subject, { kind: 'costItem', id: 'schaetzung' })
  const text = n?.text ?? ''
  assert.match(text, /„Grundsteuer \(anteilig\)“ \(2 Teile einer Rechnung, zusammen 365,00 €\) und „Grundsteuer 2026“ \(610,00 €, ohne Beleg\) stehen beide 2026 unter „Grundsteuer“/)
  assert.doesNotMatch(text, /365,00 €, ohne Beleg/)
  // Durchsicht von PR 3 (I1): nicht mehr „Soll die ohne Beleg bleiben, setzen Sie ihren Betrag …“, das hieße, einen
  // Teil der belegten Rechnung zu löschen.
  assert.match(text, /die Position ohne Beleg löschen und die aufgeteilte Rechnung mit allen ihren Teilen stehen lassen/)
})

// #455, Re-Durchsicht von Task 8 (N1): Eine Rechnung ist belegt, wenn ein Teil in irgendeinem Zeitraum den Beleg trägt
// (so zählen Belegabdeckung, Abzeichen und Cockpit). Der Hinweis sah nur die Gruppe des Zeitraums und nannte den Teil
// ohne Beleg trotzdem „ohne Beleg“, obwohl die Rechnung gedeckt ist.
test('Teil einer Rechnung, deren Beleg an einem Teil in einem anderen Zeitraum hängt: nicht „ohne Beleg“, kein Hinweis', () => {
  const found = dupes([
    item({ id: 'a1', period: calendarPeriod(2025), description: 'Versicherung (anteilig)', category: 'Sachversicherung', amountCents: 30000, sourceId: 'qa', invoiceFile: 'a.pdf' }),
    item({ id: 'a2', period: calendarPeriod(2026), description: 'Versicherung (anteilig)', category: 'Sachversicherung', amountCents: 60000, sourceId: 'qa' }),
    item({ id: 'b1', period: calendarPeriod(2026), description: 'Versicherung Haftpflicht', category: 'Sachversicherung', amountCents: 40000, sourceId: 'qb', invoiceFile: 'b.pdf' }),
  ])
  assert.deepEqual(found, [])
})

test('Fehlt der Beleg einer Rechnung aus mehreren Teilen, spricht der Rat von den Teilen dieser Rechnung', () => {
  const found = dupes([
    item({ id: 'vj', period: calendarPeriod(2025) }),
    item({ id: 'teil1', period: calendarPeriod(2026), description: 'Grundsteuer (anteilig)', amountCents: 12000, sourceId: 'q1' }),
    item({ id: 'teil2', period: calendarPeriod(2026), description: 'Grundsteuer (anteilig)', amountCents: 24500, sourceId: 'q1' }),
    item({ id: 'beleg', period: calendarPeriod(2026), amountCents: 61000, invoiceFile: 'gs.pdf' }),
  ])
  assert.equal(found.length, 1)
  const text = found[0]?.text ?? ''
  assert.match(text, /die Rechnung ohne Beleg löschen, mit allen ihren Teilen/)
  assert.doesNotMatch(text, /eine der beiden Positionen löschen/)
  assert.doesNotMatch(text, /setzen Sie ihren Betrag/)
})

// #455, Durchsicht von PR 3 (I1): Ist an der Gruppe eine aufgeteilte Rechnung beteiligt, darf der Rat nie lauten, den
// Betrag eines Teils auf den der Rechnung zu setzen: Die Teile in anderen Zeiträumen zählten dann doppelt (Grundsteuer
// 600 €, je 300 € in 2025 und 2026, dazu der Bescheid über 600 € in 2026: befolgt stünden 900 € da).
test('Teil ohne Beleg gegen eine belegte Position: kein Rat, den Betrag auf den der Rechnung zu setzen', () => {
  const found = dupes([
    item({ id: 'p25', period: calendarPeriod(2025), description: 'Grundsteuer (anteilig)', amountCents: 30000, sourceId: 'q1', serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }),
    item({ id: 'p26', period: calendarPeriod(2026), description: 'Grundsteuer (anteilig)', amountCents: 30000, sourceId: 'q1', serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }),
    item({ id: 'bescheid', period: calendarPeriod(2026), description: 'Grundsteuerbescheid', amountCents: 60000, invoiceFile: 'gs.pdf' }),
  ])
  assert.equal(found.length, 1)
  const n = found[0]
  assert.deepEqual(n?.subject, { kind: 'costItem', id: 'p26' })
  const text = n?.text ?? ''
  assert.doesNotMatch(text, /setzen Sie ihren Betrag/)
  assert.match(text, /mit allen ihren Teilen, auch denen in anderen Zeiträumen/)
  assert.match(text, /Soll sie bleiben, löschen Sie stattdessen die andere Rechnung\. /)
})

test('Belegte aufgeteilte Rechnung gegen eine Position ohne Beleg: die ohne Beleg löschen, die Rechnung bleibt ganz', () => {
  const found = dupes([
    item({ id: 'vj', period: calendarPeriod(2025) }),
    item({ id: 'teil1', period: calendarPeriod(2026), description: 'Grundsteuer (anteilig)', amountCents: 12000, sourceId: 'q1', invoiceFile: 'gs.pdf' }),
    item({ id: 'teil2', period: calendarPeriod(2026), description: 'Grundsteuer (anteilig)', amountCents: 24500, sourceId: 'q1' }),
    item({ id: 'schaetzung', period: calendarPeriod(2026), amountCents: 61000 }),
  ])
  const text = found[0]?.text ?? ''
  assert.doesNotMatch(text, /setzen Sie ihren Betrag/)
  assert.match(text, /die Position ohne Beleg löschen und die aufgeteilte Rechnung mit allen ihren Teilen stehen lassen/)
})

// #455, Durchsicht von PR 3 (I3): Zwei aufgeteilte Rechnungen derselben Kostenart, deren Leistungszeiträume sich nicht
// überschneiden (Versicherung Juli bis Juni, zwei Jahre nacheinander), sind zwei Rechnungen. Der Hinweis riet sonst,
// die frühere zu löschen.
test('Zwei Rechnungen mit getrennten Leistungszeiträumen sind keine Doppelung', () => {
  const vers = { category: 'Sachversicherung', description: 'Gebäudeversicherung (anteilig)' }
  const found = dupes([
    item({ id: 'a25', period: calendarPeriod(2025), ...vers, amountCents: 30000, sourceId: 'qa', serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }),
    item({ id: 'a26', period: calendarPeriod(2026), ...vers, amountCents: 30000, sourceId: 'qa', serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }),
    item({ id: 'b26', period: calendarPeriod(2026), ...vers, amountCents: 31000, sourceId: 'qb', serviceFrom: '2026-07-01', serviceTo: '2027-06-30', invoiceFile: 'b.pdf' }),
    item({ id: 'b27', period: calendarPeriod(2027), ...vers, amountCents: 31000, sourceId: 'qb', serviceFrom: '2026-07-01', serviceTo: '2027-06-30' }),
  ])
  assert.deepEqual(found, [])
  // Überschneiden sie sich, bleibt der Hinweis.
  const overlap = dupes([
    item({ id: 'a26', period: calendarPeriod(2026), ...vers, amountCents: 30000, serviceFrom: '2026-01-01', serviceTo: '2026-12-31' }),
    item({ id: 'b26', period: calendarPeriod(2026), ...vers, amountCents: 31000, serviceFrom: '2026-06-01', serviceTo: '2026-12-31', invoiceFile: 'b.pdf' }),
  ])
  assert.equal(overlap.length, 1)
  // Hat nur eine der beiden einen Leistungszeitraum, bleibt alles wie bisher.
  const oneSided = dupes([
    item({ id: 'a26', period: calendarPeriod(2026), ...vers, amountCents: 30000 }),
    item({ id: 'b26', period: calendarPeriod(2026), ...vers, amountCents: 31000, serviceFrom: '2026-07-01', serviceTo: '2027-06-30', sourceId: 'qb', invoiceFile: 'b.pdf' }),
  ])
  assert.equal(oneSided.length, 1)
})

// #455, zweite Durchsicht von PR 3 (R1): Sind beide Rechnungen aufgeteilt, gilt auch für die andere: gelöscht wird sie
// nur mit allen Teilen. „Löschen Sie stattdessen die andere Position“ ließe ihren Teil im anderen Zeitraum allein stehen.
test('Beide Rechnungen aufgeteilt: auch die andere wird nur mit allen ihren Teilen gelöscht', () => {
  const S = { category: 'Sachversicherung', serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }
  const found = dupes([
    item({ id: 'a25', period: calendarPeriod(2025), ...S, description: 'Versicherung (anteilig)', amountCents: 30000, sourceId: 'qa' }),
    item({ id: 'a26', period: calendarPeriod(2026), ...S, description: 'Versicherung (anteilig)', amountCents: 30000, sourceId: 'qa' }),
    item({ id: 'b25', period: calendarPeriod(2025), ...S, description: 'Versicherung Gebäude', amountCents: 30000, sourceId: 'qb', invoiceFile: 'b.pdf' }),
    item({ id: 'b26', period: calendarPeriod(2026), ...S, description: 'Versicherung Gebäude', amountCents: 30000, sourceId: 'qb' }),
  ])
  assert.equal(found.length, 1)
  const text = found[0]?.text ?? ''
  assert.deepEqual(found[0]?.subject, { kind: 'costItem', id: 'a26' })
  assert.doesNotMatch(text, /löschen Sie stattdessen die andere Position/)
  assert.match(text, /Soll sie bleiben, löschen Sie stattdessen die andere Rechnung, ebenfalls mit allen ihren Teilen, auch denen in anderen Zeiträumen/)
  assert.match(text, /Den Betrag eines Teils auf den der ganzen Rechnung zu setzen, zählte die übrigen Teile doppelt/)
})

// R2: Eine Position ohne Leistungszeitraum verbindet zwei getrennte Rechnungen zu einer Gruppe. „Hier beheben“ führt
// dann zu der Position ohne Beleg, die zu allen anderen passt, nicht zur früheren Versicherung.
test('Über eine dritte Position verbunden: „Hier beheben“ an der Position, die zu allen passt', () => {
  const S = { category: 'Sachversicherung', description: 'Versicherung (anteilig)' }
  const found = dupes([
    item({ id: 'vj', period: calendarPeriod(2025), ...S }),
    item({ id: 'a26', period: calendarPeriod(2026), ...S, amountCents: 30000, sourceId: 'qa', serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }),
    item({ id: 'c', period: calendarPeriod(2026), ...S, amountCents: 50000 }),
    item({ id: 'b26', period: calendarPeriod(2026), ...S, amountCents: 31000, sourceId: 'qb', serviceFrom: '2026-07-01', serviceTo: '2027-06-30', invoiceFile: 'b.pdf' }),
  ])
  assert.equal(found.length, 1)
  assert.deepEqual(found[0]?.subject, { kind: 'costItem', id: 'c' })
})

// R3: Ein alter Teil ohne Quelle (Leistungszeitraum über zwei Zeiträume, `isSplitPart`) ist ebenso ein Teil; Szenario A
// endete sonst bei 900 € für eine Rechnung über 600 €.
test('Alter Teil ohne Quelle: kein Rat, den Betrag auf den der Rechnung zu setzen', () => {
  const found = dupes([
    item({ id: 'p25', period: calendarPeriod(2025), description: 'Grundsteuer (anteilig)', amountCents: 30000, serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }),
    item({ id: 'p26', period: calendarPeriod(2026), description: 'Grundsteuer (anteilig)', amountCents: 30000, serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }),
    item({ id: 'bescheid', period: calendarPeriod(2026), description: 'Grundsteuerbescheid', amountCents: 60000, invoiceFile: 'gs.pdf' }),
  ])
  assert.equal(found.length, 1)
  const text = found[0]?.text ?? ''
  assert.doesNotMatch(text, /setzen Sie ihren Betrag/)
  assert.match(text, /mit allen ihren Teilen, auch denen in anderen Zeiträumen/)
})

// #471: Passt keine Rechnung ohne Beleg zu allen anderen (zwei aufgeteilte Rechnungen ohne Beleg mit getrennten
// Leistungszeiträumen, verbunden über eine dritte), führt „Hier beheben“ zur ersten. „Die Rechnung ohne Beleg löschen“
// wäre dann mehrdeutig; der Rat nennt eine der Rechnungen ohne Beleg und wie man sie findet.
test('#471: Passt keine Rechnung ohne Beleg zu allen, ist der Rat nicht mehrdeutig', () => {
  const S = { category: 'Sachversicherung', description: 'Versicherung (anteilig)' }
  const found = dupes([
    item({ id: 'a26', period: calendarPeriod(2026), ...S, amountCents: 30000, sourceId: 'qa', serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }),
    item({ id: 'b26', period: calendarPeriod(2026), ...S, amountCents: 31000, sourceId: 'qb', serviceFrom: '2026-07-01', serviceTo: '2027-06-30' }),
    item({ id: 'c', period: calendarPeriod(2026), ...S, amountCents: 61000, invoiceFile: 'c.pdf' }),
  ])
  assert.equal(found.length, 1)
  const text = found[0]?.text ?? ''
  assert.deepEqual(found[0]?.subject, { kind: 'costItem', id: 'a26' })
  assert.doesNotMatch(text, /die Rechnung ohne Beleg löschen/)
  assert.match(text, /Dann bitte eine der Rechnungen ohne Beleg löschen, die doppelt erfasste, mit allen ihren Teilen, auch denen in anderen Zeiträumen/)
  assert.match(text, /untereinander sind sie keine Doppelung/)
  // Ohne aufgeteilte Rechnung bleibt der Wortlaut wie bisher.
  const plain = dupes([
    item({ id: 'a', period: calendarPeriod(2026), ...S, amountCents: 30000, serviceFrom: '2026-01-01', serviceTo: '2026-06-30' }),
    item({ id: 'b', period: calendarPeriod(2026), ...S, amountCents: 31000, serviceFrom: '2026-07-01', serviceTo: '2026-12-31' }),
    item({ id: 'c', period: calendarPeriod(2026), ...S, amountCents: 61000, invoiceFile: 'c.pdf' }),
  ])
  assert.equal(plain.length, 1)
  assert.match(plain[0]?.text ?? '', /\. Dann bitte die doppelt erfasste Position löschen, in der Regel die ohne Beleg\. Nur den Beleg zuzuordnen genügt nicht/)
})

// Doppelte Kostenpositionen (Zusammenspiel #141 und #170): Wann gilt eine Position als dieselbe
// Rechnung wie eine schon erfasste? Dieselbe Regel fragen „Aus dem Vorjahr übernehmen“, die
// Schnellerfassung, die KI-Auswertung der Kostenseite, der Posteingang und der Hinweis der
// Abrechnung (shared/duplicates.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizedText, possibleDuplicates, sameCostCandidates, type DuplicateItem } from '../../shared/duplicates.ts'
import { calendarContext, calendarPeriod, periodContext, periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

let n = 0
const item = (over: Partial<DuplicateItem> & Pick<DuplicateItem, 'period' | 'category'>): DuplicateItem => ({
  id: `k${++n}`, description: over.category, amountCents: 10000, ...over,
})

test('Kandidaten: dasselbe Jahr und dieselbe Kostenart, bei einer gewöhnlichen Kostenart gleich welche Beschreibung', () => {
  const schaetzung = item({ period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Grundsteuer 2026' })
  const items = [
    schaetzung,
    item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025' }),
    item({ period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Grundsteuer' }),
  ]
  // So beschreibt die KI einen Bescheid: kein Wort gleich der Vorlage.
  const found = sameCostCandidates(items, { period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Abgabenbescheid Stadt Musterstadt Q1–Q4' })
  assert.deepEqual(found.map((i) => i.id), [schaetzung.id])
})

test('Kandidaten: bei einer breiten Kostenart nur mit ähnlicher Beschreibung oder gleichem Rechnungssteller', () => {
  const hebe = item({ period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Wartung Hebeanlage 2026', vendor: 'Pumpen Huber GmbH' })
  const items = [hebe]
  const ask = (description: string, vendor?: string) =>
    sameCostCandidates(items, { period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description, vendor }).map((i) => i.id)
  assert.deepEqual(ask('Reinigung Dachrinne', 'Dach Maier'), [])
  // Ähnlich heißt: gleich bis auf Schreibweise und Satzzeichen, oder die eine fängt mit der anderen an.
  assert.deepEqual(ask('wartung hebeanlage'), [hebe.id])
  assert.deepEqual(ask('Wartung Hebeanlage 2026, Rechnung 4711'), [hebe.id])
  // Gleicher Steller, auch kürzer geschrieben
  assert.deepEqual(ask('Jahreswartung', 'Pumpen Huber'), [hebe.id])
  // Eine leere Angabe trifft nichts
  assert.deepEqual(ask('', ''), [])
})

test('Kandidaten: „Nicht umlagefähig“ gilt als breite Kostenart', () => {
  const verwalter = item({ period: calendarPeriod(2026), category: 'Nicht umlagefähig', description: 'Verwaltergebühr' })
  const items = [verwalter]
  assert.deepEqual(sameCostCandidates(items, { period: calendarPeriod(2026), category: 'Nicht umlagefähig', description: 'Reparatur Heizung' }), [])
  assert.deepEqual(sameCostCandidates(items, { period: calendarPeriod(2026), category: 'Nicht umlagefähig', description: 'Verwaltergebühr 2026' }).map((i) => i.id), [verwalter.id])
})

test('Kandidaten: anderes Objekt und die Position selbst zählen nicht', () => {
  const a = { ...item({ period: calendarPeriod(2026), category: 'Grundsteuer' }), propertyId: 'p1' }
  const b = { ...item({ period: calendarPeriod(2026), category: 'Grundsteuer' }), propertyId: 'p2' }
  assert.deepEqual(sameCostCandidates([a, b], { propertyId: 'p1', period: calendarPeriod(2026), category: 'Grundsteuer' }).map((i) => i.id), [a.id])
  assert.deepEqual(sameCostCandidates([a, b], { propertyId: 'p1', period: calendarPeriod(2026), category: 'Grundsteuer', excludeId: a.id }), [])
})

test('Mögliche Doppelung: zwei Positionen einer Kostenart, eine ohne Beleg, mehr als im Vorjahr', () => {
  const schaetzung = item({ period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Grundsteuer 2026', amountCents: 61000 })
  const echt = item({ period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Grundsteuerbescheid', amountCents: 61240, invoiceFile: 'gs.pdf' })
  const vorjahr = [item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025' })]
  const groups = possibleDuplicates([schaetzung, echt], calendarContext(2026), vorjahr)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0]?.map((i) => i.id), [schaetzung.id, echt.id])
})

test('Mögliche Doppelung: nicht, wenn alle einen Beleg haben, und nicht, wenn das Vorjahr ebenso viele hatte', () => {
  const rest = item({ period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Restmüll 2026' })
  const bio = item({ period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Biomüll 2026' })
  const prev = [item({ period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Restmüll 2025' }), item({ period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Biomüll 2025' })]
  // Aus dem Vorjahr übernommen, beide noch ohne Beleg: Das ist die Gliederung des Hauses.
  assert.deepEqual(possibleDuplicates([rest, bio], calendarContext(2026), prev), [])
  // Ohne Vorjahr, beide mit Beleg: zwei Rechnungen
  assert.deepEqual(possibleDuplicates([{ ...rest, invoiceFile: 'a.pdf' }, { ...bio, invoiceFile: 'b.pdf' }], calendarContext(2026), []), [])
  // Breite Kostenart mit verschiedenen Rechnungen: nichts
  const s1 = item({ period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Wartung Hebeanlage' })
  const s2 = item({ period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Reinigung Dachrinne' })
  assert.deepEqual(possibleDuplicates([s1, s2], calendarContext(2026), []), [])
})

// Zweite Durchsicht: Der Hinweis soll die Ampel nicht dauerhaft färben, wenn es wirklich zwei
// Rechnungen sind. Gemeldet wird nur (a) Beleg neben Position ohne Beleg oder (b) mehr als im
// Vorjahr, mit einer ohne Beleg.
test('Mögliche Doppelung (a): eine mit, eine ohne Beleg, auch wenn das Vorjahr ebenso viele hatte', () => {
  const prev = [item({ period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Restmüll 2025' }), item({ period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Biomüll 2025' })]
  const rest = item({ period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Restmüll 2026' })
  const echt = item({ period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Abfallgebühren', invoiceFile: 'm.pdf' })
  assert.equal(possibleDuplicates([rest, echt], calendarContext(2026), prev).length, 1)
})

test('Mögliche Doppelung (b): mehr als im Vorjahr, eine ohne Beleg, auch ganz ohne Belege', () => {
  const prev = [item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025' })]
  const a = item({ period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Grundsteuer 2026' })
  const b = item({ period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Grundsteuer Nachtrag' })
  assert.equal(possibleDuplicates([a, b], calendarContext(2026), prev).length, 1)
})

test('Mögliche Doppelung: still ohne Vorjahr und ganz ohne Belege', () => {
  const a = item({ period: calendarPeriod(2026), category: 'Sach- und Haftpflichtversicherung', description: 'Gebäudeversicherung' })
  const b = item({ period: calendarPeriod(2026), category: 'Sach- und Haftpflichtversicherung', description: 'Haftpflicht' })
  assert.deepEqual(possibleDuplicates([a, b], calendarContext(2026), []), [])
})

test('Normalisierung: ein zerlegtes „ü“ (NFD, etwa aus macOS-Dateinamen) gilt wie das zusammengesetzte', () => {
  const nfd = 'Müllabfuhr'
  assert.equal(normalizedText(nfd), normalizedText('Müllabfuhr'))
  const x = item({ period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Müllschlucker Wartung' })
  assert.equal(sameCostCandidates([x], { period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Müllschlucker Wartung' }).length, 1)
})

// Befund aus der Update-Matrix gegen 0.10.0-rc.1: Der Hinweis paarte eine Gutschrift (mit Beleg)
// mit der Rechnung derselben Kostenart (ohne Beleg) und riet, „in der Regel die ohne Beleg“ zu
// löschen. Befolgt verschwand die Rechnung, oder umgekehrt die Gutschrift, und die Mieter zahlten
// zu viel. Eine Gutschrift ist nie dieselbe Rechnung wie eine Rechnung.
test('Mögliche Doppelung: eine Gutschrift wird nie mit einer Rechnung gepaart (rc.1)', () => {
  const rechnung = item({ period: calendarPeriod(2026), category: 'Wasser', description: 'Wasser 2026', amountCents: 84000 })
  const gutschrift = item({ period: calendarPeriod(2026), category: 'Wasser', description: 'Gutschrift Wasser', amountCents: -5745, invoiceFile: 'gs.pdf' })
  assert.deepEqual(possibleDuplicates([rechnung, gutschrift], calendarContext(2026), []), [])
  assert.deepEqual(possibleDuplicates([gutschrift, { ...rechnung, invoiceFile: undefined }], calendarContext(2026), [item({ period: calendarPeriod(2025), category: 'Wasser', amountCents: 80000 })]), [])
  // Zwei Gutschriften derselben Art bleiben ein Kandidat, wie bisher.
  const zweite = item({ period: calendarPeriod(2026), category: 'Wasser', description: 'Gutschrift Wasser', amountCents: -5745 })
  assert.deepEqual(possibleDuplicates([rechnung, gutschrift, zweite], calendarContext(2026), []).map((g) => g.map((i) => i.id)), [[gutschrift.id, zweite.id]])
})

test('Kandidaten: mit Betrag gefragt, passt eine Gutschrift nur zu Gutschriften und eine Rechnung nur zu Rechnungen (rc.1)', () => {
  const rechnung = item({ period: calendarPeriod(2026), category: 'Wasser', amountCents: 84000 })
  const gutschrift = item({ period: calendarPeriod(2026), category: 'Wasser', amountCents: -5745 })
  const ask = (amountCents?: number) => sameCostCandidates([rechnung, gutschrift], { period: calendarPeriod(2026), category: 'Wasser', amountCents }).map((i) => i.id)
  assert.deepEqual(ask(-5745), [gutschrift.id])
  assert.deepEqual(ask(84000), [rechnung.id])
  // Ohne Betrag (oder mit 0, etwa bei einem leeren Formularfeld) wie bisher alle.
  assert.deepEqual(ask(), [rechnung.id, gutschrift.id])
  assert.deepEqual(ask(0), [rechnung.id, gutschrift.id])
})

// N1 der Durchsicht von #201: Eine Position mit 0 € (oder ohne Betrag) passt zu Rechnung wie
// Gutschrift und verband beide zu einer Gruppe; der Hinweis riet dann wieder zum Löschen.
test('Mögliche Doppelung: eine Position mit 0 € ist keine Brücke zwischen Gutschrift und Rechnung (N1)', () => {
  const r = item({ period: calendarPeriod(2026), category: 'Wasser', description: 'Wasser', amountCents: 84000 })
  const g = item({ period: calendarPeriod(2026), category: 'Wasser', description: 'Gutschrift', amountCents: -5745, invoiceFile: 'g.pdf' })
  const z = item({ period: calendarPeriod(2026), category: 'Wasser', description: 'Schätzung', amountCents: 0 })
  for (const order of [[r, g, z], [z, r, g], [g, z, r], [r, z, g]]) {
    for (const group of possibleDuplicates(order, calendarContext(2026), [])) {
      const ids = group.map((i) => i.id)
      assert.ok(!(ids.includes(r.id) && ids.includes(g.id)), `Gutschrift und Rechnung in einer Gruppe: ${ids.join(', ')}`)
    }
  }
  const zNull = { ...z, amountCents: undefined }
  for (const group of possibleDuplicates([r, zNull, g], calendarContext(2026), [])) {
    const ids = group.map((i) => i.id)
    assert.ok(!(ids.includes(r.id) && ids.includes(g.id)), ids.join(', '))
  }
})

test('Doppelungen: nur innerhalb eines Zeitraums, der Vorzeitraum nach Schlüssel (#208)', () => {
  const mai: PeriodRules = { startMonth: 5, changes: [] }
  const at = periodContext(mai, periodOfKey(mai, periodKey('2025-05')) ?? assert.fail('kein Zeitraum'))
  const a = item({ period: periodKey('2025-05'), category: 'Grundsteuer', description: 'Grundsteuer 2025' })
  const b = item({ period: periodKey('2025-05'), category: 'Grundsteuer', description: 'Grundsteuer Nachtrag' })
  const fremd = item({ period: periodKey('2025-01'), category: 'Grundsteuer', description: 'Grundsteuer 2025' })
  const vorjahr = [item({ period: periodKey('2024-05'), category: 'Grundsteuer', description: 'Grundsteuer 2024' })]
  assert.deepEqual(possibleDuplicates([a, b, fremd], at, vorjahr).map((g) => g.map((i) => i.id)), [[a.id, b.id]])
})

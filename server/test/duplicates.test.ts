// Doppelte Kostenpositionen (Zusammenspiel #141 und #170): Wann gilt eine Position als dieselbe
// Rechnung wie eine schon erfasste? Dieselbe Regel fragen „Aus dem Vorjahr übernehmen“, die
// Schnellerfassung, die KI-Auswertung der Kostenseite, der Posteingang und der Hinweis der
// Abrechnung (shared/duplicates.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { possibleDuplicates, sameCostCandidates, type DuplicateItem } from '../../shared/duplicates.ts'

let n = 0
const item = (over: Partial<DuplicateItem> & Pick<DuplicateItem, 'year' | 'category'>): DuplicateItem => ({
  id: `k${++n}`, description: over.category, amountCents: 10000, ...over,
})

test('Kandidaten: dasselbe Jahr und dieselbe Kostenart, bei einer gewöhnlichen Kostenart gleich welche Beschreibung', () => {
  const schaetzung = item({ year: 2026, category: 'Grundsteuer', description: 'Grundsteuer 2026' })
  const items = [
    schaetzung,
    item({ year: 2025, category: 'Grundsteuer', description: 'Grundsteuer 2025' }),
    item({ year: 2026, category: 'Müllabfuhr', description: 'Grundsteuer' }),
  ]
  // So beschreibt die KI einen Bescheid: kein Wort gleich der Vorlage.
  const found = sameCostCandidates(items, { year: 2026, category: 'Grundsteuer', description: 'Abgabenbescheid Stadt Musterstadt Q1–Q4' })
  assert.deepEqual(found.map((i) => i.id), [schaetzung.id])
})

test('Kandidaten: bei einer breiten Kostenart nur mit ähnlicher Beschreibung oder gleichem Rechnungssteller', () => {
  const hebe = item({ year: 2026, category: 'Sonstige Betriebskosten', description: 'Wartung Hebeanlage 2026', vendor: 'Pumpen Huber GmbH' })
  const items = [hebe]
  const ask = (description: string, vendor?: string) =>
    sameCostCandidates(items, { year: 2026, category: 'Sonstige Betriebskosten', description, vendor }).map((i) => i.id)
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
  const verwalter = item({ year: 2026, category: 'Nicht umlagefähig', description: 'Verwaltergebühr' })
  const items = [verwalter]
  assert.deepEqual(sameCostCandidates(items, { year: 2026, category: 'Nicht umlagefähig', description: 'Reparatur Heizung' }), [])
  assert.deepEqual(sameCostCandidates(items, { year: 2026, category: 'Nicht umlagefähig', description: 'Verwaltergebühr 2026' }).map((i) => i.id), [verwalter.id])
})

test('Kandidaten: anderes Objekt und die Position selbst zählen nicht', () => {
  const a = { ...item({ year: 2026, category: 'Grundsteuer' }), propertyId: 'p1' }
  const b = { ...item({ year: 2026, category: 'Grundsteuer' }), propertyId: 'p2' }
  assert.deepEqual(sameCostCandidates([a, b], { propertyId: 'p1', year: 2026, category: 'Grundsteuer' }).map((i) => i.id), [a.id])
  assert.deepEqual(sameCostCandidates([a, b], { propertyId: 'p1', year: 2026, category: 'Grundsteuer', excludeId: a.id }), [])
})

test('Mögliche Doppelung: zwei Positionen einer Kostenart, eine ohne Beleg, mehr als im Vorjahr', () => {
  const schaetzung = item({ year: 2026, category: 'Grundsteuer', description: 'Grundsteuer 2026', amountCents: 61000 })
  const echt = item({ year: 2026, category: 'Grundsteuer', description: 'Grundsteuerbescheid', amountCents: 61240, invoiceFile: 'gs.pdf' })
  const vorjahr = [item({ year: 2025, category: 'Grundsteuer', description: 'Grundsteuer 2025' })]
  const groups = possibleDuplicates([schaetzung, echt], 2026, vorjahr)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0]?.map((i) => i.id), [schaetzung.id, echt.id])
})

test('Mögliche Doppelung: nicht, wenn alle einen Beleg haben, und nicht, wenn das Vorjahr ebenso viele hatte', () => {
  const rest = item({ year: 2026, category: 'Müllabfuhr', description: 'Restmüll 2026' })
  const bio = item({ year: 2026, category: 'Müllabfuhr', description: 'Biomüll 2026' })
  const prev = [item({ year: 2025, category: 'Müllabfuhr', description: 'Restmüll 2025' }), item({ year: 2025, category: 'Müllabfuhr', description: 'Biomüll 2025' })]
  // Aus dem Vorjahr übernommen, beide noch ohne Beleg: Das ist die Gliederung des Hauses.
  assert.deepEqual(possibleDuplicates([rest, bio], 2026, prev), [])
  // Ohne Vorjahr, beide mit Beleg: zwei Rechnungen
  assert.deepEqual(possibleDuplicates([{ ...rest, invoiceFile: 'a.pdf' }, { ...bio, invoiceFile: 'b.pdf' }], 2026, []), [])
  // Breite Kostenart mit verschiedenen Rechnungen: nichts
  const s1 = item({ year: 2026, category: 'Sonstige Betriebskosten', description: 'Wartung Hebeanlage' })
  const s2 = item({ year: 2026, category: 'Sonstige Betriebskosten', description: 'Reinigung Dachrinne' })
  assert.deepEqual(possibleDuplicates([s1, s2], 2026, []), [])
})

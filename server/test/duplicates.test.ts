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

// #96 PR 1: Entnahmen aus der Rücklage sind wie „Nicht umlagefähig“ oft mehrere Maßnahmen im Jahr (Dach, Fassade).
test('Kandidaten: „Entnahme Erhaltungsrücklage“ gilt als breite Kostenart', () => {
  const dach = item({ period: calendarPeriod(2026), category: 'Entnahme Erhaltungsrücklage', description: 'Dachsanierung' })
  assert.deepEqual(sameCostCandidates([dach], { period: calendarPeriod(2026), category: 'Entnahme Erhaltungsrücklage', description: 'Fassadenanstrich' }), [])
  assert.deepEqual(sameCostCandidates([dach], { period: calendarPeriod(2026), category: 'Entnahme Erhaltungsrücklage', description: 'Dachsanierung 2026' }).map((i) => i.id), [dach.id])
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

// #455: Eine Rechnung, die auf zwei Teile im selben Zeitraum verteilt steht (aus Beständen vor der Quellrechnung, mit
// abweichender Verteilung je Teil), ist eine Rechnung. Ihre Teile melden einander nicht, und im Vergleich mit dem
// Vorjahr zählen die Teile einer Quelle als eine Rechnung, auf beiden Seiten.
test('Teile derselben Quelle im selben Zeitraum melden einander nicht und zählen im Vergleich mit dem Vorjahr als eine', () => {
  const p = calendarPeriod(2026)
  const teil1 = item({ period: p, category: 'Grundsteuer', description: 'Grundsteuer (anteilig)', sourceId: 'q1', amountCents: 12000 })
  const teil2 = item({ period: p, category: 'Grundsteuer', description: 'Grundsteuer (anteilig)', sourceId: 'q1', amountCents: 24500 })
  const vorjahr = [item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025' })]
  // Ohne Beleg, mit Vorjahr: früher „mehr als im Vorjahr“, jetzt eine Rechnung wie im Vorjahr
  assert.deepEqual(possibleDuplicates([teil1, teil2], calendarContext(2026), vorjahr), [])
  // Einer der Teile trägt den Beleg: Die Rechnung ist belegt, kein Paar „mit und ohne Beleg“
  assert.deepEqual(possibleDuplicates([{ ...teil1, invoiceFile: 'gs.pdf' }, teil2], calendarContext(2026), vorjahr), [])
  // Eine zweite Position daneben bleibt eine mögliche Doppelung, gemeldet mit allen Teilen
  const schaetzung = item({ period: p, category: 'Grundsteuer', description: 'Grundsteuer 2026' })
  assert.deepEqual(possibleDuplicates([teil1, teil2, schaetzung], calendarContext(2026), vorjahr).map((g) => g.map((i) => i.id)),
    [[teil1.id, teil2.id, schaetzung.id]])
  // Im Vorjahr zwei Teile einer Quelle sind eine Rechnung: Zwei Rechnungen jetzt sind mehr
  const vorjahrTeile = [
    item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025', sourceId: 'q0' }),
    item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025', sourceId: 'q0' }),
  ]
  assert.equal(possibleDuplicates([teil1, schaetzung], calendarContext(2026), vorjahrTeile).length, 1)
})

// #721: Unter „Heizung und Warmwasser“ stehen regelmäßig mehrere Rechnungen im Jahr (Brennstoff, Wartung,
// Schornsteinfeger, Betriebsstrom). Die Rückfrage kam bei „Wartung Ölheizung“ 260,00 € gegen „Heizöl 2.300 Liter“
// 2.185,00 €. Still ist sie nur, wenn nichts die beiden verbindet: anderer Betrag, andere Beschreibung, kein gemeinsamer
// Rechnungssteller, nicht derselbe Teil der Heizkosten. Jede andere Kostenart fragt wie bisher.
const HEIZUNG = 'Heizung und Warmwasser'
test('#721 Kandidaten: Heizung mit anderem Betrag, anderer Beschreibung und ohne gemeinsamen Rechnungssteller ist keine Doppelung', () => {
  const P = calendarPeriod(2026)
  const oel = item({ period: P, category: HEIZUNG, description: 'Heizöl 2.300 Liter', amountCents: 218500 })
  const ask = (q: Partial<Parameters<typeof sameCostCandidates>[1]>) => sameCostCandidates([oel], { period: P, category: HEIZUNG, ...q }).map((i) => i.id)
  assert.deepEqual(ask({ description: 'Wartung Ölheizung', amountCents: 26000 }), [])
  // Derselbe Betrag fällt weiter auf, gleich wie die Position heißt: dieselbe Rechnung zweimal.
  assert.deepEqual(ask({ description: 'Tankfüllung', amountCents: 218500 }), [oel.id])
  // Ähnliche Beschreibung (die Schätzung aus dem Vorjahr gegen die Rechnung) fällt weiter auf, auch mit anderem Betrag.
  assert.deepEqual(ask({ description: 'Heizöl', amountCents: 200000 }), [oel.id])
  // Ohne Betrag gefragt (Belegbuchung, Posteingang) bleibt es bei der bisherigen Regel.
  assert.deepEqual(ask({ description: 'Wartung Ölheizung' }), [oel.id])
  assert.deepEqual(ask({ description: 'Wartung Ölheizung', amountCents: 0 }), [oel.id])
  // Gemeinsamer Rechnungssteller oder derselbe Teil der Heizkosten verbindet.
  const mitSteller = { ...oel, vendor: 'Brennstoffe Huber GmbH' }
  assert.deepEqual(sameCostCandidates([mitSteller], { period: P, category: HEIZUNG, description: 'Lieferung HEL', vendor: 'Brennstoffe Huber', amountCents: 150000 }).map((i) => i.id), [oel.id])
  const brennstoff = { ...oel, heatingPart: 'fuel' as const }
  assert.deepEqual(sameCostCandidates([brennstoff], { period: P, category: HEIZUNG, description: 'Lieferung HEL', heatingPart: 'fuel', amountCents: 150000 }).map((i) => i.id), [oel.id])
  assert.deepEqual(sameCostCandidates([brennstoff], { period: P, category: HEIZUNG, description: 'Wartung', heatingPart: 'operating', amountCents: 26000 }), [])
})

test('#721 Kandidaten: die Ausnahme gilt nur für die Heizung, die Grundsteuer fragt weiter bei anderem Betrag und anderer Beschreibung', () => {
  const P = calendarPeriod(2026)
  const schaetzung = item({ period: P, category: 'Grundsteuer', description: 'Grundsteuer 2026', amountCents: 61000 })
  assert.deepEqual(sameCostCandidates([schaetzung], { period: P, category: 'Grundsteuer', description: 'Abgabenbescheid Stadt Musterstadt Q1–Q4', amountCents: 61240 }).map((i) => i.id), [schaetzung.id])
})

// #721: Drei Wartungsrechnungen über je 145,00 €, jede einer anderen Wohnung direkt zugeordnet (Thermen je Wohnung), sind
// drei Rechnungen. Dieselbe Wohnung, oder eine Seite ohne Direktzuordnung, fragt weiter.
test('#721 Kandidaten: Direktzuordnung an verschiedene Wohnungen ist keine Doppelung, an dieselbe schon', () => {
  const P = calendarPeriod(2026)
  const eg = { ...item({ period: P, category: HEIZUNG, description: 'Wartung Therme', amountCents: 14500 }), key: 'direct' as const, directUnitId: 'eg' }
  const ask = (q: Partial<Parameters<typeof sameCostCandidates>[1]>) => sameCostCandidates([eg], { period: P, category: HEIZUNG, description: 'Wartung Therme', amountCents: 14500, ...q }).map((i) => i.id)
  assert.deepEqual(ask({ key: 'direct', directUnitId: 'og' }), [])
  assert.deepEqual(ask({ key: 'direct', directUnitId: 'eg' }), [eg.id])
  assert.deepEqual(ask({ key: 'area' }), [eg.id])
  assert.deepEqual(ask({}), [eg.id])
  // Auch bei jeder anderen Kostenart: Der Bescheid je Wohnung ist je eine Rechnung.
  const steuer = { ...item({ period: P, category: 'Grundsteuer', amountCents: 30000 }), key: 'direct' as const, directUnitId: 'eg' }
  assert.deepEqual(sameCostCandidates([steuer], { period: P, category: 'Grundsteuer', amountCents: 30000, key: 'direct', directUnitId: 'og' }), [])
})

test('#721 Mögliche Doppelung: drei Wartungen an drei Wohnungen bleiben still, zwei an derselben Wohnung melden sich', () => {
  const P = calendarPeriod(2026)
  const wartung = (unit: string, over: Partial<DuplicateItem> = {}) => ({ ...item({ period: P, category: HEIZUNG, description: `Wartung Therme ${unit}`, amountCents: 14500, ...over }), key: 'direct' as const, directUnitId: unit })
  const vorjahr = [item({ period: calendarPeriod(2025), category: HEIZUNG, description: 'Wartung Therme EG', amountCents: 14000 })]
  const drei = [wartung('EG', { invoiceFile: 'a.pdf' }), wartung('OG'), wartung('DG')]
  assert.deepEqual(possibleDuplicates(drei, calendarContext(2026), vorjahr), [])
  const doppelt = [wartung('EG', { invoiceFile: 'a.pdf' }), wartung('EG'), wartung('OG')]
  assert.deepEqual(possibleDuplicates(doppelt, calendarContext(2026), vorjahr).map((g) => g.map((i) => i.id)), [[doppelt[0]?.id, doppelt[1]?.id]])
  // Heizöl mit Beleg und Wartung ohne: zwei Rechnungen, kein Hinweis.
  const oel = item({ period: P, category: HEIZUNG, description: 'Heizöl 2.300 Liter', amountCents: 218500, invoiceFile: 'oel.pdf' })
  const service = item({ period: P, category: HEIZUNG, description: 'Wartung Ölheizung', amountCents: 26000 })
  assert.deepEqual(possibleDuplicates([oel, service], calendarContext(2026), []), [])
})

// Durchsicht von #721 (M2): Die erste Fassung von `distinctHeating` schwieg schon, wenn Betrag und Beschreibung abwichen.
// Damit blieben Abschläge gegen Jahresrechnung, dieselbe Rechnung mit einem Cent Unterschied oder brutto gegen netto und
// die Schätzung aus dem Vorjahr gegen die Rechnung still. Still ist es jetzt nur, wenn erkennbar verschiedene Arten von
// Heizkosten dastehen: zwei bekannte, verschiedene Teile der Heizkosten oder Beschreibungen verschiedener Art.
test('#721 Kandidaten: zwei Brennstoffrechnungen fragen immer, verschiedene Arten von Heizkosten bleiben still', () => {
  const P = calendarPeriod(2026)
  const ask = (vorhanden: Partial<DuplicateItem>, q: Partial<Parameters<typeof sameCostCandidates>[1]>) =>
    sameCostCandidates([item({ period: P, category: HEIZUNG, ...vorhanden })], { period: P, category: HEIZUNG, ...q }).length > 0
  // Abschläge gegen Jahresrechnung, kein Rechnungssteller.
  assert.equal(ask({ description: 'Gas Abschläge', amountCents: 165000 }, { description: 'Jahresrechnung Gas', amountCents: 182000 }), true)
  // Dieselbe Rechnung, ein Cent Unterschied im Betrag.
  assert.equal(ask({ description: 'Gasrechnung', amountCents: 180000 }, { description: 'Erdgas Jahresabrechnung', amountCents: 180001 }), true)
  // Dieselbe Rechnung brutto und netto, verschieden beschrieben.
  assert.equal(ask({ description: 'Heizöl 2300 l', amountCents: 218500 }, { description: 'Öllieferung', amountCents: 183613 }), true)
  // Die Schätzung aus dem Vorjahr gegen die Rechnung; der Steller steht nur an der Rechnung.
  assert.equal(ask({ description: 'Gas', amountCents: 170000 }, { description: 'Erdgas Jahresrechnung', vendor: 'Stadtwerke', amountCents: 182000 }), true)
  // Unbekannte Art auf einer Seite fragt.
  assert.equal(ask({ description: 'Abschläge', amountCents: 165000 }, { description: 'Wartung Brenner', amountCents: 26000 }), true)
  // Der ursprüngliche Anlass von #721 a bleibt still, ebenso zwei verschiedene Arten, die kein Brennstoff sind.
  assert.equal(ask({ description: 'Heizöl 2.300 Liter', amountCents: 218500 }, { description: 'Wartung Ölheizung', amountCents: 26000 }), false)
  assert.equal(ask({ description: 'Schornsteinfeger', amountCents: 9800 }, { description: 'Wartung Therme', amountCents: 26000 }), false)
  assert.equal(ask({ description: 'Messdienst Ablesung', amountCents: 31000 }, { description: 'Erdgas', amountCents: 182000 }), false)
  // Zwei Positionen derselben Art fragen, auch wenn sie keine Brennstoffe sind.
  assert.equal(ask({ description: 'Wartung Brenner', amountCents: 26000 }, { description: 'Thermenwartung', amountCents: 19000 }), true)
  // Bekannte, verschiedene Teile der Heizkosten trennen auch bei unbekannter Beschreibung.
  assert.equal(ask({ description: 'Rechnung 1', amountCents: 165000, heatingPart: 'fuel' }, { description: 'Rechnung 2', amountCents: 26000, heatingPart: 'operating' }), false)
  // Drei Thermenwartungen per Direktzuordnung an drei Wohnungen bleiben still.
  const wartungen = ['eg', 'og', 'dg'].map((u) => ({ ...item({ period: P, category: HEIZUNG, description: 'Wartung Therme', amountCents: 14500 }), key: 'direct' as const, directUnitId: u }))
  assert.deepEqual(sameCostCandidates(wartungen.slice(0, 2), { period: P, category: HEIZUNG, description: 'Wartung Therme', amountCents: 14500, key: 'direct', directUnitId: 'dg' }), [])
})

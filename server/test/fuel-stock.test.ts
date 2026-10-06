// Brennstoffvorrat (Heizung PR 8, Entwurf 8.2, 12.2 „fuel.test.ts“ zum Öl, 12.3 Nr. 5): Bewertung nach
// Minol, Rundung je Posten, Altbestand vor 2023, Prüfungen, Kette und eingefrorener Endbestand.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { measuredOffset, problemText, readFrozenStock, stockOf, type StockDeliveryInput, type StockOptions, type StockPeriodInput } from '../src/fuelStock.ts'
import { periodKey } from '../../shared/period.ts'
import type { StockValue } from '../../shared/types.ts'

// § 11 Abs. 2 Satz 2 CO2KostAufG wie im Register: Rechnungen bis 31.12.2022 zählen nicht.
const OPTS: StockOptions = {
  needCost: true, needCo2: true, countedAt: (d) => d >= '2023-01-01', excludedUntil: '2022-12-31', countedFrom: '2023-01-01',
}
const lieferung = (over: Partial<StockDeliveryInput> & Pick<StockDeliveryInput, 'id' | 'date'>): StockDeliveryInput => ({
  label: `Lieferung ${over.date}`, invoiceDate: over.date, quantity: null, quantityUnit: 'l', costCents: null, emissionsKg: null, co2Cents: null, ...over,
})
// Beispiel Heizöl (Entwurf 8.2): kg der Lieferung vom 10.10. exakt 6.690,75 (G-D2).
const M = lieferung({ id: 'd1', date: '2025-03-15', quantity: 3000, costCents: 315000, emissionsKg: 8028.9, co2Cents: 52549 })
const O = lieferung({ id: 'd2', date: '2025-10-10', quantity: 2500, costCents: 250000, emissionsKg: 6690.75, co2Cents: 43791 })
const periode = (over: Partial<StockPeriodInput> = {}): StockPeriodInput => ({
  key: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', unit: 'l',
  ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, invoicedBefore2023: true },
  closingQuantity: 1800, closingMeasuredOn: '2025-12-31', deliveries: [M, O], laterDeliveries: [], frozenClosing: null, ...over,
})
const ok = (r: ReturnType<typeof stockOf>) => (r.ok ? r.statement : assert.fail(`kein Ergebnis: ${problemText(r.problem)}`))

test('Heizöl (Entwurf 8.2): 5.750,00 € verbraucht, 5.650,00 € bezahlt, E 15.254,91 kg, C 648,10 €, Endbestand 1.800 € / 4.817,34 kg / 315,30 €', () => {
  const s = ok(stockOf([periode()], OPTS))
  assert.deepEqual(s.consumed, { quantity: 5700, costCents: 575000, emissionsKg: 15254.91, co2Cents: 64810 })
  assert.equal(s.paidCents, 565000)
  assert.deepEqual([s.closing.quantity, s.closing.costCents, s.closing.emissionsKg, s.closing.co2Cents], [1800, 180000, 4817.34, 31530])
  // Der Endbestand stammt ganz aus der jüngsten Lieferung ([M] Minol).
  assert.deepEqual(s.closing.layers.map((l) => l.label), ['Lieferung 2025-10-10'])
  // Der Altbestand (Rechnung 2022) hebt mit seinen kg die Stufe, trägt aber keine CO₂-Kosten.
  assert.equal(s.oldStockKg, 5352.6)
  assert.equal(s.openingSource, 'own')
  // Spezifischer Wert bei 300 m²: 50,8497 → 50,8 (Einstufung in co2.ts, § 5 Abs. 1 Satz 3).
  assert.equal(Math.round((s.consumed.emissionsKg / 300) * 10) / 10, 50.8)
})

test('Älteste zuerst: Ein Endbestand größer als die jüngste Lieferung reicht in die vorige, je Teil gerundet', () => {
  const s = ok(stockOf([periode({ closingQuantity: 3000 })], OPTS))
  // 2.500 l aus der Lieferung vom 10.10. ganz, 500 l aus der vom 15.03.: 1/6 von 3.150 € / 8.028,9 kg / 525,49 €.
  assert.deepEqual(s.closing.layers.map((l) => [l.label, l.quantity, l.costCents, l.emissionsKg, l.co2Cents]), [
    ['Lieferung 2025-03-15', 500, 52500, 1338.15, 8758],
    ['Lieferung 2025-10-10', 2500, 250000, 6690.75, 43791],
  ])
  assert.equal(s.consumed.costCents, 755000 - 302500)
  assert.equal(s.consumed.co2Cents, 52549 + 43791 - 8758 - 43791)
})

test('Jahr ohne Lieferung: Verbrauch nur aus dem Vorrat, bezahlt 0 €', () => {
  const vorrat: StockPeriodInput = periode({ key: periodKey('2026-01'), label: '2026', from: '2026-01-01', to: '2026-12-31', ownOpening: null, deliveries: [], closingQuantity: 900, closingMeasuredOn: '2026-12-31' })
  const s = ok(stockOf([periode(), vorrat], OPTS))
  assert.equal(s.openingSource, 'previous')
  assert.deepEqual(s.consumed, { quantity: 900, costCents: 90000, emissionsKg: 2408.67, co2Cents: 15765 })
  assert.equal(s.paidCents, 0)
})

test('Prüfungen: Endbestand zu groß, andere Einheit, fehlende Angaben, jeweils mit Satz', () => {
  const zuGross = stockOf([periode({ closingQuantity: 7600 })], OPTS)
  assert.ok(!zuGross.ok && zuGross.problem.kind === 'invalid')
  assert.match(problemText(zuGross.problem), /Endbestand von 7\.600 l ist größer als Anfangsbestand und Lieferungen zusammen \(7\.500 l\)/)
  const kg = stockOf([periode({ deliveries: [M, { ...O, quantityUnit: 'kg' }] })], OPTS)
  assert.ok(!kg.ok && kg.problem.kind === 'invalid')
  assert.match(problemText(kg.problem), /Lieferung „Lieferung 2025-10-10“ ist in kg erfasst, der Vorrat in l/)
  const ohneEnde = stockOf([periode({ closingQuantity: null })], OPTS)
  assert.ok(!ohneEnde.ok && ohneEnde.problem.kind === 'missing')
  assert.deepEqual(ohneEnde.problem.what, ['der Endbestand'])
  const ohneFrage = stockOf([periode({ ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 0, invoicedBefore2023: null } })], OPTS)
  assert.ok(!ohneFrage.ok)
  assert.match(problemText(ohneFrage.problem), /ob der Anfangsbestand vor dem 01\.01\.2023 in Rechnung gestellt wurde/)
  const ohneBetrag = stockOf([periode({ deliveries: [M, { ...O, costCents: null }] })], OPTS)
  assert.ok(!ohneBetrag.ok)
  assert.match(problemText(ohneBetrag.problem), /hat keinen Betrag/)
  // Messdienst ohne Aufteilung: Beträge dürfen fehlen, dann ist auch das Bezahlte unbekannt.
  const messdienst = ok(stockOf([periode({ deliveries: [M, { ...O, costCents: null }] })], { ...OPTS, needCost: false }))
  assert.deepEqual([messdienst.paidCents, messdienst.consumed.costCents, messdienst.consumed.co2Cents], [null, null, 64810])
  // Pellets: keine CO₂-Aufteilung, kg und CO₂-Kosten dürfen fehlen.
  const pellets = ok(stockOf([periode({ unit: 'kg', ownOpening: { quantity: 1000, costCents: 30000, emissionsKg: null, co2Cents: null, invoicedBefore2023: null }, deliveries: [lieferung({ id: 'p', date: '2025-09-01', quantity: 4000, quantityUnit: 'kg', costCents: 120000 })], closingQuantity: 1500 })], { ...OPTS, needCo2: false }))
  assert.deepEqual([pellets.consumed.quantity, pellets.consumed.costCents], [3500, 105000])
})

test('Bestand aus 2022: CO₂-Kosten 0 € trotz Betrag laut Rechnung, kg zählen (§ 11 Abs. 2 Satz 2)', () => {
  const s = ok(stockOf([periode({ ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 6000, invoicedBefore2023: true }, deliveries: [], closingQuantity: 500 })], OPTS))
  assert.equal(s.consumed.co2Cents, 0)
  assert.equal(s.consumed.emissionsKg, 4014.45)
  assert.equal(s.oldStockKg, 4014.45)
  // Dieselbe Menge mit Rechnung ab 2023: CO₂-Kosten zählen anteilig.
  const neu = ok(stockOf([periode({ ownOpening: { quantity: 2000, costCents: 190000, emissionsKg: 5352.6, co2Cents: 6000, invoicedBefore2023: false }, deliveries: [], closingQuantity: 500 })], OPTS))
  assert.equal(neu.consumed.co2Cents, 4500)
})

test('Kette: eingefrorener Endbestand der Vorperiode gilt, ein Fehler der Vorperiode nennt die Vorperiode', () => {
  const vorher = ok(stockOf([periode()], OPTS)).closing
  const eingefroren: StockValue = JSON.parse(JSON.stringify(vorher))
  const folge = periode({ key: periodKey('2026-01'), label: '2026', from: '2026-01-01', to: '2026-12-31', ownOpening: null, deliveries: [], closingQuantity: 900 })
  const s = ok(stockOf([periode({ frozenClosing: eingefroren }), folge], OPTS))
  assert.equal(s.openingSource, 'frozen')
  assert.deepEqual(s.opening, vorher)
  const kaputt = stockOf([periode({ closingQuantity: 9000 }), folge], OPTS)
  assert.ok(!kaputt.ok && kaputt.problem.period === '2025')
  // Die Einheit wechselt zwischen den Perioden: kein stilles Umrechnen.
  const wechsel = stockOf([periode(), { ...folge, unit: 'kg' }], OPTS)
  assert.ok(!wechsel.ok)
  assert.match(problemText(wechsel.problem), /Vorrat der Vorperiode ist in l geführt, dieser in kg/)
})

test('Eingefrorener Endbestand: gelesen, wie er geschrieben wurde; Krummes ist keiner', () => {
  const closing = ok(stockOf([periode()], OPTS)).closing
  assert.deepEqual(readFrozenStock(JSON.parse(JSON.stringify(closing))), closing)
  assert.equal(readFrozenStock(null), null)
  assert.equal(readFrozenStock({ layers: 'x' }), null)
  assert.equal(readFrozenStock({ layers: [{ label: 'a', date: null, quantity: '1', costCents: 1, emissionsKg: 1, co2Cents: 1, co2Counted: true }] }), null)
})

test('Peilung neben dem Ende (Review Focus 1): Tage und Lieferungen, die die Peilung nicht oder schon enthält', () => {
  const frueh = measuredOffset(periode({ closingMeasuredOn: '2025-12-20', deliveries: [M, O, lieferung({ id: 'd3', date: '2025-12-28', quantity: 1000 })] }))
  assert.deepEqual(frueh, { days: 11, range: { from: '2025-12-21', to: '2025-12-31' }, after: false, deliveries: [{ label: 'Lieferung 2025-12-28', date: '2025-12-28' }] })
  const spaet = measuredOffset(periode({ closingMeasuredOn: '2026-01-05', laterDeliveries: [{ label: 'Lieferung 2026-01-02', date: '2026-01-02' }] }))
  assert.deepEqual(spaet, { days: 5, range: { from: '2026-01-01', to: '2026-01-05' }, after: true, deliveries: [{ label: 'Lieferung 2026-01-02', date: '2026-01-02' }] })
  assert.equal(measuredOffset(periode()), null)
  assert.equal(measuredOffset(periode({ closingMeasuredOn: null })), null)
})

// Fester Startwert: jeder Lauf prüft dieselben Ketten.
function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

test('Invariante (Entwurf 12.3 Nr. 5): Über eine Folge eingefrorener und offener Perioden wird jede Lieferung genau einmal verbraucht', () => {
  const rnd = zufall(20261005)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let lauf = 0; lauf < 200; lauf++) {
    const n = int(1, 4)
    let vorrat = int(0, 3000)
    const start = { quantity: vorrat, costCents: vorrat * int(80, 120), emissionsKg: Math.round(vorrat * 267.6) / 100, co2Cents: int(0, 30000), invoicedBefore2023: rnd() < 0.5 }
    const perioden: StockPeriodInput[] = []
    let rein = { q: start.quantity, cost: start.costCents, kg: start.emissionsKg, co2: start.invoicedBefore2023 ? 0 : start.co2Cents }
    for (let i = 0; i < n; i++) {
      const jahr = 2023 + i
      const deliveries = Array.from({ length: int(0, 2) }, (_, k) => {
        const q = int(500, 4000)
        const d = lieferung({ id: `d${i}-${k}`, date: `${jahr}-0${k + 3}-15`, quantity: q, costCents: q * int(80, 130), emissionsKg: Math.round(q * 267.63) / 100, co2Cents: int(5000, 60000) })
        rein = { q: rein.q + q, cost: rein.cost + (d.costCents ?? 0), kg: rein.kg + (d.emissionsKg ?? 0), co2: rein.co2 + (d.co2Cents ?? 0) }
        return d
      })
      vorrat = vorrat + deliveries.reduce((a, d) => a + (d.quantity ?? 0), 0)
      const ende = int(0, vorrat)
      vorrat = ende
      perioden.push(periode({ key: periodKey(`${jahr}-01`), label: String(jahr), from: `${jahr}-01-01`, to: `${jahr}-12-31`, ownOpening: i === 0 ? start : null, deliveries, closingQuantity: ende }))
    }
    // Jede Periode einzeln rechnen; eine zufällig gewählte davor einfrieren, wie nach einem Abschluss.
    let verbraucht = { q: 0, cost: 0, kg: 0, co2: 0 }
    let letzter: StockValue | null = null
    for (let i = 0; i < n; i++) {
      const kette = perioden.slice(0, i + 1).map((p, k) => (k < i && rnd() < 0.5 && k === i - 1 && letzter ? { ...p, frozenClosing: JSON.parse(JSON.stringify(letzter)) } : p))
      const s = ok(stockOf(kette, OPTS))
      verbraucht = { q: verbraucht.q + s.consumed.quantity, cost: verbraucht.cost + (s.consumed.costCents ?? 0), kg: verbraucht.kg + s.consumed.emissionsKg, co2: verbraucht.co2 + s.consumed.co2Cents }
      letzter = s.closing
    }
    const fall = `Lauf ${lauf}: ${JSON.stringify({ n, start })}`
    if (!letzter) assert.fail(fall)
    assert.ok(Math.abs(verbraucht.q + letzter.quantity - rein.q) < 1e-6, `${fall}: Menge`)
    assert.equal(verbraucht.cost + (letzter.costCents ?? 0), rein.cost, `${fall}: Betrag`)
    assert.ok(Math.abs(verbraucht.kg + letzter.emissionsKg - rein.kg) < 0.005 * (n + 1), `${fall}: kg`)
    assert.equal(verbraucht.co2 + letzter.co2Cents, rein.co2, `${fall}: CO₂-Kosten`)
  }
})

test('Folgeperiode abgeschlossen (G-A4): ihr eingefrorener Anfangsbestand ist hier der Endbestand, auch wenn sich die Beträge seither geändert haben', () => {
  const vorher = ok(stockOf([periode()], OPTS)).closing
  const eingefroren: StockValue = JSON.parse(JSON.stringify(vorher))
  // Die Rechnung der Lieferung vom 10.10. ist nach dem Abschluss der Folgeperiode berichtigt worden.
  const teurer = { ...O, costCents: 260000 }
  const s = ok(stockOf([periode({ deliveries: [M, teurer], nextFrozenOpening: eingefroren })], OPTS))
  assert.equal(s.closingFrozen, true)
  assert.deepEqual(s.closing, vorher)
  // Verbraucht ist, was hereinkam, minus was die Folgeperiode übernommen hat: 100 € mehr als vorher.
  assert.equal(s.consumed.costCents, 575000 + 10000)
  // Ohne Endbestand gilt der übernommene; eine Peilung fehlt dann nicht.
  assert.ok(stockOf([periode({ closingQuantity: null, nextFrozenOpening: eingefroren })], OPTS).ok)
  // Mehr übernommen, als es gab: ein Fehler mit Satz.
  const teil = eingefroren.layers[0] ?? assert.fail('kein Teil')
  const zuViel = stockOf([periode({ deliveries: [M], nextFrozenOpening: { ...eingefroren, layers: [{ ...teil, quantity: 9000 }] } })], OPTS)
  assert.ok(!zuViel.ok)
  assert.match(problemText(zuViel.problem), /den die abgeschlossene Folgeperiode übernommen hat/)
})

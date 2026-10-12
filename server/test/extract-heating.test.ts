// Was die KI-Auswertung aus der Antwort eines Modells zu einer Messdienstabrechnung und einer
// Lieferantenrechnung übernimmt (Heizung PR 20, #103). Geprüft wird das Einengen an der einen Grenze je
// Belegart, nicht der Weg zum Anbieter (api-ki-heizung.test.ts) und nicht die Lesefähigkeit eines Modells
// (KI-Prüflauf).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FUEL_PROMPT, FUEL_SCHEMA, SERVICE_PROMPT, SERVICE_SCHEMA, toFuelExtraction, toServiceExtraction } from '../src/extractHeating.ts'
import { EXTRACT_CATEGORIES } from '../src/extract.ts'

const service = {
  vendor: 'Wärmedienst Beispiel GmbH',
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  unitsCount: 4,
  usersTotalEur: '3.944,50',
  deductionEur: -87.5,
  fuelGrossEur: 3540,
  fuelNetEur: '3.452,50',
  co2: { emissionsKg: 4456.4, areaM2: 194.6, kgPerM2: 22.9, landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 },
  dhwMethod: 'volumeFormula',
  blocks: [
    {
      title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 3944.5,
      lines: [
        { label: 'Mustermann, Erika', unitLabel: 'EG links', from: '2025-01-01', to: '2025-12-31', amountEur: 1180.25, vacancy: false },
        { label: 'Leerstand', unitLabel: 'EG rechts', from: null, to: null, amountEur: '702,10', vacancy: true },
        { label: 'Beispiel, Max', unitLabel: 'OG links', amountEur: 'eintausend', vacancy: 'ja' },
        'keine Zeile',
      ],
    },
    { title: 'Kaltwasser', category: 'Wasser', totalEur: 1236, lines: [] },
  ],
}

test('Messdienst: Beträge als Text werden gelesen, die Abzugszeile ist positiv, Unbrauchbares fällt weg', () => {
  const x = toServiceExtraction(service)
  assert.equal(x.vendor, 'Wärmedienst Beispiel GmbH')
  assert.deepEqual([x.periodStart, x.periodEnd, x.unitsCount], ['2025-01-01', '2025-12-31', 4])
  assert.equal(x.usersTotalEur, 3944.5)
  assert.equal(x.deductionEur, 87.5)
  assert.deepEqual([x.fuelGrossEur, x.fuelNetEur], [3540, 3452.5])
  assert.deepEqual(x.co2, { emissionsKg: 4456.4, areaM2: 194.6, kgPerM2: 22.9, landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 })
  assert.equal(x.dhwMethod, 'volumeFormula')
  const [heizung, kalt] = x.blocks
  assert.equal(heizung?.lines.length, 3, 'eine Zeile, die kein Objekt ist, hat keine Felder')
  assert.deepEqual(heizung?.lines[1], { label: 'Leerstand', unitLabel: 'EG rechts', from: null, to: null, amountEur: 702.1, vacancy: true })
  assert.deepEqual(heizung?.lines[2], { label: 'Beispiel, Max', unitLabel: 'OG links', from: null, to: null, vacancy: false }, 'kein Betrag statt eines falschen; „ja“ ist kein Wahrheitswert')
  assert.equal(kalt?.category, '', 'eine Kostenart außerhalb der Liste wird leer, der Mensch wählt')
})

test('Review Focus 2: Abzugszeile als Text mit Minus, als unlesbarer Text, als Null', () => {
  assert.equal(toServiceExtraction({ ...service, deductionEur: '−87,50 €' }).deductionEur, 87.5)
  assert.equal(toServiceExtraction({ ...service, deductionEur: '-87,50' }).deductionEur, 87.5)
  assert.equal(toServiceExtraction({ ...service, deductionEur: 'siehe Seite 2' }).deductionEur, null)
  assert.equal(toServiceExtraction({ ...service, deductionEur: null }).deductionEur, null)
})

test('Messdienst: Zeitraum nur als Datum, Prozent nur 0 bis 100, Nutzeinheiten nur ganze Zahl ab 1, CO₂-Block ohne Werte ist keiner', () => {
  const x = toServiceExtraction({ ...service, periodStart: '01.05.2025', unitsCount: 2.5, dhwMethod: 'schaetzung', co2: { landlordPercent: 130 } })
  assert.deepEqual([x.periodStart, x.unitsCount, x.dhwMethod, x.co2], [undefined, null, null, null])
  assert.deepEqual(toServiceExtraction({}).blocks, [])
  assert.equal(toServiceExtraction({ ...service, unitsCount: 0 }).unitsCount, null)
  // Ein Datum, das es nicht gibt, ist keines.
  assert.equal(toServiceExtraction({ ...service, periodEnd: '2025-02-30' }).periodEnd, undefined)
})

test('Messdienst: Felder, die das Modell erfindet, erreichen den Browser nicht', () => {
  const x = toServiceExtraction({ ...service, geheim: 'x', blocks: [{ ...service.blocks[0], extra: 1 }] })
  assert.ok(!('geheim' in x))
  assert.ok(!('extra' in (x.blocks[0] ?? {})))
  assert.ok(!('extra' in (x.blocks[0]?.lines[0] ?? {})))
})

const gas = {
  vendor: 'Stadtwerke Beispielstadt',
  invoiceDate: '2026-03-20',
  periodStart: '2025-03-15',
  periodEnd: '2026-03-14',
  totalGrossEur: 4067.8,
  fixedEur: 207.06,
  quantity: '2.890',
  quantityUnit: 'm³',
  energyKwh: 31285,
  gasBasis: 'Brennwert',
  heatingValue: null,
  emissionsKg: 5674.8,
  co2CostEur: 380.99,
  emissionFactor: 0.20088,
  bioCostEur: null,
  parts: [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountEur: 2885.77, fixedEur: 165.65, emissionsKg: 4065, co2CostEur: 266.05 },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 1182.03, fixedEur: 41.41, emissionsKg: 1609.8, co2CostEur: 114.94 },
    { from: 'Januar', to: '2026-03-14', amountEur: 1 },
  ],
}

test('Lieferant: Menge mit Einheit, Brennwert als Bezug, Teilmengen nur mit Zeitraum', () => {
  const x = toFuelExtraction(gas, '2026-03-20')
  assert.equal(x.quantity, null, '„2.890“ ist mehrdeutig (zwei Lesarten, Faktor 1000) und bleibt leer')
  assert.equal(toFuelExtraction({ ...gas, quantity: '2 890' }, '2026-03-20').quantity, 2890)
  assert.equal(x.quantityUnit, 'm3')
  assert.equal(x.gasBasis, 'hs')
  assert.equal(x.heatingValue, null)
  assert.deepEqual([x.emissionsKg, x.co2CostEur, x.emissionFactor, x.energyKwh, x.fixedEur, x.totalGrossEur], [5674.8, 380.99, 0.20088, 31285, 207.06, 4067.8])
  assert.equal(x.parts.length, 2)
  assert.deepEqual(x.parts[1], { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 1182.03, fixedEur: 41.41, emissionsKg: 1609.8, co2CostEur: 114.94 })
  assert.deepEqual([x.co2CostNet, x.amountsAdjusted, x.amountsNetUnadjusted], [false, undefined, false])
  assert.equal(toFuelExtraction({ ...gas, gasBasis: 'Heizwert' }).gasBasis, 'hi')
})

test('Lieferant: Netto-Teilmengen werden anteilig auf den Rechnungsbetrag hochgerechnet, nur wenn die Umsatzsteuer den Abstand erklärt', () => {
  const netto = { ...gas, amountsAreNet: true, fixedEur: 174, parts: [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountEur: 2425.02, fixedEur: 139.2 },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 993.3, fixedEur: 34.8 },
  ] }
  const x = toFuelExtraction(netto, '2026-03-20')
  assert.equal(x.amountsAdjusted, 'netto')
  assert.deepEqual(x.parts.map((p) => p.amountEur), [2885.77, 1182.03])
  assert.deepEqual(x.parts.map((p) => p.fixedEur), [165.65, 41.41])
  assert.equal(x.fixedEur, 207.06)
  assert.equal(x.amountsNetUnadjusted, false)
  // Fehlt eine Teilmenge, erklärt die Umsatzsteuer den Abstand nicht: nichts wird hochgerechnet.
  const luecke = toFuelExtraction({ ...netto, parts: [netto.parts[0]] }, '2026-03-20')
  assert.deepEqual([luecke.amountsAdjusted, luecke.amountsNetUnadjusted, luecke.parts[0]?.amountEur], [undefined, true, 2425.02])
  // Ist ein Betrag einer Teilmenge nicht gelesen, wird ebenfalls nicht hochgerechnet.
  const ungelesen = toFuelExtraction({ ...netto, parts: [netto.parts[0], { ...netto.parts[1], amountEur: 'siehe oben' }] }, '2026-03-20')
  assert.deepEqual([ungelesen.amountsAdjusted, ungelesen.amountsNetUnadjusted], [undefined, true])
  // Ein dritter Teilzeitraum ohne lesbaren Betrag: Auch wenn die Umsatzsteuer den Abstand der übrigen erklärt,
  // bekämen sie sonst seinen Anteil mit dazu.
  const dritte = toFuelExtraction({ ...netto, parts: [...netto.parts, { from: '2026-03-15', to: '2026-03-31', amountEur: 'unleserlich' }] }, '2026-03-20')
  assert.deepEqual([dritte.amountsAdjusted, dritte.amountsNetUnadjusted, dritte.parts[0]?.amountEur], [undefined, true, 2425.02])
  // Steht der Rechnungsbetrag schon in den Teilmengen (Abstand nur Rundung), gibt es nichts zu rechnen.
  const brutto = toFuelExtraction({ ...gas, amountsAreNet: true }, '2026-03-20')
  assert.deepEqual([brutto.amountsAdjusted, brutto.amountsNetUnadjusted, brutto.parts[0]?.amountEur], [undefined, false, 2885.77])
  // Ohne die Meldung „netto“ rechnet Mietfuchs nichts.
  const ohne = toFuelExtraction({ ...netto, amountsAreNet: 'ja' }, '2026-03-20')
  assert.deepEqual([ohne.amountsAdjusted, ohne.amountsNetUnadjusted, ohne.parts[0]?.amountEur], [undefined, false, 2425.02])
})

test('Lieferant: Mietfuchs nimmt dem Modell ab, was es selbst rechnet', () => {
  const x = toFuelExtraction({ ...gas, amountsAdjusted: 'netto', amountsNetUnadjusted: true }, '2026-03-20')
  assert.deepEqual([x.amountsAdjusted, x.amountsNetUnadjusted], [undefined, false])
  assert.ok(!('amountsAreNet' in x) && !('co2CostIsNet' in x))
})

test('Lieferant: Heizöl mit Heizwert, CO₂-Kosten netto gemeldet, Biobrennstoff, unbekannte Einheit', () => {
  const x = toFuelExtraction({ vendor: 'Heizöl Beispiel', deliveredAt: '2025-10-12', totalGrossEur: 3150, quantity: 3000, quantityUnit: 'Liter', heatingValue: '10,05', energyKwh: 30150, emissionsKg: 8032, co2CostEur: 441.76, co2CostIsNet: true, emissionFactor: 0.2664, bioCostEur: 12.5, parts: 'keine' }, '2025-10-14')
  assert.deepEqual([x.quantity, x.quantityUnit, x.heatingValue, x.co2CostNet, x.bioCostEur, x.parts, x.deliveredAt], [3000, 'l', 10.05, true, 12.5, [], '2025-10-12'])
  assert.equal(toFuelExtraction({ quantityUnit: 'Fass' }).quantityUnit, null)
  assert.equal(toFuelExtraction({ quantityUnit: 'Schüttraummeter' }).quantityUnit, 'srm')
  assert.equal(toFuelExtraction({ heatingValue: -1 }).heatingValue, null)
  assert.equal(toFuelExtraction({ bioCostEur: -1 }).bioCostEur, null, 'ein Preisbestandteil ist nicht negativ')
  assert.equal(toFuelExtraction({}).totalGrossEur, null)
})

test('Schemas verlangen das Nötigste und nennen die Felder des Ausgangs; Kostenarten wie überall', () => {
  assert.deepEqual(SERVICE_SCHEMA.required, ['blocks'])
  for (const k of ['deductionEur', 'usersTotalEur', 'fuelGrossEur', 'fuelNetEur', 'co2', 'dhwMethod', 'unitsCount']) assert.ok(k in SERVICE_SCHEMA.properties, k)
  assert.deepEqual(SERVICE_SCHEMA.properties.blocks.items.properties.category.enum, EXTRACT_CATEGORIES)
  assert.deepEqual(FUEL_SCHEMA.required, ['totalGrossEur'])
  for (const k of ['parts', 'bioCostEur', 'emissionFactor', 'heatingValue', 'co2CostIsNet', 'amountsAreNet']) assert.ok(k in FUEL_SCHEMA.properties, k)
})

test('Prompts: Rechnungsbetrag vor Abschlägen, Brennwert ist kein Heizwert, § 43 Abs. 1 GModG mit Wasserstoff (Prüfung M5)', () => {
  assert.match(FUEL_PROMPT, /VOR Abzug geleisteter Abschläge/)
  assert.match(FUEL_PROMPT, /Ein Brennwert ist kein Heizwert/)
  assert.match(FUEL_PROMPT, /Schüttraummeter/)
  assert.match(FUEL_PROMPT, /§ 43 Abs\. 1 GModG/)
  assert.match(FUEL_PROMPT, /Wasserstoff/)
  assert.match(FUEL_SCHEMA.properties.bioCostEur.description, /§ 43 Abs\. 1 GModG.*Wasserstoff/)
  assert.match(SERVICE_PROMPT, /Abzüglich CO₂-Kosten Vermieter/)
  assert.match(SERVICE_PROMPT, /§ 9 Abs\. 2 Satz 2 HeizkostenV/)
})

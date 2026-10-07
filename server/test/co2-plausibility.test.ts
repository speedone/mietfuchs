// Plausibilität der CO₂-Angaben einer Rechnung (Heizung PR 17, #97, Entwurf 15.2 F6): kg gegen die
// Standardwerte der EBeV 2030, € gegen Preis und Umsatzsteuer. Nur „bitte prüfen“.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { co2Plausibility, plausibilityText, type PlausibilityDelivery } from '../src/co2Plausibility.ts'
import { createLawLog } from '../../shared/law/register.ts'

const base: PlausibilityDelivery = {
  id: 'd', label: 'Lieferung', invoiceDate: null, deliveredAt: null, invoiceFrom: null, invoiceTo: null,
  quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, emissionsKg: null, co2CostCents: null, estimated: false,
}
const kinds = (d: PlausibilityDelivery, energy: Parameters<typeof co2Plausibility>[1], log = createLawLog()) => co2Plausibility(d, energy, log).map((f) => f.kind)
const euro = (c: number) => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

test('Heizöl 3.000 l am 15.03.2025: 8.028,9 kg und 525,49 € (Entwurf 8.2) sind plausibel', () => {
  const d = { ...base, deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', quantity: 3000, quantityUnit: 'l' as const, emissionsKg: 8028.9, co2CostCents: 52549 }
  assert.deepEqual(kinds(d, 'oil'), [])
})

test('Heizöl netto statt brutto (441,59 €): Hinweis mit der Spanne', () => {
  const d = { ...base, deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l' as const, emissionsKg: 8028.9, co2CostCents: 44159 }
  const [f] = co2Plausibility(d, 'oil', createLawLog())
  if (!f || f.kind !== 'cost') return assert.fail('kein Hinweis zu den Kosten')
  assert.equal(f.lowCents, 52549)
  assert.match(plausibilityText(f, euro), /„Lieferung“: Die CO₂-Kosten von 441,59 € passen nicht zu 8\.028,9 kg CO₂/)
  assert.match(plausibilityText(f, euro), /wären es 525,49 €/)
  assert.match(plausibilityText(f, euro), /55,00 €\/t \(2025\) zuzüglich 19 % Umsatzsteuer/)
})

test('Review Focus 1: Gas 2023 mit 7 % plausibel, mit 19 % nicht', () => {
  const gas = { ...base, invoiceFrom: '2023-01-01', invoiceTo: '2023-12-31', invoiceDate: '2024-01-20', energyKwh: 100000, gasBasis: 'hs' as const, emissionsKg: 18139 }
  assert.deepEqual(kinds({ ...gas, co2CostCents: 58228 }, 'gas'), [])
  assert.deepEqual(kinds({ ...gas, co2CostCents: 64758 }, 'gas'), ['cost'])
})

test('Review Focus 2: Gas über zwei Preisjahre, Spanne 55 bis 60 €/t', () => {
  const gas = { ...base, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', invoiceDate: '2026-03-30', emissionsKg: 10000 }
  assert.deepEqual(kinds({ ...gas, co2CostCents: 65450 }, 'gas'), [], 'alles zu 55 €')
  assert.deepEqual(kinds({ ...gas, co2CostCents: 71400 }, 'gas'), [], 'alles zu 60 €')
  assert.deepEqual(kinds({ ...gas, co2CostCents: 68000 }, 'gas'), [], 'geteilt')
  const [f] = co2Plausibility({ ...gas, co2CostCents: 60000 }, 'gas', createLawLog())
  if (!f || f.kind !== 'cost') return assert.fail('kein Hinweis')
  assert.deepEqual([f.lowCents, f.highCents, f.years], [65450, 71400, [2025, 2026]])
  assert.match(plausibilityText(f, euro), /zwischen 654,50 € und 714,00 €/)
  assert.match(plausibilityText(f, euro), /55,00 €\/t bis 60,00 €\/t \(2025 und 2026\)/)
  // Knapp außerhalb der Grenze (3 % von 714,00 € = 21,42 €) nach oben.
  assert.deepEqual(kinds({ ...gas, co2CostCents: 73543 }, 'gas'), ['cost'])
  assert.deepEqual(kinds({ ...gas, co2CostCents: 73541 }, 'gas'), [])
})

test('Review Focus 3: Fernwärme mit Emissionshandel, Spanne vom nationalen Preis bis zum Durchschnitt; ohne Rechnungsdatum keine Preisprüfung', () => {
  const fw = { ...base, invoiceFrom: '2024-01-01', invoiceTo: '2024-12-31', invoiceDate: '2025-02-10', emissionsKg: 10000 }
  assert.deepEqual(kinds({ ...fw, co2CostCents: 60000 }, 'districtHeating'), [])
  assert.deepEqual(kinds({ ...fw, co2CostCents: 90000 }, 'districtHeating'), ['cost'])
  assert.deepEqual(kinds({ ...fw, invoiceDate: null, co2CostCents: 90000 }, 'districtHeating'), [])
  const [f] = co2Plausibility({ ...fw, co2CostCents: 90000 }, 'districtHeating', createLawLog())
  if (!f || f.kind !== 'cost') return assert.fail('kein Hinweis')
  assert.deepEqual([f.lowCents, f.highCents, f.prices], [48150, 77362, [45, 65.01]])
  assert.match(plausibilityText(f, euro), /45,00 €\/t bis 65,01 €\/t \(2024, mit dem Durchschnittspreis des Emissionshandels\)/)
  // Die kWh einer Wärmerechnung sind Wärme, nicht Brennstoff: keine Prüfung der kg.
  assert.deepEqual(kinds({ ...fw, energyKwh: 1000, gasBasis: 'hs', emissionsKg: 99999 }, 'districtHeating'), [])
})

test('Review Focus 4: Lieferung 2027 ohne Preis keine Prüfung; mit Eintrag gegen den Eintrag', () => {
  const g = { ...base, invoiceFrom: '2027-01-01', invoiceTo: '2027-12-31', emissionsKg: 10000, co2CostCents: 76398 }
  const ohne = createLawLog()
  assert.deepEqual(kinds(g, 'gas', ohne), [])
  assert.ok(!ohne.values.some((v) => v.id === 'co2.price'), 'ohne Preis steht kein Preis im Rechtsstand')
  const log = createLawLog([{ paramId: 'co2.price', validFrom: '2027-01-01', value: 64.2, source: 'UBA', enteredAt: '2026-12-20' }])
  assert.deepEqual(kinds(g, 'gas', log), [])
  assert.deepEqual(kinds({ ...g, co2CostCents: 64200 }, 'gas', log), ['cost'])
  assert.ok(log.values.some((v) => v.id === 'co2.price' && v.overridden))
})

test('Review Focus 5: Heizöl, in Rechnung gestellt 2022, wird nicht geprüft', () => {
  assert.deepEqual(kinds({ ...base, deliveredAt: '2022-11-15', invoiceDate: '2022-11-15', quantity: 2000, quantityUnit: 'l', emissionsKg: 1, co2CostCents: 1 }, 'oil'), [])
  // Auch eine deutliche Abweichung bleibt ohne Hinweis: 8,0289 t × 30 € × 1,19 = 286,63 €, eingetragen 525,49 €.
  assert.deepEqual(kinds({ ...base, deliveredAt: '2022-11-15', invoiceDate: '2022-11-15', quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549 }, 'oil'), [])
  // Ohne Rechnungsdatum gilt der Liefertag als Tag der Rechnung, wie bei der Bestandsrechnung.
  assert.deepEqual(kinds({ ...base, deliveredAt: '2022-11-15', quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549 }, 'oil'), [])
})

test('Review Focus 5: Heizöl geliefert im Dezember 2022, in Rechnung gestellt 2023: Preis 2022 (30 €/t), keine EBeV-Prüfung', () => {
  const d = { ...base, deliveredAt: '2022-12-20', invoiceDate: '2023-01-10', quantity: 3000, quantityUnit: 'l' as const, emissionsKg: 8028.9 }
  assert.deepEqual(kinds({ ...d, co2CostCents: 28663 }, 'oil'), [], '8,0289 t × 30 € × 1,19')
  const [f] = co2Plausibility({ ...d, co2CostCents: 52549 }, 'oil', createLawLog())
  if (!f || f.kind !== 'cost') return assert.fail('kein Hinweis zu den Kosten')
  assert.deepEqual([f.prices, f.years], [[30], [2022]])
  assert.deepEqual(kinds({ ...d, emissionsKg: 1, co2CostCents: 4 }, 'oil'), [], 'vor 2023 keine EBeV-Prüfung; 0,001 t × 30 € × 1,19 = 0,04 €')
})

test('Review Focus 6: Gas 2024 über den 01.04.2024, Mischsatz nach BMF Rz. 12: 7 % bis 19 % plausibel', () => {
  const gas = { ...base, invoiceFrom: '2024-01-01', invoiceTo: '2024-12-31', invoiceDate: '2025-01-20', emissionsKg: 10000 }
  assert.deepEqual(kinds({ ...gas, co2CostCents: 48150 }, 'gas'), [], 'alles zu 7 %')
  assert.deepEqual(kinds({ ...gas, co2CostCents: 53550 }, 'gas'), [], 'alles zu 19 %')
  assert.deepEqual(kinds({ ...gas, co2CostCents: 52207 }, 'gas'), [], 'nach Tagen geteilt')
  const [f] = co2Plausibility({ ...gas, co2CostCents: 40000 }, 'gas', createLawLog())
  if (!f || f.kind !== 'cost') return assert.fail('kein Hinweis')
  assert.deepEqual([f.lowCents, f.highCents, f.vat], [48150, 53550, [7, 19]])
  assert.match(plausibilityText(f, euro), /zuzüglich 7 bis 19 % Umsatzsteuer/)
  // Ganz im Zeitraum der Ermäßigung bleibt es bei 7 %.
  const ganz = { ...base, invoiceFrom: '2023-01-01', invoiceTo: '2023-12-31', invoiceDate: '2024-01-20', emissionsKg: 10000 }
  assert.deepEqual(kinds({ ...ganz, co2CostCents: 35700 }, 'gas'), ['cost'], '30 € × 1,19 statt × 1,07')
  // Über den 01.10.2022: ebenso beide Sätze.
  const herbst = { ...base, invoiceFrom: '2022-07-01', invoiceTo: '2023-06-30', invoiceDate: '2023-07-15', emissionsKg: 10000 }
  assert.deepEqual(kinds({ ...herbst, co2CostCents: 35700 }, 'gas'), [], 'zu 19 %')
  assert.deepEqual(kinds({ ...herbst, co2CostCents: 32100 }, 'gas'), [], 'zu 7 %')
  // Heizöl kennt die Ermäßigung nicht: im Zeitraum nur 19 %.
  assert.deepEqual(kinds({ ...base, deliveredAt: '2023-05-10', emissionsKg: 10000, co2CostCents: 32100 }, 'oil'), ['cost'])
})

test('EBeV: weniger kg bis 10 % (Biomasseanteil) ohne Hinweis, darunter mit Hinweis auf den Biomasseanteil', () => {
  const gas = { ...base, invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', energyKwh: 100000, gasBasis: 'hs' as const }
  assert.deepEqual(kinds({ ...gas, emissionsKg: 17232 }, 'gas'), [], '5 % Bio-Erdgas')
  assert.deepEqual(kinds({ ...gas, emissionsKg: 16400 }, 'gas'), [], 'knapp 10 % darunter')
  assert.deepEqual(kinds({ ...gas, emissionsKg: 16300 }, 'gas'), ['emissions'], 'gut 10 % darunter')
  assert.deepEqual(kinds({ ...gas, emissionsKg: 18320 }, 'gas'), [], 'knapp 1 % darüber')
  assert.deepEqual(kinds({ ...gas, emissionsKg: 18500 }, 'gas'), ['emissions'], 'gut 2 % darüber')
  const [f] = co2Plausibility({ ...gas, emissionsKg: 15000 }, 'gas', createLawLog())
  if (!f || f.kind !== 'emissions') return assert.fail('kein Hinweis zu den kg')
  assert.equal(f.below, true)
  assert.match(plausibilityText(f, euro), /Biomasseanteil/)
  const [g] = co2Plausibility({ ...gas, emissionsKg: 18500 }, 'gas', createLawLog())
  if (!g || g.kind !== 'emissions') return assert.fail('kein Hinweis zu den kg')
  assert.doesNotMatch(plausibilityText(g, euro), /Biomasseanteil/, 'nach oben erklärt kein Biomasseanteil die Abweichung')
})

test('EBeV: Gas nach Brennwert mit dem Faktor des Heizwerts gerechnet fällt auf; nach Heizwert passt er; Flüssiggas in kg passt', () => {
  const falsch = { ...base, invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', energyKwh: 100000, gasBasis: 'hs' as const, emissionsKg: 20088 }
  const [f] = co2Plausibility(falsch, 'gas', createLawLog())
  if (!f || f.kind !== 'emissions') return assert.fail('kein Hinweis zu den kg')
  assert.ok(Math.abs(f.expectedKg - 18139.464) < 1e-6)
  assert.match(plausibilityText(f, euro), /20\.088 kg CO₂ passen nicht zu 100\.000 kWh nach Brennwert/)
  assert.deepEqual(kinds({ ...falsch, gasBasis: 'hi' }, 'gas'), [], '100.000 kWh × 3,6 × 0,0558 = 20.088 kg')
  assert.deepEqual(kinds({ ...falsch, gasBasis: null }, 'gas'), [], 'ohne Angabe zu Brennwert oder Heizwert keine Prüfung')
  assert.deepEqual(kinds({ ...base, deliveredAt: '2025-05-10', quantity: 1000, quantityUnit: 'kg', emissionsKg: 3013 }, 'lpg'), [])
  assert.deepEqual(kinds({ ...base, deliveredAt: '2025-05-10', quantity: 1000, quantityUnit: 'kg', emissionsKg: 3200 }, 'lpg'), ['emissions'])
  // Heizöl in kWh: 10.000 kWh × 3,6 × 0,074 = 2.664 kg.
  assert.deepEqual(kinds({ ...base, deliveredAt: '2025-05-10', energyKwh: 10000, emissionsKg: 2664 }, 'oil'), [])
  assert.deepEqual(kinds({ ...base, deliveredAt: '2025-05-10', energyKwh: 10000, emissionsKg: 2800 }, 'oil'), ['emissions'])
  // Nach 2030 kennt das Register keine Standardwerte: keine Prüfung der kg.
  assert.deepEqual(kinds({ ...base, deliveredAt: '2031-05-10', quantity: 1000, quantityUnit: 'kg', emissionsKg: 9999 }, 'lpg'), [])
})

test('Flüssiggas im Zeitraum der Ermäßigung: 7 % und 19 % gelten beide (Abweichung 5)', () => {
  const lpg = { ...base, deliveredAt: '2023-05-10', quantity: 1000, quantityUnit: 'kg' as const, emissionsKg: 3013 }
  assert.deepEqual(kinds({ ...lpg, co2CostCents: 9672 }, 'lpg'), [])
  assert.deepEqual(kinds({ ...lpg, co2CostCents: 10756 }, 'lpg'), [])
  // Nach dem 31.03.2024 nur noch 19 %.
  assert.deepEqual(kinds({ ...lpg, deliveredAt: '2024-05-10', co2CostCents: 14508 }, 'lpg'), ['cost'], '3,013 t × 45 € × 1,07')
  assert.deepEqual(kinds({ ...lpg, deliveredAt: '2024-05-10', co2CostCents: 16135 }, 'lpg'), [], '3,013 t × 45 € × 1,19')
})

test('Geschätzte Lieferung, ohne kg oder ohne Zeitpunkt: keine Prüfung; Pellets und Wärmepumpe: keine Preisprüfung', () => {
  assert.deepEqual(kinds({ ...base, estimated: true, deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l', emissionsKg: 1, co2CostCents: 1 }, 'oil'), [])
  assert.deepEqual(kinds({ ...base, co2CostCents: 1 }, 'oil'), [])
  assert.deepEqual(kinds({ ...base, emissionsKg: 1000, co2CostCents: 1 }, 'oil'), [], 'ohne Datum')
  assert.deepEqual(kinds({ ...base, deliveredAt: '2025-03-15', emissionsKg: 1000, co2CostCents: 1 }, 'pellets'), [])
  assert.deepEqual(kinds({ ...base, deliveredAt: '2025-03-15', emissionsKg: 1000, co2CostCents: 1 }, 'heatPump'), [])
  assert.deepEqual(kinds({ ...base, deliveredAt: '2025-03-15', emissionsKg: 1000, co2CostCents: 1 }, 'coal'), ['cost'], 'Kohle: Preis ja, Standardwerte nein')
})

test('Ohne Lieferung nichts im Rechtsstand: Wer nichts einträgt, merkt nichts', () => {
  const log = createLawLog()
  co2Plausibility({ ...base, deliveredAt: '2025-03-15' }, 'oil', log)
  assert.deepEqual(log.values, [])
})

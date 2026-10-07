// Warmwasser ohne Zähler in der eigenen Heizkostenabrechnung (Heizung PR 11): die Hinweise und der
// Ausweis. Die Zahlen von α prüft dhw.test.ts; hier geht es um die Naht zu PR 10 und um das, was der
// Vermieter liest. Grundlage ist Beispiel A aus dem Entwurf 8.6 (server/testing/selfHeating.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { selfDelivery, selfReading, selfRow, selfSnapshot } from '../testing/selfHeating.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem, HeatingPart, HeatingPeriodData, HeatingPlant } from '../../shared/types.ts'

const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const selfOf = (s: ComputedSettlement) => s.heating?.find((h) => h.plantId === 'hp')?.self ?? assert.fail('kein Ausweis der Anlage hp')
const partsOf = (s: ComputedSettlement, itemId: string) => s.landlord.rows.find((r) => r.costItemId === itemId)?.landlordParts ?? []
// `self.alpha.percent` ist α · 100 (PR 10); 0,15 · 100 ergibt im Gleitkomma 15,000000000000002.
const percentOf = (s: ComputedSettlement) => Math.round((selfOf(s).alpha?.percent ?? -1) * 100) / 100
const formel = { dhwMethod: 'volumeFormula' as const, dhwVolumeM3: 120, dhwTempC: 60, dhwUnmeasurable: null }
const brennwert = [selfDelivery({ gasBasis: 'hs' })]

test('Wärmezähler und Gas in kWh (Beispiel A, F16): α 15 % mit Rechenweg, keine neuen Hinweise, keine neuen Rechtswerte', () => {
  const s = computeSettlement(selfSnapshot())
  const self = selfOf(s)
  assert.equal(percentOf(s), 15)
  const dhw = self.dhw ?? assert.fail('kein Rechenweg')
  assert.deepEqual([dhw.alpha, dhw.factor, dhw.method], [0.15, null, 'heatMeter'])
  assert.ok(!(s.legalBasis.values ?? []).some((v) => v.id.startsWith('hkv.dhw.') || v.id === 'hkv.heating-values' || v.id === 'hkv.exemption.renewable'))
  for (const c of ['heating.dhw-not-metered', 'heating.dhw-share-implausible', 'heating.heating-value-from-table', 'heating.heat-pump-dhw-basis', 'heating.heat-pump-old-exemption']) {
    assert.ok(!codes(s).includes(c), c)
  }
})

test('Formel ohne bestätigten Aufwand bei eigener Abrechnung: 15 % auf den ganzen Anteil, je Mieter beziffert (BGH VIII ZR 151/20)', () => {
  const s = computeSettlement(selfSnapshot({ plant: { heatGeneration: 'single' }, row: formel, deliveries: brennwert }))
  assert.equal(selfOf(s).dhw?.method, 'volumeFormula')
  const n = s.notices.find((x) => x.code === 'heating.dhw-not-metered') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /Die Wärme für das Warmwasser ist mit einer Formel bestimmt und nicht mit einem Wärmezähler gemessen/)
  assert.match(n.text, /um 15 % kürzen \(§ 9 Abs\. 2 Satz 1, § 12 Abs\. 1 Satz 1 HeizkostenV; BGH, Urteil vom 12\.01\.2022, VIII ZR 151\/20\), hier: Mieter A \(A\) \d/)
  assert.ok((s.legalBasis.values ?? []).some((v) => v.id === 'hkv.dhw.volume-formula'))
  const bestaetigt = computeSettlement(selfSnapshot({ plant: { heatGeneration: 'single' }, row: { ...formel, dhwUnmeasurable: true }, deliveries: brennwert }))
  assert.ok(!codes(bestaetigt).includes('heating.dhw-not-metered'))
})

test('Formel ohne Antwort zum Erzeuger: kein Anteil, Anlage nicht verteilt, Satz mit der Frage', () => {
  const s = computeSettlement(selfSnapshot({ row: formel, deliveries: brennwert }))
  const n = s.notices.find((x) => x.code === 'heating.dhw-share-invalid') ?? assert.fail('kein Fehler')
  assert.equal(n.level, 'error')
  assert.match(n.text, /ob die Anlage die Wärme allein erzeugt.*Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht/s)
  assert.equal(selfOf(s).dhw, undefined)
  assert.deepEqual(partsOf(s, 'gas'), [{ reason: 'noBasis', cents: 600000 }])
})

test('Ungewöhnlicher Anteil: Hinweis ohne Rechtsfolge', () => {
  // 2,5 · 2 · 50 · 1,11 = 277,5 kWh gegen 60.000 kWh: weit unter 5 %.
  const s = computeSettlement(selfSnapshot({ plant: { heatGeneration: 'single' }, row: { ...formel, dhwVolumeM3: 2, dhwUnmeasurable: true }, deliveries: brennwert }))
  const n = s.notices.find((x) => x.code === 'heating.dhw-share-implausible') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /Üblich sind Werte zwischen 5,00 % und 50,00 %; das ist keine Grenze des Gesetzes/)
})

test('Gas in m³ ohne Heizwert auf der Rechnung: Wert der Tabelle (Erdgas H) mit Hinweis; die frühere Sperre aus PR 10 fällt', () => {
  const m3 = selfDelivery({ label: 'Gas 2025 in m³', energyKwh: null, quantity: 6000, quantityUnit: 'm3', fuelGrade: 'naturalGasH' })
  const s = computeSettlement(selfSnapshot({ deliveries: [m3] }))
  const n = s.notices.find((x) => x.code === 'heating.heating-value-from-table') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /„Gas 2025 in m³“ nennt keinen Heizwert.*Erdgas H: 10 kWh je Kubikmeter \(§ 9 Abs\. 3 HeizkostenV, hilfsweise\)/)
  // 9.000 kWh / 10 kWh je m³ = 900 m³ von 6.000 m³ = 15 %.
  assert.equal(percentOf(s), 15)
})

test('Wärmepumpe mit Wärmezähler am Warmwasser ohne Gesamtwärme (A8, PR 10): Fehler, keine Verteilung', () => {
  const strom = selfDelivery({ label: 'Strom 2025', energyKwh: 12000, emissionsKg: null, co2CostCents: null })
  const s = computeSettlement(selfSnapshot({ plant: { energy: 'heatPump' }, deliveries: [strom], row: { dhwHeatKwh: 4500, totalHeatKwh: null } }))
  const n = s.notices.find((x) => x.code === 'heating.heat-pump-dhw-basis') ?? assert.fail('kein Fehler')
  assert.equal(n.level, 'error')
  assert.match(n.text, /etwa dreimal zu großen Warmwasseranteil/)
  assert.equal(selfOf(s).dhw, undefined)
})

test('Review Focus 5 (Durchsicht #240, Recht-I1): Wärmepumpe 2024 (§ 11 Abs. 1 Nr. 3 Buchst. a a. F.) hängt an „mehr als die Hälfte der Wärme“, nicht am Erzeuger', () => {
  const strom = selfDelivery({ label: 'Strom 2024', energyKwh: 12000, emissionsKg: null, co2CostCents: null }, 2024)
  const wp = { energy: 'heatPump' as const, heatGeneration: 'single' as const }
  const mit = (over: Partial<HeatingPlant>) => computeSettlement(selfSnapshot({ year: 2024, plant: { ...wp, ...over }, deliveries: [strom], row: formel }))
  // Ja: Ausnahme, kein Fehler, keine Kürzung, Heizung und Warmwasser gemeinsam.
  const ja = mit({ heatPumpMajority: 'yes' })
  assert.deepEqual(ja.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  const n = ja.notices.find((x) => x.code === 'heating.heat-pump-old-exemption') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /überwiegend mit Wärme aus Wärmerückgewinnung, Wärmepumpen oder Solaranlagen \(§ 11 Abs\. 1 Nr\. 3 Buchst\. a HeizkostenV in der Fassung bis 30\.09\.2024\)/)
  assert.match(n.text, /Fassung an, die zu Beginn des Abrechnungszeitraums galt \(Festlegung von Mietfuchs\)/)
  assert.match(n.text, /mehr als die Hälfte der Wärme liefert\. Dann gilt die Verteilung laut Mietvertrag, und Kürzungen nach § 12 HeizkostenV entfallen/)
  assert.match(n.text, /gemeinsam wie die Heizkosten \(Festlegung von Mietfuchs\)/)
  assert.equal(selfOf(ja).alpha, null)
  assert.deepEqual(partsOf(ja, 'gas'), [], 'verteilt, nichts beim Vermieter')
  assert.ok(!codes(ja).includes('heating.dhw-not-metered'), 'keine Kürzung')
  assert.ok((ja.legalBasis.values ?? []).some((v) => v.id === 'hkv.exemption.renewable'))
  // Mit weiterem Erzeuger, aber mehr als der Hälfte aus der Wärmepumpe: dieselbe Ausnahme.
  assert.ok(codes(mit({ heatPumpMajority: 'yes', heatGeneration: 'mixed' })).includes('heating.heat-pump-old-exemption'))
  // Nein: Die Verordnung galt; ohne Faktor 0,30 ist der Anteil nicht bestimmbar.
  const nein = mit({ heatPumpMajority: 'no' })
  assert.ok(codes(nein).includes('heating.dhw-share-invalid'))
  assert.ok(!codes(nein).includes('heating.heat-pump-old-exemption'))
  // Ohne Antwort oder „weiß nicht“ (Nachprüfung von #240, W2): gerechnet wie „ja“ (Festlegung), keine Sperre,
  // aber eine Warnung mit dem möglichen Kürzungsbetrag je Mieter, denn ohne Warmwasseranteil ist Warmwasser
  // nicht nach Verbrauch verteilt.
  for (const open of [null, 'unknown'] as const) {
    const s = mit({ heatPumpMajority: open })
    assert.deepEqual(s.notices.filter((x) => x.level === 'error').map((x) => x.code), [], String(open))
    assert.ok(!codes(s).includes('heating.heat-pump-old-exemption'))
    const h = s.notices.find((x) => x.code === 'heating.heat-pump-majority-open') ?? assert.fail('keine Warnung')
    assert.equal(h.level, 'warning')
    assert.match(h.text, /beantworten Sie die Frage bei der Heizanlage.*als liefere sie mehr als die Hälfte \(Festlegung von Mietfuchs\); die Ausnahme muss im Streit der Vermieter belegen/s)
    assert.match(h.text, /um 15 % kürzen, soweit nicht nach Verbrauch verteilt ist \(§ 12 Abs\. 1 Satz 1 HeizkostenV\), hier: Mieter A \(A\) \d[\d.]*,\d\d €, Mieter B \(B\)/)
  }
  // Mit Wärmezähler am Speicher und gemessener Gesamtwärme ist alles nach Verbrauch verteilt: kein Betrag.
  const gemessen = computeSettlement(selfSnapshot({ year: 2024, plant: { ...wp, heatPumpMajority: null }, deliveries: [strom], row: { dhwHeatKwh: 4500, totalHeatKwh: 36000 } }))
  const g = gemessen.notices.find((x) => x.code === 'heating.heat-pump-majority-open') ?? assert.fail('keine Warnung')
  assert.doesNotMatch(g.text, /hier:/)
  // Ab dem 01.10.2024 gilt die Ausnahme nicht mehr: 2025 rechnet die Formel mit 0,30, gleich was geantwortet ist.
  const neu = computeSettlement(selfSnapshot({ plant: { ...wp, heatPumpMajority: 'yes' }, deliveries: [selfDelivery({ label: 'Strom 2025', energyKwh: 12000, emissionsKg: null, co2CostCents: null })], row: formel }))
  assert.ok(!codes(neu).includes('heating.heat-pump-old-exemption'))
  assert.equal(selfOf(neu).dhw?.factor?.kind, 'heatPump')
})

// ---------- Durchsicht von #240 ----------

const swapReadings = () => [
  selfReading('wz-a', '2024-12-31', 1000), selfReading('wz-a', '2025-06-30', 9000), selfReading('wz-a', '2025-12-31', 13000),
  selfReading('wz-b', '2024-12-31', 0), selfReading('wz-b', '2025-06-30', 10000), selfReading('wz-b', '2025-12-31', 16000),
  selfReading('wz-c', '2024-12-31', 500), selfReading('wz-c', '2025-06-30', 6000), selfReading('wz-c', '2025-09-30', 7700), selfReading('wz-c', '2025-12-31', 12500),
  selfReading('xw-a', '2024-12-31', 10), selfReading('xw-a', '2025-06-30', 25), selfReading('xw-a', '2025-12-31', 40),
  selfReading('xw-b', '2024-12-31', 0), selfReading('xw-b', '2025-06-30', 20), selfReading('xw-b', '2025-12-31', 40),
  selfReading('xw-c', '2024-12-31', 5), selfReading('xw-c', '2025-06-30', 30), selfReading('xw-c', '2025-09-30', 43), selfReading('xw-c', '2025-12-31', 55),
  selfReading('ww', '2024-12-31', 0), selfReading('ww', '2025-06-30', 4500), selfReading('ww', '2025-12-31', 9000),
]
const swapItem = (id: string, plant: string, amountCents: number, heatingPart: HeatingPart, extra: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: id, amountCents, key: 'heatingSystem', heatingPlantId: plant, heatingPart, heatingTarget: 'both', ...extra,
})
const alphaOf = (s: ComputedSettlement, plantId: string) => s.heating?.find((h) => h.plantId === plantId)?.self?.alpha?.percent ?? null

test('Durchsicht #240, Geld-M1: Kesseltausch mit Volumenformel; Volumen der Anlage selbst, Temperatur über die Linie', () => {
  const neu = (row: Partial<HeatingPeriodData>) => {
    const hp2: HeatingPlant = { ...(selfSnapshot().heatingPlants?.[0] as HeatingPlant), id: 'hp2', name: 'neu', replacesPlantId: 'hp', heatGeneration: 'single', heatPumpMajority: null }
    return computeSettlement(selfSnapshot({
      plant: { name: 'alt', endsOn: '2025-06-30', heatGeneration: 'single' },
      plants: [hp2],
      row: { dhwMethod: 'volumeFormula', dhwVolumeM3: 60, dhwTempC: 60, dhwUnmeasurable: true },
      rows: [selfRow({ dhwMethod: null, ...row }, 2025, 'hp2')],
      deliveries: [
        selfDelivery({ id: 'd1', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30', energyKwh: 30000, gasBasis: 'hs' }),
        selfDelivery({ id: 'd2', plantId: 'hp2', invoiceFrom: '2025-07-01', invoiceTo: '2025-12-31', energyKwh: 30000, gasBasis: 'hs' }),
      ],
      costItems: [swapItem('gas1', 'hp', 300000, 'fuel', { fuelDeliveryId: 'd1' }), swapItem('gas2', 'hp2', 300000, 'fuel', { fuelDeliveryId: 'd2' })],
      readings: swapReadings(),
    }))
  }
  // Neue Anlage mit 30 m³ und ohne eigene Temperatur: 2,5 · 30 · (60 − 10) · 1,11 = 4.162,5 kWh von 30.000 kWh.
  const s = neu({ dhwVolumeM3: 30, dhwTempC: null })
  assert.equal(Math.round((alphaOf(s, 'hp2') ?? 0) * 1000) / 1000, 13.875)
  assert.equal(Math.round((alphaOf(s, 'hp') ?? 0) * 1000) / 1000, 27.75)
  // Ohne eigenes Volumen rechnet die neue Anlage nicht mit dem der alten.
  const ohne = neu({ dhwVolumeM3: null })
  assert.equal(alphaOf(ohne, 'hp2'), null)
  assert.match(ohne.notices.find((n) => n.code === 'heating.dhw-share-invalid')?.text ?? '', /Volumen des Warmwassers in der Laufzeit dieser Anlage/)
})

test('Durchsicht #240, Geld-I3: Kesseltausch Öl → Öl mit übernommenem Vorrat; der Heizwert der Lieferung der alten Anlage gilt für den übernommenen Brennstoff', () => {
  const hp2: HeatingPlant = { ...(selfSnapshot().heatingPlants?.[0] as HeatingPlant), id: 'hp2', energy: 'oil', replacesPlantId: 'hp', takesOverStock: true, heatGeneration: 'single', heatPumpMajority: null }
  const s = computeSettlement(selfSnapshot({
    plant: { energy: 'oil', endsOn: '2025-06-30', heatGeneration: 'single' },
    plants: [hp2],
    row: { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000, openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: false, closingQuantity: 1500, closingMeasuredOn: '2025-06-30' },
    rows: [selfRow({ stockUnit: 'l', closingQuantity: 500, closingMeasuredOn: '2025-12-31' }, 2025, 'hp2')],
    deliveries: [selfDelivery({ id: 'd1', label: 'Heizöl 15.03.2025', invoiceFrom: null, invoiceTo: null, deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', energyKwh: null, quantity: 3000, quantityUnit: 'l', heatingValue: 9.9, emissionsKg: 8028.9, co2CostCents: 52549 })],
    costItems: [swapItem('oel', 'hp', 315000, 'fuel', { fuelDeliveryId: 'd1' }), swapItem('wartung', 'hp', 24000, 'operating'), swapItem('wartung2', 'hp2', 24000, 'operating')],
    readings: swapReadings(),
  }))
  assert.ok(!codes(s).includes('heating.dhw-share-invalid'), s.notices.filter((n) => n.level === 'error').map((n) => n.text).join('\n'))
  // Neue Anlage: 4.500 kWh / 9,9 kWh/l = 454,55 l von 1.000 l verbrauchtem Brennstoff = 45,45 %.
  assert.equal(Math.round((alphaOf(s, 'hp2') ?? 0) * 100) / 100, 45.45)
  const dhw = s.heating?.find((h) => h.plantId === 'hp2')?.self?.dhw ?? assert.fail('kein Rechenweg')
  assert.deepEqual(dhw.heatingValues.map((v) => [v.label, v.kwh, v.source]), [['Heizöl 15.03.2025', 9.9, 'invoice']])
})

test('Stromheizung gemessen (Abweichung 7): rechnet wie in PR 10 gegen den Strom laut Rechnung', () => {
  const strom = selfDelivery({ label: 'Strom 2025', energyKwh: 60000, emissionsKg: null, co2CostCents: null })
  const s = computeSettlement(selfSnapshot({ plant: { energy: 'electric' }, deliveries: [strom] }))
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.equal(percentOf(s), 15)
  assert.equal(selfOf(s).dhw?.denominator.kind, 'electricity')
})

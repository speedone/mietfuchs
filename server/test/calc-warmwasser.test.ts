// Warmwasser ohne Zähler in der eigenen Heizkostenabrechnung (Heizung PR 11): die Hinweise und der
// Ausweis. Die Zahlen von α prüft dhw.test.ts; hier geht es um die Naht zu PR 10 und um das, was der
// Vermieter liest. Grundlage ist Beispiel A aus dem Entwurf 8.6 (server/testing/selfHeating.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { selfDelivery, selfSnapshot } from '../testing/selfHeating.ts'

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

test('Review Focus 5: Wärmepumpe 2024 (§ 11 Abs. 1 Nr. 3 Buchst. a a. F.): Hinweis statt Fehler, ohne Kürzung; mit weiterem Erzeuger bleibt der Fehler', () => {
  const strom = selfDelivery({ label: 'Strom 2024', energyKwh: 12000, emissionsKg: null, co2CostCents: null }, 2024)
  const wp = { energy: 'heatPump' as const, heatGeneration: 'single' as const }
  const s = computeSettlement(selfSnapshot({ year: 2024, plant: wp, deliveries: [strom], row: formel }))
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  const n = s.notices.find((x) => x.code === 'heating.heat-pump-old-exemption') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /überwiegend mit Wärme aus Wärmerückgewinnung, Wärmepumpen oder Solaranlagen \(§ 11 Abs\. 1 Nr\. 3 Buchst\. a HeizkostenV in der Fassung bis 30\.09\.2024\).*Kürzungen nach § 12 HeizkostenV entfallen/s)
  assert.match(n.text, /gemeinsam wie die Heizkosten \(Festlegung von Mietfuchs\)/)
  assert.equal(selfOf(s).alpha, null)
  assert.deepEqual(partsOf(s, 'gas'), [], 'verteilt, nichts beim Vermieter')
  assert.ok(!codes(s).includes('heating.dhw-not-metered'), 'keine Kürzung')
  assert.ok((s.legalBasis.values ?? []).some((v) => v.id === 'hkv.exemption.renewable'))
  const gemischt = computeSettlement(selfSnapshot({ year: 2024, plant: { ...wp, heatGeneration: 'mixed' }, deliveries: [strom], row: formel }))
  assert.ok(codes(gemischt).includes('heating.dhw-share-invalid'))
  assert.ok(!codes(gemischt).includes('heating.heat-pump-old-exemption'))
  // Ab dem 01.10.2024 gilt die Ausnahme nicht mehr: 2025 rechnet die Formel mit 0,30.
  const neu = computeSettlement(selfSnapshot({ plant: wp, deliveries: [selfDelivery({ label: 'Strom 2025', energyKwh: 12000, emissionsKg: null, co2CostCents: null })], row: formel }))
  assert.ok(!codes(neu).includes('heating.heat-pump-old-exemption'))
  assert.equal(selfOf(neu).dhw?.factor?.kind, 'heatPump')
})

test('Stromheizung gemessen (Abweichung 7): rechnet wie in PR 10 gegen den Strom laut Rechnung', () => {
  const strom = selfDelivery({ label: 'Strom 2025', energyKwh: 60000, emissionsKg: null, co2CostCents: null })
  const s = computeSettlement(selfSnapshot({ plant: { energy: 'electric' }, deliveries: [strom] }))
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.equal(percentOf(s), 15)
  assert.equal(selfOf(s).dhw?.denominator.kind, 'electricity')
})

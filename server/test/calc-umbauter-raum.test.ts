// Grundkosten der Heizung nach umbautem Raum (#322, § 7 Abs. 1 Satz 5 HeizkostenV) in der eigenen
// Heizkostenabrechnung: Beispiel A (server/testing/selfHeating.ts) mit einem Rauminhalt je Wohnung an der
// Zuordnung zur Anlage. Das Warmwasser bleibt bei der Wohnfläche (§ 8 Abs. 1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { selfMeters, selfReadings, selfSnapshot } from '../testing/selfHeating.ts'
import { periodKey } from '../../shared/period.ts'
import type { HeatingPlantUnit } from '../../shared/types.ts'

const selfOf = (s: ComputedSettlement) => s.heating?.find((h) => h.plantId === 'hp')?.self ?? assert.fail('kein Ausweis der Anlage hp')
const totalOf = (s: ComputedSettlement, id: string) => s.statements.find((st) => st.tenancyId === id)?.totalShareCents ?? assert.fail(`kein ${id}`)
const rowsOf = (s: ComputedSettlement, id: string) => s.statements.find((st) => st.tenancyId === id)?.rows ?? assert.fail(`kein ${id}`)
const volumes = (a: number | null, b: number | null, c: number | null): HeatingPlantUnit[] =>
  [{ unitId: 'a', heatedAreaM2: null, volumeM3: a }, { unitId: 'b', heatedAreaM2: null, volumeM3: b }, { unitId: 'c', heatedAreaM2: null, volumeM3: c }]

test('#322: Rauminhalt im Verhältnis der Wohnflächen ergibt centgenau dieselbe Abrechnung wie die Wohnfläche', () => {
  const flaeche = computeSettlement(selfSnapshot())
  // 60 : 80 : 60 m² und 150 : 200 : 150 m³ sind dasselbe Verhältnis.
  const raum = computeSettlement(selfSnapshot({ plant: { areaBasisHeat: 'volume', units: volumes(150, 200, 150) } }))
  for (const id of ['A', 'B', 'C1', 'C2']) assert.equal(totalOf(raum, id), totalOf(flaeche, id), id)
  assert.equal(selfOf(raum).pots.find((p) => p.pot === 'heating')?.basisUnit, 'm³')
  assert.equal(selfOf(raum).pots.find((p) => p.pot === 'water')?.basisUnit, undefined, 'Warmwasser nach Wohnfläche')
  assert.equal(selfOf(flaeche).pots.find((p) => p.pot === 'heating')?.basisUnit, undefined)
})

test('#322: die Grundkosten der Heizung folgen dem Rauminhalt, die des Warmwassers der Wohnfläche', () => {
  const flaeche = computeSettlement(selfSnapshot())
  // A bekommt mehr Raum als nach der Fläche (300 statt 150 m³): A trägt mehr, B weniger, das Warmwasser bleibt.
  const raum = computeSettlement(selfSnapshot({ plant: { areaBasisHeat: 'volume', units: volumes(300, 200, 150) } }))
  assert.ok(totalOf(raum, 'A') > totalOf(flaeche, 'A'), 'A trägt mehr')
  assert.ok(totalOf(raum, 'B') < totalOf(flaeche, 'B'), 'B trägt weniger')
  const water = (s: ComputedSettlement) => rowsOf(s, 'A').find((r) => r.costItemId === 'wwz')?.shareCents
  assert.equal(water(raum), water(flaeche), 'Miete der Warmwasserzähler nur nach Wohnfläche und Verbrauch')
  // Die Summe aller Zeilen bleibt die Summe der Positionen.
  const sum = (s: ComputedSettlement) => s.statements.reduce((a, st) => a + st.totalShareCents, 0) + s.landlord.rows.reduce((a, r) => a + r.shareCents, 0)
  assert.equal(sum(raum), sum(flaeche))
  const pot = selfOf(raum).pots.find((p) => p.pot === 'heating') ?? assert.fail('kein Topf')
  assert.equal(pot.areaM2, 650)
  const step = rowsOf(raum, 'A').find((r) => r.costItemId === 'wz')?.steps?.find((x) => x.label === 'Grundkosten Heizung') ?? assert.fail('kein Schritt')
  assert.equal(step.value, '300 von 650 m³')
  const waterStep = rowsOf(raum, 'A').find((r) => r.costItemId === 'wwz')?.steps?.find((x) => x.label === 'Grundkosten Warmwasser') ?? assert.fail('kein Schritt')
  assert.equal(waterStep.value, '60 von 200 m²')
})

test('#322: fehlt ein Rauminhalt, wird die Anlage nicht verteilt, und der Fehler nennt die Wohnung', () => {
  const s = computeSettlement(selfSnapshot({ plant: { areaBasisHeat: 'volume', units: volumes(150, null, 150) } }))
  const n = s.notices.find((x) => x.code === 'heating.self-incomplete' && /umbaute Raum/.test(x.text)) ?? assert.fail('kein Fehler')
  assert.equal(n.level, 'error')
  assert.match(n.text, /An B fehlt der umbaute Raum in m³/)
  assert.ok(!/Fläche hinterlegt/.test(s.notices.map((x) => x.text).join(' ')), 'keine zweite Meldung zur Fläche')
  assert.deepEqual(s.landlord.rows.find((r) => r.costItemId === 'gas')?.landlordParts, [{ reason: 'noBasis', cents: 600000 }])
})

test('#322, Durchsicht S2 und K4: Sätze zur Schätzung und ohne Verbrauch nennen den umbauten Raum', () => {
  const plant = { areaBasisHeat: 'volume' as const, units: volumes(150, 200, 150) }
  // Ohne Wärmezähler: nur nach umbautem Raum, im Rechenweg und im Hinweis.
  const ohne = computeSettlement(selfSnapshot({ plant, meters: selfMeters().filter((m) => m.type !== 'waerme' || m.unitId === null) }))
  const step = rowsOf(ohne, 'A').find((r) => r.costItemId === 'wz')?.steps?.find((x) => x.label === 'Verbrauchskosten Heizung')
  assert.equal(step?.value, 'kein Verbrauch erfasst, nur nach umbautem Raum verteilt')
  assert.match(ohne.notices.find((n) => n.code === 'heating.no-consumption')?.text ?? '', /nur nach umbautem Raum\./)
  // Schätzung nach dem Durchschnitt des Gebäudes: je m³.
  const readings = selfReadings().filter((r) => !(r.meterId === 'wz-c' && r.date === '2025-12-31'))
  const geschaetzt = computeSettlement(selfSnapshot({ plant, readings, estimates: [{ plantId: 'hp', period: periodKey('2025-01'), unitId: 'c', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true, cause: 'deviceFailure', capture: 'heatMeter', valueUnit: 'kWh' }] }))
  assert.match(geschaetzt.notices.find((n) => n.code === 'heating.estimated')?.text ?? '', /Durchschnitt des Gebäudes je m³/)
})

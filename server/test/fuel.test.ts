// Brennstofflieferungen ohne Abrechnung (Heizung PR 7, Entwurf 3.2, 3.3, 8.2, 12.2 „fuel.test.ts“):
// Stufen der Abgrenzung, feste Bestandteile nach Tagen, Abdeckung, Überträge in den Fällen a–f und der
// Vorschlag einer Schätzung, je mit den Zahlen des Entwurfs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coverageOf, deliveryShare, localDegreeDaySum, meterQuantity, plantFuel, variableShare,
  type FuelDeliveryInput, type FuelPlantInput, type ShareContext,
} from '../src/fuel.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { onlyVersion } from '../../shared/law/register.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

const table = onlyVersion(hkvDegreeDays).value
const ctx: ShareContext = { table, local: new Map(), readings: null }
const near = (a: number, b: number, what: string, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} statt ${b}`)
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const period = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
const H = period(MAI, '2025-05')
const H1 = period(MAI, '2024-05')
// Der Gradtagsanteil 15.03.–31.03. eines Jahres: 17 von 31 Märztagen mit 130 ‰.
const MAERZ_REST = (17 * 130) / 31

const delivery = (over: Partial<FuelDeliveryInput>): FuelDeliveryInput => ({
  id: 'd', label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', deliveredAt: null, amountCents: null, fixedCents: null,
  sharePermille: null, emissionsKg: null, co2CostCents: null, estimated: false, usedByService: true, parts: [], ...over,
})

test('Tabelle (Entwurf 3.2): 621,29 ‰ im Jahr 2025, 848,71 ‰ in Mai bis April, 530 ‰ Januar bis April', () => {
  const r = { from: '2025-03-15', to: '2026-03-14' }
  near(variableShare(r, { from: '2025-01-01', to: '2025-12-31' }, ctx).share * 1000, MAERZ_REST + 550, '2025')
  assert.equal((variableShare(r, H, ctx).share * 1000).toFixed(2), '848.71')
  assert.equal(variableShare(r, H, ctx).method, 'degreeDays')
  near(variableShare({ from: '2025-01-01', to: '2025-12-31' }, { from: '2025-01-01', to: '2025-04-30' }, ctx).share * 1000, 530, 'Winter-Rumpf')
  // Ganz drin oder ganz draußen ist die Zwischenrechnung (Stufe 2).
  assert.deepEqual(variableShare({ from: '2025-06-01', to: '2025-06-30' }, H, ctx), { share: 1, method: 'inside' })
  assert.deepEqual(variableShare({ from: '2024-06-01', to: '2024-06-30' }, H, ctx), { share: 0, method: 'inside' })
})

test('6.500 € nach Gradtagen: 4.038,39 € für 2025, tagesgenau wären es 5.200,00 € (verworfen)', () => {
  const s = deliveryShare(delivery({}), 650000, { from: '2025-01-01', to: '2025-12-31' }, ctx, null)
  assert.equal(Math.round(650000 * s.ratio), 403839)
  assert.equal(Math.round((650000 * 292) / 365), 520000)
  assert.deepEqual([s.method, s.fixedKnown, s.split], ['degreeDays', false, true])
})

test('R1: Grund- und Leistungspreis nach Tagen, 1.600,00 € statt 1.242,58 € nach Gradtagen', () => {
  const fern = delivery({ fixedCents: 200000 })
  const s = deliveryShare(fern, 200000, { from: '2025-01-01', to: '2025-12-31' }, ctx, null)
  assert.equal(Math.round(200000 * s.ratio), 160000)
  assert.equal(Math.round(200000 * (MAERZ_REST + 550) / 1000), 124258)
  assert.equal(s.fixedKnown, true)
  // CO₂ hängt nur an der Menge: Der Anteil für kg und C bleibt der verbrauchsabhängige.
  near(s.kgShare, (MAERZ_REST + 550) / 1000, 'kg')
})

test('Stufe 1 mit Preisabschnitten: Zählerstände genau an den Grenzen, je Abschnitt geteilt', () => {
  const readings = [{ date: '2025-03-14', value: 1000 }, { date: '2025-04-30', value: 3000 }, { date: '2025-12-31', value: 9000 }]
  const parts = [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: null, amountCents: 500000, fixedCents: null, emissionsKg: null, co2CostCents: null },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: null, amountCents: 150000, fixedCents: null, emissionsKg: null, co2CostCents: null },
  ]
  const s = deliveryShare(delivery({ parts }), 650000, H, { ...ctx, readings }, null)
  assert.equal(s.method, 'parts')
  // Abschnitt 1: 6.000 von 8.000 nach dem Zähler; Abschnitt 2 ganz in der Heizperiode.
  assert.equal(Math.round(650000 * s.ratio), 525000)
  assert.equal(variableShare({ from: '2025-03-15', to: '2025-12-31' }, H, { ...ctx, readings }).method, 'measured')
})

test('Stufe 3 mit zwei Teilmengen ohne Zähler: je Teilmenge nach Gradtagen', () => {
  const parts = [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: null, amountCents: 500000, fixedCents: null, emissionsKg: null, co2CostCents: null },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: null, amountCents: 150000, fixedCents: null, emissionsKg: null, co2CostCents: null },
  ]
  const s = deliveryShare(delivery({ parts }), 650000, H, ctx, null)
  // Teilmenge 1 (15.03.–31.12.2025) liegt mit Mai bis Dezember in H: 40 + 40 (Sommer) + 30 + 80 + 120
  // + 160 = 470 von 71,29 + 550 Gradtagen; Teilmenge 2 liegt ganz in H.
  assert.equal(Math.round(650000 * s.ratio), Math.round(500000 * (470 / (MAERZ_REST + 550)) + 150000))
})

test('Stufe 4 mit Ortswerten: geht der Tabelle vor, fehlt ein Monat, gilt die Tabelle', () => {
  // Je Monat so viele Gradtage wie Tage: Jeder Tag zählt gleich, der Anteil ist der der Tage.
  const local = new Map<string, number>()
  for (let m = 3; m <= 12; m++) local.set(`2025-${String(m).padStart(2, '0')}`, new Date(Date.UTC(2025, m, 0)).getUTCDate())
  for (const [m, d] of [['01', 31], ['02', 28], ['03', 31]] as const) local.set(`2026-${m}`, d)
  const s = variableShare({ from: '2025-03-15', to: '2026-03-14' }, { from: '2025-01-01', to: '2025-12-31' }, { ...ctx, local })
  assert.equal(s.method, 'localDegreeDays')
  near(s.share, 292 / 365, 'Ortswerte')
  assert.equal(localDegreeDaySum({ from: '2025-03-15', to: '2025-03-16' }, local), 2)
  local.delete('2025-07')
  assert.equal(variableShare({ from: '2025-03-15', to: '2026-03-14' }, { from: '2025-01-01', to: '2025-12-31' }, { ...ctx, local }).method, 'degreeDays')
})

test('Eingetragener Anteil schlägt alles, auch den Zählerstand (Stufe 0); feste Teile bleiben nach Tagen', () => {
  const readings = [{ date: '2025-03-14', value: 1000 }, { date: '2025-12-31', value: 9000 }, { date: '2026-03-14', value: 11000 }]
  const s = deliveryShare(delivery({ sharePermille: 900 }), 650000, { from: '2025-01-01', to: '2025-12-31' }, { ...ctx, readings }, 100)
  assert.deepEqual([s.method, s.kgShare], ['entered', 0.1])
  const mitFix = deliveryShare(delivery({ sharePermille: 900, fixedCents: 36500 }), 650000, { from: '2025-01-01', to: '2025-12-31' }, ctx, 100)
  assert.equal(Math.round(650000 * mitFix.ratio), Math.round(29200 + (650000 - 36500) * 0.1))
  // Über plantFuel: Der eingetragene Anteil gilt für die Heizperiode, in der die Rechnung endet.
  const r = plantFuel(input({ rules: CALENDAR_RULES, h: period(CALENDAR_RULES, '2026-01'), deliveries: [delivery({ sharePermille: 900 })], items: [{ id: 'gas', period: '2026-01', amountCents: 650000, fuelDeliveryId: 'd' }] })) ?? assert.fail('kein Ergebnis')
  assert.deepEqual([r.lines[0]?.method, r.lines[0]?.sharePermille], ['entered', 900])
})

test('Zählerstand: Wechsel mit Endstand zählt, ohne Endstand oder ohne Stand an der Grenze keine Menge (Review Focus 4)', () => {
  const r = { from: '2025-03-15', to: '2025-12-31' }
  const mitWechsel = [{ date: '2025-03-14', value: 1000 }, { date: '2025-06-30', value: 0, replacement: true, oldEndValue: 2500 }, { date: '2025-12-31', value: 3000 }]
  assert.equal(meterQuantity(mitWechsel, r), 4500)
  assert.equal(meterQuantity([{ date: '2025-03-14', value: 1000 }, { date: '2025-06-30', value: 0, replacement: true, oldEndValue: null }, { date: '2025-12-31', value: 3000 }], r), null)
  assert.equal(meterQuantity([{ date: '2025-03-13', value: 1000 }, { date: '2025-12-31', value: 3000 }], r), null)
  // Zwei Stände am Stichtag: Es gilt der letzte.
  assert.equal(meterQuantity([{ date: '2025-03-14', value: 900 }, { date: '2025-03-14', value: 1000 }, { date: '2025-12-31', value: 3000 }], r), 2000)
})

test('Abdeckung (Entwurf 3.3): 848,71 ‰, Lücke 15.03.–30.04.2026 mit 151,29 ‰', () => {
  const c = coverageOf(H, [{ from: '2025-03-15', to: '2026-03-14' }], table)
  assert.equal(c.permille.toFixed(2), '848.71')
  assert.deepEqual(c.gaps, [{ from: '2026-03-15', to: '2026-04-30' }])
  assert.deepEqual(coverageOf(H, [], table).gaps, [{ from: H.from, to: H.to }])
})

// ---------- Überträge (Entwurf 8.2, Fälle a–f; `fixed_cents = null`) ----------

const GAS = delivery({})
const gasItem = { id: 'gas', period: '2025-05', amountCents: 650000, fuelDeliveryId: 'd' }
const VORJAHR = delivery({ id: 'd0', label: 'Gas 2024/2025', invoiceFrom: '2024-03-15', invoiceTo: '2025-03-14', emissionsKg: 12000, co2CostCents: 60000 })
const vorjahrItem = { id: 'gas0', period: '2024-05', amountCents: 600000, fuelDeliveryId: 'd0' }
const schaetzung = (cents: number) => delivery({ id: 'e', label: 'Schätzung', invoiceFrom: '2025-03-15', invoiceTo: '2025-04-30', amountCents: cents, estimated: true })
function input(over: Partial<FuelPlantInput>): FuelPlantInput {
  return { method: 'manual', h: H, rules: MAI, deliveries: [GAS], items: [gasItem], frozen: [], closed: new Set(), ctx, ...over }
}
const carryOf = (r: ReturnType<typeof plantFuel>, id = 'd') => r?.carries.find((c) => c.deliveryId === id) ?? assert.fail(`kein Übertrag ${id}`)

test('Fall a: H−1 offen; H bucht 983,39 € hinaus, H−1 herein; die Summe bleibt 6.500,00 €', () => {
  const aus = carryOf(plantFuel(input({})))
  assert.deepEqual([aus.kind, aus.other.key, aus.cents, aus.landlord], ['out', '2024-05', -98339, [{ reason: 'fuelCarry', cents: 98339 }]])
  assert.equal(aus.templates.reduce((a, t) => a + t.raw, 0).toFixed(6), (-98339).toFixed(6))
  const herein = carryOf(plantFuel(input({ h: H1 })))
  assert.deepEqual([herein.kind, herein.cents, herein.landlord], ['in', 98339, [{ reason: 'fuelCarry', cents: -98339 }]])
  assert.equal(650000 + aus.cents + herein.cents, 650000)
})

test('Fall b: H−1 mit Schätzung 907,74 € abgeschlossen; H bucht 983,39 € hinaus, 75,65 € Differenz', () => {
  const r = plantFuel(input({ deliveries: [GAS, schaetzung(90774)], closed: new Set(['2024-05']), frozen: [{ deliveryId: 'e', period: '2024-05', cents: 90774, emissionsKg: 0, co2Cents: 0 }] }))
  const aus = carryOf(r)
  assert.equal(aus.cents, -98339)
  assert.deepEqual(aus.landlord, [{ reason: 'fuelCarry', cents: 90774 }, { reason: 'fuelEstimateDiff', cents: 7565 }])
  assert.deepEqual(aus.estimate, { cents: 90774, ids: ['e'], ratios: [1] })
  assert.equal(551661 + 90774 + 7565, 650000, 'Summe 5.516,61 + 907,74 + 75,65 = 6.500,00 €')
})

test('Fall c: H−1 ohne Schätzung abgeschlossen; 983,39 € beim Vermieter', () => {
  const aus = carryOf(plantFuel(input({ closed: new Set(['2024-05']) })))
  assert.deepEqual(aus.landlord, [{ reason: 'fuelClosedPeriod', cents: 98339 }])
})

test('Fall d: eingefrorener Wert geht vor, auch wenn ein später erfasster Zählerstand 200 ‰ ergäbe', () => {
  const readings = [{ date: '2025-03-14', value: 0 }, { date: '2025-04-30', value: 200 }, { date: '2026-03-14', value: 1000 }]
  const offen = carryOf(plantFuel(input({ ctx: { ...ctx, readings } })))
  assert.equal(offen.cents, -130000)
  const zu = carryOf(plantFuel(input({ ctx: { ...ctx, readings }, closed: new Set(['2024-05']), frozen: [{ deliveryId: 'd', period: '2024-05', cents: 98339, emissionsKg: 0, co2Cents: 0 }] })))
  assert.deepEqual([zu.cents, zu.frozen, zu.landlord], [-98339, true, [{ reason: 'fuelCarry', cents: 98339 }]])
})

test('Fall e: Schätzung 1.050,00 € zu hoch; Differenz −66,61 €', () => {
  const r = plantFuel(input({ deliveries: [GAS, schaetzung(105000)], closed: new Set(['2024-05']), frozen: [{ deliveryId: 'e', period: '2024-05', cents: 105000, emissionsKg: 0, co2Cents: 0 }] }))
  assert.deepEqual(carryOf(r).landlord, [{ reason: 'fuelCarry', cents: 105000 }, { reason: 'fuelEstimateDiff', cents: -6661 }])
})

test('Fall f: H−1 wieder offen; die Schätzung ist durch die echte Rechnung ersetzt und zählt nicht (Review Focus 3)', () => {
  const r = plantFuel(input({ deliveries: [GAS, schaetzung(90774)] }))
  assert.deepEqual(carryOf(r).landlord, [{ reason: 'fuelCarry', cents: 98339 }])
  const vorher = plantFuel(input({ h: H1, deliveries: [GAS, schaetzung(90774)] }))
  assert.ok(!vorher?.carries.some((c) => c.deliveryId === 'e'), 'die ersetzte Schätzung bucht nichts')
  assert.equal(carryOf(vorher).cents, 98339)
})

test('Schätzvorschlag (Entwurf 8.2 Fall b): 6.000 € · 151,29 ‰ = 907,74 €, kg und CO₂ im selben Verhältnis', () => {
  const r = plantFuel(input({ h: H1, deliveries: [VORJAHR], items: [vorjahrItem] })) ?? assert.fail('kein Ergebnis')
  const lücke = r.gaps.find((g) => g.from === '2025-03-15') ?? assert.fail('keine Lücke')
  assert.deepEqual([lücke.to, lücke.days, lücke.permille.toFixed(2)], ['2025-04-30', 47, '151.29'])
  assert.deepEqual(lücke.estimate, { from: '2025-03-15', to: '2025-04-30', amountCents: 90774, emissionsKg: 1815.5, co2CostCents: 9077, energyKwh: null, basedOn: 'Gas 2024/2025', byMeter: false, factorPermille: 151.29 })
  // Beim Messdienst gibt es keinen Vorschlag: Seine Beträge sind schon da, geschätzt würde nur Geld,
  // das niemand verteilt.
  assert.equal(plantFuel(input({ method: 'service', h: H1, deliveries: [{ ...VORJAHR, amountCents: 600000 }], items: [] }))?.gaps[0]?.estimate, null)
})

test('Messdienst (G-A3): C ganz aus den angesetzten Rechnungen, E auf die Heizperiode umgerechnet', () => {
  const g = delivery({ amountCents: 311747, emissionsKg: 5406.17, co2CostCents: 60000 })
  const r = plantFuel(input({ method: 'service', deliveries: [g], items: [] })) ?? assert.fail('kein Ergebnis')
  assert.deepEqual([r.serviceCo2Cents, r.serviceGrossCents, r.carries.length], [60000, 311747, 0])
  near(r.emissionsKg ?? 0, 5406.17, 'E umgerechnet = E der Rechnung', 1e-6)
  // Abgegrenzt wären es nur 848,71 ‰; so rechnet die eigene Aufteilung bei freien Schlüsseln.
  assert.equal(r.co2Cents, 50923)
  assert.equal(r.coveragePermille.toFixed(2), '848.71')
  // Nicht angesetzt: kein C beim Messdienst.
  assert.equal(plantFuel(input({ method: 'service', deliveries: [{ ...g, usedByService: false }], items: [] }))?.serviceCo2Cents, null)
})

test('Ohne Lieferung, die die Heizperiode berührt, und ohne Übertrag gibt es kein Ergebnis', () => {
  assert.equal(plantFuel(input({ h: period(MAI, '2027-05') })), null)
})

test('Heizung PR 10: der Schätzvorschlag trägt die kWh im Verhältnis des verbrauchsabhängigen Teils, die Bewertung je Lieferung die kWh in der Heizperiode', () => {
  const mitKwh = plantFuel(input({ h: H1, deliveries: [{ ...VORJAHR, energyKwh: 30000 }], items: [] }))
  const gap = mitKwh?.gaps[0]?.estimate
  if (gap) assert.equal(typeof gap.energyKwh, 'number')
  const line = plantFuel(input({ deliveries: [{ ...GAS, energyKwh: 60000 }] }))?.lines[0] ?? assert.fail('keine Zeile')
  assert.ok(line.energyKwh !== null && Math.abs(line.energyKwh - 60000 * (line.sharePermille / 1000)) < 1e-6)
})

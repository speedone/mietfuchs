// Heizkostenverteiler und Ablesedienst in der eigenen Heizkostenabrechnung (Heizung PR 12). Kern ist
// die Gleichrangigkeit nach § 5 Abs. 1 Satz 1 HeizkostenV: Dieselben bewerteten Einheiten ergeben
// dieselben Beträge, ob sie von Wärmezählern, Heizkostenverteilern oder einem Ablesedienst kommen.
// Grundlage ist Beispiel A aus server/testing/selfHeating.ts (PR 11): Wärmezähler `wz-a`, `wz-b`,
// `wz-c`, Anlage `hp`, Heizperiode 2025.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, meterSegments, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot, SnapshotReading } from '../src/snapshot.ts'
import type { CaptureMethod, CostItem, HeatingPlant, HeatingServiceValue, Meter, Reading } from '../../shared/types.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { dayAfter } from '../../shared/law/register.ts'
import { selfDelivery, selfMeter, selfMeters, selfReading, selfReadings, selfRow, selfSnapshot, selfUnit } from '../testing/selfHeating.ts'
import { periodKey } from '../../shared/period.ts'

const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const selfOf = (s: ComputedSettlement) => s.heating?.find((h) => h.plantId === 'hp')?.self ?? assert.fail('kein Ausweis der Anlage hp')
const amounts = (s: ComputedSettlement) => s.statements.map((st) => [st.tenancyId, st.totalShareCents, st.rows.map((r) => [r.costItemId, r.shareCents])])
const HEAT = ['wz-a', 'wz-b', 'wz-c']
// Die Zähler von Beispiel A, wie `selfSnapshot` sie anlegt, als Datensätze des Modells.
const METERS = () => [
  selfMeter('wz-a', 'a', 'Wärme A', 'waerme'), selfMeter('xw-a', 'a', 'Warmwasser A', 'warmwasser'),
  selfMeter('wz-b', 'b', 'Wärme B', 'waerme'), selfMeter('xw-b', 'b', 'Warmwasser B', 'warmwasser'),
  selfMeter('wz-c', 'c', 'Wärme C', 'waerme'), selfMeter('xw-c', 'c', 'Warmwasser C', 'warmwasser'),
  selfMeter('ww', null, 'Wärmezähler Warmwasserspeicher', 'waerme', { heatingPlantId: 'hp', heatingRole: 'dhwHeat' }),
]
const withCapture = (s: Snapshot, capture: CaptureMethod): Snapshot => ({
  ...s, heatingPlants: (s.heatingPlants ?? []).map((p) => (p.id === 'hp' ? { ...p, capture, selfSpans: (p.selfSpans ?? []).map((x) => ({ ...x, capture })) } : p)),
})

// Die Wärmezähler von Beispiel A als Heizkostenverteiler mit Einheitsskala und Faktor 2, die Ablesungen
// halbiert: dieselben bewerteten Einheiten.
function asHca(s: Snapshot, factor: number | null = 2): Snapshot {
  return {
    ...withCapture(s, 'hca'),
    meters: s.meters.map((m) => (HEAT.includes(m.id) ? { ...m, type: 'hkv' as const, hcaScale: 'unit' as const, ratingFactor: factor } : m)),
    readings: s.readings.map((r): SnapshotReading => (HEAT.includes(r.meterId)
      ? { ...r, value: r.value / 2, ...(r.oldEndValue !== undefined && r.oldEndValue !== null ? { oldEndValue: r.oldEndValue / 2 } : {}) }
      : r)),
  }
}

// Dieselben Werte als Zeilen eines Ablesedienstes: je Segment eines Wärmezählers eine Zeile; die
// Wärmezähler der Wohnungen fallen weg.
function serviceRowsOf(base: Snapshot): HeatingServiceValue[] {
  return base.meters.filter((m) => HEAT.includes(m.id)).flatMap((m) =>
    meterSegments(base.readings.filter((r) => r.meterId === m.id)).segments
      .filter((seg) => seg.from >= '2024-12-31' && seg.to <= '2025-12-31')
      .map((seg) => ({ plantId: 'hp', period: periodKey('2025-01'), unitId: m.unitId ?? '', from: dayAfter(seg.from), to: seg.to, heatValue: seg.delta, waterValue: null, heatUnit: 'units' })))
}
function asService(): Snapshot {
  const base = selfSnapshot()
  return withCapture(selfSnapshot({ serviceValues: serviceRowsOf(base), meters: METERS().filter((m) => !HEAT.includes(m.id)) }), 'serviceValues')
}

test('Wärmezähler wie bisher (Beispiel A): keine neuen Hinweise, kein Geräteausweis, kWh', () => {
  const s = computeSettlement(selfSnapshot())
  for (const c of ['heating.device-cutoff', 'heating.mixed-capture', 'heating.hca-factor-missing']) assert.ok(!codes(s).includes(c), c)
  assert.equal(selfOf(s).devices, undefined)
  assert.equal(selfOf(s).serviceValues, undefined)
  assert.equal(selfOf(s).pots.find((p) => p.pot === 'heating')?.consumptionUnit, 'kWh')
})

test('§ 5 Abs. 1 Satz 1: Heizkostenverteiler mit denselben bewerteten Einheiten ergeben dieselben Beträge wie Wärmezähler', () => {
  const base = selfSnapshot()
  const hca = computeSettlement(asHca(base))
  assert.deepEqual(amounts(hca), amounts(computeSettlement(base)))
  assert.ok(!codes(hca).some((c) => c === 'heating.hca-factor-missing' || c === 'heating.mixed-capture'), codes(hca).join(', '))
  const lines = selfOf(hca).devices ?? assert.fail('kein Geräteausweis')
  // Je Nutzer eine Zeile (Durchsicht von #241, Recht-I1): C1 bis zum Wechsel, C2 danach.
  assert.deepEqual(lines.map((l) => [l.meterId, l.userKeys, l.from, l.to]), [
    ['wz-a', ['A'], '2025-01-01', '2025-12-31'], ['wz-b', ['B'], '2025-01-01', '2025-12-31'],
    ['wz-c', ['C1'], '2025-01-01', '2025-09-30'], ['wz-c', ['C2'], '2025-10-01', '2025-12-31'],
  ])
  assert.ok(lines.every((l) => l.scale === 'unit' && l.factor === 2 && l.rated === l.raw * 2))
  // 12.000 + 16.000 + 12.000 kWh = 40.000 bewertete Einheiten, je Gerät die Hälfte abgelesen.
  assert.deepEqual(lines.map((l) => l.raw), [6000, 8000, 3600, 2400])
  const pot = selfOf(hca).pots.find((p) => p.pot === 'heating')
  assert.equal(pot?.consumptionUnit, 'Einheiten')
  assert.equal(pot?.consumption, 40000)
  // Der Rechenweg nennt Einheiten statt kWh.
  const steps = hca.statements.flatMap((st) => st.rows.flatMap((r) => r.steps ?? []))
  assert.ok(steps.some((x) => /von 40\.000 Einheiten/.test(x.value)), 'Rechenweg mit Einheiten')
  assert.ok(!steps.some((x) => /kWh/.test(x.value) && /Verbrauchskosten Heizung/.test(x.label)))
})

test('Produktskala: der Faktor steckt im Wert; ein eingetragener Faktor ändert nichts', () => {
  const base = selfSnapshot()
  const product = (factor: number | null): Snapshot => ({
    ...withCapture(base, 'hca'),
    meters: base.meters.map((m) => (HEAT.includes(m.id) ? { ...m, type: 'hkv' as const, hcaScale: 'product' as const, ratingFactor: factor } : m)),
  })
  assert.deepEqual(amounts(computeSettlement(product(null))), amounts(computeSettlement(base)))
  assert.deepEqual(amounts(computeSettlement(product(3))), amounts(computeSettlement(base)))
})

test('Ablesedienst mit denselben Einheiten: dieselben Beträge; die Zeilen stehen im Ausweis', () => {
  const service = computeSettlement(asService())
  assert.deepEqual(amounts(service), amounts(computeSettlement(selfSnapshot())))
  assert.equal((selfOf(service).serviceValues ?? []).length, 4)
  assert.equal(selfOf(service).pots.find((p) => p.pot === 'heating')?.consumptionUnit, 'Einheiten')
  // Wärmezähler, die noch an den Wohnungen hängen, zählen beim Ablesedienst nicht.
  // (Nur an A ein alter Wärmezähler: zählte er mit, hätte A doppelt so viel wie die übrigen.)
  const mitZaehlern = withCapture(selfSnapshot({ serviceValues: serviceRowsOf(selfSnapshot()), meters: METERS().filter((m) => m.id !== 'wz-b' && m.id !== 'wz-c') }), 'serviceValues')
  assert.deepEqual(amounts(computeSettlement(mitZaehlern)), amounts(computeSettlement(selfSnapshot())))
})

test('Ablesedienst liefert auch das Warmwasser: dann zählen seine Werte statt der Warmwasserzähler', () => {
  const base = selfSnapshot()
  const water = (unitId: string) => {
    const id = `xw-${unitId}`
    return meterSegments(base.readings.filter((r) => r.meterId === id)).segments.filter((seg) => seg.from >= '2024-12-31' && seg.to <= '2025-12-31')
  }
  const rows = serviceRowsOf(base).map((r) => ({ ...r, waterValue: water(r.unitId).find((seg) => seg.to === r.to)?.delta ?? assert.fail(`kein Wasser ${r.unitId} ${r.to}`) }))
  const ohneZaehler = withCapture(selfSnapshot({ serviceValues: rows, meters: METERS().filter((m) => !HEAT.includes(m.id) && !m.id.startsWith('xw-')) }), 'serviceValues')
  assert.deepEqual(amounts(computeSettlement(ohneZaehler)), amounts(computeSettlement(base)))
})

test('Fehlender Faktor (hca-factor-missing) und gemischte Geräte (mixed-capture): Fehler mit Satz, Anlage nicht verteilt', () => {
  const ohneFaktor = computeSettlement(asHca(selfSnapshot(), null))
  const n = ohneFaktor.notices.find((x) => x.code === 'heating.hca-factor-missing') ?? assert.fail('kein Fehler')
  assert.equal(n.level, 'error')
  assert.match(n.text, /fehlt .*der Bewertungsfaktor.*Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht/s)
  assert.equal(selfOf(ohneFaktor).ok, false)
  const gemischt = asHca(selfSnapshot())
  const zurueck: Snapshot = { ...gemischt, meters: gemischt.meters.map((m) => (m.id === 'wz-a' ? { ...m, type: 'waerme' as const, hcaScale: null, ratingFactor: null } : m)) }
  const s = computeSettlement(zurueck)
  const m = s.notices.find((x) => x.code === 'heating.mixed-capture') ?? assert.fail('kein Fehler')
  assert.equal(m.level, 'error')
  assert.match(m.text, /Wärmezähler bei A und Heizkostenverteiler bei B und C.*Vorerfassung/s)
  assert.equal(selfOf(s).ok, false)
  // Ein Heizkostenverteiler neben dem Wärmezähler einer Wohnung stört nicht (Durchsicht von #241, C1, Test unten).
})

test('Gerätestichtag mitten in der Heizperiode: Hinweis am Gerät, gerechnet wird mit den Werten, wie sie sind', () => {
  const base = asHca(selfSnapshot())
  // wz-a hat nach asHca 500 am 31.12.2024 und 6.500 am 31.12.2025; am 30.06. setzt er mit 3.000 auf 0 zurück.
  const mitReset: Snapshot = {
    ...base,
    readings: base.readings.map((r) => (r.meterId === 'wz-a' && r.date === '2025-12-31' ? { ...r, value: 3500 } : r))
      .concat([{ meterId: 'wz-a', date: '2025-06-30', value: 0, replacement: true, oldEndValue: 3000 }]),
  }
  const s = computeSettlement(mitReset)
  const n = s.notices.find((x) => x.code === 'heating.device-cutoff') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'wz-a' })
  assert.match(n.text, /hat am 30\.06\.2025 auf null zurückgesetzt/)
  // (3.000 − 500) + 3.500 = 6.000 Einheiten, wie ohne Rücksetzung: dieselben Beträge.
  assert.deepEqual(amounts(s), amounts(computeSettlement(base)))
})

test('Erfassung je Zeitraum: ein früherer Zeitraum mit Wärmezählern rechnet weiter mit ihnen, auch wenn die Anlage jetzt Heizkostenverteiler hat', () => {
  const base = selfSnapshot()
  const spaeter: Snapshot = {
    ...base,
    heatingPlants: (base.heatingPlants ?? []).map((p) => (p.id === 'hp'
      ? { ...p, capture: 'hca', selfSpans: [{ from: '2025-01', until: '2026-01', capture: 'heatMeter' }, { from: '2026-01', until: null, capture: 'hca' }] }
      : p)),
  }
  const s = computeSettlement(spaeter)
  assert.deepEqual(amounts(s), amounts(computeSettlement(base)))
  assert.equal(selfOf(s).pots.find((p) => p.pot === 'heating')?.consumptionUnit, 'kWh')
})

test('Ablesedienst nach einer abgeschlossenen Heizperiode: deren eingefrorener Endstand gilt für den gedachten Zähler nicht', () => {
  // Die Zeilen jeder Heizperiode zählen von 0 an; ein Endstand der Vorperiode als Anfangsstand machte den
  // Verbrauch negativ oder zu klein.
  const s = asService()
  const mitEnde: Snapshot = { ...s, selfClosedEnds: [{ plantId: 'hp', boundary: '2024-12-31', meterId: 'ablesedienst-heizung:a', date: '2024-12-31', value: 9000 }] }
  assert.deepEqual(amounts(computeSettlement(mitEnde)), amounts(computeSettlement(selfSnapshot())))
})

// ---------- Korrekturrunde 1 (Durchsicht von #241) ----------

test('Durchsicht #241 C1: Wechsel Wärmezähler → Heizkostenverteiler zum 31.12.; keine der beiden Heizperioden ist gesperrt', () => {
  const spans = { selfSpans: [{ from: periodKey('2025-01'), until: periodKey('2026-01'), capture: 'heatMeter' as const }, { from: periodKey('2026-01'), until: null, capture: 'hca' as const }] }
  const base = selfSnapshot({ plant: spans })
  const hkv = ['a', 'b', 'c'].map((u) => selfMeter(`hkv-${u}`, u, `HKV ${u}`, 'hkv', { hcaScale: 'unit', ratingFactor: 1.5 }))
  const meters = [...METERS(), ...hkv]
  // Die neuen Geräte haben am 31.12.2025 ihren ersten Stand; die Wärmezähler ihren letzten.
  const readings2025 = [...selfSnapshot().readings.map((r) => selfReading(r.meterId, r.date, r.value)), ...['a', 'b', 'c'].map((u) => selfReading(`hkv-${u}`, '2025-12-31', 0))]
  const s25 = computeSettlement(selfSnapshot({ plant: spans, meters, readings: readings2025 }))
  assert.ok(!codes(s25).includes('heating.mixed-capture'), codes(s25).join(', '))
  assert.deepEqual(amounts(s25), amounts(computeSettlement(base)))
  const readings2026 = [...readings2025, ...['a', 'b', 'c'].map((u, i) => selfReading(`hkv-${u}`, '2026-12-31', 100 * (i + 1)))]
  const s26 = computeSettlement(selfSnapshot({ year: 2026, plant: spans, meters, readings: readings2026 }))
  assert.ok(!codes(s26).some((c) => c === 'heating.mixed-capture' || c === 'heating.hca-factor-missing'), codes(s26).join(', '))
  // 2026 zählen die Heizkostenverteiler: 100, 200, 300 Einheiten mal Faktor 1,5.
  assert.equal(selfOf(s26).pots.find((p) => p.pot === 'heating')?.consumption, 900)
})

test('Durchsicht #241 C1: Ein Heizkostenverteiler neben dem Wärmezähler derselben Wohnung macht nichts gemischt; gemischt ist eine Wohnung ohne Wärmezähler, aber mit Heizkostenverteiler', () => {
  const base = selfSnapshot()
  const hkv = ['a', 'b', 'c'].map((u) => selfMeter(`hkv-${u}`, u, `HKV ${u}`, 'hkv'))
  const hkvReadings = ['a', 'b', 'c'].flatMap((u) => [selfReading(`hkv-${u}`, '2024-12-31', 0), selfReading(`hkv-${u}`, '2025-12-31', 400)])
  const both = computeSettlement(selfSnapshot({ meters: [...METERS(), ...hkv], readings: [...base.readings.map((r) => selfReading(r.meterId, r.date, r.value)), ...hkvReadings] }))
  assert.ok(!codes(both).includes('heating.mixed-capture'), codes(both).join(', '))
  assert.deepEqual(amounts(both), amounts(computeSettlement(base)))
  // A ohne Wärmezähler, aber mit Heizkostenverteiler: gemischt.
  const ohneA = selfSnapshot({ meters: [...METERS().filter((m) => m.id !== 'wz-a'), ...hkv], readings: [...base.readings.filter((r) => r.meterId !== 'wz-a').map((r) => selfReading(r.meterId, r.date, r.value)), ...hkvReadings] })
  const m = computeSettlement(ohneA).notices.find((n) => n.code === 'heating.mixed-capture') ?? assert.fail('nicht gemischt')
  assert.match(m.text, /Heizkostenverteiler bei A/)
  assert.doesNotMatch(m.text, /nehmen Sie es .*heraus/)
  assert.match(m.text, /eigenen Wärmezähler/)
})

test('Durchsicht #241 I1: Kesseltausch mit Werten des Ablesedienstes; die neue Anlage liest die Werte über die Linie', () => {
  const svc = { capture: 'serviceValues' as const, selfSpans: [{ from: periodKey('2025-01'), until: null, capture: 'serviceValues' as const }] }
  const old = selfSnapshot({ plant: svc }).heatingPlants?.[0] ?? assert.fail('keine Anlage')
  const hp2: HeatingPlant = { ...(old as HeatingPlant), id: 'hp2', name: 'neu', replacesPlantId: 'hp', heatGeneration: 'single', heatPumpMajority: null }
  const item = (id: string, plant: string, amountCents: number, extra: Partial<CostItem> = {}): CostItem => ({ id, propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: id, amountCents, key: 'heatingSystem', heatingPlantId: plant, heatingPart: 'fuel', heatingTarget: 'both', ...extra })
  const rows = (plantId: string): HeatingServiceValue[] => [
    { plantId, period: periodKey('2025-01'), unitId: 'a', from: '2025-01-01', to: '2025-12-31', heatValue: 1000, waterValue: null, heatUnit: 'units' },
    { plantId, period: periodKey('2025-01'), unitId: 'b', from: '2025-01-01', to: '2025-12-31', heatValue: 3000, waterValue: null, heatUnit: 'units' },
    { plantId, period: periodKey('2025-01'), unitId: 'c', from: '2025-01-01', to: '2025-09-30', heatValue: 500, waterValue: null, heatUnit: 'units' },
    { plantId, period: periodKey('2025-01'), unitId: 'c', from: '2025-10-01', to: '2025-12-31', heatValue: 500, waterValue: null, heatUnit: 'units' },
  ]
  const run = (serviceValues: HeatingServiceValue[]) => computeSettlement(selfSnapshot({
    plant: { ...svc, name: 'alt', endsOn: '2025-06-30', heatGeneration: 'single' }, plants: [hp2],
    rows: [selfRow({}, 2025, 'hp2')],
    deliveries: [
      selfDelivery({ id: 'd1', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30', energyKwh: 30000 }),
      selfDelivery({ id: 'd2', plantId: 'hp2', invoiceFrom: '2025-07-01', invoiceTo: '2025-12-31', energyKwh: 30000 }),
    ],
    costItems: [item('gas1', 'hp', 300000, { fuelDeliveryId: 'd1' }), item('gas2', 'hp2', 300000, { fuelDeliveryId: 'd2' })],
    serviceValues,
    readings: [...selfSnapshot().readings.map((r) => selfReading(r.meterId, r.date, r.value)), selfReading('ww', '2025-06-30', 4500)],
  }))
  const nurAlt = run(rows('hp'))
  assert.deepEqual(amounts(nurAlt), amounts(run([...rows('hp'), ...rows('hp2')])))
  assert.deepEqual(amounts(nurAlt), amounts(run(rows('hp2'))))
  const neu = nurAlt.heating?.find((h) => h.plantId === 'hp2')?.self ?? assert.fail('kein Ausweis hp2')
  assert.equal(neu.pots.find((p) => p.pot === 'heating')?.byAreaOnly, false)
  assert.equal(neu.serviceValues?.length, 4)
})

test('Durchsicht #241 I2: die Warmwasserbereitung gehört zum Zeitraum; eine spätere Änderung an der Anlage stellt 2025 nicht um', () => {
  const base = selfSnapshot()
  const spaeter = selfSnapshot({ plant: { hotWater: 'none', selfSpans: [{ from: periodKey('2025-01'), until: periodKey('2026-01'), capture: 'heatMeter', hotWater: 'combined' }, { from: periodKey('2026-01'), until: null, capture: 'heatMeter', hotWater: 'none' }] } })
  assert.deepEqual(amounts(computeSettlement(spaeter)), amounts(computeSettlement(base)))
  assert.equal(selfOf(computeSettlement(spaeter)).hotWater, 'combined')
})

test('Durchsicht #241 Minor 7: der Hinweis zur Fernablesbarkeit nennt Gerät und Wohnung', () => {
  const base = asHca(selfSnapshot())
  const s = computeSettlement({ ...base, meters: base.meters.map((m) => (m.id === 'wz-a' ? { ...m, name: 'Wohnzimmer', remoteReadable: false, installedOn: '2023-03-01' } : m)) })
  const n = s.notices.find((x) => x.code === 'heating.remote-reading-missing' || x.code === 'heating.remote-reading') ?? assert.fail(codes(s).join(', '))
  assert.match(n.text, /„Wohnzimmer“ \(A\)/)
})

test('Durchsicht #241 Recht-I4: Ablesedienst mit Einheiten und kWh gemischt ist § 5 Abs. 7; nur kWh zählt in kWh', () => {
  const base = selfSnapshot()
  const rows = serviceRowsOf(base)
  const gemischt = withCapture(selfSnapshot({ serviceValues: rows.map((r) => (r.unitId === 'a' ? { ...r, heatUnit: 'kWh' as const } : r)), meters: METERS().filter((m) => !HEAT.includes(m.id)) }), 'serviceValues')
  const m = computeSettlement(gemischt).notices.find((n) => n.code === 'heating.mixed-capture') ?? assert.fail('nicht gemischt')
  assert.equal(m.level, 'error')
  assert.match(m.text, /bei A in kWh.*§ 5 Abs\. 7.*eigenen Wärmezähler/s)
  const kwh = computeSettlement(withCapture(selfSnapshot({ serviceValues: rows.map((r) => ({ ...r, heatUnit: 'kWh' as const })), meters: METERS().filter((m2) => !HEAT.includes(m2.id)) }), 'serviceValues'))
  assert.equal(selfOf(kwh).pots.find((p) => p.pot === 'heating')?.consumptionUnit, 'kWh')
  assert.deepEqual(amounts(kwh), amounts(computeSettlement(base)))
})

test('Durchsicht #241 N1: Wechsel Wärmezähler → Heizkostenverteiler am 30.06. in einer Wohnung ist gemischt, statt den Verbrauch des Wärmezählers still wegzulassen', () => {
  const hkv = (u: string) => selfMeter(`hk-${u}`, u, `HKV ${u}`, 'hkv', { hcaScale: 'product' })
  const wz = (u: string) => selfMeter(`wz-${u}`, u, `WZ ${u}`, 'waerme')
  const xw = (u: string) => selfMeter(`xw-${u}`, u, `WW ${u}`, 'warmwasser')
  const dhw = selfMeter('ww', null, 'Speicher', 'waerme', { heatingPlantId: 'hp', heatingRole: 'dhwHeat' })
  const water = [
    selfReading('xw-a', '2024-12-31', 10), selfReading('xw-a', '2025-12-31', 40),
    selfReading('xw-b', '2024-12-31', 0), selfReading('xw-b', '2025-12-31', 40),
    selfReading('xw-c', '2024-12-31', 5), selfReading('xw-c', '2025-09-30', 43), selfReading('xw-c', '2025-12-31', 55),
    selfReading('ww', '2024-12-31', 0), selfReading('ww', '2025-12-31', 9000),
  ]
  const hkR = (u: string, e: number, c?: number) => [selfReading(`hk-${u}`, '2024-12-31', 0), ...(c !== undefined ? [selfReading(`hk-${u}`, '2025-09-30', c)] : []), selfReading(`hk-${u}`, '2025-12-31', e)]
  const plantOf = (capture: CaptureMethod) => ({ capture, selfSpans: [{ from: periodKey('2025-01'), until: null, capture, hotWater: 'combined' as const }] })
  const run = (capture: CaptureMethod, meters: Meter[], readings: Reading[]) =>
    computeSettlement(selfSnapshot({ plant: plantOf(capture), meters: [...meters, dhw, xw('a'), xw('b'), xw('c')], readings: [...water, ...readings] }))
  const total = (s: ComputedSettlement, id: string) => s.statements.find((st) => st.tenancyId === id)?.totalShareCents
  // Referenz: alle Wohnungen ganzjährig mit Heizkostenverteilern, A trägt 1.794,28 €.
  const ref = run('hca', [hkv('a'), hkv('b'), hkv('c')], [...hkR('a', 1200), ...hkR('b', 1600), ...hkR('c', 1200, 720)])
  assert.equal(total(ref, 'A'), 179428)
  // A mit Wärmezähler bis 30.06. und Heizkostenverteiler ab 30.06.: Vorher zählte nur der
  // Heizkostenverteiler, A trug 1.349,39 €, der Verbrauch des ersten Halbjahrs fiel weg.
  const mid = [selfReading('hk-a', '2025-06-30', 0), selfReading('hk-a', '2025-12-31', 600), ...hkR('b', 1600), ...hkR('c', 1200, 720), selfReading('wz-a', '2024-12-31', 0), selfReading('wz-a', '2025-06-30', 6000)]
  const c = run('hca', [hkv('a'), hkv('b'), hkv('c'), wz('a')], mid)
  assert.notEqual(total(c, 'A'), 134939)
  const mixed = c.notices.find((n) => n.code === 'heating.mixed-capture') ?? assert.fail(`nicht gemischt: ${codes(c).join(', ')}`)
  assert.equal(mixed.level, 'error')
  assert.match(mixed.text, /Bei A wechselt das Gerät innerhalb der Heizperiode/)
  assert.match(mixed.text, /§ 9a HeizkostenV/)
  assert.match(mixed.text, /verteilt Mietfuchs die Heizkosten dieser Anlage nicht/)
  // Ohne den Wärmezähler bleibt es beim Grenzmodell: Die erste Ablesung gilt, wie sie ist.
  const c0 = run('hca', [hkv('a'), hkv('b'), hkv('c')], mid.filter((r) => r.meterId !== 'wz-a'))
  assert.ok(!codes(c0).includes('heating.mixed-capture'))
  assert.equal(total(c0, 'A'), 134939)
  // Erfassung mit Wärmezählern, A wechselt am 30.06. zum Heizkostenverteiler: dieselbe Regel, und die
  // Meldung zum fehlenden Stand des Wärmezählers nennt den Heizkostenverteiler.
  const wzR = [selfReading('wz-b', '2024-12-31', 0), selfReading('wz-b', '2025-12-31', 16000), selfReading('wz-c', '2024-12-31', 500), selfReading('wz-c', '2025-09-30', 7700), selfReading('wz-c', '2025-12-31', 12500)]
  const d = run('heatMeter', [wz('a'), wz('b'), wz('c'), hkv('a')], [...wzR, selfReading('wz-a', '2024-12-31', 1000), selfReading('wz-a', '2025-06-30', 7000), selfReading('hk-a', '2025-06-30', 0), selfReading('hk-a', '2025-12-31', 600)])
  assert.match(d.notices.find((n) => n.code === 'heating.mixed-capture')?.text ?? assert.fail('nicht gemischt'), /Bei A wechselt das Gerät/)
  assert.match(d.notices.find((n) => n.code === 'heating.self-incomplete')?.text ?? assert.fail('kein fehlender Stand'), /„WZ a“ \(A\) fehlt ein Stand zum 31\.12\.2025.*außerdem der Heizkostenverteiler „HKV a“/s)
})

test('#219 Rohrwärme: Mit Heizkostenverteilern steht ein Hinweis (hint) auf § 7 Abs. 1 Satz 3, mit Wärmezählern und Ablesedienst nicht; keine Zahl ändert sich', () => {
  const hca = computeSettlement(asHca(selfSnapshot()))
  const n = hca.notices.find((x) => x.code === 'heating.pipe-heat') ?? assert.fail(codes(hca).join(', '))
  assert.equal(n.level, 'hint')
  assert.match(n.text, /freiliegenden Leitungen der Wärmeverteilung überwiegend ungedämmt/)
  assert.match(n.text, /§ 7 Abs\. 1 Satz 3 HeizkostenV/)
  assert.match(n.text, /VDI 2077 Blatt 3\.5/)
  assert.match(n.text, /BGH VIII ZR 5\/16/)
  assert.match(n.text, /rechnet Mietfuchs nicht/)
  assert.doesNotMatch(n.text, /müssen Sie|ist verpflichtet|Pflicht/)
  assert.equal(hca.notices.filter((x) => x.code === 'heating.pipe-heat').length, 1)
  assert.ok(!codes(computeSettlement(selfSnapshot())).includes('heating.pipe-heat'))
  assert.ok(!codes(computeSettlement(asService())).includes('heating.pipe-heat'))
})

test('#218 Vorerfassung: In einem Gebäude, das überwiegend nicht dem Wohnen dient, nennt die eigene Abrechnung § 5 Abs. 7 Satz 2 als Möglichkeit (hint); sonst nicht, und die Beträge bleiben', () => {
  const base = selfSnapshot()
  const mixedUse: Snapshot = { ...base, heatingPlants: (base.heatingPlants ?? []).map((p) => (p.id === 'hp' ? { ...p, nonResidential: true } : p)) }
  const r = computeSettlement(mixedUse)
  const n = r.notices.find((x) => x.code === 'heating.pre-capture') ?? assert.fail(codes(r).join(', '))
  assert.equal(n.level, 'hint')
  assert.match(n.text, /bei unterschiedlichen Nutzungs- oder Gebäudearten oder aus anderen sachgerechten Gründen eine Vorerfassung nach Nutzergruppen durchführen \(§ 5 Abs\. 7 Satz 2 HeizkostenV\)/)
  assert.match(n.text, /Vorgeschrieben ist sie, wenn der Verbrauch nicht mit gleichen Ausstattungen erfasst wird \(Satz 1\)/)
  assert.match(n.text, /rechnet Mietfuchs nicht/)
  assert.ok(!codes(computeSettlement(base)).includes('heating.pre-capture'))
  const ohneCo2 = (s: ComputedSettlement) => s.statements.map((st) => [st.tenancyId, st.rows.filter((x) => !x.costItemId.startsWith('co2')).map((x) => [x.costItemId, x.shareCents])])
  assert.deepEqual(ohneCo2(r), ohneCo2(computeSettlement(base)))
})

// Durchsicht des Zweigs fix/heizung-hinweise: Die Ablesungen einer Wohnung passen je Topf zum Fehler. Hat B einen
// Warmwasserzähler, aber keinen Wärmezähler, stand an ihren Grenzen grün „abgelesen“ neben „B hat keinen Wärmezähler“.
test('Wohnung ohne Gerät für einen Topf: ihre Grenzen nennen den Topf, die übrigen Wohnungen nichts', () => {
  const ohneWaerme = computeSettlement(selfSnapshot({ meters: selfMeters().filter((m) => m.id !== 'wz-b'), readings: selfReadings().filter((r) => r.meterId !== 'wz-b') }))
  // Seit #690 kein Fehler mehr, sondern die Warnung mit dem Weg zur Abrechnung.
  assert.match(ohneWaerme.notices.find((n) => n.code === 'heating.unit-without-device')?.text ?? '', /B hat keinen Wärmezähler/)
  assert.deepEqual(selfOf(ohneWaerme).units.map((u) => [u.unitName, ...new Set(u.boundaries.map((b) => (b.noDevicePots ?? []).join('+')))]), [['A', ''], ['B', 'heating'], ['C', '']])
  // Kein Topf ist ganz ohne Gerät: Die Töpfe selbst melden nichts.
  assert.deepEqual(selfOf(ohneWaerme).pots.map((p) => p.noDevices), [undefined, undefined])
  const ohneAlles = computeSettlement(selfSnapshot({ meters: selfMeters().filter((m) => m.unitId === null) }))
  assert.deepEqual(selfOf(ohneAlles).units.map((u) => [u.unitName, ...new Set(u.boundaries.map((b) => (b.noDevicePots ?? []).join('+')))]), [['A', 'heating+water'], ['B', 'heating+water'], ['C', 'heating+water']])
  // Mit allen Geräten bleibt der Ausweis, wie er war.
  assert.ok(selfOf(computeSettlement(selfSnapshot())).units.every((u) => u.boundaries.every((b) => b.noDevicePots === undefined)))
})

// #723: Was die Berechnung ohne Skala tut. Sie rechnet nicht mit einer Annahme (etwa „wie abgelesen“): Schon ein Gerät
// ohne Skala sperrt die Verteilung der ganzen Anlage, der Fehler nennt das Gerät, und die Heizkosten bleiben beim Vermieter.
test('#723: ein einziger Heizkostenverteiler ohne Skala: Fehler nennt Gerät und Wohnung, kein Mieter trägt Heizkosten, nichts wird angenommen', () => {
  const mit = asHca(selfSnapshot())
  const ohneSkala: Snapshot = { ...mit, meters: mit.meters.map((m) => (m.id === 'wz-b' ? { ...m, hcaScale: null, ratingFactor: null } : m)) }
  const s = computeSettlement(ohneSkala)
  const n = s.notices.find((x) => x.code === 'heating.hca-factor-missing') ?? assert.fail(`kein Fehler, sondern: ${codes(s).join(', ')}`)
  assert.equal(n.level, 'error')
  assert.match(n.text, /Bei diesem Heizkostenverteiler fehlt „Wärme B“ \(B\): die Skala\./)
  assert.match(n.text, /Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht/)
  assert.equal(selfOf(s).ok, false)
  // Kein Mieter trägt eine Heizposition; alle 6.660,00 € stehen beim Vermieter.
  assert.deepEqual(s.statements.map((st) => st.totalShareCents), [0, 0, 0, 0])
  assert.equal(s.landlord.totalCents, 666000)
})

// #690: Eine Wohnung ohne Heizkostenverteiler, die übrigen mit. Vorher sperrte das die ganze Anlage (Fehler, alle Kosten
// beim Vermieter, jeder Mieter 0,00 €), auch für ein Jahr, in dem das Gerät wirklich fehlte. Jetzt trägt die Wohnung den
// Durchschnitt je m² der abgelesenen; über der Grenze des § 9a Abs. 2 geht der Topf nur nach Fläche. Eine Warnung nennt die
// Wohnung, die Kürzung nach § 12 Abs. 1 Satz 1 HeizkostenV je Mieter in Euro und den Weg zur Behebung.
const withoutDevice = (base: Snapshot, id: string): Snapshot => ({ ...base, meters: base.meters.filter((m) => m.id !== id), readings: base.readings.filter((r) => r.meterId !== id) })
const allRows = (s: ComputedSettlement) => s.statements.reduce((a, st) => a + st.rows.reduce((b, r) => b + r.shareCents, 0), 0) + s.landlord.rows.reduce((a, r) => a + r.shareCents, 0)

test('#690: Wohnung ohne Heizkostenverteiler über der Grenze (B, 80 von 200 m²): Heizung nur nach Fläche, Kürzung sicher für B, vorsorglich für die übrigen', () => {
  const mit = asHca(selfSnapshot())
  const s = computeSettlement(withoutDevice(mit, 'wz-b'))
  const ref = computeSettlement({ ...mit, meters: mit.meters.filter((m) => !HEAT.includes(m.id)), readings: mit.readings.filter((r) => !HEAT.includes(r.meterId)) })
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.equal(selfOf(s).ok, true)
  // Centgenau wie ohne ein einziges Gerät der Heizung: Topf Heizung nach Fläche, Warmwasser nach Verbrauch.
  assert.deepEqual(amounts(s), amounts(ref))
  assert.ok(s.statements.every((st) => st.totalShareCents > 0), 'jeder Mieter trägt seinen Anteil')
  assert.equal(allRows(s), s.totalCostsCents)
  const heating = selfOf(s).pots.find((p) => p.pot === 'heating') ?? assert.fail('kein Topf Heizung')
  assert.deepEqual([heating.overThreshold, heating.consumptionPct, heating.noDevices, heating.unequippedUnits], [true, 0, undefined, ['B']])
  assert.equal(selfOf(s).pots.find((p) => p.pot === 'water')?.unequippedUnits, undefined)
  for (const c of ['heating.no-consumption', 'heating.estimate-over-25']) assert.ok(!codes(s).includes(c), c)
  const n = s.notices.find((x) => x.code === 'heating.unit-without-device') ?? assert.fail(`keine Warnung, sondern: ${codes(s).join(', ')}`)
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'heatingCosts', id: 'hp' })
  assert.match(n.text, /^Heizanlage, Heizperiode 2025: B hat keinen Heizkostenverteiler, die übrigen Wohnungen schon\. Nicht erfasst ist der Verbrauch für 80 von 200 m² \(40 %\), mehr als 25 % der maßgeblichen Fläche; die Kosten der Heizung gehen deshalb nur nach Fläche \(wie § 9a Abs\. 2 HeizkostenV\)\./)
  // Die Beträge wie im Hinweis ganz ohne Gerät (dieselbe Verteilung, dieselbe Kürzung „soweit“), getrennt sicher/vorsorglich.
  const refText = ref.notices.find((x) => x.code === 'heating.no-consumption')?.text ?? assert.fail('kein Vergleich')
  const amount = (text: string, who: string) => new RegExp(`${who} \\([A-C]\\) (\\d+,\\d\\d €)`).exec(text)?.[1] ?? assert.fail(`${who} fehlt`)
  assert.match(n.text, new RegExp(`um 15 % kürzen \\(§ 12 Abs\\. 1 Satz 1 HeizkostenV\\), hier vom Topf Heizung nach CO₂-Abzug laut Ausweis: Mieter B \\(B\\) ${amount(refText, 'Mieter B')}\\. `))
  assert.ok(n.text.includes(`Vorsorglich, weil nicht entschieden (Auslegung), auch die übrigen: Mieter A (A) ${amount(refText, 'Mieter A')}, Mieter C1 (C) ${amount(refText, 'Mieter C1')} und Mieter C2 (C) ${amount(refText, 'Mieter C2')}. `), n.text)
  // Der Weg zur Behebung: Gerät anlegen, bei Ausfall oder anderem zwingendem Grund Schätzung nach § 9a.
  assert.match(n.text, /„Zähler & Stände“.*„Schätzung \(§ 9a\)“/s)
  const steps = s.statements.flatMap((st) => st.rows.flatMap((r) => r.steps ?? [])).filter((x) => x.label === 'Verbrauchskosten Heizung')
  assert.ok(steps.length > 0 && steps.every((x) => /nicht erfasst für 80 von 200 m² \(B ohne Heizkostenverteiler\).*nur nach Fläche verteilt/.test(x.value)), JSON.stringify(steps))
  // Mit allen Geräten bleibt alles, wie es war.
  const voll = computeSettlement(mit)
  assert.ok(!codes(voll).includes('heating.unit-without-device'))
  assert.equal(selfOf(voll).pots.find((p) => p.pot === 'heating')?.unequippedUnits, undefined)
})

// Unter der Grenze (C, 40 von 200 m² = 20 %): C trägt den Durchschnitt je m² von A und B, centgenau wie eine Schätzung nach
// dem Durchschnitt des Gebäudes. A: 6.000 · 2 = 12.000 Einheiten auf 60 m², B: 16.000 auf 100 m², also 175 je m², C 7.000.
test('#690: Wohnung ohne Heizkostenverteiler unter der Grenze: Durchschnitt je m², sicher für C, vorsorglich für A und B', () => {
  const units = [selfUnit('a', 60), selfUnit('b', 100), selfUnit('c', 40)]
  const mit = asHca(selfSnapshot({ units }))
  const s = computeSettlement(withoutDevice(mit, 'wz-c'))
  const est = computeSettlement({
    ...mit, readings: mit.readings.filter((r) => r.meterId !== 'wz-c'),
    heatingEstimates: [{ plantId: 'hp', period: periodKey('2025-01'), unitId: 'c', part: 'heat', value: 7000, method: 'buildingAverage', reason: 'Gerät defekt', confirmed: true, cause: 'deviceFailure', capture: 'hca', valueUnit: 'Einheiten' }],
  })
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.deepEqual(amounts(s), amounts(est))
  assert.equal(allRows(s), s.totalCostsCents)
  const heating = selfOf(s).pots.find((p) => p.pot === 'heating') ?? assert.fail('kein Topf Heizung')
  assert.deepEqual([heating.overThreshold, heating.byAreaOnly, heating.consumptionPct, heating.consumption, heating.substitutedConsumption, heating.unequippedUnits], [false, false, 70, 35000, 7000, ['C']])
  const n = s.notices.find((x) => x.code === 'heating.unit-without-device') ?? assert.fail(codes(s).join(', '))
  assert.match(n.text, /^Heizanlage, Heizperiode 2025: C hat keinen Heizkostenverteiler, die übrigen Wohnungen schon\. Mietfuchs setzt für sie den Durchschnitt je m² der abgelesenen Wohnungen an \(175 Einheiten je m²\)/)
  assert.match(n.text, /Festlegung von Mietfuchs, entschieden ist der Fall nicht/)
  // Sicher: die Mieter von C; vorsorglich: A und B. Je Topf Heizung nach CO₂-Abzug laut Ausweis.
  assert.match(n.text, /kürzen \(§ 12 Abs\. 1 Satz 1 HeizkostenV\), hier vom Topf Heizung nach CO₂-Abzug laut Ausweis: Mieter C1 \(C\) 98,78 € und Mieter C2 \(C\) 55,56 €\. /)
  assert.match(n.text, /Vorsorglich, weil nicht entschieden \(Auslegung\), auch die übrigen: Mieter A \(A\) 254,66 € und Mieter B \(B\) 362,70 €\. /)
  // Kern im Hinweis, Begründung in Anleitung und Lexikon (Durchsicht M2).
  assert.ok(n.text.length < 1000, `${n.text.length} Zeichen`)
  const steps = s.statements.find((st) => st.tenancyId === 'C1')?.rows.flatMap((r) => r.steps ?? []).filter((x) => x.label === 'Verbrauchskosten Heizung') ?? []
  assert.ok(steps.length > 0 && steps.every((x) => /\(kein Heizkostenverteiler: Durchschnitt der abgelesenen Wohnungen je m²\)/.test(x.value)), JSON.stringify(steps))
})

test('#690: beim Ablesedienst sperren fehlende Werte einer Wohnung weiter, mit dem Weg der Schätzung nach § 9a', () => {
  const svc = asService()
  const ohneWerte: Snapshot = { ...svc, heatingServiceValues: (svc.heatingServiceValues ?? []).filter((v) => v.unitId !== 'b') }
  const sv = computeSettlement(ohneWerte)
  assert.match(sv.notices.find((x) => x.code === 'heating.self-incomplete')?.text ?? '', /Für B fehlen die Werte des Ablesedienstes.*„Schätzung \(§ 9a\)“/s)
  assert.ok(!codes(sv).includes('heating.unit-without-device'))
})

// Durchsicht von #690, M1 und S3: Fehlen in beiden Töpfen Geräte, nennt jede Warnung nur ihren eigenen Topf (§ 12 Abs. 1
// Satz 1 „Soweit“, BGH VIII ZR 195/04: die Kürzung trifft nur die nicht verbrauchsabhängig abgerechneten Kosten), und die
// Summe beider Warnungen ist je Mieter 15 % seiner Heizkostenzeilen nach CO₂-Abzug, nicht das Doppelte. Sicher
// (Mieter der Wohnung ohne Gerät) und vorsorglich (übrige) stehen auch über der Grenze getrennt.
const HEAT_ITEMS = new Set(['gas', 'strom', 'wartung', 'imm', 'wz', 'wwz'])
const cutTotal = (s: ComputedSettlement, t: string): number => {
  const st = s.statements.find((x) => x.tenancyId === t) ?? assert.fail(`keine Abrechnung ${t}`)
  return Math.round((st.rows.filter((r) => HEAT_ITEMS.has(r.costItemId) || r.kind === 'co2Relief').reduce((a, r) => a + r.shareCents, 0) * 15) / 100)
}
const eurOf = (text: string, name: string): number => {
  const m = new RegExp(`${name} \\([A-C]\\) (\\d+(?:\\.\\d{3})*),(\\d\\d) €`).exec(text) ?? assert.fail(`kein Betrag für ${name} in: ${text}`)
  return Number((m[1] ?? '').replace(/\./g, '')) * 100 + Number(m[2])
}
const potNotices = (s: ComputedSettlement) => s.notices.filter((n) => n.code === 'heating.unit-without-device')
// „sicher“ steht vor „Vorsorglich“; je Teil die genannten Mieter.
const parts = (text: string): { sure: string; others: string } => {
  const i = text.indexOf('Vorsorglich')
  return { sure: i < 0 ? text : text.slice(0, i), others: i < 0 ? '' : text.slice(i) }
}

test('#690, Durchsicht M1/S3: B ohne Wärme- und Warmwasserzähler: je Topf eine Warnung mit nur ihrem Topf, zusammen 15 %', () => {
  const s = computeSettlement(withoutDevice(withoutDevice(selfSnapshot(), 'wz-b'), 'xw-b'))
  const [h, w] = potNotices(s)
  if (!h || !w) return assert.fail(`zwei Warnungen erwartet: ${codes(s).join(', ')}`)
  assert.match(h.text, /B hat keinen Wärmezähler/)
  assert.match(w.text, /B hat keinen Warmwasserzähler/)
  assert.match(h.text, /an den Kosten der Heizung um 15 % kürzen.*vom Topf Heizung nach CO₂-Abzug laut Ausweis/s)
  assert.match(w.text, /an den Kosten des Warmwassers um 15 % kürzen.*vom Topf Warmwasser nach CO₂-Abzug laut Ausweis/s)
  for (const n of [h, w]) {
    const { sure, others } = parts(n.text)
    assert.match(sure, /Mieter B \(B\)/)
    assert.doesNotMatch(sure, /Mieter A \(A\)|Mieter C1/)
    assert.match(others, /Mieter A \(A\) .* Mieter C1 \(C\) .* Mieter C2 \(C\)/)
  }
  for (const [t, name] of [['A', 'Mieter A'], ['B', 'Mieter B'], ['C1', 'Mieter C1'], ['C2', 'Mieter C2']] as const) {
    const both = eurOf(h.text, name) + eurOf(w.text, name)
    assert.ok(Math.abs(both - cutTotal(s, t)) <= 1, `${t}: ${both} statt ${cutTotal(s, t)}`)
  }
})

test('#690, Durchsicht M1/S3: A ohne Wärmezähler, C ohne Warmwasserzähler: sicher je Topf die richtige Wohnung', () => {
  const s = computeSettlement(withoutDevice(withoutDevice(selfSnapshot(), 'wz-a'), 'xw-c'))
  const h = potNotices(s).find((n) => /Wärmezähler/.test(n.text)) ?? assert.fail(codes(s).join(', '))
  const w = potNotices(s).find((n) => /Warmwasserzähler/.test(n.text)) ?? assert.fail(codes(s).join(', '))
  assert.match(h.text, /A hat keinen Wärmezähler/)
  assert.match(w.text, /C hat keinen Warmwasserzähler/)
  assert.match(parts(h.text).sure, /vom Topf Heizung nach CO₂-Abzug laut Ausweis: Mieter A \(A\) \d+,\d\d €\./)
  assert.match(parts(h.text).others, /Mieter B \(B\) .*Mieter C1 \(C\) .*Mieter C2 \(C\)/)
  assert.match(parts(w.text).sure, /vom Topf Warmwasser nach CO₂-Abzug laut Ausweis: Mieter C1 \(C\) \d+,\d\d € und Mieter C2 \(C\) \d+,\d\d €\./)
  assert.match(parts(w.text).others, /Mieter A \(A\) .*Mieter B \(B\)/)
  assert.doesNotMatch(parts(w.text).sure, /Mieter A \(A\)/)
  for (const [t, name] of [['A', 'Mieter A'], ['B', 'Mieter B'], ['C1', 'Mieter C1'], ['C2', 'Mieter C2']] as const) {
    const both = eurOf(h.text, name) + eurOf(w.text, name)
    assert.ok(Math.abs(both - cutTotal(s, t)) <= 1, `${t}: ${both} statt ${cutTotal(s, t)}`)
  }
  assert.equal(allRows(s), s.totalCostsCents)
})

// Durchsicht von #690, S1: Geschätzte Ablesungen zählen für die Grenze mit der Fläche der Wohnung ohne Gerät zusammen.
test('#690, Durchsicht S1: geschätzte Ablesungen und eine Wohnung ohne Gerät zusammen über der Grenze: Warnung nennt beide', () => {
  const units = [selfUnit('a', 40), selfUnit('b', 120), selfUnit('c', 40)]
  const base = withoutDevice(selfSnapshot({ units }), 'wz-c')
  // A 40 m² mit geschätztem Endstand (#98) und C 40 m² ohne Gerät: 80 von 200 m², je allein 20 %, zusammen 40 %.
  const snap: Snapshot = { ...base, readings: base.readings.map((r) => (r.meterId === 'wz-a' && r.date === '2025-12-31' ? { ...r, estimated: true } : r)) }
  const s = computeSettlement(snap)
  const n = s.notices.find((x) => x.code === 'heating.reading-estimate-over-25') ?? assert.fail(codes(s).join(', '))
  assert.match(n.text, /betroffen sind 80 von 200 m² \(40 %\)/)
  assert.match(n.text, /C ohne Wärmezähler/)
})

// Integrationsdurchsicht vor dem Release (Geld), zu #690: Eine Wohnung ohne Anschluss an das Warmwasser (Durchlauferhitzer,
// `noConnection: ['warmwasser']`) nimmt am Topf Warmwasser nicht teil, weder mit Verbrauch noch mit Fläche, mit Geräten
// oder ohne, auch bei reiner Flächenverteilung. Vorher zählte sie als „Wohnung ohne Gerät“ (Durchschnitt oder Fläche) bzw.
// trug ganz ohne Warmwasserzähler im Haus nach Fläche mit. Die Heizung bleibt, wie sie ist.
const rowOf = (s: ComputedSettlement, t: string, id: string): number =>
  s.statements.find((st) => st.tenancyId === t)?.rows.find((r) => r.costItemId === id)?.shareCents ?? 0
const noWaterC = (sizes: [number, number, number], dropAllWater = false): Snapshot => {
  const units = [selfUnit('a', sizes[0]), selfUnit('b', sizes[1]), selfUnit('c', sizes[2], { noConnection: ['warmwasser'] })]
  const drop = (id: string) => id === 'xw-c' || (dropAllWater && id.startsWith('xw-'))
  return selfSnapshot({ units, meters: selfMeters().filter((m) => !drop(m.id)), readings: selfReadings().filter((r) => !drop(r.meterId)) })
}

test('#690, Integrationsdurchsicht: C ohne Warmwasseranschluss (60 von 200 m²) zählt nicht als Wohnung ohne Gerät und trägt kein Warmwasser', () => {
  const s = computeSettlement(noWaterC([60, 80, 60]))
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  assert.ok(!codes(s).includes('heating.unit-without-device'), codes(s).join(', '))
  // Miete Warmwasserzähler 60,00 €: 30 % nach Fläche (A 60, B 80 von 140 m²), 70 % nach Verbrauch (A 30, B 40 von 70 m³).
  assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => rowOf(s, t, 'wwz')), [2571, 3429, 0, 0])
  const water = selfOf(s).pots.find((p) => p.pot === 'water') ?? assert.fail('kein Topf Warmwasser')
  assert.deepEqual([water.areaM2, water.unequippedUnits, water.byAreaOnly, water.overThreshold], [140, undefined, false, false])
  // Die Heizung bleibt: Miete Wärmezähler wie mit Warmwasserzähler in C.
  const voll = computeSettlement(selfSnapshot())
  assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => rowOf(s, t, 'wz')), ['A', 'B', 'C1', 'C2'].map((t) => rowOf(voll, t, 'wz')))
  // Die Grenzen von C nennen kein fehlendes Gerät für das Warmwasser.
  assert.ok(selfOf(s).units.find((u) => u.unitId === 'c')?.boundaries.every((b) => !(b.noDevicePots ?? []).includes('water')))
  // Der Rechenweg von C nennt kein Warmwasser.
  const stepsC = s.statements.find((st) => st.tenancyId === 'C1')?.rows.flatMap((r) => r.steps ?? []) ?? []
  assert.ok(stepsC.length > 0 && !stepsC.some((x) => /Warmwasser$/.test(x.label)), JSON.stringify(stepsC.map((x) => x.label)))
  // Eine liegengebliebene Schätzung des Warmwassers von C rechnet nicht.
  const mitSchaetzung = computeSettlement({ ...noWaterC([60, 80, 60]), heatingEstimates: [{ plantId: 'hp', period: periodKey('2025-01'), unitId: 'c', part: 'water', value: 30, method: 'buildingAverage', reason: 'alt', confirmed: true, cause: 'deviceFailure', capture: 'heatMeter', valueUnit: 'm³' }] })
  assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => rowOf(mitSchaetzung, t, 'wwz')), [2571, 3429, 0, 0])
  assert.equal(allRows(s), s.totalCostsCents)
})

test('#690, Integrationsdurchsicht: C ohne Warmwasseranschluss unter der Grenze (30 von 210 m²) bekommt keinen Durchschnitt', () => {
  const s = computeSettlement(noWaterC([80, 100, 30]))
  assert.ok(!codes(s).includes('heating.unit-without-device'), codes(s).join(', '))
  // 30 % nach Fläche (A 80, B 100 von 180 m²), 70 % nach Verbrauch (A 30, B 40 von 70 m³).
  assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => rowOf(s, t, 'wwz')), [2600, 3400, 0, 0])
  const water = selfOf(s).pots.find((p) => p.pot === 'water') ?? assert.fail('kein Topf Warmwasser')
  assert.deepEqual([water.consumption, water.substitutedConsumption], [70, undefined])
  assert.equal(allRows(s), s.totalCostsCents)
})

test('#690, Integrationsdurchsicht: ganz ohne Warmwasserzähler im Haus trägt C ohne Anschluss auch nach Fläche nichts', () => {
  const s = computeSettlement(noWaterC([60, 80, 60], true))
  // Nur nach Fläche: A 60, B 80 von 140 m².
  assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => rowOf(s, t, 'wwz')), [2571, 3429, 0, 0])
  const water = selfOf(s).pots.find((p) => p.pot === 'water') ?? assert.fail('kein Topf Warmwasser')
  assert.deepEqual([water.areaM2, water.byAreaOnly], [140, true])
  // Die Kürzung nennt C nicht beim Warmwasser.
  const nc = s.notices.find((n) => n.code === 'heating.no-consumption')?.text ?? assert.fail(codes(s).join(', '))
  assert.doesNotMatch(/vom Topf Warmwasser[^.]*/.exec(nc)?.[0] ?? '', /Mieter C1|Mieter C2/)
  assert.equal(allRows(s), s.totalCostsCents)
})

// Nachtrag der Integrationsdurchsicht zu #749: Hat keine versorgte Wohnung einen Warmwasseranschluss, die Anlage steht aber
// auf Warmwasser, sperrte das die ganze Anlage („keine Fläche hinterlegt“, alles beim Vermieter). Jetzt wird die Heizung
// verteilt, der Teil Warmwasser bleibt beim Vermieter (eigener Grund), und eine Warnung nennt den Betrag und die Einstellung.
test('#690, Nachtrag: keine Wohnung mit Warmwasseranschluss: Heizung verteilt, Warmwasser beim Vermieter mit Warnung', () => {
  const units = [selfUnit('a', 60, { noConnection: ['warmwasser'] }), selfUnit('b', 80, { noConnection: ['warmwasser'] }), selfUnit('c', 60, { noConnection: ['warmwasser'] })]
  const s = computeSettlement(selfSnapshot({ units }))
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => `${n.code}: ${n.text}`), [])
  assert.equal(selfOf(s).ok, true)
  assert.ok(s.statements.every((st) => st.totalShareCents > 0), 'die Heizung ist verteilt')
  // Miete Warmwasserzähler (nur Warmwasser) ganz beim Vermieter, mit eigenem Grund.
  assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => rowOf(s, t, 'wwz')), [0, 0, 0, 0])
  assert.deepEqual(s.landlord.rows.find((r) => r.costItemId === 'wwz')?.landlordParts, [{ reason: 'noWaterConnection', cents: 6000 }])
  // Die Heizung wie mit Anschluss: Miete Wärmezähler unverändert.
  const voll = computeSettlement(selfSnapshot())
  assert.deepEqual(['A', 'B', 'C1', 'C2'].map((t) => rowOf(s, t, 'wz')), ['A', 'B', 'C1', 'C2'].map((t) => rowOf(voll, t, 'wz')))
  const water = selfOf(s).pots.find((p) => p.pot === 'water')
  const kw = water?.costCents ?? assert.fail('kein Topf Warmwasser')
  const n = s.notices.find((x) => x.code === 'heating.water-unconnected') ?? assert.fail(codes(s).join(', '))
  assert.equal(n.level, 'warning')
  assert.match(n.text, /Keine Wohnung an dieser Anlage hat einen Anschluss an das Warmwasser/)
  assert.ok(n.text.includes(`${(kw / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`), n.text)
  assert.match(n.text, /„Weitere Angaben - Anschlüsse“.*„Es gibt kein zentrales Warmwasser“.*Haken „Warmwasser“/s)
  assert.ok(!codes(s).includes('heating.no-consumption'), codes(s).join(', '))
  assert.equal(allRows(s), s.totalCostsCents)
})

// Heizkostenverteiler und Ablesedienst in der eigenen Heizkostenabrechnung (Heizung PR 12). Kern ist
// die Gleichrangigkeit nach § 5 Abs. 1 Satz 1 HeizkostenV: Dieselben bewerteten Einheiten ergeben
// dieselben Beträge, ob sie von Wärmezählern, Heizkostenverteilern oder einem Ablesedienst kommen.
// Grundlage ist Beispiel A aus server/testing/selfHeating.ts (PR 11): Wärmezähler `wz-a`, `wz-b`,
// `wz-c`, Anlage `hp`, Heizperiode 2025.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, meterSegments, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot, SnapshotReading } from '../src/snapshot.ts'
import type { CaptureMethod, CostItem, HeatingPlant, HeatingServiceValue } from '../../shared/types.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { dayAfter } from '../../shared/law/register.ts'
import { selfDelivery, selfMeter, selfReading, selfRow, selfSnapshot } from '../testing/selfHeating.ts'
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

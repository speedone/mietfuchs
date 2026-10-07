// Heizkostenverteiler und Ablesedienst in der eigenen Heizkostenabrechnung (Heizung PR 12). Kern ist
// die Gleichrangigkeit nach § 5 Abs. 1 Satz 1 HeizkostenV: Dieselben bewerteten Einheiten ergeben
// dieselben Beträge, ob sie von Wärmezählern, Heizkostenverteilern oder einem Ablesedienst kommen.
// Grundlage ist Beispiel A aus server/testing/selfHeating.ts (PR 11): Wärmezähler `wz-a`, `wz-b`,
// `wz-c`, Anlage `hp`, Heizperiode 2025.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, meterSegments, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot, SnapshotReading } from '../src/snapshot.ts'
import type { CaptureMethod, HeatingServiceValue } from '../../shared/types.ts'
import { dayAfter } from '../../shared/law/register.ts'
import { selfMeter, selfSnapshot } from '../testing/selfHeating.ts'
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
      .map((seg) => ({ plantId: 'hp', period: periodKey('2025-01'), unitId: m.unitId ?? '', from: dayAfter(seg.from), to: seg.to, heatValue: seg.delta, waterValue: null })))
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
  assert.deepEqual(lines.map((l) => l.meterId), HEAT)
  assert.ok(lines.every((l) => l.scale === 'unit' && l.factor === 2 && l.rated === l.raw * 2))
  // 12.000 + 16.000 + 12.000 kWh = 40.000 bewertete Einheiten, je Gerät die Hälfte abgelesen.
  assert.deepEqual(lines.map((l) => l.raw), [6000, 8000, 6000])
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
  // Bei Wärmezählern stört ein Heizkostenverteiler an einer Wohnung ebenso.
  const base = selfSnapshot()
  const mitHkv: Snapshot = { ...base, meters: [...base.meters, { id: 'h-a', unitId: 'a', type: 'hkv', name: 'Altgerät', hcaScale: null, ratingFactor: null }] }
  assert.ok(codes(computeSettlement(mitHkv)).includes('heating.mixed-capture'))
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
  assert.equal(n.level, 'warning')
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

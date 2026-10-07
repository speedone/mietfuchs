// Durchsicht von #242 (Heizung PR 13, Schätzung nach § 9a): je Befund ein Test, der vor der Behebung rot war.
// Die Kennungen (G-I1 … R-M9) sind die der beiden Durchsichten (Geld/Daten, Recht/Texte). Die Lagen sind
// Beispiel A (server/testing/selfHeating.ts) mit den Abwandlungen der Proben P1–P9.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot } from '../src/snapshot.ts'
import type { CaptureMethod, CostItem, HeatingEstimate, HeatingPart, HeatingPlant, Reading } from '../../shared/types.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'
import { hkvCutNotByConsumption } from '../../shared/law/heizkostenv.ts'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { selfDelivery, selfMeter, selfMeters, selfReading, selfReadings, selfRow, selfSnapshot, selfTenancy, selfUnit, type SelfSnapshotOptions } from '../testing/selfHeating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity, createProperty, crossPropertyViolations, updateEntity } from '../src/db/repository.ts'
import { saveEstimate } from '../src/db/heatingEstimates.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { saveServiceValues } from '../src/db/serviceValues.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { archiveDatabaseProblem, writeDatabaseSnapshot } from '../src/db/backup.ts'
import { tenancies } from '../src/db/schema.ts'

const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const noticeOf = (s: ComputedSettlement, code: string) => s.notices.find((n) => n.code === code) ?? assert.fail(`kein Hinweis ${code}: ${codes(s).join(', ')}`)
const selfOf = (s: ComputedSettlement, plantId = 'hp') => s.heating?.find((h) => h.plantId === plantId)?.self ?? assert.fail('kein Ausweis')
const usersOfC = (s: ComputedSettlement) => selfOf(s).units.find((u) => u.unitId === 'c')?.users ?? assert.fail('keine Wohnung C')
const total = (s: ComputedSettlement, t: string) => s.statements.find((st) => st.tenancyId === t)?.totalShareCents ?? assert.fail(`kein ${t}`)
const sum = (s: ComputedSettlement) => s.statements.reduce((a, st) => a + st.totalShareCents, 0) + s.landlord.rows.reduce((a, r) => a + r.shareCents, 0)
const positions = (s: Snapshot) => s.costItems.reduce((a, c) => a + c.amountCents, 0)
const estimate = (over: Partial<HeatingEstimate> = {}): HeatingEstimate => ({
  plantId: 'hp', period: periodKey('2025-01'), unitId: 'c', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true,
  cause: 'deviceFailure', capture: 'heatMeter', valueUnit: 'kWh', ...over,
})
const OHNE_ENDE_C = selfReadings().filter((r) => !(r.meterId === 'wz-c' && r.date === '2025-12-31'))
const run = (o: SelfSnapshotOptions = {}) => computeSettlement(selfSnapshot(o))

// Fünf Wohnungen, damit C (60 von 320 m²) unter der Grenze bleibt und nach Verbrauch verteilt wird.
const fuenf = (readings: Reading[], est: HeatingEstimate[]): SelfSnapshotOptions => {
  const extraMeters = ['d', 'e'].flatMap((u) => [selfMeter(`wz-${u}`, u, `Wärme ${u}`, 'waerme'), selfMeter(`xw-${u}`, u, `Warmwasser ${u}`, 'warmwasser')])
  const extraReadings = ['d', 'e'].flatMap((u) => [selfReading(`wz-${u}`, '2024-12-31', 0), selfReading(`wz-${u}`, '2025-12-31', 12000), selfReading(`xw-${u}`, '2024-12-31', 0), selfReading(`xw-${u}`, '2025-12-31', 30)])
  return {
    units: [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 60), selfUnit('d', 60), selfUnit('e', 60)],
    meters: [...selfMeters(), ...extraMeters], readings: [...readings, ...extraReadings],
    tenancies: [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('C1', 'c', '2020-01-01', '2025-09-30'), selfTenancy('C2', 'c', '2025-10-01', null), selfTenancy('D', 'd', '2020-01-01', null), selfTenancy('E', 'e', '2020-01-01', null)],
    estimates: est,
  }
}

// Probe P1: Heizkostenverteiler, fünf Wohnungen, der HKV von C hat keinen Endstand.
const hkvFall = (est: HeatingEstimate[]): SelfSnapshotOptions => {
  const hkv = (u: string) => selfMeter(`hk-${u}`, u, `HKV ${u}`, 'hkv', { hcaScale: 'product' })
  const xw = (u: string) => selfMeter(`xw-${u}`, u, `WW ${u}`, 'warmwasser')
  const dhw = selfMeter('ww', null, 'Speicher', 'waerme', { heatingPlantId: 'hp', heatingRole: 'dhwHeat' })
  const water: Reading[] = [
    selfReading('xw-a', '2024-12-31', 10), selfReading('xw-a', '2025-12-31', 40),
    selfReading('xw-b', '2024-12-31', 0), selfReading('xw-b', '2025-12-31', 40),
    selfReading('xw-c', '2024-12-31', 5), selfReading('xw-c', '2025-09-30', 43), selfReading('xw-c', '2025-12-31', 55),
    selfReading('ww', '2024-12-31', 0), selfReading('ww', '2025-12-31', 9000),
  ]
  const hk: Reading[] = [
    selfReading('hk-a', '2024-12-31', 0), selfReading('hk-a', '2025-12-31', 1200),
    selfReading('hk-b', '2024-12-31', 0), selfReading('hk-b', '2025-12-31', 1600),
    selfReading('hk-c', '2024-12-31', 0), selfReading('hk-c', '2025-09-30', 720),
  ]
  const capture: CaptureMethod = 'hca'
  const extra = ['d', 'e']
  return {
    units: [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 60), selfUnit('d', 60), selfUnit('e', 60)],
    tenancies: [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('C1', 'c', '2020-01-01', '2025-09-30'), selfTenancy('C2', 'c', '2025-10-01', null), selfTenancy('D', 'd', '2020-01-01', null), selfTenancy('E', 'e', '2020-01-01', null)],
    plant: { capture, selfSpans: [{ from: periodKey('2025-01'), until: null, capture, hotWater: 'combined' }] },
    meters: [hkv('a'), hkv('b'), hkv('c'), dhw, xw('a'), xw('b'), xw('c'), ...extra.flatMap((u) => [hkv(u), xw(u)])],
    readings: [...water, ...hk, ...extra.flatMap((u) => [selfReading(`hk-${u}`, '2024-12-31', 0), selfReading(`hk-${u}`, '2025-12-31', 1200), selfReading(`xw-${u}`, '2024-12-31', 0), selfReading(`xw-${u}`, '2025-12-31', 30)])],
    estimates: est,
  }
}

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened, dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-schaetzung-durchsicht-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened, dataDir)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
let ids = 0
const newId = () => `d-${++ids}`
const SETUP = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }
async function haus(opened: Opened, setup: Record<string, unknown> = SETUP): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 80], ['c', 60]] as const) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    for (const u of ['a', 'b', 'c']) await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    await setUpSelf(db, 'hp', setup, '2026-02-01', newId)
  })
}
const GUT = { value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true, cause: 'deviceFailure' }

// ---------- G-I1: Die Schätzung hängt an der Erfassung ----------

test('G-I1 (Probe P1): eine Schätzung in kWh zählt nicht, wenn die Heizperiode jetzt mit Heizkostenverteilern erfasst wird', () => {
  const alt = run(hkvFall([estimate({ value: 12000 })]))
  const n = noticeOf(alt, 'heating.estimate-stale')
  assert.equal(n.level, 'error')
  assert.match(n.text, /von C .*Wärmezählern in kWh eingetragen.*Heizkostenverteilern in Einheiten.*Schätzung neu eintragen/s)
  // Nicht still in der neuen Einheit verteilt: C2 zahlte vorher 1.755,77 € für 12.000 „Einheiten“.
  assert.notEqual(total(alt, 'C2'), 175577)
  assert.ok(usersOfC(alt).every((u) => u.heatingEstimated !== true), 'die alte Schätzung wirkt nicht')
  assert.ok(codes(alt).includes('heating.self-incomplete'), 'C gilt als nicht erfasst')
  // Neu in Einheiten eingetragen: verteilt, ohne Fehler.
  const neu = run(hkvFall([estimate({ value: 1200, capture: 'hca', valueUnit: 'Einheiten' })]))
  assert.deepEqual(neu.notices.filter((x) => x.level === 'error').map((x) => x.code), [])
  assert.equal(total(neu, 'C2'), 42469)
})

test('G-I1: beim Ablesedienst zählt auch die Einheit, in der er die Heizung nennt', () => {
  const capture: CaptureMethod = 'serviceValues'
  const plant = { capture, selfSpans: [{ from: periodKey('2025-01'), until: null, capture, hotWater: 'none' as const }], hotWater: 'none' as const }
  const sv = (unitId: string, heatValue: number) => ({ plantId: 'hp', period: periodKey('2025-01'), unitId, from: '2025-01-01', to: '2025-12-31', heatValue, waterValue: null, heatUnit: 'kWh' as const })
  const o: SelfSnapshotOptions = { plant, serviceValues: [sv('a', 12000), sv('b', 16000)], meters: [], readings: [] }
  const inEinheiten = run({ ...o, estimates: [estimate({ capture, valueUnit: 'Einheiten', value: 900 })] })
  assert.match(noticeOf(inEinheiten, 'heating.estimate-stale').text, /in Einheiten eingetragen.*in kWh/s)
  const inKwh = run({ ...o, estimates: [estimate({ capture, valueUnit: 'kWh', value: 12000 })] })
  assert.ok(!codes(inKwh).includes('heating.estimate-stale'), codes(inKwh).join(', '))
})

test('G-I1 (Probe P1, Datenweg): die Schätzung merkt sich Erfassung und Einheit; ein Wechsel der Erfassung nennt sie in der Antwort', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const saved = await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', GUT))
    assert.deepEqual([saved?.capture, saved?.valueUnit, saved?.cause], ['heatMeter', 'kWh', 'deviceFailure'])
    const water = await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'water', { ...GUT, value: 30 }))
    assert.deepEqual([water?.capture, water?.valueUnit], ['heatMeter', 'm³'])
    await opened.write((db) => createEntity(db, 'meters', 'hk-c', { propertyId: 'objekt-1', name: 'HKV c', unitId: 'c', type: 'hkv', unit: 'Einheiten', hcaScale: 'product' }))
    const r = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, capture: 'hca' }, '2026-02-01', newId))
    assert.match(r?.estimatesNotice ?? '', /Schätzung.*„C“.*Heizung.*Wärmezählern.*neu ein/s)
    // Gespeichert bleibt sie, wie sie war; die Berechnung rechnet sie nicht mehr (Test oben).
    const stock = await opened.read(readStock)
    assert.deepEqual(stock.heatingEstimates.map((e) => [e.part, e.capture, e.valueUnit, e.value]), [['heat', 'heatMeter', 'kWh', 12000], ['water', 'heatMeter', 'm³', 30]])
    // Dieselbe Erfassung noch einmal: nichts zu melden.
    const again = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, capture: 'hca' }, '2026-02-01', newId))
    assert.match(again?.estimatesNotice ?? '', /„C“/)
  })
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', GUT))
    const same = await opened.write((db) => setUpSelf(db, 'hp', SETUP, '2026-02-01', newId))
    assert.equal(same?.estimatesNotice, null)
  })
})

test('G-I1: ohne Grund aus der Auswahl wird nicht gespeichert', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const status = (e: unknown) => e instanceof Error && Reflect.get(e, 'status') === 400 && /Grund/.test(e.message)
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', { ...GUT, cause: undefined })), status)
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', { ...GUT, cause: 'raten' })), status)
    assert.deepEqual((await opened.read(readStock)).heatingEstimates, [])
  })
})

// ---------- G-I2: Die Frage zur fernen Zwischenablesung auch bei Schätzung ----------

test('G-I2 (Probe P7c): Zwischenablesung 51 Tage neben dem Wechsel und Schätzung: Mietfuchs fragt wie ohne Schätzung', () => {
  const readings = selfReadings()
    .filter((r) => !(r.meterId === 'wz-c' && (r.date === '2025-09-30' || r.date === '2025-12-31')))
    .concat([{ ...selfReading('wz-c', '2025-11-20', 9500), interimFor: '2025-09-30' }])
  const snap = selfSnapshot(fuenf(readings, [estimate()]))
  const asIs = computeSettlement(snap)
  assert.ok(asIs.notices.some((n) => n.code === 'heating.self-incomplete' && /erst am 20\.11\.2025 abgelesen.*„Ablesung verwenden“ oder „Nach § 9b Abs\. 3“/s.test(n.text)), codes(asIs).join(', '))
  // Nach „Nach § 9b Abs. 3“: C1 trägt seinen Teil des gemessenen Verbrauchs bis zum 20.11. nach Gradtagen.
  const split = computeSettlement({ ...snap, interimGaps: [{ unitId: 'c', date: '2025-09-30', status: 'imprecise', reason: 'zu spät' }] })
  assert.deepEqual(split.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  const [c1] = usersOfC(split)
  assert.ok(c1 && Math.abs((c1.heatingConsumption ?? 0) - 7680) < 1e-6, String(c1?.heatingConsumption))
  assert.equal(sum(split), positions(snap))
  // Ohne ferne Ablesung (alle Grenzen geschätzt) wird nicht gefragt.
  const ohne = run({ readings: selfReadings().filter((r) => r.meterId !== 'wz-c' || r.date === '2025-11-20'), estimates: [estimate()] })
  assert.ok(!ohne.notices.some((n) => /erst am/.test(n.text)), codes(ohne).join(', '))
})

// ---------- G-I3: Objektwechsel einer Wohnung mit Schätzung ----------

test('G-I3 (Probe P9): eine Wohnung mit Schätzung oder Werten des Ablesedienstes wechselt nicht das Objekt; das Backup bleibt einspielbar', async () => {
  await withDatabase(async (opened, dataDir) => {
    await haus(opened, { period: '2025-01', heatConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'none', capture: 'serviceValues', dhwHeatMeter: false, totalHeatMeter: false })
    await opened.write(async (db) => {
      await saveEstimate(db, 'hp', '2025-01', 'c', 'heat', { ...GUT, reason: 'Werte fehlen', cause: 'otherReason' })
      await saveServiceValues(db, 'hp', '2025-01', { values: [{ unitId: 'b', from: '2025-01-01', to: '2025-12-31', heatValue: 900, heatUnit: 'units' }] })
      await createProperty(db, 'objekt-2', { name: 'Nebenhaus' })
      await db.delete(tenancies)
    })
    const cross = (text: RegExp) => (e: unknown) => e instanceof Error && Reflect.get(e, 'status') === 400 && text.test(e.message)
    await assert.rejects(opened.write((db) => updateEntity(db, 'units', 'c', { propertyId: 'objekt-2' })), cross(/„C“.*Schätzungen nach § 9a/s))
    await assert.rejects(opened.write((db) => updateEntity(db, 'units', 'b', { propertyId: 'objekt-2' })), cross(/„B“.*Werte des Ablesedienstes/s))
    assert.deepEqual(await opened.read(crossPropertyViolations), [])
    const archive = path.join(dataDir, 'probe-backup.sqlite')
    await writeDatabaseSnapshot(opened, archive)
    assert.equal(await archiveDatabaseProblem(archive), null)
  })
})

// ---------- G-M1 bis G-M7 ----------

test('G-M1 (Probe P6): Schätzung, deren Gerät danach gelöscht wurde: Warnung, die Schätzung zählt weiter', () => {
  const s = run({ meters: selfMeters().filter((m) => m.id !== 'wz-c'), readings: OHNE_ENDE_C.filter((r) => r.meterId !== 'wz-c'), estimates: [estimate()] })
  const n = noticeOf(s, 'heating.estimate-no-device')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /C.*keinen Wärmezähler.*Schätzung zählt weiter.*Ausstattungspflicht/s)
  assert.ok(usersOfC(s).some((u) => u.heatingEstimated === true))
})

test('G-M2 (Probe P4): eine Schätzung unter dem abgelesenen Teil des Vormieters ergibt einen Hinweis', () => {
  const s = run({ readings: OHNE_ENDE_C, estimates: [estimate({ value: 3000 })] })
  const n = noticeOf(s, 'heating.estimate-below-measured')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /3\.000 kWh.*abgelesen.*7\.200 kWh/s)
  assert.ok(!codes(run({ readings: OHNE_ENDE_C, estimates: [estimate()] })).includes('heating.estimate-below-measured'))
})

test('G-M3 (Probe P8): Ablesedienst ohne einen Wert, alles geschätzt: nur der Hinweis nach § 9a Abs. 2, kein Kürzungsbetrag', () => {
  const capture: CaptureMethod = 'serviceValues'
  const est = ['a', 'b', 'c'].map((u) => estimate({ unitId: u, value: 10000, capture, valueUnit: 'Einheiten' }))
  const s = run({ plant: { capture, selfSpans: [{ from: periodKey('2025-01'), until: null, capture, hotWater: 'combined' }] }, estimates: est })
  assert.ok(codes(s).includes('heating.estimate-over-25'), codes(s).join(', '))
  const nc = s.notices.find((n) => n.code === 'heating.no-consumption')
  assert.ok(!nc || !/Heizung/.test(nc.text.split(';')[0] ?? ''), nc?.text)
})

test('G-M5: nach einem Kesseltausch steht jeder Hinweis zur Schätzung einmal je Linie', () => {
  const s = computeSettlement(kesseltausch([estimate()]))
  assert.equal(s.notices.filter((n) => n.code === 'heating.estimated').length, 1, codes(s).join(', '))
  assert.equal(s.notices.filter((n) => n.code === 'heating.estimate-over-25').length, 1, codes(s).join(', '))
})

test('G-M6: die Schätzung der ganzen Heizperiode sagt, dass sie auch abgelesene Zeiten desselben Nutzers ersetzt', () => {
  const s = run({ tenancies: [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('C1', 'c', '2020-01-01', null)], readings: OHNE_ENDE_C.filter((r) => !(r.meterId === 'wz-c' && r.date === '2025-09-30')), estimates: [estimate()] })
  assert.match(noticeOf(s, 'heating.estimated').text, /ganze Heizperiode.*auch.*abgelesen/s)
})

test('G-M7 (Probe P5): zwei Stände am selben Tag beim Wechsel und eine Schätzung: keine Rede von widerspruchsfreien Ablesungen', () => {
  const readings = [...selfReadings(), selfReading('wz-c', '2025-09-30', 7900)].map((r, i) => ({ ...r, id: `${r.id}#${i}` }))
  const s = run({ readings, estimates: [estimate({ value: 9000 })] })
  assert.ok(!s.notices.some((n) => /widerspruchsfrei/.test(n.text)), s.notices.map((n) => n.text).join('\n'))
  const n = noticeOf(s, 'heating.estimate-same-day')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /30\.09\.2025 zwei verschiedene Stände.*löschen/s)
})

// ---------- R-I4, R-I6, R-I7, R-I5 und M4: die Texte der Hinweise ----------

test('R-I4/R-M4: der Vormieter behält den abgelesenen Verbrauch nach § 9a Abs. 1 Satz 1, ohne Annahme zum Geschlecht', () => {
  const t = noticeOf(run({ readings: OHNE_ENDE_C, estimates: [estimate()] }), 'heating.estimated').text
  assert.match(t, /Mieter C1 behält den abgelesenen Verbrauch: § 9a Abs\. 1 Satz 1 HeizkostenV erfasst nur den Verbrauch von Nutzern, der nicht ordnungsgemäß erfasst werden kann/)
  assert.doesNotMatch(t, /Satz 2|behält seinen/)
})

test('R-I6: VIII ZR 373/04 als das, was der BGH entschieden hat; Leitsatz c beim Hinweis zu § 9a Abs. 2', () => {
  const unconfirmed = noticeOf(run({ readings: OHNE_ENDE_C, estimates: [estimate({ confirmed: false })] }), 'heating.estimate-unconfirmed').text
  assert.doesNotMatch(unconfirmed, /erst, wenn sich der Fehler nicht mehr beheben lässt/)
  assert.match(unconfirmed, /Auch ein Ablesefehler ist ein solcher Grund, wenn sich der Wert nicht mehr ermitteln lässt; im entschiedenen Fall war die Ablesung nicht nachholbar \(BGH VIII ZR 373\/04\)/)
  const s = run({ readings: OHNE_ENDE_C, estimates: [estimate()] })
  assert.doesNotMatch(noticeOf(s, 'heating.estimated').text, /solange sich der Fehler nicht beheben lässt/)
  const cut = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
  assert.match(noticeOf(s, 'heating.estimate-over-25').text, new RegExp(`Kürzung um ${cut} % verneint \\(BGH VIII ZR 373/04\\).*nach Abs\\. 2.*nicht ausdrücklich entschieden`, 's'))
})

test('R-I5/G-M8: die Flächenregel des § 9a Abs. 2 steht als Auslegung von Mietfuchs da', () => {
  const t = noticeOf(run({ readings: OHNE_ENDE_C, estimates: [estimate()] }), 'heating.estimate-over-25').text
  assert.match(t, /ganze Fläche der Wohnung, auch wenn nur ein Teil der Heizperiode geschätzt ist.*Heizung und Warmwasser getrennt.*Auslegung von Mietfuchs/s)
})

test('R-I7: neben vollständiger Ablesung färbt eine bestätigte Schätzung nicht mehr gelb; unbestätigt bleibt sie eine Warnung', () => {
  const s = run({ estimates: [estimate({ value: 10000, reason: 'Zähler zeigt seit März unplausibel niedrige Werte', cause: 'wrongReading' })] })
  const n = noticeOf(s, 'heating.estimate-complete')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /vollständig.*ersetzt sie durch die Schätzung.*unbrauchbar.*„Zähler zeigt seit März unplausibel niedrige Werte“.*Nachweis/s)
  assert.doesNotMatch(n.text, /insoweit falsch|Entfernen Sie die Schätzung, oder halten Sie/)
  const offen = run({ estimates: [estimate({ value: 10000, confirmed: false })] })
  assert.equal(noticeOf(offen, 'heating.estimate-unconfirmed').level, 'warning')
  assert.ok(!codes(offen).includes('heating.estimate-complete'))
  assert.match(noticeOf(offen, 'heating.estimate-unconfirmed').text, /vollständig/)
})

test('R-M5: die Begründung steht in Anführungszeichen, nicht in einer zweiten Klammer', () => {
  const t = noticeOf(run({ readings: OHNE_ENDE_C, estimates: [estimate({ reason: 'Zähler defekt (Prüfung durch Fachbetrieb)' })] }), 'heating.estimated').text
  assert.match(t, /Begründung: „Zähler defekt \(Prüfung durch Fachbetrieb\)“/)
})

test('R-I1: der Fehler ohne Schätzung spricht von „nicht ordnungsgemäß erfassen“', () => {
  const t = noticeOf(run({ readings: OHNE_ENDE_C }), 'heating.self-incomplete').text
  assert.match(t, /nicht ordnungsgemäß erfassen/)
  assert.doesNotMatch(t, /nicht mehr ablesen/)
})

test('R-M9: der Topf nennt den geschätzten Verbrauch darin', () => {
  const s = run(fuenf(OHNE_ENDE_C, [estimate()]))
  const heat = selfOf(s).pots.find((p) => p.pot === 'heating') ?? assert.fail('Topf Heizung')
  assert.ok(Math.abs((heat.estimatedConsumption ?? 0) - 4320) < 1e-6, String(heat.estimatedConsumption))
  assert.equal(selfOf(run()).pots.find((p) => p.pot === 'heating')?.estimatedConsumption, 0)
})

test('R-I5: der Dialog weiß, ob ein Teil der Wohnung abgelesen ist (die ganze Fläche zählt trotzdem)', () => {
  const s = run({ readings: OHNE_ENDE_C })
  assert.equal(selfOf(s).estimateOptions?.find((o) => o.unitId === 'c' && o.part === 'heat')?.partlyMeasured, true)
  const allein = run({ tenancies: [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('C1', 'c', '2020-01-01', null)], readings: OHNE_ENDE_C })
  assert.equal(selfOf(allein).estimateOptions?.find((o) => o.unitId === 'c' && o.part === 'heat')?.partlyMeasured, false)
})

// ---------- G-M4: Tests gegen die überlebenden Mutationen der Geld-Durchsicht ----------

const kesseltausch = (est: HeatingEstimate[]): Snapshot => {
  const base = selfSnapshot()
  const item = (id: string, plant: string, amountCents: number, heatingPart: HeatingPart, extra: Partial<CostItem> = {}): CostItem => ({
    id, propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: id, amountCents, key: 'heatingSystem', heatingPlantId: plant, heatingPart, heatingTarget: 'both', ...extra,
  })
  const hp2: HeatingPlant = { ...(base.heatingPlants?.[0] as HeatingPlant), id: 'hp2', name: 'neu', replacesPlantId: 'hp' }
  const readings = [
    selfReading('wz-a', '2024-12-31', 1000), selfReading('wz-a', '2025-12-31', 13000),
    selfReading('wz-b', '2024-12-31', 0), selfReading('wz-b', '2025-12-31', 16000),
    selfReading('wz-c', '2024-12-31', 500), selfReading('wz-c', '2025-09-30', 7700),
    selfReading('xw-a', '2024-12-31', 10), selfReading('xw-a', '2025-12-31', 40),
    selfReading('xw-b', '2024-12-31', 0), selfReading('xw-b', '2025-12-31', 40),
    selfReading('xw-c', '2024-12-31', 5), selfReading('xw-c', '2025-09-30', 43), selfReading('xw-c', '2025-12-31', 55),
    selfReading('ww', '2024-12-31', 0), selfReading('ww', '2025-06-30', 4500), selfReading('ww', '2025-12-31', 9000),
  ]
  return selfSnapshot({
    plant: { name: 'alt', endsOn: '2025-06-30' },
    plants: [hp2],
    rows: [selfRow({}, 2025, 'hp2')],
    deliveries: [
      selfDelivery({ id: 'd1', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30', energyKwh: 30000 }),
      selfDelivery({ id: 'd2', plantId: 'hp2', invoiceFrom: '2025-07-01', invoiceTo: '2025-12-31', energyKwh: 30000 }),
    ],
    costItems: [item('gas1', 'hp', 300000, 'fuel', { fuelDeliveryId: 'd1' }), item('gas2', 'hp2', 300000, 'fuel', { fuelDeliveryId: 'd2' })],
    readings,
    estimates: est,
  })
}

test('X1 (Probe P3): eine Schätzung einer anderen Heizperiode wirkt nicht', () => {
  const s = run({ readings: OHNE_ENDE_C, estimates: [estimate({ period: periodKey('2024-01') })] })
  assert.ok(codes(s).includes('heating.self-incomplete'))
  assert.deepEqual(selfOf(s).estimates, [])
})

test('X2: stehen an beiden Anlagen einer Linie Schätzungen derselben Wohnung, gilt an jeder die eigene', () => {
  const s = computeSettlement(kesseltausch([estimate({ value: 12000 }), estimate({ plantId: 'hp2', value: 6000 })]))
  assert.deepEqual(selfOf(s, 'hp').estimates?.map((e) => [e.plantId, e.value]), [['hp', 12000]])
  assert.deepEqual(selfOf(s, 'hp2').estimates?.map((e) => [e.plantId, e.value]), [['hp2', 6000]])
})

test('X3: eine Schätzung an einer Wohnung, die nicht an der Anlage hängt, steht nicht im Ausweis', () => {
  const s = run({ readings: OHNE_ENDE_C, units: [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 60), selfUnit('g', 15, { noConnection: ['waerme', 'warmwasser'] })], estimates: [estimate(), estimate({ unitId: 'g' })] })
  assert.deepEqual(selfOf(s).estimates?.map((e) => e.unitId), ['c'])
})

test('X10: ist die vorige Heizperiode anders lang, schlägt Mietfuchs keinen Wert aus ihr vor', () => {
  // Die Anlage rechnete bis April vom Mai an ab; 01.05.–31.12.2024 ist ein Rumpf von acht Monaten.
  const readings = [...OHNE_ENDE_C, selfReading('wz-c', '2024-04-30', 100)]
  const s = run({ plant: { periodStartMonth: 5, periodChanges: ['2025-01'] }, readings })
  const prev = selfOf(s).estimateOptions?.find((o) => o.unitId === 'c' && o.part === 'heat')?.proposals.find((p) => p.method === 'previousPeriod')
  assert.deepEqual(prev, { method: 'previousPeriod', value: null, perM2: null, why: 'lengthDiffers' })
})

test('X14: mit beheizter Fläche rechnen die Vorschläge je m² beheizter Fläche', () => {
  const plant = { areaBasisHeat: 'heatedArea' as const, units: [{ unitId: 'a', heatedAreaM2: 50 }, { unitId: 'b', heatedAreaM2: 75 }, { unitId: 'c', heatedAreaM2: 40 }] }
  const s = run({ plant, readings: OHNE_ENDE_C })
  const o = selfOf(s).estimateOptions?.find((x) => x.unitId === 'c' && x.part === 'heat') ?? assert.fail('keine Option C')
  // A 12.000 kWh auf 50 m², B 16.000 kWh auf 75 m²: 28.000 / 125 = 224 kWh je m², mal 40 m² = 8.960 kWh.
  assert.equal(o.areaM2, 40)
  const avg = o.proposals.find((p) => p.method === 'buildingAverage')
  assert.ok(avg && Math.abs((avg.value ?? 0) - 8960) < 1e-6 && Math.abs((avg.perM2 ?? 0) - 224) < 1e-9, JSON.stringify(avg))
  assert.deepEqual(o.comparable.map((c) => [c.unitId, c.perM2]), [['a', 240], ['b', 16000 / 75]])
})

test('X16: wurde die vorige Heizperiode mit anderen Geräten erfasst, kein Vorschlag aus ihr', () => {
  const hkv = (u: string) => selfMeter(`hk-${u}`, u, `HKV ${u}`, 'hkv', { hcaScale: 'product' })
  const capture: CaptureMethod = 'hca'
  const s = run({
    plant: { capture, selfSpans: [{ from: periodKey('2024-01'), until: periodKey('2025-01'), capture: 'heatMeter', hotWater: 'combined' }, { from: periodKey('2025-01'), until: null, capture, hotWater: 'combined' }] },
    meters: [...selfMeters(), hkv('a'), hkv('b'), hkv('c')],
    readings: [
      ...selfReadings().filter((r) => !r.meterId.startsWith('wz-')),
      // 2024 hingen die Verteiler schon, gezählt hat der Wärmezähler.
      selfReading('hk-c', '2023-12-31', 0), selfReading('hk-c', '2024-12-31', 500),
      selfReading('hk-a', '2024-12-31', 0), selfReading('hk-a', '2025-12-31', 1200),
      selfReading('hk-b', '2024-12-31', 0), selfReading('hk-b', '2025-12-31', 1600),
      selfReading('hk-c', '2025-09-30', 1220),
    ],
  })
  const prev = selfOf(s).estimateOptions?.find((o) => o.unitId === 'c' && o.part === 'heat')?.proposals.find((p) => p.method === 'previousPeriod')
  assert.equal(prev?.why, 'noPrevious', JSON.stringify(prev))
})

test('X17: eine Schätzung nur für das Warmwasser hebt den Gerätewechsel der Heizung nicht auf', () => {
  const hkv = (u: string) => selfMeter(`hk-${u}`, u, `HKV ${u}`, 'hkv', { hcaScale: 'product' })
  const xw = (u: string) => selfMeter(`xw-${u}`, u, `WW ${u}`, 'warmwasser')
  const dhw = selfMeter('ww', null, 'Speicher', 'waerme', { heatingPlantId: 'hp', heatingRole: 'dhwHeat' })
  const capture: CaptureMethod = 'hca'
  const readings: Reading[] = [
    selfReading('xw-a', '2024-12-31', 10), selfReading('xw-a', '2025-12-31', 40),
    selfReading('xw-b', '2024-12-31', 0), selfReading('xw-b', '2025-12-31', 40),
    selfReading('xw-c', '2024-12-31', 5), selfReading('xw-c', '2025-09-30', 43), selfReading('xw-c', '2025-12-31', 55),
    selfReading('ww', '2024-12-31', 0), selfReading('ww', '2025-12-31', 9000),
    selfReading('hk-a', '2025-06-30', 0), selfReading('hk-a', '2025-12-31', 600),
    selfReading('hk-b', '2024-12-31', 0), selfReading('hk-b', '2025-12-31', 1600),
    selfReading('hk-c', '2024-12-31', 0), selfReading('hk-c', '2025-09-30', 720), selfReading('hk-c', '2025-12-31', 1200),
    selfReading('wz-a', '2024-12-31', 0), selfReading('wz-a', '2025-06-30', 6000),
  ]
  const s = run({
    plant: { capture, selfSpans: [{ from: periodKey('2025-01'), until: null, capture, hotWater: 'combined' }] },
    meters: [hkv('a'), hkv('b'), hkv('c'), selfMeter('wz-a', 'a', 'WZ a', 'waerme'), dhw, xw('a'), xw('b'), xw('c')],
    readings,
    estimates: [estimate({ unitId: 'a', part: 'water', value: 30, capture, valueUnit: 'm³' })],
  })
  assert.ok(codes(s).includes('heating.mixed-capture'), codes(s).join(', '))
})

test('X20: knapp über der Grenze (50 von 199 m², 25,13 %) geht der Topf nach Fläche', () => {
  const s = run({ units: [selfUnit('a', 60), selfUnit('b', 89), selfUnit('c', 50)], readings: OHNE_ENDE_C, estimates: [estimate()] })
  const heat = selfOf(s).pots.find((p) => p.pot === 'heating') ?? assert.fail('Topf Heizung')
  assert.deepEqual([heat.overThreshold, heat.consumptionPct], [true, 0])
  assert.match(noticeOf(s, 'heating.estimate-over-25').text, /50 von 199 m² \(25,125628 %\)/)
})

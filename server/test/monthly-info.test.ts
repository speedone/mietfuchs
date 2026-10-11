// Monatliche Verbrauchsinformation (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2 HeizkostenV).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, monthBounds, monthName, monthRanges, monthsBetween } from '../../shared/monthlyInfo.ts'
import { createLawLog } from '../../shared/law/register.ts'
import { exactConsumption, heatingPlantAt, monthlyInfoMonths, openMonths, type MonthlyInfoInput } from '../src/monthlyInfo.ts'
import type { SnapshotReading } from '../src/snapshot.ts'

test('Monate: Name, Grenzen, Spannen, Abstand', () => {
  assert.equal(monthName('2025-11'), 'November 2025')
  assert.deepEqual(monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' })
  assert.deepEqual(monthBounds('2025-02'), { from: '2025-02-01', to: '2025-02-28' })
  assert.deepEqual(monthBounds('2025-12'), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02'])
  assert.deepEqual(monthsBetween('2025-11-15', '2025-11-20'), ['2025-11'])
  assert.equal(addMonths('2025-01', -1), '2024-12')
  assert.equal(addMonths('2025-11', -12), '2024-11')
  assert.equal(addMonths('2025-12', 1), '2026-01')
  assert.equal(monthRanges(['2025-01', '2025-02', '2025-03', '2025-05']), 'Januar bis März 2025, Mai 2025')
  assert.equal(monthRanges(['2024-11', '2024-12', '2025-01']), 'November 2024 bis Januar 2025')
  assert.equal(monthRanges(['2025-03', '2025-01', '2025-02', '2025-02']), 'Januar bis März 2025')
  assert.equal(monthRanges([]), '')
})

const r = (meterId: string, date: string, value: number, extra: Partial<SnapshotReading> = {}): SnapshotReading => ({ meterId, date, value, ...extra })

test('Verbrauch nur aus Ablesungen genau an beiden Grenzen; Wechsel über den Endstand; sonst null', () => {
  const rs = [r('w', '2025-10-31', 5400), r('w', '2025-11-15', 5800), r('w', '2025-11-30', 6100)]
  assert.equal(exactConsumption(rs, '2025-10-31', '2025-11-30'), 700)
  assert.equal(exactConsumption(rs, '2025-11-15', '2025-11-30'), 300)
  assert.equal(exactConsumption(rs, '2025-10-30', '2025-11-30'), null, 'keine Ablesung am Beginn')
  assert.equal(exactConsumption([r('w', '2025-10-31', 5400), r('w', '2025-12-02', 6200)], '2025-10-31', '2025-11-30'), null, 'nie interpoliert')
  const wechsel = [r('w', '2025-10-31', 5400), r('w', '2025-11-10', 0, { replacement: true, oldEndValue: 5600 }), r('w', '2025-11-30', 500)]
  assert.equal(exactConsumption(wechsel, '2025-10-31', '2025-11-30'), 700)
  assert.equal(exactConsumption([r('w', '2025-10-31', 5400), r('w', '2025-11-10', 0, { replacement: true }), r('w', '2025-11-30', 500)], '2025-10-31', '2025-11-30'), null, 'Wechsel ohne Endstand')
  assert.equal(exactConsumption([r('w', '2025-10-31', 5400), r('w', '2025-10-31', 5410), r('w', '2025-11-30', 6100)], '2025-10-31', '2025-11-30'), null, 'zwei Ablesungen am selben Tag')
})

const basis = (over: Partial<MonthlyInfoInput> = {}): MonthlyInfoInput => ({
  plants: [{ id: 'hp', units: null, devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null }],
  meters: [
    { id: 'wa', unitId: 'a', type: 'waerme', heatingPlantId: null, heatingRole: null, remoteReadable: true, installedOn: '2023-05-01' },
    { id: 'ww', unitId: 'a', type: 'warmwasser', heatingPlantId: null, heatingRole: null, remoteReadable: true, installedOn: '2023-05-01' },
  ],
  units: [{ id: 'a', name: 'EG', areaM2: 60, noConnection: [] }],
  tenancies: [{ id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', start: '2024-01-01', end: null }],
  readings: [
    r('wa', '2024-10-31', 1000), r('wa', '2024-11-30', 1350), r('wa', '2025-09-30', 5000), r('wa', '2025-10-31', 5400), r('wa', '2025-11-30', 6100),
    r('ww', '2024-10-31', 5), r('ww', '2024-11-30', 7), r('ww', '2025-09-30', 18), r('ww', '2025-10-31', 20), r('ww', '2025-11-30', 22.5),
  ],
  rows: [{ plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Vergleichswerte des Ablesedienstes Beispiel 2025', sentOn: '2025-12-05' }],
  dhwTempC: 55,
  h: { from: '2025-01-01', to: '2025-12-31' },
  parts: { heat: true, water: true },
  asOf: '2025-12-10',
  ...over,
})

test('November: Wärme 700 kWh, Warmwasser 2,5 m³ = 281,25 kWh umgerechnet, getrennt; Vormonat, Vorjahresmonat, Durchschnittsnutzer', () => {
  const log = createLawLog()
  const months = monthlyInfoMonths(basis(), log)
  assert.deepEqual(months.map((m) => m.month), ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'])
  const nov = months.find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([nov.due, nov.complete, nov.sent, nov.mixed], [true, true, true, false])
  // Keine Summe aus gemessener Wärme und umgerechneter Warmwasserwärme; die Vergleiche je Größe.
  assert.deepEqual(nov.users, [{
    tenancyId: 't1', tenantName: 'Erika Mustermann', unitName: 'EG', areaM2: 60, from: '2025-11-01', to: '2025-11-30', remote: true,
    heatKwh: 700, dhwM3: 2.5, dhwKwh: 281.25,
    previousMonth: { heatKwh: 400, dhwM3: 2, dhwKwh: 225 }, previousYear: { heatKwh: 350, dhwM3: 2, dhwKwh: 225 },
    referenceKwh: 600, gaps: [],
  }])
  assert.ok(log.values.some((v) => v.id === 'hkv.dhw.volume-formula'))
  assert.ok(log.values.some((v) => v.id === 'hkv.monthly-info'))
  const dez = months.find((m) => m.month === '2025-12') ?? assert.fail('Dezember fehlt')
  assert.equal(dez.due, false, 'der laufende Monat ist noch nicht fällig')
  const okt = months.find((m) => m.month === '2025-10') ?? assert.fail('Oktober fehlt')
  assert.deepEqual([okt.complete, okt.sent, okt.users[0]?.gaps], [false, false, ['reference']])
  assert.deepEqual(openMonths(months).map((o) => o.month), ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10'])
  assert.deepEqual(openMonths(months).find((o) => o.month === '2025-10'), { month: '2025-10', tenancyIds: ['t1'], notSent: true, gaps: ['reference'] })
  // Ohne Stichtag (Golden, Regression) ist jeder Monat fällig.
  assert.ok(monthlyInfoMonths(basis({ asOf: undefined }), createLawLog()).every((m) => m.due))
})

test('Formel erst fragen, wenn Warmwasser gemessen ist (Rechtsstand)', () => {
  const log = createLawLog()
  monthlyInfoMonths(basis({ meters: basis().meters.filter((m) => m.type === 'waerme') }), log)
  assert.ok(!log.values.some((v) => v.id === 'hkv.dhw.volume-formula'))
})

test('Review Focus 1: Wechsel am 15.11.: jeder Nutzer seinen Teil, der Nachnutzer ohne Vergleich mit dem Vornutzer', () => {
  const i = basis({
    tenancies: [
      { id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', start: '2024-01-01', end: '2025-11-15' },
      { id: 't2', unitId: 'a', tenantName: 'Max Beispiel', start: '2025-11-16', end: null },
    ],
    readings: [...basis().readings, r('wa', '2025-11-15', 5800), r('ww', '2025-11-15', 21)],
  })
  const nov = monthlyInfoMonths(i, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  const [a, b] = nov.users
  assert.deepEqual([a?.tenancyId, a?.from, a?.to, a?.heatKwh, a?.previousMonth?.heatKwh], ['t1', '2025-11-01', '2025-11-15', 400, 400])
  assert.deepEqual([b?.tenancyId, b?.from, b?.to, b?.heatKwh, b?.previousMonth, b?.previousYear], ['t2', '2025-11-16', '2025-11-30', 300, null, null])
  // Durchschnittsnutzer anteilig nach Tagen: 10 · 60 · 15/30 = 300 kWh
  assert.equal(b?.referenceKwh, 300)
})

test('Review Focus 3: Heizkostenverteiler ergeben keine kWh; Warmwasser ohne Temperatur auch nicht', () => {
  const hkv = basis({ meters: [{ id: 'h1', unitId: 'a', type: 'hkv', heatingPlantId: null, heatingRole: null, remoteReadable: true, installedOn: null }], readings: [r('h1', '2025-10-31', 100), r('h1', '2025-11-30', 160)] })
  const nov = monthlyInfoMonths(hkv, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([nov.users[0]?.heatKwh, nov.users[0]?.gaps, nov.complete], [null, ['hca'], false])
  const ohneTemp = monthlyInfoMonths(basis({ dhwTempC: null }), createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([ohneTemp.users[0]?.heatKwh, ohneTemp.users[0]?.dhwM3, ohneTemp.users[0]?.dhwKwh, ohneTemp.users[0]?.gaps], [700, 2.5, null, ['dhwTemp']])
})

test('Review Focus 4: Heizperiode Mai 2021 bis April 2022: verlangt erst ab Januar 2022', () => {
  // Geräte ohne Einbaudatum, damit nur der Beginn der Pflicht die Monate begrenzt.
  const ohneDatum = basis().meters.map((m) => ({ ...m, installedOn: null }))
  const months = monthlyInfoMonths(basis({ h: { from: '2021-05-01', to: '2022-04-30' }, asOf: undefined, meters: ohneDatum }), createLawLog())
  assert.deepEqual(months.map((m) => m.month), ['2022-01', '2022-02', '2022-03', '2022-04'])
  assert.deepEqual(monthlyInfoMonths(basis({ h: { from: '2021-01-01', to: '2021-12-31' }, asOf: undefined, meters: ohneDatum }), createLawLog()), [])
})

test('Gemischte Ausstattung: remote nur, wenn alle Geräte der Wohnung fernablesbar sind; der Monat ist gemischt', () => {
  const zweiWohnungen = basis({
    meters: [...basis().meters, { id: 'wb', unitId: 'b', type: 'waerme', heatingPlantId: null, heatingRole: null, remoteReadable: false, installedOn: null }],
    units: [...basis().units, { id: 'b', name: 'OG', areaM2: 40, noConnection: [] }],
    tenancies: [...basis().tenancies, { id: 't2', unitId: 'b', tenantName: 'Max Beispiel', start: '2024-01-01', end: null }],
  })
  const nov = monthlyInfoMonths(zweiWohnungen, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual(nov.users.map((u) => [u.tenancyId, u.remote]), [['t1', true], ['t2', false]])
  assert.equal(nov.mixed, true)
  // Prüfung S7: Warmwasser fernablesbar, Wärme nicht – die Wohnung ist selbst gemischt.
  const halb = basis({ meters: basis().meters.map((m) => (m.type === 'waerme' ? { ...m, remoteReadable: false } : m)) })
  const n2 = monthlyInfoMonths(halb, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([n2.users[0]?.remote, n2.mixed], [false, true])
})

test('Ohne fernablesbares Gerät keine Monate; ein Gerät zählt ab dem Monat, an dessen Ende es eingebaut ist', () => {
  const nichtFern = basis({ meters: basis().meters.map((m) => ({ ...m, remoteReadable: false })) })
  assert.deepEqual(monthlyInfoMonths(nichtFern, createLawLog()), [])
  const spaet = basis({ meters: basis().meters.map((m) => ({ ...m, installedOn: '2025-06-15' })) })
  assert.equal(monthlyInfoMonths(spaet, createLawLog())[0]?.month, '2025-06')
})

test('Prüfung M5: ein ausgebautes Gerät (ein Nachfolger übernimmt) zählt nicht; eines ohne Ablesungen oder neben einem zweiten schon', () => {
  const alt = { id: 'alt', unitId: 'a', type: 'waerme' as const, heatingPlantId: null, heatingRole: null, remoteReadable: true, installedOn: null }
  // Abgelesen bis zum Tag, an dem der Nachfolger „wa“ zum ersten Mal abgelesen ist.
  const i = basis({ meters: [...basis().meters, alt], readings: [...basis().readings, r('alt', '2023-10-31', 0), r('alt', '2024-10-31', 10)] })
  const nov = monthlyInfoMonths(i, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([nov.users[0]?.heatKwh, nov.users[0]?.gaps], [700, []])
  const neu = basis({ meters: [...basis().meters, alt] })
  const n2 = monthlyInfoMonths(neu, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([n2.users[0]?.heatKwh, n2.users[0]?.gaps], [null, ['noReading']])
  // Laufen beide zugleich (erste Ablesung von „wa“ vor der letzten von „alt“), fehlt bei „alt“ nur die Ablesung.
  const zugleich = basis({ meters: [...basis().meters, alt], readings: [...basis().readings, r('alt', '2024-10-31', 0), r('alt', '2024-12-31', 10)] })
  const n3 = monthlyInfoMonths(zugleich, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([n3.users[0]?.heatKwh, n3.users[0]?.gaps], [null, ['noReading']])
})

test('Fehlt einem von zwei Warmwasserzählern die Ablesung, steht kein halber Verbrauch da', () => {
  const zwei = basis({
    meters: [...basis().meters, { id: 'ww2', unitId: 'a', type: 'warmwasser', heatingPlantId: null, heatingRole: null, remoteReadable: true, installedOn: null }],
    readings: [...basis().readings, r('ww2', '2025-10-31', 1)],
  })
  const nov = monthlyInfoMonths(zwei, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([nov.users[0]?.heatKwh, nov.users[0]?.dhwM3, nov.users[0]?.dhwKwh, nov.users[0]?.gaps], [700, null, null, ['noReading']])
})

test('Prüfung M4: Ausnahme nur der Wärme – nur Warmwasser, ohne Lücke für die Wärme; ohne Warmwasser nur Wärme', () => {
  const nurWasser = monthlyInfoMonths(basis({ parts: { heat: false, water: true } }), createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([nurWasser.users[0]?.heatKwh, nurWasser.users[0]?.dhwM3, nurWasser.users[0]?.gaps], [null, 2.5, []])
  const nurWaerme = monthlyInfoMonths(basis({ parts: { heat: true, water: false }, dhwTempC: null }), createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([nurWaerme.users[0]?.heatKwh, nurWaerme.users[0]?.dhwM3, nurWaerme.users[0]?.gaps], [700, null, []])
  // Sind nur die Wärmezähler fernablesbar und zählt nur das Warmwasser, entsteht keine Pflicht.
  const fernWaerme = basis({ parts: { heat: false, water: true }, meters: basis().meters.map((m) => (m.type === 'warmwasser' ? { ...m, remoteReadable: false } : m)) })
  assert.deepEqual(monthlyInfoMonths(fernWaerme, createLawLog()), [])
})

test('Leerstand braucht keine Mitteilung; negativer Verbrauch ist eine Lücke', () => {
  const leer = monthlyInfoMonths(basis({ tenancies: [] }), createLawLog())
  assert.deepEqual(openMonths(leer), [])
  const rueckwaerts = basis({ readings: [r('wa', '2025-10-31', 5400), r('wa', '2025-11-30', 5300), r('ww', '2025-10-31', 20), r('ww', '2025-11-30', 22.5)] })
  const nov = monthlyInfoMonths(rueckwaerts, createLawLog()).find((m) => m.month === '2025-11') ?? assert.fail('November fehlt')
  assert.deepEqual([nov.users[0]?.heatKwh, nov.users[0]?.gaps], [null, ['negative']])
})

test('Prüfung S5: Kesseltausch – die Zeile des Monats ist die der Anlage, die am Monatsende heizt; sonst die der Linie', () => {
  const alt = { id: 'alt', units: null, devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, endsOn: '2025-06-15', replacesPlantId: null }
  const neu = { id: 'neu', units: null, devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, endsOn: null, replacesPlantId: 'alt' }
  assert.equal(heatingPlantAt([alt, neu], '2025-05-31')?.id, 'alt')
  assert.equal(heatingPlantAt([alt, neu], '2025-06-15')?.id, 'alt')
  assert.equal(heatingPlantAt([alt, neu], '2025-06-30')?.id, 'neu')
  const row = (plantId: string, month: string, ref: number) => ({ plantId, month, referenceKwhPerM2: ref, referenceSource: 'Ablesedienst', sentOn: null })
  const months = monthlyInfoMonths(basis({ plants: [alt, neu], rows: [row('alt', '2025-03', 7), row('alt', '2025-11', 1), row('neu', '2025-11', 9)] }), createLawLog())
  assert.equal(months.find((m) => m.month === '2025-03')?.row?.referenceKwhPerM2, 7)
  assert.equal(months.find((m) => m.month === '2025-11')?.row?.referenceKwhPerM2, 9)
})

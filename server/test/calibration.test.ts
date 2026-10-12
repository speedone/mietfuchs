// Eichfrist (Heizung PR 21, #98): welche Ablesungen ein Zeitraum benutzt, ob eine davon aus der Zeit nach
// Ablauf der Eichfrist stammt, und der Hinweis auf der Zähler-Seite. Die Frist endet mit dem Ende des
// Jahres (§ 34 Abs. 2 MessEV); eine Ablesung gilt in Mietfuchs zum Tagesende ihres Datums (calc.ts,
// meterSegments). Dazu das Ende der Frist aus der Jahreszahl auf dem Zähler (shared/calibration.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrationOverdue, readingsUsedFor } from '../src/calibration.ts'
import { calibrationEnd } from '../../shared/calibration.ts'
import type { CalibrationYears } from '../../shared/law/messev.ts'
import type { LawParam } from '../../shared/law/register.ts'
import { computeSettlement, consumptionOverview } from '../src/calc.ts'
import { snapshotOf, type SnapshotReading, type SnapshotSource } from '../src/snapshot.ts'

const r = (date: string, value: number, extra: Partial<SnapshotReading> = {}): SnapshotReading => ({ meterId: 'm1', date, value, ...extra })
const year2025 = { from: '2025-01-01', to: '2025-12-31' }
const dates = (rs: readonly SnapshotReading[]) => rs.map((x) => x.date)

test('Benutzte Ablesungen: Stand vor Beginn, alle im Zeitraum; danach nur, wenn am letzten Tag keine liegt', () => {
  const rs = [r('2024-06-30', 1), r('2024-12-31', 2), r('2025-06-30', 3), r('2025-12-31', 4), r('2026-01-15', 5)]
  assert.deepEqual(dates(readingsUsedFor(rs, year2025)), ['2024-12-31', '2025-06-30', '2025-12-31'])
  const ohneEnde = [r('2024-12-31', 2), r('2025-11-30', 3), r('2026-01-15', 5), r('2026-02-15', 6)]
  assert.deepEqual(dates(readingsUsedFor(ohneEnde, year2025)), ['2024-12-31', '2025-11-30', '2026-01-15'])
  const ohneAnfang = [r('2024-11-30', 1), r('2025-01-15', 2), r('2025-12-31', 3)]
  assert.deepEqual(dates(readingsUsedFor(ohneAnfang, year2025)), ['2024-11-30', '2025-01-15', '2025-12-31'])
  // Unsortiert hereingereicht ändert nichts.
  assert.deepEqual(dates(readingsUsedFor([...rs].reverse(), year2025)), ['2024-12-31', '2025-06-30', '2025-12-31'])
  // Eine Ablesung am Vortag des Beginns ist der Anfangsstand, auch wenn am ersten Tag noch eine liegt.
  assert.deepEqual(dates(readingsUsedFor([r('2024-06-30', 1), r('2024-12-31', 2), r('2025-01-01', 3), r('2025-12-31', 4)], year2025)), ['2024-12-31', '2025-01-01', '2025-12-31'])
  // Ganz ohne Ablesung im Zeitraum: die beiden, zwischen denen interpoliert wird.
  assert.deepEqual(dates(readingsUsedFor([r('2024-06-30', 1), r('2026-06-30', 2)], year2025)), ['2024-06-30', '2026-06-30'])
})

test('Review Focus 1: Die Ablesung am 31.12. des Eichjahres zählt noch, die am 01.01. danach nicht', () => {
  assert.equal(calibrationOverdue(2025, [r('2024-12-31', 1), r('2025-12-31', 2)], year2025), null)
  const naechstesJahr = { from: '2026-01-01', to: '2026-12-31' }
  assert.deepEqual(calibrationOverdue(2025, [r('2025-12-31', 2), r('2026-01-01', 3), r('2026-12-31', 9)], naechstesJahr), { lastDate: '2026-12-31' })
  assert.deepEqual(calibrationOverdue(2025, [r('2025-12-31', 2), r('2026-01-01', 3)], { from: '2026-01-01', to: '2026-01-01' }), { lastDate: '2026-01-01' })
})

test('Review Focus 2: Ohne Ablesung am Ende zählt die erste danach, auch wenn sie nach Ablauf liegt', () => {
  assert.deepEqual(calibrationOverdue(2025, [r('2024-12-31', 1), r('2025-11-30', 2), r('2026-01-15', 3)], year2025), { lastDate: '2026-01-15' })
  // Liegt am letzten Tag eine Ablesung, zählt die spätere nicht.
  assert.equal(calibrationOverdue(2025, [r('2024-12-31', 1), r('2025-12-31', 2), r('2026-01-15', 3)], year2025), null)
})

test('Review Focus 3: Nur das Gerät seit dem letzten Wechsel wird geprüft', () => {
  const rs = [
    r('2024-12-31', 100),
    r('2025-06-30', 0, { replacement: true, oldEndValue: 150 }),
    r('2025-12-31', 40),
  ]
  // Das neue Gerät ist bis 2031 geeicht; die Stände des alten Geräts kennt Mietfuchs nicht.
  assert.equal(calibrationOverdue(2031, rs, year2025), null)
  assert.deepEqual(calibrationOverdue(2024, rs, year2025), { lastDate: '2025-12-31' })
  // Das alte Gerät lief schon 2024 ab: Sein Stand vom 31.12.2024 zählt nicht gegen das neue.
  assert.equal(calibrationOverdue(2025, rs, year2025), null)
})

test('Prüfung K8: Liegt der Wechsel auf dem letzten Tag oder danach, misst das heutige Gerät im Zeitraum nichts', () => {
  // Der Wechsel nach dem Ende liefert mit `oldEndValue` den Stand des alten Geräts; das Eichjahr gehört dem neuen.
  const danach = [r('2024-12-31', 100), r('2025-11-30', 140), r('2026-01-15', 0, { replacement: true, oldEndValue: 150 })]
  assert.deepEqual(dates(readingsUsedFor(danach, year2025)), ['2024-12-31', '2025-11-30', '2026-01-15'])
  assert.equal(calibrationOverdue(2020, danach, year2025), null)
  const amEnde = [r('2024-12-31', 100), r('2025-12-31', 0, { replacement: true, oldEndValue: 150 })]
  assert.equal(calibrationOverdue(2020, amEnde, year2025), null)
  // Im Folgejahr misst das neue Gerät vom ersten Tag an.
  assert.deepEqual(calibrationOverdue(2020, [...amEnde, r('2026-12-31', 30)], { from: '2026-01-01', to: '2026-12-31' }), { lastDate: '2026-12-31' })
})

test('Ohne Eichjahr oder ohne Ablesung kein Befund', () => {
  assert.equal(calibrationOverdue(null, [r('2025-12-31', 1)], year2025), null)
  assert.equal(calibrationOverdue(undefined, [r('2025-12-31', 1)], year2025), null)
  assert.equal(calibrationOverdue(2020, [], year2025), null)
  // Eine Ablesung vor oder nach dem Zeitraum ohne Gegenstück ergibt keinen Verbrauch und wird nicht benutzt.
  assert.deepEqual(readingsUsedFor([r('2023-12-31', 1)], year2025), [])
  assert.deepEqual(readingsUsedFor([r('2026-12-31', 1)], year2025), [])
  assert.equal(calibrationOverdue(2020, [r('2026-12-31', 1)], year2025), null)
  // Eine einzelne Ablesung im Zeitraum ist eine Ablesung des Zeitraums.
  assert.deepEqual(calibrationOverdue(2020, [r('2025-06-30', 1)], year2025), { lastDate: '2025-06-30' })
})

const source = (over: Partial<SnapshotSource> = {}): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const zaehler = (calibratedUntil?: number) => source({
  meters: [{ id: 'm1', name: 'Kaltwasser Haus', unitId: null, type: 'kaltwasser', ...(calibratedUntil === undefined ? {} : { calibratedUntil }) }],
  readings: [
    { meterId: 'm1', date: '2024-12-31', value: 100 },
    { meterId: 'm1', date: '2025-12-31', value: 180 },
  ],
})

test('Zähler-Seite: Warnung mit Jahr, Datum, MessEG, Beweislast mit dem Leitsatz und § 35; ohne Eichjahr nichts', () => {
  assert.deepEqual(consumptionOverview(snapshotOf(zaehler(), 2025)).flatMap((z) => z.notices.map((n) => n.code)), [])
  assert.deepEqual(consumptionOverview(snapshotOf(zaehler(2025), 2025)).flatMap((z) => z.notices.map((n) => n.code)), [])
  const zeile = consumptionOverview(snapshotOf(zaehler(2024), 2025)).find((z) => z.meterId === 'm1') ?? assert.fail('Zähler fehlt')
  const n = zeile.notices.find((x) => x.code === 'meter.calibration-overdue') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.equal(n.rule, 'meter-calibration')
  assert.equal(n.title, 'Eichfrist abgelaufen')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'm1' })
  assert.match(n.text, /„Kaltwasser Haus“.*bis Ende 2024 geeicht.*Ablesung vom 31\.12\.2025/s)
  assert.match(n.text, /§ 37 Abs\. 1, § 33 Abs\. 1 MessEG/)
  assert.match(n.text, /Ordnungswidrigkeit/)
  assert.match(n.text, /rechnet mit den Werten trotzdem/)
  assert.match(n.text, /„Den von einem nicht \(mehr\) geeichten Messgerät abgelesenen Werten kommt die Vermutung ihrer Richtigkeit nicht zu\. In diesem Fall muss der Vermieter im Prozess die Richtigkeit der abgelesenen Werte zur Überzeugung des Tatrichters nachweisen\.“ \(BGH VIII ZR 112\/10, Leitsatz c\)/)
  assert.match(n.text, /§ 35 MessEV/)
  assert.match(n.text, /auf dem Zähler ist das nicht zu sehen/)
  assert.ok(zeile.warnings.includes(n.text), 'die Textliste führt den Hinweis wie die übrigen')
  // Die Werte werden verwendet: der Verbrauch bleibt.
  assert.equal(zeile.consumption, 80)
})

test('Nicht auf der Abrechnung, keine Zahl ändert sich, kein Rechtswert im Rechtsstand', () => {
  const bestand = (until?: number) => {
    const s = zaehler(until)
    return source({
      ...s,
      units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }],
      meters: [{ id: 'm1', name: 'Kaltwasser EG', unitId: 'a', type: 'kaltwasser', ...(until === undefined ? {} : { calibratedUntil: until }) }],
      tenancies: [{ id: 't', unitId: 'a', tenantName: 'A', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
      costItems: [{ id: 'w', period: snapshotOf(s, 2025).period.key, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 50000, key: 'meter', meterType: 'kaltwasser' }],
    })
  }
  const ohne = computeSettlement(snapshotOf(bestand(), 2025))
  const mit = computeSettlement(snapshotOf(bestand(2020), 2025))
  assert.deepEqual(mit.statements, ohne.statements)
  assert.deepEqual(mit.notices, ohne.notices)
  assert.deepEqual(mit.legalBasis, ohne.legalBasis)
  assert.ok(!mit.legalBasis.values.some((v) => v.id === 'messev.calibration-years'))
  assert.ok(!mit.legalBasis.rules.some((x) => x.code === 'meter-calibration'))
})

// ---------- Ende der Frist aus der Jahreszahl auf dem Zähler (shared/calibration.ts) ----------

test('Ende der Eichfrist: Kaltwasser je 6 Jahre, Warmwasser und Wärme bis zur Jahreszahl 2015 fünf, danach sechs', () => {
  assert.deepEqual(calibrationEnd('kaltwasser', 2018), { kind: 'end', year: 2024, years: 6, change: null })
  assert.deepEqual(calibrationEnd('kaltwasser', 2015), { kind: 'end', year: 2021, years: 6, change: null })
  assert.deepEqual(calibrationEnd('warmwasser', 2022), { kind: 'end', year: 2028, years: 6, change: null })
  // Die Frist lief vor dem 03.11.2021 ab (Ende 2020): Die neue Zahl lässt sie nicht wieder aufleben.
  assert.deepEqual(calibrationEnd('warmwasser', 2015), { kind: 'end', year: 2020, years: 5, change: null })
  assert.deepEqual(calibrationEnd('waerme', 2010 + 5), { kind: 'end', year: 2020, years: 5, change: null })
})

test('R21-1: Eine am 03.11.2021 laufende Frist richtet sich nach der neuen Zahl (keine Übergangsregel in der Änderungsverordnung)', () => {
  for (const [jahr, ende] of [[2016, 2022], [2019, 2025], [2020, 2026], [2021, 2027]] as const) {
    for (const type of ['warmwasser', 'waerme'] as const) {
      assert.deepEqual(calibrationEnd(type, jahr), { kind: 'end', year: ende, years: 6, change: { from: '2021-11-03', before: 5, after: 6 } }, `${type} ${jahr}`)
    }
  }
})

test('Ende der Eichfrist: ohne Fassung (vor 2015) und für Sparten ohne Frist im Register kein Ende', () => {
  assert.deepEqual(calibrationEnd('kaltwasser', 2014), { kind: 'beforeRegister', firstYear: 2015 })
  assert.deepEqual(calibrationEnd('strom', 2024), { kind: 'notInRegister' })
  assert.deepEqual(calibrationEnd('sonstig', 2024), { kind: 'notInRegister' })
  assert.deepEqual(calibrationEnd('hkv', 2024), { kind: 'notInRegister' })
})

test('Übergang an der Grenze: Eine neue Zahl am 31.12. des Endjahres gilt noch, eine am 01.01. danach nicht mehr', () => {
  const quelle = { rank: 'law', cite: '§ 1 Beispielverordnung', url: 'https://example.org/1', retrieved: '2026-10-12', checked: 'checked' } as const
  const fassungen = (wechsel: string): LawParam<CalibrationYears> => ({
    id: 'beispiel.eichfrist', title: 'Beispiel', norm: '§ 1', timing: 'eventDate',
    versions: [
      { validFrom: '2015-01-01', validTo: `${Number(wechsel.slice(0, 4)) - (wechsel.endsWith('01-01') ? 1 : 0)}-${wechsel.endsWith('01-01') ? '12-31' : '12-30'}`, value: { kaltwasser: 6, warmwasser: 5, waerme: 5 }, source: quelle, enacted: 'x' },
      { validFrom: wechsel, value: { kaltwasser: 6, warmwasser: 6, waerme: 6 }, source: quelle, enacted: 'x' },
    ],
    describe: () => 'x',
  })
  // Jahreszahl 2016, fünf Jahre: Ende 31.12.2021.
  assert.deepEqual(calibrationEnd('warmwasser', 2016, fassungen('2021-12-31')), { kind: 'end', year: 2022, years: 6, change: { from: '2021-12-31', before: 5, after: 6 } })
  assert.deepEqual(calibrationEnd('warmwasser', 2016, fassungen('2022-01-01')), { kind: 'end', year: 2021, years: 5, change: null })
})

// Betriebsstrom fehlt (#224) und Strom zur Wärmeerzeugung im Allgemeinstrom (#253), Folge-PR zu #252. Beide Hinweise
// sind Auskunft; sie dürfen keinen Fall mit sauber erfasstem Betriebsstrom treffen, auch keinen Messdienst-Fall, in
// dem der Messdienst den Betriebsstrom schon enthält. Deshalb steht neben jedem Positivfall eine Reihe von
// Negativfällen, je einer für jede Bedingung (Plan pr-betriebsstrom-hinweise-plan.md, A.3 und B.4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { BillingPeriod, HeatingEnergy, PeriodRules } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
type Plant = NonNullable<Source['heatingPlants']>[number]
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

const anlage = (over: Partial<Plant> = {}): Plant => ({
  id: 'hp1', propertyId: 'objekt-1', name: 'Kessel', method: 'manual', source: 'building', supply: 'central',
  energy: 'gas', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null,
  periodStartMonth: null, periodChanges: [], separateSpans: [], separateSettlement: false, endsOn: null, replacesPlantId: null, ...over,
})
const position = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) => ({
  id, propertyId: 'objekt-1', period: periodKey(key), category: 'Grundsteuer', description: id, amountCents, key: 'area' as const, ...over,
})
const heizung = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) =>
  position(id, key, amountCents, { category: HEATING_CATEGORY, heatingPlantId: 'hp1', ...over })
const brennstoff = (key = '2025-01', over: Record<string, unknown> = {}) => heizung('gas', key, 500000, { description: 'Gas 2025', heatingPart: 'fuel', ...over })
const hausstrom = (key = '2025-01', over: Record<string, unknown> = {}) => position('hs', key, 100000, { category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', key: 'units', ...over })
const mieter = (id: string, unitId: string) => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const haus = (costItems: ReturnType<typeof position>[], plants: Plant[] = [anlage()], over: Partial<Source> = {}): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: true }],
  tenancies: [mieter('t1', 'u1'), mieter('t2', 'u2')], costItems, meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: plants,
  ...over,
} as Source)
const settle = (src: Source, key = '2025-01', rules: PeriodRules = CALENDAR_RULES): ComputedSettlement =>
  computeSettlement(snapshotFor(src, 'objekt-1', of(rules, key)))
const A = 'heating.operating-power-missing'
const B = 'heating.generation-power-missing'
const found = (s: ComputedSettlement, code: string) => (s.notices ?? []).filter((n) => n.code === code)
const one = (s: ComputedSettlement, code: string) => {
  const list = found(s, code)
  assert.equal(list.length, 1, `${code}: ${list.length} statt 1`)
  return list[0] ?? assert.fail('kein Hinweis')
}
const silent = (s: ComputedSettlement) => assert.deepEqual([...found(s, A), ...found(s, B)].map((n) => n.code), [])

// Gesicherter Betriebsstrom samt Abzug wie mit der Schätzhilfe.
const betriebsstrom = (over: Record<string, unknown> = {}) => heizung('bs', '2025-01', 10000, { description: 'Betriebsstrom', heatingPart: 'operating', operatingPower: 'included', operatingPowerBasis: 'geschätzt', ...over })
const abzug = (over: Record<string, unknown> = {}) => position('ab', '2025-01', -10000, { category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Betriebsstrom', key: 'units', operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerGeneralId: 'hs', operatingPowerBasis: 'geschätzt', ...over })

// ---------- A: Betriebsstrom fehlt ----------

test('A: Gasheizung mit Brennstoff und Allgemeinstrom, sonst nichts: ein Hinweis (hint) mit Rechtsgrundlagen und beiden Wegen', () => {
  const n = one(settle(haus([brennstoff(), hausstrom()])), A)
  assert.equal(n.level, 'hint')
  assert.equal(n.title, 'Betriebsstrom der Heizung fehlt')
  assert.deepEqual(n.subject, { kind: 'heatingCosts', id: 'hp1' })
  assert.match(n.text, /^Für die Heizanlage „Kessel“ ist für 2025 kein Betriebsstrom erfasst \(keine Heizposition mit dem Teil „Betrieb“\), und beim Allgemeinstrom „Hausstrom“ steht kein Abzug dafür\./)
  assert.match(n.text, /§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV; § 2 Nr\. 4 Buchst\. a, Nr\. 5 Buchst\. a BetrKV/)
  assert.match(n.text, /dort darf er nicht stehen \(BGH, Urteil vom 03\.06\.2016, V ZR 166\/15, Rn\. 13\)/)
  assert.match(n.text, /VIII ZR 27\/07, Leitsatz 3/)
  // R3-W-1: selbst tragen nur über den Abzug.
  assert.match(n.text, /Wollen Sie ihn nicht umlegen, ziehen Sie ihn trotzdem beim Allgemeinstrom ab; dann tragen Sie ihn selbst \(V ZR 166\/15, Rn\. 15\)/)
  assert.doesNotMatch(n.text, /nur aus den Heizkosten/)
  // K-1 und H-3.
  assert.match(n.text, /Tragen Sie den Strom eines eigenen Zählers selbst, ist nichts falsch; der Hinweis bleibt dann stehen\./)
  assert.match(n.text, /Gilt für einen Mieter beim Allgemeinstrom eine Pauschale oder Inklusivmiete, folgt daraus für ihn nichts\./)
})

test('A: mit eigener Heizkostenabrechnung (self) und ebenso bei Öl, Pellets', () => {
  for (const energy of ['oil', 'pellets', 'lpg', 'wood', 'coal'] as HeatingEnergy[]) one(settle(haus([brennstoff(), hausstrom()], [anlage({ energy })])), A)
  one(settle(haus([brennstoff('2025-01', { key: 'heatingSystem', heatingTarget: 'both' }), hausstrom()], [anlage({ method: 'self' })])), A)
})

test('A: zwei Anlagen, eine sauber: nur die andere', () => {
  const s = settle(haus([brennstoff(), heizung('oel', '2025-01', 300000, { heatingPlantId: 'hp2', heatingPart: 'fuel', description: 'Öl' }), betriebsstrom(), hausstrom(), abzug()],
    [anlage(), anlage({ id: 'hp2', name: 'Ölkessel', energy: 'oil' })]))
  assert.deepEqual(found(s, A).map((n) => n.subject?.id), ['hp2'])
})

test('A: Anlage mit eigener Heizperiode (Weg b): einmal in P, nicht auch im Unteraufruf; sauber erfasst still', () => {
  const plant = anlage({ periodStartMonth: 5 })
  const roh = haus([heizung('gas', '2024-05', 500000, { heatingPart: 'fuel', taxYear: 2025 }), hausstrom()], [plant])
  one(settle(roh), A)
  silent(settle(haus([heizung('gas', '2024-05', 500000, { heatingPart: 'fuel', taxYear: 2025 }), heizung('bs', '2024-05', 10000, { heatingPart: 'operating', operatingPower: 'included', operatingPowerBasis: 'x', taxYear: 2025 }), hausstrom(), abzug()], [plant])))
})

// Nur in der Gesamtberechnung: Ein Unteraufruf einer Heizperiode (Weg b) oder eine Heizkostenabrechnung (Weg d) meldet
// nichts, auch wenn sein Bestand Allgemeinstrom enthielte; sonst stünde der Hinweis doppelt.
test('A und B nur in der Gesamtberechnung, nicht in Teil- oder Heizkostenabrechnungen', () => {
  for (const [plant, items] of [[anlage(), [brennstoff(), hausstrom()]], [wp(), [hausstrom()]]] as const) {
    const src = haus([...items], [plant])
    assert.equal([...found(settle(src), A), ...found(settle(src), B)].length, 1, 'in der Gesamtberechnung genau ein Hinweis')
    const snap = snapshotFor(src, 'objekt-1', of(CALENDAR_RULES, '2025-01'))
    const p = snap.heatingPlants?.[0] ?? assert.fail('keine Anlage')
    for (const kind of ['heatingPart', 'heating'] as const) silent(computeSettlement({ ...snap, scope: { kind, plant: p } }))
  }
})

// Negativfälle A.3.
test('A-n1: Betriebsstrom gekennzeichnet mit gleich hohem Abzug: still', () => silent(settle(haus([brennstoff(), betriebsstrom(), hausstrom(), abzug()]))))
test('A-n2: Betriebsstrom über eigenen Zähler (Heizposition „Betrieb“ ohne Kennzeichnung): still', () =>
  silent(settle(haus([brennstoff(), heizung('bs', '2025-01', 9000, { heatingPart: 'operating', description: 'Heizstrom Zähler 2' }), hausstrom()]))))
test('A-n3: eigene Heizkostenabrechnung mit Betriebsstrom und Abzug: still', () =>
  silent(settle(haus([brennstoff('2025-01', { key: 'heatingSystem', heatingTarget: 'both' }), betriebsstrom({ key: 'heatingSystem', heatingTarget: 'both' }), hausstrom(), abzug()], [anlage({ method: 'self' })]))))
test('A-n4: Messdienst, Heizposition nach Einzelbeträgen (Betriebsstrom darin), Allgemeinstrom ohne Abzug: still', () =>
  silent(settle(haus([heizung('md', '2025-01', 300000, { heatingPart: 'fuel', key: 'amounts', tenancyAmounts: { t1: 180000, t2: 120000 } }), hausstrom()], [anlage({ method: 'service' })]))))
test('A-n5: Messdienst mit Abzug „an Messdienst gemeldet“: still', () =>
  silent(settle(haus([heizung('md', '2025-01', 300000, { heatingPart: 'fuel', key: 'amounts', tenancyAmounts: { t1: 180000, t2: 120000 } }), hausstrom(), abzug({ operatingPowerItemId: undefined })], [anlage({ method: 'service' })]))))
test('A-n6: Abzug ohne Verweis bei einer Anlage ohne Messdienst: Antwort des Vermieters, still', () =>
  silent(settle(haus([brennstoff(), hausstrom(), abzug({ operatingPowerItemId: undefined })]))))
test('A-n7: Eigentumswohnung (Gemeinschaft liefert die Abrechnung): still', () => silent(settle(haus([brennstoff(), hausstrom()], [anlage({ source: 'homeowners', method: 'manual' })]))))
test('A-n8: Etagenheizung: still', () => silent(settle(haus([brennstoff(), hausstrom()], [anlage({ supply: 'perUnit' })]))))
test('A-n9: kein Allgemeinstrom (F2): still', () => silent(settle(haus([brennstoff()]))))
test('A-n10: Allgemeinstrom nur laut Gemeinschaftsabrechnung oder nach Einzelbeträgen: still', () => {
  silent(settle(haus([brennstoff(), hausstrom('2025-01', { key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 500000 } })])))
  silent(settle(haus([brennstoff(), hausstrom('2025-01', { key: 'amounts', tenancyAmounts: { t1: 50000, t2: 50000 } })])))
})
test('A-n11: Anlage ohne Heizposition im Zeitraum: still', () => silent(settle(haus([hausstrom(), brennstoff('2024-01')]))))
test('A-n12: Wärmepumpe und Elektrokessel: kein Hinweis A', () => {
  for (const energy of ['heatPump', 'electric'] as HeatingEnergy[]) assert.equal(found(settle(haus([heizung('w', '2025-01', 30000, { heatingPart: 'operating', description: 'Wartung' }), hausstrom()], [anlage({ energy })])), A).length, 0)
})
test('A-n13: Fernwärme und „sonstige“ (F3): still', () => {
  for (const energy of ['districtHeating', 'other'] as HeatingEnergy[]) silent(settle(haus([brennstoff(), hausstrom()], [anlage({ energy })])))
})
test('A-n14: Heizposition ohne Teil (alter Bestand): still', () => silent(settle(haus([heizung('alt', '2025-01', 500000, { description: 'Heizkosten' }), hausstrom()]))))
test('A-n15: gekennzeichnet ohne Abzug: nur der Hinweis auf den doppelt verteilten Betriebsstrom', () => {
  const s = settle(haus([brennstoff(), betriebsstrom(), hausstrom()]))
  assert.equal(found(s, A).length, 0)
  assert.equal(found(s, 'heating.operating-power-double').length, 1)
})
test('A-n16: Wartung als „Betrieb“ (die Grenze aus F1): still', () =>
  silent(settle(haus([brennstoff(), heizung('w', '2025-01', 30000, { heatingPart: 'operating', description: 'Wartung' }), hausstrom()]))))

// ---------- B: Strom zur Wärmeerzeugung womöglich im Allgemeinstrom ----------

const wp = (over: Partial<Plant> = {}) => anlage({ name: 'Wärmepumpe', energy: 'heatPump', ...over })
const wartung = (key = '2025-01') => heizung('w', key, 30000, { heatingPart: 'operating', description: 'Wartung' })

test('B: Wärmepumpe, nur Wartung, Allgemeinstrom 2025: ein Hinweis (hint) mit beiden Verordnungen und der Auslegung', () => {
  const s = settle(haus([wartung(), hausstrom()], [wp()]))
  const n = one(s, B)
  assert.equal(n.level, 'hint')
  assert.equal(n.title, 'Strom zur Wärmeerzeugung womöglich im Allgemeinstrom')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'hs' })
  assert.match(n.text, /^Für die Heizanlage „Wärmepumpe“ \(Wärmepumpe\) ist für 2025 keine Rechnung über den Strom erfasst, den sie zur Wärmeerzeugung verbraucht/)
  // Recht H-1 (Nachprüfung fc20455): „soweit die Heizkostenverordnung für die Anlage gilt“.
  assert.match(n.text, /Diesen Strom zählt § 2 Nr\. 4 Buchst\. a BetrKV seit dem 01\.01\.2024 zu den Heizkosten, ebenso § 7 Abs\. 2 HeizkostenV seit dem 01\.10\.2024, soweit die Heizkostenverordnung für die Anlage gilt \(§ 8 Abs\. 2 HeizkostenV verweist darauf\)\./)
  assert.match(n.text, /Dass er dann aus dem Allgemeinstrom herauszurechnen ist, ist eine Auslegung von Mietfuchs: Entschieden hat der Bundesgerichtshof das für den Betriebsstrom/)
  // K-3: die Schätzung als Auslegung, mit dem eigenen Zähler als sicherem Weg.
  assert.match(n.text, /für den Strom einer Wärmepumpe oder eines Elektrokessels ist es eine Auslegung von Mietfuchs, und bei einem so großen Anteil ist ein eigener Zähler der sichere Weg/)
  assert.doesNotMatch(n.text, /bleibt nur eine Schätzung/)
  assert.match(n.text, /Tragen Sie den Strom eines eigenen Zählers selbst, ist nichts falsch; der Hinweis bleibt dann stehen\./)
  assert.match(n.text, /Gilt für einen Mieter beim Allgemeinstrom eine Pauschale oder Inklusivmiete, folgt daraus für ihn nichts\./)
  assert.equal(found(s, A).length, 0)
  // Der Rechtsstand führt beide Fassungen.
  assert.deepEqual((s.legalBasis.values ?? []).filter((v) => v.id.endsWith('generation-power')).map((v) => v.id).sort(), ['betrkv.generation-power', 'hkv.generation-power'])
})

test('B: ganz ohne Heizposition und beim Elektrokessel', () => {
  one(settle(haus([hausstrom()], [wp()])), B)
  assert.match(one(settle(haus([hausstrom()], [wp({ energy: 'electric', name: 'Kessel' })])), B).text, /„Kessel“ \(Elektrokessel\)/)
})

test('B: Rumpf 01.01.–30.06.2024: nur die Betriebskostenverordnung, nicht die Heizkostenverordnung', () => {
  const rules: PeriodRules = { startMonth: 1, changes: ['2024-07'] }
  const src = haus([hausstrom('2024-01')], [wp()], { properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: rules }] } as Partial<Source>)
  const s = settle(src, '2024-01', rules)
  const n = one(s, B)
  assert.match(n.text, /seit dem 01\.01\.2024 zu den Heizkosten\. Läuft er/)
  assert.doesNotMatch(n.text, /HeizkostenV seit/)
  assert.deepEqual((s.legalBasis.values ?? []).filter((v) => v.id.endsWith('generation-power')).map((v) => v.id), ['betrkv.generation-power'])
})

test('B: Abrechnung 2024 (Kalenderjahr) berührt beide Fassungen', () => {
  assert.match(one(settle(haus([hausstrom('2024-01')], [wp()]), '2024-01'), B).text, /BetrKV seit dem 01\.01\.2024 zu den Heizkosten, ebenso § 7 Abs\. 2 HeizkostenV seit dem 01\.10\.2024, soweit die Heizkostenverordnung für die Anlage gilt/)
})

test('Gas ohne Hinweis: Der Rechtsstand nennt die neuen Fassungen nicht (Register erst nach den Bedingungen)', () => {
  const s = settle(haus([wartung(), heizung('wp', '2025-01', 300000, { heatingPart: 'fuel', description: 'Strom Wärmepumpe' }), hausstrom()], [wp()]))
  silent(s)
  assert.deepEqual((s.legalBasis.values ?? []).filter((v) => v.id.endsWith('generation-power')), [])
})

// Negativfälle B.4.
test('B-n1: eigene Stromrechnung der Wärmepumpe („Brennstoff/Energie“ ohne Kennzeichnung): still', () =>
  silent(settle(haus([heizung('wp', '2025-01', 300000, { heatingPart: 'fuel', description: 'Wärmepumpenstrom' }), hausstrom()], [wp()]))))
test('B-n2: Strom-Position gekennzeichnet mit gleich hohem Abzug: still', () =>
  silent(settle(haus([heizung('bs', '2025-01', 30000, { heatingPart: 'fuel', operatingPower: 'included', operatingPowerBasis: 'x', description: 'WP-Strom' }), hausstrom(), abzug({ amountCents: -30000 })], [wp()]))))
test('B-n3: gekennzeichnet ohne Abzug: nur der Hinweis auf den doppelt verteilten Strom', () => {
  const s = settle(haus([heizung('bs', '2025-01', 30000, { heatingPart: 'fuel', operatingPower: 'included', operatingPowerBasis: 'x', description: 'WP-Strom' }), hausstrom()], [wp()]))
  assert.equal(found(s, B).length, 0)
  assert.equal(found(s, 'heating.operating-power-double').length, 1)
})
// Pumpen und Regelung der Wärmepumpe als Betriebsstrom gekennzeichnet, ohne Abzug und ohne Stromrechnung der Wärmepumpe:
// Der Hinweis auf den doppelt verteilten Betriebsstrom genügt (Bedingung 3 in B.2).
test('B-n3b: Betriebsstrom der Wärmepumpe gekennzeichnet ohne Abzug: kein Hinweis B, nur der doppelt verteilte Betriebsstrom', () => {
  const s = settle(haus([betriebsstrom(), hausstrom()], [wp()]))
  assert.equal(found(s, B).length, 0)
  assert.equal(found(s, 'heating.operating-power-double').length, 1)
})
test('B-n4: Messdienst mit Wärmepumpe, Beträge des Messdienstes, Allgemeinstrom ohne Abzug: still', () =>
  silent(settle(haus([heizung('md', '2025-01', 300000, { heatingPart: 'fuel', key: 'amounts', tenancyAmounts: { t1: 180000, t2: 120000 } }), hausstrom()], [wp({ method: 'service' })]))))
test('B-n5: Abzug ohne Verweis im Zeitraum: still', () => silent(settle(haus([wartung(), hausstrom(), abzug({ operatingPowerItemId: undefined })], [wp()]))))
test('B-n6: kein Allgemeinstrom: still', () => silent(settle(haus([wartung()], [wp()]))))
test('B-n7: Eigentumswohnung: still', () => silent(settle(haus([wartung(), hausstrom()], [wp({ source: 'homeowners' })]))))
test('B-n8: Etagenheizung: still', () => silent(settle(haus([wartung(), hausstrom()], [wp({ supply: 'perUnit' })]))))
test('B-n9: Anlage endet vor dem Zeitraum: still', () => silent(settle(haus([hausstrom()], [wp({ endsOn: '2024-06-30' })]))))
test('B-n10: Anlage ersetzt eine, die erst nach dem Zeitraum endet: still', () =>
  silent(settle(haus([hausstrom()], [anlage({ id: 'alt', name: 'Gas', endsOn: '2026-03-31' }), wp({ replacesPlantId: 'alt' })]))))
test('B-n11: Abrechnung 2023 (ganz vor dem 01.01.2024, F4): still, und nichts im Rechtsstand', () => {
  const s = settle(haus([hausstrom('2023-01')], [wp()]), '2023-01')
  silent(s)
  assert.deepEqual((s.legalBasis.values ?? []).filter((v) => v.id.endsWith('generation-power')), [])
})
test('B-n12: Gasheizung: kein Hinweis B', () => assert.equal(found(settle(haus([brennstoff(), hausstrom()])), B).length, 0))
test('B-n13: Heizposition ohne Teil: still', () => silent(settle(haus([heizung('alt', '2025-01', 300000, { description: 'Heizkosten' }), hausstrom()], [wp()]))))

// ---------- Kein Zahlenwechsel ----------
// Beide Hinweise sind Auskunft: Ohne sie ergäbe dieselbe Abrechnung dieselben Zahlen. Zum Vergleich steht dieselbe
// Anlage mit der Energie „sonstige“, für die keiner der beiden Hinweise kommt (ohne CO₂-Angaben rechnet die Energie
// nichts). Verglichen werden die Zahlen, auch `landlord` und `selfUsedShareCents` (Geldprüfung, Punkt 5).
test('Kein Zahlenwechsel: dieselbe Abrechnung ohne die Hinweise rechnet gleich', () => {
  for (const [items, plant] of [[[brennstoff(), hausstrom()], anlage()], [[wartung(), hausstrom()], wp()]] as const) {
    const mit = settle(haus([...items], [plant]))
    const ohneHinweis = settle(haus([...items], [{ ...plant, energy: 'other' }]))
    silent(ohneHinweis)
    assert.ok([...found(mit, A), ...found(mit, B)].length === 1)
    const zahlen = (s: ComputedSettlement) => ({ statements: s.statements, landlord: s.landlord, selfUsedShareCents: s.selfUsedShareCents, totalCostsCents: s.totalCostsCents })
    assert.deepEqual(zahlen(mit), zahlen(ohneHinweis))
  }
})

// ---------- Angabe an der Anlage, wie der Betriebsstrom erfasst ist (#266) ----------
// Mit Angabe kommt der Hinweis gezielt oder schweigt; ohne Angabe bleibt alles wie oben (Plan pr266, Abschnitt 4).

const AD = 'heating.operating-power-deduction-missing'
const AB = 'heating.operating-power-bill-missing'
const HANDLINGS = ['ownMeter', 'deducted', 'landlordPays'] as const
const alle = (s: ComputedSettlement) => [...found(s, A), ...found(s, B), ...found(s, AD), ...found(s, AB)].map((n) => n.code)
const still = (s: ComputedSettlement) => assert.deepEqual(alle(s), [])
const mitAngabe = (operatingPowerHandling: Plant['operatingPowerHandling'], over: Partial<Plant> = {}) => anlage({ operatingPowerHandling, ...over })

test('D1: Abzug angegeben, Wartung als „Betrieb“, Hausstrom ohne Abzug: genau ein Hinweis „Abzug fehlt“ (hint), kein A', () => {
  const s = settle(haus([brennstoff(), wartung(), hausstrom()], [mitAngabe('deducted')]))
  const n = one(s, AD)
  assert.equal(n.level, 'hint')
  assert.equal(n.title, 'Abzug des Betriebsstroms fehlt')
  assert.deepEqual(n.subject, { kind: 'heatingCosts', id: 'hp1' })
  assert.deepEqual(alle(s), [AD])
})
test('D1b: Abzug angegeben, Heizposition „Betrieb“ ohne Kennzeichnung (vielleicht der Betriebsstrom selbst): Hinweis „Abzug fehlt“', () =>
  assert.deepEqual(alle(settle(haus([brennstoff(), heizung('bs', '2025-01', 9000, { heatingPart: 'operating', description: 'Heizstrom' }), hausstrom()], [mitAngabe('deducted')]))), [AD]))
test('D1c: Abzug angegeben, Heizposition ohne Teil (alter Bestand): Hinweis „Abzug fehlt“', () =>
  assert.deepEqual(alle(settle(haus([heizung('alt', '2025-01', 500000, { description: 'Heizkosten' }), hausstrom()], [mitAngabe('deducted')]))), [AD]))
test('D1d: Abzug angegeben, nur Brennstoff: Hinweis „Abzug fehlt“ statt A', () =>
  assert.deepEqual(alle(settle(haus([brennstoff(), hausstrom()], [mitAngabe('deducted')]))), [AD]))
test('D2: Abzug angegeben, Betriebsstrom gekennzeichnet samt Abzug mit Verweis: still', () =>
  still(settle(haus([brennstoff(), wartung(), betriebsstrom(), hausstrom(), abzug()], [mitAngabe('deducted')]))))
test('D3: Abzug angegeben, Abzug ohne Verweis: still', () =>
  still(settle(haus([brennstoff(), wartung(), hausstrom(), abzug({ operatingPowerItemId: undefined })], [mitAngabe('deducted')]))))
test('D4: Abzug angegeben, gekennzeichnet ohne Abzug: nur der Hinweis auf den doppelt verteilten Betriebsstrom', () => {
  const s = settle(haus([brennstoff(), betriebsstrom(), hausstrom()], [mitAngabe('deducted')]))
  still(s)
  assert.equal(found(s, 'heating.operating-power-double').length, 1)
})
test('D5: Abzug angegeben, kein Allgemeinstrom: still', () => still(settle(haus([brennstoff(), wartung()], [mitAngabe('deducted')]))))
test('D6: Abzug angegeben, Allgemeinstrom nur laut Gemeinschaftsabrechnung oder nach Einzelbeträgen: still', () => {
  still(settle(haus([brennstoff(), wartung(), hausstrom('2025-01', { key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 500000 } })], [mitAngabe('deducted')])))
  still(settle(haus([brennstoff(), wartung(), hausstrom('2025-01', { key: 'amounts', tenancyAmounts: { t1: 50000, t2: 50000 } })], [mitAngabe('deducted')])))
})
test('D7: Abzug angegeben, ein Abzug nur im Vorjahr: Hinweis im laufenden Jahr', () => {
  const src = haus([brennstoff(), wartung(), hausstrom(), hausstrom('2024-01', { id: 'hs24' }), abzug({ id: 'ab24', period: periodKey('2024-01'), operatingPowerItemId: undefined, operatingPowerGeneralId: 'hs24' })], [mitAngabe('deducted')])
  assert.deepEqual(alle(settle(src)), [AD])
  assert.deepEqual(alle(settle(src, '2024-01')), [], '2024 hat seinen Abzug')
})
test('D8: zwei Anlagen mit Abzug angegeben, der Abzug gehört zur ersten: Hinweis nur für die zweite', () => {
  const s = settle(haus([brennstoff(), heizung('oel', '2025-01', 300000, { heatingPlantId: 'hp2', heatingPart: 'fuel', description: 'Öl' }), betriebsstrom(), hausstrom(), abzug()],
    [mitAngabe('deducted'), mitAngabe('deducted', { id: 'hp2', name: 'Ölkessel', energy: 'oil' })]))
  assert.deepEqual([...found(s, AD), ...found(s, A)].map((n) => [n.code, n.subject?.id]), [[AD, 'hp2']])
})
test('D9: Abzug angegeben, Anlage ohne Heizkosten im Zeitraum: still', () =>
  still(settle(haus([hausstrom(), brennstoff('2024-01')], [mitAngabe('deducted')]))))
test('D10: Abzug angegeben, eigene Heizperiode (Weg b): einmal in P, nicht im Unteraufruf', () => {
  const plant = mitAngabe('deducted', { periodStartMonth: 5 })
  const src = haus([heizung('gas', '2024-05', 500000, { heatingPart: 'fuel', taxYear: 2025 }), heizung('w', '2024-05', 30000, { heatingPart: 'operating', description: 'Wartung', taxYear: 2025 }), hausstrom()], [plant])
  assert.deepEqual(alle(settle(src)), [AD])
  const snap = snapshotFor(src, 'objekt-1', of(CALENDAR_RULES, '2025-01'))
  const p = snap.heatingPlants?.[0] ?? assert.fail('keine Anlage')
  for (const kind of ['heatingPart', 'heating'] as const) still(computeSettlement({ ...snap, scope: { kind, plant: p } }))
})

test('O1: eigener Stromvertrag angegeben, nur Brennstoff, ohne Allgemeinstrom: genau ein Hinweis „Rechnung fehlt“ (hint)', () => {
  const s = settle(haus([brennstoff()], [mitAngabe('ownMeter')]))
  const n = one(s, AB)
  assert.equal(n.level, 'hint')
  assert.equal(n.title, 'Rechnung des Heizungsstromzählers fehlt')
  assert.deepEqual(n.subject, { kind: 'heatingCosts', id: 'hp1' })
  assert.deepEqual(alle(s), [AB])
  // Mit Allgemeinstrom ebenso.
  assert.deepEqual(alle(settle(haus([brennstoff(), hausstrom()], [mitAngabe('ownMeter')]))), [AB])
})
test('O2: eigener Stromvertrag mit Wartung als „Betrieb“: still', () => still(settle(haus([brennstoff(), wartung(), hausstrom()], [mitAngabe('ownMeter')]))))
test('O3: eigener Stromvertrag, Heizposition ohne Teil: still', () => still(settle(haus([heizung('alt', '2025-01', 500000, { description: 'Heizkosten' }), hausstrom()], [mitAngabe('ownMeter')]))))
test('O4: eigener Stromvertrag mit Abzug ohne Verweis: still', () => still(settle(haus([brennstoff(), hausstrom(), abzug({ operatingPowerItemId: undefined })], [mitAngabe('ownMeter')]))))
test('O5: eigener Stromvertrag, Betriebsstrom gekennzeichnet: kein „Rechnung fehlt“', () => {
  const s = settle(haus([brennstoff(), betriebsstrom()], [mitAngabe('ownMeter')]))
  assert.equal(found(s, AB).length, 0)
  still(settle(haus([brennstoff(), betriebsstrom(), hausstrom(), abzug()], [mitAngabe('ownMeter')])))
})
test('O6: eigener Stromvertrag, Anlage ohne Heizkosten im Zeitraum: still', () => still(settle(haus([brennstoff('2024-01')], [mitAngabe('ownMeter')]))))

test('L1/L2: Vermieter trägt den Strom des eigenen Vertrags: still, mit und ohne Wartung', () => {
  still(settle(haus([brennstoff(), hausstrom()], [mitAngabe('landlordPays')])))
  still(settle(haus([brennstoff(), wartung(), hausstrom()], [mitAngabe('landlordPays')])))
  still(settle(haus([brennstoff()], [mitAngabe('landlordPays')])))
})

test('N1: ohne Angabe wie bisher: A beim Brennstoff allein, still mit Wartung', () => {
  assert.deepEqual(alle(settle(haus([brennstoff(), hausstrom()], [mitAngabe(null)]))), [A])
  still(settle(haus([brennstoff(), wartung(), hausstrom()], [mitAngabe(null)])))
  // Fehlt das Feld (von Hand gebauter Schnappschuss), ebenso.
  const { operatingPowerHandling: _weg, ...ohneFeld } = anlage()
  assert.deepEqual(alle(settle(haus([brennstoff(), hausstrom()], [ohneFeld as Plant]))), [A])
  still(settle(haus([brennstoff(), wartung(), hausstrom()], [ohneFeld as Plant])))
})

test('X1: jede Angabe bei Fernwärme, Messdienst, Gemeinschaft, Etagenheizung, „sonstige“ und Wärmepumpe: nicht ausgewertet', () => {
  const ohneFrage: Partial<Plant>[] = [{ energy: 'districtHeating' }, { energy: 'other' }, { method: 'service' }, { source: 'homeowners', method: 'service' }, { supply: 'perUnit' }, { energy: 'electric' }]
  for (const v of HANDLINGS) {
    for (const over of ohneFrage) {
      for (const items of [[brennstoff(), hausstrom()], [brennstoff(), wartung(), hausstrom()], [brennstoff()]]) {
        const mit = settle(haus([...items], [mitAngabe(v, over)]))
        const ohne = settle(haus([...items], [mitAngabe(null, over)]))
        assert.deepEqual(alle(mit), alle(ohne), `${v} ${JSON.stringify(over)}`)
        assert.deepEqual([...found(mit, AD), ...found(mit, AB)], [], `${v} ${JSON.stringify(over)}`)
      }
    }
    // Wärmepumpe: B bleibt genau wie ohne Angabe.
    for (const items of [[wartung(), hausstrom()], [hausstrom()], [brennstoff(), hausstrom()]]) {
      assert.deepEqual(alle(settle(haus([...items], [wp({ operatingPowerHandling: v })]))), alle(settle(haus([...items], [wp()]))), `WP ${v}`)
    }
    assert.deepEqual(alle(settle(haus([wartung(), hausstrom()], [wp({ operatingPowerHandling: v })]))), [B])
  }
})

test('X2: „Abzug fehlt“ und „Rechnung fehlt“ nur in der Gesamtberechnung, nicht in Teil- oder Heizkostenabrechnungen', () => {
  for (const [v, items] of [['deducted', [brennstoff(), wartung(), hausstrom()]], ['ownMeter', [brennstoff(), hausstrom()]]] as const) {
    const src = haus([...items], [mitAngabe(v)])
    assert.equal(alle(settle(src)).length, 1, `${v}: in der Gesamtberechnung genau ein Hinweis`)
    const snap = snapshotFor(src, 'objekt-1', of(CALENDAR_RULES, '2025-01'))
    const p = snap.heatingPlants?.[0] ?? assert.fail('keine Anlage')
    for (const kind of ['heatingPart', 'heating'] as const) still(computeSettlement({ ...snap, scope: { kind, plant: p } }))
  }
})

test('Kein Zahlenwechsel: jede Angabe rechnet wie ohne Angabe und wie „sonstige“', () => {
  const zahlen = (s: ComputedSettlement) => ({ statements: s.statements, landlord: s.landlord, selfUsedShareCents: s.selfUsedShareCents, totalCostsCents: s.totalCostsCents })
  for (const items of [[brennstoff(), hausstrom()], [brennstoff(), wartung(), hausstrom()], [brennstoff()], [brennstoff(), betriebsstrom(), hausstrom()]]) {
    const vergleich = zahlen(settle(haus([...items], [anlage({ energy: 'other' })])))
    for (const v of [null, ...HANDLINGS]) assert.deepEqual(zahlen(settle(haus([...items], [mitAngabe(v)]))), vergleich, `${v}`)
  }
})

// Pflichtangaben und Ausnahmen in der Abrechnung (Heizung PR 14). Grundlage ist Beispiel A (Entwurf 8.6) aus
// server/testing/selfHeating.ts, ergänzt um Stände am 31.12.2023, damit es eine Vorperiode gibt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot } from '../src/snapshot.ts'
import { selfReading, selfRow, selfSnapshot, selfTenancy, selfUnit, type SelfSnapshotOptions } from '../testing/selfHeating.ts'
import type { HeatingEstimate, HeatingPeriodData } from '../../shared/types.ts'
import { periodKey } from '../../shared/period.ts'

const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const notice = (s: ComputedSettlement, code: string) => s.notices.find((n) => n.code === code) ?? assert.fail(`kein Hinweis ${code}: ${codes(s).join(', ')}`)
const infoOf = (s: ComputedSettlement) => s.heating?.find((h) => h.info)?.info ?? assert.fail('kein Ausweis nach § 6a')
const sumRows = (s: ComputedSettlement) => s.statements.reduce((a, st) => a + st.rows.reduce((b, r) => b + r.shareCents, 0), 0) + s.landlord.rows.reduce((a, r) => a + r.shareCents, 0)

// Stände am 31.12.2023: alle Wohnungszähler auf 0, damit 2024 einen Verbrauch hat (A 1.000, C 500 kWh).
const ANGABEN: Partial<HeatingPeriodData> = {
  infoTaxesText: 'Energiesteuer 312,00 €', climateFactor: 1.08, climateFactorPrev: 1.15, climateFactorSource: 'Deutscher Wetterdienst, Klimafaktoren 79100',
  infoReferenceKwhPerM2: 150, infoReferenceSource: 'Vergleichswerte des Ablesedienstes Beispiel 2025', consumerContract: 'none',
}
function beispiel(o: SelfSnapshotOptions & { row?: Partial<HeatingPeriodData> } = {}): Snapshot {
  const base = selfSnapshot(o)
  const extra = base.meters.filter((m) => m.unitId !== null).map((m) => selfReading(m.id, '2023-12-31', 0))
  return { ...base, readings: [...base.readings, ...extra] }
}
const mitAngaben = (row: Partial<HeatingPeriodData> = {}, o: SelfSnapshotOptions = {}) => beispiel({ ...o, row: { ...ANGABEN, ...row } })

test('Ohne Angaben: Nr. 1 b, 4 und 5 fehlen sicher (3 % je Mieter), Nr. 3 vielleicht; kein Hausdurchschnitt', () => {
  const s = computeSettlement(beispiel())
  const n = notice(s, 'heating.info-incomplete')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /Es fehlen: die erhobenen Steuern, Abgaben und Zölle \(Nr\. 1 b\), der Vergleich mit einem normierten oder durch Vergleichstests ermittelten Durchschnittsnutzer \(Nr\. 4\) und der witterungsbereinigte Vergleich/)
  assert.match(n.text, /Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich/)
  assert.match(n.text, /um 3 % kürzen \(§ 12 Abs\. 1 Satz 3 HeizkostenV\), hier: Mieter A \(A\) [0-9.,]+ €/)
  assert.match(n.text, /ein Kürzungsrecht, auch wenn mehrere Angaben fehlen/)
  assert.match(n.text, /Verbrauchervertrag.*bis zu 3 %/s)
  assert.ok(s.legalBasis.values?.some((v) => v.id === 'hkv.cut.information'))
  // Die Warnung aus der Durchsicht von #239 ist ersetzt.
  assert.ok(!codes(s).includes('heating.self-6a-missing' as never))
})

test('Vollständig: nur das erste Jahr von C2 („bis zu“, Auslegung) als Hinweis; Ausweis mit Vergleich je Mieter', () => {
  const s = computeSettlement(mitAngaben())
  assert.ok(!codes(s).includes('heating.info-incomplete'))
  const n = notice(s, 'heating.info-open')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /Mieter C2 \(C\) wohnte im vorhergehenden Abrechnungszeitraum noch nicht.*bis zu 3 % \(Auslegung von Mietfuchs\): Mieter C2 \(C\) [0-9.,]+ €/s)
  const info = infoOf(s)
  assert.deepEqual([info.scope, info.missing, info.taxesText, info.carriers], ['full', [], 'Energiesteuer 312,00 €', [{ energy: 'gas', percent: 100 }]])
  const a = info.users.find((u) => u.tenancyId === 'A') ?? assert.fail('A')
  assert.ok(a.heating && Math.abs((a.heating.nowAdjusted ?? 0) - 12000 * 1.08) < 1e-6)
  assert.ok(a.heating && Math.abs((a.heating.referenceKwh ?? 0) - 150 * 60) < 1e-6)
  assert.equal(info.meteringCents, 18000)
  // Keine Zahl ändert sich durch die Angaben.
  assert.equal(sumRows(s), sumRows(computeSettlement(beispiel())))
})

test('Monatliche Information: fernablesbarer Zähler → Warnung „bis zu 3 %“; bestätigt → keine; unbekannt → nichts (Anlegen ändert keinen Hinweis)', () => {
  const base = mitAngaben()
  const fern: Snapshot = { ...base, meters: base.meters.map((m) => (m.id === 'wz-a' ? { ...m, remoteReadable: true } : m)) }
  const n = notice(computeSettlement(fern), 'heating.monthly-info')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /seit dem 01\.01\.2022 monatliche Verbrauchsinformationen.*bis zu 3 %.*Portal mit einer Nachricht jeden Monat.*BR-Drs\. 643\/21/s)
  const bestaetigt = mitAngaben({ monthlyInfoElsewhere: true })
  const fernBestaetigt: Snapshot = { ...bestaetigt, meters: bestaetigt.meters.map((m) => (m.id === 'wz-a' ? { ...m, remoteReadable: true } : m)) }
  assert.ok(!codes(computeSettlement(fernBestaetigt)).some((c) => c.startsWith('heating.monthly-info')))
  assert.ok(!codes(computeSettlement(base)).some((c) => c.startsWith('heating.monthly-info')))
  // Die Angabe an der Anlage genügt (beim Messdienst kennt Mietfuchs die Geräte oft nicht).
  assert.ok(codes(computeSettlement(mitAngaben({}, { plant: { devicesRemote: 'partial' } }))).includes('heating.monthly-info'))
  const keine = mitAngaben({}, { plant: { devicesRemote: 'none' } })
  const nichtFern: Snapshot = { ...keine, meters: keine.meters.map((m) => ({ ...m, remoteReadable: false })) }
  assert.ok(!codes(computeSettlement(nichtFern)).some((c) => c.startsWith('heating.monthly-info')))
  // Ein ausgebauter fernablesbarer Heizkostenverteiler (letzte Ablesung im Vorjahr) zählt nicht; in Betrieb zählt er.
  const geraet = (dates: readonly string[]): Snapshot => ({
    ...nichtFern,
    meters: [...nichtFern.meters, { id: 'alt', name: 'HKV alt', unitId: 'a', type: 'hkv', remoteReadable: true }],
    readings: [...nichtFern.readings, ...dates.map((d, k) => selfReading('alt', d, k * 10))],
  })
  const ausgebaut = computeSettlement(geraet(['2022-12-31', '2023-12-31']))
  assert.ok(!codes(ausgebaut).some((c) => c.startsWith('heating.') && notice(ausgebaut, c).level === 'error'), 'verteilt')
  assert.ok(!codes(ausgebaut).some((c) => c.startsWith('heating.monthly-info')))
  assert.ok(codes(computeSettlement(geraet(['2024-12-31', '2025-12-31']))).includes('heating.monthly-info'))
})

test('Review Focus 4: Ausnahme nach § 11 für Wärme und Warmwasser – keine § 6a-Angaben, keine Kürzung, CO₂ nur mit vereinbarter Abrechnung; Σ unverändert', () => {
  const relief = (s: ComputedSettlement) => s.statements.flatMap((st) => st.rows).filter((r) => r.kind === 'co2Relief').length
  const ohne = computeSettlement(beispiel())
  assert.ok(relief(ohne) > 0, 'Beispiel A hat CO₂-Abzüge')
  const ex = computeSettlement(beispiel({ row: { exemption: 'lowDemand', exemptionScope: 'both' } }))
  assert.match(notice(ex, 'heating.exemption').text, /§ 11.*Heizwärmebedarf von weniger als 15 kWh.*§ 556a Abs\. 1 BGB.*nicht nach dem CO2KostAufG aufgeteilt \(§ 2 Abs\. 7 CO2KostAufG; nach der Begründung, soweit „keine Heizkostenabrechnung durchgeführt wird“, BT-Drs\. 20\/3172, S\. 28\)/s)
  for (const c of ['heating.info-incomplete', 'heating.info-open', 'heating.monthly-info', 'heating.no-consumption', 'co2.missing']) assert.ok(!codes(ex).includes(c as never), c)
  assert.equal(relief(ex), 0)
  assert.equal(ex.heating?.find((h) => h.info), undefined)
  // Σ Zeilen = Σ Positionen: Die Ausnahme verteilt nur anders beim CO₂, nie weniger.
  assert.equal(sumRows(ex), sumRows(ohne))
  const vereinbart = computeSettlement(beispiel({ row: { exemption: 'lowDemand', exemptionScope: 'both', exemptionBillingAgreed: true } }))
  assert.ok(relief(vereinbart) > 0)
  assert.match(notice(vereinbart, 'heating.exemption').text, /vereinbart haben, teilt Mietfuchs die CO₂-Kosten/)
})

test('Ausnahme nur für die Wärme: Warmwasser bleibt mit § 6a, CO₂ wird weiter aufgeteilt (Auslegung)', () => {
  const ex = computeSettlement(mitAngaben({ exemption: 'lowDemand' }))
  assert.match(notice(ex, 'heating.exemption').text, /nur die Wärme.*Warmwasser.*Angaben nach § 6a.*teilt Mietfuchs weiter auf/s)
  const info = infoOf(ex)
  assert.equal(info.heatExempt, true)
  assert.ok(info.users.every((u) => u.heating === null))
  assert.ok(ex.statements.flatMap((st) => st.rows).some((r) => r.kind === 'co2Relief'))
})

test('Ausnahme gilt ab ihrer Heizperiode: in der Heizperiode davor nicht (keine rückwirkende Wirkung)', () => {
  // Die Angabe steht in der Zeile 2026; die Abrechnung 2025 rechnet ohne sie.
  const s = computeSettlement(beispiel({ rows: [selfRow({ exemption: 'lowDemand', exemptionScope: 'both' }, 2026)] }))
  assert.ok(!codes(s).includes('heating.exemption'))
  assert.ok(codes(s).includes('heating.info-incomplete'))
  // Aus der Zeile 2024 geerbt gilt sie 2025.
  const geerbt = computeSettlement(beispiel({ rows: [selfRow({ exemption: 'lowDemand', exemptionScope: 'both' }, 2024)] }))
  assert.match(notice(geerbt, 'heating.exemption').text, /angegeben ab der Heizperiode 2024/)
})

test('Prüfbericht A3: „Wärmerückgewinnung, Solar“ nennt die Wärmepumpen nur für Zeiträume vor dem 01.10.2024', () => {
  const mit = (year: number) => notice(computeSettlement(selfSnapshot({ year, row: { exemption: 'renewable', exemptionScope: 'both' } })), 'heating.exemption').text
  assert.match(mit(2024), /Wärmepumpen/)
  assert.doesNotMatch(mit(2025), /Wärmepumpen/)
})

test('Freie Schlüssel nach Zählern: volle Pflicht, Nr. 4 und 5 offen bis zur Bestätigung des beigelegten Vergleichs (Durchsicht R-W1); nach Fläche Abs. 5 (nur Verbrauchervertrag offen)', () => {
  const base = mitAngaben({}, { plant: { method: 'manual' } })
  const frei: Snapshot = { ...base, costItems: base.costItems.map((c) => (c.heatingPlantId ? { ...c, key: 'meter', meterType: 'waerme' } : c)) }
  const s = computeSettlement(frei)
  const info = infoOf(s)
  assert.deepEqual([info.scope, info.comparisons, info.missing, info.uncertain], ['full', false, [], ['4', '5']])
  assert.ok(!codes(s).includes('heating.info-incomplete'))
  assert.match(notice(s, 'heating.info-open').text, /Nr\. 4 und 5 erstellt Mietfuchs nur bei eigener Heizkostenabrechnung\. Legt Ihr Ablesedienst einen solchen Vergleich bei, bestätigen Sie das mit seiner Quelle/)
  const beigelegt = mitAngaben({ infoComparisonSource: 'Vergleich des Ablesedienstes, Anlage 2' }, { plant: { method: 'manual' } })
  const mitVergleich = computeSettlement({ ...beigelegt, costItems: beigelegt.costItems.map((c) => (c.heatingPlantId ? { ...c, key: 'meter', meterType: 'waerme' } : c)) })
  assert.deepEqual([infoOf(mitVergleich).uncertain, infoOf(mitVergleich).comparisonSource], [[], 'Vergleich des Ablesedienstes, Anlage 2'])
  assert.ok(!codes(mitVergleich).some((c) => c.startsWith('heating.info')), codes(mitVergleich).join(', '))
  const flaeche = computeSettlement({ ...frei, costItems: base.costItems.map((c) => (c.heatingPlantId ? { ...c, key: 'area' } : c)) })
  assert.equal(infoOf(flaeche).scope, 'minimal')
  assert.ok(!codes(flaeche).includes('heating.info-incomplete'))
  const offen = computeSettlement({ ...beispiel({ plant: { method: 'manual' }, row: { ...ANGABEN, consumerContract: null } }), costItems: base.costItems.map((c) => (c.heatingPlantId ? { ...c, key: 'area' } : c)) })
  assert.match(notice(offen, 'heating.info-open').text, /§ 6a Abs\. 5 HeizkostenV/)
})

test('Review Focus 3: Vereinbarung nach § 2 wirkt nur im Zweifamilienhaus mit Eigennutzung, nur gegen die Kürzung nach Satz 1', () => {
  // Drei Wohnungen: die Vereinbarung wirkt nicht.
  assert.ok(codes(computeSettlement(beispiel({ row: { agreedOtherwise: 'area' } }))).includes('heating.info-incomplete'))
  // Zweifamilienhaus: a selbst bewohnt, nur b vermietet.
  const zfh = (row: Partial<HeatingPeriodData>): Snapshot => {
    const s = beispiel({ row })
    return {
      ...s,
      units: s.units.filter((u) => u.id !== 'c').map((u) => (u.id === 'a' ? { ...u, participates: false, selfUsed: true } : u)),
      tenancies: s.tenancies.filter((t) => t.unitId === 'b'),
      meters: s.meters.filter((m) => m.unitId !== 'c').map((m) => (m.unitId === 'b' ? { ...m, remoteReadable: true } : m)),
    }
  }
  const flaeche = computeSettlement(zfh({ ...ANGABEN, agreedOtherwise: 'area' }))
  assert.equal(infoOf(flaeche).scope, 'minimal')
  assert.ok(!codes(flaeche).includes('heating.info-incomplete'))
  assert.ok(codes(flaeche).includes('heating.monthly-info'), 'die monatliche Information bleibt')
  const verbrauch = computeSettlement(zfh({ agreedOtherwise: 'consumption' }))
  assert.match(notice(verbrauch, 'heating.info-incomplete').text, /Vereinbarung über die Verteilung nach § 2 HeizkostenV ersetzt die Informationspflichten nicht/)
})

test('Review Focus 5: 80 % nach Verbrauch nur mit Vereinbarung; sonst nicht verteilbar', () => {
  assert.ok(codes(computeSettlement(mitAngaben({ heatConsumptionPct: 80 }))).includes('heating.self-incomplete'))
  const mit = computeSettlement(mitAngaben({ heatConsumptionPct: 80, above70Agreed: true }))
  assert.ok(!codes(mit).includes('heating.self-incomplete'))
  assert.equal(mit.heating?.find((h) => h.self)?.self?.shares?.above70Agreed, true)
  assert.ok(codes(computeSettlement(mitAngaben({ heatConsumptionPct: 101, above70Agreed: true }))).includes('heating.self-incomplete'))
})

test('Vor dem 01.12.2021 beginnende Heizperiode: keine Angaben nach § 6a', () => {
  const s = computeSettlement(selfSnapshot({ year: 2021 }))
  assert.ok(!codes(s).some((c) => c.startsWith('heating.info')))
  assert.equal(s.heating?.find((h) => h.info), undefined)
})

test('Zusammenspiel mit § 9a Abs. 2 (über 25 % geschätzt): keine Kürzung nach § 12 genannt; die Angaben nach § 6a bleiben', () => {
  const readings = beispiel().readings.filter((r) => !(r.meterId === 'wz-c' && r.date === '2025-12-31'))
  const estimate: HeatingEstimate = { plantId: 'hp', period: periodKey('2025-01'), unitId: 'c', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true, cause: 'deviceFailure', capture: 'heatMeter', valueUnit: 'kWh' }
  const s = computeSettlement({ ...beispiel({ estimates: [estimate] }), readings })
  assert.ok(codes(s).includes('heating.estimate-over-25'))
  // Der Topf Heizung geht nur nach Fläche (Leitsatz c von BGH VIII ZR 373/04 zu § 9a Abs. 1); das Warmwasser bleibt nach
  // Verbrauch: Die Abrechnung beruht insoweit auf dem Verbrauch, und § 6a Abs. 3 gilt.
  assert.ok(!codes(s).includes('heating.no-consumption'))
  assert.equal(infoOf(s).scope, 'full')
  const text = notice(s, 'heating.info-incomplete').text
  assert.doesNotMatch(text, /15 %/)
  assert.match(text, /um 3 % kürzen \(§ 12 Abs\. 1 Satz 3/)
  // Der Vergleich der Heizung von C nimmt den geschätzten Wert und sagt es.
  const c2 = infoOf(s).users.find((u) => u.tenancyId === 'C2') ?? assert.fail('C2')
  assert.equal(c2.heating?.estimated, true)
})

test('Kesseltausch: die Angaben nach § 6a einmal je Linie, an der neuen Anlage; die Ausnahme der alten gilt für die neue', () => {
  // Gas wird zum 01.07.2025 durch Gas mit eigener Anlage ersetzt (Zeilen beider Anlagen, Positionen je Hälfte).
  const base = beispiel({ row: { exemption: 'lowDemand', exemptionScope: 'both' } })
  const neu = { ...(base.heatingPlants?.[0] ?? assert.fail('Anlage')), id: 'hp2', name: 'Neu', replacesPlantId: 'hp', energy: 'oil' as const }
  const alt = { ...(base.heatingPlants?.[0] ?? assert.fail('Anlage')), name: 'Alt', endsOn: '2025-06-30' }
  // Der Stand des Speicherzählers am Tauschtag (Durchsicht von #239, I3).
  const swap = (x: Snapshot): Snapshot => {
    const gas = x.costItems.find((c) => c.id === 'wartung') ?? assert.fail('Wartung')
    return { ...x, heatingPlants: [alt, neu], readings: [...x.readings, selfReading('ww', '2025-06-30', 4500)], costItems: [...x.costItems, { ...gas, id: 'wartung2', heatingPlantId: 'hp2' }] }
  }
  const s = computeSettlement(swap(base))
  assert.ok(s.statements.some((st) => st.rows.some((r) => r.costItemId === 'gas')), 'verteilt')
  // Ganz ausgenommen: keine Angaben, kein Kürzungshinweis, an keiner der beiden Anlagen.
  assert.ok(!s.heating?.some((h) => h.info))
  assert.equal(s.notices.filter((n) => n.code === 'heating.exemption').length, 1, 'ein Hinweis je Linie')
  // Ohne Ausnahme: ein Ausweis, an der Anlage, die am Ende heizt, mit beiden Energieträgern.
  const ohne = computeSettlement(swap(beispiel()))
  const infos = (ohne.heating ?? []).filter((h) => h.info)
  assert.deepEqual(infos.map((h) => h.plantId), ['hp2'])
  assert.deepEqual(infos[0]?.info?.carriers.map((c) => c.energy), ['gas', 'oil'])
})

test('Freie Schlüssel nach Fläche unter einer Ausnahme: keine Kürzung um 15 %; ohne Ausnahme schon', () => {
  const base = beispiel({ plant: { method: 'manual' } })
  const flaeche = (row: Partial<HeatingPeriodData>): Snapshot => {
    const s = beispiel({ plant: { method: 'manual' }, row })
    return { ...s, costItems: base.costItems.map((c) => (c.heatingPlantId ? { ...c, key: 'area' } : c)) }
  }
  assert.ok(codes(computeSettlement(flaeche({}))).includes('heating.not-by-consumption'))
  const ex = computeSettlement(flaeche({ exemption: 'disproportionate', exemptionScope: 'both' }))
  assert.ok(!codes(ex).includes('heating.not-by-consumption'))
  assert.match(notice(ex, 'heating.exemption').text, /10 Jahren/)
})

test('Klimafaktor der vorigen Heizperiode steht in deren Zeile: er gilt mit seiner Quelle', () => {
  const s = computeSettlement(mitAngaben({ climateFactorPrev: null }, { rows: [selfRow({ climateFactor: 1.15, climateFactorSource: 'DWD 2024' }, 2024)] }))
  const info = infoOf(s)
  assert.ok(!info.missing.includes('5'))
  const a = info.users.find((u) => u.tenancyId === 'A') ?? assert.fail('A')
  assert.ok(a.heating && Math.abs((a.heating.prevAdjusted ?? 0) - 1000 * 1.15) < 1e-6, JSON.stringify(a.heating))
})

test('Den Block bekommen nur die Mieter, die über die Anlage abgerechnet werden', () => {
  const base = mitAngaben()
  const s = computeSettlement({
    ...base,
    units: [...base.units, selfUnit('g', 0, { name: 'Garage', noConnection: ['waerme'] })],
    tenancies: [...base.tenancies, selfTenancy('G', 'g', '2020-01-01', null)],
    costItems: [...base.costItems, { id: 'strasse', period: periodKey('2025-01'), category: 'Straßenreinigung', description: 'Straßenreinigung', amountCents: 10000, key: 'units' }],
  })
  assert.deepEqual(infoOf(s).tenancyIds?.slice().sort(), ['A', 'B', 'C1', 'C2'])
})

test('Ausnahme nur für die Wärme, aber ohne zentrales Warmwasser: die ganze Anlage ist ausgenommen', () => {
  const s = computeSettlement(beispiel({ plant: { hotWater: 'none' }, row: { exemption: 'lowDemand' } }))
  assert.equal(s.heating?.find((h) => h.info), undefined)
  assert.doesNotMatch(notice(s, 'heating.exemption').text, /nur die Wärme/)
  assert.ok(!codes(s).includes('heating.info-incomplete'))
})

// ---------- Durchsicht von #243, Runde 1 ----------

const fernAlle = (s: Snapshot, ids: readonly string[]): Snapshot => ({ ...s, meters: s.meters.map((m) => (ids.includes(m.id) ? { ...m, remoteReadable: true } : m)) })
const ohneAbzug = (s: ComputedSettlement, id: string) => s.statements.find((st) => st.tenancyId === id)?.rows.filter((r) => r.kind !== 'co2Relief').reduce((a, r) => a + r.shareCents, 0) ?? assert.fail(`kein ${id}`)

test('Durchsicht G-W2: Ausnahme nur der Wärme – Kürzung nach Satz 3 nur auf den Anteil Warmwasser (A 7,53 € statt 53,83 €)', () => {
  const s = computeSettlement(beispiel({ row: { exemption: 'lowDemand', exemptionScope: 'heat' } }))
  const n = notice(s, 'heating.info-incomplete')
  assert.match(n.text, /seinen Anteil am Warmwasser um 3 % kürzen \(§ 12 Abs\. 1 Satz 3 HeizkostenV\), hier: Mieter A \(A\) 7,53 €, Mieter B \(B\) 10,04 €/)
  assert.doesNotMatch(n.text, /53,83 €/)
  // Ohne Ausnahme bleibt es bei 3 % der ganzen Heizkosten nach dem CO₂-Abzug.
  assert.match(notice(computeSettlement(beispiel()), 'heating.info-incomplete').text, /hier: Mieter A \(A\) 53,83 €/)
})

test('Durchsicht G-W2: Ausnahme nur der Wärme – Satz 1 bei freien Schlüsseln nur auf den Anteil Warmwasser, ohne Betrag; Fernablesbarkeit nur der Warmwasserzähler', () => {
  const flaeche = (row: Partial<HeatingPeriodData>): Snapshot => {
    const s = beispiel({ plant: { method: 'manual' }, row })
    return { ...s, costItems: s.costItems.map((c) => (c.heatingPlantId ? { ...c, key: 'area' } : c)) }
  }
  const ohne = notice(computeSettlement(flaeche({})), 'heating.not-by-consumption').text
  assert.match(ohne, /um 15 % kürzen \(§ 12 Abs\. 1 HeizkostenV\), hier:/)
  const heat = computeSettlement(flaeche({ exemption: 'lowDemand', exemptionScope: 'heat' }))
  const texts = heat.notices.filter((x) => x.code === 'heating.not-by-consumption').map((x) => x.text)
  // „Erdgas“ (beides) nennt keinen Betrag, „Miete Warmwasserzähler“ (nur Warmwasser) behält ihn, „Miete Wärmezähler“ (nur Heizung) fehlt.
  const of = (d: string) => texts.find((t) => t.startsWith(`„${d}“`))
  assert.match(of('Erdgas') ?? assert.fail(texts.join('\n')), /nur den Anteil Warmwasser an seinem Anteil um 15 % kürzen.*keinen Betrag/s)
  assert.doesNotMatch(of('Erdgas') ?? '', /hier:/)
  assert.match(of('Miete Warmwasserzähler') ?? assert.fail('wwz'), /hier:/)
  assert.equal(of('Miete Wärmezähler'), undefined)
  // Fernablesbarkeit: Wärmezähler nicht fernablesbar, Warmwasserzähler schon. Ist nur die Wärme ausgenommen, zählt nur das
  // Warmwasser, und es gibt keinen Hinweis.
  const geraete = (row: Partial<HeatingPeriodData>) => {
    const s = fernAlle(beispiel({ row }), ['xw-a', 'xw-b', 'xw-c'])
    return computeSettlement({ ...s, meters: s.meters.map((m) => (m.type === 'waerme' && m.unitId ? { ...m, remoteReadable: false } : m)) })
  }
  assert.ok(codes(geraete({})).some((c) => c.startsWith('heating.remote-reading')), codes(geraete({})).join(', '))
  assert.ok(!codes(geraete({ exemption: 'lowDemand', exemptionScope: 'heat' })).some((c) => c.startsWith('heating.remote-reading')))
})

test('Durchsicht G-W3: Vereinbarung nach § 2 „nach Wohnfläche“ verteilt die eigene Abrechnung nach Fläche; dann Abs. 5; „feste Anteile“ geht nicht', () => {
  // Einliegerhaus: a (60 m²) selbst genutzt, b (80 m²) Mieter B; B verbraucht nur halb so viel wie nach der Fläche.
  const zfh = (row: Partial<HeatingPeriodData>): Snapshot => {
    const s = beispiel({ units: [selfUnit('a', 60, { participates: false, selfUsed: true, selfPersons: 1 }), selfUnit('b', 80)], tenancies: [selfTenancy('B', 'b', '2020-01-01', null)], row: { ...ANGABEN, ...row } })
    return { ...s, readings: s.readings.map((r) => (r.meterId === 'wz-b' && r.date === '2025-12-31' ? { ...r, value: 8000 } : r)) }
  }
  const verbrauch = computeSettlement(zfh({}))
  const flaeche = computeSettlement(zfh({ agreedOtherwise: 'area' }))
  // 80/140 × 6.660,00 € = 3.805,71 € vor dem CO₂-Abzug (je Position gerundet 3.805,72 €).
  assert.equal(ohneAbzug(flaeche, 'B'), 380572)
  assert.ok(ohneAbzug(verbrauch, 'B') < 380572 - 10000, `${ohneAbzug(verbrauch, 'B')}`)
  const self = flaeche.heating?.find((h) => h.self)?.self ?? assert.fail('kein Ausweis')
  assert.equal(self.agreedArea, true)
  assert.equal(infoOf(flaeche).scope, 'minimal')
  assert.equal(infoOf(verbrauch).scope, 'full')
  assert.equal(sumRows(flaeche), sumRows(verbrauch))
  // „nach Verbrauch“ rechnet wie eingerichtet, mit vollem § 6a.
  const vereinbartVerbrauch = computeSettlement(zfh({ agreedOtherwise: 'consumption' }))
  assert.deepEqual([ohneAbzug(vereinbartVerbrauch, 'B'), infoOf(vereinbartVerbrauch).scope], [ohneAbzug(verbrauch, 'B'), 'full'])
  // Feste Anteile kann die eigene Abrechnung nicht abbilden.
  assert.match(notice(computeSettlement(zfh({ agreedOtherwise: 'fixedPercent' })), 'heating.self-incomplete').text, /feste Anteile.*freien Schlüsseln/s)
  // Golden: im Haus mit drei Wohnungen ändert die Angabe nichts.
  assert.equal(ohneAbzug(computeSettlement(beispiel({ row: { agreedOtherwise: 'area' } })), 'B'), ohneAbzug(computeSettlement(beispiel()), 'B'))
})

test('Durchsicht R-W2: Fehlt Nr. 5 nur für B, nennt der Hinweis die Kürzung nur für B', () => {
  const base = mitAngaben()
  const s = computeSettlement({ ...base, readings: base.readings.filter((r) => !(r.meterId === 'wz-b' && r.date === '2023-12-31')) })
  const n = notice(s, 'heating.info-incomplete')
  assert.match(n.text, /Es fehlen: der witterungsbereinigte Vergleich .*\(Nr\. 5\), und zwar für Mieter B \(B\)\. Fehlt eine dieser Angaben, darf der Mieter, dem sie fehlt, seinen Anteil an den Heizkosten um 3 % kürzen \(§ 12 Abs\. 1 Satz 3 HeizkostenV\), hier: Mieter B \(B\) [0-9.,]+ €\./s)
  assert.doesNotMatch(n.text.split('Satz 3 HeizkostenV), hier:')[1]?.split('.')[0] ?? '', /Mieter A/)
  assert.deepEqual(infoOf(s).users.map((u) => [u.tenancyId, u.missing]), [['A', []], ['B', ['5']], ['C1', []], ['C2', []]])
})

test('Durchsicht R-W4: monatliche Information und Angaben zur Abrechnung sind ein Kürzungsrecht; die Beträge stehen einmal', () => {
  const s = computeSettlement(fernAlle(beispiel(), ['wz-a']))
  const monthly = notice(s, 'heating.monthly-info')
  const info = notice(s, 'heating.info-incomplete')
  assert.match(monthly.text, /dasselbe Kürzungsrecht wie bei fehlenden Angaben zur Heizkostenabrechnung und kommt nicht hinzu.*verschiedenen Sätzen des § 12 Abs\. 1 \(BR-Drs\. 643\/21, S\. 23 f\.\)/s)
  assert.match(monthly.text, /Die Beträge je Mieter stehen beim Hinweis zu den Angaben zur Heizkostenabrechnung\./)
  assert.doesNotMatch(monthly.text, /[0-9],[0-9]{2} €/)
  assert.match(info.text, /hier: Mieter A \(A\) 53,83 €/)
  assert.match(info.text, /auch wenn die monatliche Verbrauchsinformation fehlt/)
  // Fehlt zur Abrechnung nichts (nur das erste Jahr von C2 offen), nennt die monatliche Information ihre Beträge selbst.
  const voll = notice(computeSettlement(fernAlle(mitAngaben(), ['wz-a'])), 'heating.monthly-info')
  assert.match(voll.text, /hier bis zu: Mieter A \(A\) 53,83 €/)
  // „soweit diese Daten erhoben worden sind“ (§ 6a Abs. 2 Nr. 2, R-K10).
  assert.match(voll.text, /Vormonat und dem entsprechenden Monat des Vorjahres, soweit diese Daten erhoben worden sind/)
})

test('Durchsicht R-W5: geschätzter Verbrauch (§ 9a) – für den Mieter keine Kürzung wegen der Vergleiche, als Auslegung gekennzeichnet', () => {
  const readings = beispiel().readings.filter((r) => !(r.meterId === 'wz-a' && r.date === '2025-12-31'))
  const estimate: HeatingEstimate = { plantId: 'hp', period: periodKey('2025-01'), unitId: 'a', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true, cause: 'deviceFailure', capture: 'heatMeter', valueUnit: 'kWh' }
  const s = computeSettlement({ ...beispiel({ estimates: [estimate], row: { ...ANGABEN, infoReferenceKwhPerM2: null, infoReferenceSource: null } }), readings })
  const n = notice(s, 'heating.info-incomplete')
  assert.match(n.text, /Der Verbrauch von Mieter A \(A\) ist nach § 9a HeizkostenV geschätzt.*„Nicht darunter fallen also die Fälle des § 9a und Fälle, in denen eine Ausnahme gemäß § 11 greift“.*BR-Drs\. 643\/21, S\. 19 und 22.*Auslegung von Mietfuchs/s)
  const cutList = n.text.split('Satz 3 HeizkostenV), hier:')[1]?.split('. ')[0] ?? assert.fail(n.text)
  assert.doesNotMatch(cutList, /Mieter A/)
  assert.match(cutList, /Mieter B \(B\)/)
  assert.deepEqual(infoOf(s).users.find((u) => u.tenancyId === 'A')?.missing, [])
})

test('Durchsicht R-W6: Ohne Position mit dem Teil Erfassung kein „0,00 €“, sondern ein offener Hinweis', () => {
  const base = mitAngaben()
  const s = computeSettlement({ ...base, costItems: base.costItems.map((c) => (c.heatingPart === 'metering' ? { ...c, heatingPart: 'operating' as const } : c)) })
  const info = infoOf(s)
  assert.deepEqual([info.meteringCents, info.uncertain.includes('1c')], [null, true])
  assert.match(notice(s, 'heating.info-open').text, /Keine Position dieser Heizanlage trägt den Teil „Messdienst, Ablesung, Geräte“.*\(Nr\. 1 c\)/s)
  assert.equal(infoOf(computeSettlement(base)).meteringCents, 18000)
})

test('Durchsicht R-K12: Ausnahme nur der Wärme – für die monatliche Information zählen nur Warmwassergeräte', () => {
  const heat = { exemption: 'lowDemand' as const, exemptionScope: 'heat' as const }
  assert.ok(!codes(computeSettlement(fernAlle(mitAngaben(heat), ['wz-a', 'wz-b']))).includes('heating.monthly-info'))
  const n = notice(computeSettlement(fernAlle(mitAngaben(heat), ['xw-a'])), 'heating.monthly-info')
  assert.match(n.text, /seinen Anteil am Warmwasser um bis zu 3 %/)
})

test('Durchsicht R-W7, R-K1, R-W8: Wortlaut des § 11 und die CO₂-Sätze je Umfang', () => {
  const text = (row: Partial<HeatingPeriodData>) => notice(computeSettlement(beispiel({ row })), 'heating.exemption').text
  const a = text({ exemption: 'renewable', exemptionScope: 'both' })
  assert.match(a, /Wärme aus Wärmerückgewinnung oder Solaranlagen \(§ 11 Abs\. 1 Nr\. 3 Buchst\. a HeizkostenV\) versorgt wird\./)
  assert.doesNotMatch(a, /sofern/)
  assert.match(text({ exemption: 'chp', exemptionScope: 'both' }), /Kraft-Wärme-Kopplung oder aus Anlagen zur Verwertung von Abwärme versorgt wird, sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird \(§ 11 Abs\. 1 Nr\. 3 Buchst\. b HeizkostenV\)/)
  assert.match(text({ exemption: 'disproportionate', exemptionScope: 'both' }), /das Anbringen der Ausstattung zur Verbrauchserfassung, die Erfassung des Wärmeverbrauchs oder die Verteilung der Kosten des Wärmeverbrauchs nicht oder nur mit unverhältnismäßig hohen Kosten möglich ist/)
  const heat = text({ exemption: 'lowDemand', exemptionScope: 'heat' })
  assert.match(heat, /teilt Mietfuchs weiter auf: .*„in denen keine Heizkostenabrechnung durchgeführt wird“ \(BT-Drs\. 20\/3172, S\. 28, zu § 2 Abs\. 7 CO2KostAufG\).*Auslegung von Mietfuchs/s)
  assert.doesNotMatch(heat, /sagt das Gesetz nicht ausdrücklich/)
})

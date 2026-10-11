// Monatliche Verbrauchsinformation in der Abrechnung (Heizung PR 22): Bei eigener Abrechnung mit
// fernablesbaren Zählern nennt `heating.monthly-info` die Monate, die fehlen oder unvollständig sind, und je
// betroffenem Mieter einmal 3 % (§ 12 Abs. 1 Satz 3 HeizkostenV), nicht je Monat und nicht zusätzlich zu den
// Angaben zur Abrechnung (BR-Drs. 643/21, S. 24 f.). Kein Betrag wird abgezogen. Grundlage ist Beispiel A
// (server/testing/selfHeating.ts) mit Ständen am 31.12.2023 wie in calc-pflichtangaben.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot, SnapshotReading } from '../src/snapshot.ts'
import { selfReading, selfSnapshot, type SelfSnapshotOptions } from '../testing/selfHeating.ts'
import type { HeatingPeriodData, MonthlyInfoRow } from '../../shared/types.ts'
import { addMonths, monthBounds } from '../../shared/monthlyInfo.ts'

const ANGABEN: Partial<HeatingPeriodData> = {
  infoTaxesText: 'Energiesteuer 312,00 €', climateFactor: 1.08, climateFactorPrev: 1.15, climateFactorSource: 'Deutscher Wetterdienst, Klimafaktoren 79100',
  infoReferenceKwhPerM2: 150, infoReferenceSource: 'Vergleichswerte des Ablesedienstes Beispiel 2025', consumerContract: 'none',
}
function beispiel(o: SelfSnapshotOptions = {}): Snapshot {
  const base = selfSnapshot(o)
  const extra = base.meters.filter((m) => m.unitId !== null).map((m) => selfReading(m.id, '2023-12-31', 0))
  return { ...base, readings: [...base.readings, ...extra] }
}
const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const monthlyOf = (s: Snapshot, asOf = '2026-02-15') => computeSettlement(s, { asOf }).notices.find((n) => n.code === 'heating.monthly-info')
const fern = (s: Snapshot, ids?: readonly string[]): Snapshot =>
  ({ ...s, meters: s.meters.map((m) => (m.unitId !== null && (!ids || ids.includes(m.id)) ? { ...m, remoteReadable: true } : m)) })

// Monatsendstände für jeden Wohnungszähler: linear zwischen den benachbarten vorhandenen Ablesungen, an
// Tagen, an denen noch keine liegt. So bleiben die Stände an den Grenzen der Heizperiode und am Wechsel von
// C, mit denen die Abrechnung rechnet, unberührt.
function mitMonatsstaenden(s: Snapshot): Snapshot {
  const added: SnapshotReading[] = []
  for (const m of s.meters.filter((x) => x.unitId !== null)) {
    const own = s.readings.filter((r) => r.meterId === m.id).sort((a, b) => (a.date < b.date ? -1 : 1))
    const first = own[0]
    const last = own.at(-1)
    if (!first || !last) continue
    for (let month = first.date.slice(0, 7); month <= last.date.slice(0, 7); month = addMonths(month, 1)) {
      const end = monthBounds(month).to
      if (own.some((r) => r.date === end)) continue
      const prev = own.filter((r) => r.date < end).at(-1)
      const next = own.find((r) => r.date > end)
      if (!prev || !next) continue
      const share = (Date.parse(end) - Date.parse(prev.date)) / (Date.parse(next.date) - Date.parse(prev.date))
      added.push({ meterId: m.id, date: end, value: Math.round((prev.value + share * (next.value - prev.value)) * 1000) / 1000 })
    }
  }
  return { ...s, readings: [...s.readings, ...added] }
}

const zeilen = (sent = true, ref: number | null = 8): MonthlyInfoRow[] => Array.from({ length: 12 }, (_, k) => {
  const month = `2025-${String(k + 1).padStart(2, '0')}`
  return { plantId: 'hp', month, referenceKwhPerM2: ref, referenceSource: ref === null ? null : 'Vergleichsdaten des Ablesedienstes', sentOn: sent ? `${addMonths(month, 1)}-05` : null }
})
const voll = (rows: MonthlyInfoRow[] = zeilen(), row: Partial<HeatingPeriodData> = {}) =>
  mitMonatsstaenden(fern(beispiel({ row: { dhwTempC: 55, ...row }, monthlyInfoRows: rows })))

test('Ohne fernablesbares Gerät kein Hinweis', () => {
  assert.equal(monthlyOf(beispiel()), undefined)
})

test('Fernablesbar, nichts erstellt: Warnung mit allen Monaten und Lücken, „um 3 %“ mit Auslegung, nie abgezogen', () => {
  const n = monthlyOf(fern(beispiel())) ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /seit dem 01\.01\.2022 jeden Monat eine Verbrauchsinformation zu \(§ 6a Abs\. 1 und 2 HeizkostenV\)/)
  assert.match(n.text, /Nicht als mitgeteilt vermerkt: Januar bis Dezember 2025\./)
  // Alle Monate statt nur der Heizperiode der Richtlinie, als Auslegung gekennzeichnet (Prüfung K1).
  assert.match(n.text, /für jeden Monat, auch außerhalb der Heizperiode: Die Verordnung sagt nur „monatlich“, das Vorblatt der Begründung nennt „während der Heizperiode“ \(BR-Drs\. 643\/21\); das ist eine vorsichtige Auslegung zu Ihren Lasten\./)
  assert.match(n.text, /Unvollständig: Januar bis Dezember 2025 \(Zählerstand genau am Monatsende fehlt, auch bei einem ausgefallenen Gerät; Vergleich mit einem Durchschnittsnutzer fehlt\)\./)
  assert.match(n.text, /darf jeder betroffene Mieter seinen Anteil an den Heizkosten um 3 % kürzen \(§ 12 Abs\. 1 Satz 3 HeizkostenV\)/)
  assert.doesNotMatch(n.text, /bis zu 3 %/)
  assert.match(n.text, /Ob schon ein einzelner fehlender Monat die volle Kürzung erlaubt, ist nicht höchstrichterlich geklärt; Mietfuchs rechnet vorsorglich mit den vollen 3 % \(Auslegung\)\./)
  assert.match(n.text, /Karte „Monatliche Verbrauchsinformation“/)
  assert.match(n.text, /Portal mit einer Nachricht jeden Monat.*Karte „Ausnahmen und Vereinbarungen“/s)
  assert.doesNotMatch(n.text, /Einzelfall/, 'alle Geräte fernablesbar: keine gemischte Ausstattung')
})

test('Prüfung M3: ein Kürzungsrecht – die Beträge stehen einmal, beim Hinweis zu den Angaben, wenn er sie nennt', () => {
  const s = computeSettlement(fern(beispiel()), { asOf: '2026-02-15' })
  const monthly = s.notices.find((n) => n.code === 'heating.monthly-info') ?? assert.fail('kein Hinweis')
  assert.match(monthly.text, /dasselbe Kürzungsrecht wie bei fehlenden Angaben zur Heizkostenabrechnung und kommt nicht hinzu.*\(BR-Drs\. 643\/21, S\. 24 f\.\)/s)
  assert.match(monthly.text, /Die Beträge je Mieter stehen beim Hinweis zu den Angaben zur Heizkostenabrechnung\./)
  assert.doesNotMatch(monthly.text, /[0-9],[0-9]{2} €/)
  // Fehlt zur Abrechnung nichts außer dem ersten Jahr von C2, nennt die monatliche Information die Beträge selbst, je Mieter einmal.
  const m2 = monthlyOf(fern(beispiel({ row: ANGABEN }))) ?? assert.fail('kein Hinweis')
  assert.match(m2.text, /hier: Mieter A \(A\) 53,83 €, Mieter B \(B\) [0-9.,]+ € und Mieter C1 \(C\) [0-9.,]+ €/)
  assert.equal(m2.text.match(/Mieter A \(A\) 53,83 €/g)?.length, 1)
  assert.match(m2.text, /Für Mieter C2 \(C\) stehen die Beträge beim Hinweis zu den Angaben zur Heizkostenabrechnung\./)
})

test('Alle Monate vollständig und mitgeteilt: kein Hinweis; ein Monat ohne Mitteilung: genau dieser', () => {
  assert.equal(monthlyOf(voll()), undefined)
  const rows = zeilen().map((r) => (r.month === '2025-03' ? { ...r, sentOn: null } : r))
  const n = monthlyOf(voll(rows)) ?? assert.fail('kein Hinweis')
  assert.match(n.text, /Nicht als mitgeteilt vermerkt: März 2025\./)
  assert.doesNotMatch(n.text, /Unvollständig/)
})

test('Ohne Vergleichswert unvollständig, mit Grund; ohne Temperatur das Warmwasser', () => {
  const rows = zeilen().map((r) => (r.month === '2025-07' ? { ...r, referenceKwhPerM2: null, referenceSource: null } : r))
  const n = monthlyOf(voll(rows)) ?? assert.fail('kein Hinweis')
  assert.match(n.text, /Unvollständig: Juli 2025 \(Vergleich mit einem Durchschnittsnutzer fehlt\)\./)
  assert.doesNotMatch(n.text, /Nicht als mitgeteilt/)
  const ohneTemp = monthlyOf(voll(zeilen(), { dhwTempC: null })) ?? assert.fail('kein Hinweis')
  assert.match(ohneTemp.text, /Unvollständig: Januar bis Dezember 2025 \(mittlere Warmwassertemperatur für die Umrechnung in kWh fehlt, eine geschätzte genügt\)\./)
})

test('Bestätigt „anders mitgeteilt“: kein Hinweis; Monate nach dem Stichtag nicht fällig', () => {
  assert.equal(monthlyOf(fern(beispiel({ row: { monthlyInfoElsewhere: true } }))), undefined)
  const frueh = monthlyOf(fern(beispiel()), '2025-03-10') ?? assert.fail('kein Hinweis')
  assert.match(frueh.text, /Nicht als mitgeteilt vermerkt: Januar bis Februar 2025\./)
})

test('Prüfung M8: gemischte Ausstattung – „um 3 %“ für den Mieter mit fernablesbarer Wohnung, Einzelfallprüfung als Auslegung benannt', () => {
  const n = monthlyOf(fern(beispiel({ row: ANGABEN }), ['wz-a', 'xw-a'])) ?? assert.fail('kein Hinweis')
  assert.match(n.text, /darf ein Mieter, dessen Wohnung fernablesbar ausgestattet ist, seinen Anteil an den Heizkosten um 3 % kürzen \(§ 12 Abs\. 1 Satz 3 HeizkostenV\), hier: Mieter A \(A\) 53,83 €\./)
  assert.match(n.text, /Bei Mieter B \(B\), Mieter C1 \(C\) und Mieter C2 \(C\) ist die Wohnung nicht oder nur zum Teil fernablesbar ausgestattet; auch dort ist eine Kürzung um 3 % möglich, hier: Mieter B \(B\) [0-9.,]+ € und Mieter C1 \(C\) [0-9.,]+ €\./)
  assert.match(n.text, /Sind im Haus nur einige Geräte fernablesbar, ist nach der Verordnungsbegründung im Einzelfall zu prüfen, ob die monatliche Information möglich und zumutbar ist \(BR-Drs\. 643\/21, S\. 18\); dass Mietfuchs die Kürzung trotzdem nennt, ist eine Auslegung zu Ihren Lasten\./)
  // Prüfung S7: Nur der Wärmezähler von A ist fernablesbar, sein Warmwasserzähler nicht – auch A ist gemischt.
  const halb = monthlyOf(fern(beispiel({ row: ANGABEN }), ['wz-a'])) ?? assert.fail('kein Hinweis')
  assert.match(halb.text, /Bei Mieter A \(A\), Mieter B \(B\), Mieter C1 \(C\) und Mieter C2 \(C\) ist die Wohnung nicht oder nur zum Teil fernablesbar/)
  assert.doesNotMatch(halb.text, /darf ein Mieter, dessen Wohnung/)
  // War die Wohnung nur in einem Teil der offenen Monate ganz fernablesbar (Warmwasserzähler ab Juli ohne
  // Fernablesung), gilt für den Mieter der Vorbehalt, nicht „um 3 %“.
  const s = fern(beispiel({ row: ANGABEN }), ['wz-a'])
  const spaeter = { ...s, meters: s.meters.map((m) => (m.id === 'xw-a' ? { ...m, installedOn: '2025-07-01' } : m)) }
  const teils = monthlyOf(spaeter) ?? assert.fail('kein Hinweis')
  assert.match(teils.text, /Bei Mieter A \(A\), Mieter B \(B\)/)
})

test('Prüfung M4: Ausnahme nur der Wärme – nur Warmwassergeräte, Kürzung am Warmwasser', () => {
  const heat = { exemption: 'lowDemand' as const, exemptionScope: 'heat' as const }
  assert.equal(monthlyOf(fern(beispiel({ row: heat }), ['wz-a', 'wz-b', 'wz-c'])), undefined)
  const n = monthlyOf(fern(beispiel({ row: heat }))) ?? assert.fail('kein Hinweis')
  assert.match(n.text, /seinen Anteil am Warmwasser um 3 % kürzen/)
  // Die Wärme ist keine Lücke: Mit Monatsständen und Temperatur fehlt nichts, auch wenn den Wärmezählern die
  // Stände am Monatsende fehlen.
  assert.equal(monthlyOf(voll(zeilen(), heat)), undefined)
  const ohneWaerme = voll(zeilen(), heat)
  const original = new Set(beispiel().readings.map((r) => `${r.meterId}@${r.date}`))
  const nurWasser = { ...ohneWaerme, readings: ohneWaerme.readings.filter((r) => !r.meterId.startsWith('wz-') || original.has(`${r.meterId}@${r.date}`)) }
  assert.equal(monthlyOf(nurWasser), undefined)
})

test('Prüfung M5: nur die Angabe an der Anlage – der Hinweis von PR 14 bleibt und sagt, was Mietfuchs braucht', () => {
  const n = monthlyOf(beispiel({ plant: { devicesRemote: 'all' } })) ?? assert.fail('kein Hinweis')
  assert.match(n.text, /bis zu 3 %/)
  assert.match(n.text, /Tragen Sie bei den Zählern ein, welche fernablesbar sind; dann erstellt Mietfuchs die Information\./)
  assert.doesNotMatch(n.text, /Nicht als mitgeteilt/)
})

test('Prüfung S6: Werte des Ablesedienstes – Mietfuchs erstellt nichts, der Hinweis von PR 14 bleibt', () => {
  const n = monthlyOf(fern(beispiel({ plant: { capture: 'serviceValues' } }))) ?? assert.fail('kein Hinweis')
  assert.match(n.text, /bis zu 3 %/)
  assert.match(n.text, /Werten des Ablesedienstes erstellt Mietfuchs diese Informationen nicht/)
  assert.doesNotMatch(n.text, /Nicht als mitgeteilt/)
})

test('Keine Zahl ändert sich durch die Information, und der Rechtsstand nennt die Formel nur mit Warmwasser', () => {
  const ohne = computeSettlement(fern(beispiel()), { asOf: '2026-02-15' })
  const mit = computeSettlement(voll(), { asOf: '2026-02-15' })
  assert.deepEqual(mit.statements.map((x) => [x.tenancyId, x.balanceCents]), ohne.statements.map((x) => [x.tenancyId, x.balanceCents]))
  assert.ok(!codes(mit).includes('heating.monthly-info'))
})

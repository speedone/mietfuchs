// §§ 5a, 5b, 5d CO2KostAufG (Heizung PR 18, #215): wo im Zeitraum die hälftige Teilung greift.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applicableRanges, blendedPermille, halfAmounts, halfSplitStatus, noticeCounts, termsFromDeliveries, termsFromPieces, termsWeight, tightMarketIn, twoFamilyOf,
  type HalfDelivery, type HalfSplitFacts, type HalfSplitRules, type Piece,
} from '../src/halfSplit.ts'
import { co2HalfSplit, co2HalfSplitEmergency, co2HalfSplitNewBuildings } from '../../shared/law/co2kostaufg.ts'
import { daysIn, valueAt, versionsIn } from '../../shared/law/register.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'

const RULES: HalfSplitRules = { newBuildings: valueAt(co2HalfSplitNewBuildings, '2029-01-01'), emergency: valueAt(co2HalfSplitEmergency, '2028-01-01') }
const facts = (over: Partial<HalfSplitFacts> = {}): HalfSplitFacts => ({
  gmodg43InstalledOn: '2027-03-01', emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null, ...over,
})
const H27 = { from: '2027-05-01', to: '2028-04-30' }
const H28 = { from: '2028-05-01', to: '2029-04-30' }
const pieces = (r: { from: string; to: string }): Piece[] => versionsIn(co2HalfSplit, r)
const TABLE = valueAt(hkvDegreeDays, '2027-05-01')
const gradtage = (r: { from: string; to: string }): number => degreeDayPermille([r], TABLE)
const near = (a: number, b: number, what: string): void => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} statt ${b}`)

test('Ohne Tag des Einbaus keine Teilung; sonst ab dem Einbau, im Neubau als § 5b', () => {
  assert.deepEqual(halfSplitStatus(facts({ gmodg43InstalledOn: null }), RULES), { kind: 'none' })
  assert.deepEqual(halfSplitStatus(facts(), RULES), { kind: 'applies', basis: 'existing', from: '2027-03-01', excluded: [], assumed: [] })
  assert.deepEqual(halfSplitStatus(facts({ newBuildingFirstUse: '2028-09-01', buildingApplicationBefore20260513: false }), RULES).kind, 'applies')
  assert.deepEqual(halfSplitStatus(facts({ newBuildingFirstUse: '2028-09-01', buildingApplicationBefore20260513: true }), RULES), { kind: 'excluded', reason: 'applicationBefore' })
  const unklar = halfSplitStatus(facts({ newBuildingFirstUse: '2028-09-01' }), RULES)
  assert.ok(unklar.kind === 'applies' && unklar.basis === 'newBuilding' && unklar.assumed.includes('application'), 'unbekannter Bauantrag: hälftig, mit Rückfrage')
})

test('§ 5a Abs. 4 Satz 1 (Review Focus 1): Einbau am 15.06.2027 nach Ausfall, zwölf Monate ohne Teilung bis 15.06.2028', () => {
  const s = halfSplitStatus(facts({ gmodg43InstalledOn: '2027-06-15', emergencyInstall: true }), RULES)
  assert.deepEqual(s.kind === 'applies' ? s.excluded : null, [{ from: '2027-06-15', to: '2028-06-15', rule: 'emergency1' }])
  assert.deepEqual(applicableRanges(s, H27), [])
  assert.deepEqual(applicableRanges(s, H28), [{ from: '2028-06-16', to: '2029-04-30' }])
  // Genau zwölf Monate vor dem 01.01.2028 ist nicht „weniger als zwölf Monate“ (Wortlaut); der Status sagt es,
  // damit der Hinweis es als Auslegung nennt (Prüfung S14, Entwurf 15.1 Nr. 26).
  const genau = halfSplitStatus(facts({ gmodg43InstalledOn: '2027-01-01', emergencyInstall: true }), RULES)
  assert.deepEqual(genau.kind === 'applies' ? [genau.excluded, genau.emergencyBoundary] : null, [[], true])
  const einTagSpaeter = halfSplitStatus(facts({ gmodg43InstalledOn: '2027-01-02', emergencyInstall: true }), RULES)
  assert.deepEqual(einTagSpaeter.kind === 'applies' ? [einTagSpaeter.excluded.map((x) => x.rule), einTagSpaeter.emergencyBoundary] : null, [['emergency1'], undefined])
  // Ohne Notfalleinbau gibt es keine Grenze zu nennen.
  const ohneNotfall = halfSplitStatus(facts({ gmodg43InstalledOn: '2027-01-01' }), RULES)
  assert.equal(ohneNotfall.kind === 'applies' ? ohneNotfall.emergencyBoundary : 'x', undefined)
})

test('§ 5a Abs. 4 Satz 2: Einbau 2028 nach Ausfall ohne vorherige Pflicht → zwölf Monate ab dem Einbau keine Teilung (Abweichung 6, BT-Drs. 21/7009 S. 154)', () => {
  const s = halfSplitStatus(facts({ gmodg43InstalledOn: '2028-03-01', emergencyInstall: true, emergencyPriorDuty: false }), RULES)
  assert.deepEqual(s.kind === 'applies' ? s.excluded : null, [{ from: '2028-03-01', to: '2029-03-01', rule: 'emergency2' }])
  assert.deepEqual(applicableRanges(s, H28), [{ from: '2029-03-02', to: '2029-04-30' }])
  // Einbau am 01.11.2028: geteilt wird ab dem 02.11.2029, nicht ab dem 01.01.2029.
  const spaet = halfSplitStatus(facts({ gmodg43InstalledOn: '2028-11-01', emergencyInstall: true, emergencyPriorDuty: false }), RULES)
  assert.deepEqual(spaet.kind === 'applies' ? spaet.excluded : null, [{ from: '2028-11-01', to: '2029-11-01', rule: 'emergency2' }])
  assert.deepEqual(applicableRanges(spaet, { from: '2029-01-01', to: '2029-12-31' }), [{ from: '2029-11-02', to: '2029-12-31' }])
  const mitPflicht = halfSplitStatus(facts({ gmodg43InstalledOn: '2028-03-01', emergencyInstall: true, emergencyPriorDuty: true }), RULES)
  assert.deepEqual(mitPflicht.kind === 'applies' ? mitPflicht.excluded : null, [])
  const unklar = halfSplitStatus(facts({ gmodg43InstalledOn: '2028-03-01', emergencyInstall: true }), RULES)
  assert.ok(unklar.kind === 'applies' && unklar.excluded.length === 0 && unklar.assumed.includes('priorDuty'))
})

test('§ 5a Abs. 4 Satz 3: Einbau ab 2029 nach Ausfall ohne vorherige Pflicht → zwölf Monate ohne Teilung', () => {
  const s = halfSplitStatus(facts({ gmodg43InstalledOn: '2029-05-10', emergencyInstall: true, emergencyPriorDuty: false }), RULES)
  assert.deepEqual(s.kind === 'applies' ? s.excluded : null, [{ from: '2029-05-10', to: '2030-05-10', rule: 'emergency3' }])
  assert.deepEqual(applicableRanges(s, { from: '2030-01-01', to: '2030-12-31' }), [{ from: '2030-05-11', to: '2030-12-31' }])
})

test('§ 5d Abs. 3 und 4: Zweifamilienhaus mit Eigennutzung (Review Focus 2, Abweichungen 3, 4, 15)', () => {
  // Mietvertrag seit 2020, Heizung nach § 43 eingebaut am 01.03.2027: Die Voraussetzungen traten nach
  // Vertragsschluss ein (§ 5d Abs. 4 Satz 2). Abrechnungsfrist für 2028: 31.12.2029.
  const mieter = { tenantName: 'Mieter A', contractFrom: '2020-01-01', noticeOn: '2027-12-01' }
  const zfh = { dwellings: 2, selfUsed: true, central: true, servesAll: true, tightMarket: false, tenancies: [mieter], conditionsFrom: '2027-03-01', deadline: '2029-12-31' }
  assert.deepEqual(twoFamilyOf(zfh, 2, '2028-01-01'), { kind: 'excepted', notices: [{ tenantName: 'Mieter A', noticeOn: '2027-12-01', withSettlement: false }] })
  assert.deepEqual(twoFamilyOf({ ...zfh, tightMarket: true }, 2, '2028-01-01'), { kind: 'split', reason: 'tightMarket', missing: [], late: [] })
  assert.deepEqual(twoFamilyOf({ ...zfh, tightMarket: null }, 2, '2028-01-01'), { kind: 'split', reason: 'tightMarketUnknown', missing: [], late: [] })
  assert.deepEqual(twoFamilyOf({ ...zfh, tenancies: [{ ...mieter, noticeOn: null }] }, 2, '2028-01-01'), { kind: 'split', reason: 'notice', missing: ['Mieter A'], late: [] })
  // Review Focus 2: Mitteilung am 15.03.2028 mit der Abrechnung genügt im Fall des Satzes 2 (BT-Drs. 21/7009 S. 156).
  assert.deepEqual(twoFamilyOf({ ...zfh, tenancies: [{ ...mieter, noticeOn: '2028-03-15' }] }, 2, '2028-01-01'), { kind: 'excepted', notices: [{ tenantName: 'Mieter A', noticeOn: '2028-03-15', withSettlement: true }] })
  // Am letzten Tag der Frist reicht es noch, am Tag danach nicht mehr.
  assert.equal(twoFamilyOf({ ...zfh, tenancies: [{ ...mieter, noticeOn: '2029-12-31' }] }, 2, '2028-01-01').kind, 'excepted')
  assert.deepEqual(twoFamilyOf({ ...zfh, tenancies: [{ ...mieter, noticeOn: '2030-01-15' }] }, 2, '2028-01-01'), { kind: 'split', reason: 'notice', missing: [], late: [{ tenantName: 'Mieter A', noticeOn: '2030-01-15' }] })
  // Satz 1: Vertrag erst nach dem Einbau → die Mitteilung zählt nur vor Beginn des Zeitraums (Satz 4).
  const neu = { ...mieter, contractFrom: '2027-06-01', noticeOn: '2028-03-15' }
  assert.deepEqual(twoFamilyOf({ ...zfh, tenancies: [neu] }, 2, '2028-01-01'), { kind: 'split', reason: 'notice', missing: [], late: [{ tenantName: 'Mieter A', noticeOn: '2028-03-15' }] })
  assert.deepEqual(twoFamilyOf({ ...zfh, tenancies: [neu] }, 2, '2029-01-01'), { kind: 'excepted', notices: [{ tenantName: 'Mieter A', noticeOn: '2028-03-15', withSettlement: false }] })
  // Vertrag am Tag des Einbaus: Die Voraussetzungen lagen schon bei Vertragsschluss vor (Satz 1).
  assert.equal(noticeCounts({ ...mieter, contractFrom: '2027-03-01', noticeOn: '2028-03-15' }, '2027-03-01', '2028-01-01', '2029-12-31'), null)
  assert.equal(noticeCounts({ ...mieter, contractFrom: '2027-02-28', noticeOn: '2028-03-15' }, '2027-03-01', '2028-01-01', '2029-12-31'), 'withSettlement')
  // Mehrere Mietverhältnisse im Zeitraum: die Ausnahme nur, wenn jede Mitteilung zählt.
  assert.deepEqual(twoFamilyOf({ ...zfh, tenancies: [mieter, { tenantName: 'Mieter B', contractFrom: '2028-06-01', noticeOn: null }] }, 2, '2028-01-01'), { kind: 'split', reason: 'notice', missing: ['Mieter B'], late: [] })
  assert.deepEqual(twoFamilyOf({ ...zfh, dwellings: 3 }, 2, '2028-01-01'), { kind: 'notApplicable' })
  assert.deepEqual(twoFamilyOf({ ...zfh, selfUsed: false }, 2, '2028-01-01'), { kind: 'notApplicable' })
  assert.deepEqual(twoFamilyOf({ ...zfh, servesAll: false }, 2, '2028-01-01'), { kind: 'notApplicable' })
  assert.deepEqual(twoFamilyOf({ ...zfh, central: false }, 2, '2028-01-01'), { kind: 'notApplicable' })
})

test('Angespannter Markt mit Geltung der Verordnung (Abweichung 4)', () => {
  const h = { from: '2030-01-01', to: '2030-12-31' }
  assert.equal(tightMarketIn({ tightMarket: true, tightMarketFrom: '2025-07-01', tightMarketTo: '2029-12-31' }, h), false, 'Verordnung vor H ausgelaufen')
  assert.equal(tightMarketIn({ tightMarket: true, tightMarketFrom: '2025-07-01', tightMarketTo: '2030-03-31' }, h), true, 'gilt an einem Tag von H')
  assert.equal(tightMarketIn({ tightMarket: true, tightMarketFrom: '2030-12-31', tightMarketTo: null }, h), true, 'gilt am letzten Tag von H')
  assert.equal(tightMarketIn({ tightMarket: true, tightMarketFrom: null, tightMarketTo: null }, h), true)
  assert.equal(tightMarketIn({ tightMarket: true, tightMarketFrom: '2031-01-01', tightMarketTo: null }, h), false, 'Verordnung erst nach H')
  assert.equal(tightMarketIn({ tightMarket: false }, h), false)
  assert.equal(tightMarketIn({ tightMarket: null }, h), null)
  assert.equal(tightMarketIn(null, h), null)
})

test('CO₂ nach Gradtagen (Entwurf 3.9): 530 ‰ ab 2028, Stufe 40 % → 453 ‰, 600 € → 271,80 €', () => {
  const s = halfSplitStatus(facts(), RULES)
  const terms = termsFromPieces(pieces(H27), applicableRanges(s, H27), gradtage, (v) => v.co2Permille)
  near(termsWeight(terms), 0.53, 'Gewicht ab 2028')
  const p = blendedPermille(400, terms) ?? assert.fail('kein Anteil')
  near(p, 453, 'Mischanteil')
  assert.equal(Math.round((60000 * p) / 1000), 27180)
  // Einbau erst am 01.03.2028: nur März und April zählen (130 + 80 = 210 ‰).
  const spaet = halfSplitStatus(facts({ gmodg43InstalledOn: '2028-03-01' }), RULES)
  near(termsWeight(termsFromPieces(pieces(H27), applicableRanges(spaet, H27), gradtage, (v) => v.co2Permille)), 0.21, 'ab dem Einbau')
  // Ohne Stufe (Fläche fehlt) nur, wenn der ganze Zeitraum hälftig ist. `null` heißt „Einstufung fehlt“,
  // nie „keine Aufteilung“: § 9 Abs. 2 ist ein Anteil von 0 ‰ (Abweichung 5).
  assert.equal(blendedPermille(null, terms), null)
  assert.equal(blendedPermille(null, [{ permille: 500, weight: 1 }]), 500)
  near(blendedPermille(0, terms) ?? assert.fail('kein Anteil'), 265, '§ 9 Abs. 2 mit Teilung ab 2028')
})

// Anteil einer Lieferung an einem Bereich, hier nach Tagen (der Aufrufer nimmt deliveryShare, Stufen 1–5).
const ranges: Record<string, { from: string; to: string }> = {
  A: { from: '2027-10-15', to: '2027-12-31' },
  B: { from: '2028-01-01', to: '2028-10-14' },
}
const nachTagen = (id: string, r: { from: string; to: string }): number => {
  const d = ranges[id] ?? assert.fail(`keine Lieferung ${id}`)
  const from = r.from > d.from ? r.from : d.from
  const to = r.to < d.to ? r.to : d.to
  return from > to ? 0 : daysIn({ from, to }) / daysIn(d)
}

test('Netzentgelte je Lieferung (Review Focus 3): die Zwischenrechnung bis 31.12.2027 bleibt beim Mieter', () => {
  const s = halfSplitStatus(facts(), RULES)
  const portionB = nachTagen('B', { from: '2028-01-01', to: '2028-04-30' })
  const list: HalfDelivery[] = [
    { id: 'A', label: 'Gas bis 31.12.2027', base: ranges.A ?? null, portion: 1, co2Cents: 10000, gridFeeCents: 5000, bioCostCents: null },
    { id: 'B', label: 'Gas 2028', base: { from: '2028-01-01', to: '2028-04-30' }, portion: portionB, co2Cents: 40000, gridFeeCents: 20000, bioCostCents: null },
  ]
  const a = halfAmounts(list, pieces, applicableRanges(s, H27), nachTagen, true)
  near(a.gridFeeRaw, 20000 * (121 / 288) * 0.5, 'Netzentgelte des Vermieters')
  assert.deepEqual([a.bioRaw, a.missingGrid, a.missingBio], [0, [], []])
  // CO₂ nach den Lieferungen: A ganz vor 2028, B ganz danach; Gewicht nach C · Anteil.
  const t = termsFromDeliveries(list, pieces, applicableRanges(s, H27), nachTagen, (v) => v.co2Permille)
  near(termsWeight(t), (40000 * portionB) / (10000 + 40000 * portionB), 'CO₂ ab 2028')
  const ohne = halfAmounts([{ ...list[1] ?? assert.fail('B fehlt'), gridFeeCents: null }], pieces, applicableRanges(s, H27), nachTagen, true)
  assert.deepEqual(ohne.missingGrid, ['Gas 2028'])
  // Eine Rechnung ganz vor 2028 ohne Netzentgelte fehlt nicht (nichts zu teilen).
  const vorher = halfAmounts([{ ...list[0] ?? assert.fail('A fehlt'), gridFeeCents: null }], pieces, applicableRanges(s, H27), nachTagen, true)
  assert.deepEqual(vorher.missingGrid, [])
})

test('Biobrennstoff erst ab 01.01.2029; Netzentgelte nur bei Gas', () => {
  const s = halfSplitStatus(facts(), RULES)
  const h = { from: '2028-07-01', to: '2029-06-30' }
  const list: HalfDelivery[] = [{ id: 'C', label: 'Gas 2028/2029', base: h, portion: 1, co2Cents: null, gridFeeCents: 36500, bioCostCents: 36500 }]
  const tage = (_: string, r: { from: string; to: string }): number => daysIn(r) / daysIn(h)
  const a = halfAmounts(list, pieces, applicableRanges(s, h), tage, true)
  near(a.gridFeeRaw, 36500 * 0.5, 'Netzentgelte ganz ab 2028')
  near(a.bioRaw, 36500 * (daysIn({ from: '2029-01-01', to: '2029-06-30' }) / daysIn(h)) * 0.5, 'Bio ab 2029')
  assert.equal(halfAmounts(list, pieces, applicableRanges(s, h), tage, false).gridFeeRaw, 0)
})

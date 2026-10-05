// CO₂-Aufteilung ohne Abrechnung (Heizung PR 6, Entwurf 7.3, 7.4, 7.5, 9.2, 9.4, 12.2 „co2.test.ts“):
// Grenzen der Tabelle mit Rundung, gekürzte Tabelle, Nachstufung, Probe, Eigenanteil und
// Abzugsbeträge, je mit den Zahlen des Entwurfs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distributeCents } from '../src/calc.ts'
import {
  ausweisGaps, reliefsByShare, restage, roundSpecific, selfLandlordRaw, selfSplit, shownReliefs, stageOf, stageRanges, tableFactor,
} from '../src/co2.ts'
import { serviceProbe } from '../../shared/co2Probe.ts'
import { co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { createLawLog, law, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { periodKey } from '../../shared/period.ts'
import type { Co2Statement } from '../../shared/types.ts'

const RANGES = stageRanges(valueAt(co2StageTable, LAW_AS_OF), 1)
const percentOf = (value: number) => stageOf(roundSpecific(value, 1), RANGES).landlordPercent
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

const statement = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2025-01'), method: 'serviceDeducted', areaM2: null,
  serviceEmissionsKg: null, serviceAreaM2: null, serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null,
  serviceLandlordCents: null, serviceUsersTotalCents: null, serviceUsersTotalApprox: false, serviceUnitsCount: null,
  serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [], ...over,
})

test('Einstufung: Grenzen 11,9 · 11,95 · 12,0 · 51,9 · 52,0 nach Rundung auf eine Nachkommastelle (Entwurf 9.2, 12.2)', () => {
  assert.deepEqual([11.9, 11.95, 12.0, 51.9, 52.0].map(percentOf), [0, 10, 10, 80, 95])
  // Der BMWK-Rechner rundet nicht und stuft 12,0 bei 0 % ein; Mietfuchs folgt dem Gesetz (9.2).
  assert.equal(roundSpecific(11.95, 1), 12)
  // Gleitkomma: 24.105,6 / 600 = 40,17599… wird 40,2 (B1).
  assert.equal(roundSpecific(24105.6 / 600, 1), 40.2)
  assert.equal(percentOf(24105.6 / 600), 60)
  // Kippen an der Grenze 27 (F13, Entwurf 12.1): 26,94 → 30 %, 26,95 → 40 %.
  assert.deepEqual([percentOf(26.94), percentOf(26.95)], [30, 40])
})

test('Rumpf: Grenzen anteilig gekürzt, 5,0 kg in 120 von 365 Tagen → 10 % (§ 5 Abs. 1 Satz 4, Entwurf 3.9, 12.2)', () => {
  const rumpf = { from: '2025-01-01', to: '2025-04-30', short: true }
  assert.equal(tableFactor(rumpf), 120 / 365)
  assert.equal(tableFactor({ from: '2025-05-01', to: '2026-04-30', short: false }), 1)
  // Schaltjahr: 01.05.2027–30.04.2028 hat 366 Tage, ein Rumpf 01.05.–31.12.2027 245 von 366.
  assert.equal(tableFactor({ from: '2027-05-01', to: '2027-12-31', short: true }), 245 / 366)
  const gekuerzt = stageRanges(valueAt(co2StageTable, LAW_AS_OF), tableFactor(rumpf))
  assert.equal(stageOf(5.0, gekuerzt).landlordPercent, 10)
  assert.equal(stageOf(5.0, RANGES).landlordPercent, 0)
  assert.ok(near(gekuerzt[1]?.from ?? 0, (12 * 120) / 365))
})

test('Nachstufung (Entwurf 9.2): Techem 46,4 kg mit 35 % passt nicht zur Tabelle (70 %), ein ganzzahliger Wert gilt als Spanne', () => {
  const techem = statement({ serviceKgPerM2: 46.4, serviceLandlordPermille: 350, serviceTotalCents: 25000, serviceLandlordCents: 8750 })
  const r = restage(techem, RANGES, 1)
  assert.deepEqual([r.value, r.stage?.landlordPercent, r.percentOk, r.sumOk], [46.4, 70, false, true])
  assert.equal(restage({ ...techem, serviceLandlordPermille: 700, serviceLandlordCents: 17500 }, RANGES, 1).percentOk, true)
  // 27 gedruckt: 26,5 bis unter 27,5, also 30 % oder 40 %.
  for (const permille of [300, 400]) assert.equal(restage(statement({ serviceKgPerM2: 27, serviceLandlordPermille: permille }), RANGES, 1).percentOk, true)
  assert.equal(restage(statement({ serviceKgPerM2: 27, serviceLandlordPermille: 500 }), RANGES, 1).percentOk, false)
  // L muss zu C · ‰ passen, bis auf einen Cent und die Rundung von L.
  assert.equal(restage({ ...techem, serviceLandlordPermille: 700, serviceLandlordCents: 17501 }, RANGES, 1).sumOk, true)
  assert.equal(restage({ ...techem, serviceLandlordPermille: 700, serviceLandlordCents: 17502 }, RANGES, 1).sumOk, false)
  // Ausstoß und Fläche statt kg je m²: 5.421 kg / 200,6 m² → 27,0 → 40 %.
  const ausFlaeche = restage(statement({ serviceEmissionsKg: 5421, serviceAreaM2: 200.6, serviceLandlordPermille: 400 }), RANGES, 1)
  assert.deepEqual([ausFlaeche.value, ausFlaeche.stage?.landlordPercent, ausFlaeche.percentOk], [27, 40, true])
  assert.deepEqual(restage(statement({}), RANGES, 1), { value: null, stage: null, percentOk: null, sumOk: null })
})

test('Ausweis (§ 7 Abs. 3): was für Einstufung und Grundlagen fehlt', () => {
  assert.deepEqual(ausweisGaps(statement({})), [
    'der CO₂-Ausstoß je Quadratmeter (oder Ausstoß und Fläche)', 'der Anteil des Vermieters in Prozent', 'die CO₂-Kosten insgesamt',
  ])
  assert.deepEqual(ausweisGaps(statement({ serviceEmissionsKg: 5421, serviceAreaM2: 200.6, serviceLandlordPermille: 400, serviceTotalCents: 60000 })), [])
})

test('Probe G-B3 (Entwurf 7.3): Betrag = S + L ± 1 ct; Einzelbeträge bis S + NE · 2 ct', () => {
  const items = (entered: number, amount = 393301) => [{ amountCents: amount, tenancyAmounts: { t: entered } }]
  const probe = (entered: number, amount?: number, approx = false) =>
    serviceProbe({ deducted: true, items: items(entered, amount), usersTotalCents: 384551, landlordCents: 8750, unitsCount: 4, approx })
  assert.equal(probe(384551).ok, true)
  assert.equal(probe(384559).ok, true)
  assert.deepEqual([probe(384560).ok, probe(384560).enteredOk, probe(384560).toleranceCents], [false, false, 8])
  assert.equal(probe(384551, 393302).ok, true)
  assert.equal(probe(384551, 393303).itemsOk, false)
  // Nur ausgewiesen: Betrag = S, ohne Spielraum.
  const shown = (amount: number) => serviceProbe({ deducted: false, items: [{ amountCents: amount, tenancyAmounts: { t: 384551 } }], usersTotalCents: 384551, landlordCents: 8750, unitsCount: 4, approx: false })
  assert.equal(shown(384551).ok, true)
  assert.equal(shown(384552).ok, false)
  // S geschätzt („Ich finde diese Zeile nicht“): Spielraum NE · 2 ct auch beim Betrag.
  assert.equal(probe(384551, 393310, true).itemsOk, true)
  assert.equal(probe(384551, 393311, true).itemsOk, false)
  // Eigenbeträge zählen mit, negative Einträge nicht.
  assert.equal(serviceProbe({ deducted: false, items: [{ amountCents: 100000, tenancyAmounts: { t: 60000, u: -5 }, selfAmounts: { c: 40000 } }], usersTotalCents: 100000, landlordCents: 0, unitsCount: 2, approx: false }).enteredCents, 100000)
})

test('L_self (Entwurf 7.4, Beispiel B): Näherung L · Eigenbeträge / S, sonst der Wert laut Messdienst', () => {
  const naehe = selfLandlordRaw(10000, 290000, 60000, null)
  assert.ok(near(naehe.raw, (10000 * 60000) / 290000))
  assert.equal(Math.round(naehe.raw), 2069)
  assert.equal(naehe.approximated, true)
  assert.deepEqual(selfLandlordRaw(10000, 290000, 60000, 2500), { raw: 2500, approximated: false })
  assert.deepEqual(selfLandlordRaw(10000, 290000, 0, null), { raw: 0, approximated: false })
})

test('Abzug nach Anteil (Entwurf 9.4, B8, G-B5): 232,14 / 139,28 / 92,85 €, nicht 224,40 € nach dem ganzen Topf', () => {
  const shares = [{ tenancyId: 'A', cents: 450000 }, { tenancyId: 'B', cents: 270000 }, { tenancyId: 'C', cents: 180000 }]
  const r = reliefsByShare(46427, shares, 900000)
  assert.ok(near(r[0]?.raw ?? 0, 23213.5) && near(r[1]?.raw ?? 0, 13928.1) && near(r[2]?.raw ?? 0, 9285.4))
  const total = Math.round(r.reduce((a, x) => a + x.raw, 0))
  // Der eine Restcent geht an A (Rest 0,5 > 0,4 > 0,1; R-b).
  assert.deepEqual(distributeCents(total, r.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw }))), [23214, 13928, 9285])
  // Die erste Fassung nahm den ganzen Topf: Brennstoff 9.000 € nach Verbrauch und Messkosten 1.000 €
  // je ⅓, A also 4.833,33 von 10.000 €.
  const topf = reliefsByShare(46427, [{ tenancyId: 'A', cents: 450000 + 100000 / 3 }], 1000000)
  assert.equal(Math.round(topf[0]?.raw ?? 0), 22440)
})

test('Beispiel B1 (Entwurf 9.4): 40,2 kg → 60 %, L 464,27 €, verteilt 185,71 / 154,76 / 123,80 €', () => {
  assert.equal(percentOf(24105.6 / 600), 60)
  const L = (77379 * 600) / 1000
  assert.ok(near(L, 46427.4))
  const r = reliefsByShare(L, [{ tenancyId: 'a', cents: 360000 }, { tenancyId: 'b', cents: 300000 }, { tenancyId: 'c', cents: 240000 }], 900000)
  const total = Math.round(r.reduce((a, x) => a + x.raw, 0))
  assert.deepEqual(distributeCents(total, r.map((x) => ({ key: x.tenancyId, landlord: false, raw: x.raw }))), [18571, 15476, 12380])
})

test('Nur ausgewiesen (Entwurf 7.5): Werte laut Messdienst geprüft, sonst nach Anteil; ein fehlender wird ergänzt', () => {
  const shares = [{ tenancyId: 'A', cents: 60000 }, { tenancyId: 'B', cents: 30000 }]
  const ok = shownReliefs(10000, 100000, shares, [{ tenancyId: 'A', cents: 6000 }, { tenancyId: 'B', cents: 3000 }])
  assert.deepEqual(ok, { raws: [{ tenancyId: 'A', raw: 6000, approximated: false }, { tenancyId: 'B', raw: 3000, approximated: false }], problem: null, missing: [] })
  const einer = shownReliefs(10000, 100000, shares, [{ tenancyId: 'A', cents: 6000 }])
  assert.deepEqual(einer.missing, ['B'])
  assert.deepEqual(einer.raws[1], { tenancyId: 'B', raw: 3000, approximated: true })
  const zuviel = shownReliefs(10000, 100000, shares, [{ tenancyId: 'A', cents: 7000 }, { tenancyId: 'B', cents: 3500 }])
  assert.deepEqual(zuviel.problem, { kind: 'sum', givenCents: 10500 })
  assert.deepEqual(zuviel.raws.map((x) => [x.raw, x.approximated]), [[6000, true], [3000, true]])
  // Über dem eigenen Anteil, bei einem L, das die Summe noch zuließe.
  assert.deepEqual(shownReliefs(40000, 100000, shares, [{ tenancyId: 'B', cents: 30001 }]).problem, { kind: 'tenancy', tenancyId: 'B', givenCents: 30001, shareCents: 30000 })
  assert.deepEqual(shownReliefs(10000, 100000, shares, [{ tenancyId: 'X', cents: 1 }]).problem, { kind: 'tenancy', tenancyId: 'X', givenCents: 1, shareCents: 0 })
})

// ---------- Eigene Aufteilung (Heizung PR 7, Entwurf 9.2) ----------

const TABELLE = law(co2StageTable, { period: { from: '2025-05-01', to: '2026-04-30' } }, createLawLog())
const eigen = (over: Partial<Parameters<typeof selfSplit>[0]> = {}) => selfSplit({
  emissionsKg: 24105.6, co2Cents: 77379, areaM2: 600, ranges: stageRanges(TABELLE, 1), decimals: 1,
  nonResidentialPermille: null, restriction: null, ...over,
})

test('selfSplit: Beispiel B1 (24.105,6 kg auf 600 m² = 40,2 → 60 %, L = 464,27 €)', () => {
  const s = eigen()
  assert.deepEqual([s.value, s.stage?.landlordPercent, s.permille, s.adjustments], [40.2, 60, 600, []])
  assert.ok(near(s.landlordRaw ?? 0, 46427.4), 'L exakt, gerundet wird erst bei der Verteilung')
})

test('selfSplit: § 8 setzt 500 ‰, § 9 halbiert, beide Vorgaben heben die Aufteilung auf', () => {
  assert.deepEqual([eigen({ nonResidentialPermille: 500 }).permille, eigen({ nonResidentialPermille: 500 }).adjustments], [500, ['nonResidential']])
  const halb = eigen({ restriction: { factor: 0.5, bothSplit: false, both: false } })
  assert.deepEqual([halb.permille, halb.adjustments], [300, ['restrictionHalf']])
  const keine = eigen({ restriction: { factor: 0.5, bothSplit: false, both: true } })
  assert.deepEqual([keine.permille, keine.landlordRaw, keine.adjustments], [0, 0, ['restrictionNone']])
  // § 9 Abs. 1 kürzt auch den Anteil nach § 8.
  assert.equal(eigen({ nonResidentialPermille: 500, restriction: { factor: 0.5, bothSplit: false, both: false } }).permille, 250)
  // Ohne Einstufung (Fläche fehlt) kein Anteil; im Nichtwohngebäude braucht es keine.
  assert.equal(eigen({ areaM2: null }).permille, null)
  assert.equal(eigen({ areaM2: null, nonResidentialPermille: 500 }).permille, 500)
})

test('selfSplit: Rumpf 01.01.–30.04.2025 kürzt die Tabelle; 5,0 kg je m² → 10 % (Entwurf 12.2)', () => {
  const faktor = tableFactor({ from: '2025-01-01', to: '2025-04-30', short: true })
  const s = eigen({ emissionsKg: 3000, areaM2: 600, ranges: stageRanges(TABELLE, faktor) })
  assert.deepEqual([s.value, s.stage?.landlordPercent], [5, 10])
  assert.equal(eigen({ emissionsKg: 3000, areaM2: 600 }).stage?.landlordPercent, 0, 'ungekürzt läge 5,0 unter 12')
})

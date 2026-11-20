// Rechnung einer Mieterhöhung (#191, PR 2, Entwurf docs/superpowers/specs/2026-11-20-mieterhoehung-design.md, R1 bis
// R14): Beispiele der Recherche und der BGH-Urteile nachgerechnet, Sperren und Invarianten über zufällige Staffeln mit
// festem Startwert.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Property, RentEntry, RentIncreasePlan, RentIncreaseRequest, Tenancy, Unit } from '../../shared/types.ts'
import { nextRentEvents, planRentIncrease, rentIncreaseRequestOf, type RentIncreaseInput } from '../src/rentIncrease.ts'
import { AMOUNT_MAX_CENTS } from '../../shared/epcQr.ts'

type TenancyPart = RentIncreaseInput['tenancy']

const tenancyOf = (over: Partial<TenancyPart> = {}): TenancyPart => ({
  id: 't1',
  start: '2020-01-01',
  end: null,
  baseRents: [{ from: '2020-01', monthlyCents: 50000, reason: 'agreement' }],
  rentKind: 'free',
  rentIncreaseExcluded: false,
  costModel: 'settlement',
  heatingModel: 'settlement',
  ...over,
})
const unit: Pick<Unit, 'areaM2'> = { areaM2: 60 }
const property: Pick<Property, 'rentCapReduced' | 'state' | 'tightMarket'> = { rentCapReduced: false, state: 'BY', tightMarket: null }
const confirmed: Omit<RentIncreaseRequest, 'kind'> = { allStepsEntered: true, residential: true, noThirdPartyFunds: true }
const comparison = (over: Partial<RentIncreaseRequest> = {}): RentIncreaseRequest =>
  ({ kind: 'comparison', ...confirmed, comparisonCentsPerM2: 1000, ...over })

function plan(request: RentIncreaseRequest, tenancy: TenancyPart = tenancyOf(), today = '2026-11-20', more: Partial<RentIncreaseInput> = {}): RentIncreasePlan {
  return planRentIncrease({ today, tenancy, unit, property, request, ...more })
}

const said = (p: RentIncreasePlan, pattern: RegExp): boolean => p.reasons.some((r) => pattern.test(r))

// ---------- Fristen ----------

test('Mieterhöhung: Zugang 20.11.2026 → Zustimmung bis 31.01.2027, wirksam 01.02.2027, Klage bis 30.04.2027 (Recherche 3.2)', () => {
  const p = plan(comparison({ receivedOn: '2026-11-20' }))
  assert.equal(p.state, 'possible', p.reasons.join(' '))
  assert.equal(p.effectiveFrom, '2027-02')
  assert.deepEqual(p.consent, { consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitFrom: '2027-02-02', suitEnd: '2027-04-30' })
  assert.equal(p.cap?.capDate, '2024-02-01')
  assert.ok(said(p, /§ 558b Abs\. 1 und 2 BGB/), 'die Fristen nennen ihre Norm')
})

test('Mieterhöhung: Zugang am 01.11.2026 oder am 30.11.2026 ergibt dieselben Fristen', () => {
  const a = plan(comparison({ receivedOn: '2026-11-02' }))
  const b = plan(comparison({ receivedOn: '2026-11-30' }))
  assert.deepEqual(a.consent, b.consent)
  assert.equal(a.effectiveFrom, b.effectiveFrom)
})

test('Mieterhöhung: § 193 BGB verlängert nur den Beginn der Klage, nicht das Ende der Klagefrist (O2), mit Feiertagen des Landes', () => {
  // Zugang im Oktober 2026: Zustimmung bis 31.12.2026 (Donnerstag); im Land ohne Feiertag am 31.12. bleibt es dabei.
  const oct = plan(comparison({ receivedOn: '2026-10-20' }))
  assert.equal(oct.consent?.consentEnd, '2026-12-31')
  assert.equal(oct.consent?.consentEndOnWorkday, '2026-12-31')
  assert.equal(oct.consent?.suitEnd, '2027-03-31')
  // Ein Feiertag am Ende: Zugang im August 2028 → 31.10.2028 (Dienstag), Reformationstag in Sachsen, in Bayern nicht.
  const at = (state: 'SN' | 'BY') => planRentIncrease({ today: '2028-08-20', tenancy: tenancyOf(), unit, property: { ...property, state }, request: comparison({ receivedOn: '2028-08-20' }) })
  const sn = at('SN')
  assert.equal(sn.consent?.consentEnd, '2028-10-31')
  assert.equal(sn.consent?.consentEndOnWorkday, '2028-11-01')
  assert.equal(sn.consent?.suitFrom, '2028-11-02')
  assert.equal(sn.consent?.suitEnd, '2029-01-31', 'aus dem nicht verschobenen Ende')
  assert.equal(at('BY').consent?.consentEndOnWorkday, '2028-10-31')
})

test('Mieterhöhung: Mietbeginn 15.11.2025 → frühestens wirksam 01.03.2027, Zugang frühestens im Dezember 2026 (M1)', () => {
  const t = tenancyOf({ start: '2025-11-15', baseRents: [{ from: '2025-11', monthlyCents: 50000 }] })
  const now = plan(comparison(), t)
  assert.equal(now.state, 'notYet', now.reasons.join(' '))
  assert.equal(now.earliestEffectiveFrom, '2027-03')
  assert.equal(now.earliestReceivedOn, '2026-12-02', 'nie am Monatsersten (G3)')
  assert.equal(now.currentSince, '2025-11-15')
  assert.ok(said(now, /15 Monaten/))
  const later = plan(comparison({ receivedOn: '2026-12-02' }), t)
  assert.equal(later.state, 'possible', later.reasons.join(' '))
  assert.equal(later.effectiveFrom, '2027-03')
})

test('Mieterhöhung: Stufe am Monatsersten, Sperrfrist und Wartefrist getrennt (R1, R2)', () => {
  const t = tenancyOf({ baseRents: [{ from: '2020-01', monthlyCents: 50000 }, { from: '2025-11', monthlyCents: 52000, reason: 'comparison' }] })
  const p = plan(comparison(), t, '2026-10-05')
  assert.equal(p.currentSince, '2025-11-01')
  assert.equal(p.earliestReceivedOn, '2026-11-02')
  assert.equal(p.earliestEffectiveFrom, '2027-02')
  assert.equal(p.state, 'notYet')
  assert.equal(p.receivedOn, '2026-10-05', 'Vorgabe ist heute')
  assert.equal(p.effectiveFrom, '2027-02', 'die Vorgabe des Wirksamwerdens ist frühestmöglich')
})

test('Mieterhöhung: Vorgabe des Zugangs nie am Monatsersten, ein eingegebener Zugang am Ersten mit Hinweis (K1)', () => {
  const p = plan(comparison(), tenancyOf(), '2026-12-01')
  assert.equal(p.receivedOn, '2026-12-02')
  const given = plan(comparison({ receivedOn: '2026-12-01' }), tenancyOf(), '2026-11-20')
  assert.equal(given.receivedOn, '2026-12-01')
  assert.ok(given.warnings.some((w) => /Monatsersten/.test(w)))
})

test('Mieterhöhung: Sperrfrist am 29. Februar endet nach § 188 Abs. 3 BGB mit dem Monatsletzten', () => {
  // Wirksam am 29.02.2024 kann es mit einer Stufe nicht geben; mit dem Mietbeginn schon.
  const t = tenancyOf({ start: '2024-02-29', baseRents: [{ from: '2024-02', monthlyCents: 50000 }], rentKind: 'index' })
  const p = planRentIncrease({ today: '2025-01-10', tenancy: t, unit, property, request: { kind: 'index', ...confirmed } })
  assert.equal(p.earliestReceivedOn, '2025-03-02', 'ein Jahr ab 29.02.2024 endet am 28.02.2025, Zugang ab 01.03., nie am Ersten')
})

test('Mieterhöhung: ein späterer Wirksamkeitsmonat ist erlaubt, ein früherer als nach § 558b nicht (VIII ZR 280/12)', () => {
  const later = plan(comparison({ receivedOn: '2026-11-20', effectiveFrom: '2027-05' }))
  assert.equal(later.state, 'possible')
  assert.equal(later.effectiveFrom, '2027-05')
  assert.equal(later.cap?.capDate, '2024-05-01')
  const early = plan(comparison({ receivedOn: '2026-11-20', effectiveFrom: '2027-01' }))
  assert.equal(early.state, 'notYet')
  assert.ok(said(early, /Februar 2027/))
})

// ---------- Kappungsgrenze und Höchstbetrag ----------

test('Mieterhöhung: BGH VIII ZR 177/03, 272,31 € × 1,2 = 326,77 € (Kappungsgrenze, abgerundet)', () => {
  const t = tenancyOf({ start: '2000-01-01', baseRents: [{ from: '2000-01', monthlyCents: 27231 }] })
  const p = plan(comparison({ receivedOn: '2026-11-20', comparisonCentsPerM2: 2000, rentCap: 'no' }), t)
  assert.equal(p.cap?.percent, 20)
  assert.equal(p.cap?.baseCents, 27231)
  assert.equal(p.cap?.limitCents, 32677)
  assert.equal(p.comparison?.limitCents, 120000)
  assert.equal(p.maxCents, 32677)
  assert.equal(p.newCents, 32677)
  const reduced = plan(comparison({ receivedOn: '2026-11-20', comparisonCentsPerM2: 2000, rentCap: 'yes' }), t)
  assert.equal(reduced.cap?.percent, 15)
  assert.equal(reduced.cap?.limitCents, 31315, '27231 × 1,15 = 31315,65, abgerundet')
})

test('Mieterhöhung: Kappungsgrenze 15 % bei „weiß nicht“ und ohne Angabe am Objekt (R12)', () => {
  const unknown = plan(comparison({ receivedOn: '2026-11-20', rentCap: 'unknown' }))
  assert.equal(unknown.cap?.reduced, true)
  const fromProperty = planRentIncrease({ today: '2026-11-20', tenancy: tenancyOf(), unit, property: { ...property, rentCapReduced: null }, request: comparison({ receivedOn: '2026-11-20' }) })
  assert.equal(fromProperty.cap?.reduced, true)
  const no = plan(comparison({ receivedOn: '2026-11-20' }))
  assert.equal(no.cap?.reduced, false, 'das Objekt sagt „nein“')
})

test('Mieterhöhung: Ausgangsmiete ist die Miete am Stichtag; eine Erhöhung danach steckt nicht darin', () => {
  const t = tenancyOf({ start: '2015-01-01', baseRents: [{ from: '2015-01', monthlyCents: 40000 }, { from: '2024-02', monthlyCents: 44000 }, { from: '2024-06', monthlyCents: 46000, reason: 'modernization' }] })
  const p = plan(comparison({ receivedOn: '2026-11-20', comparisonCentsPerM2: 2000, rentCap: 'no' }), t)
  assert.equal(p.cap?.capDate, '2024-02-01')
  assert.equal(p.cap?.baseCents, 44000, 'die Stufe ab Februar 2024 gilt am Stichtag')
  assert.equal(p.cap?.modernizationCents, 2000)
  assert.equal(p.cap?.limitCents, 44000 * 1.2 + 2000)
  assert.equal(p.currentCents, 46000)
})

test('Mieterhöhung: eine Modernisierung im Monat des Stichtags steckt in der Ausgangsmiete und kommt nicht hinzu (S3)', () => {
  const t = tenancyOf({ start: '2015-01-01', baseRents: [{ from: '2015-01', monthlyCents: 40000 }, { from: '2024-02', monthlyCents: 44000, reason: 'modernization' }] })
  const p = plan(comparison({ receivedOn: '2026-11-20', comparisonCentsPerM2: 2000, rentCap: 'no' }), t)
  assert.equal(p.cap?.baseCents, 44000)
  assert.equal(p.cap?.modernizationCents, 0)
  assert.equal(p.cap?.limitCents, 52800)
  assert.equal(p.currentSince, '2015-01-01', 'die Modernisierung zählt nicht für die Fristen')
})

test('Mieterhöhung: Staffel beginnt nach dem Stichtag, Mietverhältnis früher → gesperrt bis zur Miete am Stichtag (M3)', () => {
  const t = tenancyOf({ start: '2015-01-01', baseRents: [{ from: '2025-01', monthlyCents: 50000 }] })
  const p = plan(comparison({ receivedOn: '2026-11-20' }), t)
  assert.equal(p.state, 'blocked')
  assert.ok(p.needs.includes('rentAtCapDate'))
  assert.ok(said(p, /01\.02\.2024/), 'der Satz nennt den Stichtag')
  assert.equal(p.maxCents, null, 'kein Betrag ohne Ausgangsmiete')
  const entered = plan(comparison({ receivedOn: '2026-11-20', rentAtCapDateCents: 48000, rentCap: 'no' }), t)
  assert.equal(entered.state, 'possible', entered.reasons.join(' '))
  assert.equal(entered.cap?.baseSource, 'entered')
  assert.equal(entered.cap?.limitCents, 57600)
})

test('Mieterhöhung: die Miete am Stichtag trägt ihren Tag; ändert sich der Stichtag, sperrt die Rechnung mit Satz (Durchsicht K1)', () => {
  const t = tenancyOf({ start: '2015-01-01', baseRents: [{ from: '2025-01', monthlyCents: 50000 }] })
  const asked = plan(comparison({ receivedOn: '2026-11-20' }), t)
  assert.equal(asked.capBaseDay, '2024-02-01', 'der Tag, zu dem die Miete gefragt ist')
  const fits = plan(comparison({ receivedOn: '2026-11-20', rentAtCapDateCents: 48000, rentAtCapDateOn: '2024-02-01', rentCap: 'no' }), t)
  assert.equal(fits.state, 'possible', fits.reasons.join(' '))
  assert.equal(fits.cap?.limitCents, 57600)
  const moved = plan(comparison({ receivedOn: '2026-11-20', effectiveFrom: '2027-05', rentAtCapDateCents: 48000, rentAtCapDateOn: '2024-02-01', rentCap: 'no' }), t)
  assert.equal(moved.state, 'blocked')
  assert.equal(moved.capBaseDay, '2024-05-01')
  assert.ok(moved.needs.includes('rentAtCapDate'))
  assert.equal(moved.cap, null, 'nicht mit der Miete eines anderen Tages gerechnet')
  assert.ok(said(moved, /01\.02\.2024.*01\.05\.2024/), moved.reasons.join(' '))
})

test('Mieterhöhung: jüngeres Mietverhältnis, Staffel im Monat des Mietbeginns → Anfangsmiete (G1); sonst gesperrt', () => {
  const young = tenancyOf({ start: '2024-06-10', baseRents: [{ from: '2024-06', monthlyCents: 50000 }] })
  const p = plan(comparison({ receivedOn: '2026-11-20', rentCap: 'no' }), young)
  assert.equal(p.cap?.baseDay, '2024-06-10')
  assert.equal(p.cap?.baseCents, 50000)
  const late = tenancyOf({ start: '2024-06-10', baseRents: [{ from: '2024-08', monthlyCents: 50000 }] })
  const q = plan(comparison({ receivedOn: '2026-11-20' }), late)
  assert.equal(q.state, 'blocked')
  assert.ok(q.needs.includes('rentAtCapDate'))
  assert.ok(said(q, /Mietbeginn/))
})

test('Mieterhöhung: Höchstbetrag ist das Kleinere aus Vergleichsmiete × Fläche und Kappungsgrenze (R5)', () => {
  const p = plan(comparison({ receivedOn: '2026-11-20', comparisonCentsPerM2: 905, areaM2: 61.5, rentCap: 'no' }))
  assert.equal(p.comparison?.limitCents, 55657, '9,05 € × 61,5 m² = 556,575 €, abgerundet')
  assert.equal(p.cap?.limitCents, 60000)
  assert.equal(p.maxCents, 55657)
  assert.ok(p.warnings.some((w) => /61,5/.test(w) && /60/.test(w)), 'Fläche abweichend von der Wohnung')
})

test('Mieterhöhung: gewünschte Miete über dem Höchstbetrag ist nicht möglich, darunter wird sie verlangt', () => {
  const over = plan(comparison({ receivedOn: '2026-11-20', requestedCents: 60001, rentCap: 'no' }))
  assert.equal(over.state, 'blocked')
  assert.equal(over.newCents, null)
  const under = plan(comparison({ receivedOn: '2026-11-20', requestedCents: 55000, rentCap: 'no' }))
  assert.equal(under.state, 'possible')
  assert.equal(under.newCents, 55000)
  const none = plan(comparison({ receivedOn: '2026-11-20', requestedCents: 50000 }))
  assert.equal(none.state, 'blocked', 'keine Erhöhung')
})

test('Mieterhöhung: über dem Oberwert der Spanne eine Warnung (R7)', () => {
  const p = plan(comparison({ receivedOn: '2026-11-20', comparisonCentsPerM2: 1000, rangeLowCentsPerM2: 800, rangeHighCentsPerM2: 950, rentCap: 'no' }))
  assert.ok(p.warnings.some((w) => /Oberwert/.test(w)))
})

test('Mieterhöhung: Inklusivmiete, Höchstbetrag = Vergleichsmiete × Fläche + Betriebskostenanteil (S1, R8)', () => {
  const t = tenancyOf({ costModel: 'inclusive' })
  const missing = plan(comparison({ receivedOn: '2026-11-20' }), t)
  assert.equal(missing.state, 'blocked')
  assert.ok(missing.needs.includes('operatingCosts'))
  const p = plan(comparison({ receivedOn: '2026-11-20', comparisonCentsPerM2: 800, operatingCostsCents: 9000, rentCap: 'no' }), t)
  assert.equal(p.comparison?.limitCents, 48000 + 9000)
  assert.equal(p.maxCents, 57000)
  const warm = plan(comparison({ receivedOn: '2026-11-20' }), tenancyOf({ heatingModel: 'inclusive' }))
  assert.ok(warm.needs.includes('operatingCosts'), 'auch nur warm inklusiv')
  const flat = plan(comparison({ receivedOn: '2026-11-20' }), tenancyOf({ costModel: 'flatRate' }))
  assert.ok(!flat.needs.includes('operatingCosts'), 'Pauschale steht in eigener Staffel')
})

// ---------- Sperren ----------

test('Mieterhöhung: ohne Mietart, Ausschluss-Antwort und Bestätigungen gesperrt (R13, R14, M2)', () => {
  const noKind = plan(comparison({ receivedOn: '2026-11-20' }), tenancyOf({ rentKind: null }))
  assert.equal(noKind.state, 'blocked')
  assert.ok(noKind.needs.includes('rentKind'))
  const noAnswer = plan(comparison({ receivedOn: '2026-11-20' }), tenancyOf({ rentIncreaseExcluded: undefined }))
  assert.ok(noAnswer.needs.includes('exclusion'))
  const excluded = plan(comparison({ receivedOn: '2026-11-20' }), tenancyOf({ rentIncreaseExcluded: true }))
  assert.equal(excluded.state, 'blocked')
  assert.ok(said(excluded, /§ 557 Abs\. 3 BGB/))
  const unconfirmed = plan({ kind: 'comparison', comparisonCentsPerM2: 1000, receivedOn: '2026-11-20' })
  assert.deepEqual([...unconfirmed.needs].sort(), ['allStepsEntered', 'residential', 'thirdPartyFunds'])
  const noRents = plan(comparison(), tenancyOf({ baseRents: [] }))
  assert.ok(noRents.needs.includes('baseRents'))
  const garage = planRentIncrease({ today: '2026-11-20', tenancy: tenancyOf(), unit: { areaM2: 0 }, property, request: comparison({ receivedOn: '2026-11-20' }) })
  assert.equal(garage.state, 'blocked')
  assert.ok(said(garage, /Wohnfläche/))
})

test('Mieterhöhung: Indexmiete schließt § 558 aus, Vergleichsmiete schließt eine Indexerklärung aus (R3)', () => {
  const p = plan(comparison({ receivedOn: '2026-11-20' }), tenancyOf({ rentKind: 'index' }))
  assert.equal(p.state, 'blocked')
  assert.ok(said(p, /§ 557b Abs\. 2 Satz 3 BGB/))
  const q = plan({ kind: 'index', ...confirmed }, tenancyOf())
  assert.equal(q.state, 'blocked')
})

test('Mieterhöhung: Staffelmiete bis zur letzten Stufe ausgeschlossen, danach Wartefrist ab der letzten Stufe (§ 557a)', () => {
  const t = tenancyOf({
    rentKind: 'staggered',
    baseRents: [{ from: '2024-01', monthlyCents: 50000, reason: 'agreement' }, { from: '2025-01', monthlyCents: 52000, reason: 'staggered' }, { from: '2027-01', monthlyCents: 54000, reason: 'staggered' }],
    start: '2024-01-01',
  })
  const p = plan(comparison(), t)
  assert.equal(p.state, 'notYet')
  assert.ok(said(p, /§ 557a Abs\. 2 Satz 2 BGB/))
  assert.equal(p.earliestEffectiveFrom, '2028-04')
  assert.equal(p.staggered?.nextFrom, '2027-01')
  assert.equal(p.staggered?.lastFrom, '2027-01')
  const short = tenancyOf({ rentKind: 'staggered', start: '2024-01-01', baseRents: [{ from: '2024-01', monthlyCents: 50000 }, { from: '2024-09', monthlyCents: 52000, reason: 'staggered' }] })
  assert.ok(plan(comparison(), short).staggered?.notes.some((n) => /ein Jahr|12 Monate/.test(n)))
})

test('Mieterhöhung: eine schon eingetragene Stufe ab dem Monat des Wirksamwerdens oder danach sperrt (Durchsicht S2)', () => {
  const t = tenancyOf({ baseRents: [{ from: '2020-01', monthlyCents: 50000 }, { from: '2027-03', monthlyCents: 55000, reason: 'modernization' }] })
  const p = plan(comparison({ receivedOn: '2026-11-20', effectiveFrom: '2027-02', rentCap: 'no' }), t)
  assert.equal(p.state, 'blocked', p.reasons.join(' '))
  assert.ok(said(p, /In der Kaltmiete-Staffel steht schon eine Stufe ab März 2027\. Eine Erhöhung ab Februar 2027 ist so nicht möglich/), p.reasons.join(' '))
  const index = indexTenancy([{ from: '2015-01', monthlyCents: 68500, index: { month: '2014-12', value: 94.2, base: 2020 } }, { from: '2027-01', monthlyCents: 69000, reason: 'modernization' }])
  const q = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', toIndex: { month: '2026-10', value: 106.1, base: 2020 } }, index)
  assert.equal(q.state, 'blocked')
  assert.ok(said(q, /schon eine Stufe ab Januar 2027/), q.reasons.join(' '))
})

test('Mieterhöhung: Ende des Mietverhältnisses vor dem Wirksamwerden sperrt', () => {
  const p = plan(comparison({ receivedOn: '2026-11-20' }), tenancyOf({ end: '2027-01-31' }))
  assert.equal(p.state, 'blocked')
})

// ---------- Indexmiete ----------

const indexTenancy = (rents: RentEntry[], start = '2015-01-01'): TenancyPart => tenancyOf({ rentKind: 'index', start, baseRents: rents })

test('Mieterhöhung: BGH VIII ZR 291/16, 685 € × 106,1 / 94,2 = 771,53 € (abgerundet, R9, R11)', () => {
  const t = indexTenancy([{ from: '2015-01', monthlyCents: 68500, reason: 'agreement', index: { month: '2014-12', value: 94.2, base: 2020 } }])
  const p = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', toIndex: { month: '2026-10', value: 106.1, base: 2020 } }, t)
  assert.equal(p.state, 'possible', p.reasons.join(' '))
  assert.equal(p.newCents, 77153)
  assert.equal(p.effectiveFrom, '2027-01', 'übernächster Monat nach Zugang')
  assert.deepEqual(p.index?.from, { month: '2014-12', value: 94.2, base: 2020 })
  assert.equal(p.consent, null)
})

test('Mieterhöhung: Indexwerte einer anderen Basis sperren, beide Werte aus der aktuellen Reihe (M5)', () => {
  const t = indexTenancy([{ from: '2015-01', monthlyCents: 68500, index: { month: '2014-12', value: 106.6, base: 2015 } }])
  const p = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', toIndex: { month: '2026-10', value: 123.4, base: 2020 } }, t)
  assert.equal(p.state, 'blocked')
  assert.ok(said(p, /Dezember 2014/) && said(p, /Basis 2020/), p.reasons.join(' '))
  assert.equal(p.newCents, null)
  const reread = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', fromIndex: { month: '2014-12', value: 94.2, base: 2020 }, toIndex: { month: '2026-10', value: 106.1, base: 2020 } }, t)
  assert.equal(reread.newCents, 77153)
})

test('Mieterhöhung: Indexmiete, Zugang erst ein Jahr nach der letzten Anpassung, Mietbeginn tagesgenau (M1, M4)', () => {
  const t = indexTenancy([{ from: '2026-03', monthlyCents: 60000, index: { month: '2026-01', value: 120, base: 2020 } }], '2026-03-15')
  const p = plan({ kind: 'index', ...confirmed, toIndex: { month: '2027-01', value: 123, base: 2020 } }, t, '2027-02-10')
  assert.equal(p.earliestReceivedOn, '2027-03-16', 'ein Tag Aufschlag wie beim Monatsersten (§ 187 Abs. 1 oder 2 BGB)')
  assert.equal(p.earliestEffectiveFrom, '2027-05')
  assert.equal(p.state, 'notYet')
})

test('Mieterhöhung: Indexmiete, Mietbeginn mitten im Monat → Zugang frühestens am Tag nach dem Jahrestag (Durchsicht S1)', () => {
  // Wie beim Ersten (Zugang am Zweiten) ein Tag Aufschlag: Ob die Frist nach § 187 Abs. 1 oder Abs. 2 BGB läuft, bleibt
  // offen, der spätere Tag ist in beiden Lesarten sicher.
  const t = indexTenancy([{ from: '2025-11', monthlyCents: 50000, index: { month: '2025-08', value: 120, base: 2020 } }], '2025-11-15')
  const p = plan({ kind: 'index', ...confirmed, toIndex: { month: '2026-10', value: 123, base: 2020 } }, t)
  assert.equal(p.earliestReceivedOn, '2026-11-16')
  assert.equal(p.earliestEffectiveFrom, '2027-01')
  const onDay = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-15', toIndex: { month: '2026-10', value: 123, base: 2020 } }, t)
  assert.equal(onDay.state, 'notYet', 'am Jahrestag selbst noch zu früh')
  const next = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-16', toIndex: { month: '2026-10', value: 123, base: 2020 } }, t)
  assert.equal(next.state, 'possible', next.reasons.join(' '))
  // Am Ersten wie bisher der Zweite, also einheitlich ein Tag nach dem Ende der Frist.
  const first = indexTenancy([{ from: '2025-11', monthlyCents: 50000, index: { month: '2025-08', value: 120, base: 2020 } }], '2025-11-01')
  assert.equal(plan({ kind: 'index', ...confirmed }, first).earliestReceivedOn, '2026-11-02')
  // Endet die Frist am Monatsletzten, wäre der Tag danach ein Erster; vorgeschlagen wird der Zweite (G3).
  const last = indexTenancy([{ from: '2025-04', monthlyCents: 50000, index: { month: '2025-01', value: 120, base: 2020 } }], '2025-04-30')
  assert.equal(plan({ kind: 'index', ...confirmed }, last, '2026-01-10').earliestReceivedOn, '2026-05-02')
})

test('Mieterhöhung: Vergleichsmiete, die Jahressperrfrist rechnet einheitlich mit, die Wartefrist liegt bei Mietbeginn im Monat dahinter (Durchsicht S1)', () => {
  // Sperrfrist ab 15.11.2025 endet am 15.11.2026, Zugang danach ab 16.11.; die Wartefrist (wirksam 01.03.2027) verlangt
  // ohnehin einen Zugang im Dezember. Am Ersten wie bisher der Zweite.
  const mid = plan(comparison(), tenancyOf({ start: '2025-11-15', baseRents: [{ from: '2025-11', monthlyCents: 50000 }] }))
  assert.equal(mid.earliestReceivedOn, '2026-12-02')
  const first = plan(comparison(), tenancyOf({ start: '2025-11-01', baseRents: [{ from: '2025-11', monthlyCents: 50000 }] }))
  assert.equal(first.earliestReceivedOn, '2026-11-02')
  assert.equal(first.earliestEffectiveFrom, '2027-02')
})

test('Mieterhöhung: ein eingegebener Ausgangsindex, der vom Wert oder der Basis der Stufe abweicht, wird gewarnt (Durchsicht K2)', () => {
  const t = indexTenancy([{ from: '2015-01', monthlyCents: 68500, index: { month: '2014-12', value: 94.2, base: 2020 } }])
  const ask = (fromIndex: RentIncreaseRequest['fromIndex']) => plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', fromIndex, toIndex: { month: '2026-10', value: 106.1, base: 2020 } }, t)
  const differs = (p: RentIncreasePlan) => p.warnings.some((w) => /Ausgangsindex/.test(w))
  assert.ok(!differs(ask({ month: '2014-12', value: 94.2, base: 2020 })), 'gleich: keine Warnung')
  const value = ask({ month: '2014-12', value: 94.5, base: 2020 })
  assert.ok(differs(value), value.warnings.join(' '))
  assert.ok(value.warnings.some((w) => /94,5/.test(w) && /94,2/.test(w)), 'nennt beide Werte')
  const base = indexTenancy([{ from: '2015-01', monthlyCents: 68500, index: { month: '2014-12', value: 106.6, base: 2015 } }])
  const rebased = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', fromIndex: { month: '2014-12', value: 94.2, base: 2020 }, toIndex: { month: '2026-10', value: 106.1, base: 2020 } }, base)
  assert.ok(rebased.warnings.some((w) => /Basis 2015/.test(w) && /Basis 2020/.test(w)), rebased.warnings.join(' '))
})

test('Mieterhöhung: der Plan nennt den Tag des Servers, an dem er gerechnet ist (Durchsicht S4)', () => {
  assert.equal(plan(comparison(), tenancyOf(), '2026-11-20').today, '2026-11-20')
})

test('Mieterhöhung: Indexwert des Zugangsmonats kann noch nicht veröffentlicht sein; Senkung wird gerechnet und gewarnt', () => {
  const t = indexTenancy([{ from: '2015-01', monthlyCents: 68500, index: { month: '2014-12', value: 94.2, base: 2020 } }])
  const unpublished = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', toIndex: { month: '2026-11', value: 106.1, base: 2020 } }, t)
  assert.equal(unpublished.state, 'blocked')
  const down = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', toIndex: { month: '2026-10', value: 90, base: 2020 } }, t)
  assert.equal(down.newCents, Math.floor((68500 * 900) / 942))
  assert.ok(down.warnings.some((w) => /gesunken/.test(w)))
  const missing = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20' }, t)
  assert.ok(missing.needs.includes('toIndex'))
})

test('Mieterhöhung: Indexanpassung nach einer Modernisierungsstufe rechnet Mietfuchs nicht (offen)', () => {
  const t = indexTenancy([
    { from: '2015-01', monthlyCents: 68500, index: { month: '2014-12', value: 94.2, base: 2020 } },
    { from: '2020-01', monthlyCents: 70000, reason: 'modernization' },
  ])
  const p = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', toIndex: { month: '2026-10', value: 106.1, base: 2020 } }, t)
  assert.equal(p.state, 'blocked')
  assert.ok(said(p, /Modernisierung/))
})

// ---------- Register ----------

test('Mieterhöhung: die Rechnung protokolliert die Rechtswerte, mit denen sie rechnet', () => {
  const p = plan(comparison({ receivedOn: '2026-11-20' }))
  const ids = p.legalValues.map((v) => v.id).sort()
  for (const id of ['bgb.rent-cap', 'bgb.rent-increase-consent', 'bgb.rent-increase-lock-months', 'bgb.rent-increase-wait-months', 'practice.rent-increase-rounding']) assert.ok(ids.includes(id), id)
})

// ---------- Cockpit ----------

test('Mieterhöhung: nächste Ereignisse für das Cockpit (nächste Stufe, frühester Zugang, Fristen offener Verlangen)', () => {
  const t = tenancyOf({ rentKind: 'staggered', start: '2024-01-01', baseRents: [{ from: '2024-01', monthlyCents: 50000 }, { from: '2027-01', monthlyCents: 52000, reason: 'staggered' }] })
  const e = nextRentEvents({ today: '2026-11-20', tenancy: t, state: 'BY', increases: [] })
  assert.deepEqual(e.nextStep, { from: '2027-01', cents: 52000 })
  assert.equal(e.earliest?.kind, 'comparison')
  assert.equal(e.earliest?.effectiveFrom, '2028-04')
  const open = nextRentEvents({
    today: '2026-11-20', tenancy: tenancyOf(), state: 'BY',
    increases: [{ id: 'r1', kind: 'comparison', receivedOn: '2026-11-20', status: 'sent' }],
  })
  assert.deepEqual(open.open, [{ id: 'r1', consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitFrom: '2027-02-02', suitEnd: '2027-04-30' }])
  assert.equal(nextRentEvents({ today: '2026-11-20', tenancy: tenancyOf({ rentKind: null }), state: null, increases: [] }).earliest, null)
})

// ---------- Invarianten ----------

// Zufallszahlen mit festem Startwert (mulberry32), damit ein roter Lauf wiederholbar ist.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
const pad = (n: number): string => String(n).padStart(2, '0')
const monthAdd = (m: string, n: number): string => {
  const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`
}
// Ein Tag `n` Monate nach `day` mit gleicher Zahl; fehlt er im Zielmonat, der Monatsletzte (§ 188 Abs. 2, 3 BGB).
const periodEnd = (day: string, n: number): string => {
  const month = monthAdd(day.slice(0, 7), n)
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  return `${month}-${pad(Math.min(Number(day.slice(8, 10)), last))}`
}
const REASONS = ['agreement', 'comparison', 'modernization', undefined] as const

function randomTenancy(random: () => number): TenancyPart {
  const startMonth = `${2012 + Math.floor(random() * 13)}-${pad(1 + Math.floor(random() * 12))}`
  const start = `${startMonth}-${pad(1 + Math.floor(random() * 28))}`
  const rents: RentEntry[] = []
  let month = random() < 0.85 ? startMonth : monthAdd(startMonth, 1 + Math.floor(random() * 30))
  let cents = 30000 + Math.floor(random() * 70000)
  const steps = 1 + Math.floor(random() * 5)
  for (let i = 0; i < steps && month <= '2026-10'; i++) {
    const reason = i === 0 ? undefined : pick(random, REASONS)
    rents.push({ from: month, monthlyCents: cents, ...(reason ? { reason } : {}) })
    month = monthAdd(month, 3 + Math.floor(random() * 30))
    cents += Math.floor(random() * 8000)
  }
  return tenancyOf({ start, baseRents: rents, costModel: random() < 0.2 ? 'inclusive' : 'settlement' })
}
function randomRequest(random: () => number, t: TenancyPart): RentIncreaseRequest {
  return comparison({
    receivedOn: `2026-${pad(1 + Math.floor(random() * 12))}-${pad(2 + Math.floor(random() * 26))}`,
    comparisonCentsPerM2: 500 + Math.floor(random() * 1500),
    areaM2: Math.round((30 + random() * 90) * 100) / 100,
    rentCap: pick(random, ['yes', 'no', 'unknown'] as const),
    rentAtCapDateCents: random() < 0.5 ? 25000 + Math.floor(random() * 50000) : null,
    operatingCostsCents: t.costModel === 'inclusive' ? Math.floor(random() * 20000) : null,
  })
}

test('Invariante: Höchstbetrag ≤ Kappungsgrenze und ≤ Vergleichsmiete × Fläche (+ Anteil); frühester Zugang nie vor der Sperrfrist', () => {
  const random = rng(191)
  let computed = 0
  for (let n = 0; n < 1500; n++) {
    const t = randomTenancy(random)
    const request = randomRequest(random, t)
    const p = plan(request, t, '2026-01-15')
    const where = JSON.stringify({ t, request })
    if (p.maxCents !== null) {
      computed++
      assert.ok(p.cap && p.maxCents <= p.cap.limitCents, where)
      assert.ok(p.comparison && p.maxCents <= p.comparison.limitCents, where)
      const area = request.areaM2 ?? unit.areaM2
      assert.ok(p.maxCents <= (request.comparisonCentsPerM2 ?? 0) * area + (request.operatingCostsCents ?? 0) + 1e-6, where)
      if (p.newCents !== null) assert.ok(p.newCents <= p.maxCents, where)
    }
    if (p.earliestReceivedOn !== null && p.currentSince !== null && p.earliestEffectiveFrom !== null) {
      // Unabhängig nachgerechnet (Durchsicht S3): Sperrfrist zwölf Monate, Zugang erst nach ihrem Ende; Wartefrist 15 Monate
      // bis zum Ersten des Wirksamwerdens; die erhöhte Miete ist ab dem dritten Monat nach Zugang geschuldet (§ 558b Abs. 1
      // BGB) und nie vor dem Ende der Wartefrist (Gegenprüfung M1).
      assert.ok(p.earliestReceivedOn > periodEnd(p.currentSince, 12), where)
      assert.ok(`${p.earliestEffectiveFrom}-01` >= periodEnd(p.currentSince, 15), where)
      assert.ok(monthAdd(p.earliestReceivedOn.slice(0, 7), 3) >= p.earliestEffectiveFrom, where)
      assert.ok(!p.earliestReceivedOn.endsWith('-01'), where)
      // Die letzte zählende Änderung liegt nie nach dem Bezugstag.
      for (const r of t.baseRents) if (r.reason !== 'modernization') assert.ok(`${r.from}-01` <= p.currentSince || r.from === p.currentSince.slice(0, 7), where)
    }
    if (p.state === 'possible') {
      assert.ok(p.receivedOn >= (p.earliestReceivedOn ?? ''), where)
      const natural = monthAdd(p.receivedOn.slice(0, 7), 3)
      assert.ok(p.effectiveFrom !== null && p.effectiveFrom >= natural, where)
      assert.ok(p.earliestEffectiveFrom !== null && natural >= p.earliestEffectiveFrom, where)
    }
  }
  assert.ok(computed > 300, `nur ${computed} Fälle mit Betrag`)
})

test('Invariante: eine Stufe der Art Modernisierung verschiebt keine Frist und erhebt die Grenze genau um ihren Betrag', () => {
  const random = rng(5591)
  let checked = 0
  for (let n = 0; n < 2500; n++) {
    const t = randomTenancy(random)
    const last = t.baseRents[t.baseRents.length - 1]
    if (!last) continue
    const month = monthAdd(last.from, 1 + Math.floor(random() * 6))
    if (month > '2026-10') continue
    const amount = 1 + Math.floor(random() * 5000)
    const withMod = { ...t, baseRents: [...t.baseRents, { from: month, monthlyCents: last.monthlyCents + amount, reason: 'modernization' as const }] }
    const request = { ...randomRequest(random, t), effectiveFrom: '2028-06', receivedOn: '2027-11-10' }
    const a = plan(request, t, '2026-01-15')
    const b = plan(request, withMod, '2026-01-15')
    const where = JSON.stringify({ t, month, amount, request })
    assert.equal(b.earliestReceivedOn, a.earliestReceivedOn, where)
    assert.equal(b.earliestEffectiveFrom, a.earliestEffectiveFrom, where)
    // Liegt die Stufe nach dem Tag der Ausgangsmiete, kommt ihr Betrag genau hinzu; davor steckt sie in der Ausgangsmiete.
    if (a.cap && b.cap && month > a.cap.baseDay.slice(0, 7)) {
      checked++
      assert.equal(b.cap.limitCents, a.cap.limitCents + amount, where)
    }
  }
  assert.ok(checked > 200, `nur ${checked} Fälle mit Kappungsgrenze`)
  // Im Stichtagsmonat (Durchsicht S3): Die Stufe gilt am Stichtag und steckt in der Ausgangsmiete, ihr Betrag kommt nicht
  // noch einmal hinzu (Gegenprüfung S3). Wirksam 06.2028 → Stichtag 01.06.2025.
  let inMonth = 0
  for (let n = 0; n < 1500; n++) {
    const t = randomTenancy(random)
    const last = t.baseRents[t.baseRents.length - 1]
    if (!last || last.from >= '2025-06' || t.start > '2025-06-01') continue
    const amount = 1 + Math.floor(random() * 5000)
    const withMod = { ...t, baseRents: [...t.baseRents, { from: '2025-06', monthlyCents: last.monthlyCents + amount, reason: 'modernization' as const }] }
    const request = { ...randomRequest(random, t), effectiveFrom: '2028-06', receivedOn: '2027-11-10' }
    const a = plan(request, t, '2026-01-15')
    const b = plan(request, withMod, '2026-01-15')
    const where = JSON.stringify({ t, amount, request })
    if (!a.cap || !b.cap || a.cap.baseSource !== 'schedule') continue
    inMonth++
    assert.equal(b.cap.capDate, '2025-06-01', where)
    assert.equal(b.cap.baseCents, a.cap.baseCents + amount, where)
    assert.equal(b.cap.modernizationCents, a.cap.modernizationCents, where)
    assert.equal(b.cap.limitCents, Math.floor(((a.cap.baseCents + amount) * (100 + b.cap.percent)) / 100) + b.cap.modernizationCents, where)
  }
  assert.ok(inMonth > 100, `nur ${inMonth} Fälle im Stichtagsmonat`)
})

test('Invariante: „Vereinbarung“ statt einer anderen Art macht nie etwas früher oder höher (Anti-Ziel 4)', () => {
  const random = rng(2026)
  let checked = 0
  for (let n = 0; n < 1000; n++) {
    const t = randomTenancy(random)
    const all = { ...t, baseRents: t.baseRents.map((r) => ({ ...r, reason: 'agreement' as const })) }
    const request = randomRequest(random, t)
    const where = JSON.stringify({ t, request })
    const a = plan(request, t, '2026-01-15')
    const b = plan(request, all, '2026-01-15')
    if (a.earliestReceivedOn && b.earliestReceivedOn) assert.ok(b.earliestReceivedOn >= a.earliestReceivedOn, where)
    if (a.earliestEffectiveFrom && b.earliestEffectiveFrom) assert.ok(b.earliestEffectiveFrom >= a.earliestEffectiveFrom, where)
    // Bei gleichem Wirksamwerden ist die Grenze nie höher.
    const fixed = { ...request, effectiveFrom: '2028-06', receivedOn: '2027-11-10' }
    const fa = plan(fixed, t, '2026-01-15')
    const fb = plan(fixed, all, '2026-01-15')
    if (fa.maxCents !== null && fb.maxCents !== null) {
      checked++
      assert.ok(fb.maxCents <= fa.maxCents, where)
    }
  }
  assert.ok(checked > 200, `nur ${checked} Fälle mit Betrag`)
})

test('Invariante: eine vorn gekürzte Staffel macht nie einen höheren Betrag möglich (M3)', () => {
  const random = rng(33)
  for (let n = 0; n < 800; n++) {
    const t = randomTenancy(random)
    if (t.baseRents.length < 2) continue
    const trimmed = { ...t, baseRents: t.baseRents.slice(1) }
    const request = { ...randomRequest(random, t), rentAtCapDateCents: null }
    const a = plan(request, t, '2026-01-15')
    const b = plan(request, trimmed, '2026-01-15')
    const where = JSON.stringify({ t, request })
    if (b.maxCents !== null && a.maxCents !== null && b.effectiveFrom === a.effectiveFrom) assert.ok(b.maxCents <= a.maxCents, where)
    if (b.maxCents !== null && a.maxCents === null) assert.fail(`gekürzt rechnet, vollständig nicht: ${where}`)
  }
})

test('Mieterhöhung: Beträge über der Obergrenze sperren, statt mit ungenauen Zahlen zu rechnen (Integrationsdurchsicht K-Geld-2)', () => {
  const huge = plan(comparison({ receivedOn: '2026-11-20', rentCap: 'no', comparisonCentsPerM2: AMOUNT_MAX_CENTS }))
  assert.equal(huge.state, 'blocked', huge.reasons.join(' '))
  assert.equal(huge.newCents, null)
  assert.equal(huge.maxCents, null)
  assert.ok(said(huge, /zu groß/), huge.reasons.join(' '))
  const t = indexTenancy([{ from: '2015-01', monthlyCents: 5_000_000_000, index: { month: '2014-12', value: 0.1, base: 2020 } }])
  const index = plan({ kind: 'index', ...confirmed, receivedOn: '2026-11-20', toIndex: { month: '2026-10', value: 9999.9, base: 2020 } }, t)
  assert.equal(index.state, 'blocked', index.reasons.join(' '))
  assert.equal(index.newCents, null)
  assert.ok(said(index, /zu groß/), index.reasons.join(' '))
})

test('Mieterhöhung: Eingabe eines Betrags über der Obergrenze oder außerhalb der sicheren Ganzzahlen ist ein Fehler mit Satz', () => {
  for (const v of [Number.MAX_SAFE_INTEGER, AMOUNT_MAX_CENTS + 1, 2 ** 60]) {
    const r = rentIncreaseRequestOf({ kind: 'comparison', comparisonCentsPerM2: v })
    assert.ok('error' in r && /\.$/.test(r.error), String(v))
  }
  const ok = rentIncreaseRequestOf({ kind: 'comparison', requestedCents: AMOUNT_MAX_CENTS })
  assert.ok(!('error' in ok))
})

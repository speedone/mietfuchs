// „Demnächst fällig“, Einträge der Mieterhöhung (#191, PR 4; Rest von #190): Staffelstufe, frühester Zugang einer
// Erhöhung, Zustimmungs- und Klagefrist offener Verlangen. Die reine Liste `upcomingDeadlines`, jedes „heute“ hineingereicht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CALENDAR_RULES } from '../../shared/period.ts'
import { upcomingDeadlines, type UpcomingInput, type UpcomingRentIncrease, type UpcomingTenancy } from '../src/upcomingDeadlines.ts'
import { planRentIncrease } from '../src/rentIncrease.ts'
import { dayAfter } from '../../shared/law/register.ts'
import type { PeriodKey, RentEntry, RentIncreaseRequest, UpcomingDeadline } from '../../shared/types.ts'

const TODAY = '2026-11-20' // Fenster bis 2027-02-18

const tenancy = (over: Partial<UpcomingTenancy> = {}): UpcomingTenancy => ({
  id: 't1', unitId: 'u1', tenantName: 'Erika Mustermann', start: '2020-01-01', end: null,
  baseRents: [{ from: '2020-01', monthlyCents: 50000, reason: 'agreement' }], rentKind: 'free', rentIncreaseExcluded: false,
  // Pauschale: keine Abrechnungsfrist, die Liste zeigt nur die Mieterhöhung.
  costModel: 'flatRate', heatingModel: 'flatRate', ...over,
})
const increase = (over: Partial<UpcomingRentIncrease> = {}): UpcomingRentIncrease => ({
  id: 'r1', tenancyId: 't1', kind: 'comparison', status: 'sent', receivedOn: '2026-11-10', effectiveFrom: '2027-02', ...over,
})
const input = (over: Partial<UpcomingInput> = {}): UpcomingInput => ({
  rules: CALENDAR_RULES, tenancies: [tenancy()], costPeriods: new Set<PeriodKey>(), closed: [], meters: [], readings: [], deposits: [],
  units: [{ id: 'u1', name: 'EG links', areaM2: 60 }], state: 'BY', rentIncreases: [], ...over,
})
const of = <K extends UpcomingDeadline['kind']>(input: UpcomingInput, kind: K, today = TODAY) =>
  upcomingDeadlines(input, today).items.filter((i): i is Extract<UpcomingDeadline, { kind: K }> => i.kind === kind)

// ---------- Staffelstufe ----------

const staggered = (over: Partial<UpcomingTenancy> = {}) => tenancy({
  rentKind: 'staggered', start: '2024-01-01',
  baseRents: [
    { from: '2024-01', monthlyCents: 50000, reason: 'agreement' },
    { from: '2025-01', monthlyCents: 52000, reason: 'staggered' },
    { from: '2026-01', monthlyCents: 54000, reason: 'staggered' },
    { from: '2027-01', monthlyCents: 56000, reason: 'staggered' },
  ],
  ...over,
})

test('Staffelstufe: die letzte Stufe im Fenster, mit dem frühesten Verlangen nach § 558 danach', () => {
  assert.deepEqual(of(input({ tenancies: [staggered()] }), 'rentStep'), [{
    kind: 'rentStep', id: 'rentStep:t1:2027-01', date: '2027-01-01', tenancyId: 't1', unitName: 'EG links', tenantName: 'Erika Mustermann',
    fromCents: 54000, cents: 56000, last: true, comparisonFrom: '2028-01-02',
  }])
  // Die Erhöhung nach § 558 liegt über ein Jahr hinter der letzten Stufe, also nicht im Fenster; danach mit dem Hinweis
  // auf die Staffelmiete (Durchsicht K5).
  assert.deepEqual(of(input({ tenancies: [staggered()] }), 'rentIncrease'), [])
  assert.deepEqual(of(input({ tenancies: [staggered()] }), 'rentIncrease', '2028-01-02').map((i) => [i.date, i.staggered]), [['2028-01-02', true]])
})

test('Staffelstufe: „danach § 558 möglich“ nur, wenn der Vertrag Erhöhungen ausdrücklich nicht ausschließt', () => {
  for (const rentIncreaseExcluded of [null, true]) {
    const [step] = of(input({ tenancies: [staggered({ rentIncreaseExcluded })] }), 'rentStep')
    assert.equal(step?.last, true)
    assert.equal(step?.comparisonFrom, null, String(rentIncreaseExcluded))
  }
  // Ohne Wohnfläche (Garage) ebenso nicht.
  const [garage] = of(input({ tenancies: [staggered()], units: [{ id: 'u1', name: 'Garage', areaM2: 0 }] }), 'rentStep')
  assert.equal(garage?.comparisonFrom, null)
})

test('Staffelstufe: eine weitere Stufe folgt, nicht die letzte; Modernisierung danach zählt nicht als Stufe', () => {
  const rents = staggered().baseRents
  const more = staggered({ baseRents: [...rents, { from: '2028-01', monthlyCents: 58000, reason: 'staggered' }] })
  assert.deepEqual(of(input({ tenancies: [more] }), 'rentStep').map((s) => [s.last, s.comparisonFrom]), [[false, null]])
  const modern = staggered({ baseRents: [...rents, { from: '2027-06', monthlyCents: 57000, reason: 'modernization' }] })
  assert.deepEqual(of(input({ tenancies: [modern] }), 'rentStep').map((s) => s.last), [true])
})

test('Staffelstufe: Fenster 90 Tage, Grenzen eingeschlossen; nur bei Staffelmiete, nicht nach dem Auszug', () => {
  const at = (from: string, over: Partial<UpcomingTenancy> = {}) => staggered({
    baseRents: [{ from: '2024-01', monthlyCents: 50000 }, { from, monthlyCents: 52000, reason: 'staggered' }], ...over,
  })
  assert.equal(of(input({ tenancies: [at('2027-02')] }), 'rentStep').length, 1) // 01.02.2027 im Fenster
  assert.equal(of(input({ tenancies: [at('2027-03')] }), 'rentStep').length, 0) // 01.03.2027 dahinter
  assert.equal(of(input({ tenancies: [at('2026-12')] }), 'rentStep', '2026-11-30').length, 1)
  assert.equal(of(input({ tenancies: [at('2026-12')] }), 'rentStep', '2026-12-01').length, 0) // begonnen
  assert.equal(of(input({ tenancies: [at('2027-01', { end: '2026-12-31' })] }), 'rentStep').length, 0)
  // Eine künftige Stufe nach Vertrag ist keine Staffelstufe.
  const free = tenancy({ baseRents: [{ from: '2020-01', monthlyCents: 50000 }, { from: '2027-01', monthlyCents: 52000, reason: 'agreement' }] })
  assert.equal(of(input({ tenancies: [free] }), 'rentStep').length, 0)
  // Ohne Art der Miete nichts (Durchsicht K6), auch wenn eine Stufe als Staffelstufe dasteht (der Wächter am
  // Mietverhältnis lässt das nicht zu, ein alter Bestand vielleicht doch).
  assert.equal(of(input({ tenancies: [at('2027-01', { rentKind: null })] }), 'rentStep').length, 0)
})

test('Staffelstufe: keine Stufe wegen Modernisierung (Durchsicht M1)', () => {
  const modern = staggered({ start: '2020-01-01', baseRents: [
    { from: '2020-01', monthlyCents: 50000, reason: 'agreement' },
    { from: '2027-01', monthlyCents: 53000, reason: 'modernization' },
  ] })
  assert.deepEqual(of(input({ tenancies: [modern] }), 'rentStep'), [])
  // Folgt hinter der Modernisierung eine Staffelstufe im Fenster, erscheint sie.
  const both = staggered({ start: '2020-01-01', baseRents: [...modern.baseRents, { from: '2027-02', monthlyCents: 55000, reason: 'staggered' }] })
  assert.deepEqual(of(input({ tenancies: [both] }), 'rentStep').map((s) => [s.date, s.fromCents, s.cents]), [['2027-02-01', 53000, 55000]])
})

test('Staffelstufe: der Beginn der Staffel ist keine neue Stufe (Durchsicht S2)', () => {
  const fresh = staggered({ start: '2027-01-01', baseRents: [{ from: '2027-01', monthlyCents: 50000, reason: 'agreement' }] })
  assert.deepEqual(of(input({ tenancies: [fresh] }), 'rentStep'), [])
  const marked = staggered({ start: '2027-01-01', baseRents: [{ from: '2027-01', monthlyCents: 50000, reason: 'staggered' }] })
  assert.deepEqual(of(input({ tenancies: [marked] }), 'rentStep'), [])
})

// Zufällige Staffeln mit festem Startwert: Arten, Abstände, Mietbeginn, Ausschluss.
function* constellations(count: number): Generator<UpcomingTenancy> {
  // Feste Fälle der Durchsicht vorweg.
  yield tenancy({ baseRents: [{ from: '2020-01', monthlyCents: 50000, reason: 'agreement' }, { from: '2027-03', monthlyCents: 53000, reason: 'modernization' }] })
  yield staggered({ start: '2020-01-01', baseRents: [{ from: '2020-01', monthlyCents: 50000, reason: 'agreement' }, { from: '2027-01', monthlyCents: 53000, reason: 'modernization' }] })
  yield staggered()
  let seed = 191
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  const reasons = ['agreement', 'staggered', 'modernization', 'index', 'comparison'] as const
  const kinds = ['free', 'staggered', 'index', null] as const
  const month = (m: number): string => `${2018 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`
  for (let i = 0; i < count; i++) {
    let m = 36 + rnd(70)
    const startDay = String(1 + rnd(28)).padStart(2, '0')
    const start = `${month(m)}-${startDay}`
    const baseRents: RentEntry[] = [{ from: month(m), monthlyCents: 50000, reason: 'agreement' }]
    for (let k = rnd(4); k > 0; k--) {
      m += 1 + rnd(14)
      baseRents.push({ from: month(m), monthlyCents: 50000 + 1000 * baseRents.length, reason: reasons[rnd(reasons.length)] ?? 'agreement' })
    }
    yield tenancy({ start, baseRents, rentKind: kinds[rnd(kinds.length)] ?? null, rentIncreaseExcluded: rnd(3) === 0 ? null : false })
  }
}

test('Wächter: „danach § 558 möglich“ liegt immer nach dem Tag der Stufe (Durchsicht M1)', () => {
  let seen = 0
  for (const t of constellations(600)) {
    for (const today of [TODAY, '2026-10-05', '2027-01-01', '2027-03-15']) {
      for (const s of of(input({ tenancies: [t] }), 'rentStep', today)) {
        if (s.comparisonFrom === null) continue
        seen++
        assert.ok(s.comparisonFrom > s.date, `${today}: ${s.comparisonFrom} nach ${s.date}: ${JSON.stringify(t.baseRents)}`)
      }
    }
  }
  assert.ok(seen > 0, 'mindestens eine Konstellation mit Verlangen danach')
})



test('Erhöhung möglich: schon erreicht (seit 02.01.2021), wirksam bei Zugang heute ab Februar 2027', () => {
  assert.deepEqual(of(input(), 'rentIncrease'), [{
    kind: 'rentIncrease', id: 'rentIncrease:t1', date: '2021-01-02', tenancyId: 't1', unitName: 'EG links', tenantName: 'Erika Mustermann',
    increaseKind: 'comparison', effectiveFrom: '2027-02', exclusionOpen: false, staggered: false,
  }])
})

test('Erhöhung möglich: im Fenster ab dem frühesten Zugang, sonst nicht (Vergleichsmiete und Index, Grenze eingeschlossen)', () => {
  const free = (start: string) => tenancy({ start, baseRents: [{ from: start.slice(0, 7), monthlyCents: 50000 }] })
  assert.deepEqual(of(input({ tenancies: [free('2025-12-15')] }), 'rentIncrease').map((i) => [i.date, i.effectiveFrom]), [['2027-01-02', '2027-04']])
  assert.deepEqual(of(input({ tenancies: [free('2026-03-15')] }), 'rentIncrease'), [])
  const index = (start: string) => tenancy({ rentKind: 'index', start, baseRents: [{ from: start.slice(0, 7), monthlyCents: 50000, reason: 'agreement', index: { month: '2025-12', value: 120.1, base: 2020 } }] })
  assert.deepEqual(of(input({ tenancies: [index('2026-02-17')] }), 'rentIncrease').map((i) => [i.increaseKind, i.date, i.effectiveFrom]), [['index', '2027-02-18', '2027-04']])
  assert.deepEqual(of(input({ tenancies: [index('2026-02-18')] }), 'rentIncrease'), [])
})

test('Erhöhung möglich: ohne Art der Miete kein Eintrag; offene Frage zum Ausschluss wird genannt, Ausschluss sperrt', () => {
  assert.deepEqual(of(input({ tenancies: [tenancy({ rentKind: null })] }), 'rentIncrease'), [])
  assert.deepEqual(of(input({ tenancies: [tenancy({ rentKind: undefined })] }), 'rentIncrease'), [])
  assert.deepEqual(of(input({ tenancies: [tenancy({ rentIncreaseExcluded: null })] }), 'rentIncrease').map((i) => i.exclusionOpen), [true])
  assert.deepEqual(of(input({ tenancies: [tenancy({ rentIncreaseExcluded: true })] }), 'rentIncrease'), [])
})

test('Erhöhung möglich: Sperren, die keine Eingabe löst (Garage, Auszug vor dem Wirksamwerden, Index nach Modernisierung)', () => {
  assert.deepEqual(of(input({ units: [{ id: 'u1', name: 'Garage', areaM2: 0 }] }), 'rentIncrease'), [])
  assert.deepEqual(of(input({ tenancies: [tenancy({ end: '2027-01-31' })] }), 'rentIncrease'), [])
  assert.equal(of(input({ tenancies: [tenancy({ end: '2027-02-01' })] }), 'rentIncrease').length, 1)
  assert.deepEqual(of(input({ tenancies: [tenancy({ baseRents: [] })] }), 'rentIncrease'), [])
  const index = tenancy({ rentKind: 'index', baseRents: [
    { from: '2020-01', monthlyCents: 50000, index: { month: '2019-10', value: 100.0, base: 2020 } },
    { from: '2024-01', monthlyCents: 52000, reason: 'modernization' },
  ] })
  assert.deepEqual(of(input({ tenancies: [index] }), 'rentIncrease'), [])
})

test('Erhöhung möglich: ein offenes Verlangen oder eine Erklärung mit Wirkung nach heute unterdrückt den Eintrag', () => {
  const with_ = (x: UpcomingRentIncrease) => of(input({ rentIncreases: [x] }), 'rentIncrease').length
  assert.equal(with_(increase({ status: 'draft', receivedOn: null })), 0)
  assert.equal(with_(increase({ status: 'sent' })), 0)
  assert.equal(with_(increase({ kind: 'index', status: 'draft', receivedOn: null })), 0)
  assert.equal(with_(increase({ kind: 'index', status: 'sent', effectiveFrom: '2027-01' })), 0)
  assert.equal(with_(increase({ status: 'agreed', effectiveFrom: '2027-02' })), 0)
  // Erledigt oder schon in Kraft: der Eintrag steht wieder.
  assert.equal(with_(increase({ status: 'refused' })), 1)
  assert.equal(with_(increase({ status: 'withdrawn' })), 1)
  assert.equal(with_(increase({ kind: 'index', status: 'sent', receivedOn: '2026-08-10', effectiveFrom: '2026-10' })), 1)
  // Ein Verlangen eines anderen Mietverhältnisses zählt nicht.
  assert.equal(with_(increase({ tenancyId: 't2', status: 'draft' })), 1)
})

test('Erhöhung möglich: eine künftige Stufe, auch wegen Modernisierung, schiebt das Wirksamwerden dahinter (Durchsicht S3)', () => {
  const t = tenancy({ baseRents: [{ from: '2020-01', monthlyCents: 50000, reason: 'agreement' }, { from: '2027-03', monthlyCents: 53000, reason: 'modernization' }] })
  assert.deepEqual(of(input({ tenancies: [t] }), 'rentIncrease').map((i) => [i.date, i.effectiveFrom]), [['2021-01-02', '2027-04']])
})

// Was das Cockpit nennt, muss sich mit derselben Vorgabe planen lassen: Zugang am genannten Tag (ist er vorbei, heute)
// und Wirksamwerden im genannten Monat sperren weder Fristen noch Stufen.
const TIMING = /zu früh|frühestens ab|noch keine \d+ Monate|Stufe ab|endet am/
test('Erhöhung möglich: der genannte Zugang und Monat lassen sich so planen (Durchsicht S3)', () => {
  let seen = 0
  for (const t of constellations(600)) {
    for (const today of [TODAY, '2027-01-01', '2027-03-15']) {
      for (const item of of(input({ tenancies: [t] }), 'rentIncrease', today)) {
        seen++
        const receivedOn = item.date > today ? item.date : (today.endsWith('-01') ? dayAfter(today) : today)
        const request: RentIncreaseRequest = item.increaseKind === 'index'
          ? { kind: 'index', receivedOn, effectiveFrom: item.effectiveFrom, allStepsEntered: true, residential: true }
          : { kind: 'comparison', receivedOn, effectiveFrom: item.effectiveFrom, allStepsEntered: true, residential: true, noThirdPartyFunds: true, comparisonCentsPerM2: 2000 }
        const p = planRentIncrease({ today, tenancy: t, unit: { areaM2: 60 }, property: { rentCapReduced: false, state: 'BY', tightMarket: null }, request })
        const timing = p.refusals.filter((r) => TIMING.test(r))
        assert.deepEqual(timing, [], `${today} ${item.date} ${item.effectiveFrom} ${JSON.stringify(t.baseRents)} ${t.rentKind}`)
        assert.notEqual(p.state, 'notYet', p.refusals.join(' '))
      }
    }
  }
  assert.ok(seen > 50, `nur ${seen} Einträge`)
})



test('Zustimmungsfrist: läuft bis zum Ende des zweiten Monats nach Zugang, auch am verschobenen Werktag', () => {
  const expected = {
    kind: 'rentConsent', id: 'rentConsent:r1', tenancyId: 't1', unitName: 'EG links', tenantName: 'Erika Mustermann', increaseId: 'r1',
    receivedOn: '2026-11-10', consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitEnd: '2027-04-30',
  }
  const list = input({ rentIncreases: [increase()] })
  // 31.01.2027 ist ein Sonntag: Bis Montag gilt die Frist als laufend (§ 193 BGB, offen; Klage erst danach), und der
  // Eintrag nennt diesen Tag (Durchsicht S4).
  assert.deepEqual(of(list, 'rentConsent'), [{ ...expected, stage: 'running', date: '2027-02-01' }])
  assert.deepEqual(of(list, 'rentConsent', '2027-02-01'), [{ ...expected, stage: 'running', date: '2027-02-01' }])
  assert.deepEqual(of(list, 'rentConsent', '2027-02-02'), [{ ...expected, stage: 'suit', date: '2027-04-30' }])
  assert.deepEqual(of(list, 'rentConsent', '2027-04-30'), [{ ...expected, stage: 'suit', date: '2027-04-30' }])
  assert.deepEqual(of(list, 'rentConsent', '2027-05-01'), [{ ...expected, stage: 'lapsed', date: '2027-04-30' }])
})

test('Zustimmungsfrist: nur versandte Verlangen nach § 558 ohne Antwort', () => {
  for (const x of [increase({ status: 'draft', receivedOn: null }), increase({ status: 'agreed' }), increase({ status: 'partial' }), increase({ status: 'refused' }), increase({ status: 'withdrawn' }), increase({ kind: 'index' })]) {
    assert.deepEqual(of(input({ rentIncreases: [x] }), 'rentConsent'), [], `${x.kind} ${x.status}`)
  }
})

test('Ohne Angaben zur Mieterhöhung bleibt die Liste, wie sie war (wer nichts erhöht, merkt nichts)', () => {
  const plain = tenancy({ rentKind: null, rentIncreaseExcluded: null, baseRents: [{ from: '2020-01', monthlyCents: 50000 }, { from: '2027-01', monthlyCents: 52000 }] })
  assert.deepEqual(upcomingDeadlines(input({ tenancies: [plain] }), TODAY).items, [])
})

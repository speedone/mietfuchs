// „Demnächst fällig“, Einträge der Mieterhöhung (#191, PR 4; Rest von #190): Staffelstufe, frühester Zugang einer
// Erhöhung, Zustimmungs- und Klagefrist offener Verlangen. Die reine Liste `upcomingDeadlines`, jedes „heute“ hineingereicht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CALENDAR_RULES } from '../../shared/period.ts'
import { upcomingDeadlines, type UpcomingInput, type UpcomingRentIncrease, type UpcomingTenancy } from '../src/upcomingDeadlines.ts'
import type { PeriodKey, UpcomingDeadline } from '../../shared/types.ts'

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
  // Die Erhöhung nach § 558 liegt über ein Jahr hinter der letzten Stufe, also nicht im Fenster.
  assert.deepEqual(of(input({ tenancies: [staggered()] }), 'rentIncrease'), [])
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
})

// ---------- Frühester Zugang einer Erhöhung ----------

test('Erhöhung möglich: schon erreicht (seit 02.01.2021), wirksam bei Zugang heute ab Februar 2027', () => {
  assert.deepEqual(of(input(), 'rentIncrease'), [{
    kind: 'rentIncrease', id: 'rentIncrease:t1', date: '2021-01-02', tenancyId: 't1', unitName: 'EG links', tenantName: 'Erika Mustermann',
    increaseKind: 'comparison', effectiveFrom: '2027-02', exclusionOpen: false,
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

// ---------- Zustimmungs- und Klagefrist ----------

test('Zustimmungsfrist: läuft bis zum Ende des zweiten Monats nach Zugang, auch am verschobenen Werktag', () => {
  const expected = {
    kind: 'rentConsent', id: 'rentConsent:r1', tenancyId: 't1', unitName: 'EG links', tenantName: 'Erika Mustermann', increaseId: 'r1',
    receivedOn: '2026-11-10', consentEnd: '2027-01-31', suitEnd: '2027-04-30',
  }
  const list = input({ rentIncreases: [increase()] })
  assert.deepEqual(of(list, 'rentConsent'), [{ ...expected, stage: 'running', date: '2027-01-31' }])
  // 31.01.2027 ist ein Sonntag: Bis Montag gilt die Frist als laufend (§ 193 BGB, offen; Klage erst danach).
  assert.deepEqual(of(list, 'rentConsent', '2027-02-01'), [{ ...expected, stage: 'running', date: '2027-01-31' }])
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

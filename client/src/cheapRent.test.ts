import { expect, test } from 'vitest'
import { percentText, buildDirectCharges, buildLocalRents, directChargeToForm, emptyDirectChargeForm, emptyLocalRentForm, localRentToForm, rentedUnits, verdictText, withoutLocalRent } from './cheapRent'
import type { CheapRentTenancy, Tenancy, Unit } from './types'

const unit = (over: Partial<Unit> = {}): Unit => ({ id: 'a', propertyId: 'p', name: 'DG', areaM2: 60, participates: true, ...over })
const alt = { from: '2023-01', monthlyCents: 80000, source: 'Mietspiegel 2023', sourceDate: '2022-04-01' }

test('Ortsübliche Miete: alle fehlenden Angaben auf einmal, je mit Feld', () => {
  const r = buildLocalRents({ ...emptyLocalRentForm('a', 2025), from: '' }, [unit()])
  expect('problems' in r && r.problems.map((p) => p.field)).toEqual(['from', 'amount', 'source', 'sourceDate'])
})

test('Ortsübliche Miete: ein neuer Eintrag kommt sortiert in die Staffel, derselbe Monat wird ersetzt', () => {
  const u = unit({ localRents: [alt, { ...alt, from: '2025-01', monthlyCents: 1 }] })
  const r = buildLocalRents({ unitId: 'a', originalFrom: '', from: '01.2025', amount: '900,00', source: ' Mietspiegel 2025 ', sourceDate: '2024-04-01' }, [u])
  expect(r).toEqual({ unitId: 'a', localRents: [alt, { from: '2025-01', monthlyCents: 90000, source: 'Mietspiegel 2025', sourceDate: '2024-04-01' }] })
})

test('Ortsübliche Miete: beim Bearbeiten fällt der bisherige Monat weg, wenn er geändert wird', () => {
  const u = unit({ localRents: [alt] })
  const r = buildLocalRents({ ...localRentToForm('a', alt), from: '2024-01' }, [u])
  expect('localRents' in r && r.localRents.map((e) => e.from)).toEqual(['2024-01'])
  expect(withoutLocalRent(u, '2023-01')).toEqual([])
})

test('Ortsübliche Miete: nur vermietete Wohnungen, und ein Betrag von 0 € ist keiner', () => {
  expect(rentedUnits([unit(), unit({ id: 'e', participates: false, selfUsed: true })]).map((u) => u.id)).toEqual(['a'])
  const r = buildLocalRents({ unitId: 'a', originalFrom: '', from: '2025-01', amount: '0', source: 'x', sourceDate: '2024-01-01' }, [unit()])
  expect('problems' in r && r.problems.map((p) => p.short)).toEqual(['Kein Betrag'])
})

const t = (over: Partial<CheapRentTenancy>): CheapRentTenancy => ({
  tenancyId: 't', tenantName: 'Tochter', days: 365, baseRentCents: 240000, chargesCents: 0, chargesSource: 'settlement', directChargesCents: 0, entgeltCents: 240000,
  comparisonCents: 1080000, quotePercent: 22.22, verdict: 'split', missingMonths: [], ...over,
})
const law = { split: 50, paid: 66, cite: '§ 21 Abs. 2 EStG', text: '' }

test('Quote: die Sätze nennen Zahlen und Grenzen aus dem Bericht', () => {
  expect(verdictText(t({}), law)).toMatch(/2\.400,00\s€.*10\.800,00\s€ = 22,22 %\. Unter 50 %: .*kürzt sie\./)
  expect(verdictText(t({ verdict: 'forecast', quotePercent: 61.11 }), law)).toMatch(/Zwischen 50 und unter 66 %: .*Totalüberschussprognose/)
  expect(verdictText(t({ verdict: 'paid', quotePercent: 70 }), law)).toMatch(/Ab 66 % gilt die Vermietung als entgeltlich/)
  expect(verdictText(t({ verdict: 'lowerBound' }), law)).toMatch(/heizt selbst/)
  expect(verdictText(t({ verdict: 'incomplete', quotePercent: null, missingMonths: [1, 2] }), law)).toBe('Tochter: Für Januar, Februar fehlt die ortsübliche Miete; Mietfuchs rechnet die Quote nicht.')
})

// Direkt an Dritte gezahlte Kosten (#257, Entscheidung in PR #422)
const ten = (over: Partial<Tenancy> = {}): Tenancy => ({
  id: 't', unitId: 'a', tenantName: 'Tochter', persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})

test('Direkt gezahlte Kosten: Monat und Betrag sind Pflicht, 0 € ist erlaubt, Staffel sortiert', () => {
  const leer = buildDirectCharges({ ...emptyDirectChargeForm('t', 2025), from: '' }, [ten()])
  expect('problems' in leer && leer.problems.map((p) => p.field)).toEqual(['from', 'amount'])
  const t = ten({ directCharges: [{ from: '2025-07', monthlyCents: 1 }] })
  expect(buildDirectCharges({ tenancyId: 't', originalFrom: '', from: '01.2025', amount: '150' }, [t]))
    .toEqual({ tenancyId: 't', directCharges: [{ from: '2025-01', monthlyCents: 15000 }, { from: '2025-07', monthlyCents: 1 }] })
  expect(buildDirectCharges({ tenancyId: 't', originalFrom: '', from: '2025-01', amount: '0' }, [ten()]))
    .toEqual({ tenancyId: 't', directCharges: [{ from: '2025-01', monthlyCents: 0 }] })
  const geaendert = buildDirectCharges({ ...directChargeToForm('t', { from: '2025-07', monthlyCents: 1 }), from: '2025-08' }, [t])
  expect('directCharges' in geaendert && geaendert.directCharges.map((e) => e.from)).toEqual(['2025-08'])
})

test('Quote: direkt gezahlte Kosten stehen im Satz, ohne Eintrag fragt die Untergrenze danach', () => {
  expect(verdictText(t({ directChargesCents: 180000, entgeltCents: 420000 }), law)).toMatch(/direkt an Dritte gezahlt 1\.800,00\s€/)
  expect(verdictText(t({ verdict: 'lowerBound' }), law)).toMatch(/Tragen Sie ein, was er unmittelbar an den Versorger zahlt/)
})

// ---------- Durchsicht von PR #422 ----------

test('K3: auch eine vermietete Wohnung außerhalb der Abrechnungseinheit; nur die selbstgenutzte nicht', () => {
  expect(rentedUnits([unit({ id: 'g', participates: false, selfUsed: false }), unit({ id: 'e', participates: false, selfUsed: true })]).map((u) => u.id)).toEqual(['g'])
})

test('S2: bei der Prognose nennt der Satz die Folge einer negativen Prognose', () => {
  expect(verdictText(t({ verdict: 'forecast', quotePercent: 61.11 }), law)).toMatch(/Fällt sie negativ aus, sind die Werbungskosten nur zum entgeltlichen Teil abziehbar/)
})

test('S3: der entgeltliche Anteil wird abgeschnitten, nicht gerundet', () => {
  expect(percentText(0.499999)).toBe('49,99 %')
  expect(percentText(0.66)).toBe('66 %')
})

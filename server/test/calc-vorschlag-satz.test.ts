// Der Satz zum Vorschlag der Vorauszahlung im Anschreiben (#691, „{Grundlage}“) folgt dem, wie die Berechnung wirklich
// gerechnet hat (`suggestionScaling`), vom Bestand bis zum Satz. Vorher riet er aus Tagen und Zeitraum: Im Rumpf stand
// „ein Zwölftel Ihrer Jahreskosten“, obwohl hochgerechnet war, und ein erster Versuch schrieb bei jedem Rumpf
// „hochgerechnet“, obwohl eine Position ohne Leistungszeitraum als Jahresbetrag zählt (prepaymentSuggestion.ts).
//
// Die Invariante am Ende: „ein Zwölftel Ihrer Jahreskosten“ steht nur da, wenn der Vorschlag das gerundete Zwölftel
// der Kosten des Mieters ist, und der Satz mit den Tagen nur, wenn er aus Kosten, Tagen und einem Jahr aufgeht.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { lettersOf, suggestionBasis, SUGGESTION_BASIS_MIXED, SUGGESTION_BASIS_PLAIN } from '../../shared/letter.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
// Rumpf 01.01. bis 30.04.2026, danach Mai bis April
const RUMPF: PeriodRules = { startMonth: 1, changes: ['2026-05'] }

const mieter = (id: string, unitId: string, start: string, end: string | null = null) => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
  prepayments: [{ from: start.slice(0, 7), monthlyCents: 3000 }], prepaymentOverrides: {}, baseRents: [],
})
const position = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) => ({
  id, propertyId: 'objekt-1', period: periodKey(key), category: 'Sonstige Betriebskosten', description: id, amountCents, key: 'area' as const, ...over,
})
const haus = (rules: PeriodRules, over: Partial<Source> = {}): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: rules }],
  units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 70, participates: true }],
  tenancies: [mieter('A', 'u1', '2020-01-01')], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [],
  ...over,
} as Source)
const settle = (src: Source, rules: PeriodRules, key: string): ComputedSettlement => computeSettlement(snapshotFor(src, 'objekt-1', of(rules, key)))

// Vom Bestand bis zum Satz im Anschreiben: Vorschlag in Cent und die Grundlage, wie `lettersOf` sie einsetzt
function satz(s: ComputedSettlement, tenancyId = 'A'): { cents: number; basis: string; text: string } {
  const st = s.statements.find((x) => x.tenancyId === tenancyId) ?? assert.fail(`${tenancyId} fehlt`)
  const letter = lettersOf(s, {
    settings: { landlordName: 'V', iban: '', paymentDeadlineDays: 30 },
    property: { id: 'objekt-1', name: 'Haus', kind: 'mfh', address: 'Weg 1, 12345 Musterstadt', landlordName: null, iban: null, paymentDeadlineDays: null },
    tenancies: [{ id: tenancyId, end: null, prepayments: [], correspondenceAddress: '' }],
    installation: {}, propertyTexts: {}, own: {}, asOf: '2027-01-15',
  })[tenancyId] ?? assert.fail('kein Anschreiben')
  assert.equal(letter.values.Grundlage, suggestionBasis(st, s.daysInYear))
  return { cents: st.suggestedMonthlyCents, basis: letter.values.Grundlage ?? '', text: (letter.texts.adjustSuggestion ?? '').replace(/ /g, ' ') }
}
const TAGE = (n: number): string => `Ihr Anteil für ${n} Tage, auf ein volles Jahr hochgerechnet, davon ein Zwölftel, gerundet`

test('Rumpf, Position ohne Leistungszeitraum: als Jahresbetrag genommen, also „ein Zwölftel Ihrer Jahreskosten“ (15 €)', () => {
  const r = satz(settle(haus(RUMPF, { costItems: [position('Hausmeister', '2026-01', 17754)] }), RUMPF, '2026-01'))
  // 177,54 € / 12 = 14,80 € → 15 €; hochgerechnet ist nichts
  assert.equal(r.cents, 1500)
  assert.equal(r.basis, SUGGESTION_BASIS_PLAIN)
  assert.match(r.text, /auf 15,00 € angepasst \(ein Zwölftel Ihrer Jahreskosten, gerundet\)/)
})

test('Rumpf, Leistungszeitraum gleich dem Rumpf: von 120 Tagen auf ein Jahr hochgerechnet (45 €)', () => {
  const r = satz(settle(haus(RUMPF, { costItems: [position('Hausmeister', '2026-01', 17754, { serviceFrom: '2026-01-01', serviceTo: '2026-04-30' })] }), RUMPF, '2026-01'))
  // 177,54 € × 365/120 / 12 = 45,00 €
  assert.equal(r.cents, 4500)
  assert.equal(r.basis, TAGE(120))
})

test('Rumpf gemischt (120 € mit, 600 € ohne Leistungszeitraum): der Satz behauptet keine Rechnung, die nicht aufgeht (80 €)', () => {
  const r = satz(settle(haus(RUMPF, { costItems: [
    position('Hausmeister', '2026-01', 12000, { serviceFrom: '2026-01-01', serviceTo: '2026-04-30' }),
    position('Versicherung', '2026-01', 60000),
  ] }), RUMPF, '2026-01'))
  // 120 € × 365/120 + 600 € = 965 € im Jahr, / 12 = 80,42 € → 80 €; „Ihr Anteil für 120 Tage hochgerechnet“ ergäbe 182,50 €
  assert.equal(r.cents, 8000)
  assert.equal(r.basis, SUGGESTION_BASIS_MIXED)
  assert.match(r.text, /auf 80,00 € angepasst \(Kosten, die nur einen Teil des Jahres betreffen, auf ein volles Jahr hochgerechnet, von der Summe ein Zwölftel, gerundet\)/)
})

test('Rumpf, eine Rechnung nur für April: anders hochgerechnet als nach den Tagen des Mieters, also der allgemeine Satz', () => {
  const r = satz(settle(haus(RUMPF, { costItems: [position('Hausmeister', '2026-01', 3000, { serviceFrom: '2026-04-01', serviceTo: '2026-04-30' })] }), RUMPF, '2026-01'))
  // 30 € × 365/30 / 12 = 30,42 € → 30 €
  assert.equal(r.cents, 3000)
  assert.equal(r.basis, SUGGESTION_BASIS_MIXED)
})

test('Einzug im Rumpf: mit Leistungszeitraum nach den Tagen des Mieters, ohne nur vom Teil des Rumpfs auf den Rumpf', () => {
  const einzug = (items: ReturnType<typeof position>[]) => settle(haus(RUMPF, { tenancies: [mieter('A', 'u1', '2026-03-01')], costItems: items }), RUMPF, '2026-01')
  // 61 von 120 Tagen: Anteil 177,54 × 61/120 = 90,25 €; × 365/61 / 12 = 45,00 €
  const mit = satz(einzug([position('Hausmeister', '2026-01', 17754, { serviceFrom: '2026-01-01', serviceTo: '2026-04-30' })]))
  assert.equal(mit.cents, 4500)
  assert.equal(mit.basis, TAGE(61))
  // Ohne Leistungszeitraum gilt der Betrag als Jahresbetrag, der Anteil für 61 Tage wird nur auf den Rumpf gerechnet:
  // 177,54 € / 12 → 15 €. Weder das Zwölftel des Anteils (90,25 € / 12 = 8 €) noch ein Jahr nach Tagen (45 €).
  const ohne = satz(einzug([position('Hausmeister', '2026-01', 17754)]))
  assert.equal(ohne.cents, 1500)
  assert.equal(ohne.basis, SUGGESTION_BASIS_MIXED)
})

test('Volles Jahr und Einzug im Jahr: wortgleich wie bisher, auch im Schaltjahr', () => {
  const jahr = (year: number, start: string) => satz(settle(haus(CALENDAR_RULES, { tenancies: [mieter('A', 'u1', start)], costItems: [position('Hausmeister', `${year}-01`, 60000)] }), CALENDAR_RULES, `${year}-01`))
  assert.deepEqual(jahr(2025, '2020-01-01'), { cents: 5000, basis: 'ein Zwölftel Ihrer Jahreskosten, gerundet', text: jahr(2025, '2020-01-01').text })
  // Einzug 01.07.2025: 184 Tage, Anteil 302,47 €, × 365/184 / 12 = 50 €
  const einzug = jahr(2025, '2025-07-01')
  assert.equal(einzug.cents, 5000)
  assert.equal(einzug.basis, 'Ihr Anteil für 184 Tage, auf ein volles Jahr hochgerechnet, davon ein Zwölftel, gerundet')
  // Schaltjahr 2024 (366 Tage): voll und mit Einzug am 01.03. (306 Tage)
  assert.equal(jahr(2024, '2020-01-01').basis, 'ein Zwölftel Ihrer Jahreskosten, gerundet')
  const schalt = jahr(2024, '2024-03-01')
  assert.equal(schalt.cents, 5000)
  assert.equal(schalt.basis, 'Ihr Anteil für 306 Tage, auf ein volles Jahr hochgerechnet, davon ein Zwölftel, gerundet')
})

test('Volles Jahr mit einer Heizperiode als Rumpf: die Heizkosten sind hochgerechnet, der Satz sagt es', () => {
  // Die Anlage rechnete von Mai an und wechselt zum Januar: 01.05. bis 31.12.2025 ist ein Rumpf von acht Monaten.
  const anlage = {
    id: 'hp1', propertyId: 'objekt-1', name: '', method: 'service' as const, source: 'building' as const,
    energy: 'gas' as const, devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, units: null,
    periodStartMonth: 5, periodChanges: ['2026-01'], separateSpans: [], separateSettlement: false,
  }
  const s = settle(haus(CALENDAR_RULES, {
    heatingPlants: [anlage],
    costItems: [
      position('Grundsteuer', '2025-01', 60000, { category: 'Grundsteuer' }),
      position('Gas', '2025-05', 80000, { category: HEATING_CATEGORY, heatingPlantId: 'hp1', heatingPart: 'fuel', serviceFrom: '2025-05-01', serviceTo: '2025-12-31', key: 'amounts', tenancyAmounts: { A: 80000 } }),
    ],
  } as Partial<Source>), CALENDAR_RULES, '2025-01')
  const r = satz(s)
  assert.equal(s.period.short, false)
  // Mehr als das Zwölftel der Kosten (1.400 € / 12 = 117 €): Der Brennstoff ist nach Gradtagen auf ein Jahr gerechnet.
  assert.ok(r.cents > 11700, `Vorschlag ${r.cents}`)
  assert.equal(r.basis, SUGGESTION_BASIS_MIXED)
})

test('Ein vorher eingefrorener Stand ohne die Angabe druckt den Satz wie bisher nach den Tagen', () => {
  assert.equal(suggestionBasis({ days: 365 }, 365), 'ein Zwölftel Ihrer Jahreskosten, gerundet')
  assert.equal(suggestionBasis({ days: 120 }, 120), 'ein Zwölftel Ihrer Jahreskosten, gerundet')
  assert.equal(suggestionBasis({ days: 306 }, 365), 'Ihr Anteil für 306 Tage, auf ein volles Jahr hochgerechnet, davon ein Zwölftel, gerundet')
})

// ---------- Invariante über zufällige Bestände ----------

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const round = (yearlyCents: number): number => Math.max(0, Math.round(yearlyCents / 12 / 100) * 100)

test('Invariante: „ein Zwölftel Ihrer Jahreskosten“ nur, wenn der Vorschlag das gerundete Zwölftel der Kosten ist; der Satz mit den Tagen nur, wenn er aufgeht', () => {
  const r = rng(691)
  const seen = { none: 0, days: 0, mixed: 0 }
  for (let i = 0; i < 400; i += 1) {
    const kind = Math.floor(r() * 3)
    const [rules, key] = kind === 0 ? [RUMPF, '2026-01'] as const : kind === 1 ? [CALENDAR_RULES, '2025-01'] as const : [CALENDAR_RULES, '2024-01'] as const
    const p = of(rules, key)
    const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1
    const units = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, n) => ({ id: `u${n + 1}`, propertyId: 'objekt-1', name: `W${n + 1}`, areaM2: 40 + Math.floor(r() * 60), participates: true }))
    // Je Wohnung ein Mieter: von Anfang an oder mit Einzug im Zeitraum
    const tenancies = units.map((u, n) => mieter(`T${n + 1}`, u.id, r() < 0.5 ? '2020-01-01' : addDays(p.from, Math.floor(r() * (days - 1)))))
    const costItems = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, n) => {
      const amount = 1000 + Math.floor(r() * 200000)
      const mode = Math.floor(r() * 4)
      // ohne Leistungszeitraum, genau der Zeitraum, ein Teil davon, oder (selten) eine Gutschrift ohne Leistungszeitraum
      const from = addDays(p.from, Math.floor(r() * (days / 2)))
      const service = mode === 1 ? { serviceFrom: p.from, serviceTo: p.to } : mode === 2 ? { serviceFrom: from, serviceTo: addDays(from, Math.floor(r() * (days / 2 - 1))) } : {}
      return position(`K${n + 1}`, key, mode === 3 && r() < 0.3 ? -Math.floor(amount / 10) : amount, { description: `Position ${n + 1}`, ...service })
    })
    const s = settle(haus(rules, { units, tenancies, costItems } as Partial<Source>), rules, key)
    for (const st of s.statements) {
      if (st.suggestedMonthlyCents === 0 && st.suggestionScaling === undefined) continue
      const basis = suggestionBasis(st, s.daysInYear)
      const where = `Lauf ${i}, ${st.tenancyId}: ${st.days} von ${s.daysInYear} Tagen, Kosten ${st.totalShareCents}, Vorschlag ${st.suggestedMonthlyCents}`
      seen[st.suggestionScaling ?? 'none'] += 1
      if (basis === SUGGESTION_BASIS_PLAIN) {
        assert.equal(st.suggestedMonthlyCents, round(st.totalShareCents), where)
      } else if (basis !== SUGGESTION_BASIS_MIXED) {
        assert.equal(basis, TAGE(st.days), where)
        // „auf ein volles Jahr“: 365 oder 366 Tage, im vollen Zeitraum dessen Tage, nie die Tage eines Rumpfs
        const fits = [365, 366, ...(s.period.short ? [] : [s.daysInYear])].some((year) => round((st.totalShareCents * year) / st.days) === st.suggestedMonthlyCents)
        assert.ok(fits, where)
      }
    }
  }
  // Jede Art kam vor, sonst prüfte die Invariante nichts
  assert.ok(seen.none > 20 && seen.days > 20 && seen.mixed > 20, JSON.stringify(seen))
})

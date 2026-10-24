import { expect, test } from 'vitest'
import type { PrepaymentStepItem, PrepaymentStepPlan } from './types'
import { overdueText, sentMonthLines, stepQuestion, stepStatus } from './prepaymentSteps'
import type { Statement, StatementLetter } from './types'

const plain = (s: string | null): string => (s ?? '').replace(/ /g, ' ')
const item = (over: Partial<PrepaymentStepItem> = {}): PrepaymentStepItem => ({
  tenancyId: 't1', tenantName: 'Erika', unitName: 'EG', schedule: 'prepayments', cents: 5000, from: '2026-05', announcedFrom: '2026-05',
  currentCents: 4000, state: 'pending', existing: [], earlier: [], notes: [], overdue: false, ...over,
})
const plan = (items: PrepaymentStepItem[], errors: string[] = []): PrepaymentStepPlan => ({ items, errors, sentAt: '2026-03-03', token: 'x' })

test('#317: Stand je Mieter', () => {
  expect(plain(stepStatus(item()))).toBe('Vorauszahlung 50,00 € ab Mai 2026: noch nicht in der Staffel (dort 40,00 €).')
  expect(plain(stepStatus(item({ state: 'taken' })))).toBe('Vorauszahlung 50,00 € ab Mai 2026: steht in der Staffel.')
  expect(plain(stepStatus(item({ schedule: 'heatingPrepayments', state: 'taken' })))).toMatch(/^Heizvorauszahlung/)
})

test('#317: „angekündigt, aber nicht übernommen“ nennt Mieter, Betrag und Monat', () => {
  expect(overdueText([])).toBeNull()
  expect(plain(overdueText([item({ overdue: true })]))).toBe('Angekündigt, aber noch nicht in der Staffel: Erika (50,00 € ab Mai 2026). Das Mietkonto führt bis dahin die bisherige Vorauszahlung im Soll.')
})

test('#317: Rückfrage bei Fehlern, vorhandener Stufe und zum Monat; ohne Anlass keine', () => {
  expect(stepQuestion(plan([item()]), ['t1'])).toBeNull()
  const errors = stepQuestion(plan([item()], ['Mietverhältnisse überschneiden sich']), ['t1'])
  expect(errors?.[0]).toMatch(/Fehler \(Mietverhältnisse überschneiden sich\).*VIII ZR 246\/11/)
  const existing = stepQuestion(plan([item({ existing: [{ from: '2026-05', monthlyCents: 4500 }, { from: '2027-01', monthlyCents: 4800 }] })]), ['t1'])
  expect(plain(existing?.[0] ?? null)).toMatch(/Ab Mai 2026 steht in der Staffel schon 45,00 € ab Mai 2026, 48,00 € ab Januar 2027\. Die Stufe ab Mai 2026 wird ersetzt, spätere bleiben\..*203 C 73\/23, Rn\. 27/)
  expect(stepQuestion(plan([item({ notes: ['Prüfen.'] })]), ['t1'])).toEqual(['Erika: Prüfen.'])
  // Nur, wer übernommen wird.
  expect(stepQuestion(plan([item({ notes: ['Prüfen.'] })]), [])).toBeNull()
})

// Durchsicht zu PR #435
test('S2: eine Stufe zwischen Zeitraumende und Monat fragt nach', () => {
  const lines = stepQuestion(plan([item({ earlier: [{ from: '2026-02', monthlyCents: 4400 }] })]), ['t1'])
  expect(plain(lines?.[0] ?? null)).toMatch(/Erika: Nach dem abgerechneten Zeitraum steht schon 44,00 € ab Februar 2026\..*203 C 73\/23, Rn\. 27/)
})

test('S1: Versanddatum gegen den Monat des Schreibens', () => {
  const letter = (from: string | null, newCents: number | null = 5000) => ({ adjustment: { mode: 'suggestion', newCents, from } }) as unknown as StatementLetter
  const st = [{ tenancyId: 't1', tenantName: 'Erika' }] as unknown as Statement[]
  expect(sentMonthLines({ t1: letter('2026-05') }, st, '2026-03-03')).toEqual([])
  expect(plain(sentMonthLines({ t1: letter('2026-05') }, st, '2026-04-02')[0] ?? '')).toMatch(/Erika: Das Schreiben nennt Mai 2026.*später als die Vorgabe.*Wieder öffnen/)
  expect(plain(sentMonthLines({ t1: letter('2026-05') }, st, '2026-05-04')[0] ?? '')).toMatch(/schon begonnen.*VIII ZR 271\/10.*Wieder öffnen/)
  expect(sentMonthLines({ t1: letter(null) }, st, '2026-05-04')).toEqual([])
  expect(sentMonthLines({ t1: letter('2026-05', null) }, st, '2026-05-04')).toEqual([])
})

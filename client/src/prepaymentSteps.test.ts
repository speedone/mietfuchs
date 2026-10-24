import { expect, test } from 'vitest'
import type { PrepaymentStepItem, PrepaymentStepPlan } from './types'
import { overdueText, stepQuestion, stepStatus } from './prepaymentSteps'

const plain = (s: string | null): string => (s ?? '').replace(/ /g, ' ')
const item = (over: Partial<PrepaymentStepItem> = {}): PrepaymentStepItem => ({
  tenancyId: 't1', tenantName: 'Erika', unitName: 'EG', schedule: 'prepayments', cents: 5000, from: '2026-05', announcedFrom: '2026-05',
  currentCents: 4000, state: 'pending', existing: [], notes: [], overdue: false, ...over,
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

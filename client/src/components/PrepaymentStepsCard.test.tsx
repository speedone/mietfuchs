// @vitest-environment jsdom
// #317: „In die Staffel übernehmen“ auf der abgeschlossenen Abrechnung: Stand je Mieter, Hinweis „angekündigt, aber nicht
// übernommen“, Rückfrage bei einer vorhandenen Stufe, und gesendet wird die Marke des Plans mit dem gewählten Monat.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PrepaymentStepItem, PrepaymentStepPlan } from '../types'
import { UIProvider } from './feedback'
import PrepaymentStepsCard from './PrepaymentStepsCard'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ')
const item = (over: Partial<PrepaymentStepItem> = {}): PrepaymentStepItem => ({
  tenancyId: 't1', tenantName: 'Erika', unitName: 'EG', schedule: 'prepayments', cents: 5000, from: '2026-05', announcedFrom: '2026-05',
  currentCents: 4000, state: 'pending', existing: [], notes: [], overdue: false, ...over,
})
let plan: PrepaymentStepPlan
let posts: { url: string, body: Record<string, unknown> }[]
let saved: number
const HEADING = 'Angekündigte Anpassung der Vorauszahlung'

beforeEach(() => {
  posts = []
  saved = 0
  plan = { items: [item()], errors: [], sentAt: '2026-03-03', token: 'marke-1' }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    posts.push({ url: path, body })
    if (path.endsWith('/prepayment-steps/plan')) {
      const months = (body.months ?? {}) as Record<string, string>
      return json({ ...plan, items: plan.items.map((it) => ({ ...it, from: months[it.tenancyId] ?? it.from })) })
    }
    if (path.endsWith('/prepayment-steps')) {
      plan = { ...plan, items: plan.items.map((it) => ({ ...it, state: 'taken' as const, currentCents: it.cents })) }
      return json({ ok: true })
    }
    return json({}, 404)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const show = () => render(<UIProvider><PrepaymentStepsCard path="/api/settlement/2025" propertyId={null} onSaved={() => { saved++ }} /></UIProvider>)
const cardOf = async (): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { name: HEADING }, SLOW)
  const card = heading.closest('section')
  if (!card) throw new Error('keine Karte')
  return card
}

test('#317: Stand je Mieter und Übernehmen mit geändertem Monat und Marke', async () => {
  show()
  const card = await cardOf()
  expect(plain(card.textContent)).toContain('Vorauszahlung 50,00 € ab Mai 2026: noch nicht in der Staffel (dort 40,00 €).')
  fireEvent.click(within(card).getByRole('button', { name: /In die Staffel übernehmen\s*\(Erika\)/ }))
  const dialog = await screen.findByRole('dialog', { name: 'In die Staffel übernehmen' }, SLOW)
  const month = within(dialog).getByRole('textbox', { name: /Ab Monat/ })
  fireEvent.change(month, { target: { value: '6.2026' } })
  fireEvent.blur(month)
  await waitFor(() => expect(posts.some((p) => p.url.endsWith('/plan') && (p.body.months as Record<string, string> | undefined)?.t1 === '2026-06')).toBe(true), SLOW)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(saved).toBe(1), SLOW)
  expect(posts.find((p) => p.url === '/api/settlement/2025/prepayment-steps')?.body).toEqual({ tenancyIds: ['t1'], months: { t1: '2026-06' }, token: 'marke-1' })
  await waitFor(async () => expect(plain((await cardOf()).textContent)).toContain('steht in der Staffel'), SLOW)
})

test('#317: angekündigt, aber nicht übernommen; Rückfrage bei vorhandener Stufe, Abbrechen sendet nichts', async () => {
  plan = { ...plan, items: [item({ overdue: true, existing: [{ from: '2026-05', monthlyCents: 4500 }] }), item({ tenancyId: 't2', tenantName: 'Paul', unitName: 'OG' })] }
  show()
  const card = await cardOf()
  expect(plain(card.textContent)).toContain('Angekündigt, aber noch nicht in der Staffel: Erika (50,00 € ab Mai 2026).')
  fireEvent.click(within(card).getByRole('button', { name: 'Alle in die Staffel übernehmen' }))
  const dialog = await screen.findByRole('dialog', { name: 'In die Staffel übernehmen' }, SLOW)
  expect(within(dialog).getAllByRole('textbox', { name: /Ab Monat/ })).toHaveLength(2)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  const question = await screen.findByRole('alertdialog', {}, SLOW)
  expect(plain(question.textContent)).toMatch(/Erika: Ab Mai 2026 steht in der Staffel schon 45,00 € ab Mai 2026\..*203 C 73\/23/)
  fireEvent.click(within(question).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), SLOW)
  expect(posts.some((p) => p.url === '/api/settlement/2025/prepayment-steps')).toBe(false)
})

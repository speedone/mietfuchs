// @vitest-environment jsdom
// Der Wechsel des Abrechnungszeitraums über die Vorschau (#208, Durchsicht von #226, M2), als Ablauf mit dem
// Server: Vorschau, Antworten, Wechsel und die 409 mit neuer Vorschau. Diese Tests halten die Anfragen fest,
// mit genau diesen Rümpfen; das Seitenfenster aus #346 Schritt 7 ändert, wo die Felder stehen, aber keine
// Anfrage und keinen Rumpf.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PropertyProvider } from '../property'
import { UIProvider } from './feedback'
import PeriodCard from './PeriodCard'
import { periodKey } from '../../../shared/period.ts'
import type { PeriodChangePreview } from '../types'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const PROPERTY = { id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, periodRules: { startMonth: 1, changes: [] } }
const RULES_MAY = { startMonth: 1, changes: ['2027-05'] }

const preview = (token: string, extra: Partial<PeriodChangePreview> = {}): PeriodChangePreview => ({
  rules: RULES_MAY,
  periods: [
    { key: periodKey('2027-01'), label: '01.01.2027–30.04.2027', short: true },
    { key: periodKey('2027-05'), label: '01.05.2027–30.04.2028', short: false },
  ],
  newShort: [{ key: periodKey('2027-01'), label: '01.01.2027–30.04.2027' }],
  blocked: [],
  moves: [],
  groups: [{
    id: 'g1', from: periodKey('2027-01'), fromLabel: '2027', heating: false,
    items: [{ costItemId: 'c1', description: 'Grundsteuer', amountCents: 120000 }],
    options: [{ key: periodKey('2027-01'), label: '01.01.2027–30.04.2027' }, { key: periodKey('2027-05'), label: '01.05.2027–30.04.2028' }],
    split: { range: '01.01.2027–31.12.2027', items: [{ costItemId: 'c1', parts: [{ period: periodKey('2027-01'), label: 'Rumpf', amountCents: 39452 }, { period: periodKey('2027-05'), label: '2027/2028', amountCents: 80548 }] }], notes: [] },
    taxShifts: [],
    suggested: 'split',
  }],
  effects: [],
  overrides: [{ tenancyId: 't1', tenantName: 'Müller', from: [{ key: periodKey('2027-01'), label: '2027', cents: 180000 }], ask: [{ period: periodKey('2027-01'), label: 'Rumpf', months: 'Januar bis April 2027' }] }],
  assessments: [],
  keptTaxYears: [],
  taxYears: [{ key: 'c1|2027-05', costItemId: 'c1', description: 'Grundsteuer', period: periodKey('2027-05'), label: '2027/2028', suggested: 2027, options: [2027, 2028] }],
  token,
  ...extra,
})

let sent: { url: string; method: string; body: unknown }[]
let putAnswers: { status: number; body: unknown }[]
let previewExtra: Partial<PeriodChangePreview>

beforeEach(() => {
  sent = []
  putAnswers = []
  previewExtra = {}
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (method === 'GET') return json(url.startsWith('/api/properties') ? [PROPERTY] : [])
    const body: unknown = JSON.parse(String(init?.body ?? '{}'))
    sent.push({ url, method, body })
    if (url.endsWith('/period/preview')) return json(preview('marke-1', previewExtra))
    const next = putAnswers.shift()
    return next ? json(next.body, next.status) : json({ ...PROPERTY, periodRules: RULES_MAY })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const show = async () => {
  const onChanged = vi.fn(async () => {})
  render(<UIProvider><PropertyProvider><PeriodCard onChanged={onChanged} /></PropertyProvider></UIProvider>)
  await screen.findByText(/Kalenderjahr/, {}, SLOW)
  return onChanged
}

/** Öffnet den Wechsel, trägt Mai 2027 ein und holt die Vorschau. */
const askPreview = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Abrechnungszeitraum ändern' }))
  const box = await screen.findByRole('dialog', { name: 'Abrechnungszeitraum ändern' }, SLOW)
  fireEvent.change(within(box).getByRole('textbox', { name: 'Neuer Zeitraum beginnt ab Monat' }), { target: { value: '05.2027' } })
  fireEvent.click(within(box).getByRole('button', { name: 'Vorschau' }))
  await within(box).findByText(/Nach dem Wechsel/, {}, SLOW)
  return box
}
const save = (box: HTMLElement) => fireEvent.click(within(box).getByRole('button', { name: 'Speichern' }))

const PREVIEW_REQUEST = { url: '/api/properties/objekt-1/period/preview', method: 'POST', body: { rules: RULES_MAY } }

test('Vorschau und Wechsel: genau diese beiden Anfragen, mit den Antworten aus der Vorschau', async () => {
  const onChanged = await show()
  const box = await askPreview()
  expect(sent).toEqual([PREVIEW_REQUEST])
  fireEvent.change(within(box).getByLabelText(/tatsächlich gezahlt Januar bis April 2027/), { target: { value: '600,00' } })
  fireEvent.change(within(box).getByLabelText(/Jahr der Zahlung \(Steuer\) für „Grundsteuer“/), { target: { value: '2028' } })
  save(box)
  await waitFor(() => expect(sent).toHaveLength(2), SLOW)
  expect(sent[1]).toEqual({
    url: '/api/properties/objekt-1/period', method: 'PUT',
    body: { rules: RULES_MAY, answers: { groups: { g1: 'split' }, overrides: { t1: { '2027-01': 60000 } }, taxYears: { 'c1|2027-05': 2028 }, token: 'marke-1', understood: false } },
  })
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1), SLOW)
})

test('Ohne Antwort zur Jahreskorrektur wird nicht gespeichert, und die Meldung sagt, was fehlt', async () => {
  await show()
  const box = await askPreview()
  save(box)
  expect(await within(box).findByText(/Bitte tragen Sie für Müller ein, was Januar bis April 2027 tatsächlich gezahlt wurde/, {}, SLOW)).toBeTruthy()
  expect(sent).toEqual([PREVIEW_REQUEST])
})

test('409 mit neuer Vorschau: die neue ersetzt die alte, die Antworten bleiben, gespeichert wird mit der neuen Marke', async () => {
  putAnswers = [{ status: 409, body: { error: 'Der Bestand hat sich geändert.', preview: preview('marke-2') } }]
  await show()
  const box = await askPreview()
  fireEvent.click(within(box).getByLabelText(/keine Korrektur \(die Staffel gilt\)/))
  save(box)
  expect(await within(box).findByText(/Der Bestand hat sich geändert\. Bitte prüfen Sie die Vorschau erneut\./, {}, SLOW)).toBeTruthy()
  save(box)
  await waitFor(() => expect(sent).toHaveLength(3), SLOW)
  expect(sent[1]?.body).toEqual({ rules: RULES_MAY, answers: { groups: { g1: 'split' }, overrides: { t1: { '2027-01': null } }, taxYears: { 'c1|2027-05': 2027 }, token: 'marke-1', understood: false } })
  expect(sent[2]?.body).toEqual({ rules: RULES_MAY, answers: { groups: { g1: 'split' }, overrides: { t1: { '2027-01': null } }, taxYears: { 'c1|2027-05': 2027 }, token: 'marke-2', understood: false } })
})

test('Abgelaufene Frist: Speichern erst mit der Bestätigung, und sie geht mit', async () => {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (method === 'GET') return json(url.startsWith('/api/properties') ? [PROPERTY] : [])
    sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
    if (url.endsWith('/period/preview')) {
      return json(preview('marke-1', { overrides: [], taxYears: [], effects: [{ label: '2027', deadline: '2028-12-31', passed: true, replaces: [], tenants: [], lostClaimsCents: 0 }] }))
    }
    return json({ ...PROPERTY, periodRules: RULES_MAY })
  })
  await show()
  const box = await askPreview()
  const knopf = within(box).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement
  expect(knopf.disabled).toBe(true)
  fireEvent.click(within(box).getByLabelText(/Ich habe verstanden/))
  expect(knopf.disabled).toBe(false)
  save(box)
  await waitFor(() => expect(sent).toHaveLength(2), SLOW)
  expect(sent[1]?.body).toEqual({ rules: RULES_MAY, answers: { groups: { g1: 'split' }, overrides: {}, taxYears: {}, token: 'marke-1', understood: true } })
})

test('Wechsel entfernen: das Fenster holt die Vorschau ohne den Wechsel, Speichern schickt sie wie bisher', async () => {
  const withChange = { ...PROPERTY, periodRules: RULES_MAY }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (method === 'GET') return json(url.startsWith('/api/properties') ? [withChange] : [])
    sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
    if (url.endsWith('/period/preview')) return json(preview('marke-3', { rules: { startMonth: 1, changes: [] }, overrides: [], taxYears: [], groups: [] }))
    return json(PROPERTY)
  })
  render(<UIProvider><PropertyProvider><PeriodCard /></PropertyProvider></UIProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Wechsel ab Mai 2027 entfernen …' }, SLOW))
  const box = await screen.findByRole('dialog', { name: 'Wechsel ab Mai 2027 entfernen' }, SLOW)
  await within(box).findByText(/Nach dem Wechsel/, {}, SLOW)
  expect(within(box).queryByRole('textbox', { name: 'Neuer Zeitraum beginnt ab Monat' })).toBeNull()
  save(box)
  await waitFor(() => expect(sent).toHaveLength(2), SLOW)
  expect(sent).toEqual([
    { url: '/api/properties/objekt-1/period/preview', method: 'POST', body: { rules: { startMonth: 1, changes: [] } } },
    { url: '/api/properties/objekt-1/period', method: 'PUT', body: { rules: { startMonth: 1, changes: [] }, answers: { groups: {}, overrides: {}, taxYears: {}, token: 'marke-3', understood: false } } },
  ])
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW)
})

test('Vor der Vorschau ist Speichern gesperrt, und das Fenster sagt warum', async () => {
  await show()
  fireEvent.click(screen.getByRole('button', { name: 'Abrechnungszeitraum ändern' }))
  const box = await screen.findByRole('dialog', { name: 'Abrechnungszeitraum ändern' }, SLOW)
  expect((within(box).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(box).getByText('Die Vorschau zeigt, was sich ändert; gespeichert wird erst danach.')).toBeTruthy()
  expect(sent).toEqual([])
})

// Durchsicht M2: Nach der Vorschau für Mai wurde das Feld auf September geändert, „Speichern“ blieb frei und schickte die
// Regeln der Vorschau für Mai. Jede Änderung im Formular verwirft jetzt Vorschau, Antworten und Bestätigung.
test('M2: eine Änderung nach der Vorschau sperrt Speichern bis zur neuen Vorschau; gesendet wird nie die alte', async () => {
  const SEPT = { startMonth: 1, changes: ['2027-09'] }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (method === 'GET') return json(url.startsWith('/api/properties') ? [PROPERTY] : [])
    const body = JSON.parse(String(init?.body ?? '{}')) as { rules?: unknown }
    sent.push({ url, method, body })
    if (url.endsWith('/period/preview')) return json(preview(JSON.stringify(body.rules), { rules: body.rules as typeof SEPT, overrides: [], taxYears: [], groups: [] }))
    return json({ ...PROPERTY, periodRules: body.rules })
  })
  await show()
  const box = await askPreview()
  const knopf = within(box).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement
  expect(knopf.disabled).toBe(false)
  fireEvent.change(within(box).getByRole('textbox', { name: 'Neuer Zeitraum beginnt ab Monat' }), { target: { value: '09.2027' } })
  expect(within(box).queryByText(/Nach dem Wechsel/)).toBeNull()
  expect(knopf.disabled).toBe(true)
  expect(within(box).getByText(/Fordern Sie die Vorschau erneut an/)).toBeTruthy()
  // Auch Strg+S speichert nicht.
  fireEvent.keyDown(box, { key: 's', ctrlKey: true })
  fireEvent.click(within(box).getByRole('button', { name: 'Vorschau' }))
  await within(box).findByText(/Nach dem Wechsel/, {}, SLOW)
  save(box)
  await waitFor(() => expect(sent).toHaveLength(3), SLOW)
  expect(sent.map((s) => [s.method, (s.body as { rules: unknown }).rules])).toEqual([['POST', RULES_MAY], ['POST', SEPT], ['PUT', SEPT]])
})

test('K2: scheitert die Vorschau zum Entfernen eines Wechsels, lässt sie sich erneut laden', async () => {
  let fails = 1
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (method === 'GET') return json(url.startsWith('/api/properties') ? [{ ...PROPERTY, periodRules: RULES_MAY }] : [])
    sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
    if (fails-- > 0) return json({ error: 'Server nicht erreichbar.' }, 503)
    return json(preview('marke-4', { rules: { startMonth: 1, changes: [] }, overrides: [], taxYears: [], groups: [] }))
  })
  render(<UIProvider><PropertyProvider><PeriodCard /></PropertyProvider></UIProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Wechsel ab Mai 2027 entfernen …' }, SLOW))
  const box = await screen.findByRole('dialog', { name: 'Wechsel ab Mai 2027 entfernen' }, SLOW)
  fireEvent.click(await within(box).findByRole('button', { name: 'Vorschau erneut laden' }, SLOW))
  await within(box).findByText(/Nach dem Wechsel/, {}, SLOW)
  expect(sent).toHaveLength(2)
})

test('Integrationsdurchsicht zu #415: die Vorschau nennt eigene Anschreiben, die mit dem Wechsel entfallen', async () => {
  previewExtra = { letters: ['Das eigene Anschreiben von Müller für 2027 entfällt, weil sich der Zeitraum ändert; danach gilt die Vorlage.'] }
  await show()
  const box = await askPreview()
  expect(within(box).getByText('Das eigene Anschreiben von Müller für 2027 entfällt, weil sich der Zeitraum ändert; danach gilt die Vorlage.')).toBeTruthy()
})

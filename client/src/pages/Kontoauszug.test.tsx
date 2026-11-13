// @vitest-environment jsdom
// Seite „Kontoauszug“ (#188, Teil 3): Einlesen mit Vorschau und Rückfragen, offene Umsätze zuordnen, Konten. Der
// Server ist nachgebaut; geprüft wird, was die Seite schickt und zeigt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { UIProvider } from '../components/feedback'
import type { BankAccountInfo, BankImportPreview, BankLinkPreview, BankTransactionView } from '../types'
import Kontoauszug from './Kontoauszug'

const OWN = 'DE89370400440532013000'
const tenancies = [{ id: 't1', label: 'Erika Beispiel, EG (Haus A)' }, { id: 't2', label: 'Max Muster, OG (Haus A)' }]

const tx = (id: string, amountCents: number, over: Partial<BankTransactionView> = {}): BankTransactionView => ({
  id, bookingDate: '2025-06-02', valueDate: null, amountCents, counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE02120300000000202051',
  ultimatePartyName: null, purpose: 'Miete Juni', reversal: false, setAside: null, openCents: amountCents, links: [],
  suggestion: { tenancyId: 't1', target: { type: 'newPayment', kind: 'rent' }, light: 'green', reason: 'IBAN bekannt, Betrag wie Monatsmiete' }, ...over,
})
const account = (over: Partial<BankAccountInfo> = {}): BankAccountInfo => ({
  id: 'a1', iban: OWN, otherId: null, label: 'Konto 3000', kind: 'mixed', rentalConfirmedAt: null, coverage: { from: '2025-06-01', to: '2025-06-30' },
  imports: [{ id: 'i1', fileName: 'juni.xml', format: 'camt.053', fromDate: '2025-06-01', toDate: '2025-06-30', importedAt: '2025-07-01T08:00:00Z' }], ...over,
})
const preview = (over: Partial<BankImportPreview> = {}): BankImportPreview => ({
  questions: [{ type: 'account', iban: OWN, otherId: null }], findings: [], summary: { stored: 2, knownDays: 0, pending: 0 },
  sentence: '2 Umsätze übernommen.', ready: false, token: 'marke-1', ...over,
})

type Sent = { url: string; method: string; body: unknown }
let sent: Sent[]
let open: BankTransactionView[]
let done: BankTransactionView[]
let accounts: BankAccountInfo[]
let planReply: (decisions: unknown) => BankImportPreview
let importReply: () => Response
let linkPlanReply: (decisions: unknown) => BankLinkPreview
let linkReply: () => Response
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  sent = []
  open = []
  done = []
  accounts = []
  planReply = (d) => preview(Array.isArray(d) && d.length > 0 ? { questions: [], ready: true, token: 'marke-2' } : {})
  importReply = () => json({ ok: true, sentence: '2 Umsätze übernommen.' })
  linkPlanReply = () => ({ problems: [], sentence: '1 Zahlung gebucht.', token: 'link-1' })
  linkReply = () => json({ ok: true, sentence: '1 Zahlung gebucht.' })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const [path, query] = url.split('?')
    let body: unknown = null
    if (init?.body instanceof FormData) {
      body = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `Datei ${(v as File).name}`]))
    } else if (typeof init?.body === 'string') body = JSON.parse(init.body)
    sent.push({ url, method, body })
    if (path === '/api/bank/accounts' && method === 'GET') return json(accounts)
    if (path === '/api/bank/tenancies') return json(tenancies)
    if (path === '/api/bank/transactions' && method === 'GET') return json(query === 'state=done' ? done : open)
    if (path === '/api/bank/import/plan') return json(planReply(JSON.parse(String((body as Record<string, string>).decisions ?? '[]'))))
    if (path === '/api/bank/import') return importReply()
    if (path === '/api/bank/links/plan') return json(linkPlanReply((body as { decisions: unknown }).decisions))
    if (path === '/api/bank/links') return linkReply()
    return json({ ok: true })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderPage = () => render(<UIProvider><Kontoauszug /></UIProvider>)
const posts = (path: string) => sent.filter((s) => s.method !== 'GET' && s.url.split('?')[0] === path)
const chooseFile = async () => {
  const input = await screen.findByLabelText('Datei mit Kontoauszügen', { selector: 'input' })
  fireEvent.change(input, { target: { files: [new File(['<x/>'], 'juni.xml', { type: 'text/xml' })] } })
}
const confirmDialog = async (label: string) => {
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: label }))
  return dialog
}

test('Leerzustand: ein Satz und der Knopf zum Einlesen, keine leere Tabelle; der Satz zur Aufbewahrung steht da', async () => {
  renderPage()
  expect(await screen.findByText(/Noch kein Kontoauszug eingelesen/)).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Kontoauszug einlesen' }).length).toBeGreaterThan(0)
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByText('Bewahren Sie die Kontoauszüge Ihrer Bank selbst auf. Mietfuchs ersetzt sie nicht.')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/GoBD|revisionssicher|Einnahmen vollständig/)
})

test('Einlesen: Vorschau mit Rückfrage zum Konto, Antwort plant neu, „Einlesen“ schickt Datei, Antworten und Marke', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  renderPage()
  await chooseFile()
  const drawer = await screen.findByRole('dialog')
  expect(within(drawer).getByText(`Das Konto ${OWN} wurde noch nie eingelesen. Ist es Ihr Konto für Mieteingänge?`)).toBeTruthy()
  expect(within(drawer).getByText('Ein Kautionskonto lesen Sie hier bitte nicht ein.')).toBeTruthy()
  expect(within(drawer).getByText('2 Umsätze übernommen.')).toBeTruthy()
  const read = within(drawer).getByRole('button', { name: 'Einlesen' }) as HTMLButtonElement
  expect(read.disabled).toBe(true)
  fireEvent.click(within(drawer).getByLabelText('Ja, mein Konto für Mieteingänge'))
  await waitFor(() => expect(posts('/api/bank/import/plan').length).toBe(2))
  expect(JSON.parse(String((posts('/api/bank/import/plan')[1]?.body as Record<string, string>).decisions))).toEqual([{ type: 'account', iban: OWN, accept: true }])
  await waitFor(() => expect(read.disabled).toBe(false))
  fireEvent.click(read)
  await waitFor(() => expect(posts('/api/bank/import').length).toBe(1))
  expect(posts('/api/bank/import')[0]?.body).toEqual({ statement: 'Datei juni.xml', decisions: JSON.stringify([{ type: 'account', iban: OWN, accept: true }]), token: 'marke-2' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(setItem.mock.calls.filter(([, v]) => String(v).includes('Erika') || String(v).includes(OWN))).toEqual([])
})

test('Einlesen: Rückfrage je Eingang mit Mietverhältnis und „als Zahler merken“, ab Werk an', async () => {
  planReply = () => preview({ questions: [{ type: 'entry', key: '0:2025-06-02:1', bookingDate: '2025-06-02', amountCents: 50000, counterpartyName: 'Neues Konto', counterpartyIban: 'DE75512108001245126199', purpose: 'Miete Juni' }] })
  renderPage()
  await chooseFile()
  const drawer = await screen.findByRole('dialog')
  const kind = within(drawer).getByLabelText(/Was ist der Eingang/) as HTMLSelectElement
  expect([...kind.options].map((o) => o.text)).toEqual(['Bitte wählen', 'Mieteingang', 'Kaution', 'privat'])
  fireEvent.change(kind, { target: { value: 'rent' } })
  fireEvent.change(within(drawer).getByLabelText('Mietverhältnis'), { target: { value: 't1' } })
  expect((within(drawer).getByLabelText('Dieses Konto als Zahler merken') as HTMLInputElement).checked).toBe(true)
  await waitFor(() => expect(posts('/api/bank/import/plan').length).toBeGreaterThanOrEqual(2))
  const last = posts('/api/bank/import/plan').at(-1)?.body as Record<string, string>
  expect(JSON.parse(last.decisions ?? '[]')).toEqual([{ type: 'entry', key: '0:2025-06-02:1', as: 'rent', tenancyId: 't1', rememberPayer: true }])
})

test('Einlesen: 409 zeigt die neue Vorschau mit Satz; Abbrechen verwirft alles', async () => {
  importReply = () => json({ error: 'Der Stand hat sich geändert. Bitte prüfen Sie die Vorschau noch einmal.', preview: preview({ questions: [], ready: true, token: 'marke-3', sentence: '1 Umsatz übernommen.' }) }, 409)
  planReply = () => preview({ questions: [], ready: true })
  renderPage()
  await chooseFile()
  const drawer = await screen.findByRole('dialog')
  await waitFor(() => expect((within(drawer).getByRole('button', { name: 'Einlesen' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(within(drawer).getByRole('button', { name: 'Einlesen' }))
  expect(await within(drawer).findByText('Der Stand hat sich geändert. Bitte prüfen Sie die Vorschau noch einmal.')).toBeTruthy()
  expect(within(drawer).getByText('1 Umsatz übernommen.')).toBeTruthy()
  fireEvent.click(within(drawer).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await chooseFile()
  const again = await screen.findByRole('dialog')
  expect(within(again).queryByText('1 Umsatz übernommen.')).toBeNull()
})

test('Offene Umsätze: Zeile mit Ampel und Grund als Text, „Alle grünen übernehmen (n)“ fragt einmal und bucht genau die grünen', async () => {
  accounts = [account()]
  open = [tx('x1', 85000), tx('x2', 30000, { suggestion: { tenancyId: 't1', target: { type: 'newPayment', kind: 'rent' }, light: 'yellow', reason: 'Betrag weicht vom Soll ab (850,00 €)' } })]
  renderPage()
  const table = await screen.findByRole('table', { name: 'Offene Umsätze' })
  expect(within(table).getByText('IBAN bekannt, Betrag wie Monatsmiete')).toBeTruthy()
  expect(within(table).getByText('Betrag weicht vom Soll ab (850,00 €)')).toBeTruthy()
  expect(within(table).getAllByText('02.06.2025').length).toBe(2)
  const rentSelect = within(table).getAllByLabelText('Mietverhältnis')[0] as HTMLSelectElement
  expect(rentSelect.value).toBe('t1')
  expect(rentSelect.selectedOptions[0]?.text).toBe('Erika Beispiel, EG (Haus A)')
  fireEvent.click(screen.getByRole('button', { name: 'Alle grünen übernehmen (1)' }))
  const dialog = await confirmDialog('Buchen')
  expect(dialog.textContent).toMatch(/1 Umsatz über 850,00\s€/)
  await waitFor(() => expect(posts('/api/bank/links').length).toBe(1))
  expect(posts('/api/bank/links')[0]?.body).toEqual({ decisions: [{ transactionId: 'x1', parts: [{ tenancyId: 't1', amountCents: 85000, target: { type: 'newPayment', kind: 'rent' } }] }], token: 'link-1' })
})

test('Offene Umsätze: 409 nennt den Grund, nichts ist gebucht, die Auswahl bleibt; ein Problem steht an der Zeile', async () => {
  accounts = [account()]
  open = [tx('x1', 85000)]
  linkReply = () => json({ error: 'Der Stand hat sich geändert. Bitte prüfen Sie die Vorschau noch einmal.', preview: { problems: [], sentence: '', token: 'link-2' } }, 409)
  renderPage()
  const table = await screen.findByRole('table', { name: 'Offene Umsätze' })
  fireEvent.change(within(table).getAllByLabelText('Mietverhältnis')[0] as HTMLSelectElement, { target: { value: 't2' } })
  fireEvent.click(within(table).getByRole('button', { name: /^Buchen/ }))
  expect(await screen.findByText('Der Stand hat sich geändert. Bitte prüfen Sie die Vorschau noch einmal.')).toBeTruthy()
  expect((within(screen.getByRole('table', { name: 'Offene Umsätze' })).getAllByLabelText('Mietverhältnis')[0] as HTMLSelectElement).value).toBe('t2')
  linkPlanReply = () => ({ problems: [{ transactionId: 'x1', message: 'Die Teile ergeben mehr als den Umsatz (900,00 € statt 850,00 €).' }], sentence: '', token: 'link-3' })
  fireEvent.click(within(screen.getByRole('table', { name: 'Offene Umsätze' })).getByRole('button', { name: /^Buchen/ }))
  expect(await screen.findByText('Die Teile ergeben mehr als den Umsatz (900,00 € statt 850,00 €).')).toBeTruthy()
})

test('Konten: Art, Satz zur Lückenlosigkeit, Import zurücknehmen und „nur für die Vermietung“ mit Rückfrage', async () => {
  accounts = [account()]
  renderPage()
  expect(await screen.findByText('Konto lückenlos eingelesen vom 01.06.2025 bis 30.06.2025.')).toBeTruthy()
  expect(screen.getByText(/Mischkonto/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Zurücknehmen …/ }))
  await confirmDialog('Zurücknehmen')
  await waitFor(() => expect(sent.some((s) => s.method === 'DELETE' && s.url === '/api/bank/imports/i1')).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'Nur für die Vermietung …' }))
  const dialog = await confirmDialog('Umstellen')
  expect(dialog.textContent).toMatch(/Ab jetzt wird jeder Umsatz dieses Kontos einzeln gespeichert, auch ein privater\./)
  await waitFor(() => expect(sent.find((s) => s.method === 'PUT' && s.url === '/api/bank/accounts/a1')?.body).toEqual({ kind: 'rental', confirm: true }))
})

test('Erledigte Umsätze: „Lösen …“ behält die Zahlung ab Werk', async () => {
  accounts = [account()]
  done = [tx('x9', 85000, { openCents: 0, suggestion: null, links: [{ id: 'l1', paymentId: 'p1', depositEntryId: null, created: true, cents: 85000, tenancyId: 't1' }] })]
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Erledigte Umsätze zeigen' }))
  fireEvent.click(await screen.findByRole('button', { name: /^Lösen …/ }))
  await confirmDialog('Lösen, Zahlung behalten')
  await waitFor(() => expect(sent.some((s) => s.method === 'DELETE' && s.url === '/api/bank/links/l1')).toBe(true))
})

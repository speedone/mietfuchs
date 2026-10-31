// @vitest-environment jsdom
// Der Ordner der Seite Belege (#170): Filter nach Objekt und Jahr, Register je Kostenart, Suche. Die
// Entscheidungslogik prüft receipts.test.ts; hier geht es um das, was nur die Seite zeigt,
// vor allem darum, dass die Auswahlfelder den Wert anzeigen, nach dem tatsächlich gefiltert wird.
import { calendarPeriod, periodContaining, periodKey, periodLabel } from '../../../shared/period.ts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AssessmentView, CostItem, Property, Settings, UploadInfo } from '../types'
import { fakeBooking } from '../testing/fakeBooking'
import { PeriodProvider } from '../period'
import { PropertyProvider, useHasOpenForm } from '../property'
import { UIProvider } from '../components/feedback'
import { useState } from 'react'
import type { ReceiptUpload } from '../receipts'
import Belege from './Belege'
import { PLACEMENT_FIRST } from '../components/ReceiptParts'
import { PeriodSelect } from '../components/PeriodSelect'

const PROPS: Property[] = [
  { id: 'p1', name: 'Lindenstraße', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
  { id: 'p2', name: 'Ahornweg', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
] as Property[]

const YEAR = new Date().getFullYear() - 1

const up = (file: string, sha = file): UploadInfo => ({
  file, size: 2048, mtime: '2026-01-02T10:00:00.000Z', originalName: file.replace(/^\d+_/, ''), mimeType: 'application/pdf',
  uploadedAt: '2026-01-02T10:00:00.000Z', sha256: sha, propertyId: null, year: null, invoiceDate: null, kind: 'receipt',
})

const ITEMS: Record<string, CostItem[]> = {
  p1: [
    { id: 'gs', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer B', amountCents: 60000, key: 'area', invoiceFile: '1_gs.pdf', vendor: 'Stadt' },
    { id: 'w1', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 98000, key: 'area', invoiceFile: '2_wasser.pdf', vendor: 'Stadtwerke' },
    { id: 'w2', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Wasser/Abwasser', description: 'Abwasser', amountCents: 26000, key: 'area' },
  ],
  p2: [
    { id: 'x', propertyId: 'p2', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer Ahornweg', amountCents: 40000, key: 'area', invoiceFile: '3_ahorn.pdf' },
  ],
}

let sent: { url: string; method: string; body: unknown }[]
// Für einzelne Tests: weitere Belege im Posteingang und Positionen im ersten Objekt
let extraUploads: ReceiptUpload[]
let extraItems: CostItem[]
let failAssessmentPut = false
// Die abgeschlossene Abrechnung des Jahres, falls es eine gibt (Integrationsdurchsicht vor 0.10)
let closed: { closedAt: string } | null = null
// Die Heizanlagen des ersten Objekts (Sichtprüfung E32)
let plantsP1: unknown[] = []
// Für einzelne Tests: Objekte mit eigenem Rhythmus
let propsOverride: Property[] | null = null
// Was die KI über sich sagt (GET /api/ai/status) und die offenen Auswertungen des Objekts
let aiStatus: { ok: boolean; error?: string; reason?: string } = { ok: true }
// Eine Auswertung, die nicht antwortet (läuft, bis der Test endet)
let holdIntake = false
// Die Antwort einer gescheiterten Auswertung, wo der Test sie vorgibt
let intakeFailure: Record<string, unknown> | null = null
// Die Pfade aller GET-Anfragen
let fetched: string[] = []
// Gelöschte Belege (DELETE /api/uploads/…)
let deleted = new Set<string>()
let openAssessments: () => AssessmentView[] = () => []

// Die Abrechnung des Jahres, nur mit dem, was die Belegmappe liest: die Zeilen der Mieter
const SETTLEMENT = {
  year: YEAR, statements: [{ rows: [{ costItemId: 'w1' }, { costItemId: 'gs' }, { costItemId: 'w2' }] }],
  landlord: { rows: [], totalCents: 0 },
}

beforeEach(() => {
  localStorage.clear()
  sent = []
  extraUploads = []
  extraItems = []
  failAssessmentPut = false
  closed = null
  plantsP1 = []
  propsOverride = null
  aiStatus = { ok: true }
  holdIntake = false
  intakeFailure = null
  fetched = []
  deleted = new Set()
  openAssessments = () => []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x')
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : (v as File).name])) : JSON.parse(String(init?.body ?? '{}'))
      sent.push({ url: u.pathname, method, body })
      if (failAssessmentPut && u.pathname.startsWith('/api/assessments/')) return new Response(JSON.stringify({ error: 'Zeilen sind schon gebucht.' }), { status: 409, headers: { 'content-type': 'application/json' } })
      // Die KI-Auswertung: hier nur, dass sie ankommt (gescheitert, der Beleg bleibt gespeichert)
      if (u.pathname === '/api/intake' && holdIntake) return new Promise<Response>(() => {})
      if (u.pathname === '/api/intake' && intakeFailure) return new Response(JSON.stringify(intakeFailure), { status: 502, headers: { 'content-type': 'application/json' } })
      if (u.pathname === '/api/intake') return new Response(JSON.stringify({ error: 'Ollama antwortet nicht.', file: String(body.existingFile ?? '4_lose.pdf'), reason: 'unreachable', kept: true }), { status: 502, headers: { 'content-type': 'application/json' } })
      if (method === 'DELETE' && u.pathname.startsWith('/api/uploads/')) deleted.add(decodeURIComponent(u.pathname.slice('/api/uploads/'.length)))
      const answer = u.pathname === '/api/upload' ? { file: '99_nachgereicht.pdf' } : { ok: true }
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    fetched.push(u.pathname)
    let body: unknown = []
    if (u.pathname === '/api/properties') body = propsOverride ?? PROPS
    else if (u.pathname === '/api/uploads') body = [up('1_gs.pdf'), up('2_wasser.pdf'), up('3_ahorn.pdf'), up('4_lose.pdf', '1_gs.pdf'), ...extraUploads].filter((x) => !deleted.has(x.file))
    else if (u.pathname === '/api/costItems') body = [...(ITEMS[u.searchParams.get('property') ?? 'p1'] ?? []), ...(u.searchParams.get('property') === 'p2' ? [] : extraItems)]
    else if (u.pathname === '/api/heating-plants') body = u.searchParams.get('property') === 'p2' ? [] : plantsP1
    else if (u.pathname.startsWith('/api/settlement/')) body = closed ? { ...SETTLEMENT, closed } : SETTLEMENT
    else if (u.pathname === '/api/ai/status') body = aiStatus
    else if (u.pathname === '/api/assessments') body = openAssessments()
    else if (u.pathname.startsWith('/uploads/')) return new Response(new Blob(['%PDF'], { type: 'application/pdf' }), { status: 200 })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Die Seite Belege (#490) mit beiden Ansichten; ohne Angabe die Ansicht „Ordner“, deren Tests hier stehen. Was früher
// im Posteingang des Ordners stand, steht im Eingang (`view: 'eingang'`).
const BASE = { units: [], settings: null, onNavigate: () => {}, view: 'ordner' as const }

const renderPage = (view: 'eingang' | 'ordner' = 'ordner') =>
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view={view} renderThumb={() => Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=')} />
      </PropertyProvider>
    </PeriodProvider>,
  )

const renderInbox = () => renderPage('eingang')

// Eine offene Auswertung des ersten Objekts für den Eingang
const assessmentOf = (id: string, file: string): AssessmentView => ({
  ...fakeBooking({ items: [], units: [], propertyId: 'p1' }).evaluate(file, { vendor: 'Stadt', invoiceDate: `${YEAR}-03-01`, positions: [{ description: 'Grundsteuer', category: 'Grundsteuer', amountEur: 100 }] } as never, { year: YEAR }),
  id, propertyId: 'p1',
})

const context = () => screen.getByTestId('page-context').textContent

test('zeigt das gewählte Objekt und Jahr, je Kostenart ein Register mit Summe', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  // Objekt und Jahr der Seitenleiste stehen im Seitenkopf; eine eigene Auswahl hat der Ordner nicht mehr (#346 Schritt 8, M13).
  expect(context()).toBe(`Lindenstraße · Abrechnungsjahr ${YEAR}`)
  expect(screen.queryByRole('combobox', { name: 'Objekt' })).toBeNull()
  expect(screen.queryByRole('combobox', { name: 'Jahr' })).toBeNull()
  const wasser = screen.getByText('Wasser/Abwasser').closest('details') as HTMLElement
  expect(within(wasser).getByText('1.240,00 €')).toBeTruthy()
  expect(within(wasser).getByText(/1 von 2 Positionen ohne Beleg/)).toBeTruthy()
  expect(within(wasser).getByText(/Abwasser · 260,00 €/)).toBeTruthy()
  expect(screen.queryByText('Grundsteuer Ahornweg', { exact: false })).toBeNull()
})

// Sichtprüfung E32: Nach dem Wechsel auf eine eigene Heizperiode trägt die Heizposition den Schlüssel
// ihrer Heizperiode (Mai bis April). Sie gehört in die Abrechnung des Jahres, in dem diese endet, und
// dort sucht man auch den Beleg; vorher stand er im Ordner des Vorjahres.
test('eine Heizposition mit eigener Heizperiode steht im Jahr ihrer Abrechnung', async () => {
  plantsP1 = [{ id: 'hp1', periodStartMonth: 5, periodChanges: [], separateSpans: [] }]
  extraItems = [{ id: 'hz', propertyId: 'p1', period: `${YEAR - 1}-05` as CostItem['period'], category: 'Heizung und Warmwasser', description: 'Erdgas', amountCents: 480000, key: 'area', invoiceFile: '5_erdgas.pdf', heatingPlantId: 'hp1' }]
  extraUploads = [up('5_erdgas.pdf')]
  renderPage()
  await screen.findByText('Heizung und Warmwasser')
  expect(context()).toBe(`Lindenstraße · Abrechnungsjahr ${YEAR}`)
  // 600 + 980 + 4.800 von 600 + 980 + 260 + 4.800 Euro sind belegt
  expect(screen.getByText(/Belegabdeckung/).closest('.receipt-coverage')?.textContent).toMatch(/96 %.*1 Position ohne Beleg/)
})

test('„alle Objekte“ zeigt auch die Belege des anderen Objekts, mit dessen Namen', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Belege aller Objekte zeigen' }))
  await screen.findByText(/Grundsteuer Ahornweg/)
  expect(screen.getAllByText(/Ahornweg/).length).toBeGreaterThan(0)
})

// #346 Schritt 8 (M13): Das Jahr wählt die Seitenleiste; der Ordner kann darüber hinaus nur alle Jahre zeigen.
test('„aller Jahre“ zeigt auch die Positionen eines früheren Jahres', async () => {
  extraItems = [{ id: 'alt', propertyId: 'p1', period: calendarPeriod(YEAR - 3), category: 'Gartenpflege', description: 'Gartenpflege alt', amountCents: 10000, key: 'area' }]
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  expect(screen.queryAllByText(/Gartenpflege/)).toEqual([])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Belege aller Jahre zeigen' }))
  expect((await screen.findAllByText(/Gartenpflege/)).length).toBeGreaterThan(0)
})

// Durchsicht zu Schritt 8, K3: Der Posteingang sagt, wo die übrigen Belege zu sehen sind.
test('Eingang: Belege ohne Position eines anderen Objekts nennt eine Zeile mit dem Sprung dorthin', async () => {
  extraUploads = [{ ...up('9_anderswo.pdf'), propertyId: 'p2', year: YEAR }]
  renderInbox()
  const line = await screen.findByRole('group', { name: 'Belege ohne Position in anderen Objekten und Jahren' })
  expect(within(line).getByRole('button', { name: '1 Beleg bei „Ahornweg“ →' })).toBeTruthy()
  // Der Beleg selbst steht im Eingang dieses Objekts nicht
  expect(document.querySelector('[data-view="eingang"] li[data-file="9_anderswo.pdf"]')).toBeNull()
})

test('die Suche nach einem Betrag findet die Position ohne Beleg', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('Suche'), { target: { value: '260,00' } })
  await waitFor(() => expect(screen.queryByText('Grundsteuer')).toBeNull())
  expect(screen.getByText(/Abwasser · 260,00 €/)).toBeTruthy()
})

test('ein inhaltsgleicher Beleg wird als doppelt benannt, im Ordner wie im Eingang', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const hint = (view: string, file: string) => document.querySelector(`[data-view="${view}"] li[data-file="${file}"] .receipt-hint`)?.textContent
  await waitFor(() => expect(hint('eingang', '4_lose.pdf')).toMatch(/gleicher Inhalt wie/))
  expect(hint('ordner', '1_gs.pdf')).toMatch(/gleicher Inhalt wie/)
})

test('die Belegabdeckung nennt den Anteil der Kosten mit Beleg', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  // 600 + 980 von 600 + 980 + 260 Euro sind belegt
  expect(screen.getByText(/Belegabdeckung/).closest('.receipt-coverage')?.textContent).toMatch(/85 %.*1 Position ohne Beleg/)
})

test('„nachreichen“: Hochladen an der Position verknüpft den Beleg mit ihr', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const input = screen.getByLabelText('Beleg für Abwasser hochladen') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'abwasser.pdf', { type: 'application/pdf' })] } })
  await waitFor(() => expect(sent.some((r) => r.method === 'PUT')).toBe(true))
  const hoch = sent.find((r) => r.url === '/api/upload')
  expect(hoch?.body).toMatchObject({ file: 'abwasser.pdf', propertyId: 'p1', year: String(YEAR) })
  expect(sent.find((r) => r.method === 'PUT')).toEqual({ url: '/api/costItems/w2', method: 'PUT', body: { invoiceFile: '99_nachgereicht.pdf' } })
})

test('„nachreichen“: ein vorhandener, nicht zugeordneter Beleg lässt sich auswählen', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const auswahl = screen.getByLabelText('Vorhandenen Beleg für Abwasser zuordnen') as HTMLSelectElement
  // Das Feld zeigt „— wählen —“ und speichert nichts, bis jemand wählt.
  expect(auswahl.value).toBe('')
  fireEvent.change(auswahl, { target: { value: '4_lose.pdf' } })
  // #309: Die Wahl allein sendet nichts; erst „Speichern“ hängt den Beleg an, genau einmal.
  expect(sent).toEqual([])
  const knopf = screen.getByRole('button', { name: 'Speichern (Beleg für Abwasser)' })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  await waitFor(() => expect(sent).toEqual([{ url: '/api/costItems/w2', method: 'PUT', body: { invoiceFile: '4_lose.pdf' } }]))
})

test('„nachreichen“: „Verwerfen“ nimmt die Wahl zurück, ohne zu senden (#309)', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const auswahl = screen.getByLabelText('Vorhandenen Beleg für Abwasser zuordnen') as HTMLSelectElement
  fireEvent.change(auswahl, { target: { value: '4_lose.pdf' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Beleg für Abwasser)' }))
  expect(auswahl.value).toBe('')
  expect(sent).toEqual([])
})

test('Eingang: „Nur ablegen, ohne Auswertung“ speichert mehrere Belege, mit Objekt und Jahr der Auswahl', async () => {
  renderInbox()
  await screen.findByLabelText('Jahr für lose.pdf')
  const input = screen.getByLabelText('Belege nur ablegen, ohne Auswertung') as HTMLInputElement
  expect(input.multiple).toBe(true)
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'eins.pdf', { type: 'application/pdf' }), new File(['jpg'], 'zwei.jpg', { type: 'image/jpeg' }), new File(['x'], 'drei.docx', { type: 'application/msword' })] } })
  await waitFor(() => expect(sent.filter((r) => r.url === '/api/upload').length).toBe(2))
  expect(sent.map((r) => r.body)).toEqual([
    { file: 'eins.pdf', propertyId: 'p1', year: String(YEAR) },
    { file: 'zwei.jpg', propertyId: 'p1', year: String(YEAR) },
  ])
  // Was weder PDF noch Bild ist, fällt nicht still weg (#490: überall derselbe Satz)
  expect(screen.getByText(/Nur PDFs und Bilder lassen sich als Beleg hochladen/)).toBeTruthy()
})

// Regel 5 (#490): Sagt die KI, dass sie nicht erreichbar ist, speichert die Ablage nur; jeder Beleg steht danach unter
// „Ohne Position“, und „Per KI auswerten“ steht weiter an jedem Beleg.
// Die KI wird erst gefragt, wenn die Einstellungen da sind (ein Dienst im Internet nie); hier ein lokales Ollama.
const LOCAL = { aiExternal: { text: false, images: false } } as unknown as Settings
const renderInboxWith = (settings: Settings) => render(
  <PeriodProvider>
    <PropertyProvider>
      <Belege {...BASE} view="eingang" settings={settings} renderThumb={() => Promise.resolve('')} />
    </PropertyProvider>
  </PeriodProvider>,
)
const dropInto = (container: HTMLElement, files: File[]) =>
  fireEvent.change(container.querySelector('input[aria-label="Belege und Zählerfotos auswählen"]') as HTMLInputElement, { target: { files } })

test('Eingang ohne KI: die Ablage speichert nur, „Erneut prüfen“ fragt die KI noch einmal', async () => {
  aiStatus = { ok: false, error: 'nicht erreichbar', reason: 'unreachable' }
  const { container } = renderInboxWith(LOCAL)
  expect(await screen.findByText(/Die KI ist gerade nicht erreichbar\. Belege werden nur gespeichert/)).toBeTruthy()
  expect(screen.queryByLabelText('Belege nur ablegen, ohne Auswertung')).toBeNull()
  dropInto(container, [new File(['%PDF'], 'eins.pdf', { type: 'application/pdf' })])
  await waitFor(() => expect(sent).toEqual([{ url: '/api/upload', method: 'POST', body: { file: 'eins.pdf', propertyId: 'p1', year: String(YEAR) } }]))
  expect(screen.getByRole('button', { name: 'lose.pdf per KI auswerten' })).toBeTruthy()
  // Läuft die KI wieder, genügt „Erneut prüfen“
  aiStatus = { ok: true }
  fireEvent.click(screen.getByRole('button', { name: 'Erneut prüfen' }))
  await waitFor(() => expect(screen.queryByText(/Die KI ist gerade nicht erreichbar/)).toBeNull())
  expect(screen.getByLabelText('Belege nur ablegen, ohne Auswertung')).toBeTruthy()
})

// Durchsicht S2: Nur „nicht erreichbar“ heißt ohne KI. Eine Zeitüberschreitung beim Fragen ist keiner; die Ablage wertet aus.
test('Eingang: eine Zeitüberschreitung beim Fragen der KI ist kein „ohne KI“, die Ablage wertet aus', async () => {
  aiStatus = { ok: false, error: 'Zeitüberschreitung', reason: 'timeout' }
  const { container } = renderInboxWith(LOCAL)
  await screen.findByLabelText('Jahr für lose.pdf')
  await waitFor(() => expect(fetched).toContain('/api/ai/status'))
  expect(screen.queryByText(/Die KI ist gerade nicht erreichbar/)).toBeNull()
  dropInto(container, [new File(['jpg'], 'zwei.jpg', { type: 'image/jpeg' })])
  await waitFor(() => expect(sent.some((r) => r.url === '/api/intake')).toBe(true))
  expect(sent.some((r) => r.url === '/api/upload')).toBe(false)
})

// Durchsicht S2: Während eine Auswertung läuft, ist die KI offensichtlich erreichbar; kein „nicht erreichbar“ daneben.
test('Eingang: solange eine Auswertung läuft, steht kein „nicht erreichbar“ da', async () => {
  aiStatus = { ok: false, error: 'nicht erreichbar', reason: 'unreachable' }
  holdIntake = true
  extraUploads = [{ ...up('7_foto.jpg'), mimeType: 'image/jpeg' }]
  renderInboxWith(LOCAL)
  expect(await screen.findByText(/Die KI ist gerade nicht erreichbar/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'foto.jpg per KI auswerten' }))
  await waitFor(() => expect(sent.some((r) => r.url === '/api/intake')).toBe(true))
  await waitFor(() => expect(screen.queryByText(/Die KI ist gerade nicht erreichbar/)).toBeNull())
})

// Ohne Einstellungen (noch nicht geladen) wird die KI nicht gefragt
test('Eingang: vor den Einstellungen und bei einem Dienst im Internet fragt die Seite die KI nicht', async () => {
  renderInbox()
  await screen.findByLabelText('Jahr für lose.pdf')
  expect(fetched).not.toContain('/api/ai/status')
  cleanup()
  renderInboxWith({ aiExternal: { text: true, images: false } } as unknown as Settings)
  await screen.findByLabelText('Jahr für lose.pdf')
  expect(fetched).not.toContain('/api/ai/status')
})

test('Posteingang: Objekt und Jahr eines Belegs zeigen den gespeicherten Wert und lassen sich ändern', async () => {
  renderInbox()
  await screen.findByText('Wasser/Abwasser')
  const objekt = screen.getByLabelText('Objekt für lose.pdf') as HTMLSelectElement
  const jahr = screen.getByLabelText('Jahr für lose.pdf') as HTMLSelectElement
  // Gespeichert ist „ohne“, und genau das steht da.
  expect(objekt.value).toBe('')
  expect(objekt.selectedOptions[0].textContent).toBe('ohne Objekt')
  expect(jahr.value).toBe('')
  // #309: Beide Felder sind ein Entwurf; erst „Speichern“ schickt sie, in einem Rumpf und genau einmal.
  fireEvent.change(objekt, { target: { value: 'p2' } })
  fireEvent.change(jahr, { target: { value: String(YEAR) } })
  expect(sent).toEqual([])
  const knopf = screen.getByRole('button', { name: 'Speichern (Objekt und Jahr für lose.pdf)' })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  await waitFor(() => expect(sent).toEqual([{ url: '/api/uploads/4_lose.pdf', method: 'PUT', body: { propertyId: 'p2', year: YEAR } }]))
})

test('Posteingang: „Verwerfen“ stellt Objekt und Jahr her, ohne zu senden (#309)', async () => {
  renderInbox()
  await screen.findByText('Wasser/Abwasser')
  const jahr = screen.getByLabelText('Jahr für lose.pdf') as HTMLSelectElement
  fireEvent.change(jahr, { target: { value: String(YEAR) } })
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Objekt und Jahr für lose.pdf)' }))
  expect(jahr.value).toBe('')
  expect(sent).toEqual([])
})

test('Posteingang: scheitert das Speichern, steht der Grund am Knopf und der Entwurf bleibt (#309)', async () => {
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/uploads/4_lose.pdf' && init?.method === 'PUT') {
      return new Response(JSON.stringify({ error: 'Der Datenordner ist schreibgeschützt.' }), { status: 503, headers: { 'content-type': 'application/json' } })
    }
    return inner(url, init)
  })
  renderInbox()
  await screen.findByText('Wasser/Abwasser')
  const jahr = screen.getByLabelText('Jahr für lose.pdf') as HTMLSelectElement
  fireEvent.change(jahr, { target: { value: String(YEAR) } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Objekt und Jahr für lose.pdf)' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toMatch(/^Nicht gespeichert: .*schreibgeschützt/)
  expect(alert.closest('.draft-actions')).not.toBeNull()
  expect(jahr.value).toBe(String(YEAR))
})

test('Eingang: einer Position zuordnen, und „Per KI auswerten“ am Beleg wertet ihn aus, ohne die Seite zu wechseln', async () => {
  // Ein Foto: ein PDF liest der Browser vor der Auswertung mit pdf.js, das in jsdom nicht läuft
  extraUploads = [{ ...up('7_foto.jpg'), mimeType: 'image/jpeg' }]
  const onNavigate = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view="eingang" onNavigate={onNavigate} renderThumb={() => Promise.resolve('')} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  const zuordnen = await screen.findByLabelText('lose.pdf einer Position zuordnen') as HTMLSelectElement
  expect(zuordnen.value).toBe('')
  // Nur Positionen ohne Beleg stehen zur Wahl
  expect([...zuordnen.options].map((o) => o.value)).toEqual(['', 'w2'])
  fireEvent.change(zuordnen, { target: { value: 'w2' } })
  expect(sent).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  await waitFor(() => expect(sent).toEqual([{ url: '/api/costItems/w2', method: 'PUT', body: { invoiceFile: '4_lose.pdf' } }]))
  fireEvent.click(await screen.findByRole('button', { name: 'foto.jpg per KI auswerten' }))
  await waitFor(() => expect(sent.some((r) => r.url === '/api/intake')).toBe(true))
  expect(sent.find((r) => r.url === '/api/intake')?.body).toMatchObject({ existingFile: '7_foto.jpg', propertyId: 'p1', year: String(YEAR) })
  expect(onNavigate).not.toHaveBeenCalled()
})

// Fehler mit Ausweg (#487): „Von Hand erfassen“ springt aus Eingang oder Kosten zum gespeicherten Beleg.
test('Posteingang: ein angesprungener Beleg bekommt den Fokus, die Seite meldet es einmal', async () => {
  const onFocusDone = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view="eingang" renderThumb={() => Promise.resolve('')} focusFile="4_lose.pdf" onFocusDone={onFocusDone} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(onFocusDone).toHaveBeenCalledTimes(1))
  const card = document.activeElement?.closest('li.receipt-card')
  expect(card?.getAttribute('data-file')).toBe('4_lose.pdf')
  // Kurz hervorgehoben, damit man sieht, wohin der Sprung ging
  expect(card?.getAttribute('data-jumped')).toBe('true')
  expect(card?.className).toMatch(/\bbg-accent-soft\b/)
})

test('Posteingang: ein angesprungenes Zählerfoto öffnet die zugeklappten „Zählerfotos“ (Durchsicht #487)', async () => {
  extraUploads = [{ ...up('9_zaehler.jpg'), kind: 'meterPhoto', mimeType: 'image/jpeg' }]
  const onFocusDone = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} renderThumb={() => Promise.resolve('')} focusFile="9_zaehler.jpg" onFocusDone={onFocusDone} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(onFocusDone).toHaveBeenCalledTimes(1))
  const card = document.activeElement?.closest('li.receipt-card')
  expect(card?.getAttribute('data-file')).toBe('9_zaehler.jpg')
  expect(card?.closest('details')?.open).toBe(true)
})

test('Mappen: „Belege für die Steuer“ lädt das ZIP des gewählten Objekts und Jahres', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const link = screen.getByRole('link', { name: /Belege für die Steuer/ }) as HTMLAnchorElement
  expect(link.getAttribute('href')).toBe(`/api/receipts/tax/${YEAR}?property=p1`)
})

test('Mappen: die Belegmappe für Mieter folgt der Abrechnung und nennt, was fehlt', async () => {
  const make = vi.fn(async () => undefined)
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} renderThumb={() => Promise.resolve('')} makeTenantFolder={make} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  fireEvent.click(screen.getByText(/Belegmappe für Mieter/))
  const summary = await screen.findByText(/2 Belege zu 3 umgelegten Positionen/)
  expect(summary.textContent).toMatch(/1 Position ohne Beleg/)
  fireEvent.click(screen.getByRole('button', { name: 'PDF erstellen' }))
  await waitFor(() => expect(make).toHaveBeenCalled())
  const [plan] = make.mock.calls[0] as unknown as [{ documents: { upload: UploadInfo }[] }]
  expect(plan.documents.map((d) => d.upload.file)).toEqual(['2_wasser.pdf', '1_gs.pdf'])
})

// Befund C: Zuordnen aus dem Posteingang an eine übernommene Position mit Schätzbetrag. Die Liste
// schlägt die Positionen der Kostenart vor, die der Name des Belegs nennt, und danach fragt die
// Seite nach dem Betrag, statt den geschätzten still stehen zu lassen.
test('Posteingang: passende Kostenart oben, nach dem Zuordnen „Betrag prüfen“', async () => {
  extraUploads = [up('5_Grundsteuerbescheid.pdf')]
  extraItems = [{ id: 'gs2', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: `Grundsteuer ${YEAR} (Nachtrag)`, amountCents: 61000, key: 'area' }]
  renderInbox()
  await screen.findByText('Wasser/Abwasser')
  const zuordnen = await screen.findByLabelText('Grundsteuerbescheid.pdf einer Position zuordnen') as HTMLSelectElement
  const groups = [...zuordnen.querySelectorAll('optgroup')]
  expect(groups.map((g) => g.label)).toEqual(['Passend zu „Grundsteuer“', 'Weitere Positionen ohne Beleg'])
  expect([...(groups[0]?.querySelectorAll('option') ?? [])].map((o) => o.value)).toEqual(['gs2'])
  fireEvent.change(zuordnen, { target: { value: 'gs2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für Grundsteuerbescheid.pdf)' }))
  await waitFor(() => expect(sent).toEqual([{ url: '/api/costItems/gs2', method: 'PUT', body: { invoiceFile: '5_Grundsteuerbescheid.pdf' } }]))
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  expect(check.textContent).toMatch(/610,00/)
  fireEvent.change(within(check).getByLabelText('Betrag laut Beleg'), { target: { value: '612,40' } })
  fireEvent.click(within(check).getByRole('button', { name: 'Betrag speichern' }))
  await waitFor(() => expect(sent[1]).toEqual({ url: '/api/costItems/gs2', method: 'PUT', body: { amountCents: 61240 } }))
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Betrag prüfen' })).toBeNull())
})

test('„nachreichen“: auch nach dem Hochladen an der Position „Betrag prüfen“, „Stimmt so“ schließt ohne Änderung', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const input = screen.getByLabelText('Beleg für Abwasser hochladen') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['x'], 'abwasser.pdf', { type: 'application/pdf' })] } })
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  expect(check.textContent).toMatch(/260,00/)
  fireEvent.click(within(check).getByRole('button', { name: 'Stimmt so' }))
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Betrag prüfen' })).toBeNull())
  expect(sent.filter((x) => x.method === 'PUT' && (x.body as Record<string, unknown>).amountCents !== undefined)).toEqual([])
})

// Zweite Durchsicht: Bei Einzelbeträgen und „laut Gemeinschaftsabrechnung“ hängt der Betrag an
// weiteren Angaben; dort kein Betragsfeld, sondern das Formular. Ebenso, wenn der Lohnanteil über
// dem neuen Betrag läge.
const renderWithOpen = (onOpenItem: (c: CostItem) => void) =>
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view="eingang" renderThumb={() => Promise.resolve('')} onOpenItem={onOpenItem} />
      </PropertyProvider>
    </PeriodProvider>,
  )

test('„Betrag prüfen“ bei einer Position laut Gemeinschaftsabrechnung: kein Feld, „Position öffnen“', async () => {
  extraItems = [{ id: 'hg', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Hauswart', description: 'Hauswart laut Hausgeld', amountCents: 48000, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 4800000 } }]
  const onOpenItem = vi.fn()
  renderWithOpen(onOpenItem)
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('lose.pdf einer Position zuordnen'), { target: { value: 'hg' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  expect(within(check).queryByLabelText('Betrag laut Beleg')).toBeNull()
  expect(check.textContent).toMatch(/Bei dieser Position prüfen Sie den Betrag im Formular/)
  fireEvent.click(within(check).getByRole('button', { name: 'Position öffnen' }))
  expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'hg' }))
})

// #455, Durchsicht von PR 3 (I2): Der Betrag eines Teils ist nur der Anteil seines Zeitraums; ein Feld lüde dazu ein,
// den Betrag der ganzen Rechnung einzutragen.
test('„Betrag prüfen“ bei einem Teil einer aufgeteilten Rechnung: kein Feld, eigener Satz, „Position öffnen“', async () => {
  extraItems = [{ id: 'teil', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Sachversicherung', description: 'Gebäudeversicherung (anteilig)', amountCents: 30000, key: 'area', sourceId: 'q1', serviceFrom: `${YEAR}-07-01`, serviceTo: `${YEAR + 1}-06-30` }]
  const onOpenItem = vi.fn()
  renderWithOpen(onOpenItem)
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('lose.pdf einer Position zuordnen'), { target: { value: 'teil' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  expect(within(check).queryByLabelText('Betrag laut Beleg')).toBeNull()
  expect(check.textContent).toMatch(/Teil einer aufgeteilten Rechnung; der Betrag ist nur der Anteil dieses Zeitraums/)
  expect(check.textContent).not.toMatch(/Stimmt er mit dem Beleg überein/)
  fireEvent.click(within(check).getByRole('button', { name: 'Position öffnen' }))
  expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'teil' }))
})

test('„Betrag prüfen“: liegt der Lohnanteil über dem neuen Betrag, ins Formular', async () => {
  extraItems = [{ id: 'gp', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Gartenpflege', description: 'Garten', amountCents: 100000, labor35aCents: 80000, key: 'area' }]
  const onOpenItem = vi.fn()
  renderWithOpen(onOpenItem)
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('lose.pdf einer Position zuordnen'), { target: { value: 'gp' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  fireEvent.change(within(check).getByLabelText('Betrag laut Beleg'), { target: { value: '500,00' } })
  fireEvent.click(within(check).getByRole('button', { name: 'Betrag speichern' }))
  await within(check).findByText(/§35a-Lohnanteil der Position .* im Formular/)
  expect(sent.filter((x) => (x.body as Record<string, unknown>).amountCents !== undefined)).toEqual([])
  fireEvent.click(within(check).getByRole('button', { name: 'Position öffnen' }))
  expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'gp' }))
})

// Dritte Durchsicht (M1): Eine übernommene Position kann einen geschätzten §35a-Lohnanteil tragen.
// „Betrag prüfen“ nennt ihn, damit er nicht still in die Anlage V gelangt.
test('„Betrag prüfen“ nennt den Lohnanteil der Position und führt ins Formular', async () => {
  extraItems = [{ id: 'gp', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Gartenpflege', description: 'Garten', amountCents: 300000, labor35aCents: 100000, key: 'area' }]
  const onOpenItem = vi.fn()
  renderWithOpen(onOpenItem)
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('lose.pdf einer Position zuordnen'), { target: { value: 'gp' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  expect(check.textContent).toMatch(/Lohnanteil der Position: 1\.000,00\s€ – stimmt er mit dem Beleg\?/)
  fireEvent.click(within(check).getByRole('button', { name: 'Lohnanteil im Formular prüfen' }))
  expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'gp' }))
})

test('Eingang (#490): ein Beleg mit offener Auswertung steht unter „Zu prüfen“, nicht noch einmal unter „Ohne Position“', async () => {
  extraUploads = [{ ...up('5_offen.pdf'), bookedItemIds: [], assessment: { id: 'a5', propertyId: 'p1', open: true } }]
  openAssessments = () => [assessmentOf('a5', '5_offen.pdf')]
  renderInbox()
  const group = await screen.findByRole('region', { name: 'Zu prüfen' })
  expect(group.querySelector('[data-assessment="a5"]')).not.toBeNull()
  await screen.findByLabelText('Jahr für lose.pdf')
  expect(document.querySelector('[data-group="ohne"] li[data-file="5_offen.pdf"]')).toBeNull()
  expect(document.querySelectorAll('[data-view="eingang"] li[data-file="5_offen.pdf"]')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'offen.pdf per KI auswerten' })).toBeNull()
})

test('Weiter prüfen (#170, #490): eine Auswertung ohne Objekt bekommt das gewählte, dann springt der Eingang zu ihr und hebt sie hervor', async () => {
  extraUploads = [{ ...up('6_ohne.pdf'), bookedItemIds: [], assessment: { id: 'a6', propertyId: null, open: true } }]
  openAssessments = () => (sent.some((x) => x.url === '/api/assessments/a6') ? [assessmentOf('a6', '6_ohne.pdf')] : [])
  renderInbox()
  fireEvent.click(await screen.findByRole('button', { name: 'ohne.pdf weiter prüfen' }))
  await waitFor(() => expect(document.activeElement?.getAttribute('data-assessment')).toBe('a6'))
  expect(sent.filter((x) => x.url === '/api/assessments/a6')).toEqual([{ url: '/api/assessments/a6', method: 'PUT', body: { propertyId: 'p1' } }])
  expect(document.activeElement?.className).toMatch(/\bbg-accent-soft\b/)
})

test('Weiter prüfen (#170): scheitert das Zuordnen, steht eine Meldung da und nichts springt', async () => {
  failAssessmentPut = true
  extraUploads = [{ ...up('6_ohne.pdf'), bookedItemIds: [], assessment: { id: 'a6', propertyId: null, open: true } }]
  renderInbox()
  fireEvent.click(await screen.findByRole('button', { name: 'ohne.pdf weiter prüfen' }))
  expect(await screen.findByText(/Zeilen sind schon gebucht/)).toBeTruthy()
  expect(document.querySelector('[data-assessment]')).toBeNull()
})

// Integrationsdurchsicht vor 0.10 (N1): „Betrag prüfen“ ändert eine Position. Liegt sie in einem
// Jahr mit abgeschlossener Abrechnung, sagt der Kasten es, bevor gespeichert wird.
test('„Betrag prüfen“ in einem Jahr mit abgeschlossener Abrechnung nennt die Abweichung', async () => {
  extraItems = [{ id: 'gs2', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: `Grundsteuer ${YEAR} (Nachtrag)`, amountCents: 61000, key: 'area' }]
  closed = { closedAt: `${YEAR + 1}-03-01T00:00:00.000Z` }
  renderInbox()
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('lose.pdf einer Position zuordnen'), { target: { value: 'gs2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  await within(check).findByText(`Die Abrechnung ${YEAR} ist abgeschlossen und bleibt, wie sie verschickt wurde; ändert sich dadurch der Saldo eines Mieters, zeigt die Abrechnungsseite das als Abweichung.`)
})

test('„Betrag prüfen“ in einem offenen Jahr: kein Satz zur abgeschlossenen Abrechnung', async () => {
  extraItems = [{ id: 'gs2', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: `Grundsteuer ${YEAR} (Nachtrag)`, amountCents: 61000, key: 'area' }]
  renderInbox()
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('lose.pdf einer Position zuordnen'), { target: { value: 'gs2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  await new Promise((r) => setTimeout(r, 20))
  expect(check.textContent).not.toMatch(/abgeschlossen/)
})

// #309: Ein ungespeicherter Entwurf im Posteingang zählt als offenes Formular; ein Wechsel von Objekt oder
// Zeitraum fragt dann nach, statt ihn still zu verlieren.
function Offen() {
  const hasOpenForm = useHasOpenForm()
  const [seen, setSeen] = useState<boolean | null>(null)
  return <button type="button" onClick={() => setSeen(hasOpenForm())}>offen? {String(seen)}</button>
}

test('Posteingang: ein ungespeichertes Jahr zählt als offenes Formular (#309)', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view="eingang" renderThumb={() => Promise.resolve('')} />
        <Offen />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  const frage = () => {
    fireEvent.click(screen.getByRole('button', { name: /^offen\?/ }))
    return screen.getByRole('button', { name: /^offen\?/ }).textContent
  }
  expect(frage()).toBe('offen? false')
  fireEvent.change(screen.getByLabelText('Jahr für lose.pdf'), { target: { value: String(YEAR) } })
  expect(frage()).toBe('offen? true')
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Objekt und Jahr für lose.pdf)' }))
  expect(frage()).toBe('offen? false')
})

// Durchsicht zu #309, MUSS 2: Die Positionen zum Zuordnen folgen dem Entwurf von Objekt und Jahr. Eine schon
// gewählte Position, die danach nicht mehr zur Wahl steht, darf „Speichern“ nicht trotzdem anhängen.
test('Posteingang: fällt die gewählte Position aus der Liste, ist die Wahl verworfen (#309)', async () => {
  extraItems = [{ id: 'alt', propertyId: 'p1', period: calendarPeriod(YEAR - 1), category: 'Wasser/Abwasser', description: 'Abwasser alt', amountCents: 25000, key: 'area' }]
  renderInbox()
  await screen.findByText('Wasser/Abwasser')
  const jahr = screen.getByLabelText('Jahr für lose.pdf') as HTMLSelectElement
  fireEvent.change(jahr, { target: { value: String(YEAR) } })
  const zuordnen = screen.getByLabelText('lose.pdf einer Position zuordnen') as HTMLSelectElement
  fireEvent.change(zuordnen, { target: { value: 'w2' } })
  expect(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' })).toBeTruthy()
  fireEvent.change(jahr, { target: { value: String(YEAR - 1) } })
  expect([...(screen.getByLabelText('lose.pdf einer Position zuordnen') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'alt'])
  expect(screen.queryByRole('button', { name: 'Speichern (Position für lose.pdf)' })).toBeNull()
  expect(sent).toEqual([])
})

// Durchsicht zu #309, SOLLTE 3: „Per KI auswerten“ nähme Objekt und Jahr, wie sie gespeichert sind.
test('Posteingang: mit ungespeichertem Objekt oder Jahr ist „Per KI auswerten“ gesperrt, mit Grund (#309)', async () => {
  renderInbox()
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('Objekt für lose.pdf'), { target: { value: 'p2' } })
  const knopf = screen.getByRole('button', { name: 'lose.pdf per KI auswerten' }) as HTMLButtonElement
  expect(knopf.disabled).toBe(true)
  expect(screen.getByText(PLACEMENT_FIRST)).toBeTruthy()
  fireEvent.click(knopf)
  expect(sent.filter((r) => r.url === '/api/intake')).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Objekt und Jahr für lose.pdf)' }))
  expect(knopf.disabled).toBe(false)
  expect(screen.queryByText(PLACEMENT_FIRST)).toBeNull()
})

// #346, Schritt 7a: „Betrag prüfen“ zählt als offenes Formular, bis es beantwortet ist; die Frage zum
// Schätzbetrag käme nach einem Seitenwechsel nie wieder.
test('„Betrag prüfen“ zählt als offenes Formular, „Stimmt so“ nimmt die Marke weg (#346)', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view="eingang" renderThumb={() => Promise.resolve('')} />
        <Offen />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  const frage = () => {
    fireEvent.click(screen.getByRole('button', { name: /^offen\?/ }))
    return screen.getByRole('button', { name: /^offen\?/ }).textContent
  }
  fireEvent.change(screen.getByLabelText('lose.pdf einer Position zuordnen'), { target: { value: 'w2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  await waitFor(() => expect(screen.queryByRole('button', { name: /Position für lose\.pdf\)$/ })).toBeNull())
  expect(frage()).toBe('offen? true')
  fireEvent.click(within(check).getByRole('button', { name: 'Stimmt so' }))
  expect(frage()).toBe('offen? false')
})

// N7 aus #341: Im Posteingang sind die Knöpfe so hoch wie die Auswahlfelder daneben, und „Beleg nachreichen“
// steht am breiten Bildschirm als letztes in seiner rechtsbündigen Gruppe. Ob er wirklich nicht springt (auch am
// Handy, wo er zuerst steht), misst die Bedienprobe „beleg-zuordnen“ im Browserlauf; hier nur die Reihenfolge.
test('Posteingang: Knöpfe in Höhe der Auswahl, „Beleg nachreichen“ steht hinter der Auswahl', async () => {
  extraUploads = [{ ...up('7_abwasser.pdf'), bookedItemIds: [], assessment: { id: 'a7', propertyId: null, open: true } }]
  renderInbox()
  const weiter = await screen.findByRole('button', { name: 'abwasser.pdf weiter prüfen' })
  expect(weiter.classList.contains('small')).toBe(false)
  const picker = await screen.findByLabelText('Vorhandenen Beleg für Abwasser zuordnen')
  const upload = screen.getByLabelText('Beleg für Abwasser hochladen').closest('label')
  if (!upload) return expect.fail('Kein Knopf „Beleg nachreichen“')
  expect(upload.classList.contains('small')).toBe(false)
  expect(picker.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

// Durchsicht des Ordners nach Zeitraum (#346 Schritt 12): Nach einem Wechsel auf Mai bis April beginnen Rumpf
// (Januar bis April 2025) und neuer Zeitraum im selben Jahr. Register, Satz und Belegabdeckung folgen dem Zeitraum der
// Seitenleiste; vorher stand „die 2025 beginnen“ da, gezeigt wurde aber nur einer von beiden.
test('Rumpfzeitraum: Register, Satz und Belegabdeckung zeigen den gewählten Zeitraum', async () => {
  const rules = { startMonth: 1, changes: [periodKey('2025-05')] }
  propsOverride = [{ ...PROPS[0], periodRules: rules } as Property]
  extraItems = [{ id: 'neu', propertyId: 'p1', period: periodKey('2025-05'), category: 'Grundsteuer', description: 'Grundsteuer neu', amountCents: 61000, key: 'area' }]
  const rumpf = periodLabel(periodContaining(rules, '2025-02-01'))
  const neu = periodLabel(periodContaining(rules, '2025-06-01'))
  render(
    <PeriodProvider>
      <PropertyProvider>
        <PeriodSelect />
        <Belege {...BASE} renderThumb={() => Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=')} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  const select = await screen.findByRole('combobox', { name: 'Abrechnungszeitraum' }) as HTMLSelectElement
  // Erst wenn die Objekte geladen sind, gibt es die Zeiträume des neuen Rhythmus als Optionen
  await waitFor(() => expect([...select.options].map((o) => o.value)).toContain('2025-05'))
  fireEvent.change(select, { target: { value: '2025-05' } })
  expect(await screen.findByText(`Gezeigt sind die Positionen von ${neu}.`)).toBeTruthy()
  // Nur die Register; die Auswahl im Posteingang bleibt beim Kalenderjahr des Belegs
  const registers = () => [...document.querySelectorAll('details.receipt-group')].map((d) => d.textContent ?? '').join(' ')
  expect(registers()).toContain('Grundsteuer neu')
  expect(registers()).not.toContain('Grundsteuer B')
  expect(screen.getByText(new RegExp(`^Belegabdeckung ${neu.replace('/', '\\/')}`))).toBeTruthy()
  fireEvent.change(select, { target: { value: '2025-01' } })
  expect(await screen.findByText(`Gezeigt sind die Positionen von ${rumpf}.`)).toBeTruthy()
  expect(registers()).not.toContain('Grundsteuer neu')
  expect(registers()).toContain('Grundsteuer B')
})

// ---------- Leistungsprüfung, Befund 1 und 4: Vorschaubilder erst im Bild, Gliederung ----------

// Ein nachgestellter IntersectionObserver: Der Test sagt, welches Element in die Nähe des sichtbaren Bereichs kommt.
class FakeObserver {
  static all: FakeObserver[] = []
  readonly observed = new Set<Element>()
  readonly callback: IntersectionObserverCallback
  readonly options: IntersectionObserverInit | undefined
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    FakeObserver.all.push(this)
  }
  observe(el: Element) { this.observed.add(el) }
  unobserve(el: Element) { this.observed.delete(el) }
  disconnect() { this.observed.clear() }
  takeRecords() { return [] }
}
const intersect = (el: Element, isIntersecting: boolean) => {
  for (const o of FakeObserver.all.filter((x) => x.observed.has(el))) {
    o.callback([{ target: el, isIntersecting } as IntersectionObserverEntry], o as unknown as IntersectionObserver)
  }
}
const thumbOf = (name: string) => screen.getByRole('link', { name: `${name} öffnen` })

test('Vorschaubilder: gerendert wird erst, was in die Nähe des sichtbaren Bereichs kommt; vorbeigescrollt wird zurückgezogen', async () => {
  FakeObserver.all = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  const asked: { file: string; signal: AbortSignal | undefined; resolve: (src: string) => void }[] = []
  const renderThumb = (file: string, _mime: string, signal?: AbortSignal) =>
    new Promise<string>((resolve) => { asked.push({ file, signal, resolve }) })
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} renderThumb={renderThumb} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  // Alle Bilder sind angemeldet, mit Vorlauf, aber keins ist angefragt. Angemeldet wird im Effekt nach dem Einhängen;
  // hängt ein späterer Abruf das Bild neu ein, steht der Link schon da, bevor sein Effekt lief (wackelte in der CI).
  await waitFor(() => expect(FakeObserver.all.some((o) => o.observed.has(thumbOf('wasser.pdf')))).toBe(true))
  expect(FakeObserver.all[0]?.options?.rootMargin).toMatch(/px/)
  expect(asked).toEqual([])

  intersect(thumbOf('wasser.pdf'), true)
  expect(asked.map((a) => a.file)).toEqual(['2_wasser.pdf'])
  // Vorbeigescrollt, bevor das Bild dran war: Die Anfrage wird zurückgezogen
  intersect(thumbOf('gs.pdf'), true)
  intersect(thumbOf('gs.pdf'), false)
  expect(asked.find((a) => a.file === '1_gs.pdf')?.signal?.aborted).toBe(true)
  expect(asked.find((a) => a.file === '2_wasser.pdf')?.signal?.aborted).toBe(false)

  asked[0]?.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=')
  await waitFor(() => expect(thumbOf('wasser.pdf').querySelector('img')).not.toBeNull())
  expect(thumbOf('gs.pdf').querySelector('img')).toBeNull()
})

test('Vorschaubilder: ohne IntersectionObserver (älterer Browser) wird gleich angefragt', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  const asked: string[] = []
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} renderThumb={(file) => { asked.push(file); return Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=') }} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  await waitFor(() => expect([...asked].sort()).toEqual(['1_gs.pdf', '2_wasser.pdf', '4_lose.pdf']))
})

test('„alle Jahre“: je Jahr ein Abschnitt mit Anzahl, aufgeklappt nur das gewählte Jahr', async () => {
  extraItems = [
    { id: 'alt', propertyId: 'p1', period: calendarPeriod(YEAR - 3), category: 'Gartenpflege', description: 'Gartenpflege alt', amountCents: 10000, key: 'area', invoiceFile: '7_garten.pdf' },
    { id: 'alt2', propertyId: 'p1', period: calendarPeriod(YEAR - 3), category: 'Grundsteuer', description: 'Grundsteuer alt', amountCents: 10000, key: 'area' },
  ]
  extraUploads = [up('7_garten.pdf')]
  const { container } = renderPage()
  await screen.findByText('Wasser/Abwasser')
  expect(container.querySelector('details[data-year-section]')).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Belege aller Jahre zeigen' }))
  await screen.findByText('Gartenpflege')
  const sections = [...container.querySelectorAll<HTMLDetailsElement>('details[data-year-section]')]
  expect(sections.map((d) => d.querySelector('summary')?.textContent)).toEqual([
    `${YEAR}2 Belege⚠ 1 Position ohne Beleg`,
    `${YEAR - 3}1 Beleg⚠ 1 Position ohne Beleg`,
  ])
  expect(sections.map((d) => d.open)).toEqual([true, false])
  // Die Register stehen im Abschnitt ihres Jahres
  expect(within(sections[1] as HTMLElement).getByText('Gartenpflege')).toBeTruthy()
  expect(within(sections[0] as HTMLElement).queryByText('Gartenpflege')).toBeNull()
  // Eine Suche klappt die Jahre mit Treffern auf
  fireEvent.change(screen.getByRole('searchbox', { name: 'Suche' }), { target: { value: 'Garten' } })
  await waitFor(() => expect([...container.querySelectorAll<HTMLDetailsElement>('details[data-year-section]')].map((d) => d.open)).toEqual([true]))
})

test('Eingang: unter „Ohne Position“ die neuesten 20, darunter „Ältere anzeigen (N)“', async () => {
  // 30 weitere lose Belege, je später hochgeladen, je weiter oben; dazu der eine aus dem Bestand (4_lose.pdf, der älteste)
  extraUploads = Array.from({ length: 30 }, (_, i) => ({ ...up(`${100 + i}_lose${i}.pdf`), uploadedAt: `2026-02-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }))
  renderInbox()
  const inbox = await screen.findByRole('region', { name: 'Ohne Position (31)' })
  const cards = () => [...inbox.querySelectorAll('.receipt-card')]
  expect(cards()).toHaveLength(20)
  expect(within(cards()[0] as HTMLElement).getAllByText('lose29.pdf').length).toBeGreaterThan(0)
  fireEvent.click(within(inbox).getByRole('button', { name: 'Ältere anzeigen (11)' }))
  expect(cards()).toHaveLength(31)
  expect(within(inbox).queryByRole('button', { name: /Ältere anzeigen/ })).toBeNull()
})

// Durchsicht von PR #449, K2: Eine Position, die über eine Belegbuchung gedeckt ist, steht am Register und in der
// Jahreszeile nicht als „ohne Beleg“, wie in Belegabdeckung und Liste.
test('Register: eine über eine Belegbuchung gedeckte Position zählt als belegt', async () => {
  extraUploads = [{ ...up('8_abwasser.pdf'), bookedItemIds: ['w2'] }]
  const { container } = renderPage()
  const wasser = (await screen.findByText('Wasser/Abwasser')).closest('details') as HTMLElement
  expect(within(wasser).getByText(/alle Belege vorhanden/)).toBeTruthy()
  expect(within(wasser).queryByText(/ohne Beleg/)).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Belege aller Jahre zeigen' }))
  await waitFor(() => expect(container.querySelector('details[data-year-section]')).not.toBeNull())
  expect(container.querySelector('details[data-year-section] > summary')?.textContent).toBe(`${YEAR}3 Belege`)
})

// K3: Nach „Ältere anzeigen“ steht der Fokus auf der ersten neu gezeigten Karte, auch wenn der Knopf danach fehlt.
test('Eingang: nach „Ältere anzeigen“ hat die erste neue Karte den Fokus', async () => {
  extraUploads = Array.from({ length: 30 }, (_, i) => ({ ...up(`${100 + i}_lose${i}.pdf`), uploadedAt: `2026-02-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }))
  renderInbox()
  const inbox = await screen.findByRole('region', { name: 'Ohne Position (31)' })
  const button = within(inbox).getByRole('button', { name: 'Ältere anzeigen (11)' })
  button.focus()
  fireEvent.click(button)
  const cards = [...inbox.querySelectorAll('.receipt-card')]
  expect(cards).toHaveLength(31)
  expect(document.activeElement).toBe(cards[20]?.querySelector('.receipt-title a'))
})


// ---------- Seite Belege (#490): zwei Ansichten über denselben Daten ----------

test('Reiter: „Eingang“ mit der Zahl der offenen Einträge und „Ordner“; Pfeiltasten wechseln', async () => {
  renderPage('eingang')
  const eingang = await screen.findByRole('tab', { name: /^Eingang/ })
  await waitFor(() => expect(eingang.textContent).toBe('Eingang 1 offen'))
  expect(eingang.getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel', { name: /Eingang/ })).toBeTruthy()
  fireEvent.keyDown(eingang, { key: 'ArrowRight' })
  const ordner = screen.getByRole('tab', { name: 'Ordner' })
  expect(ordner.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(ordner)
  expect(screen.getByRole('tabpanel', { name: 'Ordner' })).toBeTruthy()
  expect(screen.queryByRole('tabpanel', { name: /Eingang/ })).toBeNull()
})

// Regel 2: Ein Wechsel der Ansicht verliert nichts. Beide Ansichten bleiben eingehängt; Zuordnung, Objekt und Jahr eines
// Belegs, „Betrag prüfen“, geänderte Zeilen einer Auswertung und das Jahr der Buchung stehen nach dem Rückweg da.
test('Ansichtswechsel verliert nichts: Zuordnung, Objekt und Jahr, „Betrag prüfen“, Zeilen und Jahr einer Auswertung', async () => {
  extraUploads = [{ ...up('5_offen.pdf'), bookedItemIds: [], assessment: { id: 'a5', propertyId: 'p1', open: true } }, up('6_frei.pdf')]
  openAssessments = () => [assessmentOf('a5', '5_offen.pdf')]
  let hasOpenForm = () => false
  function Probe() {
    hasOpenForm = useHasOpenForm()
    return null
  }
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view={undefined} renderThumb={() => Promise.resolve('')} />
        <Probe />
      </PropertyProvider>
    </PeriodProvider>,
  )
  // Eingang: Zuordnen, Jahr eines Belegs, Zeile und Jahr der Auswertung als Entwurf
  const zuordnen = await screen.findByLabelText('lose.pdf einer Position zuordnen') as HTMLSelectElement
  fireEvent.change(zuordnen, { target: { value: 'w2' } })
  const jahr = screen.getByLabelText('Jahr für frei.pdf') as HTMLSelectElement
  fireEvent.change(jahr, { target: { value: String(YEAR) } })
  const zeile = await screen.findByRole('combobox', { name: 'Was geschieht mit „Grundsteuer“?' }) as HTMLSelectElement
  fireEvent.change(zeile, { target: { value: 'dismiss' } })
  const buchungsjahr = screen.getByRole('combobox', { name: 'Jahr der Buchung' }) as HTMLSelectElement
  fireEvent.change(buchungsjahr, { target: { value: String(YEAR - 1) } })
  // Ordner: „Beleg nachreichen“ an einer Position, dann „Betrag prüfen“ offen lassen
  fireEvent.click(screen.getByRole('tab', { name: 'Ordner' }))
  const nachreichen = screen.getByLabelText('Beleg für Abwasser hochladen') as HTMLInputElement
  fireEvent.change(nachreichen, { target: { files: [new File(['%PDF'], 'nachgereicht.pdf', { type: 'application/pdf' })] } })
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  fireEvent.change(within(check).getByLabelText('Betrag laut Beleg'), { target: { value: '255,00' } })
  // Zurück in den Eingang und wieder in den Ordner: alles steht noch da, nichts wurde gesendet außer dem Nachreichen
  fireEvent.click(screen.getByRole('tab', { name: /^Eingang/ }))
  expect(zuordnen.value).toBe('w2')
  expect(jahr.value).toBe(String(YEAR))
  expect(zeile.value).toBe('dismiss')
  expect(buchungsjahr.value).toBe(String(YEAR - 1))
  fireEvent.click(screen.getByRole('tab', { name: 'Ordner' }))
  expect((within(screen.getByRole('status', { name: 'Betrag prüfen' })).getByLabelText('Betrag laut Beleg') as HTMLInputElement).value).toBe('255,00')
  expect(sent.map((r) => r.url)).toEqual(['/api/upload', '/api/costItems/w2'])
  // Und alles zählt als offenes Formular: Ein Seitenwechsel fragt
  expect(hasOpenForm()).toBe(true)
})

// Fehlender Test aus der Bestandsaufnahme, mit dem richtiggestellten Satz (#490): Der Server legt den Beleg in den
// Papierkorb, und der Verlauf holt ihn zurück; vorher hieß es „unwiderruflich von der Festplatte“.
test('Eingang: Löschen fragt mit dem Papierkorb im Satz und löscht erst nach „Löschen“', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Belege {...BASE} view="eingang" renderThumb={() => Promise.resolve('')} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Beleg lose.pdf löschen' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/„lose\.pdf“ wird aus den Belegen entfernt und in den Papierkorb gelegt\. Zurückholen können Sie ihn im Verlauf\./)
  expect(dialog.textContent).not.toMatch(/unwiderruflich/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(sent).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Beleg lose.pdf löschen' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' }))
  await waitFor(() => expect(sent).toEqual([{ url: '/api/uploads/4_lose.pdf', method: 'DELETE', body: {} }]))
})

// Die Suche im Ordner durchsucht immer alle Objekte und Jahre und nennt beides am Treffer, auch einen Beleg im Eingang.
test('Ordner: die Suche findet über alle Objekte und Jahre und nennt Objekt und Jahr; ein Beleg ohne Position führt in den Eingang', async () => {
  extraItems = [{ id: 'alt', propertyId: 'p1', period: calendarPeriod(YEAR - 2), category: 'Grundsteuer', description: 'Grundsteuer alt', amountCents: 55000, key: 'area', invoiceFile: '7_alt.pdf', vendor: 'Stadtkasse' }]
  extraUploads = [up('7_alt.pdf'), { ...up('8_stadtkasse-mahnung.pdf'), propertyId: 'p2', year: YEAR - 1 }]
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  // Ohne Suche: nur das gewählte Jahr und Objekt
  expect(document.querySelector('[data-view="ordner"] li[data-file="7_alt.pdf"]')).toBeNull()
  expect(document.querySelector('[data-view="ordner"] li[data-file="3_ahorn.pdf"]')).toBeNull()
  fireEvent.change(screen.getByLabelText('Suche'), { target: { value: 'stadt' } })
  // Ein Jahr zwei Jahre zurück, mit Abschnitt je Jahr
  const old = await waitFor(() => {
    const card = document.querySelector('[data-view="ordner"] li[data-file="7_alt.pdf"]')
    if (!card) throw new Error('nicht gefunden')
    return card
  })
  expect(old.closest('details[data-year-section]')?.getAttribute('data-year-section')).toBe(String(YEAR - 2))
  expect(old.textContent).toContain('Lindenstraße')
  // Der Beleg ohne Position im Eingang eines anderen Objekts, mit Ort
  const inbox = screen.getByRole('heading', { name: 'Im Eingang (1)' }).closest('section') as HTMLElement
  expect(inbox.textContent).toContain(`Ahornweg · ${YEAR - 1}`)
  fireEvent.click(within(inbox).getByRole('button', { name: 'Im Eingang zeigen (stadtkasse-mahnung.pdf)' }))
  // Durchsicht M1: Der Beleg gehört einem anderen Objekt und Jahr; die Seite wechselt dorthin und zeigt ihn
  await waitFor(() => expect(context()).toBe(`Ahornweg · Abrechnungsjahr ${YEAR - 1}`))
  await waitFor(() => expect(document.activeElement?.closest('li.receipt-card')?.getAttribute('data-file')).toBe('8_stadtkasse-mahnung.pdf'))
  expect(screen.getByRole('tab', { name: /^Eingang/ }).getAttribute('aria-selected')).toBe('true')
})

// Durchsicht M1: Ein Sprung zu einem Beleg ohne Position eines anderen Objekts (etwa „Beleg zeigen“ aus Kosten) wechselt
// erst dorthin; einen Beleg, den es nicht gibt, nennt die Seite, statt still nichts zu tun.
test('Sprung zu einem Beleg ohne Position eines anderen Objekts: erst dorthin wechseln, dann zeigen', async () => {
  extraUploads = [{ ...up('8_anderswo.pdf'), propertyId: 'p2', year: YEAR }]
  const onFocusDone = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view={undefined} renderThumb={() => Promise.resolve('')} focusFile="8_anderswo.pdf" onFocusDone={onFocusDone} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(context()).toBe(`Ahornweg · Abrechnungsjahr ${YEAR}`))
  await waitFor(() => expect(onFocusDone).toHaveBeenCalledTimes(1))
  expect(document.activeElement?.closest('li.receipt-card')?.getAttribute('data-file')).toBe('8_anderswo.pdf')
})

test('Sprung zu einem Beleg, den es nicht gibt: eine Meldung statt nichts', async () => {
  const onFocusDone = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view={undefined} renderThumb={() => Promise.resolve('')} focusFile="0_weg.pdf" onFocusDone={onFocusDone} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(onFocusDone).toHaveBeenCalledTimes(1))
  expect(await screen.findByText(/Diesen Beleg gibt es nicht mehr/)).toBeTruthy()
})

// Ein Sprung zu einem Beleg (Fehler mit Ausweg, #487) geht in die Ansicht, in der er steht.
test('Sprung zu einem Beleg: ohne Position in den Eingang, an einer Position in den Ordner', async () => {
  const onFocusDone = vi.fn()
  const { rerender } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view={undefined} renderThumb={() => Promise.resolve('')} focusFile="2_wasser.pdf" onFocusDone={onFocusDone} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(onFocusDone).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('tab', { name: 'Ordner' }).getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement?.closest('li.receipt-card')?.getAttribute('data-file')).toBe('2_wasser.pdf')
  rerender(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view={undefined} renderThumb={() => Promise.resolve('')} focusFile="4_lose.pdf" onFocusDone={onFocusDone} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(onFocusDone).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('tab', { name: /^Eingang/ }).getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement?.closest('li.receipt-card')?.getAttribute('data-file')).toBe('4_lose.pdf')
})

// #490: Auf Wunsch steht der Beleg neben der Prüfung; der Knopf nennt, was der nächste Klick tut.
test('Eingang: „Beleg daneben zeigen“ zeigt den Beleg neben der Auswertung, „Beleg ausblenden“ nimmt ihn weg', async () => {
  extraUploads = [{ ...up('5_offen.pdf'), bookedItemIds: [], assessment: { id: 'a5', propertyId: 'p1', open: true } }]
  openAssessments = () => [assessmentOf('a5', '5_offen.pdf')]
  renderInbox()
  const show = await screen.findByRole('button', { name: 'Beleg daneben zeigen' })
  expect(document.querySelector('iframe')).toBeNull()
  fireEvent.click(show)
  const frame = document.querySelector('iframe')
  expect(frame?.getAttribute('src')).toBe('/uploads/5_offen.pdf')
  expect(frame?.getAttribute('title')).toBe('Beleg 5_offen.pdf')
  expect(show.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Beleg ausblenden' }))
  expect(document.querySelector('iframe')).toBeNull()
})

// Durchsicht M2: Ein Beleg mit offener Auswertung steht nur unter „Zu prüfen“. Löschen, Objekt und Jahr und Zuordnen gehen
// dort an der Karte der Auswertung, wie vorher im Posteingang.
test('Eingang: an der Auswertung lässt sich der Beleg löschen, einordnen und zuordnen', async () => {
  extraUploads = [{ ...up('5_offen.pdf'), bookedItemIds: [], assessment: { id: 'a5', propertyId: 'p1', open: true } }]
  openAssessments = () => [assessmentOf('a5', '5_offen.pdf')]
  renderInbox()
  const card = await waitFor(() => document.querySelector('[data-assessment="a5"]') as HTMLElement ?? expect.fail('keine Auswertung'))
  const receipt = await waitFor(() => card.querySelector('[data-file="5_offen.pdf"]') as HTMLElement ?? expect.fail('kein Beleg an der Auswertung'))
  expect(within(receipt).getByRole('button', { name: 'Beleg offen.pdf löschen' })).toBeTruthy()
  expect(within(receipt).getByLabelText('Jahr für offen.pdf')).toBeTruthy()
  const zuordnen = within(receipt).getByLabelText('offen.pdf einer Position zuordnen') as HTMLSelectElement
  expect([...zuordnen.options].map((o) => o.value)).toEqual(['', 'w2'])
  // „Weiter prüfen“ und „Per KI auswerten“ braucht es hier nicht: Die Prüfung steht daneben
  expect(within(receipt).queryByRole('button', { name: /weiter prüfen|per KI auswerten/ })).toBeNull()
})

// Durchsicht S3: Wird ein gespeicherter, nicht ausgewerteter Beleg gelöscht oder zugeordnet, verschwindet auch sein Eintrag
// der Warteschlange; sonst bliebe ein Geist mit „Erneut versuchen“.
async function keptFoto() {
  extraUploads = [{ ...up('7_foto.jpg'), mimeType: 'image/jpeg' }]
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Belege {...BASE} view="eingang" renderThumb={() => Promise.resolve('')} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'foto.jpg per KI auswerten' }))
  await screen.findByText('Gespeichert, nicht ausgewertet')
}

test('Eingang: nach dem Löschen eines gespeicherten Belegs bleibt kein „Erneut versuchen“ stehen', async () => {
  await keptFoto()
  fireEvent.click(screen.getByRole('button', { name: 'Beleg foto.jpg löschen' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' }))
  await waitFor(() => expect(sent.some((r) => r.method === 'DELETE')).toBe(true))
  await waitFor(() => expect(screen.queryByText('Gespeichert, nicht ausgewertet')).toBeNull())
  expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull()
})

test('Eingang: nach dem Zuordnen eines gespeicherten Belegs bleibt kein „Erneut versuchen“ stehen', async () => {
  await keptFoto()
  fireEvent.change(screen.getByLabelText('foto.jpg einer Position zuordnen'), { target: { value: 'w2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für foto.jpg)' }))
  await waitFor(() => expect(sent.some((r) => r.url === '/api/costItems/w2')).toBe(true))
  await waitFor(() => expect(screen.queryByText('Gespeichert, nicht ausgewertet')).toBeNull())
})

// Durchsicht S1: Ein Zählerfoto ohne Position ließ sich im Ordner der Seite Belege löschen; im Ordner geht das weiter.
test('Ordner: ein Zählerfoto lässt sich löschen, mit derselben Rückfrage', async () => {
  extraUploads = [{ ...up('9_zaehler.jpg'), kind: 'meterPhoto', mimeType: 'image/jpeg' }]
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Belege {...BASE} renderThumb={() => Promise.resolve('')} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Beleg zaehler.jpg löschen' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/in den Papierkorb gelegt/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }))
  await waitFor(() => expect(sent).toEqual([{ url: '/api/uploads/9_zaehler.jpg', method: 'DELETE', body: {} }]))
})

// Durchsicht (Kann): „Nur ablegen“ geht auch per Hineinziehen, auf den Knopf selbst.
test('Eingang: Belege auf „Nur ablegen, ohne Auswertung“ gezogen werden nur gespeichert', async () => {
  renderInbox()
  const target = (await screen.findByLabelText('Belege nur ablegen, ohne Auswertung')).closest('label') as HTMLElement
  fireEvent.drop(target, { dataTransfer: { files: [new File(['%PDF'], 'eins.pdf', { type: 'application/pdf' })] } })
  await waitFor(() => expect(sent).toEqual([{ url: '/api/upload', method: 'POST', body: { file: 'eins.pdf', propertyId: 'p1', year: String(YEAR) } }]))
})

// Durchsicht (Kann): Scheitert das Laden der Belege, sagt es auch der Eingang.
test('Eingang: ein Ladefehler der Belege steht auch im Eingang', async () => {
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => (url === '/api/uploads'
    ? new Response(JSON.stringify({ error: 'Der Datenordner ist nicht lesbar.' }), { status: 500, headers: { 'content-type': 'application/json' } })
    : inner(url, init)))
  renderInbox()
  const panel = await screen.findByRole('tabpanel', { name: /Eingang/ })
  expect(await within(panel).findByText(/Der Datenordner ist nicht lesbar/)).toBeTruthy()
  // Das Paneel lässt sich mit Tab erreichen, auch wenn sein erstes Element nicht fokussierbar ist
  expect(panel.getAttribute('tabindex')).toBe('0')
})

// Nachdurchsicht S-B: Ein Beleg eines Objekts mit Zeitraum Mai bis April, im gewählten Kalenderjahr: Der Sprung wechselt
// auf den Zeitraum, der in diesem Jahr beginnt, nicht auf den, der gerade gilt.
test('Sprung: nur das Objekt wechselt, bei Mai bis April auf den Zeitraum, der im Jahr des Belegs beginnt', async () => {
  propsOverride = [PROPS[0] as Property, { ...(PROPS[1] as Property), periodRules: { startMonth: 5, changes: [] } }]
  extraUploads = [{ ...up('8_anderswo.pdf'), propertyId: 'p2', year: YEAR }]
  const onFocusDone = vi.fn()
  const page = (focusFile: string | null) => (
    <PeriodProvider>
      <PropertyProvider>
        <PeriodSelect />
        <Belege {...BASE} view={undefined} renderThumb={() => Promise.resolve('')} focusFile={focusFile} onFocusDone={onFocusDone} />
      </PropertyProvider>
    </PeriodProvider>
  )
  const { rerender } = render(page(null))
  // Das Jahr ausdrücklich gewählt (Seitenleiste): Beginn des Kalenderjahres als Anker
  const year = await screen.findByRole('combobox', { name: 'Abrechnungsjahr' })
  fireEvent.change(year, { target: { value: String(YEAR - 1) } })
  fireEvent.change(year, { target: { value: String(YEAR) } })
  await waitFor(() => expect(context()).toBe(`Lindenstraße · Abrechnungsjahr ${YEAR}`))
  rerender(page('8_anderswo.pdf'))
  await waitFor(() => expect(onFocusDone).toHaveBeenCalledTimes(1))
  expect(context()).toMatch(new RegExp(`^Ahornweg · Abrechnungszeitraum .*${YEAR}.*${YEAR + 1}`))
  expect(document.activeElement?.closest('li.receipt-card')?.getAttribute('data-file')).toBe('8_anderswo.pdf')
})

// Nachdurchsicht S-D: Ein Zählerfoto, dessen Ablesen gescheitert ist, im Ordner gelöscht: Auch sein Eintrag im Eingang
// verschwindet.
test('Ordner: ein gelöschtes Zählerfoto nimmt seinen Eintrag aus dem Eingang mit', async () => {
  extraUploads = [{ ...up('9_zaehler.jpg'), kind: 'meterPhoto', mimeType: 'image/jpeg' }]
  intakeFailure = { error: 'Ollama antwortet mit 500', file: '9_zaehler.jpg', reason: 'other', kept: true, meterPhoto: true }
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Belege {...BASE} view={undefined} renderThumb={() => Promise.resolve('')} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByLabelText('Jahr für lose.pdf')
  fireEvent.change(container.querySelector('input[aria-label="Belege und Zählerfotos auswählen"]') as HTMLInputElement, { target: { files: [new File(['jpg'], 'zaehler.jpg', { type: 'image/jpeg' })] } })
  await screen.findByText('Gespeichert, nicht ausgewertet')
  fireEvent.click(screen.getByRole('tab', { name: 'Ordner' }))
  fireEvent.click(screen.getByRole('button', { name: 'Beleg zaehler.jpg löschen' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' }))
  await waitFor(() => expect(sent.some((r) => r.method === 'DELETE')).toBe(true))
  await waitFor(() => expect(screen.queryByText('Gespeichert, nicht ausgewertet')).toBeNull())
})

// Nachdurchsicht K4: Wer ohne KI ablegt, sieht, dass Mietfuchs die KI noch einmal fragt; und nur die jüngste Antwort zählt.
test('Eingang ohne KI: beim Ablegen „Prüfe die KI …“, eine verspätete ältere Antwort zählt nicht', async () => {
  aiStatus = { ok: false, error: 'nicht erreichbar', reason: 'unreachable' }
  const answers: ((v: Response) => void)[] = []
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => (url === '/api/ai/status' && answers.length < 3
    ? new Promise<Response>((resolve) => { answers.push(resolve) })
    : inner(url, init)))
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const { container } = renderInboxWith(LOCAL)
  await waitFor(() => expect(answers).toHaveLength(1))
  answers[0]?.(json({ ok: false, reason: 'unreachable' }))
  expect(await screen.findByText(/Die KI ist gerade nicht erreichbar/)).toBeTruthy()
  // Zweimal „Erneut prüfen“: Die erste Antwort kommt zuletzt und sagt „nicht erreichbar“; gilt die zweite („läuft“)
  fireEvent.click(screen.getByRole('button', { name: 'Erneut prüfen' }))
  fireEvent.click(screen.getByRole('button', { name: 'Erneut prüfen' }))
  await waitFor(() => expect(answers).toHaveLength(3))
  answers[2]?.(json({ ok: true }))
  await waitFor(() => expect(screen.queryByText(/Die KI ist gerade nicht erreichbar/)).toBeNull())
  answers[1]?.(json({ ok: false, reason: 'unreachable' }))
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByText(/Die KI ist gerade nicht erreichbar/)).toBeNull()
  void container
})

test('Eingang ohne KI: beim Ablegen steht „Prüfe die KI …“, bis die Antwort da ist', async () => {
  aiStatus = { ok: false, error: 'nicht erreichbar', reason: 'unreachable' }
  const { container } = renderInboxWith(LOCAL)
  expect(await screen.findByText(/Die KI ist gerade nicht erreichbar/)).toBeTruthy()
  let release: ((v: Response) => void) | null = null
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => (url === '/api/ai/status'
    ? new Promise<Response>((resolve) => { release = resolve })
    : inner(url, init)))
  dropInto(container, [new File(['%PDF'], 'eins.pdf', { type: 'application/pdf' })])
  expect(await screen.findByText('Prüfe die KI …')).toBeTruthy()
  ;(release as ((v: Response) => void) | null)?.(new Response(JSON.stringify({ ok: false, reason: 'unreachable' }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await waitFor(() => expect(sent.some((r) => r.url === '/api/upload')).toBe(true))
  expect(screen.queryByText('Prüfe die KI …')).toBeNull()
})

// Nachdurchsicht K5: Gehört ein Beleg einem Objekt, das es nicht mehr gibt, nennt der Sprung den Grund; die Meldung geht
// beim nächsten Wechsel der Ansicht.
test('Sprung zu einem Beleg eines gelöschten Objekts: Meldung mit Grund, weg beim Wechsel der Ansicht', async () => {
  extraUploads = [{ ...up('8_weg.pdf'), propertyId: 'p9', year: YEAR }]
  const onFocusDone = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege {...BASE} view={undefined} renderThumb={() => Promise.resolve('')} focusFile="8_weg.pdf" onFocusDone={onFocusDone} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  expect(await screen.findByText(/gehört zu einem Objekt, das es nicht mehr gibt/)).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Ordner' }))
  expect(screen.queryByText(/gehört zu einem Objekt, das es nicht mehr gibt/)).toBeNull()
})

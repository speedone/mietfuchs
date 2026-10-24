// @vitest-environment jsdom
// Der Belegordner (#170): Filter nach Objekt und Jahr, Register je Kostenart, Suche. Die
// Entscheidungslogik prüft receipts.test.ts; hier geht es um das, was nur die Seite zeigt,
// vor allem darum, dass die Auswahlfelder den Wert anzeigen, nach dem tatsächlich gefiltert wird.
import { calendarPeriod, periodContaining, periodKey, periodLabel } from '../../../shared/period.ts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CostItem, Property, UploadInfo } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider, useHasOpenForm } from '../property'
import { useState } from 'react'
import type { ReceiptUpload } from '../receipts'
import Belege, { PLACEMENT_FIRST } from './Belege'
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
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x')
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : (v as File).name])) : JSON.parse(String(init?.body ?? '{}'))
      sent.push({ url: u.pathname, method, body })
      if (failAssessmentPut && u.pathname.startsWith('/api/assessments/')) return new Response(JSON.stringify({ error: 'Zeilen sind schon gebucht.' }), { status: 409, headers: { 'content-type': 'application/json' } })
      const answer = u.pathname === '/api/upload' ? { file: '99_nachgereicht.pdf' } : { ok: true }
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    let body: unknown = []
    if (u.pathname === '/api/properties') body = propsOverride ?? PROPS
    else if (u.pathname === '/api/uploads') body = [up('1_gs.pdf'), up('2_wasser.pdf'), up('3_ahorn.pdf'), up('4_lose.pdf', '1_gs.pdf'), ...extraUploads]
    else if (u.pathname === '/api/costItems') body = [...(ITEMS[u.searchParams.get('property') ?? 'p1'] ?? []), ...(u.searchParams.get('property') === 'p2' ? [] : extraItems)]
    else if (u.pathname === '/api/heating-plants') body = u.searchParams.get('property') === 'p2' ? [] : plantsP1
    else if (u.pathname.startsWith('/api/settlement/')) body = closed ? { ...SETTLEMENT, closed } : SETTLEMENT
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderPage = () =>
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege renderThumb={() => Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=')} />
      </PropertyProvider>
    </PeriodProvider>,
  )

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
test('Posteingang: Belege eines anderen Objekts verweisen auf die Häkchen', async () => {
  extraUploads = [{ ...up('9_anderswo.pdf'), propertyId: 'p2', year: YEAR }]
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  expect(screen.getByText(/1 weitere ist einem anderen Objekt oder Jahr zugedacht; Sie sehen ihn mit „Belege aller Objekte zeigen“ oder „Belege aller Jahre zeigen“\./)).toBeTruthy()
})

test('die Suche nach einem Betrag findet die Position ohne Beleg', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('Suche'), { target: { value: '260,00' } })
  await waitFor(() => expect(screen.queryByText('Grundsteuer')).toBeNull())
  expect(screen.getByText(/Abwasser · 260,00 €/)).toBeTruthy()
})

test('ein inhaltsgleicher Beleg wird als doppelt benannt', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  expect(screen.getAllByText(/gleicher Inhalt wie/).length).toBe(2)
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

test('Posteingang: mehrere Belege auf einmal hochladen, mit Objekt und Jahr der Auswahl', async () => {
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const input = screen.getByLabelText('Belege in den Posteingang hochladen') as HTMLInputElement
  expect(input.multiple).toBe(true)
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'eins.pdf', { type: 'application/pdf' }), new File(['jpg'], 'zwei.jpg', { type: 'image/jpeg' })] } })
  await waitFor(() => expect(sent.filter((r) => r.url === '/api/upload').length).toBe(2))
  expect(sent.map((r) => r.body)).toEqual([
    { file: 'eins.pdf', propertyId: 'p1', year: String(YEAR) },
    { file: 'zwei.jpg', propertyId: 'p1', year: String(YEAR) },
  ])
})

test('Posteingang: Objekt und Jahr eines Belegs zeigen den gespeicherten Wert und lassen sich ändern', async () => {
  renderPage()
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
  renderPage()
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
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  const jahr = screen.getByLabelText('Jahr für lose.pdf') as HTMLSelectElement
  fireEvent.change(jahr, { target: { value: String(YEAR) } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Objekt und Jahr für lose.pdf)' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toMatch(/^Nicht gespeichert: .*schreibgeschützt/)
  expect(alert.closest('.draft-actions')).not.toBeNull()
  expect(jahr.value).toBe(String(YEAR))
})

test('Posteingang: einer Position zuordnen und per KI auswerten', async () => {
  const onEvaluate = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege renderThumb={() => Promise.resolve('')} onEvaluate={onEvaluate} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  const zuordnen = screen.getByLabelText('lose.pdf einer Position zuordnen') as HTMLSelectElement
  expect(zuordnen.value).toBe('')
  // Nur Positionen ohne Beleg stehen zur Wahl
  expect([...zuordnen.options].map((o) => o.value)).toEqual(['', 'w2'])
  fireEvent.change(zuordnen, { target: { value: 'w2' } })
  expect(sent).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  await waitFor(() => expect(sent).toEqual([{ url: '/api/costItems/w2', method: 'PUT', body: { invoiceFile: '4_lose.pdf' } }]))
  fireEvent.click(screen.getByRole('button', { name: 'lose.pdf per KI auswerten' }))
  expect(onEvaluate).toHaveBeenCalledWith([expect.objectContaining({ file: '4_lose.pdf' })])
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
        <Belege renderThumb={() => Promise.resolve('')} makeTenantFolder={make} />
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
  renderPage()
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
        <Belege renderThumb={() => Promise.resolve('')} onOpenItem={onOpenItem} />
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

test('Posteingang (#170): ein Beleg mit offener Auswertung heißt „Weiter prüfen“ und führt zur Prüfung', async () => {
  extraUploads = [{ ...up('5_offen.pdf'), bookedItemIds: [], assessment: { id: 'a5', propertyId: 'p1', open: true } }]
  const onContinue = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege renderThumb={() => Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=')} onEvaluate={() => {}} onContinue={onContinue} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'offen.pdf weiter prüfen' }))
  expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ file: '5_offen.pdf' }))
  expect(screen.queryByRole('button', { name: 'offen.pdf per KI auswerten' })).toBeNull()
})

const renderContinue = (onContinue: (u: ReceiptUpload) => void) => render(
  <PeriodProvider>
    <PropertyProvider>
      <Belege renderThumb={() => Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=')} onEvaluate={() => {}} onContinue={onContinue} />
    </PropertyProvider>
  </PeriodProvider>,
)

test('Weiter prüfen (#170): eine Auswertung ohne Objekt bekommt zuerst das gewählte Objekt', async () => {
  extraUploads = [{ ...up('6_ohne.pdf'), bookedItemIds: [], assessment: { id: 'a6', propertyId: null, open: true } }]
  const onContinue = vi.fn()
  renderContinue(onContinue)
  fireEvent.click(await screen.findByRole('button', { name: 'ohne.pdf weiter prüfen' }))
  await waitFor(() => expect(onContinue).toHaveBeenCalled())
  expect(sent.filter((x) => x.url === '/api/assessments/a6')).toEqual([{ url: '/api/assessments/a6', method: 'PUT', body: { propertyId: 'p1' } }])
  expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ file: '6_ohne.pdf', assessment: expect.objectContaining({ propertyId: 'p1' }) }))
})

test('Weiter prüfen (#170): scheitert das Zuordnen, steht eine Meldung da und die Seite wechselt nicht', async () => {
  failAssessmentPut = true
  extraUploads = [{ ...up('6_ohne.pdf'), bookedItemIds: [], assessment: { id: 'a6', propertyId: null, open: true } }]
  const onContinue = vi.fn()
  renderContinue(onContinue)
  fireEvent.click(await screen.findByRole('button', { name: 'ohne.pdf weiter prüfen' }))
  expect(await screen.findByText(/Zeilen sind schon gebucht/)).toBeTruthy()
  expect(onContinue).not.toHaveBeenCalled()
})

// Integrationsdurchsicht vor 0.10 (N1): „Betrag prüfen“ ändert eine Position. Liegt sie in einem
// Jahr mit abgeschlossener Abrechnung, sagt der Kasten es, bevor gespeichert wird.
test('„Betrag prüfen“ in einem Jahr mit abgeschlossener Abrechnung nennt die Abweichung', async () => {
  extraItems = [{ id: 'gs2', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: `Grundsteuer ${YEAR} (Nachtrag)`, amountCents: 61000, key: 'area' }]
  closed = { closedAt: `${YEAR + 1}-03-01T00:00:00.000Z` }
  renderPage()
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('lose.pdf einer Position zuordnen'), { target: { value: 'gs2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Position für lose.pdf)' }))
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' })
  await within(check).findByText(`Die Abrechnung ${YEAR} ist abgeschlossen und bleibt, wie sie verschickt wurde; ändert sich dadurch der Saldo eines Mieters, zeigt die Abrechnungsseite das als Abweichung.`)
})

test('„Betrag prüfen“ in einem offenen Jahr: kein Satz zur abgeschlossenen Abrechnung', async () => {
  extraItems = [{ id: 'gs2', propertyId: 'p1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: `Grundsteuer ${YEAR} (Nachtrag)`, amountCents: 61000, key: 'area' }]
  renderPage()
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
        <Belege renderThumb={() => Promise.resolve('')} />
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
  renderPage()
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
  const onEvaluate = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege renderThumb={() => Promise.resolve('')} onEvaluate={onEvaluate} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  fireEvent.change(screen.getByLabelText('Objekt für lose.pdf'), { target: { value: 'p2' } })
  const knopf = screen.getByRole('button', { name: 'lose.pdf per KI auswerten' }) as HTMLButtonElement
  expect(knopf.disabled).toBe(true)
  expect(screen.getByText(PLACEMENT_FIRST)).toBeTruthy()
  fireEvent.click(knopf)
  expect(onEvaluate).not.toHaveBeenCalled()
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
        <Belege renderThumb={() => Promise.resolve('')} />
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
  renderContinue(() => {})
  const weiter = await screen.findByRole('button', { name: 'abwasser.pdf weiter prüfen' })
  expect(weiter.classList.contains('small')).toBe(false)
  const picker = await screen.findByLabelText('Vorhandenen Beleg für Abwasser zuordnen')
  const upload = screen.getByLabelText('Beleg für Abwasser hochladen').closest('label')
  if (!upload) return expect.fail('Kein Knopf „Beleg nachreichen“')
  expect(upload.classList.contains('small')).toBe(false)
  expect(picker.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

// Durchsicht des Belegordners nach Zeitraum (#346 Schritt 12): Nach einem Wechsel auf Mai bis April beginnen Rumpf
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
        <Belege renderThumb={() => Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=')} />
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
        <Belege renderThumb={renderThumb} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('Wasser/Abwasser')
  // Alle Bilder sind angemeldet, mit Vorlauf, aber keins ist angefragt
  expect(FakeObserver.all.some((o) => o.observed.has(thumbOf('wasser.pdf')))).toBe(true)
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
        <Belege renderThumb={(file) => { asked.push(file); return Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw=') }} />
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

test('Posteingang: die neuesten 20, darunter „Ältere anzeigen (N)“', async () => {
  // 30 weitere lose Belege, je später hochgeladen, je weiter oben; dazu der eine aus dem Bestand (4_lose.pdf, der älteste)
  extraUploads = Array.from({ length: 30 }, (_, i) => ({ ...up(`${100 + i}_lose${i}.pdf`), uploadedAt: `2026-02-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }))
  const { container } = renderPage()
  await screen.findByText('📥 Posteingang (31)')
  const inbox = () => container.querySelector('.receipt-inbox') as HTMLElement
  const cards = () => [...inbox().querySelectorAll('.receipt-card')]
  expect(cards()).toHaveLength(20)
  expect(within(cards()[0] as HTMLElement).getAllByText('lose29.pdf').length).toBeGreaterThan(0)
  fireEvent.click(within(inbox()).getByRole('button', { name: 'Ältere anzeigen (11)' }))
  expect(cards()).toHaveLength(31)
  expect(within(inbox()).queryByRole('button', { name: /Ältere anzeigen/ })).toBeNull()
  // Eine Suche beginnt wieder bei den neuesten 20
  fireEvent.change(screen.getByRole('searchbox', { name: 'Suche' }), { target: { value: 'lose' } })
  await waitFor(() => expect(cards()).toHaveLength(20))
  expect(within(inbox()).getByRole('button', { name: 'Ältere anzeigen (11)' })).toBeTruthy()
})

// @vitest-environment jsdom
// Von Hand erfassen aus dem Beleg (#490 PR 3, #487 Teil 2): Die Seite Kosten öffnet „Neue Kostenposition“ mit dem Beleg
// oben als Vorschau, der Kostenart aus seinem Namen (ohne Treffer leer, und die Auswahl zeigt das), dem Rechnungsdatum
// aus der Textschicht als gelbem Vorschlag und den Angaben des Vorjahres über den Rechnungssteller, nie dem Betrag.
// Angezeigt muss sein, was gespeichert wird.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CostItem, Unit, UploadInfo } from '../types'
import { calendarPeriod } from '../../../shared/period.ts'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Kosten from './Kosten'
import type { ReceiptStart } from '../receiptForm'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true },
]
const YEAR = new Date().getFullYear() - 1
const PREV = YEAR - 1

const upload = (file: string, over: Partial<UploadInfo> = {}): UploadInfo => ({
  file, size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: file.replace(/^\d+_/, ''), mimeType: 'application/pdf',
  uploadedAt: '2026-01-01T00:00:00.000Z', sha256: file, propertyId: 'objekt-1', year: YEAR, invoiceDate: null, kind: 'receipt', ...over,
})
let items: CostItem[]
let uploads: UploadInfo[]
let sent: { url: string; method: string; body: Record<string, unknown> }[]
let plants: unknown[]
// Antworten, die einzelne Tests vorgeben: Anlegen abgelehnt, Datum am Beleg scheitert, Positionen nicht ladbar
let postError: string | null
let putUploadError: string | null
let itemsFail: boolean

beforeEach(() => {
  sent = []
  items = []
  uploads = []
  plants = []
  postError = null
  putUploadError = null
  itemsFail = false
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, method, body })
      if (url.includes('/split/preview')) {
        return json({ parts: [
          { period: `${YEAR}-01`, label: String(YEAR), days: 184, amountCents: 30247, labor35aCents: null, description: 'Versicherung', needsTaxYear: false, closed: false, startYear: YEAR, endYear: YEAR },
          { period: `${YEAR + 1}-01`, label: String(YEAR + 1), days: 181, amountCents: 29753, labor35aCents: null, description: 'Versicherung', needsTaxYear: false, closed: false, startYear: YEAR + 1, endYear: YEAR + 1 },
        ] })
      }
      if (method === 'POST' && url.startsWith('/api/costItems') && postError) return json({ error: postError }, 400)
      if (method === 'PUT' && url.startsWith('/api/uploads/') && putUploadError) return json({ error: putUploadError }, 500)
      if (method === 'POST' && url.startsWith('/api/costItems')) return json({ ...body, id: 'neu-1', propertyId: 'objekt-1' }, 201)
      return json({ ok: true })
    }
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/costItems') return itemsFail ? json({ error: 'Datenbank nicht lesbar' }, 500) : json(items)
    if (path === '/api/heating-plants') return json(plants)
    if (path === '/api/uploads') return json(uploads.map((u) => ({ ...u, bookedItemIds: [], bookedCents: {}, assessment: null })))
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPage(start: ReceiptStart, opts: { text?: string; onOpenInbox?: () => void } = {}) {
  const onDone = vi.fn()
  const readText = vi.fn(async () => opts.text ?? '')
  const view = render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Kosten units={UNITS} settings={null} receiptStart={start} onReceiptStartDone={onDone} onOpenInbox={opts.onOpenInbox ?? (() => {})}
            renderThumb={() => Promise.resolve('data:image/jpeg;base64,AA==')} readReceiptText={readText} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  return { ...view, onDone, readText }
}
const drawer = () => screen.findByRole('dialog', { name: 'Neue Kostenposition' })
const select = (label: RegExp) => screen.getByLabelText(label) as HTMLSelectElement

test('aus dem Beleg: Vorschau oben, Kostenart aus dem Namen, Beleg angehängt; „Anlegen“ bucht ihn', async () => {
  const u = upload('7_Müllabfuhr_2025.pdf')
  uploads = [u]
  const onOpenInbox = vi.fn()
  const { onDone } = renderPage(u, { onOpenInbox })
  const box = await drawer()
  expect(onDone).toHaveBeenCalledTimes(1)
  const preview = box.querySelector('[data-receipt-preview]')
  expect(preview?.getAttribute('href')).toBe('/uploads/7_M%C3%BCllabfuhr_2025.pdf')
  expect(preview?.getAttribute('target')).toBe('_blank')
  expect(within(box).getByRole('link', { name: /Beleg in neuem Tab öffnen/ })).toBe(preview)
  // Die Vorschau steht vor allen Feldern
  expect(preview?.compareDocumentPosition(select(/Kostenart/i)) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  await waitFor(() => expect(box.querySelector('[data-receipt-preview] img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AA=='))
  expect(select(/Kostenart/i).value).toBe('Müllabfuhr')
  expect(select(/Kostenart/i).selectedOptions[0]?.textContent).toBe('Müllabfuhr')
  // Der vorgeschlagene Schlüssel der Kostenart
  expect(select(/Umlageschlüssel/i).value).toBe('persons')
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Müllabfuhr' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '480,00' } })
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent.filter((r) => r.method === 'POST')).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ category: 'Müllabfuhr', key: 'persons', amountCents: 48000, invoiceFile: '7_Müllabfuhr_2025.pdf' })
  // Kein Datum gelesen, keins geschickt
  expect(sent.some((r) => r.url.startsWith('/api/uploads/'))).toBe(false)
  // Danach: die Bestätigung mit dem Weg zurück, der Fokus darauf
  const back = await screen.findByRole('button', { name: 'Zum Eingang' })
  await waitFor(() => expect(document.activeElement).toBe(back))
  expect(back.closest('[role="status"]')?.textContent).toContain('„Müllabfuhr“ ist angelegt, der Beleg „Müllabfuhr_2025.pdf“ hängt daran.')
  fireEvent.click(back)
  expect(onOpenInbox).toHaveBeenCalled()
})

test('ohne Kostenart im Namen: die Auswahl zeigt „— bitte wählen —“, „Anlegen“ meldet sie am Feld', async () => {
  const u = upload('8_scan0001.pdf')
  uploads = [u]
  renderPage(u)
  const box = await drawer()
  expect(select(/Kostenart/i).value).toBe('')
  expect(select(/Kostenart/i).selectedOptions[0]?.textContent).toBe('— bitte wählen —')
  expect(select(/Kostenart/i).required).toBe(true)
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Rechnung' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '12,00' } })
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  expect(await within(box).findAllByText(/Kostenart fehlt/)).not.toHaveLength(0)
  expect(sent).toEqual([])
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Gartenpflege' } })
  // Gewählt, steht die leere Wahl nicht mehr da
  expect([...select(/Kostenart/i).options].some((o) => o.value === '')).toBe(false)
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ category: 'Gartenpflege', invoiceFile: '8_scan0001.pdf' })
})

test('Rechnungsdatum aus dem Text der PDF: gelber Vorschlag am Feld, stehen gelassen am Beleg gespeichert, keine Beträge', async () => {
  const u = upload('9_Wasser.pdf')
  uploads = [u]
  const { readText } = renderPage(u, { text: 'Stadtwerke\nRechnungsdatum: 14.02.2025\nBetrag 480,00 €' })
  const box = await drawer()
  const date = await waitFor(() => (screen.getByLabelText(/^Rechnungsdatum/) as HTMLInputElement))
  await waitFor(() => expect(date.value).toBe('2025-02-14'))
  expect(readText).toHaveBeenCalledWith('9_Wasser.pdf', 'application/pdf')
  expect(within(box).getByText('Vorschlag aus dem Beleg').className).toContain('badge amber')
  expect(date.className).toContain('bg-amber-soft')
  // Kein Betrag aus dem Text
  expect((screen.getByLabelText(/^Betrag/i) as HTMLInputElement).value).toBe('')
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '480,00' } })
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent.find((r) => r.url.startsWith('/api/uploads/'))).toEqual({ url: '/api/uploads/9_Wasser.pdf', method: 'PUT', body: { invoiceDate: '2025-02-14' } }))
})

test('Rechnungsdatum: geändert, ist es kein Vorschlag mehr, und gespeichert wird das eingetragene', async () => {
  const u = upload('9_Wasser.pdf')
  uploads = [u]
  renderPage(u, { text: 'Datum 14. Februar 2025' })
  const box = await drawer()
  const date = await waitFor(() => (screen.getByLabelText(/^Rechnungsdatum/) as HTMLInputElement))
  await waitFor(() => expect(date.value).toBe('2025-02-14'))
  fireEvent.change(date, { target: { value: '2025-02-15' } })
  expect(within(box).queryByText('Vorschlag aus dem Beleg')).toBeNull()
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '480,00' } })
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent.find((r) => r.url.startsWith('/api/uploads/'))?.body).toEqual({ invoiceDate: '2025-02-15' }))
})

test('ein gespeichertes Rechnungsdatum steht da, ohne Vorschlag und ohne den Text zu lesen', async () => {
  const u = upload('9_Wasser.pdf', { invoiceDate: '2025-03-01' })
  uploads = [u]
  const { readText } = renderPage(u, { text: 'Rechnungsdatum: 14.02.2025' })
  const box = await drawer()
  const date = await waitFor(() => (screen.getByLabelText(/^Rechnungsdatum/) as HTMLInputElement))
  expect(date.value).toBe('2025-03-01')
  expect(readText).not.toHaveBeenCalled()
  expect(within(box).queryByText('Vorschlag aus dem Beleg')).toBeNull()
})

test('Rechnungssteller aus dem Vorjahr: der Hinweis nennt die Position, „Übernehmen“ setzt Kostenart, Beschreibung und Schlüssel, nie den Betrag', async () => {
  items = [{ id: 'v1', propertyId: 'objekt-1', period: calendarPeriod(PREV), category: 'Gartenpflege', description: `Gartenpflege ${PREV}`, vendor: 'Grün & Co', amountCents: 36000, key: 'units', participantUnitIds: ['u1'] }]
  const u = upload('8_scan0001.pdf')
  uploads = [u]
  renderPage(u)
  const box = await drawer()
  // Die Rechnungssteller des Vorjahres stehen als Vorschläge zum Tippen bereit
  const vendor = screen.getByLabelText(/Rechnungssteller/i) as HTMLInputElement
  const list = document.getElementById(vendor.getAttribute('list') ?? '')
  expect([...(list?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'))).toEqual(['Grün & Co'])
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '390,00' } })
  fireEvent.change(vendor, { target: { value: 'grün & co' } })
  const hint = await within(box).findByText(`Im Vorjahr: „Gartenpflege ${PREV}“, Gartenpflege, 360,00 €.`)
  fireEvent.click(within(hint.parentElement ?? box).getByRole('button', { name: /^Übernehmen/ }))
  expect(select(/Kostenart/i).value).toBe('Gartenpflege')
  expect((screen.getByLabelText(/Beschreibung/i) as HTMLInputElement).value).toBe(`Gartenpflege ${YEAR}`)
  expect(select(/Umlageschlüssel/i).value).toBe('units')
  expect((screen.getByLabelText(/^Betrag/i) as HTMLInputElement).value).toBe('390,00')
  // Übernommen, steht der Hinweis nicht mehr da
  expect(within(box).queryByText(/^Im Vorjahr:/)).toBeNull()
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent.filter((r) => r.method === 'POST')).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ category: 'Gartenpflege', description: `Gartenpflege ${YEAR}`, key: 'units', participantUnitIds: ['u1'], amountCents: 39000, vendor: 'grün & co', invoiceFile: '8_scan0001.pdf' })
})

test('ein anderer Rechnungssteller als im Vorjahr: kein Hinweis', async () => {
  items = [{ id: 'v1', propertyId: 'objekt-1', period: calendarPeriod(PREV), category: 'Gartenpflege', description: 'Garten', vendor: 'Grün & Co', amountCents: 36000, key: 'area' }]
  const u = upload('8_scan0001.pdf')
  uploads = [u]
  renderPage(u)
  const box = await drawer()
  fireEvent.change(screen.getByLabelText(/Rechnungssteller/i), { target: { value: 'Grün' } })
  expect(within(box).queryByText(/^Im Vorjahr:/)).toBeNull()
})

// ---------- Durchsicht ----------

const HEATING_PLANT = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
}

// M1: Ein ungeprüfter Vorschlag aus dem Text speist nie das Jahr der Zahlung; ein bestätigtes Datum schon, und ein nur
// vorbelegtes Jahr folgt jeder späteren Änderung des Datums (auch dem Leeren, K4), ein gewähltes nicht. K7: Das
// Datumsfeld sagt, dass es das Jahr der Zahlung bestimmt.
test('M1: Jahr der Zahlung einer Heizperiode über zwei Jahre nur aus einem bestätigten Datum, vorbelegt folgt es dem Datum', async () => {
  plants = [HEATING_PLANT]
  const u = upload('9_Heizung.pdf')
  uploads = [u]
  const heizperiodeText = async () => (await waitFor(() => select(/^Heizperiode$/))).selectedOptions[0]?.textContent ?? ''
  renderPage(u, { text: `Rechnungsdatum: 20.12.${PREV}` })
  const box = await drawer()
  expect(select(/Kostenart/i).value).toBe('Heizung und Warmwasser')
  const [, beginn, ende] = /(\d{4})\/(\d{4})/.exec(await heizperiodeText()) ?? []
  if (!beginn || !ende) throw new Error('keine Heizperiode über zwei Jahre')
  const date = await waitFor(() => screen.getByLabelText(/^Rechnungsdatum/) as HTMLInputElement)
  await waitFor(() => expect(date.value).toBe(`${PREV}-12-20`))
  const jahr = await waitFor(() => select(/Jahr der Zahlung/i))
  expect(jahr.value).toBe('')
  expect(within(box).getByText(/Bestimmt das Jahr der Zahlung/)).toBeTruthy()
  fireEvent.click(within(box).getByRole('button', { name: /^Bestätigen/ }))
  await waitFor(() => expect(jahr.value).toBe(beginn))
  fireEvent.change(date, { target: { value: `${ende}-01-12` } })
  await waitFor(() => expect(jahr.value).toBe(ende))
  // K4: absichtlich geleert, gilt kein Datum mehr, und das vorbelegte Jahr geht mit
  fireEvent.change(date, { target: { value: '' } })
  await waitFor(() => expect(jahr.value).toBe(''))
  fireEvent.change(date, { target: { value: `${ende}-01-12` } })
  await waitFor(() => expect(jahr.value).toBe(ende))
  // Selbst gewählt, bleibt das Jahr
  fireEvent.change(jahr, { target: { value: beginn } })
  fireEvent.change(date, { target: { value: `${ende}-02-01` } })
  await new Promise((r) => setTimeout(r, 50))
  expect(jahr.value).toBe(beginn)
})

// S2: die Kostenart aus dem Dateinamen ist ein Vorschlag, gelb gekennzeichnet wie das Datum
test('S2: die Kostenart aus dem Dateinamen steht gelb als Vorschlag, bis jemand sie ändert', async () => {
  const u = upload('7_Müllabfuhr.pdf')
  uploads = [u]
  renderPage(u)
  const box = await drawer()
  expect(within(box).getByText('Vorschlag aus dem Dateinamen').className).toContain('badge amber')
  expect(select(/Kostenart/i).className).toContain('bg-amber-soft')
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Gartenpflege' } })
  expect(within(box).queryByText('Vorschlag aus dem Dateinamen')).toBeNull()
})

// S3: Beim Bearbeiten keine Lesung aus dem Text; Speichern einer Änderung schickt kein Datum an den Beleg.
test('S3: eine bestehende Position bearbeiten: kein Vorschlag, kein Datum an den Beleg', async () => {
  items = [{ id: 'k1', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Gartenpflege', description: 'Garten', amountCents: 10000, key: 'area', invoiceFile: '5_garten.pdf' }]
  uploads = [upload('5_garten.pdf')]
  const readText = vi.fn(async () => 'Rechnungsdatum: 14.02.2025')
  render(
    <PeriodProvider><PropertyProvider><UIProvider>
      <Kosten units={UNITS} settings={null} renderThumb={() => Promise.resolve('')} readReceiptText={readText} />
    </UIProvider></PropertyProvider></PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
  const box = await screen.findByRole('dialog', { name: 'Kostenposition bearbeiten' })
  fireEvent.change(within(box).getByLabelText(/^Betrag/), { target: { value: '120,00' } })
  await new Promise((r) => setTimeout(r, 50))
  expect(readText).not.toHaveBeenCalled()
  expect(within(box).queryByText('Vorschlag aus dem Beleg')).toBeNull()
  fireEvent.click(within(box).getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent.some((r) => r.url === '/api/costItems/k1')).toBe(true))
  expect(sent.some((r) => r.url.startsWith('/api/uploads/'))).toBe(false)
})

// S4: Der Beleg ist inzwischen gelöscht: Der Satz des Servers steht im Formular, es bleibt offen.
test('S4: gelöschter Beleg: der Satz des Servers im offenen Formular', async () => {
  const u = upload('7_Müllabfuhr.pdf')
  uploads = [u]
  postError = 'Den Beleg „7_Müllabfuhr.pdf“ gibt es unter „Belege“ nicht (mehr). Bitte wählen Sie ihn neu oder laden Sie ihn hoch.'
  renderPage(u)
  const box = await drawer()
  fireEvent.change(within(box).getByLabelText(/Beschreibung/), { target: { value: 'Müll' } })
  fireEvent.change(within(box).getByLabelText(/^Betrag/), { target: { value: '10,00' } })
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  expect(await within(box).findByText(/gibt es unter „Belege“ nicht \(mehr\)/)).toBeTruthy()
  expect(screen.getByRole('dialog', { name: 'Neue Kostenposition' })).toBe(box)
  expect(screen.queryByRole('button', { name: 'Zum Eingang' })).toBeNull()
})

// S4: Das Datum lässt sich nicht am Beleg speichern: Die Position bleibt angelegt, eine Meldung sagt es.
test('S4: Datum am Beleg scheitert: Meldung, die Position ist angelegt', async () => {
  const u = upload('9_Wasser.pdf')
  uploads = [u]
  putUploadError = 'Platte voll'
  renderPage(u, { text: 'Rechnungsdatum: 14.02.2025' })
  const box = await drawer()
  await waitFor(() => expect((screen.getByLabelText(/^Rechnungsdatum/) as HTMLInputElement).value).toBe('2025-02-14'))
  fireEvent.change(within(box).getByLabelText(/Beschreibung/), { target: { value: 'Wasser' } })
  fireEvent.change(within(box).getByLabelText(/^Betrag/), { target: { value: '10,00' } })
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  expect(await screen.findAllByText(/Das Rechnungsdatum wurde nicht am Beleg gespeichert: Platte voll/)).not.toHaveLength(0)
  expect(sent.filter((r) => r.method === 'POST' && r.url.startsWith('/api/costItems'))).toHaveLength(1)
  expect(await screen.findByRole('button', { name: 'Zum Eingang' })).toBeTruthy()
})

// S4: Aufteilen über zwei Zeiträume aus dem Beleg: alle Teile tragen den Beleg, danach die Bestätigung.
test('S4: Aufteilen aus dem Beleg: die Teile tragen den Beleg', async () => {
  const u = upload('6_Versicherung.pdf')
  uploads = [u]
  renderPage(u)
  const box = await drawer()
  fireEvent.change(within(box).getByLabelText(/Beschreibung/), { target: { value: 'Versicherung' } })
  fireEvent.change(within(box).getByLabelText(/^Betrag/), { target: { value: '600,00' } })
  fireEvent.change(within(box).getByLabelText(/Leistungszeitraum/), { target: { value: `${YEAR}-07-01` } })
  fireEvent.change(within(box).getByLabelText(/^bis$/), { target: { value: `${YEAR + 1}-06-30` } })
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Rechnung aufteilen?' })).getByRole('button', { name: 'Aufteilen und speichern' }))
  await waitFor(() => expect(sent.some((r) => r.url.startsWith('/api/costItems/split?') || r.url === '/api/costItems/split')).toBe(true))
  expect(sent.find((r) => /\/api\/costItems\/split(\?|$)/.test(r.url))?.body).toMatchObject({ invoiceFile: '6_Versicherung.pdf' })
  expect(await screen.findByRole('button', { name: 'Zum Eingang' })).toBeTruthy()
})

// K2: Lassen sich die Positionen nicht laden, öffnet das Formular nicht still nie, sondern die Seite sagt es.
test('K2: Positionen nicht ladbar: eine Meldung statt eines Formulars, der Sprung ist erledigt', async () => {
  itemsFail = true
  const u = upload('7_Müllabfuhr.pdf')
  uploads = [u]
  const { onDone } = renderPage(u)
  expect(await screen.findByText(/Das Formular zum Beleg „Müllabfuhr.pdf“ ließ sich nicht öffnen/)).toBeTruthy()
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog', { name: 'Neue Kostenposition' })).toBeNull()
})

// K5: Der Hinweis auf das Vorjahr erscheint in einem Live-Bereich, der schon vorher da ist (sonst sagt ihn kein Vorleser an).
test('K5: der Live-Bereich des Vorjahres-Hinweises steht vor dem Tippen da', async () => {
  const u = upload('8_scan0001.pdf')
  uploads = [u]
  renderPage(u)
  const box = await drawer()
  const live = box.querySelector('[data-vendor-hint][aria-live="polite"]')
  expect(live).not.toBeNull()
  expect(live?.textContent).toBe('')
})

// K6: Nach dem Anlegen aus dem Beleg sagt es die Bestätigung, nicht noch eine Mitteilung dazu.
test('K6: kein doppelter Erfolg nach dem Anlegen aus dem Beleg', async () => {
  const u = upload('7_Müllabfuhr.pdf')
  uploads = [u]
  renderPage(u)
  const box = await drawer()
  fireEvent.change(within(box).getByLabelText(/Beschreibung/), { target: { value: 'Müll' } })
  fireEvent.change(within(box).getByLabelText(/^Betrag/), { target: { value: '10,00' } })
  fireEvent.click(within(box).getByRole('button', { name: /^Anlegen$/ }))
  await screen.findByRole('button', { name: 'Zum Eingang' })
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByText('„Müll“ angelegt.')).toBeNull()
})

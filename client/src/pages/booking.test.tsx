// @vitest-environment jsdom
// Die Belegbuchung im Browser (#170): Schnellerfassung und Kosten benutzen dieselbe Komponente
// „Auswertung prüfen“, und die Zahlen kommen vom (nachgebauten) Server mit dem echten Planer.
// Die vier Abnahmefälle der Spezifikation stehen hier als „Abnahme A“ bis „Abnahme D“.
import { useLayoutEffect } from 'react'
import { afterEach, assert, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AssessmentView, CostItem, Extraction, LineFields, LineSuggestion, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Schnellerfassung from './Schnellerfassung'
import Kosten from './Kosten'
import AssessmentReview from '../components/AssessmentReview'
import { fakeBooking, type FakeBooking } from '../testing/fakeBooking'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
// Die Seiten öffnen im Vorjahr des Kalenderjahres (year.tsx).
const YEAR = new Date().getFullYear() - 1

let fake: FakeBooking
let extraction: Extraction
let evaluated: number
// Hält eine Vorschau-Anfrage an, bis der Test sie freigibt (Sperre während `busy`).
let hold: Promise<void> | null
// Ersetzt die Liste der offenen Auswertungen, die der nachgebaute Server liefert.
let openViews: AssessmentView[] | null

const estimate = (id: string, category: string, amountCents: number, extra: Partial<CostItem> = {}): CostItem =>
  ({ id, propertyId: 'objekt-1', year: YEAR, category, description: `${category} ${YEAR}`, amountCents, key: 'area', ...extra })
const invoice = (positions: Extraction['positions'], vendor = 'Stadtwerke'): Extraction => ({ vendor, invoiceDate: `${YEAR}-12-31`, positions })

beforeEach(() => {
  evaluated = 0
  hold = null
  openViews = null
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/intake' || url === '/api/extract') {
      const file = `beleg-${++evaluated}.pdf`
      return json({ file, kind: 'rechnung', extraction, assessment: fake.evaluate(file, extraction, { year: YEAR }) })
    }
    if (hold && url.endsWith('/plan')) await hold
    if (openViews && url.startsWith('/api/assessments?')) return json(openViews)
    const handled = await fake.handle(url, init)
    if (handled) return handled
    if (url.split('?')[0] === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    return json((init?.method ?? 'GET') === 'GET' ? [] : { ok: true })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const intake = () => render(<YearProvider><PropertyProvider><UIProvider><Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} /></UIProvider></PropertyProvider></YearProvider>)
const costs = () => render(<YearProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></YearProvider>)

async function upload(container: HTMLElement, count = 1) {
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  // Fotos statt PDFs: Ein PDF liest der Browser vor dem Hochladen mit pdf.js, das in jsdom nicht läuft.
  const files = Array.from({ length: count }, (_, i) => new File(['JPEG'], `beleg-${i + 1}.jpg`, { type: 'image/jpeg' }))
  fireEvent.change(input, { target: { files } })
}
const actionOf = async (description: string): Promise<HTMLSelectElement> => {
  const el = await screen.findByRole('combobox', { name: `Was geschieht mit „${description}“?` }, SLOW)
  if (!(el instanceof HTMLSelectElement)) throw new Error('kein Auswahlfeld')
  return el
}
async function previewAndBook(): Promise<{ shown: string[] }> {
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  const panel = await screen.findByLabelText('Vorschau', {}, SLOW)
  const shown = within(panel).getAllByRole('listitem').map((li) => li.textContent ?? '')
  fireEvent.click(screen.getByRole('button', { name: 'Buchen' }))
  return { shown }
}

test('Abnahme A im Browser: Wasser 700 € + 800 € an die Schätzung über 1.500 €; eine Position, Vorschau gleich Ergebnis', async () => {
  fake = fakeBooking({ items: [estimate('wa', 'Wasser/Abwasser', 150000)], units: UNITS })
  extraction = invoice([{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }, { description: 'Abwasser', category: 'Wasser/Abwasser', amountEur: 800 }])
  const { container } = intake()
  await upload(container)
  const frisch = await actionOf('Frischwasser')
  expect(frisch.value).toBe('') // Kandidat: nicht vorab angehakt
  fireEvent.change(frisch, { target: { value: 'link:wa' } })
  fireEvent.change(await actionOf('Abwasser'), { target: { value: 'link:wa' } })
  const { shown } = await previewAndBook()
  const done = await screen.findByLabelText('Gebucht', {}, SLOW)
  expect(done.textContent).toContain(shown.join(' · '))
  expect(fake.items.filter((i) => i.category === 'Wasser/Abwasser').map((i) => [i.id, i.amountCents])).toEqual([['wa', 150000]])
})

// Eine Gutschrift wird nur mit Gutschriften als mögliche Doppelung verglichen (candidatePool in
// server/src/assessment.ts); neben der Schätzung über 700 € gibt es keine, also auch keine Rückfrage.
test('Abnahme B im Browser: Restmüll 700 € mit Gutschrift −50 €; die Gutschrift bietet kein Verknüpfen und wird ohne Rückfrage angelegt', async () => {
  fake = fakeBooking({ items: [estimate('mu', 'Müllabfuhr', 70000)], units: UNITS })
  extraction = invoice([{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 700 }, { description: 'Gutschrift Tonne', category: 'Müllabfuhr', amountEur: -50 }])
  const { container } = intake()
  await upload(container)
  const gutschrift = await actionOf('Gutschrift Tonne')
  expect([...gutschrift.options].map((o) => o.value).some((v) => v.startsWith('link:'))).toBe(false)
  fireEvent.change(await actionOf('Restmüll'), { target: { value: 'link:mu' } })
  fireEvent.change(gutschrift, { target: { value: 'create' } })
  await previewAndBook()
  await screen.findByLabelText('Gebucht', {}, SLOW)
  expect(screen.queryByRole('button', { name: 'Trotzdem anlegen' })).toBeNull()
  expect(fake.items.map((i) => i.amountCents).sort((a, b) => a - b)).toEqual([-5000, 70000])
})

test('Abnahme C im Browser: Schätzung mit §35a 1.000 €, Rechnung ohne Lohnanteil: die Vorschau sagt, dass er entfernt wird', async () => {
  fake = fakeBooking({ items: [estimate('gp', 'Gartenpflege', 150000, { labor35aCents: 100000 })], units: UNITS })
  extraction = invoice([{ description: 'Gartenpflege Saison', category: 'Gartenpflege', amountEur: 1450 }], 'Gärtnerei')
  const { container } = intake()
  await upload(container)
  fireEvent.change(await actionOf('Gartenpflege Saison'), { target: { value: 'link:gp' } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  expect((await screen.findByLabelText('Vorschau', {}, SLOW)).textContent).toMatch(/Lohnanteil von 1\.000,00\s€ wird entfernt/)
  fireEvent.click(screen.getByRole('button', { name: 'Buchen' }))
  await screen.findByLabelText('Gebucht', {}, SLOW)
  const gp = fake.items.find((i) => i.id === 'gp')
  expect([gp?.amountCents, gp?.labor35aCents]).toEqual([145000, undefined])
})

test('Abnahme D im Browser: doppelt auf „Buchen“ ergibt eine Position', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = intake()
  await upload(container)
  expect((await actionOf('Grundsteuer B')).value).toBe('create')
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  await screen.findByLabelText('Vorschau', {}, SLOW)
  const buchen = screen.getByRole('button', { name: 'Buchen' })
  fireEvent.click(buchen)
  fireEvent.click(buchen)
  await screen.findByLabelText('Gebucht', {}, SLOW)
  await waitFor(() => expect(fake.items).toHaveLength(1))
})

test('Weiter prüfen nach dem Neuladen: eine offene Auswertung steht ohne neue KI-Anfrage wieder da', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  fake.evaluate('alt.pdf', invoice([{ description: 'Hausmeister', category: 'Hauswart', amountEur: 300 }], 'Hausmeisterdienst'), { year: YEAR })
  intake()
  expect((await actionOf('Hausmeister')).value).toBe('create')
  expect(evaluated).toBe(0)
})

test('Geänderter Stand zwischen Vorschau und Buchung: die Seite zeigt die neue Vorschau und bucht nichts', async () => {
  fake = fakeBooking({ items: [estimate('wa', 'Wasser/Abwasser', 140000)], units: UNITS })
  extraction = invoice([{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }])
  const { container } = intake()
  await upload(container)
  fireEvent.change(await actionOf('Frischwasser'), { target: { value: 'link:wa' } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  await screen.findByLabelText('Vorschau', {}, SLOW)
  fake.patchItem('wa', { amountCents: 145000 })
  fireEvent.click(screen.getByRole('button', { name: 'Buchen' }))
  expect(await screen.findByText(/Seit der Vorschau hat sich der Stand geändert/, {}, SLOW)).toBeTruthy()
  expect((await screen.findByLabelText('Vorschau', {}, SLOW)).textContent).toMatch(/1\.450,00\s€ → 700,00\s€/)
  expect(fake.items.find((i) => i.id === 'wa')?.amountCents).toBe(145000)
})

test('Position ohne Betrag: Feld leer, rot, nicht vorab angehakt; nicht umlagefähig ohne Schlüssel', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Unlesbar', category: 'Grundsteuer' }, { description: 'Heizungsreparatur', category: 'Nicht umlagefähig', amountEur: 200 }], 'Stadt')
  const { container } = intake()
  await upload(container)
  const unlesbar = await actionOf('Unlesbar')
  expect(unlesbar.value).toBe('')
  const row = unlesbar.closest('tr')
  expect(row?.querySelector('.ampel.rot')).toBeTruthy()
  const betrag = within(row ?? document.body).getByRole('textbox', { name: 'Betrag €' })
  if (!(betrag instanceof HTMLInputElement)) return assert.fail('das Feld „Betrag €“ ist kein Eingabefeld')
  expect(betrag.value).toBe('')
  expect(screen.getByText('— trägt der Vermieter')).toBeTruthy()
})

test('„Alle grünen übernehmen“: dieselbe Kostenart aus zwei Belegen wird nicht still zweimal angelegt', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = intake()
  await upload(container, 2)
  await waitFor(() => expect(screen.getAllByRole('combobox', { name: 'Was geschieht mit „Grundsteuer B“?' })).toHaveLength(2), SLOW)
  fireEvent.click(await screen.findByRole('button', { name: /Alle grünen übernehmen/ }, SLOW))
  expect(await screen.findByText(/Noch zu prüfen: „Grundsteuer B“/, {}, SLOW)).toBeTruthy()
  expect(fake.items).toHaveLength(1)
})

test('Kosten: dieselbe Komponente, die alte Übernahme gibt es nicht mehr', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = costs()
  await upload(container)
  expect((await actionOf('Grundsteuer B')).value).toBe('create')
  expect(screen.queryByRole('button', { name: /Ausgewählte Positionen/ })).toBeNull()
  await previewAndBook()
  await screen.findByLabelText('Gebucht', {}, SLOW)
  expect(fake.items.map((i) => [i.amountCents, i.invoiceFile])).toEqual([[61240, 'beleg-1.pdf']])
})

test('Eingaben in einer Karte bleiben stehen, wenn eine andere gebucht wird', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = intake()
  await upload(container, 2)
  const [first, second] = await waitFor(() => {
    const found = screen.getAllByRole('combobox', { name: 'Was geschieht mit „Grundsteuer B“?' }).map((el) => el.closest('.assessment-review'))
    expect(found).toHaveLength(2)
    return found
  }, SLOW)
  if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return assert.fail('die beiden Karten fehlen')
  fireEvent.change(within(second).getByRole('textbox', { name: 'Betrag €' }), { target: { value: '600,00' } })
  fireEvent.click(within(first).getByRole('button', { name: 'Vorschau' }))
  await within(first).findByLabelText('Vorschau', {}, SLOW)
  fireEvent.click(within(first).getByRole('button', { name: 'Buchen' }))
  await within(first).findByLabelText('Gebucht', {}, SLOW)
  await waitFor(() => expect(fake.requests.filter((r) => r.path.endsWith('/book'))).toHaveLength(1))
  // Die Seite hat nach der Buchung alle Auswertungen neu geladen; die Karte B ist dieselbe.
  await waitFor(() => expect(screen.getByText(/✓ angelegt als/)).toBeTruthy())
  const betrag = within(second).getByRole('textbox', { name: 'Betrag €' })
  if (!(betrag instanceof HTMLInputElement)) return assert.fail('das Feld „Betrag €“ ist kein Eingabefeld')
  expect(betrag.value).toBe('600,00')
})

test('Rückfrage vor dem Anlegen: gibt es schon eine Position derselben Kostenart, legt erst „Trotzdem anlegen“ an', async () => {
  fake = fakeBooking({ items: [estimate('gs', 'Grundsteuer', 61000)], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = intake()
  await upload(container)
  const action = await actionOf('Grundsteuer B')
  expect(action.value).toBe('') // Kandidat: nicht vorab angehakt
  fireEvent.change(action, { target: { value: 'create' } })
  await previewAndBook()
  fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem anlegen' }, SLOW))
  await screen.findByLabelText('Gebucht', {}, SLOW)
  expect(fake.items.map((i) => i.amountCents).sort((a, b) => a - b)).toEqual([61000, 61240])
})

test('Kosten: eine ausgewertete Rechnung ist gespeichert, der Jahreswechsel fragt deshalb nicht nach', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = costs()
  await upload(container)
  await actionOf('Grundsteuer B')
  const jahr = screen.getByRole('combobox', { name: 'Abrechnungsjahr' })
  fireEvent.change(jahr, { target: { value: String(YEAR - 1) } })
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Abrechnungsjahr' })).toHaveProperty('value', String(YEAR - 1)), SLOW)
  expect(screen.queryByText('Offene Eingaben verwerfen?')).toBeNull()
})

test('eine verworfene Zeile zeigt „verworfen“ und nicht „offen lassen“', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }, { description: 'Mahngebühr', category: 'Grundsteuer', amountEur: 5 }], 'Stadt')
  const { container } = intake()
  await upload(container)
  fireEvent.change(await actionOf('Mahngebühr'), { target: { value: 'dismiss' } })
  await previewAndBook()
  await screen.findByLabelText('Gebucht', {}, SLOW)
  await screen.findByText(/✓ angelegt als „Grundsteuer B“/, {}, SLOW)
  const mahn = await actionOf('Mahngebühr')
  expect(mahn.value).toBe('dismiss')
  expect(mahn.selectedOptions[0]?.textContent).toMatch(/verworfen/)
  expect([...mahn.options].some((o) => o.value === '')).toBe(false)
  // Unverändert verworfen ist keine Entscheidung: nichts zu zeigen, nichts zu buchen.
  expect(screen.getByRole('button', { name: 'Vorschau' })).toHaveProperty('disabled', true)
})

test('ein anderes Jahr an der Karte verwirft die sichtbare Vorschau', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = intake()
  await upload(container)
  await actionOf('Grundsteuer B')
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  await screen.findByLabelText('Vorschau', {}, SLOW)
  fireEvent.change(screen.getByRole('combobox', { name: 'Jahr der Buchung' }), { target: { value: String(YEAR - 1) } })
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Jahr der Buchung' })).toHaveProperty('value', String(YEAR - 1)), SLOW)
  expect(screen.queryByLabelText('Vorschau')).toBeNull()
})

test('kommt eine neue Auswertung (eine andere Karte wird gebucht), verschwindet die Vorschau dieser Karte', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = intake()
  await upload(container, 2)
  const [first, second] = await waitFor(() => {
    const found = screen.getAllByRole('combobox', { name: 'Was geschieht mit „Grundsteuer B“?' }).map((el) => el.closest('.assessment-review'))
    expect(found).toHaveLength(2)
    return found
  }, SLOW)
  if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return assert.fail('die beiden Karten fehlen')
  fireEvent.click(within(second).getByRole('button', { name: 'Vorschau' }))
  await within(second).findByLabelText('Vorschau', {}, SLOW)
  fireEvent.click(within(first).getByRole('button', { name: 'Vorschau' }))
  await within(first).findByLabelText('Vorschau', {}, SLOW)
  fireEvent.click(within(first).getByRole('button', { name: 'Buchen' }))
  await within(first).findByLabelText('Gebucht', {}, SLOW)
  await waitFor(() => expect(within(second).queryByLabelText('Vorschau')).toBeNull(), SLOW)
})

test('während die Vorschau läuft, lässt sich das Jahr der Karte nicht ändern', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt')
  const { container } = intake()
  await upload(container)
  await actionOf('Grundsteuer B')
  let release = () => {}
  hold = new Promise<void>((resolve) => { release = resolve })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Jahr der Buchung' })).toHaveProperty('disabled', true))
  release()
  await screen.findByLabelText('Vorschau', {}, SLOW)
  expect(screen.getByRole('combobox', { name: 'Jahr der Buchung' })).toHaveProperty('disabled', false)
})

test('„grüne Vorschläge bereit“ zählt nur, was „Alle grünen übernehmen“ auch bucht', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  // Grün, aber nicht vorab angehakt: „Alle grünen“ bucht die Zeile nicht, also zählt sie dort nicht.
  openViews = [crafted({}, { level: 'gruen', preselected: false })]
  intake()
  expect((await actionOf('Hausmeister')).value).toBe('')
  expect(screen.queryByRole('button', { name: /Alle grünen übernehmen/ })).toBeNull()
})

// Eine Auswertung, wie der Server sie liefern könnte, für Fälle, die der echte Planer heute nicht
// erzeugt (eine Kostenart aus dem Altbestand, ein grüner Vorschlag ohne Vorauswahl).
const crafted = (fields: Partial<LineFields>, extra: Partial<LineSuggestion> = {}): AssessmentView => ({
  id: 'a1', file: 'alt.pdf', propertyId: 'objekt-1', year: YEAR, detectedYear: YEAR, requestedYear: YEAR, vendor: 'Hausmeisterdienst', invoiceDate: null,
  totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, nextIdx: 1, createdAt: '2026-10-02T00:00:00.000Z',
  originalName: 'alt.pdf', open: true, sumWarning: null,
  lines: [{
    idx: 0, description: 'Hausmeister', category: 'Hauswart', categoryGuessed: false, amountCents: 30000, labor35aCents: null,
    booking: null, costItemId: null, dismissed: false, reassessed: false, state: 'open', itemDescription: null,
    suggestion: {
      fields: { description: 'Hausmeister', category: 'Hauswart', amountCents: 30000, labor35aCents: null, key: 'area', allocation: null, externalTotalCents: null, ...fields },
      candidates: [], level: 'gelb', reasons: [], preselected: false, ...extra,
    },
  }],
})

test('eine Kostenart, die es in der Liste nicht gibt, steht im Auswahlfeld als gewählt da', () => {
  render(<UIProvider><AssessmentReview assessment={crafted({ category: 'Hausmeister (alt)' })} units={UNITS} onChange={() => {}} /></UIProvider>)
  const kostenart = screen.getByRole('combobox', { name: 'Kostenart' })
  if (!(kostenart instanceof HTMLSelectElement)) return assert.fail('die Kostenart ist kein Auswahlfeld')
  expect(kostenart.value).toBe('Hausmeister (alt)')
})

// Eine Eingabe, die nach dem Einfügen der Karte, aber vor Reacts nachgelagerten Effekten ankommt,
// darf nicht verloren gehen. So geschah es: Der Effekt, der die Eingaben bei neuer Gestalt der
// Zeilen zurücksetzt, lief auch beim ersten Einfügen und überschrieb, was schon eingegeben war.
// Abnahme A buchte so nur „Abwasser“ (80000 statt 150000 Cent). Der Layout-Effekt setzt die
// Eingabe genau in diese Lücke: nach dem Einfügen, vor den nachgelagerten Effekten.
test('eine Eingabe gleich nach dem Erscheinen der Karte bleibt stehen', () => {
  function EarlyInput() {
    useLayoutEffect(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Was geschieht mit „Hausmeister“?' }), { target: { value: 'create' } })
    }, [])
    return null
  }
  render(<UIProvider><AssessmentReview assessment={crafted({})} units={UNITS} onChange={() => {}} /><EarlyInput /></UIProvider>)
  expect(screen.getByRole('combobox', { name: 'Was geschieht mit „Hausmeister“?' })).toHaveProperty('value', 'create')
})

// ---------- Schlussdurchsicht ----------

// Eine Jahresrechnung vom Februar ohne Leistungszeitraum: Das Jahr aus dem Beleg ist das Folgejahr.
const februar = (): Extraction => ({ vendor: 'Hausmeisterdienst', invoiceDate: `${YEAR + 1}-02-10`, positions: [{ description: 'Hausmeister', category: 'Hauswart', amountEur: 300 }] })

test('I1: ein Beleg aus einem anderen Jahr ist nicht vorab angehakt, und „Alle grünen übernehmen“ bucht ihn nicht', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = februar()
  const { container } = intake()
  await upload(container)
  expect((await actionOf('Hausmeister')).value).toBe('')
  expect(screen.getByText(`Jahr ${YEAR + 1}`)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Alle grünen übernehmen/ })).toBeNull()
  expect(fake.items).toHaveLength(0)
})

test('I1: die Kostenseite nennt das Jahr des Belegs, und die Vorschau das Jahr der neuen Position', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = februar()
  const { container } = costs()
  await upload(container)
  const action = await actionOf('Hausmeister')
  expect(action.value).toBe('')
  expect(screen.getByText(`Jahr ${YEAR + 1}`)).toBeTruthy()
  fireEvent.change(action, { target: { value: 'create' } })
  const { shown } = await previewAndBook()
  expect(shown[0]).toMatch(new RegExp(`^Neu für ${YEAR + 1}: „Hausmeister“`))
  await screen.findByLabelText('Gebucht', {}, SLOW)
  expect(fake.items.map((i) => i.year)).toEqual([YEAR + 1])
})

test('I2: nur Verwerfen zeigt in Vorschau und Erfolgsmeldung, was geschieht', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  extraction = invoice([{ description: 'Mahngebühr', category: 'Grundsteuer', amountEur: 5 }], 'Stadt')
  const { container } = intake()
  await upload(container)
  fireEvent.change(await actionOf('Mahngebühr'), { target: { value: 'dismiss' } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  const panel = await screen.findByLabelText('Vorschau', {}, SLOW)
  expect(panel.textContent).toContain('„Mahngebühr“ wird verworfen.')
  fireEvent.click(screen.getByRole('button', { name: 'Buchen' }))
  const done = await screen.findByLabelText('Gebucht', {}, SLOW)
  expect(done.textContent).toContain('„Mahngebühr“ wird verworfen.')
})

test('I2: ändert sich die Gestalt der Zeilen von außen, verschwinden Vorschau und Erfolgsmeldung', async () => {
  fake = fakeBooking({ items: [], units: UNITS })
  const view = fake.evaluate('g.pdf', invoice([{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }], 'Stadt'), { year: YEAR })
  let current = view
  const { rerender } = render(<UIProvider><AssessmentReview assessment={current} units={UNITS} onChange={(next) => { current = next }} /></UIProvider>)
  expect((await actionOf('Grundsteuer B')).value).toBe('create')
  await previewAndBook()
  await waitFor(() => expect(current.lines[0]?.state).toBe('created'), SLOW)
  rerender(<UIProvider><AssessmentReview assessment={current} units={UNITS} onChange={(next) => { current = next }} /></UIProvider>)
  expect(screen.getByLabelText('Gebucht')).toBeTruthy()
  // Ein anderer Tab löscht die Position: Die Zeile ist wieder offen, die Meldung gilt nicht mehr.
  await fake.handle(`/api/costItems/${current.lines[0]?.costItemId ?? ''}`, { method: 'DELETE' })
  const reopened = await (await fake.handle(`/api/assessments/${view.id}`))?.json()
  rerender(<UIProvider><AssessmentReview assessment={reopened} units={UNITS} onChange={() => {}} /></UIProvider>)
  expect(screen.queryByLabelText('Gebucht')).toBeNull()
  expect(screen.queryByLabelText('Vorschau')).toBeNull()
})

test('M2: der Hinweis zu einer Position mit Einzelbeträgen sagt, die Zeile nach dem Aktualisieren zu verwerfen', () => {
  const view = crafted({}, { candidates: [{ id: 'hz', description: 'Heizung laut Messdienst', amountCents: 90000, invoiceFile: null, key: 'amounts', formOnly: true }] })
  render(<UIProvider><AssessmentReview assessment={view} units={UNITS} onChange={() => {}} onOpenItem={() => {}} /></UIProvider>)
  expect(screen.getByText(/verwerfen Sie diese Zeile hier danach/)).toBeTruthy()
})

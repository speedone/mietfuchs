// @vitest-environment jsdom
// Die Wege zur Seite „Belege“ (#490, Regel 3: kein Klick mehr als vorher): Die Seitenleiste öffnet die zuletzt benutzte
// Ansicht (gemerkt je Sitzung), „Erfassen“ in der unteren Leiste am Handy immer den Eingang, ein Sprung mit Ansicht
// (Cockpit, Leerzustand, Anleitung) die genannte. Der Faden einer Anleitung steht auch auf der Seite Belege.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property } from './types'
import App from './App'
import { GUIDES } from '../../shared/guides.ts'
import { MOBILE_QUERY } from './components/MobileNav'
import { splitTarget, type NavTarget } from './nav'

const PROPERTIES: Property[] = [{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]

let mobile = false
let properties: Property[] = PROPERTIES
// Für den Sprung aus Kosten: Die KI scheitert, der Beleg ist gespeichert und gehört einem anderen Objekt
let uploads: unknown[] = []
// Angelegte Positionen (POST /api/costItems), danach in GET /api/costItems
let created: Record<string, unknown>[] = []
beforeEach(() => {
  mobile = false
  properties = PROPERTIES
  uploads = []
  created = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === MOBILE_QUERY ? mobile : false },
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? ''
    if (path === '/api/intake') return json({ error: 'Ollama ist nicht erreichbar.', file: '9_fremd.jpg', reason: 'unreachable', kept: true }, 502)
    if (path === '/api/costItems' && init?.method === 'POST') {
      const item = { ...JSON.parse(String(init.body)) as Record<string, unknown>, id: `neu-${created.length + 1}`, propertyId: 'objekt-1' }
      created.push(item)
      return json(item, 201)
    }
    if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true })
    if (path === '/api/costItems') return json(created)
    if (path === '/api/uploads') return json(uploads)
    if (path === '/api/properties') return json(properties)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/ai/status') return json({ ok: true })
    if (path.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.8.0', mode: 'npm' })
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sidebar = () => screen.getByRole('navigation', { name: 'Hauptnavigation' })
const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.replace(/\s.*$/, '')

test('Ziele: eine Ansicht der Seite Belege steht hinter dem Doppelpunkt', () => {
  expect(splitTarget('belege:eingang')).toEqual({ tab: 'belege', view: 'eingang' })
  expect(splitTarget('belege:ordner')).toEqual({ tab: 'belege', view: 'ordner' })
  expect(splitTarget('kosten')).toEqual({ tab: 'kosten', view: null })
  // Ungültiges (ein Tippfehler im Ziel) fällt auf, statt still die falsche Seite zu öffnen
  expect(() => splitTarget('kosten:eingang' as NavTarget)).toThrow()
  expect(() => splitTarget('belege:posteingang' as NavTarget)).toThrow()
  expect(() => splitTarget('schnellerfassung' as NavTarget)).toThrow()
})

test('Seitenleiste: „Belege“ öffnet zuerst den Eingang, danach die zuletzt benutzte Ansicht', async () => {
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Belege$/ }))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(selected()).toBe('Eingang')
  fireEvent.click(screen.getByRole('tab', { name: 'Ordner' }))
  fireEvent.click(within(sidebar()).getByRole('button', { name: /Cockpit/ }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'Ordner' })).toBeNull())
  fireEvent.click(within(sidebar()).getByRole('button', { name: /Belege$/ }))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(selected()).toBe('Ordner')
  // Gemerkt je Sitzung: Ein neues Laden der Seite in derselben Sitzung beginnt dort
  expect(sessionStorage.getItem('mietfuchs.belege.view')).toBe('ordner')
})

test('Handy: „Erfassen“ in der unteren Leiste öffnet immer den Eingang, „Belege“ im Menüblatt die zuletzt benutzte Ansicht', async () => {
  mobile = true
  sessionStorage.setItem('mietfuchs.belege.view', 'ordner')
  render(<App />)
  const bar = await screen.findByRole('navigation', { name: 'Schnellzugriff' })
  fireEvent.click(within(bar).getByRole('button', { name: /Erfassen/ }))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(selected()).toBe('Eingang')
  // Der Ordner ist einen Tipp entfernt
  fireEvent.click(screen.getByRole('tab', { name: 'Ordner' }))
  expect(selected()).toBe('Ordner')
})

test('Anleitung: „Zu Belege →“ öffnet die Ansicht des Schritts, und der Faden steht auch auf der Seite Belege', async () => {
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Hilfe & Begriffe/ }))
  fireEvent.click((await screen.findByText(GUIDES.granny.title)).closest('button') ?? expect.fail('Kachel fehlt'))
  const guide = await waitFor(() => document.getElementById('anleitung-granny') ?? expect.fail('Anleitung fehlt'))
  const step = GUIDES.granny.steps.findIndex((s) => s.page === 'belege')
  expect(GUIDES.granny.steps[step]?.view).toBe('ordner')
  fireEvent.click(within(guide).getAllByRole('button', { name: 'Zu Belege →' })[0] ?? expect.fail('Sprung fehlt'))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(selected()).toBe('Ordner')
  const bar = await waitFor(() => screen.queryByRole('region', { name: 'Laufende Anleitung' }) ?? expect.fail('Leiste fehlt'))
  expect(bar.textContent).toContain(`Schritt ${step + 1} von ${GUIDES.granny.steps.length}`)
  // Ein Wechsel der Ansicht beendet den Faden nicht
  fireEvent.click(screen.getByRole('tab', { name: /^Eingang/ }))
  expect(screen.queryByRole('region', { name: 'Laufende Anleitung' })).not.toBeNull()
})

// Durchsicht M1, seit #490 PR 3: „Von Hand erfassen“ an einem gespeicherten Beleg auf der Seite Kosten, der einem anderen
// Objekt gehört, wechselt erst dorthin und öffnet dort das Kostenformular mit dem Beleg.
test('Von Hand erfassen aus Kosten, Beleg eines anderen Objekts: Wechsel dorthin, Kostenformular mit dem Beleg', async () => {
  properties = [...PROPERTIES, { id: 'objekt-2', name: 'Gartenstraße 3', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]
  const year = new Date().getFullYear() - 1
  uploads = [{ file: '9_fremd.jpg', size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: 'fremd.jpg', mimeType: 'image/jpeg', uploadedAt: '2026-01-01T00:00:00.000Z', sha256: 'x', propertyId: 'objekt-2', year, invoiceDate: null, kind: 'receipt' }]
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /\sKosten$/ }))
  const input = await waitFor(() => document.querySelector('main input[type="file"][multiple]') as HTMLInputElement ?? expect.fail('kein Dateifeld'))
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'fremd.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Von Hand erfassen' }))
  const drawer = await screen.findByRole('dialog', { name: 'Neue Kostenposition' })
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  expect(drawer.querySelector('[data-receipt-preview]')?.getAttribute('href')).toBe('/uploads/9_fremd.jpg')
  expect(screen.getByRole('heading', { level: 1, name: 'Kosten' })).toBeTruthy()
})

// #490 PR 3: aus dem Eingang „Von Hand erfassen“, im Kostenformular anlegen, und der Beleg hängt an der Position: Er steht
// nicht mehr unter „Ohne Position“, und „Gespeichert, nicht ausgewertet“ ist erledigt.
test('Von Hand erfassen aus dem Eingang: Kostenformular mit dem Beleg, nach „Anlegen“ zurück im Eingang ohne den Beleg', async () => {
  uploads = [{ file: '9_Müllabfuhr.pdf', size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: 'Müllabfuhr.pdf', mimeType: 'application/pdf', uploadedAt: '2026-01-01T00:00:00.000Z', sha256: 'x', propertyId: null, year: null, invoiceDate: null, kind: 'receipt' }]
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Belege$/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Müllabfuhr.pdf von Hand erfassen' }))
  const drawer = await screen.findByRole('dialog', { name: 'Neue Kostenposition' })
  expect(screen.getByRole('heading', { level: 1, name: 'Kosten' })).toBeTruthy()
  expect(drawer.querySelector('[data-receipt-preview]')?.getAttribute('href')).toBe(`/uploads/${encodeURIComponent('9_Müllabfuhr.pdf')}`)
  expect((within(drawer).getByLabelText(/Kostenart/) as HTMLSelectElement).value).toBe('Müllabfuhr')
  fireEvent.change(within(drawer).getByLabelText(/Beschreibung/), { target: { value: 'Müllabfuhr' } })
  fireEvent.change(within(drawer).getByLabelText(/^Betrag/), { target: { value: '480,00' } })
  fireEvent.click(within(drawer).getByRole('button', { name: /^Anlegen$/ }))
  const back = await screen.findByRole('button', { name: 'Zum Eingang' })
  expect(created).toEqual([expect.objectContaining({ category: 'Müllabfuhr', amountCents: 48000, invoiceFile: '9_Müllabfuhr.pdf' })])
  fireEvent.click(back)
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(selected()).toBe('Eingang')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Müllabfuhr.pdf von Hand erfassen' })).toBeNull())
  expect(screen.queryByText('Gespeichert, nicht ausgewertet')).toBeNull()
})

test('Von Hand erfassen an „Gespeichert, nicht ausgewertet“ im Eingang: nach „Anlegen“ ist der Eintrag erledigt', async () => {
  uploads = [{ file: '9_fremd.jpg', size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: 'fremd.jpg', mimeType: 'image/jpeg', uploadedAt: '2026-01-01T00:00:00.000Z', sha256: 'x', propertyId: null, year: null, invoiceDate: null, kind: 'receipt' }]
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Belege$/ }))
  const input = await waitFor(() => document.querySelector('main input[aria-label="Belege und Zählerfotos auswählen"]') as HTMLInputElement ?? expect.fail('kein Dateifeld'))
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'fremd.jpg', { type: 'image/jpeg' })] } })
  await screen.findByText('Gespeichert, nicht ausgewertet')
  fireEvent.click(screen.getByRole('button', { name: 'Von Hand erfassen' }))
  const drawer = await screen.findByRole('dialog', { name: 'Neue Kostenposition' })
  fireEvent.change(within(drawer).getByLabelText(/Kostenart/), { target: { value: 'Gartenpflege' } })
  fireEvent.change(within(drawer).getByLabelText(/Beschreibung/), { target: { value: 'Garten' } })
  fireEvent.change(within(drawer).getByLabelText(/^Betrag/), { target: { value: '90,00' } })
  fireEvent.click(within(drawer).getByRole('button', { name: /^Anlegen$/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Zum Eingang' }))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(created).toEqual([expect.objectContaining({ invoiceFile: '9_fremd.jpg' })])
  await waitFor(() => expect(screen.queryByText('Gespeichert, nicht ausgewertet')).toBeNull())
})

// ---------- Durchsicht von #490 PR 3 ----------

const keptUpload = (over: Record<string, unknown>) => ({ file: '9_fremd.jpg', size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: 'fremd.jpg', mimeType: 'image/jpeg', uploadedAt: '2026-01-01T00:00:00.000Z', sha256: 'x', propertyId: 'objekt-1', year: new Date().getFullYear() - 1, invoiceDate: null, kind: 'receipt', ...over })
async function manualFromCosts() {
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /\sKosten$/ }))
  const input = await waitFor(() => document.querySelector('main input[type="file"][multiple]') as HTMLInputElement ?? expect.fail('kein Dateifeld'))
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'fremd.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Von Hand erfassen' }))
}
const periodChoice = () => (screen.getByRole('combobox', { name: /^Abrechnungs(jahr|zeitraum)$/ }) as HTMLSelectElement).selectedOptions[0]?.textContent ?? ''

test('S4: Beleg eines anderen Jahres: erst in dessen Jahr, dann das Formular', async () => {
  const year = new Date().getFullYear() - 2
  uploads = [keptUpload({ year })]
  await manualFromCosts()
  await screen.findByRole('dialog', { name: 'Neue Kostenposition' })
  await waitFor(() => expect(periodChoice()).toBe(String(year)))
})

test('S4: Objekt mit Zeitraum Mai bis April: der Zeitraum, der im Jahr des Belegs beginnt', async () => {
  const year = new Date().getFullYear() - 1
  properties = [{ ...PROPERTIES[0], periodRules: { startMonth: 5, changes: [] } } as Property]
  uploads = [keptUpload({ year: year - 1 })]
  await manualFromCosts()
  await screen.findByRole('dialog', { name: 'Neue Kostenposition' })
  await waitFor(() => expect(periodChoice()).toMatch(new RegExp(`${year - 1}.*${year}`)))
})

test('K1: das Objekt des Belegs gibt es nicht mehr: eine Meldung, kein Formular in einem anderen Objekt', async () => {
  properties = [...PROPERTIES, { id: 'objekt-2', name: 'Gartenstraße 3', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]
  uploads = [keptUpload({ propertyId: 'objekt-weg' })]
  await manualFromCosts()
  expect((await screen.findAllByText(/gehört zu einem Objekt, das es nicht mehr gibt/)).length).toBeGreaterThan(0)
  expect(screen.queryByRole('dialog', { name: 'Neue Kostenposition' })).toBeNull()
})

test('S4: offene Zuordnung im Eingang: „Von Hand erfassen“ fragt, „Abbrechen“ bleibt im Eingang', async () => {
  const year = new Date().getFullYear() - 1
  created = [{ id: 'w1', propertyId: 'objekt-1', period: `${year}-01`, category: 'Müllabfuhr', description: 'Müll', amountCents: 1000, key: 'area' }]
  uploads = [keptUpload({ file: '9_Müllabfuhr.pdf', originalName: 'Müllabfuhr.pdf', mimeType: 'application/pdf', propertyId: null, year: null })]
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Belege$/ }))
  fireEvent.change(await screen.findByLabelText('Müllabfuhr.pdf einer Position zuordnen'), { target: { value: 'w1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Müllabfuhr.pdf von Hand erfassen' }))
  const ask = await screen.findByRole('alertdialog', { name: 'Ungespeicherte Änderungen verwerfen?' })
  fireEvent.click(within(ask).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.getByRole('heading', { level: 1, name: 'Belege' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: 'Neue Kostenposition' })).toBeNull()
})

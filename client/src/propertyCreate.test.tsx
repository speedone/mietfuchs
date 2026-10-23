// @vitest-environment jsdom
// Weiteres Objekt anlegen (#157). Gemeldet hat es ein Vermieter, der nach dem Anlegen alle Seiten
// leer sah und dachte, seine Daten seien überschrieben. Der Wechsel geschah wortlos, und nichts
// sagte, wo er jetzt ist und dass das bisherige Haus unverändert dasteht. Geprüft wird über die
// ganze App: anlegen über den Dialog, Hinweis mit dem Namen des vorigen Objekts, zurück, und der
// Bestand ist wieder sichtbar.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property, Unit } from './types'
import App from './App'

// Ganzseitentest: unter Last braucht er mehr als die 5 Sekunden der Voreinstellung, wie
// tenantChange.test.tsx.
vi.setConfig({ testTimeout: 20000 })

const objekt = (id: string, name: string, extra: Partial<Property> = {}): Property => ({
  id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, ...extra,
})

let properties: Property[]
let units: Record<string, Unit[]>
let sent: { method: string; url: string; body: Record<string, unknown> }[]
// Hält die Antwort auf das Anlegen zurück, bis der Test sie freigibt (Doppelklick, Strg+S)
let postGate: Promise<void> | null
// Lässt die Liste der Objekte scheitern (Anlegen klappt, Neuladen nicht)
let failPropertyList: boolean

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  properties = [objekt('objekt-1', 'Haus A')]
  units = { 'objekt-1': [{ id: 'u-a', propertyId: 'objekt-1', name: 'Dachgeschoss links', areaM2: 60, participates: true }] }
  sent = []
  postGate = null
  failPropertyList = false
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const [path, query = ''] = url.split('?')
    const property = new URLSearchParams(query).get('property') ?? properties[0]?.id ?? ''
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ method, url, body })
      if (path === '/api/properties' && method === 'POST') {
        await postGate
        const created = objekt(`objekt-${properties.length + 1}`, String(body.name), body as Partial<Property>)
        properties = [...properties, created]
        units[created.id] = []
        return json(created, 201)
      }
      return json({ ok: true })
    }
    if (path === '/api/properties') return failPropertyList ? json({ error: 'Server nicht erreichbar' }, 500) : json(properties)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/units') return json(units[property] ?? [])
    if (path === '/api/tenancies') return json([])
    if (path === '/api/meters') return json([])
    if (path?.startsWith('/api/rentledger/')) return json({ year: 2025, rows: [], totals: { sollCents: 0, paidCents: 0, openCents: 0 } })
    // Das Cockpit bekommt keine Antwort, wie in propertySwitch.test.tsx.
    if (path?.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.9.0' })
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Der Knopf steht in den Stammdaten in der Karte „Weitere Objekte“ oben rechts.
async function openCreateDialog() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  fireEvent.click(await screen.findByRole('button', { name: '+ Objekt anlegen' }))
  return screen.getByRole('dialog')
}

async function createViaDialog(name: string) {
  const dialog = await openCreateDialog()
  fireEvent.change(within(dialog).getByLabelText(/^Bezeichnung/), { target: { value: name } })
  fireEvent.click(within(dialog).getByRole('button', { name: `Anlegen und zu „${name}“ wechseln` }))
  return dialog
}

const notice = () => screen.findByRole('region', { name: /Neues Objekt/ })

test('der Dialog erklärt, was ein weiteres Objekt ist, und beschriftet seine Felder', async () => {
  const dialog = await openCreateDialog()
  // Der Dialog trägt seinen Titel als Namen (aria-labelledby).
  expect(screen.getByRole('dialog', { name: 'Neues Objekt' })).toBe(dialog)
  expect(within(dialog).getByText(/bleibt unverändert/)).toBeTruthy()
  const name = within(dialog).getByLabelText(/^Bezeichnung/) as HTMLInputElement
  expect(name.required).toBe(true)
  expect(within(dialog).getByText(/Pflichtangabe/)).toBeTruthy()
  expect(within(dialog).getByLabelText(/^Art/)).toBeTruthy()
  expect(within(dialog).getByLabelText(/^Adresse/)).toBeTruthy()
  // Ohne Namen wird nichts angelegt, und der Dialog sagt warum.
  fireEvent.click(within(dialog).getByRole('button', { name: /^Anlegen und wechseln$/ }))
  expect((await within(dialog).findAllByText(/Geben Sie dem Objekt einen Namen/)).length).toBeGreaterThan(0)
  // Die Meldung steht auch am Feld, nicht nur in der Sammelmeldung.
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(within(dialog).getByText('Bezeichnung fehlt')).toBeTruthy()
  expect(sent).toEqual([])
})

// Anlegen und Bearbeiten sind ein Formular (wie bei Wohnungen): dieselben Felder in derselben Reihenfolge, dieselbe
// Breite. Vorher legte ein schmales Fenster nur „Name“, Art und Adresse an.
const fieldLabels = (dialog: HTMLElement) => within(dialog).getAllByRole('textbox').concat(within(dialog).getAllByRole('combobox'), within(dialog).getAllByRole('checkbox'))
  .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  .map((el) => (el.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim() || el.closest('label')?.textContent?.trim())

test('„Neues Objekt“ und „Objekt bearbeiten“ zeigen dieselben Felder in gleicher Breite', async () => {
  const created = await openCreateDialog()
  const createdFields = fieldLabels(created)
  const createdWidth = created.style.width
  fireEvent.click(within(created).getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  fireEvent.click(await screen.findByRole('button', { name: /Bearbeiten.*Objekt/ }))
  const edited = screen.getByRole('dialog', { name: 'Objekt bearbeiten' })
  expect(createdFields).toEqual(fieldLabels(edited))
  expect(createdFields[0]).toMatch(/^Bezeichnung/)
  expect(createdWidth).toBe(edited.style.width)
})

test('„+ Objekt anlegen“ steht in der Karte „Weitere Objekte“, nicht im Seitenkopf; bei einem Objekt mit Erklärung', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  const header = (await screen.findByRole('heading', { name: 'Stammdaten' })).closest<HTMLElement>('.page-head')
  if (!header) return expect.fail('der Seitenkopf fehlt')
  expect(within(header).queryByRole('button', { name: /Objekt anlegen/ })).toBeNull()
  const card = (await screen.findByRole('heading', { name: 'Weitere Objekte' })).closest<HTMLElement>('section')
  if (!card) return expect.fail('die Karte „Weitere Objekte“ fehlt')
  expect(within(card).getByRole('button', { name: '+ Objekt anlegen' })).toBeTruthy()
  expect(card.textContent).toMatch(/„Haus A“ bleibt dabei unverändert/)
  // Bei einem Objekt gibt es keinen Umschalter und deshalb auch kein „+“ daneben.
  expect(screen.queryByRole('button', { name: '+ Weiteres Objekt anlegen' })).toBeNull()
})

// Ab zwei Objekten listet die Karte die übrigen zum Wechseln, und neben dem Umschalter steht ein „+“, das dasselbe
// Fenster öffnet. Ein Fenster, nicht zwei: Die Sperre nach „angelegt, aber die Liste fehlt“ gilt für beide Wege.
test('ab zwei Objekten: die übrigen zum Wechseln, „+“ neben dem Umschalter öffnet dasselbe Fenster', async () => {
  properties = [...properties, objekt('objekt-2', 'Haus B', { kind: 'etw', address: 'Gartenweg 3' })]
  units['objekt-2'] = []
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  const card = (await screen.findByRole('heading', { name: 'Weitere Objekte' })).closest<HTMLElement>('section')
  if (!card) return expect.fail('die Karte „Weitere Objekte“ fehlt')
  // Das gewählte Objekt steht nicht in der Liste, es steht in der Karte „Objekt“.
  expect(card.textContent).not.toMatch(/Haus A/)
  expect(card.textContent).toMatch(/Eigentumswohnung/)
  fireEvent.click(within(card).getByRole('button', { name: 'Wechseln zu „Haus B“' }))
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))

  fireEvent.click(screen.getByRole('button', { name: '+ Weiteres Objekt anlegen' }))
  expect(screen.getAllByRole('dialog', { name: 'Neues Objekt' })).toHaveLength(1)
})

test('anlegen → Wechsel, Hinweis nennt das vorige Objekt, „Zurück zu …“ zeigt den Bestand wieder', async () => {
  const dialog = await openCreateDialog()
  fireEvent.change(within(dialog).getByLabelText(/^Bezeichnung/), { target: { value: 'Gartenweg 3' } })
  fireEvent.change(within(dialog).getByLabelText(/^Art/), { target: { value: 'etw' } })
  fireEvent.change(within(dialog).getByLabelText(/^Adresse/), { target: { value: 'Gartenweg 3, 12345 Musterstadt' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen und zu „Gartenweg 3“ wechseln' }))

  // Ein Aufruf mit allem, kein halber Zustand aus Anlegen und nachträglichem Ändern.
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ method: 'POST', url: '/api/properties', body: { name: 'Gartenweg 3', kind: 'etw', address: 'Gartenweg 3, 12345 Musterstadt', state: null, cableBuiltBeforeDec2021: null, landlordName: null } })

  // Gewechselt, ohne Rückfrage: Der eigene Dialog zählt dabei nicht als offenes Formular.
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()

  const region = await notice()
  expect(region.textContent).toMatch(/„Gartenweg 3“, das noch keine Wohnungen hat/)
  expect(region.textContent).toMatch(/Ihre Daten in „Haus A“ sind unverändert/)
  // Der Fokus steht auf der Überschrift des Hinweises, damit ein Screenreader ihn vorliest.
  await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole('heading')))

  // Der Hinweis steht auf jeder Seite, nicht nur in den Stammdaten.
  fireEvent.click(screen.getByRole('button', { name: /Mietkonto/ }))
  expect(await notice()).toBeTruthy()

  fireEvent.click(within(await notice()).getByRole('button', { name: 'Zurück zu „Haus A“' }))
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1'))
  await waitFor(() => expect(screen.queryByRole('region', { name: /Neues Objekt/ })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /Stammdaten/ }))
  expect((await screen.findAllByText('Dachgeschoss links')).length).toBeGreaterThan(0)
})

test('hatte das vorige Objekt keine Wohnungen, verspricht der Hinweis keine Daten', async () => {
  units['objekt-1'] = []
  await createViaDialog('Gartenweg 3')
  const region = await notice()
  expect(region.textContent).toMatch(/„Haus A“ bleibt, wie es ist/)
  expect(region.textContent).not.toMatch(/Ihre Daten/)
})

test('„Wohnungen anlegen“ führt in die Stammdaten und fehlt dort; „Schließen“ gilt auch nach dem Neuladen', async () => {
  await createViaDialog('Gartenweg 3')
  // In den Stammdaten steht „+ Wohnung anlegen“ ohnehin vor Augen.
  expect(within(await notice()).queryByRole('button', { name: /Wohnungen anlegen/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Cockpit/ }))
  fireEvent.click(within(await notice()).getByRole('button', { name: /Wohnungen anlegen/ }))
  expect(await screen.findByRole('button', { name: /Wohnung anlegen/ })).toBeTruthy()
  fireEvent.click(within(await notice()).getByRole('button', { name: /Hinweis schließen/ }))
  await waitFor(() => expect(screen.queryByRole('region', { name: /Neues Objekt/ })).toBeNull())
  // Neu geladen bleibt er geschlossen.
  cleanup()
  render(<App />)
  await screen.findByLabelText('Objekt wählen')
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByRole('region', { name: /Neues Objekt/ })).toBeNull()
})

test('nach dem Neuladen der Seite nennt der Hinweis weiter das richtige vorige Objekt', async () => {
  properties = [...properties, objekt('objekt-2', 'Haus B')]
  units['objekt-2'] = [{ id: 'u-b', propertyId: 'objekt-2', name: 'EG', areaM2: 50, participates: true }]
  localStorage.setItem('mietfuchs.property', 'objekt-2')
  await createViaDialog('Gartenweg 3')
  expect((await notice()).textContent).toMatch(/„Haus B“/)
  cleanup()
  render(<App />)
  const region = await notice()
  expect(region.textContent).toMatch(/„Haus B“/)
  expect(region.textContent).not.toMatch(/„Haus A“/)
})

test('Doppelklick und Strg+S während des Anlegens legen nur ein Objekt an', async () => {
  let release = () => {}
  postGate = new Promise<void>((resolve) => { release = resolve })
  const dialog = await createViaDialog('Gartenweg 3')
  fireEvent.click(within(dialog).getByRole('button', { name: /Anlegen und zu/ }))
  fireEvent.keyDown(document, { key: 's', ctrlKey: true })
  release()
  await notice()
  expect(sent.filter((r) => r.method === 'POST')).toHaveLength(1)
})

test('Anlegen klappt, Neuladen scheitert: Meldung im Dialog und kein zweites Objekt', async () => {
  failPropertyList = false
  const dialog = await openCreateDialog()
  fireEvent.change(within(dialog).getByLabelText(/^Bezeichnung/), { target: { value: 'Gartenweg 3' } })
  failPropertyList = true
  fireEvent.click(within(dialog).getByRole('button', { name: /Anlegen und zu/ }))
  expect(await within(dialog).findByText(/ist angelegt, die Liste der Objekte ließ sich aber nicht laden/)).toBeTruthy()
  // Schließen und wieder öffnen hebt die Sperre nicht auf, solange die Liste fehlt.
  fireEvent.click(within(dialog).getByRole('button', { name: /^Abbrechen$/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Neues Objekt' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '+ Objekt anlegen' }))
  const again = screen.getByRole('dialog', { name: 'Neues Objekt' })
  // Neu geöffnet ist das Feld leer; die Sperre gilt trotzdem.
  expect((within(again).getByLabelText(/^Bezeichnung/) as HTMLInputElement).value).toBe('')
  fireEvent.change(within(again).getByLabelText(/^Bezeichnung/), { target: { value: 'Gartenweg 3' } })
  const button = within(again).getByRole('button', { name: /Anlegen und zu/ }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  fireEvent.keyDown(document, { key: 's', ctrlKey: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(sent.filter((r) => r.method === 'POST')).toHaveLength(1)
})

// Seit #346 Schritt 8 nennt der Seitenkopf das Objekt immer (Kontextzeile), denn keine Seite hat mehr eine eigene
// Auswahl, die es nennen würde; der Umschalter in der Seitenleiste erscheint weiter erst ab dem zweiten.
test('der Seitenkopf nennt das Objekt, den Umschalter gibt es erst ab zwei Objekten', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  await screen.findByRole('heading', { name: 'Stammdaten' })
  expect(screen.getByTestId('page-context').textContent).toBe('Haus A')
  expect(screen.queryByLabelText('Objekt wählen')).toBeNull()
  cleanup()

  properties = [...properties, objekt('objekt-2', 'Gartenweg 3')]
  units['objekt-2'] = []
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Mietkonto/ }))
  expect((await screen.findByTestId('page-context')).textContent).toMatch(/^Haus A · Abrechnungsjahr \d{4}$/)
  expect(screen.getByLabelText('Objekt wählen')).toBeTruthy()
})

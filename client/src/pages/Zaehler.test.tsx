// @vitest-environment jsdom
// Leere Felder der Ablesung (#149): Sie wurden als 0 gespeichert. Beim Zählerwechsel entfiel so die
// Warnung „Endstand fehlt“ (#83), und ein falsches Segment verschob Geld zwischen Mietern.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Meter, Reading, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import { PeriodSelect } from '../components/PeriodSelect'
import Zaehler from './Zaehler'
import { todayIso } from '../readingSheet'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
let METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
let plants: unknown[] = []

let sent: Record<string, unknown>[]
let readings: Reading[] = []

beforeEach(() => {
  sent = []
  readings = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') {
      sent.push(JSON.parse(String(init?.body ?? '{}')))
      return json({ id: 'r1' })
    }
    const path = url.split('?')[0]
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/meters') return json(METERS)
    if (path === '/api/readings') return json(readings)
    if (path === '/api/heating-plants') return json(plants)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openReadings() {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Zaehler units={UNITS} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/ }, { timeout: 5000 }))
  fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
  fireEvent.change(screen.getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
}

test('Zählerwechsel ohne Endstand: gespeichert wird null, nicht 0', async () => {
  await openReadings()
  fireEvent.click(screen.getByLabelText(/Zählerwechsel/))
  fireEvent.change(screen.getByLabelText(/Startstand neuer Zähler/), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ meterId: 'm1', value: 5, replacement: true, oldEndValue: null })
})

test('leerer Zählerstand: Meldung statt einer gespeicherten 0', async () => {
  await openReadings()
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(screen.getByText('Bitte den Zählerstand eintragen.')).toBeTruthy())
  expect(sent).toEqual([])
})

// UI-Durchsicht H3: Die Meldung stand oben auf der Seite, beim Klick 407 px über dem sichtbaren
// Bereich; es wirkte, als passiere nichts. Jetzt steht sie am Feld und in der Sammelmeldung im Fuß des
// Seitenfensters über „Anlegen“ (#346, Schritt 3 und 7), als Alarm und ins Bild gerollt; der Fokus geht auf die
// Sammelmeldung, ihr Link aufs Feld.
test('Ablesung ohne Datum: Meldung am Feld und in der Sammelmeldung über „Anlegen“, die den Fokus bekommt', async () => {
  const scrolled: unknown[] = []
  const original = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) { scrolled.push([this.textContent, arg]) }
  try {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/ }, { timeout: 5000 }))
    fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
    // Das Datum ist mit heute vorbelegt; hier wird es geleert.
    fireEvent.change(screen.getByLabelText(/^Datum/), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/Zählerstand/), { target: { value: '5' } })
    const button = screen.getByRole('button', { name: /^Anlegen$/ })
    fireEvent.click(button)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Bitte prüfen Sie 1 Angabe/)
    expect(alert.textContent).toMatch(/Datum der Ablesung/)
    const summary = alert.parentElement
    expect(summary?.closest('.drawer-foot')).toBe(button.closest('.drawer-foot'))
    expect(scrolled).toEqual([[summary?.textContent, { block: 'nearest' }]])
    expect(document.activeElement).toBe(summary)
    expect(sent).toEqual([])
    // Am Feld: die kurze Fassung, ungültig markiert und über aria-describedby verbunden.
    const date = screen.getByLabelText(/^Datum/)
    expect(date.getAttribute('aria-invalid')).toBe('true')
    const described = (date.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['⚠ Fehler: Datum fehlt'])
    expect(screen.getByLabelText(/Zählerstand/).getAttribute('aria-invalid')).toBeNull()
    // Der Link der Sammelmeldung führt aufs Feld.
    fireEvent.click(within(alert).getByRole('link', { name: /Datum der Ablesung/ }))
    expect(document.activeElement).toBe(date)
    // Mit Datum ist die Meldung an beiden Stellen weg.
    fireEvent.change(date, { target: { value: '2025-06-30' } })
    expect(date.getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  } finally {
    Element.prototype.scrollIntoView = original
  }
})

// Mit UIProvider: Ohne ihn beantwortet `useConfirm` jede Rückfrage mit „nein“, und es stünde kein Dialog im Baum.
const renderPage = () => render(
  <UIProvider>
    <PeriodProvider>
      <PropertyProvider>
        <Zaehler units={UNITS} />
      </PropertyProvider>
    </PeriodProvider>
  </UIProvider>,
)

test('Zählerwechsel ohne Endstand: die Tabelle sagt „fehlt“ statt eines leeren Werts (#142)', async () => {
  readings = [
    { id: 'r1', meterId: 'm1', date: '2024-12-31', value: 950 },
    { id: 'r2', meterId: 'm1', date: '2025-07-01', value: 3, replacement: true },
  ]
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(2\)/ }, { timeout: 5000 }))
  expect(screen.getByText('Endstand alt: fehlt')).toBeTruthy()
})

test('Neuer Wärmezähler: die Einheit folgt der Sparte und wird so gespeichert (#142)', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Wärme EG' } })
  fireEvent.change(screen.getByLabelText(/^Sparte/), { target: { value: 'waerme' } })
  expect((screen.getByLabelText(/^Einheit/) as HTMLInputElement).value).toBe('kWh')
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ type: 'waerme', unit: 'kWh' })
})

// #705: Wer den Gaszähler unter „Wärme“ sucht, findet dort kein m³; das Formular sagt, wohin er gehört.
test('#705: die Sparte „Sonstiges“ nennt den Gaszähler, und unter „Wärme“ steht, wohin der Gaszähler gehört', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
  const type = screen.getByLabelText(/^Sparte/) as HTMLSelectElement
  expect([...type.options].find((o) => o.value === 'sonstig')?.text).toBe('Sonstiges (z. B. Gaszähler)')
  expect(screen.queryByText(/Ein Gaszähler zeigt m³/)).toBeNull()
  fireEvent.change(type, { target: { value: 'waerme' } })
  expect(screen.getByText(/Ein Gaszähler zeigt m³ und gehört in die Sparte „Sonstiges“/)).toBeTruthy()
  fireEvent.change(type, { target: { value: 'sonstig' } })
  expect(type.value).toBe('sonstig')
  fireEvent.change(type, { target: { value: 'hkv' } })
  expect((screen.getByLabelText(/^Einheit/) as HTMLInputElement).placeholder).toBe('')
  fireEvent.change(type, { target: { value: 'sonstig' } })
  expect(screen.getByText(/Auch für den Gaszähler der Heizung/)).toBeTruthy()
  expect((screen.getByLabelText(/^Einheit/) as HTMLInputElement).placeholder).toBe('z. B. m³')
  fireEvent.change(screen.getByLabelText(/^Einheit/), { target: { value: 'm³' } })
  expect((screen.getByLabelText(/^Einheit/) as HTMLInputElement).value).toBe('m³')
})

test('Zählerformular: der Hinweis zum Hauptzähler verweist auf die Einliegerwohnung (#142)', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
  expect(screen.getByRole('button', { name: 'Einliegerwohnung' })).toBeTruthy()
})

// Durchsicht M1: Das Auswahlfeld zeigt die gespeicherte Rolle, auch wenn die Sparte sie nicht mehr
// anbietet; vorher stand dort „Nein“, und gespeichert wurde beim nächsten Mal etwas anderes.
test('ein Zähler der Anlage zeigt seine gespeicherte Rolle', async () => {
  METERS = [{ id: 'ww', propertyId: 'objekt-1', name: 'WW Speicher', unitId: null, type: 'warmwasser', unit: 'm³', heatingPlantId: 'p1', heatingRole: 'supply' }]
  plants = [{ id: 'p1', propertyId: 'objekt-1', name: '', energy: 'gas', method: 'service', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null }]
  try {
    render(<PeriodProvider><PropertyProvider><Zaehler units={UNITS} /></PropertyProvider></PeriodProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Zähler bearbeiten' }, { timeout: 5000 }))
    const select = (await screen.findByRole('combobox', { name: /Gehört zur Heizanlage/ })) as HTMLSelectElement
    expect(select.value).toBe('supply')
    expect(select.selectedOptions[0]?.textContent).toMatch(/^bisher: Versorgungszähler/)
  } finally {
    METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
    plants = []
  }
})

// Browserprüfung 0.16.0 (S3): Ein Zähler für einen Teil des Hauses stand in der Zuordnung als „Haus (Hauptzähler)“, in
// der Liste als „Haus (Teil des Hauses)“. Die Zuordnung sagt dasselbe wie die Liste; angezeigt ist der gespeicherte Wert.
test('Zähler für einen Teil des Hauses: die Zuordnung behauptet nicht „Hauptzähler“', async () => {
  METERS = [{ id: 'g', propertyId: 'objekt-1', name: 'Gartenwasser', unitId: null, type: 'kaltwasser', unit: 'm³', scope: 'common' }]
  try {
    renderPage()
    expect(await screen.findByText('Haus (Teil des Hauses)', undefined, { timeout: 5000 })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zähler bearbeiten' }))
    const zuordnung = (await screen.findByRole('combobox', { name: /^Zuordnung/ })) as HTMLSelectElement
    expect(zuordnung.value).toBe('')
    expect(zuordnung.selectedOptions[0]?.textContent).toBe('Haus (Teil des Hauses)')
    const teil = screen.getByRole('combobox', { name: /ganze Haus oder einen Teil/ }) as HTMLSelectElement
    expect(teil.value).toBe('common')
    // Umgestellt auf das ganze Haus heißt die Zuordnung wieder „Hauptzähler“.
    fireEvent.change(teil, { target: { value: 'property' } })
    expect(zuordnung.selectedOptions[0]?.textContent).toBe('Haus (Hauptzähler)')
  } finally {
    METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
  }
})

// Heizung PR 21 (#98): Eichjahr mit Vorschlag aus der Jahreszahl auf dem Zähler; beim Heizkostenverteiler kein Feld.
test('Eichfrist: Vorschlag übernehmen und speichern; beim Heizkostenverteiler kein Feld', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Kaltwasser Haus' } })
  fireEvent.change(screen.getByLabelText(/^Jahreszahl auf dem Zähler/), { target: { value: '2022' } })
  expect(screen.getByText(/Vorschlag: geeicht bis Ende 2028/)).toBeTruthy()
  expect(screen.getByText(/Jahreszahl auf der Eichmarke nennt das Jahr, in dem die Eichfrist beginnt/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
  expect((screen.getByLabelText(/^Geeicht bis Ende/) as HTMLInputElement).value).toBe('2028')
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ type: 'kaltwasser', calibratedUntil: 2028 })
  cleanup()
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
  fireEvent.change(screen.getByLabelText(/^Sparte/), { target: { value: 'hkv' } })
  expect(screen.queryByLabelText(/^Geeicht bis Ende/)).toBeNull()
  expect(screen.queryByLabelText(/^Jahreszahl auf dem Zähler/)).toBeNull()
})

test('Eichfrist: das Jahr steht in der Liste, die abgelaufene Frist als Warnung und nicht als Fehler', async () => {
  METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³', calibratedUntil: 2024 }]
  const notice = { code: 'meter.calibration-overdue', level: 'warning', title: 'Eichfrist abgelaufen', text: 'Zähler „Wasser EG“: abgelaufen', subject: { kind: 'meter', id: 'm1' } }
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? ''
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/meters') return json(METERS)
    if (path.startsWith('/api/consumption')) return json([{ meterId: 'm1', consumption: 80, readingCount: 2, warnings: [notice.text], notices: [notice] }])
    return json([])
  })
  try {
    renderPage()
    expect(await screen.findByText('geeicht bis Ende 2024', undefined, { timeout: 5000 })).toBeTruthy()
    // Seit Schritt 10 über den Baustein Notice: Warnung (gelb) mit Wort, kein Fehlerkasten
    const box = (await screen.findByText(notice.text)).closest('.notice-item')
    expect(box?.className).toMatch(/^notice /)
    expect(box?.textContent).toContain('Warnung')
  } finally {
    METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
  }
})

// Browserprüfung 0.16.0 (M1): Die geschätzte Ablesung meldet der Server als Hinweis. Die Seite stufte jede Meldung
// außer der Eichfrist als Fehler ein und zeigte einen roten Kasten „Fehler Ablesung geschätzt“.
test('Geschätzte Ablesung: Stufe aus der Meldung, ein Hinweis und kein Fehler', async () => {
  const notice = { code: 'meter.reading-estimated', level: 'hint', title: 'Ablesung geschätzt', text: 'Zähler „Wasser EG“: Der Stand vom 31.12.2025 ist geschätzt.', subject: { kind: 'meter', id: 'm1' } }
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? ''
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/meters') return json(METERS)
    if (path.startsWith('/api/consumption')) return json([{ meterId: 'm1', consumption: 80, readingCount: 2, warnings: [notice.text], notices: [notice] }])
    return json([])
  })
  renderPage()
  const box = (await screen.findByText(notice.text, undefined, { timeout: 5000 })).closest('.notice-item')
  expect(box?.textContent).toContain('Hinweis')
  expect(box?.textContent).not.toContain('Fehler')
  expect(box?.className).not.toMatch(/error/)
})

// #693: Das Cockpit meldet rot, dass der Zeitraum nicht durch Ablesungen gedeckt ist; die Seite Zähler zeigte für
// denselben Zähler nur die Verbrauchszahl. Jetzt steht am Zähler derselbe Satz, mit dem Knopf zur neuen Ablesung.
// Durchsicht: nur an den Zählern, die das Cockpit meldet. Im laufenden Jahr und in einem Jahr ohne Umlage nach Verbrauch
// trug sonst jeder Zähler die Warnung.
const PERIOD = `${new Date().getFullYear() - 1}-01`
const waterCost = { id: 'k1', propertyId: 'objekt-1', period: PERIOD, category: 'Wasserversorgung', description: 'Wasser', amountCents: 50000, key: 'meter', meterType: 'kaltwasser' }
const gapRow = { meterId: 'm1', consumption: 80, readingCount: 2, periodCovered: false, periodGap: { from: '2025-12-17', to: '2025-12-31' }, periodSlack: [], lastReadingOn: '2025-12-16', longUnread: false, warnings: [], notices: [] }
const stubGap = (rows: unknown[], costItems: unknown[]) => vi.stubGlobal('fetch', async (url: string) => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const path = url.split('?')[0] ?? ''
  if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
  if (path === '/api/meters') return json(METERS)
  if (path === '/api/costItems') return json(costItems)
  if (path.startsWith('/api/consumption')) return json(rows)
  return json([])
})

test('#693: ist der Zeitraum nicht durch Ablesungen gedeckt und meldet das Cockpit den Zähler, steht es am Zähler, mit Knopf zur neuen Ablesung', async () => {
  stubGap([gapRow], [waterCost])
  renderPage()
  const box = (await screen.findByText('Ohne Ablesung vom 17.12.2025 bis 31.12.2025.', undefined, { timeout: 5000 })).closest('.notice-item') as HTMLElement
  // Dieselbe Stufe wie die Cockpit-Zeile: rot, also Fehler (notices.ts, `cockpitLevel`).
  expect(box.textContent).toContain('Fehler')
  expect(box.textContent).not.toContain('Warnung')
  expect(box.textContent).toContain('Zeitraum nicht durch Ablesungen gedeckt')
  // Die Verbrauchszahl bleibt stehen: Sie ist, was die Ablesungen hergeben.
  expect(screen.getByText(/^80\sm³$/)).toBeTruthy()
  fireEvent.click(within(box).getByRole('button', { name: '+ Ablesung anlegen' }))
  expect(screen.getByRole('dialog', { name: /Neue Ablesung/ }).textContent).toContain('Wasser EG')
})

test('#693: kein Satz am Zähler, wo das Cockpit nichts meldet: gedeckt, keine Umlage nach Verbrauch, andere Sparte, nur nicht Umlagefähiges', async () => {
  const cases: [string, unknown[], unknown[]][] = [
    ['gedeckt', [{ ...gapRow, periodCovered: true, periodGap: null }], [waterCost]],
    ['ohne Kosten im Zeitraum (laufendes Jahr)', [gapRow], []],
    ['Kosten nach Fläche', [gapRow], [{ ...waterCost, key: 'area', meterType: undefined }]],
    ['Verbrauch einer anderen Sparte', [gapRow], [{ ...waterCost, meterType: 'strom' }]],
    ['Kosten eines anderen Zeitraums', [gapRow], [{ ...waterCost, period: `${new Date().getFullYear() - 3}-01` }]],
    ['nicht umlagefähig', [gapRow], [{ ...waterCost, category: 'Nicht umlagefähig' }]],
  ]
  for (const [name, rows, costItems] of cases) {
    stubGap(rows, costItems)
    const view = renderPage()
    expect(await screen.findByText(/^80\sm³$/, undefined, { timeout: 5000 }), name).toBeTruthy()
    // Erst nach dem Laden der Kosten steht fest, was das Cockpit meldet.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Ohne Ablesung vom/), name).toBeNull()
    expect(screen.queryByText('Zeitraum nicht durch Ablesungen gedeckt'), name).toBeNull()
    view.unmount()
  }
})

// ---------- #346 Schritt 7: die Ablesung im Seitenfenster, mit derselben Anfrage ----------
// Die Rümpfe sind die, die die Ablesezeile vor dem Seitenfenster schickte.
let calls: { url: string; method: string; body: unknown }[] = []
const stubWithUrls = () => {
  calls = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      calls.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      return json({ id: 'r1' })
    }
    const path = url.split('?')[0]
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/meters') return json(METERS)
    if (path === '/api/readings') return json(readings)
    return json([])
  })
}
/** Klappt die Ablesungen des Zählers auf und öffnet das Formular einer neuen Ablesung. */
const openReadingForm = async (): Promise<HTMLElement> => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/ }, { timeout: 5000 }))
  fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
  return screen.getByRole('dialog', { name: /Neue Ablesung/ })
}
const saveReadingIn = (box: HTMLElement) => fireEvent.click(within(box).getByRole('button', { name: 'Anlegen' }))

test('Ablesung anlegen: POST /api/readings mit dem Rumpf wie bisher, danach ist das Formular zu', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
  fireEvent.change(within(box).getByLabelText(/^Zählerstand/), { target: { value: '1.234,5' } })
  fireEvent.change(within(box).getByLabelText(/^Hinweis/), { target: { value: ' Zwischenablesung Auszug ' } })
  saveReadingIn(box)
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0]).toEqual({ url: '/api/readings', method: 'POST', body: { meterId: 'm1', date: '2025-06-30', value: 1234.5, note: 'Zwischenablesung Auszug' } })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('Ablesung mit Zählerwechsel: Endstand alt und Startstand neu wie bisher', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
  fireEvent.click(within(box).getByLabelText(/Zählerwechsel/))
  fireEvent.change(within(box).getByLabelText(/^Startstand neuer Zähler/), { target: { value: '5' } })
  fireEvent.change(within(box).getByLabelText(/^Endstand alter Zähler/), { target: { value: '980' } })
  saveReadingIn(box)
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0]).toEqual({ url: '/api/readings', method: 'POST', body: { meterId: 'm1', date: '2025-06-30', value: 5, replacement: true, oldEndValue: 980 } })
})

// Geschätzte Ablesung (#98): Haken und Begründung gehen mit hinaus; der angezeigte Haken ist der gespeicherte.
test('Geschätzte Ablesung: Haken und Begründung im Rumpf, ohne Begründung eine Meldung am Feld', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-12-31' } })
  fireEvent.change(within(box).getByLabelText(/^Zählerstand/), { target: { value: '180' } })
  expect(within(box).queryByLabelText(/^Begründung der Schätzung/)).toBeNull()
  const haken = within(box).getByLabelText(/Stand geschätzt/) as HTMLInputElement
  fireEvent.click(haken)
  expect(haken.checked).toBe(true)
  saveReadingIn(box)
  await waitFor(() => expect(within(box).getAllByText('Begründung fehlt').length).toBeGreaterThan(0))
  expect(calls).toEqual([])
  fireEvent.change(within(box).getByLabelText(/^Begründung der Schätzung/), { target: { value: 'Zähler defekt' } })
  saveReadingIn(box)
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0]).toEqual({ url: '/api/readings', method: 'POST', body: { meterId: 'm1', date: '2025-12-31', value: 180, estimated: true, estimateReason: 'Zähler defekt' } })
})

// Browserprüfung 0.16.0 (S2): Der Hilfetext des Häkchens („Haken Sie das an, …“) stand unter der Begründung. Er
// beschreibt das Häkchen; die Begründung ist Pflicht und trägt `required`.
const description = (el: Element) => (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
test('Geschätzte Ablesung: Hilfetext am Häkchen, die Begründung ist Pflicht', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  const haken = within(box).getByLabelText(/Stand geschätzt/)
  expect(description(haken)).toMatch(/^Haken Sie das an, wenn der Stand nicht abgelesen/)
  fireEvent.click(haken)
  const grund = within(box).getByLabelText(/^Begründung der Schätzung/) as HTMLInputElement
  expect(grund.required).toBe(true)
  expect(description(grund)).not.toMatch(/Haken Sie das an/)
  expect(within(box).getAllByText(/Haken Sie das an/)).toHaveLength(1)
})

test('Geschätzte Ablesung in der Liste: „geschätzt“ mit Begründung', async () => {
  readings = [{ id: 'r1', meterId: 'm1', date: '2025-12-31', value: 180, estimated: true, estimateReason: 'Zähler defekt' }]
  try {
    stubWithUrls()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(1\)/ }, { timeout: 5000 }))
    expect(screen.getByText('geschätzt')).toBeTruthy()
    expect(screen.getByText(/Begründung: Zähler defekt/)).toBeTruthy()
  } finally {
    readings = []
  }
})

// Praxistest: Nach dem Wechsel blieb die Warnung „Eichfrist abgelaufen“ stehen, denn das Fenster fragte kein
// Eichjahr für den neuen Zähler ab. Jetzt fragt es danach, nur beim Wechsel; leer bleibt der Rumpf wie bisher.
test('Zählerwechsel: Eichjahr des neuen Zählers geht mit der Ablesung hinaus, leer nicht', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  expect(within(box).queryByLabelText(/Neuer Zähler geeicht bis Ende/)).toBeNull()
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
  fireEvent.click(within(box).getByLabelText(/Zählerwechsel/))
  fireEvent.change(within(box).getByLabelText(/^Startstand neuer Zähler/), { target: { value: '5' } })
  fireEvent.change(within(box).getByLabelText(/^Endstand alter Zähler/), { target: { value: '980' } })
  fireEvent.change(within(box).getByLabelText(/Neuer Zähler geeicht bis Ende/), { target: { value: '2031' } })
  saveReadingIn(box)
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0]).toEqual({ url: '/api/readings', method: 'POST', body: { meterId: 'm1', date: '2025-06-30', value: 5, replacement: true, oldEndValue: 980, newCalibratedUntil: 2031 } })
})

// Durchsicht: Ein Heizkostenverteiler ist nicht eichpflichtig; das Feld erscheint dort auch beim Wechsel nicht.
test('Zählerwechsel am Heizkostenverteiler: kein Feld für das Eichjahr', async () => {
  const before = METERS
  METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'HKV Bad', unitId: 'u1', type: 'hkv', unit: 'Einheiten' }]
  try {
    stubWithUrls()
    const box = await openReadingForm()
    fireEvent.click(within(box).getByLabelText(/Zählerwechsel/))
    expect(within(box).getByLabelText(/^Endstand alter Zähler/)).toBeTruthy()
    expect(within(box).queryByLabelText(/Neuer Zähler geeicht bis Ende/)).toBeNull()
  } finally {
    METERS = before
  }
})

// Durchsicht S1: Ein Doppelklick auf „Anlegen“ legte die Ablesung zweimal an (zwei gleiche Stände am selben Tag, #69).
test('Ablesung: Doppelklick und Strg+S legen genau eine an', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
  fireEvent.change(within(box).getByLabelText(/^Zählerstand/), { target: { value: '12' } })
  const knopf = within(box).getByRole('button', { name: 'Anlegen' })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  fireEvent.keyDown(box, { key: 's', ctrlKey: true })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
})

test('Zähler: Doppelklick auf „Anlegen“ legt genau einen an', async () => {
  stubWithUrls()
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
  const box = screen.getByRole('dialog')
  fireEvent.change(within(box).getByLabelText(/^Name/), { target: { value: 'Kaltwasser Haus' } })
  const knopf = within(box).getByRole('button', { name: /^Anlegen$/ })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
})

// Durchsicht K1: Im Fenster „Neue Ablesung“ steht der letzte Stand als Anhalt, denn die Liste dahinter ist verdeckt.
test('Ablesung: das Fenster nennt den letzten Stand des Zählers', async () => {
  readings = [
    { id: 'r1', meterId: 'm1', date: '2024-12-31', value: 1234.5 },
    { id: 'r0', meterId: 'm1', date: '2023-12-31', value: 1000 },
  ] as Reading[]
  stubWithUrls()
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(2\)/ }, { timeout: 5000 }))
  fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
  const box = screen.getByRole('dialog', { name: /Neue Ablesung/ })
  expect(within(box).getByText('Letzter Stand: 1.234,5 m³ am 31.12.2024')).toBeTruthy()
})

// ---------- Ablesung bearbeiten, Rückfrage vor dem Speichern, Datum vorbelegt ----------
// Vorher ließ sich eine Ablesung nur löschen und neu anlegen; PUT /api/readings/:id hatte keinen Aufrufer.
const withReadings = async (list: Reading[], run: () => Promise<void>) => {
  readings = list
  try {
    stubWithUrls()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Ablesungen \\(${list.length}\\)`) }, { timeout: 5000 }))
    await run()
  } finally {
    readings = []
  }
}

test('Ablesung bearbeiten: das Fenster zeigt die gespeicherten Werte und speichert mit PUT', async () => {
  await withReadings([
    { id: 'r1', meterId: 'm1', date: '2024-12-31', value: 1000 },
    { id: 'r2', meterId: 'm1', date: '2025-06-30', value: 1234.5, note: 'Zwischenablesung' },
  ], async () => {
    // Die jüngste Ablesung steht oben.
    fireEvent.click(screen.getAllByRole('button', { name: 'Ablesung bearbeiten' })[0] as HTMLElement)
    const box = screen.getByRole('dialog', { name: /Ablesung bearbeiten/ })
    expect((within(box).getByLabelText(/^Datum/) as HTMLInputElement).value).toBe('2025-06-30')
    const stand = within(box).getByLabelText(/^Zählerstand/) as HTMLInputElement
    expect(stand.value).toBe('1234,5')
    expect((within(box).getByLabelText(/^Hinweis/) as HTMLInputElement).value).toBe('Zwischenablesung')
    // Anhalt ist der Stand davor, nicht die Ablesung selbst.
    expect(within(box).getByText('Letzter Stand: 1.000 m³ am 31.12.2024')).toBeTruthy()
    expect(within(box).queryByRole('button', { name: 'Anlegen' })).toBeNull()
    fireEvent.change(stand, { target: { value: '1.240' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ url: '/api/readings/r2?property=objekt-1', method: 'PUT', body: { date: '2025-06-30', value: 1240, replacement: null, oldEndValue: null, note: 'Zwischenablesung', estimated: false,
      // Der Stand beim Öffnen geht mit (staleRecord.ts): Ein zweites Fenster überschreibt keine berichtigte Ablesung.
      ifUnchanged: { id: 'r2', meterId: 'm1', date: '2025-06-30', value: 1234.5, note: 'Zwischenablesung' } } })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

// Der Server lehnt `newCalibratedUntil` im PUT mit 400 ab; das Fenster bietet es beim Bearbeiten nicht an und sagt, wo
// das Eichjahr steht.
test('Ablesung bearbeiten: beim Zählerwechsel kein Feld für das Eichjahr, sondern der Weg dorthin', async () => {
  await withReadings([{ id: 'r1', meterId: 'm1', date: '2025-07-01', value: 3, replacement: true, oldEndValue: 980 }], async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ablesung bearbeiten' }))
    const box = screen.getByRole('dialog', { name: /Ablesung bearbeiten/ })
    expect((within(box).getByLabelText(/Zählerwechsel/) as HTMLInputElement).checked).toBe(true)
    expect((within(box).getByLabelText(/^Endstand alter Zähler/) as HTMLInputElement).value).toBe('980')
    expect(within(box).queryByLabelText(/Neuer Zähler geeicht bis Ende/)).toBeNull()
    expect(within(box).getByText(/Das Eichjahr des neuen Zählers ändern Sie über „Zähler bearbeiten“/)).toBeTruthy()
  })
})

test('Stand unter dem vorigen Stand: Rückfrage; „Abbrechen“ speichert nichts, „Trotzdem anlegen“ speichert', async () => {
  await withReadings([{ id: 'r1', meterId: 'm1', date: '2025-12-31', value: 450.8 }], async () => {
    fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
    const box = screen.getByRole('dialog', { name: /Neue Ablesung/ })
    fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2026-06-30' } })
    fireEvent.change(within(box).getByLabelText(/^Zählerstand/), { target: { value: '12,5' } })
    saveReadingIn(box)
    const frage = await screen.findByRole('alertdialog')
    expect(frage.textContent).toMatch(/Der Stand 12,5 m³ liegt unter dem vorigen Stand 450,8 m³ vom 31\.12\.2025/)
    fireEvent.click(within(frage).getByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls).toEqual([])
    // Das Fenster bleibt mit der Eingabe offen.
    expect((within(box).getByLabelText(/^Zählerstand/) as HTMLInputElement).value).toBe('12,5')
    await waitFor(() => expect((within(box).getByRole('button', { name: 'Anlegen' }) as HTMLButtonElement).disabled).toBe(false))
    saveReadingIn(box)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Trotzdem anlegen' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ url: '/api/readings', method: 'POST', body: { meterId: 'm1', date: '2026-06-30', value: 12.5 } })
  })
})

test('Stand unter dem vorigen Stand mit Zählerwechsel: keine Rückfrage', async () => {
  await withReadings([{ id: 'r1', meterId: 'm1', date: '2025-12-31', value: 450.8 }], async () => {
    fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
    const box = screen.getByRole('dialog', { name: /Neue Ablesung/ })
    fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2026-06-30' } })
    fireEvent.click(within(box).getByLabelText(/Zählerwechsel/))
    fireEvent.change(within(box).getByLabelText(/^Startstand neuer Zähler/), { target: { value: '12,5' } })
    saveReadingIn(box)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

test('Datum in der Zukunft: Rückfrage vor dem Anlegen', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2052-12-31' } })
  fireEvent.change(within(box).getByLabelText(/^Zählerstand/), { target: { value: '500' } })
  saveReadingIn(box)
  const frage = await screen.findByRole('alertdialog')
  expect(frage.textContent).toMatch(/Das Datum 31\.12\.2052 liegt in der Zukunft\./)
  expect(calls).toEqual([])
})

test('Ablesung bearbeiten: die Rückfrage heißt „Trotzdem speichern“ und vergleicht nicht mit der Ablesung selbst', async () => {
  await withReadings([
    { id: 'r1', meterId: 'm1', date: '2024-12-31', value: 400 },
    { id: 'r2', meterId: 'm1', date: '2025-12-31', value: 450.8 },
  ], async () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Ablesung bearbeiten' })[0] as HTMLElement)
    const box = screen.getByRole('dialog', { name: /Ablesung bearbeiten/ })
    fireEvent.change(within(box).getByLabelText(/^Zählerstand/), { target: { value: '39,9' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Speichern' }))
    const frage = await screen.findByRole('alertdialog')
    expect(frage.textContent).toMatch(/unter dem vorigen Stand 400 m³ vom 31\.12\.2024/)
    fireEvent.click(within(frage).getByRole('button', { name: 'Trotzdem speichern' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ url: '/api/readings/r2?property=objekt-1', method: 'PUT', body: { value: 39.9 } })
  })
})

/** Öffnet „Neue Ablesung“ im Abrechnungsjahr `year`; ohne Wahl steht die Seite im Vorjahr. */
const openReadingFormIn = async (year: number): Promise<HTMLElement> => {
  render(
    <UIProvider>
      <PeriodProvider>
        <PropertyProvider>
          <PeriodSelect />
          <Zaehler units={UNITS} />
        </PropertyProvider>
      </PeriodProvider>
    </UIProvider>,
  )
  await screen.findByRole('button', { name: /Ablesungen \(0\)/ }, { timeout: 5000 })
  const select = screen.getByRole('combobox', { name: 'Abrechnungsjahr' }) as HTMLSelectElement
  fireEvent.change(select, { target: { value: String(year) } })
  await waitFor(() => expect(select.value).toBe(String(year)))
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/ }))
  fireEvent.click(await screen.findByRole('button', { name: '+ Ablesung anlegen' }))
  return screen.getByRole('dialog', { name: /Neue Ablesung/ })
}
const thisYear = () => Number(todayIso().slice(0, 4))

// Vorbelegt ist nicht geändert: Wer das Fenster ohne Eingabe schließt, wird nicht nach „Verwerfen“ gefragt.
test('Neue Ablesung im laufenden Zeitraum: das Datum ist mit heute vorbelegt, und ohne Eingabe schließt das Fenster ohne Rückfrage', async () => {
  stubWithUrls()
  const box = await openReadingFormIn(thisYear())
  const date = within(box).getByLabelText(/^Datum/) as HTMLInputElement
  expect(date.value).toBe(todayIso())
  // Solange das vorbelegte Datum unberührt ist, sagt ein Hinweis am Feld, dass es das heutige ist.
  expect(description(date)).toBe('Vorbelegt ist das heutige Datum. Für die Ablesung zum Ende des Zeitraums tragen Sie den Ablesetag ein.')
  fireEvent.click(within(box).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('Neue Ablesung: der Hinweis zum vorbelegten Datum verschwindet, sobald das Datum geändert ist', async () => {
  stubWithUrls()
  const box = await openReadingFormIn(thisYear())
  const date = within(box).getByLabelText(/^Datum/) as HTMLInputElement
  fireEvent.change(date, { target: { value: '2025-12-31' } })
  expect(description(date)).toBe('')
  expect(within(box).queryByText(/Vorbelegt ist das heutige Datum/)).toBeNull()
})

// Durchsicht: Wer im Januar die Jahresablesung des abgelaufenen Zeitraums einträgt, bekam heute vorbelegt; übersehen
// verschob das Geld zwischen den Mietern. Liegt heute nicht im gewählten Zeitraum, bleibt das Pflichtfeld leer.
test('Neue Ablesung in einem anderen Zeitraum als dem heutigen: das Datum bleibt leer, ohne Hinweis', async () => {
  stubWithUrls()
  const box = await openReadingFormIn(thisYear() - 1)
  const date = within(box).getByLabelText(/^Datum/) as HTMLInputElement
  expect(date.value).toBe('')
  expect(within(box).queryByText(/Vorbelegt ist das heutige Datum/)).toBeNull()
})

// Durchsicht: Der Endstand des eigenen Wechsels ging nicht in die Rückfrage ein.
test('Zählerwechsel mit Endstand unter dem vorigen Stand: Rückfrage nennt den Endstand', async () => {
  await withReadings([{ id: 'r1', meterId: 'm1', date: '2025-12-31', value: 450.8 }], async () => {
    fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
    const box = screen.getByRole('dialog', { name: /Neue Ablesung/ })
    fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2026-06-30' } })
    fireEvent.click(within(box).getByLabelText(/Zählerwechsel/))
    fireEvent.change(within(box).getByLabelText(/^Startstand neuer Zähler/), { target: { value: '2' } })
    fireEvent.change(within(box).getByLabelText(/^Endstand alter Zähler/), { target: { value: '400' } })
    saveReadingIn(box)
    expect((await screen.findByRole('alertdialog')).textContent).toMatch(/Der Endstand des alten Zählers 400 m³ liegt unter dem vorigen Stand 450,8 m³ vom 31\.12\.2025/)
    expect(calls).toEqual([])
  })
})

test('Heizkostenverteiler mit Stand unter dem vorigen: die Rückfrage verweist auf den Stichtagswert', async () => {
  const before = METERS
  METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'HKV Bad', unitId: 'u1', type: 'hkv', unit: 'Einheiten' }]
  try {
    await withReadings([{ id: 'r1', meterId: 'm1', date: '2024-12-31', value: 800 }], async () => {
      fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
      const box = screen.getByRole('dialog', { name: /Neue Ablesung/ })
      fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-12-31' } })
      fireEvent.change(within(box).getByLabelText(/^Zählerstand/), { target: { value: '300' } })
      saveReadingIn(box)
      const frage = await screen.findByRole('alertdialog')
      expect(frage.textContent).toMatch(/„Stichtagswert laut Anzeige“/)
      expect(frage.textContent).not.toMatch(/Zählerwechsel/)
      // Die zitierten Beschriftungen stehen so auf der Seite.
      expect(screen.getByLabelText(/Stichtagswert laut Anzeige/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Stichtagswert speichern', hidden: true })).toBeTruthy()
    })
  } finally {
    METERS = before
  }
})

// Ein Stichtagswert (Heizkostenverteiler) hat sein eigenes Formular; das allgemeine Fenster passte nicht zu ihm.
test('Stichtagswert eines Heizkostenverteilers: kein „Ablesung bearbeiten“', async () => {
  const before = METERS
  METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'HKV Bad', unitId: 'u1', type: 'hkv', unit: 'Einheiten' }]
  try {
    await withReadings([
      { id: 'r1', meterId: 'm1', date: '2025-06-30', value: 12 },
      { id: 'r2', meterId: 'm1', date: '2025-12-31', value: 0, replacement: true, oldEndValue: 40 },
    ], async () => {
      expect(screen.getAllByRole('button', { name: 'Ablesung löschen' })).toHaveLength(2)
      expect(screen.getAllByRole('button', { name: 'Ablesung bearbeiten' })).toHaveLength(1)
    })
  } finally {
    METERS = before
  }
})

// Aufklappen einheitlich (Durchsicht M1): „Ablesungen (N)“ klappt die Ablesungen auf wie jeder Aufklapper, mit Pfeil
// (`disclosure`), aria-expanded und einem Text, der sagt, was der nächste Klick tut.
test('„Ablesungen (N)“ ist ein Aufklapper: Pfeil, aria-expanded, aria-controls, offen „Ablesungen schließen“', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Zaehler units={UNITS} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  const knopf = await screen.findByRole('button', { name: 'Ablesungen (0)' }, { timeout: 5000 })
  expect(knopf.classList.contains('disclosure')).toBe(true)
  expect(knopf.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(knopf)
  expect(knopf.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('button', { name: 'Ablesungen schließen' })).toBe(knopf)
  const panel = screen.getByRole('button', { name: '+ Ablesung anlegen' }).closest('tr')
  if (!panel) return expect.fail('keine Zeile mit den Ablesungen')
  expect(panel.id).toBeTruthy()
  expect(knopf.getAttribute('aria-controls')).toBe(panel.id)
  fireEvent.click(knopf)
  expect(screen.getByRole('button', { name: 'Ablesungen (0)' })).toBe(knopf)
})

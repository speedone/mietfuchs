// @vitest-environment jsdom
// Komponententest der Kosten-Seite. Er prüft die eine Eigenschaft, die reine Logiktests
// nicht sehen können: dass der angezeigte Wert eines Auswahlfelds und der gespeicherte Wert
// übereinstimmen. Genau diese Lücke war Issue #6 — das Feld zeigte „Sonstig", gespeichert
// wurde „Kaltwasser".
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Meter, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Kosten from './Kosten'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG links', areaM2: 90, participates: true },
  { id: 'u3', propertyId: 'objekt-1', name: 'OG rechts', areaM2: 60, participates: true },
]

// Nur ein Zähler, und zwar „sonstig" — die Konstellation aus der Fehlermeldung.
const METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'Zähler EG', unitId: 'u2', type: 'sonstig', unit: 'm³' }]

let sent: { url: string; method: string; body: Record<string, unknown> }[]
let gets: string[]
let plants: unknown[] = []

beforeEach(() => {
  sent = []
  gets = []
  plants = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    gets.push(url)
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/costItems': [],
      '/api/meters': METERS,
      '/api/uploads': [],
      '/api/heating-plants': plants,
    }
    return new Response(JSON.stringify(responses[url.split('?')[0] ?? url] ?? []), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openForm = async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  // Auf die geladenen Zähler warten, sonst fehlt der Verbrauchsschlüssel in der Auswahl
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '100,00' } })
}

const select = (label: RegExp) => screen.getByLabelText(label) as HTMLSelectElement

test('Zählertyp: angezeigter Wert und gespeicherter Wert stimmen überein', async () => {
  await openForm()
  // Die Zähler kommen nach der Seite (#92: erst wenn das Objekt feststeht); ohne sie fehlt der
  // Verbrauchsschlüssel in der Auswahl.
  await waitFor(() => expect([...select(/Umlageschlüssel/i).options].some((o) => o.value === 'meter')).toBe(true))
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'meter' } })

  const typeSelect = await waitFor(() => select(/Zählertyp/i))
  // Das Feld belegt nichts vor, was in der Liste nicht steht. Gibt es nur einen Typ, ist er
  // vorgewählt (#142), und zwar im Zustand: gespeichert wird, was zu sehen ist.
  expect([...typeSelect.options].map((o) => o.value)).toEqual(['', 'sonstig'])
  // Beschriftet als Substantiv wie die Nachbarn (Kaltwasser, Wärme), nicht als Adjektiv (#138).
  expect([...typeSelect.options].map((o) => o.text)).toEqual(['— wählen —', 'Sonstiges'])
  expect(typeSelect.value).toBe('sonstig')
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ key: 'meter', meterType: 'sonstig' })
})

test('Zählertyp: bei zwei Typen wählt der Mensch, und ohne Wahl wird nicht gespeichert', async () => {
  METERS.push({ id: 'm2', propertyId: 'objekt-1', name: 'Wärme OG', unitId: 'u3', type: 'waerme', unit: 'kWh' })
  try {
    await openForm()
    await waitFor(() => expect([...select(/Umlageschlüssel/i).options].some((o) => o.value === 'meter')).toBe(true))
    fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'meter' } })
    const typeSelect = await waitFor(() => select(/Zählertyp/i))
    expect(typeSelect.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
    await waitFor(() => expect(screen.getByText(/bitte einen Zählertyp wählen/i)).toBeTruthy())
    expect(sent).toHaveLength(0)
    fireEvent.change(typeSelect, { target: { value: 'waerme' } })
    fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ key: 'meter', meterType: 'waerme' })
  } finally {
    METERS.length = 1
  }
})

test('Nicht umlagefähig (#142): keine Schlüsselauswahl, gespeichert wird die neutrale Vorgabe', async () => {
  await openForm()
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'custom' } })
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Nicht umlagefähig' } })
  expect(screen.queryByLabelText(/Umlageschlüssel/i)).toBeNull()
  expect(screen.queryByText(/Vereinbarte Anteile/i)).toBeNull()
  expect(screen.getByText(/trägt der Vermieter allein/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ category: 'Nicht umlagefähig', key: 'area', customShares: null })
})

test('Nicht umlagefähig (#163): für die Steuer einer Einheit zuordnen, etwa die Badrenovierung der eigenen Wohnung', async () => {
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Nicht umlagefähig' } })
  const betrifft = select(/Betrifft \(für die Steuer\)/i)
  expect(betrifft.value).toBe('')
  expect([...betrifft.options].map((o) => o.textContent)).toEqual(['das ganze Gebäude (nach Fläche)', 'bestimmte Einheiten (nach Fläche)', 'EG (selbstgenutzt)', 'OG links', 'OG rechts'])
  fireEvent.change(betrifft, { target: { value: 'u1' } })
  expect(select(/Betrifft \(für die Steuer\)/i).value).toBe('u1')
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ category: 'Nicht umlagefähig', key: 'direct', directUnitId: 'u1' })
  // Die Rücklage kennt die Auswahl nicht (#143).
  cleanup()
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Zuführung Erhaltungsrücklage' } })
  expect(screen.queryByLabelText(/Betrifft \(für die Steuer\)/i)).toBeNull()
})

test('Nicht umlagefähig (#163, Durchsicht): bestimmte Einheiten, angezeigt wie gespeichert', async () => {
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Nicht umlagefähig' } })
  fireEvent.change(select(/Betrifft \(für die Steuer\)/i), { target: { value: '__einige' } })
  expect(select(/Betrifft \(für die Steuer\)/i).value).toBe('__einige')
  const og = screen.getByRole('checkbox', { name: 'OG links (betroffen)' }) as HTMLInputElement
  expect(og.checked).toBe(false)
  fireEvent.click(og)
  fireEvent.click(screen.getByRole('checkbox', { name: 'OG rechts (betroffen)' }))
  expect((screen.getByRole('checkbox', { name: 'OG links (betroffen)' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ category: 'Nicht umlagefähig', key: 'area', directUnitId: null, participantUnitIds: ['u2', 'u3'] })
})

test('Gemeinschaftsabrechnung (#142): die Summe heißt nach dem Maßstab, nicht nach den Kosten', async () => {
  await openForm()
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'external' } })
  expect(screen.getByLabelText(/Summe der Miteigentumsanteile in der Anlage \(z\. B\. 1\.000 MEA\)/)).toBeTruthy()
  fireEvent.change(select(/Maßstab/i), { target: { value: 'area' } })
  expect(screen.getByLabelText(/Summe der Wohnflächen in der Anlage/)).toBeTruthy()
  expect(screen.queryByText(/^Summe in der Anlage$/)).toBeNull()
})

test('Vereinbarte Anteile: Eingabe, Hinweis auf den Vermieter-Rest und Speichern', async () => {
  await openForm()
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'custom' } })

  // Die selbstgenutzte Wohnung darf einen Anteil tragen, ausgenommene gäbe es hier nicht.
  fireEvent.change(await waitFor(() => screen.getByLabelText(/OG links/i)), { target: { value: '40' } })
  fireEvent.change(screen.getByLabelText(/OG rechts/i), { target: { value: '40' } })
  await waitFor(() => expect(screen.getByText(/die restlichen 20 % trägt der Vermieter/i)).toBeTruthy())

  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ key: 'custom', customShares: { u2: 40, u3: 40 } })
})

test('Umlageschlüssel-Auswahl zeigt den gespeicherten Schlüssel auch ohne Wohnungszähler', async () => {
  // Zähler nachträglich gelöscht: „Verbrauch" wird normalerweise nicht angeboten. Die
  // bestehende Position steht aber auf „meter" — dann muss der Eintrag in der Liste bleiben.
  METERS.length = 0
  try {
    await openForm()
    const keySelect = select(/Umlageschlüssel/i)
    expect([...keySelect.options].map((o) => o.value)).not.toContain('meter')
  } finally {
    METERS.push({ id: 'm1', propertyId: 'objekt-1', name: 'Zähler EG', unitId: 'u2', type: 'sonstig', unit: 'm³' })
  }
})

test('Objekt: die Seite lädt und speichert im gewählten Objekt (#92)', async () => {
  await openForm()
  await waitFor(() => expect(gets).toContain('/api/costItems?property=objekt-1'))
  expect(gets).toContain('/api/meters?property=objekt-1')
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].url).toBe('/api/costItems?property=objekt-1')
})

test('Objekt: mit zwei Objekten lädt die Seite erst, wenn das Objekt feststeht (#92)', async () => {
  // Ohne Angabe antwortet der Server bei zwei Objekten mit 400. Ein Abruf, bevor die Objekte
  // geladen sind, ergäbe bei jedem Start eine Fehlermeldung.
  const zwei = [
    { id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
    { id: 'objekt-2', name: 'B', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null },
  ]
  vi.stubGlobal('fetch', async (url: string) => {
    gets.push(url)
    const body = url === '/api/properties' ? zwei : []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(gets).toContain('/api/costItems?property=objekt-1'))
  expect(gets.filter((u) => u === '/api/costItems' || u === '/api/meters')).toEqual([])
})

test('Einzelbeträge (#94): je Mieter ein Feld, gespeichert wird genau das Eingetragene', async () => {
  const mieter = [
    { id: 't1', unitId: 'u2', tenantName: 'Meier', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
  ]
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} tenancies={mieter} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Heizung laut Techem' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '800,00' } })
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'amounts' } })
  expect(select(/Umlageschlüssel/i).value).toBe('amounts')
  fireEvent.change(screen.getByLabelText(/Meier \(OG links\)/), { target: { value: '312,40' } })
  expect(screen.getByText(/487,60 € trägt der Vermieter/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ key: 'amounts', tenancyAmounts: { t1: 31240 }, externalBasis: null })
})

test('Gutschrift (#139): der Hinweis am Betragsfeld steht da, und „−54,00“ wird gespeichert', async () => {
  await openForm()
  expect(screen.getByText(/Gutschrift mit Minus/i)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '−54,00' } })
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ amountCents: -5400 })
})

test('Heizposition mit eigener Heizperiode (Durchsicht von #231, Laienprobe B15): Heizperiode, Jahr der Zahlung sichtbar, ohne Beleg nicht vorbelegt und Pflicht', async () => {
  plants = [{
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
}]
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Heizung und Warmwasser' } })
  const heizperiode = await waitFor(() => select(/^Heizperiode$/))
  const option = heizperiode.selectedOptions[0]?.textContent ?? ''
  const [, beginn, ende] = /(\d{4})\/(\d{4})/.exec(option) ?? []
  if (!beginn || !ende) throw new Error(`keine Heizperiode über zwei Jahre: ${option}`)
  const jahr = await waitFor(() => select(/Jahr der Zahlung/i))
  expect(jahr.value).toBe('')
  expect([...jahr.options].map((o) => o.value).filter(Boolean)).toEqual([beginn, ende, String(Number(ende) + 1)])
  expect(screen.getByText(/in monatlichen Abschlägen über zwei Kalenderjahre/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  expect(await screen.findByText(/Bitte geben Sie das Jahr der Zahlung an/)).toBeTruthy()
  expect(sent).toHaveLength(0)
  fireEvent.change(jahr, { target: { value: ende } })
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ period: heizperiode.value, heatingPlantId: 'hp1', taxYear: Number(ende) })
})

// Laienprobe B19: Der Betrag der Messdienstposition ist der vor dem Abzug; das Formular sagt es dort.
test('Laienprobe B19: Heizung mit Einzelbeträgen bei Messdienst-Anlage nennt den Betrag vor dem CO₂-Abzug', async () => {
  plants = [{
    id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
  }]
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Heizung und Warmwasser' } })
  expect(screen.queryByText(/Kosten vor „Abzüglich CO₂-Kosten Vermieter“/)).toBeNull()
  await waitFor(() => expect([...select(/Umlageschlüssel/i).options].some((o) => o.value === 'amounts')).toBe(true))
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'amounts' } })
  expect(await screen.findByText(/Tragen Sie die Kosten vor „Abzüglich CO₂-Kosten Vermieter“ ein/)).toBeTruthy()
})

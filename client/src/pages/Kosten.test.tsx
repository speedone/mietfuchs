// @vitest-environment jsdom
// Komponententest der Kosten-Seite. Er prüft die eine Eigenschaft, die reine Logiktests
// nicht sehen können: dass der angezeigte Wert eines Auswahlfelds und der gespeicherte Wert
// übereinstimmen. Genau diese Lücke war Issue #6 — das Feld zeigte „Sonstig", gespeichert
// wurde „Kaltwasser".
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Meter, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import { press, tabbables } from '../testing/keys'
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
let costItems: unknown[] = []

beforeEach(() => {
  sent = []
  gets = []
  plants = []
  costItems = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    gets.push(url)
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/costItems': costItems,
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
  expect(screen.getByText(/in Abschlägen über zwei Kalenderjahre bezahlt/)).toBeTruthy()
  expect(screen.getByText(/der um den\s+Jahreswechsel \(bis zehn Tage davor oder danach\) fällig ist und in dieser Zeit gezahlt wird, zählt zu dem Jahr, zu dem er gehört/)).toBeTruthy()
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

test('Zwei Heizanlagen (Heizung PR 9): die Heizposition wählt ihre Anlage; ohne Wahl ordnet der Server nach den Wohnungen', async () => {
  const anlage = (id: string, name: string, endsOn: string | null, unitIds: string[] = []) => ({
    id, propertyId: 'objekt-1', name, energy: 'gas', supply: 'central', method: 'manual', separateSettlement: null,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: unitIds.map((unitId) => ({ unitId, heatedAreaM2: null })), newDevicesInstall: null,
    nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn, replacesPlantId: null,
  })
  plants = [anlage('hp1', 'Ölkessel', '2025-06-30', ['u2', 'u3']), anlage('hp2', 'Gastherme', null, ['u2', 'u3'])]
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Heizung und Warmwasser' } })
  const wahl = await waitFor(() => select(/^Heizanlage(?!n)/))
  expect([...wahl.options].map((o) => o.textContent)).toEqual(['automatisch (nach den beteiligten Wohnungen)', 'Ölkessel (bis 30.06.2025)', 'Gastherme'])
  fireEvent.change(wahl, { target: { value: 'hp2' } })
  expect(select(/^Heizanlage(?!n)/).value).toBe('hp2')
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  // Recht I2 der Durchsicht von #238: Die Wahl der Anlage beteiligt deren Wohnungen.
  expect(sent[0].body).toMatchObject({ category: 'Heizung und Warmwasser', heatingPlantId: 'hp2', participantUnitIds: ['u2', 'u3'] })
})

test('Heizung PR 10: bei eigener Heizkostenabrechnung nur der Schlüssel nach Heizkostenverordnung; Teil und Ziel angezeigt wie gespeichert', async () => {
  plants = [{
    id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'self', separateSettlement: null,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
    nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
    hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area', heatPumpInstalledOn: null,
  }]
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Heizung und Warmwasser' } })
  await waitFor(() => expect(select(/Umlageschlüssel/i).value).toBe('heatingSystem'))
  expect([...select(/Umlageschlüssel/i).options].map((o) => o.value)).toEqual(['heatingSystem'])
  // Ohne Teil: Ziel wählbar, nichts vorbelegt.
  expect(select(/^Ziel(?: \(beim Mieterwechsel\))?$/).value).toBe('')
  fireEvent.change(select(/^Teil der Heizkosten$/), { target: { value: 'fuel' } })
  // Brennstoff bei verbundener Bereitung: nur „Heizung und Warmwasser“, und genau das steht im Zustand.
  await waitFor(() => expect(select(/^Ziel(?: \(beim Mieterwechsel\))?$/).value).toBe('both'))
  expect([...select(/^Ziel(?: \(beim Mieterwechsel\))?$/).options].map((o) => o.value)).toEqual(['both'])
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ key: 'heatingSystem', heatingPart: 'fuel', heatingTarget: 'both' })
})

test('Heizung PR 10: bei freien Schlüsseln „nur Heizung“ wählbar, ohne Wahl „Heizung und Warmwasser“', async () => {
  plants = [{
    id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'manual', separateSettlement: null,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
    nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
    hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null,
  }]
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Heizung und Warmwasser' } })
  await waitFor(() => expect([...select(/^Ziel(?: \(beim Mieterwechsel\))?$/).options].map((o) => o.value)).toEqual(['', 'heating']))
  expect(select(/^Ziel(?: \(beim Mieterwechsel\))?$/).value).toBe('')
  expect([...select(/Umlageschlüssel/i).options].map((o) => o.value)).not.toContain('heatingSystem')
  fireEvent.change(select(/^Ziel(?: \(beim Mieterwechsel\))?$/), { target: { value: 'heating' } })
  expect(select(/^Ziel(?: \(beim Mieterwechsel\))?$/).value).toBe('heating')
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ key: 'area', heatingTarget: 'heating' })
})

test('Durchsicht #241 Runde 2, H1: Eine Position 2025 behält ihr Ziel, auch wenn die Anlage seit 2026 kein Warmwasser bereitet; ein unpassendes Ziel wird nie still ersetzt', async () => {
  const anlage = (selfSpans: unknown[]) => ({
    id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'self', separateSettlement: null,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
    nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
    hotWater: 'none', capture: 'heatMeter', areaBasisHeat: 'area', heatPumpInstalledOn: null, selfSpans,
  })
  const wartung = {
    id: 'c1', propertyId: 'objekt-1', period: '2025-01', year: 2025, category: 'Heizung und Warmwasser', description: 'Wartung Kessel', amountCents: 30000,
    key: 'heatingSystem', meterType: null, directUnitId: null, customShares: null, participantUnitIds: null, heatingPart: 'operating', heatingTarget: 'both', heatingPlantId: 'hp1',
  }
  costItems = [wartung]
  // 2025 mit Warmwasser eingerichtet, seit 2026 ohne.
  plants = [anlage([{ from: '2025-01', until: '2026-01', capture: 'heatMeter', hotWater: 'combined' }, { from: '2026-01', until: null, capture: 'heatMeter', hotWater: 'none' }])]
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} /></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
  await waitFor(() => expect(select(/^Ziel(?: \(beim Mieterwechsel\))?$/).value).toBe('both'))
  expect([...select(/^Ziel(?: \(beim Mieterwechsel\))?$/).options].map((o) => o.value)).toEqual(['', 'both', 'heating', 'water'])
  fireEvent.click(screen.getByRole('button', { name: /^Übernehmen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ heatingTarget: 'both' })
  cleanup()
  // Bereitete die Anlage auch 2025 kein Warmwasser, passt „Heizung und Warmwasser“ nicht: Fehler am Feld,
  // das gespeicherte Ziel bleibt im Zustand, und gespeichert wird nicht.
  sent = []
  plants = [anlage([{ from: '2025-01', until: null, capture: 'heatMeter', hotWater: 'none' }])]
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} /></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
  // Am Feld schon vor dem Speichern die kurze Fassung (#346, Schritt 3); der Satz steht einmal, in der
  // Sammelmeldung beim Speichern, mit Link aufs Feld (Durchsicht, Kann 9: nicht zweimal angesagt).
  await waitFor(() => expect(select(/^Ziel(?: \(beim Mieterwechsel\))?$/).getAttribute('aria-invalid')).toBe('true'))
  expect(screen.getByText('Ziel neu wählen')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(select(/^Ziel(?: \(beim Mieterwechsel\))?$/).value).toBe('')
  expect([...select(/^Ziel(?: \(beim Mieterwechsel\))?$/).options].map((o) => o.value)).toEqual(['', 'heating'])
  fireEvent.click(screen.getByRole('button', { name: /^Übernehmen$/ }))
  const alert = await screen.findByRole('alert')
  expect(within(alert).getByRole('link', { name: /gespeicherte Ziel passt nicht/ })).toBeTruthy()
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  await new Promise((r) => setTimeout(r, 50))
  expect(sent).toEqual([])
  fireEvent.change(select(/^Ziel(?: \(beim Mieterwechsel\))?$/), { target: { value: 'heating' } })
  fireEvent.click(screen.getByRole('button', { name: /^Übernehmen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ heatingTarget: 'heating' })
})

// Heizung PR 19 (#97): Die Karte „CO₂-Erstattung“ steht nur da, wenn ein Mieter selbst heizt.
test('CO₂-Erstattung: Karte nur bei einem Mieter, der selbst heizt', async () => {
  const mieter = (heatingModel?: 'selfSupply') => [
    { id: 't1', unitId: 'u2', tenantName: 'Meier', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...(heatingModel ? { heatingModel } : {}) },
  ]
  const { unmount } = render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} tenancies={mieter()} /></PropertyProvider></PeriodProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i })).toBeTruthy())
  expect(screen.queryByText(/an Mieter, die selbst heizen/)).toBeNull()
  unmount()
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} tenancies={mieter('selfSupply')} /></PropertyProvider></PeriodProvider>)
  expect(await screen.findByText(/an Mieter, die selbst heizen/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Erstattung erfassen' })).toBeTruthy()
})

// #255 PR 3 (R-2): Ein Zahlungsdatum, das das Steuerjahr ändert, zeigt das Formular an und speichert es erst nach der
// Rückfrage, mit `confirmPaidOn` im Rumpf; ohne Bestätigung geht nichts hinaus.
test('Bezahlt am: Rückfrage bei anderem Steuerjahr, gespeichert mit Bestätigung', async () => {
  const { UIProvider } = await import('../components/feedback')
  const year = new Date().getFullYear() - 1
  render(
    <UIProvider>
      <PeriodProvider>
        <PropertyProvider>
          <Kosten units={UNITS} settings={null} />
        </PropertyProvider>
      </PeriodProvider>
    </UIProvider>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Versicherung' } })
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '600,00' } })
  const paid = screen.getByLabelText('Bezahlt am (für die Steuer)') as HTMLInputElement
  fireEvent.change(paid, { target: { value: `${year + 1}-02-10` } })
  expect(paid.value).toBe(`${year + 1}-02-10`)
  expect(screen.getByRole('status').textContent).toContain(`zu ${year + 1} statt zu ${year}`)
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Steuerjahr ändert sich' })).getByRole('button', { name: 'Abbrechen' }))
  await new Promise((r) => setTimeout(r, 20))
  expect(sent).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Steuerjahr ändert sich' })).getByRole('button', { name: 'So speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ paidOn: `${year + 1}-02-10`, confirmPaidOn: true })
})

// Durchsicht von #255 PR 3, M1: Beim Aufteilen prüft der Server jeden Teil. Eine Jahresversicherung 07/Jahr bis
// 06/Folgejahr, bezahlt am 01.07., ändert das Steuerjahr des zweiten Teils, obwohl das Datum im Jahr des Formulars liegt.
// Das Formular fragt deshalb nach der Vorschau mit deren Teilen und derselben Regel wie der Server
// (`splitPaidOnQuestions` in shared/paidOn.ts) und schickt die Teile einmal, mit `confirmPaidOn`.
const splitFetch = (year: number, question: string, confirmedOnly: 'split' | 'plain') => async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET'
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  if (method !== 'GET') {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    sent.push({ url, method, body })
    if (url.includes('/split/preview')) {
      return json({ parts: [
        { period: `${year}-01`, label: String(year), days: 184, amountCents: 30247, labor35aCents: null, description: 'Gebäudeversicherung', needsTaxYear: false, closed: false, startYear: year, endYear: year },
        { period: `${year + 1}-01`, label: String(year + 1), days: 181, amountCents: 29753, labor35aCents: null, description: 'Gebäudeversicherung', needsTaxYear: false, closed: false, startYear: year + 1, endYear: year + 1 },
      ] })
    }
    const guarded = confirmedOnly === 'split' ? url.includes('/split') : !url.includes('/split')
    if (guarded && body.confirmPaidOn !== true) return json({ error: question, question: 'paidOn' }, 409)
    return json([])
  }
  const responses: Record<string, unknown> = {
    '/api/properties': [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
    '/api/meters': METERS,
  }
  return json(responses[url.split('?')[0] ?? url] ?? [])
}

const renderKosten = async () => {
  const { UIProvider } = await import('../components/feedback')
  render(
    <UIProvider>
      <PeriodProvider>
        <PropertyProvider>
          <Kosten units={UNITS} settings={null} />
        </PropertyProvider>
      </PeriodProvider>
    </UIProvider>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition manuell erfassen/i }))
}

test('Bezahlt am beim Aufteilen: das Formular fragt mit den Teilen der Vorschau, wie der Server', async () => {
  const year = new Date().getFullYear() - 1
  const question = `Mit dem Datum 01.07.${year} zählt die Position für die Steuer zu ${year} statt zu ${year + 1}.`
  vi.stubGlobal('fetch', splitFetch(year, question, 'split'))
  await renderKosten()
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Gebäudeversicherung' } })
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '600,00' } })
  fireEvent.change(screen.getByLabelText(/Leistungszeitraum/), { target: { value: `${year}-07-01` } })
  fireEvent.change(screen.getByLabelText(/^bis$/), { target: { value: `${year + 1}-06-30` } })
  fireEvent.change(screen.getByLabelText('Bezahlt am (für die Steuer)'), { target: { value: `${year}-07-01` } })
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Rechnung aufteilen?' })).getByRole('button', { name: 'Aufteilen und speichern' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Steuerjahr ändert sich' })
  expect(dialog.textContent).toContain(question)
  const splits = () => sent.filter((r) => r.url.includes('/split') && !r.url.includes('preview'))
  expect(splits()).toHaveLength(0)
  fireEvent.click(within(dialog).getByRole('button', { name: 'So speichern' }))
  await waitFor(() => expect(splits()).toHaveLength(1))
  expect(splits()[0]?.body).toMatchObject({ paidOn: `${year}-07-01`, confirmPaidOn: true })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
})

// Antwortet der Server trotzdem mit seiner Rückfrage (409 `question: 'paidOn'`), etwa weil sich der Bestand inzwischen
// geändert hat, zeigt die Seite sie als Rückfrage und wiederholt mit Bestätigung, statt nur eine Meldung stehen zu lassen.
test('Bezahlt am: eine Rückfrage des Servers wird zur Rückfrage der Seite', async () => {
  const year = new Date().getFullYear() - 1
  const question = `Das Datum 01.07.${year} liegt außerhalb der üblichen Spanne.`
  vi.stubGlobal('fetch', splitFetch(year, question, 'plain'))
  await renderKosten()
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Versicherung' } })
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '600,00' } })
  fireEvent.change(screen.getByLabelText('Bezahlt am (für die Steuer)'), { target: { value: `${year}-07-01` } })
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Steuerjahr ändert sich' })
  expect(dialog.textContent).toContain(question)
  fireEvent.click(within(dialog).getByRole('button', { name: 'So speichern' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]?.body).toMatchObject({ paidOn: `${year}-07-01`, confirmPaidOn: true })
})

// Durchsicht M3 (#346, Schritt 2): Heizanlage und Heizperiode bearbeitet das Seitenfenster neben dem
// Formularobjekt. Wer nur die Heizperiode ändert, wird beim Schließen trotzdem gefragt.
test('Seitenfenster: nur die Heizanlage geändert, Esc fragt „Änderungen verwerfen?“', async () => {
  const anlage = (id: string, name: string) => ({
    id, propertyId: 'objekt-1', name, energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
  })
  plants = [anlage('hp1', 'Gastherme'), anlage('hp2', 'Ofen')]
  costItems = [{
    id: 'c1', propertyId: 'objekt-1', period: calendarPeriod(new Date().getFullYear() - 1), category: 'Heizung und Warmwasser', description: 'Gas',
    amountCents: 100000, key: 'area', heatingPlantId: 'hp1',
  }]
  render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
  await waitFor(() => expect(select(/^Heizanlage/).value).toBe('hp1'))
  // Ohne Änderung schließt Esc sofort
  screen.getByLabelText(/Beschreibung/).focus()
  press('Escape')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Kostenposition bearbeiten' }))
  await waitFor(() => expect(select(/^Heizanlage/).value).toBe('hp1'))
  fireEvent.change(select(/^Heizanlage/), { target: { value: 'hp2' } })
  screen.getByLabelText(/Beschreibung/).focus()
  press('Escape')
  expect(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeTruthy()
})

// Durchsicht M2: Im Kostenformular erreicht Tab jedes Feld, auch hinter „Weitere Angaben“, und den Knopf
// zum Anlegen. Ein eigener Tab-Ring sperrte die Tastatur vor dem geschlossenen <details> ein.
test('Seitenfenster: Tab erreicht im Kostenformular Umlageschlüssel, Beleg, „Weitere Angaben“ und „Hinzufügen“', async () => {
  render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition manuell erfassen/i }))
  const drawer = await screen.findByRole('dialog', { name: 'Neue Kostenposition' })
  const reached = new Set<Element>()
  for (let i = 0; i < tabbables().length + 2; i++) {
    const before = document.activeElement
    const prevented = !fireEvent.keyDown(before as Element, { key: 'Tab' })
    expect(prevented, 'das Fenster lenkt Tab nicht selbst').toBe(false)
    press('Tab')
    if (document.activeElement) reached.add(document.activeElement)
  }
  const names = [...reached].map((el) => el.textContent?.trim() || el.getAttribute('aria-label') || (el.closest('label')?.textContent ?? '').trim().slice(0, 20))
  expect(reached.has(select(/Umlageschlüssel/i))).toBe(true)
  expect(names.some((n) => /^Hinzufügen$/.test(n))).toBe(true)
  expect(names.some((n) => /Weitere Angaben/.test(n))).toBe(true)
  expect([...reached].some((el) => el instanceof HTMLInputElement && el.type === 'file')).toBe(true)
  expect([...reached].every((el) => drawer.contains(el))).toBe(true)
})

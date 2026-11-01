// @vitest-environment jsdom
// Komponententest der Kosten-Seite. Er prüft die eine Eigenschaft, die reine Logiktests
// nicht sehen können: dass der angezeigte Wert eines Auswahlfelds und der gespeicherte Wert
// übereinstimmen. Genau diese Lücke war Issue #6 — das Feld zeigte „Sonstig", gespeichert
// wurde „Kaltwasser".
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Meter, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import { press, tabbables } from '../testing/keys'
import Kosten from './Kosten'
import { LAW_AS_OF, valueAt } from '../../../shared/law/register.ts'
import { estgShortPeriodDays } from '../../../shared/law/estg.ts'

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
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition anlegen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition anlegen/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
    await waitFor(() => expect(screen.getByText(/bitte einen Zählertyp wählen/i)).toBeTruthy())
    expect(sent).toHaveLength(0)
    fireEvent.change(typeSelect, { target: { value: 'waerme' } })
    fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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

  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition anlegen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition anlegen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Heizung laut Techem' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '800,00' } })
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'amounts' } })
  expect(select(/Umlageschlüssel/i).value).toBe('amounts')
  fireEvent.change(screen.getByLabelText(/^Meier \(OG links\)$/), { target: { value: '312,40' } })
  expect(screen.getByText(/487,60 € trägt der Vermieter/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ key: 'amounts', tenancyAmounts: { t1: 31240 }, externalBasis: null })
})

test('Gutschrift (#139): der Hinweis am Betragsfeld steht da, und „−54,00“ wird gespeichert', async () => {
  await openForm()
  expect(screen.getByText(/Gutschrift mit Minus/i)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '−54,00' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  // #478 (E2, E4): die übliche Spanne wie am Server, Beginn − 1 bis Ende + 3.
  expect([...jahr.options].map((o) => o.value).filter(Boolean)).toEqual([Number(beginn) - 1, Number(beginn), Number(ende), Number(ende) + 1, Number(ende) + 2, Number(ende) + 3].map(String))
  expect(screen.getByText(/in Abschlägen über zwei Kalenderjahre bezahlt/)).toBeTruthy()
  // #312 PR 3 (K3): die Zahl der Tage aus dem Rechtsregister.
  expect(screen.getByText(new RegExp(`der um den\\s+Jahreswechsel \\(bis ${valueAt(estgShortPeriodDays, LAW_AS_OF)} Tage davor oder danach\\) fällig ist und in dieser Zeit gezahlt wird, zählt zu dem Jahr, zu dem er gehört`))).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  expect(await screen.findByText(/Bitte geben Sie das Jahr der Zahlung an/)).toBeTruthy()
  expect(sent).toHaveLength(0)
  fireEvent.change(jahr, { target: { value: ende } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  const alert = await screen.findByRole('alert')
  expect(within(alert).getByRole('link', { name: /gespeicherte Ziel passt nicht/ })).toBeTruthy()
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  await new Promise((r) => setTimeout(r, 50))
  expect(sent).toEqual([])
  fireEvent.change(select(/^Ziel(?: \(beim Mieterwechsel\))?$/), { target: { value: 'heating' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ heatingTarget: 'heating' })
})

// Heizung PR 19 (#97): Die Karte „CO₂-Erstattung“ steht nur da, wenn ein Mieter selbst heizt.
test('CO₂-Erstattung: Karte nur bei einem Mieter, der selbst heizt', async () => {
  const mieter = (heatingModel?: 'selfSupply') => [
    { id: 't1', unitId: 'u2', tenantName: 'Meier', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...(heatingModel ? { heatingModel } : {}) },
  ]
  const { unmount } = render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} tenancies={mieter()} /></PropertyProvider></PeriodProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition anlegen/i })).toBeTruthy())
  expect(screen.queryByText(/an Mieter, die selbst heizen/)).toBeNull()
  unmount()
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} tenancies={mieter('selfSupply')} /></PropertyProvider></PeriodProvider>)
  expect(await screen.findByText(/an Mieter, die selbst heizen/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '+ Erstattung anlegen' })).toBeTruthy()
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
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition anlegen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition anlegen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Versicherung' } })
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '600,00' } })
  const paid = screen.getByLabelText('Bezahlt am (für die Steuer)') as HTMLInputElement
  fireEvent.change(paid, { target: { value: `${year + 1}-02-10` } })
  expect(paid.value).toBe(`${year + 1}-02-10`)
  expect(screen.getByRole('status').textContent).toContain(`zu ${year + 1} statt zu ${year}`)
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Steuerjahr ändert sich' })).getByRole('button', { name: 'Abbrechen' }))
  await new Promise((r) => setTimeout(r, 20))
  expect(sent).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Steuerjahr ändert sich' })).getByRole('button', { name: 'So speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ paidOn: `${year + 1}-02-10`, confirmPaidOn: true })
})

// #96 PR 1 (A3, R-B): Eine datierte Position auf „Entnahme Erhaltungsrücklage“ umgestellt behält ihr Steuerjahr. Das
// Auswahlfeld zeigt die neue Kostenart und das übertragene Jahr, und gespeichert wird genau das, ohne Datum.
test('Entnahme Erhaltungsrücklage: Datum wird zum Jahr der Zahlung, angezeigt wie gespeichert', async () => {
  const year = new Date().getFullYear() - 1
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Nicht umlagefähig' } })
  fireEvent.change(screen.getByLabelText('Bezahlt am (für die Steuer)'), { target: { value: `${year + 1}-02-10` } })
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Entnahme Erhaltungsrücklage' } })
  expect(select(/Kostenart/i).value).toBe('Entnahme Erhaltungsrücklage')
  expect(select(/Kostenart/i).selectedOptions[0]?.textContent).toBe('Entnahme Erhaltungsrücklage')
  expect(screen.queryByLabelText('Bezahlt am (für die Steuer)')).toBeNull()
  const jahr = select(/Jahr, in dem die Gemeinschaft bezahlt hat/)
  expect(jahr.value).toBe(String(year + 1))
  expect(jahr.selectedOptions[0]?.textContent).toBe(String(year + 1))
  expect(screen.getByText(new RegExp(`die Position bleibt für die Steuer im Jahr ${year + 1}`))).toBeTruthy()
  // Die Zuordnung für die Steuer wie bei „Nicht umlagefähig“.
  expect(select(/Betrifft \(für die Steuer\)/i).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ category: 'Entnahme Erhaltungsrücklage', taxYear: year + 1, paidOn: null })
})

// Durchsicht #96 PR 1, M1: Nach dem Zurückstellen von der Entnahme bleibt ein gewähltes Jahr sichtbar und wird gespeichert,
// wie es zu sehen ist; ebenso nach Entnahme mit übertragenem Jahr, Zurückstellen und Löschen des Datums.
test('Entnahme zurückgestellt: das gewählte Jahr bleibt sichtbar und wird so gespeichert (Durchsicht M1)', async () => {
  const year = new Date().getFullYear() - 1
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Entnahme Erhaltungsrücklage' } })
  fireEvent.change(select(/Jahr, in dem die Gemeinschaft bezahlt hat/), { target: { value: String(year + 1) } })
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Nicht umlagefähig' } })
  const jahr = select(/Jahr der Zahlung \(Steuer\)/)
  expect([jahr.value, jahr.selectedOptions[0]?.textContent]).toEqual([String(year + 1), String(year + 1)])
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ category: 'Nicht umlagefähig', taxYear: year + 1 })
})

test('Datum, Entnahme, zurück, Datum gelöscht: das übertragene Jahr bleibt sichtbar (Durchsicht M1)', async () => {
  const year = new Date().getFullYear() - 1
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Nicht umlagefähig' } })
  fireEvent.change(screen.getByLabelText('Bezahlt am (für die Steuer)'), { target: { value: `${year + 1}-02-10` } })
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Entnahme Erhaltungsrücklage' } })
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Nicht umlagefähig' } })
  fireEvent.change(screen.getByLabelText('Bezahlt am (für die Steuer)'), { target: { value: '' } })
  const jahr = select(/Jahr der Zahlung \(Steuer\)/)
  expect(jahr.value).toBe(String(year + 1))
})

// Durchsicht #96 PR 1, S1: Ein übertragenes Jahr außerhalb der üblichen Spanne steht in der Auswahl.
test('Entnahme: ein Datum weit nach dem Zeitraum ergibt ein Jahr, das die Auswahl zeigt (Durchsicht S1)', async () => {
  const year = new Date().getFullYear() - 1
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Nicht umlagefähig' } })
  fireEvent.change(screen.getByLabelText('Bezahlt am (für die Steuer)'), { target: { value: `${year + 5}-03-10` } })
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Entnahme Erhaltungsrücklage' } })
  const jahr = select(/Jahr, in dem die Gemeinschaft bezahlt hat/)
  expect([jahr.value, jahr.selectedOptions[0]?.textContent]).toEqual([String(year + 5), String(year + 5)])
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
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition anlegen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition anlegen/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
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

// #478 (E4): Ein gespeichertes Jahr der Zahlung, das vom Kalenderjahr des Zeitraums abweicht (etwa nach einem Wechsel des
// Abrechnungszeitraums), zeigt das Formular, und das Auswahlfeld zeigt genau den gespeicherten Wert, auch außerhalb der
// üblichen Spanne. Stünde er nicht in den Optionen, zeigte der Browser den ersten Eintrag und speicherte ihn (CLAUDE.md).
test('Jahr der Zahlung: das Auswahlfeld zeigt das gespeicherte Jahr, auch im Kalenderzeitraum und außerhalb der Spanne', async () => {
  const year = new Date().getFullYear() - 1
  for (const stored of [year + 1, year + 7]) {
    costItems = [{ id: 'g1', propertyId: 'objekt-1', period: calendarPeriod(year), category: 'Gartenpflege', description: 'Gartenpflege', amountCents: 22766, key: 'area', taxYear: stored }]
    render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></PeriodProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
    const field = await waitFor(() => select(/Jahr der Zahlung \(Steuer\)/))
    expect(field.value).toBe(String(stored))
    expect(field.selectedOptions[0]?.textContent).toBe(String(stored))
    // Der Leerwert heißt im Kalenderzeitraum „wie Abrechnungsjahr“.
    expect([...field.options].map((o) => o.textContent)[0]).toBe(`wie Abrechnungsjahr (${year})`)
    // Unverändert gespeichert geht das Jahr so hinaus, ohne Rückfrage.
    fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.body).toMatchObject({ taxYear: stored })
    expect(sent[0]?.body.confirmTaxYear).toBeUndefined()
    cleanup()
    sent = []
  }
})

// #478 (E2): Antwortet der Server mit seiner Rückfrage zum Jahr der Zahlung (409 `question: 'taxYear'`, etwa weil sich
// der Bestand seit dem Laden geändert hat), wird sie zur Rückfrage der Seite; bestätigt geht derselbe Rumpf mit
// `confirmTaxYear` noch einmal hinaus.
test('Jahr der Zahlung: Rückfrage des Servers, gespeichert mit Bestätigung', async () => {
  const year = new Date().getFullYear() - 1
  costItems = [{ id: 'g1', propertyId: 'objekt-1', period: calendarPeriod(year), category: 'Gartenpflege', description: 'Gartenpflege', amountCents: 22766, key: 'area', taxYear: year + 1 }]
  const question = `Als Jahr der Zahlung ist ${year + 3} angegeben; das liegt außerhalb der üblichen Spanne.`
  const answer = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, method, body })
      return body.confirmTaxYear === true ? answer({ ok: true }, 200) : answer({ error: question, question: 'taxYear' }, 409)
    }
    const path = url.split('?')[0]
    return answer(path === '/api/costItems' ? costItems : path === '/api/properties' ? [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '' }] : [], 200)
  })
  render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
  const field = await waitFor(() => select(/Jahr der Zahlung \(Steuer\)/))
  fireEvent.change(field, { target: { value: String(year + 3) } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Steuerjahr ändert sich' })
  expect(dialog.textContent).toContain(question)
  fireEvent.click(within(dialog).getByRole('button', { name: 'So speichern' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]?.body).toMatchObject({ taxYear: year + 3, confirmTaxYear: true })
})

// Durchsicht M2: Im Kostenformular erreicht Tab jedes Feld, auch hinter „Weitere Angaben“, und den Knopf
// zum Anlegen. Ein eigener Tab-Ring sperrte die Tastatur vor dem geschlossenen <details> ein.
test('Seitenfenster: Tab erreicht im Kostenformular Umlageschlüssel, Beleg, „Weitere Angaben“ und „Anlegen“', async () => {
  render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition anlegen/i }))
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
  expect(names.some((n) => /^Anlegen$/.test(n))).toBe(true)
  expect(names.some((n) => /Weitere Angaben/.test(n))).toBe(true)
  expect([...reached].some((el) => el instanceof HTMLInputElement && el.type === 'file')).toBe(true)
  expect([...reached].every((el) => drawer.contains(el))).toBe(true)
})

// CI zu #364: Kam die Liste der Kostenpositionen erst nach der Wahl der Anlage an (das zweite Laden, sobald das
// Objekt bekannt ist), setzte sie die Wahl still auf „automatisch“ zurück. Hier wird die Antwort festgehalten,
// bis gewählt ist, statt auf den Zufall der Reihenfolge zu warten.
test('Zwei Heizanlagen: eine spät ankommende Liste der Positionen setzt die gewählte Anlage nicht zurück', async () => {
  const anlage = (id: string, name: string) => ({
    id, propertyId: 'objekt-1', name, energy: 'gas', supply: 'central', method: 'manual', separateSettlement: null,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: [{ unitId: 'u2', heatedAreaM2: null }, { unitId: 'u3', heatedAreaM2: null }], newDevicesInstall: null,
    nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null,
  })
  plants = [anlage('hp1', 'Ölkessel'), anlage('hp2', 'Gastherme')]
  const inner = fetch
  const held: (() => void)[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET' && url.startsWith('/api/costItems?')) return new Promise<Response>((resolve) => held.push(() => resolve(inner(url, init))))
    return inner(url, init)
  })
  await openForm()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Heizung und Warmwasser' } })
  const wahl = await waitFor(() => select(/^Heizanlage(?!n)/))
  fireEvent.change(wahl, { target: { value: 'hp2' } })
  expect(held.length).toBeGreaterThan(0)
  await act(async () => { for (const release of held) release() })
  await act(async () => {})
  expect(select(/^Heizanlage(?!n)/).value).toBe('hp2')
})

// ---------- Nicht im Mietvertrag vereinbart (#258) ----------

const UNITS_258: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG links', areaM2: 60, participates: true },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG rechts', areaM2: 60, participates: true },
]
const mieter258 = (unitIds = ['u1', 'u2']) => [
  { id: 't1', unitId: 'u1', tenantName: 'Anna Becker', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
  { id: 't2', unitId: 'u2', tenantName: 'Jonas Hartmann', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
].filter((t) => unitIds.includes(t.unitId))
const open258 = async (units = UNITS_258) => {
  render(<PeriodProvider><PropertyProvider><Kosten units={units} settings={null} tenancies={mieter258(units.map((u) => u.id))} /></PropertyProvider></PeriodProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition anlegen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition anlegen/i }))
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Aufzug' } })
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Aufzug' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '100,00' } })
}
const unitBox = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

test('#258: Abwählen von EG links fragt warum; „Steht nicht im Mietvertrag“ hakt sie wieder an und speichert den Mieter', async () => {
  await open258()
  expect(screen.queryByText(/Warum trägt/)).toBeNull()
  fireEvent.click(unitBox('EG links'))
  expect(screen.getByText('Warum trägt EG links diese Kosten nicht?')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('Steht nicht im Mietvertrag von Anna Becker. Den Anteil trägt der Vermieter.'))
  expect(unitBox('EG links').checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ notAgreedTenancyIds: ['t1'], namedTenancyIds: null })
})

test('#258: „Anlegen“ ohne Antwort meldet am Feld und in der Sammelmeldung', async () => {
  await open258()
  fireEvent.click(unitBox('EG links'))
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(screen.getByText('Bitte wählen Sie, warum')).toBeTruthy())
  expect(screen.getByRole('link', { name: /Teilnehmer: Bitte wählen Sie bei EG links, warum sie diese Kosten nicht trägt\./ })).toBeTruthy()
  expect(sent).toHaveLength(0)
  // Die Antwort nimmt die Meldung am Feld weg.
  fireEvent.click(screen.getByLabelText(/^Betrifft die Wohnung nicht/))
  expect(screen.queryByText('Bitte wählen Sie, warum')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ participantUnitIds: ['u2'], notAgreedTenancyIds: null })
})

test('#258: vermietete Eigentumswohnung ohne Teilnehmerliste: der Textlink setzt den Mieter', async () => {
  await open258([UNITS_258[0]])
  expect(screen.queryByText(/Weitere Optionen: nur bestimmte Wohnungen/)).toBeNull()
  fireEvent.click(screen.getByText('Ein Mieter trägt das laut Mietvertrag nicht …'))
  fireEvent.click(screen.getByLabelText(/Anna Becker \(EG links\)/))
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ notAgreedTenancyIds: ['t1'] })
})

test('#258: Sonstige Betriebskosten: je Mieter „Ja“/„Nein“, „Ja“ speichert „im Vertrag genannt“', async () => {
  await open258()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Sonstige Betriebskosten' } })
  expect(screen.getByText('Gehört die Position eigentlich zu einer anderen Kostenart, wählen Sie diese oben.')).toBeTruthy()
  fireEvent.click(within(screen.getByRole('group', { name: /Anna Becker/ })).getByLabelText('Ja'))
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ namedTenancyIds: ['t1'], notAgreedTenancyIds: null })
})

test('#258: Heizung und Warmwasser: kein Textlink, beim Abwählen der Satz zur Heizkostenverordnung', async () => {
  await open258()
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Heizung und Warmwasser' } })
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'area' } })
  expect(screen.queryByText(/Ein Mieter trägt das laut Mietvertrag nicht/)).toBeNull()
  fireEvent.click(unitBox('EG links'))
  expect(screen.getByText(/Die Heizkostenverordnung gilt auch, wenn der Mietvertrag die Heizkosten nicht nennt/)).toBeTruthy()
  expect(screen.queryByLabelText(/Steht nicht im Mietvertrag/)).toBeNull()
  expect(screen.queryByRole('radio')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ participantUnitIds: ['u2'], notAgreedTenancyIds: null })
})

test('#258: zwei Mietverhältnisse in EG links: beide anhaken, beide tragen nicht; ohne Häkchen meldet „Anlegen“', async () => {
  const y = new Date().getFullYear() - 1
  const tenancies = [
    { id: 't1', unitId: 'u1', tenantName: 'Anna Becker', persons: 1, personHistory: [], start: '2020-01-01', end: `${y}-06-30`, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
    { id: 't3', unitId: 'u1', tenantName: 'Lea Schneider', persons: 1, personHistory: [], start: `${y}-07-01`, end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
    ...mieter258(['u2']),
  ]
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS_258} settings={null} tenancies={tenancies} /></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition anlegen/i }))
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Aufzug' } })
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Aufzug' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '100,00' } })
  fireEvent.click(unitBox('EG links'))
  fireEvent.click(screen.getByRole('radio', { name: /Steht nicht im Mietvertrag von:/ }))
  expect(unitBox('EG links').checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(screen.getByText('Bitte haken Sie an, wer nicht trägt')).toBeTruthy())
  expect(sent).toHaveLength(0)
  const group = screen.getByRole('group', { name: /im Mietvertrag von/ })
  fireEvent.click(within(group).getByLabelText('Anna Becker'))
  fireEvent.click(within(group).getByLabelText('Lea Schneider'))
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ notAgreedTenancyIds: ['t1', 't3'] })
})

test('#258: Wahl ohne Häkchen, dann anderer Umlageschlüssel: „Anlegen“ speichert', async () => {
  const y = new Date().getFullYear() - 1
  const tenancies = [
    { id: 't1', unitId: 'u1', tenantName: 'Anna Becker', persons: 1, personHistory: [], start: '2020-01-01', end: `${y}-06-30`, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
    { id: 't3', unitId: 'u1', tenantName: 'Lea Schneider', persons: 1, personHistory: [], start: `${y}-07-01`, end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
    ...mieter258(['u2']),
  ]
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS_258} settings={null} tenancies={tenancies} /></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition anlegen/i }))
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Aufzug' } })
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Aufzug' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '100,00' } })
  fireEvent.click(unitBox('EG links'))
  fireEvent.click(screen.getByRole('radio', { name: /Steht nicht im Mietvertrag von:/ }))
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'units' } })
  fireEvent.change(select(/Umlageschlüssel/i), { target: { value: 'area' } })
  // Auch nach dem Zurückwechseln steht keine alte Wahl mehr da.
  expect(screen.queryByRole('radio', { name: /Steht nicht im Mietvertrag von:/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(screen.queryByText('Bitte haken Sie an, wer nicht trägt')).toBeNull()
})

test('#258: die Meldung bleibt am Feld, solange eine zweite Wohnung noch offen ist', async () => {
  const units: Unit[] = [...UNITS_258, { id: 'u4', propertyId: 'objekt-1', name: 'DG', areaM2: 40, participates: true }]
  const tenancies = [...mieter258(), { id: 't4', unitId: 'u4', tenantName: 'Ole Wagner', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]
  render(<PeriodProvider><PropertyProvider><Kosten units={units} settings={null} tenancies={tenancies} /></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition anlegen/i }))
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Aufzug' } })
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Aufzug' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '100,00' } })
  fireEvent.click(unitBox('EG links'))
  fireEvent.click(unitBox('DG'))
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  // An jeder offenen Frage die Meldung
  await waitFor(() => expect(screen.getAllByText('Bitte wählen Sie, warum')).toHaveLength(2))
  fireEvent.click(within(screen.getByRole('group', { name: 'Warum trägt EG links diese Kosten nicht?' })).getByLabelText(/^Betrifft die Wohnung nicht/))
  expect(screen.getAllByText('Bitte wählen Sie, warum')).toHaveLength(1)
  fireEvent.click(unitBox('DG'))
  expect(screen.queryByText('Bitte wählen Sie, warum')).toBeNull()
})

test('#258: das Seitenfenster merkt eine Antwort als Änderung (S12b)', async () => {
  costItems = [{ id: 'c9', propertyId: 'objekt-1', period: calendarPeriod(new Date().getFullYear() - 1), category: 'Aufzug', description: 'Aufzug', amountCents: 10000, key: 'area' }]
  render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS_258} settings={null} tenancies={mieter258()} /></UIProvider></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
  fireEvent.click(screen.getByText('Ein Mieter trägt das laut Mietvertrag nicht …'))
  fireEvent.click(screen.getByLabelText(/Anna Becker \(EG links\)/))
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(await screen.findByRole('alertdialog')).toBeTruthy()
})

test('#258: die Liste der Positionen nennt den Mieter, der nicht trägt', async () => {
  costItems = [{ id: 'c8', propertyId: 'objekt-1', period: calendarPeriod(new Date().getFullYear() - 1), category: 'Aufzug', description: 'Aufzug', amountCents: 10000, key: 'area', notAgreedTenancyIds: ['t1'] }]
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS_258} settings={null} tenancies={mieter258()} /></PropertyProvider></PeriodProvider>)
  expect(await screen.findByText('trägt nicht: Anna Becker (Vertrag)')).toBeTruthy()
})

test('#455: Die Zeile eines Teils nennt die Zahl der Teile und die ganze Rechnung, über die Zeiträume hinweg', async () => {
  const jahr = new Date().getFullYear() - 1
  costItems = [
    { id: 't1', propertyId: 'objekt-1', period: calendarPeriod(jahr), category: 'Grundsteuer', description: 'Grundsteuer (anteilig)', amountCents: 12000, key: 'area', sourceId: 'q1' },
    { id: 't2', propertyId: 'objekt-1', period: calendarPeriod(jahr + 1), category: 'Grundsteuer', description: 'Grundsteuer (anteilig)', amountCents: 24500, key: 'area', sourceId: 'q1' },
    { id: 'c1', propertyId: 'objekt-1', period: calendarPeriod(jahr), category: 'Aufzug', description: 'Wartung Aufzug', amountCents: 10000, key: 'area' },
  ]
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} /></PropertyProvider></PeriodProvider>)
  const zeile = (await screen.findByText('Grundsteuer (anteilig)')).closest('tr') ?? expect.fail('keine Zeile')
  expect(zeile.textContent?.replace(/ /g, ' ')).toContain('Teil von 2 · Rechnung gesamt 365,00 €')
  // Eine Position ohne Quelle trägt nichts davon
  const aufzug = screen.getByText('Wartung Aufzug').closest('tr') ?? expect.fail('keine Zeile')
  expect(aufzug.textContent).not.toContain('Teil von')
})

// ---------- #262 PR 3: Verteilung nach § 82b EStDV (Entwurf E-9) ----------

const SPREAD_LABEL = /Für die Steuer verteilen \(§ 82b EStDV\)/
const verteilteDach = (year: number, over: Record<string, unknown> = {}) => ({
  id: 'd1', propertyId: 'objekt-1', period: calendarPeriod(year), category: 'Nicht umlagefähig', description: 'Dachsanierung', amountCents: 1_000_000, key: 'area', spreadYears: 3, ...over,
})
const renderStored = async () => {
  render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }))
}

test('Verteilung: das Feld nur, wo verteilt werden kann; angelegt ohne Rückfrage, mit Vorschau der Jahre', async () => {
  const year = new Date().getFullYear() - 1
  await openForm()
  expect(screen.queryByLabelText(SPREAD_LABEL)).toBeNull()
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '10.000,00' } })
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Nicht umlagefähig' } })
  const field = select(SPREAD_LABEL)
  expect([...field.options].map((o) => o.textContent)).toEqual(['nicht verteilen', 'auf 2 Jahre', 'auf 3 Jahre', 'auf 4 Jahre', 'auf 5 Jahre'])
  expect(field.value).toBe('')
  fireEvent.change(field, { target: { value: '3' } })
  expect(field.selectedOptions[0]?.textContent).toBe('auf 3 Jahre')
  expect(screen.getByText(new RegExp(`Abzug ${year} bis ${year + 2}:`))).toBeTruthy()
  // Nachtrag: sichtbar bleibt nur die Vorschau; Voraussetzungen, Verwaltung und Zinsen, anschaffungsnahe Herstellungskosten
  // stehen eingeklappt unter „Mehr dazu“ (S33).
  const zinsen = screen.getByText(/Verwaltungskosten und Zinsen/)
  expect(zinsen.closest('[hidden]')).not.toBeNull()
  expect(screen.getByText(/anschaffungsnahen Herstellungskosten/).closest('[hidden]')).not.toBeNull()
  const mehr = screen.getByRole('button', { name: 'Mehr dazu' })
  expect(mehr.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(mehr)
  expect(zinsen.closest('[hidden]')).toBeNull()
  expect(screen.getByRole('button', { name: 'Weniger' }).getAttribute('aria-controls')).toBe(zinsen.closest('[id]')?.id)
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ category: 'Nicht umlagefähig', spreadYears: 3 })
  expect(sent[0]?.body.confirmSpread).toBeUndefined()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('Verteilung: angezeigt wie gespeichert; unverändert gespeichert ohne Rückfrage', async () => {
  const year = new Date().getFullYear() - 1
  costItems = [verteilteDach(year)]
  await renderStored()
  const field = await waitFor(() => select(SPREAD_LABEL))
  expect([field.value, field.selectedOptions[0]?.textContent]).toEqual(['3', 'auf 3 Jahre'])
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ spreadYears: 3 })
  expect(sent[0]?.body.confirmSpread).toBeUndefined()
})

test('Verteilung leeren: Rückfrage mit den entfallenden Anteilen, bestätigt mit confirmSpread', async () => {
  const year = new Date().getFullYear() - 1
  costItems = [verteilteDach(year)]
  await renderStored()
  fireEvent.change(await waitFor(() => select(SPREAD_LABEL)), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Verteilung für die Steuer ändert sich' })
  expect(dialog.textContent).toContain(`die Anteile ${year + 1} bis ${year + 2} entfallen`)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await new Promise((r) => setTimeout(r, 20))
  expect(sent).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Verteilung für die Steuer ändert sich' })).getByRole('button', { name: 'So speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ spreadYears: null, confirmSpread: true })
})

test('Kostenart auf umlagefähig: Feld weg, der Satz sagt es, gespeichert wird `null` mit Rückfrage statt einer Ablehnung', async () => {
  const year = new Date().getFullYear() - 1
  costItems = [verteilteDach(year)]
  await renderStored()
  await waitFor(() => select(SPREAD_LABEL))
  fireEvent.change(select(/Kostenart/i), { target: { value: 'Gartenpflege' } })
  expect(screen.queryByLabelText(SPREAD_LABEL)).toBeNull()
  expect(screen.getByText(/Die Verteilung auf 3 Jahre entfällt: Die Kostenart „Gartenpflege“ lässt sich für die Steuer nicht verteilen/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Verteilung für die Steuer ändert sich' })).getByRole('button', { name: 'So speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ category: 'Gartenpflege', spreadYears: null, confirmSpread: true })
  // Zurück auf „Nicht umlagefähig“ steht die Auswahl leer da: Die Wahl ist geleert, nicht nur versteckt.
})

test('Verteilung: eine Rückfrage des Servers (409 `spread`) wird zur Rückfrage der Seite, wiederholt mit confirmSpread', async () => {
  const year = new Date().getFullYear() - 1
  costItems = [verteilteDach(year, { sourceId: 'q1' })]
  const question = 'Die Wahl gilt für die ganze Rechnung und wird auch an den übrigen Teilen gespeichert.'
  const answer = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, method, body })
      return body.confirmSpread === true && sent.length > 1 ? answer({ ok: true }, 200) : answer({ error: question, question: 'spread' }, 409)
    }
    const path = url.split('?')[0]
    return answer(path === '/api/costItems' ? costItems : path === '/api/properties' ? [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '' }] : [], 200)
  })
  await renderStored()
  fireEvent.change(await screen.findByLabelText(/Beschreibung/i), { target: { value: 'Dachsanierung neu' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Verteilung für die Steuer ändert sich' })
  expect(dialog.textContent).toContain(question)
  fireEvent.click(within(dialog).getByRole('button', { name: 'So speichern' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]?.body).toMatchObject({ spreadYears: 3, confirmSpread: true, confirmPaidOn: true, confirmTaxYear: true })
})

test('Löschen einer verteilten Position: die Rückfrage nennt die entfallenden Anteile', async () => {
  const year = new Date().getFullYear() - 1
  costItems = [verteilteDach(year)]
  render(<PeriodProvider><PropertyProvider><UIProvider><Kosten units={UNITS} settings={null} /></UIProvider></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition löschen/ }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Kostenposition löschen?' })
  expect(dialog.textContent).toContain(`Die Anteile ${year + 1} bis ${year + 2} entfallen damit.`)
})

// Durchsicht von #262 PR 3 (Testlücke): Eine gespeicherte verteilte Position, beim Bearbeiten über zwei Abrechnungszeiträume
// aufgeteilt. Die Teile tragen die Wahl (`spreadYears` im Rumpf); fragt der Server beim Aufteilen nach (409 `spread`), wird
// das zur Rückfrage der Seite, und die Teile gehen einmal mit `confirmSpread` hinaus.
test('Verteilung beim Aufteilen einer gespeicherten Position: Wahl im Rumpf, Rückfrage des Servers, einmal mit confirmSpread', async () => {
  const year = new Date().getFullYear() - 1
  // Mit Datum der Zahlung, sonst begännen die Teile ihre Verteilung in zwei Jahren (Integrationsdurchsicht 0.14, S1; unten).
  costItems = [{ ...verteilteDach(year), paidOn: `${year + 1}-07-15` }]
  const question = `Die Verteilung beginnt dann ${year} statt ${year}.`
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, method, body })
      if (url.includes('/split/preview')) {
        return json({ parts: [
          { period: `${year}-01`, label: String(year), days: 184, amountCents: 504110, labor35aCents: null, description: 'Dachsanierung', needsTaxYear: false, closed: false, startYear: year, endYear: year },
          { period: `${year + 1}-01`, label: String(year + 1), days: 181, amountCents: 495890, labor35aCents: null, description: 'Dachsanierung', needsTaxYear: false, closed: false, startYear: year + 1, endYear: year + 1 },
        ] })
      }
      return body.confirmSpread === true ? json([]) : json({ error: question, question: 'spread' }, 409)
    }
    const path = url.split('?')[0]
    return json(path === '/api/costItems' ? costItems : path === '/api/properties' ? [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '' }] : [])
  })
  await renderStored()
  fireEvent.change(await screen.findByLabelText(/Leistungszeitraum/), { target: { value: `${year}-07-01` } })
  fireEvent.change(screen.getByLabelText(/^bis$/), { target: { value: `${year + 1}-06-30` } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Rechnung aufteilen?' })).getByRole('button', { name: 'Aufteilen und speichern' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Verteilung für die Steuer ändert sich' })
  expect(dialog.textContent).toContain(question)
  fireEvent.click(within(dialog).getByRole('button', { name: 'So speichern' }))
  const splits = () => sent.filter((r) => r.url.includes('/split') && !r.url.includes('preview'))
  await waitFor(() => expect(splits()).toHaveLength(2))
  expect(splits()[0]?.body).toMatchObject({ spreadYears: 3 })
  expect(splits()[1]?.body).toMatchObject({ spreadYears: 3, confirmSpread: true })
})

// Integrationsdurchsicht 0.14 (S1): Ohne Datum der Zahlung flössen die Teile in zwei Jahren ab; das Formular sagt es vor
// der Rückfrage zum Aufteilen, mit dem Satz des Servers, und schickt nichts.
test('Verteilung beim Aufteilen ohne Datum der Zahlung, Teile in zwei Kalenderjahren: Satz statt Rückfrage, nichts gesendet', async () => {
  const year = new Date().getFullYear() - 1
  costItems = [verteilteDach(year)]
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      if (url.includes('/split/preview')) {
        return json({ parts: [
          { period: `${year}-01`, label: String(year), days: 184, amountCents: 504110, labor35aCents: null, description: 'Dachsanierung', needsTaxYear: false, closed: false, startYear: year, endYear: year },
          { period: `${year + 1}-01`, label: String(year + 1), days: 181, amountCents: 495890, labor35aCents: null, description: 'Dachsanierung', needsTaxYear: false, closed: false, startYear: year + 1, endYear: year + 1 },
        ] })
      }
      return json([])
    }
    const path = url.split('?')[0]
    return json(path === '/api/costItems' ? costItems : path === '/api/properties' ? [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '' }] : [])
  })
  await renderStored()
  fireEvent.change(await screen.findByLabelText(/Leistungszeitraum/), { target: { value: `${year}-07-01` } })
  fireEvent.change(screen.getByLabelText(/^bis$/), { target: { value: `${year + 1}-06-30` } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  expect(await screen.findByText(/Bitte tragen Sie das Datum der Zahlung ein/)).toBeTruthy()
  expect(screen.queryByRole('alertdialog', { name: 'Rechnung aufteilen?' })).toBeNull()
  expect(sent.filter((r) => r.url.includes('/split') && !r.url.includes('preview'))).toHaveLength(0)
})

// @vitest-environment jsdom
// Stammdaten aus der Browser-Abnahme (#142): Was die Listen zeigen und was die Löschfrage sagt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Meter, PropertyKind, Tenancy, Unit, UnitDependents } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Stammdaten from './Stammdaten'
import { tenancyStamp } from '../../../shared/tenancyStamp.ts'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true, mea: 124 },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true },
]
const tenancy = (id: string, tenantName: string, patch: Partial<Tenancy> = {}): Tenancy => ({
  id, unitId: 'u1', tenantName, persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...patch,
})
const DEPS: UnitDependents = { tenancies: 2, meters: 1, readings: 4, payments: 12, costItemLinks: 0, directCostItems: 0, fuelDeliveries: 0 }

let kind: PropertyKind = 'mfh'
let propertyIban: string | null = null
let meters: Meter[] = []
let sent: { url: string; method: string; body: Record<string, unknown> }[] = []
let plants: unknown[] = []
// Antworten auf POST/PUT je Pfad (Laienprobe B1); sonst `{ ok: true }`.
let answers: Record<string, unknown> = {}

beforeEach(() => {
  kind = 'mfh'
  propertyIban = null
  meters = []
  sent = []
  plants = []
  answers = {}
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') {
      sent.push({ url, method: init?.method ?? '', body: JSON.parse(String(init?.body ?? '{}')) })
      return json(path in answers ? answers[path] : { ok: true })
    }
    if (path === '/api/meters') return json(meters)
    if (path === '/api/heating-plants') return json(plants)
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind, address: '', landlordName: null, iban: propertyIban, paymentDeadlineDays: null }])
    if (path === '/api/units/u1/dependents') return json(DEPS)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = (tenancies: Tenancy[] = []) =>
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={UNITS} tenancies={tenancies} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )

const rowOf = (text: string) => {
  const row = screen.getByText(text).closest('tr')
  if (!row) throw new Error(`keine Zeile für ${text}`)
  return within(row)
}

test('Mietverhältnisse: Pauschale und Inklusivmiete stehen in der Liste, die Abrechnung nicht', async () => {
  page([
    tenancy('t1', 'Abgerechnet'),
    tenancy('t2', 'Pauschal', { costModel: 'flatRate', heatingModel: 'flatRate' }),
    tenancy('t3', 'Inklusiv', { costModel: 'inclusive', heatingModel: 'inclusive' }),
    tenancy('t4', 'Gemischt', { costModel: 'flatRate' }),
  ])
  await screen.findByText('Pauschal', undefined, SLOW)
  expect(rowOf('Pauschal').getByText('Pauschale')).toBeTruthy()
  expect(rowOf('Inklusiv').getByText('inklusiv')).toBeTruthy()
  expect(rowOf('Gemischt').getByText('kalt pauschal · Heizung abgerechnet')).toBeTruthy()
  expect(rowOf('Abgerechnet').queryByText(/pauschal|inklusiv/i)).toBeNull()
})

test('Wohnungen: die Miteigentumsanteile stehen in der Liste, sobald eine Wohnung welche hat', async () => {
  page()
  await screen.findByText('EG', undefined, SLOW)
  expect(screen.getByRole('columnheader', { name: /MEA/ })).toBeTruthy()
  expect(rowOf('EG').getByText('124')).toBeTruthy()
  expect(rowOf('OG').getByText('—')).toBeTruthy()
})

test('Wohnungen: ohne Miteigentumsanteile und außerhalb einer Eigentumswohnung keine Spalte dafür', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={UNITS.map(({ mea: _mea, ...u }) => u)} tenancies={[]} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('EG', undefined, SLOW)
  expect(screen.queryByRole('columnheader', { name: /MEA/ })).toBeNull()
})

test('Wohnung löschen: die Frage nennt, was mitgelöscht wird, mit Anzahl', async () => {
  page([tenancy('t1', 'Müller')])
  const [first] = await screen.findAllByRole('button', { name: /Wohnung löschen/i }, SLOW)
  if (!first) throw new Error('kein Löschknopf')
  fireEvent.click(first)
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  expect(within(dialog).getByText(/2 Mietverhältnisse, 1 Zähler, 4 Ablesungen und 12 Zahlungen/)).toBeTruthy()
})

// #142 (B12): „Kein Anschluss für“ mit Kästchen las sich verkehrt herum. Jetzt positiv: angehakt
// heißt angeschlossen; gespeichert wird weiter nur die Ausnahme.
const meter = (type: Meter['type'], unitId: string | null = 'u2'): Meter => ({ id: `m-${type}`, propertyId: 'objekt-1', name: type, unitId, type, unit: 'm³' })

const openUnit = async (units: Unit[] = UNITS) => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={units} tenancies={[]} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const [first] = await screen.findAllByRole('button', { name: /Wohnung bearbeiten/i }, SLOW)
  if (!first) throw new Error('kein Bearbeiten-Knopf')
  fireEvent.click(first)
  return screen.findByRole('dialog', undefined, SLOW)
}

test('Anschlüsse: ohne Zähler im Objekt und ohne Ausnahme gibt es den Block nicht', async () => {
  const dialog = await openUnit()
  expect(within(dialog).queryByText(/Anschlüsse dieser Einheit/)).toBeNull()
})

test('Anschlüsse: mit einem Kaltwasserzähler nur Kaltwasser, angehakt; Häkchen entfernen speichert die Ausnahme', async () => {
  meters = [meter('kaltwasser')]
  const dialog = await openUnit()
  const box = await within(dialog).findByRole('checkbox', { name: 'Kaltwasser' }, SLOW) as HTMLInputElement
  expect(within(dialog).queryByRole('checkbox', { name: 'Wärme' })).toBeNull()
  expect(within(dialog).queryByRole('checkbox', { name: 'Sonstiges' })).toBeNull()
  expect(box.checked).toBe(true)
  expect(within(dialog).getByText(/Hat eine Einheit keinen Anschluss/)).toBeTruthy()
  fireEvent.click(box)
  expect(box.checked).toBe(false)
  // Die Zusammenfassung des zugeklappten Bereichs macht die Ausnahme sichtbar.
  expect(within(dialog).getByText(/ohne Wasseranschluss/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: /^Übernehmen$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ noConnection: ['kaltwasser'] })
})

test('Anschlüsse: eine gesetzte Ausnahme ohne Zähler dieser Art bleibt sichtbar und lässt sich zurücknehmen', async () => {
  const dialog = await openUnit([{ ...UNITS[0]!, noConnection: ['waerme'] }, UNITS[1]!])
  const box = within(dialog).getByRole('checkbox', { name: 'Wärme' }) as HTMLInputElement
  expect(box.checked).toBe(false)
  expect(within(dialog).getByText(/ohne Wärmeanschluss/)).toBeTruthy()
  fireEvent.click(box)
  expect(box.checked).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: /^Übernehmen$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ noConnection: [] })
})

test('Wohnungsliste: eine Ausnahme steht als Kennzeichen an der Wohnung', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={[UNITS[0]!, { ...UNITS[1]!, noConnection: ['kaltwasser'] }]} tenancies={[]} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('OG', undefined, SLOW)
  expect(rowOf('OG').getByText('ohne Wasseranschluss')).toBeTruthy()
  expect(rowOf('EG').queryByText(/ohne/)).toBeNull()
})

test('Nutzung „Eigennutzung“: der Hilfetext verweist auf den Begriff Einliegerwohnung (#142)', async () => {
  const dialog = await openUnit([{ ...UNITS[0]!, participates: false, selfUsed: true }, UNITS[1]!])
  expect(within(dialog).getByRole('button', { name: 'Einliegerwohnung' })).toBeTruthy()
})

// Breite der Tabelle (#180): Bei 1.280 px war sie 1.234 px breit in einer Karte von 953 px, und
// Mieterwechsel, ✎ und 🗑 lagen nur durch Scrollen im Bild. Die Breite selbst misst jsdom nicht
// (nachgemessen im Browser: 909 von 909 px bei 1.280, 954 von 954 bei 1.440 und 1.920 px). Hier
// steht, was sie ermöglicht: Nichts in der Tabelle verbietet den Umbruch pauschal; zusammen bleibt
// nur, was zusammengehört (die beiden Symbole, ein Betrag, eine Telefonnummer).
test('Mietverhältnisse: die Tabelle darf umbrechen, die Symbole bleiben beisammen', async () => {
  const { container } = page([
    tenancy('t1', 'Staffel', {
      email: 'sehr.lange.adresse@example.org', phone: '0171 1234567', costModel: 'flatRate',
      prepayments: [{ from: '2025-01', monthlyCents: 18000 }, { from: '2025-07', monthlyCents: 21000 }],
    }),
  ])
  await screen.findByText('Staffel', undefined, SLOW)
  const table = container.querySelector('table.tenancy-table')
  if (!table) throw new Error('keine Tabelle der Mietverhältnisse')
  const forced = [...table.querySelectorAll<HTMLElement>('[style]')].filter((e) => e.style.whiteSpace === 'nowrap')
  expect(forced.map((e) => e.outerHTML.slice(0, 80))).toEqual([])
  const icons = rowOf('Staffel').getByLabelText('Mietverhältnis bearbeiten').parentElement
  expect(icons?.classList.contains('nowrap')).toBe(true)
  expect(icons?.contains(rowOf('Staffel').getByLabelText('Mietverhältnis löschen'))).toBe(true)
  expect(rowOf('Staffel').getByText('0171 1234567').classList.contains('nowrap')).toBe(true)
})

test('Mietverhältnis an einer Anlage mit getrennter Heizkostenabrechnung: die Heizvorauszahlung wird abgefragt (Durchsicht von #231)', async () => {
  plants = [{
    id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: true,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [{ from: '2025-05', until: null }], units: null, newDevicesInstall: null,
  }]
  page()
  fireEvent.click(await screen.findByRole('button', { name: /Mietverhältnis hinzufügen/ }, SLOW))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  expect(await within(dialog).findByText(/Heizvorauszahlung je Monat \(neben der übrigen Vorauszahlung\)/, undefined, SLOW)).toBeTruthy()
})

// Laienprobe B1: Ein Formular, das einen älteren Stand kennt, schrieb ihn beim Speichern zurück und
// löschte die eben aufgeteilte Heizvorauszahlung. Zwei Sicherungen: Das Formular schickt die Marke
// des Stands, aus dem es gefüllt wurde (der Server lehnt mit 409 ab, wenn sie nicht mehr stimmt),
// und nach jeder Änderung an der Heizung lädt die Seite Mietverhältnisse und Anlagen neu.
const PLANT_MAI = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
}

test('Laienprobe B1: Speichern schickt die Marke des geladenen Stands mit', async () => {
  const t = tenancy('t1', 'Beispiel', { prepayments: [{ from: '2025-01', monthlyCents: 25000 }] })
  page([t])
  fireEvent.click(await screen.findByRole('button', { name: 'Mietverhältnis bearbeiten' }, SLOW))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  fireEvent.click(within(dialog).getByRole('button', { name: /^Übernehmen$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ ifUnchanged: tenancyStamp(t) })
})

test('Laienprobe B1: nach einer Änderung am Zeitraum der Heizung lädt die Seite die Mietverhältnisse neu', async () => {
  plants = [PLANT_MAI]
  answers = {
    '/api/heating-plants/hp1/period/preview': { rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], effects: [], token: 'w1', moves: [] },
    '/api/heating-plants/hp1/period': PLANT_MAI,
  }
  const reload = vi.fn(async () => {})
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={UNITS} tenancies={[]} settings={null} reload={reload} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const knopf = await screen.findByRole('button', { name: 'Zeitraum der Heizung ändern' }, SLOW)
  const heizung = within(knopf.closest('.heating-period') as HTMLElement)
  fireEvent.click(knopf)
  fireEvent.change(heizung.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'object' } })
  fireEvent.click(heizung.getByRole('button', { name: 'Vorschau' }))
  fireEvent.click(await heizung.findByRole('button', { name: 'Übernehmen' }, SLOW))
  await vi.waitFor(() => expect(reload).toHaveBeenCalled(), SLOW)
})

// Rückmeldung zur Laienprobe: Die Heizvorauszahlung steht in einer eigenen Feldgruppe und nennt den
// Grund samt Anlage; ohne getrennte Abrechnung und ohne eingetragene Heizvorauszahlung fehlt sie.
test('Heizvorauszahlung: eigene Gruppe mit Grund und Anlagenname, sonst gar nicht', async () => {
  plants = [{ ...PLANT_MAI, name: 'Gaskessel Keller', separateSettlement: true, separateSpans: [{ from: '2025-05', until: null }] }]
  page([tenancy('t1', 'Beispiel', { prepayments: [{ from: '2025-01', monthlyCents: 25000 }] })])
  fireEvent.click(await screen.findByRole('button', { name: 'Mietverhältnis bearbeiten' }, SLOW))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  const label = await within(dialog).findByText(/Heizvorauszahlung je Monat/, undefined, SLOW)
  const gruppe = label.closest('.field-group') as HTMLElement
  expect(gruppe).toBeTruthy()
  expect(gruppe.textContent).not.toMatch(/NK-Vorauszahlung je Monat/)
  expect(within(gruppe).getByText(/Erscheint, weil die Heizung „Gaskessel Keller“ die Heizkosten getrennt abrechnet/)).toBeTruthy()
  expect(within(gruppe).getByRole('button', { name: 'getrennte Heizkostenabrechnung' })).toBeTruthy()
  expect(within(gruppe).getByText(/Ändern unter Stammdaten → Heizung/)).toBeTruthy()
})

test('Heizvorauszahlung: ohne getrennte Abrechnung und ohne Eintrag keine Gruppe', async () => {
  plants = [PLANT_MAI]
  page([tenancy('t1', 'Beispiel', { prepayments: [{ from: '2025-01', monthlyCents: 25000 }] })])
  fireEvent.click(await screen.findByRole('button', { name: 'Mietverhältnis bearbeiten' }, SLOW))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  await within(dialog).findByText(/NK-/, undefined, SLOW)
  expect(within(dialog).queryByText(/Heizvorauszahlung je Monat/)).toBeNull()
})

// Heizung PR 19 (Prüfung M1): „Mieter heizt selbst“ gibt es nur bei der Heizung. Die Auswahl zeigt den
// gespeicherten Wert, darunter steht die Hinweispflicht, und Speichern schickt den Wert zurück.
test('Mieter heizt selbst: Auswahl zeigt den gespeicherten Wert, Hinweis nach § 6 Abs. 2 Satz 6, Speichern schickt selfSupply', async () => {
  page([tenancy('t1', 'Selbst', { heatingModel: 'selfSupply', selfSupplyKind: 'central' })])
  expect((await screen.findByText('Heizung selbst', undefined, SLOW))).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: 'Mietverhältnis bearbeiten' }, SLOW))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  const heat = within(dialog).getByRole('combobox', { name: /Heizung und Warmwasser/ })
  if (!(heat instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect(heat.value).toBe('selfSupply')
  expect(heat.selectedOptions[0]?.textContent).toBe('Mieter heizt selbst (eigener Vertrag für Brennstoff oder Wärme)')
  const cold = within(dialog).getByRole('combobox', { name: /Nebenkosten/ })
  if (!(cold instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect([...cold.options].map((o) => o.value)).not.toContain('selfSupply')
  expect(within(dialog).getByText(/§ 6 Abs\. 2 Satz 6 CO2KostAufG/)).toBeTruthy()
  // Durchsicht S-2: welche Heizung, angezeigt wie gespeichert.
  const kind = within(dialog).getByRole('combobox', { name: /Welche Heizung betreibt der Mieter selbst/ })
  if (!(kind instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect(kind.value).toBe('central')
  fireEvent.click(within(dialog).getByRole('button', { name: /^Übernehmen$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ heatingModel: 'selfSupply', selfSupplyKind: 'central', costModel: null })
})

// ---------- IBAN des Mieters (#279) ----------

const ibanField = () => screen.getByLabelText<HTMLInputElement>(/Mieter-IBAN/)
const openTenancy = async (name: string) => {
  await screen.findByText(name, undefined, SLOW)
  fireEvent.click(rowOf(name).getByLabelText('Mietverhältnis bearbeiten'))
  await screen.findByText('Mietverhältnis bearbeiten', undefined, SLOW)
}

test('IBAN: eine neue ungültige steht nach dem Verlassen am Feld und wird nicht gespeichert', async () => {
  page([tenancy('t1', 'Müller')])
  await openTenancy('Müller')
  fireEvent.change(ibanField(), { target: { value: 'DE00 3704 0044 0532 0130 00' } })
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.blur(ibanField())
  expect(screen.getByRole('alert').textContent).toMatch(/Prüfziffer stimmt nicht/)
  expect(ibanField().getAttribute('aria-invalid')).toBe('true')
  fireEvent.click(screen.getByText('Übernehmen'))
  expect(await screen.findByText(/^Die IBAN des Mieters ist nicht gültig\./)).toBeTruthy()
  expect(sent.filter((s) => s.method === 'PUT')).toEqual([])
})

test('IBAN: eine gültige wird in Vierergruppen angezeigt und normiert gespeichert', async () => {
  page([tenancy('t1', 'Müller')])
  await openTenancy('Müller')
  fireEvent.change(ibanField(), { target: { value: 'de89370400440532013000' } })
  fireEvent.blur(ibanField())
  expect(ibanField().value).toBe('DE89 3704 0044 0532 0130 00')
  fireEvent.click(screen.getByText('Übernehmen'))
  await vi.waitFor(() => expect(sent.find((s) => s.method === 'PUT')?.body.iban).toBe('DE89370400440532013000'))
})

test('IBAN: eine gespeicherte ungültige steht als Hinweis da und blockiert das Speichern nicht', async () => {
  page([tenancy('t1', 'Müller', { iban: 'de00 1111' })])
  await openTenancy('Müller')
  expect(ibanField().value).toBe('de00 1111')
  expect(screen.getByText(/^Die gespeicherte IBAN ist vermutlich falsch eingetragen\./)).toBeTruthy()
  fireEvent.blur(ibanField())
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByText('Übernehmen'))
  await vi.waitFor(() => expect(sent.find((s) => s.method === 'PUT')?.body.iban).toBe('de00 1111'))
})

// ---------- Abweichende IBAN des Objekts (#279) ----------

test('Objekt: eine gespeicherte ungültige IBAN steht als Hinweis da und blockiert das Speichern nicht', async () => {
  propertyIban = 'DE00 3333'
  page()
  expect((await screen.findByText(/^Die gespeicherte IBAN ist vermutlich falsch eingetragen\./, undefined, SLOW))).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Adresse'), { target: { value: 'Weg 9' } })
  fireEvent.click(screen.getByText('Speichern'))
  await vi.waitFor(() => expect(sent.find((s) => s.method === 'PUT')?.body).toMatchObject({ iban: 'DE00 3333', address: 'Weg 9' }))
})

test('Objekt: eine neue ungültige IBAN wird nicht gespeichert, eine gültige normiert', async () => {
  propertyIban = 'DE89370400440532013000'
  page()
  const feld = await screen.findByDisplayValue('DE89 3704 0044 0532 0130 00', undefined, SLOW)
  fireEvent.change(feld, { target: { value: 'DE89 3704 0044 0532 0130 01' } })
  fireEvent.blur(feld)
  expect(screen.getByRole('alert').textContent).toMatch(/Prüfziffer/)
  fireEvent.click(screen.getByText('Speichern'))
  expect(await screen.findByText(/^Die abweichende IBAN des Objekts ist nicht gültig\./)).toBeTruthy()
  expect(sent).toEqual([])
  fireEvent.change(feld, { target: { value: 'gb82 west 1234 5698 7654 32' } })
  fireEvent.click(screen.getByText('Speichern'))
  await vi.waitFor(() => expect(sent.find((s) => s.method === 'PUT')?.body.iban).toBe('GB82WEST12345698765432'))
})

test('IBAN: wechselt der Dialog zu einem anderen Mietverhältnis, beginnt das Feld von vorn', async () => {
  page([tenancy('t1', 'Müller'), tenancy('t2', 'Schmidt', { unitId: 'u2' })])
  await openTenancy('Müller')
  fireEvent.change(ibanField(), { target: { value: 'DE00 1' } })
  fireEvent.blur(ibanField())
  expect(screen.getByRole('alert')).toBeTruthy()
  // Ohne den Dialog zu schließen ein anderes Mietverhältnis öffnen, wie es „Hier beheben →“ tut
  fireEvent.click(rowOf('Schmidt').getByLabelText('Mietverhältnis bearbeiten'))
  await screen.findByDisplayValue('Schmidt', undefined, SLOW)
  fireEvent.change(ibanField(), { target: { value: 'DE00 2' } })
  expect(screen.queryByRole('alert')).toBeNull()
})

test('IBAN: ist die gespeicherte ungültig, sind die „Weiteren Angaben“ aufgeklappt, sonst nicht', async () => {
  page([tenancy('t1', 'Müller', { iban: 'de00 1111' }), tenancy('t2', 'Schmidt', { unitId: 'u2', iban: 'DE89370400440532013000' })])
  const details = () => {
    const el = screen.getByText(/^Weitere Angaben — Nebenkosten-Modell/).closest('details')
    if (!el) throw new Error('kein details')
    return el
  }
  await openTenancy('Müller')
  expect(details().open).toBe(true)
  fireEvent.click(screen.getByText('Abbrechen'))
  await openTenancy('Schmidt')
  expect(details().open).toBe(false)
})

// @vitest-environment jsdom
// Stammdaten aus der Browser-Abnahme (#142): Was die Listen zeigen und was die Löschfrage sagt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { CostItem, Meter, PropertyKind, Tenancy, Unit, UnitDependents } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Stammdaten from './Stammdaten'
import { press } from '../testing/keys'
import { tenancyStamp } from '../../../shared/tenancyStamp.ts'
import { periodKey } from '../../../shared/period.ts'

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
// #262 PR 4: die Kosten des Objekts (für das Feld zum Ende der Verteilung) und das gespeicherte Jahr.
let costItems: CostItem[] = []
let spreadRestYear: number | null = null
// Antworten auf PUT der Reihe nach (Durchsicht S4, 409 des Servers), danach die gewöhnliche; und ob die Kosten scheitern (K5).
let putReplies: { status: number; body: unknown }[] = []
let costItemsFail = false

beforeEach(() => {
  kind = 'mfh'
  propertyIban = null
  meters = []
  sent = []
  plants = []
  answers = {}
  costItems = []
  spreadRestYear = null
  putReplies = []
  costItemsFail = false
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') {
      sent.push({ url, method: init?.method ?? '', body: JSON.parse(String(init?.body ?? '{}')) })
      const reply = init?.method === 'PUT' ? putReplies.shift() : undefined
      if (reply) return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
      return json(path in answers ? answers[path] : { ok: true })
    }
    if (path === '/api/meters') return json(meters)
    if (path === '/api/heating-plants') return json(plants)
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind, address: '', landlordName: null, iban: propertyIban, paymentDeadlineDays: null, spreadRestYear }])
    if (path === '/api/costItems') return costItemsFail ? new Response(JSON.stringify({ error: 'kaputt' }), { status: 500, headers: { 'content-type': 'application/json' } }) : json(costItems)
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

// Leistungsprüfung mit großem Bestand: 82 Mietverhältnisse seit 2010 standen gemischt. Laufende und künftige oben,
// beendete eingeklappt darunter, neueste zuerst (tenancyList.ts).
test('Mietverhältnisse: frühere stehen eingeklappt unter den laufenden, neueste zuerst', async () => {
  const { container } = page([
    tenancy('t1', 'Erster Mieter', { start: '2010-01-01', end: '2014-12-31' }),
    tenancy('t2', 'Heute', { start: '2020-01-01' }),
    tenancy('t3', 'Zweiter Mieter', { start: '2015-01-01', end: '2019-12-31' }),
    tenancy('t4', 'Bald', { start: '2999-01-01' }),
  ])
  await screen.findByText('Heute', undefined, SLOW)
  const tables = container.querySelectorAll('table.tenancy-table')
  expect(tables).toHaveLength(2)
  const names = (t: Element | undefined) => [...(t?.querySelectorAll('tbody tr') ?? [])].map((r) => r.querySelector('td')?.textContent)
  expect(names(tables[0])).toEqual(['Heute', 'Bald'])
  const details = container.querySelector('details:has(table.tenancy-table)') as HTMLDetailsElement | null
  expect(details?.open).toBe(false)
  expect(details?.querySelector('summary')?.textContent).toBe('Frühere Mietverhältnisse (2)')
  expect(names(tables[1])).toEqual(['Zweiter Mieter', 'Erster Mieter'])
})

test('Mietverhältnisse: ohne frühere kein Abschnitt, ohne laufende ein Satz dazu', async () => {
  const { container, unmount } = page([tenancy('t1', 'Heute')])
  await screen.findByText('Heute', undefined, SLOW)
  expect(container.querySelector('details:has(table.tenancy-table)')).toBeNull()
  unmount()
  page([tenancy('t1', 'Weg', { end: '2020-12-31' })])
  await screen.findByText('Kein laufendes Mietverhältnis.', undefined, SLOW)
  expect(screen.getByText('Frühere Mietverhältnisse (1)')).toBeTruthy()
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
  const dialog = await screen.findByRole('alertdialog', undefined, SLOW)
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
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
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
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
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
  fireEvent.click(await screen.findByRole('button', { name: /Mietverhältnis anlegen/ }, SLOW))
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
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
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
  fireEvent.click(await heizung.findByRole('button', { name: 'Speichern' }, SLOW))
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
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
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
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByText(/^Die IBAN des Mieters ist nicht gültig\./)).toBeTruthy()
  expect(sent.filter((s) => s.method === 'PUT')).toEqual([])
})

test('IBAN: eine gültige wird in Vierergruppen angezeigt und normiert gespeichert', async () => {
  page([tenancy('t1', 'Müller')])
  await openTenancy('Müller')
  fireEvent.change(ibanField(), { target: { value: 'de89370400440532013000' } })
  fireEvent.blur(ibanField())
  expect(ibanField().value).toBe('DE89 3704 0044 0532 0130 00')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  await vi.waitFor(() => expect(sent.find((s) => s.method === 'PUT')?.body.iban).toBe('DE89370400440532013000'))
})

test('IBAN: eine gespeicherte ungültige steht als Hinweis da und blockiert das Speichern nicht', async () => {
  page([tenancy('t1', 'Müller', { iban: 'de00 1111' })])
  await openTenancy('Müller')
  expect(ibanField().value).toBe('de00 1111')
  expect(screen.getByText(/^Die gespeicherte IBAN ist vermutlich falsch eingetragen\./)).toBeTruthy()
  fireEvent.blur(ibanField())
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  await vi.waitFor(() => expect(sent.find((s) => s.method === 'PUT')?.body.iban).toBe('de00 1111'))
})

// Durchsicht K3 (#96 PR 2): Kennzahl 62 fragt nach Wohnzwecken; eine Garage an die Tochter zählt nicht.
test('Angehörige: das Kästchen sagt „zu Wohnzwecken“ und speichert relative', async () => {
  page([tenancy('t1', 'Müller')])
  await openTenancy('Müller')
  const box = screen.getByLabelText<HTMLInputElement>(/An Angehörige zu Wohnzwecken vermietet/)
  fireEvent.click(box)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  await vi.waitFor(() => expect(sent.find((s) => s.method === 'PUT')?.body.relative).toBe(true))
})

// ---------- Vorzeitiges Ende der Verteilung am Objekt (§ 82b Abs. 2 EStDV, #262 PR 4) ----------

const SPREAD_REST = 'Verkauft, verschenkt, vererbt oder Vermietung beendet im Jahr'
const DACH: CostItem = { id: 'dach', propertyId: 'objekt-1', period: periodKey('2026-01'), category: 'Nicht umlagefähig', description: 'Dachsanierung', amountCents: 1_000_000, key: 'area', spreadYears: 5 }

test('Ende der Verteilung: ohne verteilte Position kein Feld', async () => {
  costItems = [{ ...DACH, spreadYears: undefined }]
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }, SLOW))
  const dialog = screen.getByRole('dialog', { name: 'Objekt bearbeiten' })
  await vi.waitFor(() => expect(within(dialog).getByLabelText('Adresse')).toBeTruthy())
  // Die Kosten sind geladen (sonst wäre das Fehlen nichts wert): das Fenster fragt sie beim Öffnen ab.
  expect(within(dialog).queryByLabelText(SPREAD_REST)).toBeNull()
})

test('Ende der Verteilung: mit verteilter Position das Feld, angezeigt wie gespeichert, Rückfrage und bestätigt gesendet', async () => {
  costItems = [DACH]
  spreadRestYear = 2035
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }, SLOW))
  const dialog = screen.getByRole('dialog', { name: 'Objekt bearbeiten' })
  const select = await within(dialog).findByLabelText(SPREAD_REST, undefined, SLOW) as HTMLSelectElement
  // Der angezeigte Wert ist der gespeicherte, auch außerhalb der Jahre der Verteilung.
  expect(select.value).toBe('2035')
  expect(select.selectedOptions[0]?.textContent).toBe('2035')
  expect([...select.options].map((o) => o.value)).toEqual(['', '2026', '2027', '2028', '2029', '2030', '2035'])
  // Durchsicht S1: Schenkung als Auslegung, die Richtlinie überholt, kein Rat, das Feld leer zu lassen.
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Mehr dazu' }).at(-1)!)
  expect(dialog.textContent).toMatch(/R 21\.1 Abs\. 6 Sätze 2 und 3 EStR 2012/)
  expect(dialog.textContent).not.toMatch(/Feld leer/)
  fireEvent.change(select, { target: { value: '2027' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  const ask = await screen.findByRole('alertdialog', { name: 'Verteilung für die Steuer ändert sich' }, SLOW)
  expect(ask.textContent).toMatch(/„Dachsanierung“: Abzug 2026 bis 2027 \(Rest 2027\) statt 2026 bis 2030\./)
  expect(sent.filter((x) => x.method === 'PUT')).toEqual([])
  fireEvent.click(within(ask).getByRole('button', { name: 'So speichern' }))
  await vi.waitFor(() => expect(sent.find((x) => x.method === 'PUT')?.body).toMatchObject({ spreadRestYear: 2027, confirmSpread: true }))
})

test('Ende der Verteilung: abgebrochene Rückfrage sendet nichts; ohne Änderung des Jahres geht es nicht mit', async () => {
  costItems = [DACH]
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }, SLOW))
  const dialog = screen.getByRole('dialog', { name: 'Objekt bearbeiten' })
  const select = await within(dialog).findByLabelText(SPREAD_REST, undefined, SLOW) as HTMLSelectElement
  expect(select.value).toBe('')
  fireEvent.change(select, { target: { value: '2028' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  fireEvent.click(within(await screen.findByRole('alertdialog', undefined, SLOW)).getByRole('button', { name: 'Abbrechen' }))
  await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await vi.waitFor(() => expect((within(dialog).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(false))
  expect(sent.filter((x) => x.method === 'PUT')).toEqual([])
  fireEvent.change(select, { target: { value: '' } })
  fireEvent.change(within(dialog).getByLabelText('Adresse'), { target: { value: 'Weg 9' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await vi.waitFor(() => expect(sent.find((x) => x.method === 'PUT')?.body.address).toBe('Weg 9'))
  expect('spreadRestYear' in (sent.find((x) => x.method === 'PUT')?.body ?? {})).toBe(false)
})

test('Ende der Verteilung: ein gespeichertes Jahr außerhalb bleibt wählbar, auch nach einer anderen Wahl (K1)', async () => {
  costItems = [DACH]
  spreadRestYear = 2035
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }, SLOW))
  const select = await within(screen.getByRole('dialog', { name: 'Objekt bearbeiten' })).findByLabelText(SPREAD_REST, undefined, SLOW) as HTMLSelectElement
  fireEvent.change(select, { target: { value: '2027' } })
  expect([...select.options].map((o) => o.value)).toContain('2035')
  fireEvent.change(select, { target: { value: '2035' } })
  expect(select.value).toBe('2035')
})

// Durchsicht S4: Sind die Kosten beim Öffnen nicht (oder leer) geladen, fragt der Server; seine Rückfrage wird die der Seite.
const serverAsks = { status: 409, body: { error: 'Satz des Servers zur Verteilung.', question: 'spread' } }
const clearRestYear = async () => {
  costItems = []
  spreadRestYear = 2027
  putReplies = [serverAsks]
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }, SLOW))
  const dialog = screen.getByRole('dialog', { name: 'Objekt bearbeiten' })
  fireEvent.change(await within(dialog).findByLabelText(SPREAD_REST, undefined, SLOW), { target: { value: '' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  const ask = await screen.findByRole('alertdialog', { name: 'Verteilung für die Steuer ändert sich' }, SLOW)
  expect(ask.textContent).toMatch(/Satz des Servers zur Verteilung\./)
  return ask
}

test('Ende der Verteilung: Rückfrage des Servers (409), „So speichern“ sendet ein zweites PUT mit confirmSpread', async () => {
  const ask = await clearRestYear()
  expect(sent.filter((x) => x.method === 'PUT')).toHaveLength(1)
  expect(sent[0]?.body).toMatchObject({ spreadRestYear: null })
  expect('confirmSpread' in (sent[0]?.body ?? {})).toBe(false)
  fireEvent.click(within(ask).getByRole('button', { name: 'So speichern' }))
  await vi.waitFor(() => expect(sent.filter((x) => x.method === 'PUT')).toHaveLength(2))
  expect(sent[1]?.body).toMatchObject({ spreadRestYear: null, confirmSpread: true })
})

test('Ende der Verteilung: Rückfrage des Servers abgebrochen, kein zweites PUT', async () => {
  const ask = await clearRestYear()
  fireEvent.click(within(ask).getByRole('button', { name: 'Abbrechen' }))
  await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await new Promise((r) => setTimeout(r, 50))
  expect(sent.filter((x) => x.method === 'PUT')).toHaveLength(1)
})

test('Ende der Verteilung: scheitert das Laden der Kosten, steht eine Meldung da (K5)', async () => {
  costItemsFail = true
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }, SLOW))
  expect(await within(screen.getByRole('dialog', { name: 'Objekt bearbeiten' })).findByText(/Die Kosten des Objekts ließen sich nicht laden/, undefined, SLOW)).toBeTruthy()
})

// ---------- Abweichende IBAN des Objekts (#279) ----------

test('Objekt: eine gespeicherte ungültige IBAN steht als Hinweis da und blockiert das Speichern nicht', async () => {
  propertyIban = 'DE00 3333'
  page()
  // Schon die Karte sagt es, ohne das Fenster zu öffnen.
  expect(await screen.findByText(/DE00 3333 \(vermutlich falsch eingetragen, bitte prüfen\)/, undefined, SLOW)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten (Objekt)' }))
  const dialog = screen.getByRole('dialog', { name: 'Objekt bearbeiten' })
  expect(within(dialog).getByText(/^Die gespeicherte IBAN ist vermutlich falsch eingetragen\./)).toBeTruthy()
  fireEvent.change(within(dialog).getByLabelText('Adresse'), { target: { value: 'Weg 9' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await vi.waitFor(() => expect(sent.find((s) => s.method === 'PUT')?.body).toMatchObject({ iban: 'DE00 3333', address: 'Weg 9' }))
})

test('Objekt: eine neue ungültige IBAN wird nicht gespeichert, eine gültige normiert', async () => {
  propertyIban = 'DE89370400440532013000'
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }, SLOW))
  const feld = await screen.findByDisplayValue('DE89 3704 0044 0532 0130 00', undefined, SLOW)
  fireEvent.change(feld, { target: { value: 'DE89 3704 0044 0532 0130 01' } })
  fireEvent.blur(feld)
  expect(screen.getByRole('alert').textContent).toMatch(/Prüfziffer/)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByText(/^Die abweichende IBAN des Objekts ist nicht gültig\./)).toBeTruthy()
  expect(sent).toEqual([])
  fireEvent.change(feld, { target: { value: 'gb82 west 1234 5698 7654 32' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
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

// Safari auf dem Mac und Firefox kennen <input type="month"> nicht; in die Staffeln ließ sich dort nichts
// Brauchbares eingeben (#287). Seit #346 Schritt 5 ist es das Monatsfeld: ein Textfeld mit Raster.
const monthFields = (root: HTMLElement, label: string) => within(root).getAllByRole('textbox', { name: label }) as HTMLInputElement[]

test('Staffeln: das Monatsfeld zeigt den gespeicherten Monat, getippt wird gespeichert, was dasteht', async () => {
  page([tenancy('t1', 'Müller', { baseRents: [{ from: '2025-01', monthlyCents: 80000 }], prepayments: [{ from: '2025-01', monthlyCents: 15000 }] })])
  const [edit] = await screen.findAllByRole('button', { name: /Mietverhältnis bearbeiten/i }, SLOW)
  if (!edit) throw new Error('kein Bearbeiten-Knopf')
  fireEvent.click(edit)
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  const [rent] = monthFields(dialog, 'Kaltmiete gültig ab')
  const [pre] = monthFields(dialog, 'Vorauszahlung gültig ab')
  if (!rent || !pre) throw new Error('Monatsfelder fehlen')
  expect([rent.value, pre.value]).toEqual(['Januar 2025', 'Januar 2025'])
  fireEvent.change(rent, { target: { value: '3.2025' } })
  fireEvent.change(pre, { target: { value: 'Apr 25' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  await vi.waitFor(() => expect(sent.some((s) => s.url.startsWith('/api/tenancies'))).toBe(true))
  const body = sent.find((s) => s.url.startsWith('/api/tenancies'))?.body
  expect(body?.baseRents).toEqual([{ from: '2025-03', monthlyCents: 80000 }])
  expect(body?.prepayments).toEqual([{ from: '2025-04', monthlyCents: 15000 }])
})

test('Staffeln: leer gilt ab Einzug, ein Monat ohne Jahr wird am Feld und in der Sammelmeldung gemeldet', async () => {
  page([tenancy('t1', 'Müller', { start: '2025-02-01', baseRents: [{ from: '2025-02', monthlyCents: 80000 }] })])
  const [edit] = await screen.findAllByRole('button', { name: /Mietverhältnis bearbeiten/i }, SLOW)
  if (!edit) throw new Error('kein Bearbeiten-Knopf')
  fireEvent.click(edit)
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  const [month] = monthFields(dialog, 'Kaltmiete gültig ab')
  if (!month) throw new Error('Monatsfeld fehlt')

  fireEvent.change(month, { target: { value: 'März' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  // am Feld die kurze Fassung, in der Sammelmeldung mit Ort, der Text bleibt stehen
  expect(await within(dialog).findByText('Kaltmiete, Zeile 1: Geben Sie zum Monat auch das Jahr ein, etwa „3.2025“.', undefined, SLOW)).toBeTruthy()
  expect(month.getAttribute('aria-invalid')).toBe('true')
  expect(within(dialog).getByText('Jahr fehlt')).toBeTruthy()
  expect(month.value).toBe('März')
  expect(sent.some((s) => s.url.startsWith('/api/tenancies'))).toBe(false)

  fireEvent.change(month, { target: { value: '' } })
  expect(month.getAttribute('aria-invalid')).toBeNull()
  expect(month.placeholder).toBe('ab Einzug')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  await vi.waitFor(() => expect(sent.some((s) => s.url.startsWith('/api/tenancies'))).toBe(true))
  expect(sent.find((s) => s.url.startsWith('/api/tenancies'))?.body.baseRents).toEqual([{ from: '2025-02', monthlyCents: 80000 }])
})

test('Staffeln: bei Einzug am 15. steht unter der Kaltmiete der Anteil im Einzugsmonat, beim 1. nicht', async () => {
  page([tenancy('t1', 'Müller', { start: '2026-10-15', baseRents: [{ from: '2026-10', monthlyCents: 80000 }] })])
  const [edit] = await screen.findAllByRole('button', { name: /Mietverhältnis bearbeiten/i }, SLOW)
  if (!edit) throw new Error('kein Bearbeiten-Knopf')
  fireEvent.click(edit)
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  expect(within(dialog).getByText(/Einzug am 15\.10\.2026: Im Oktober 2026 zählen 17 von 31 Tagen, also 438,71\s€ statt 800,00\s€\./)).toBeTruthy()
  fireEvent.change(within(dialog).getByLabelText(/^Einzug/), { target: { value: '2026-10-01' } })
  expect(within(dialog).queryByText(/zählen \d+ von \d+ Tagen/)).toBeNull()
})

// Durchsicht von #287: Eine Mieterhöhung ohne Monat galt „ab Einzug“; gesendet wurden zwei Einträge
// zum Einzugsmonat, und nach „es gilt der letzte“ galten 900 € rückwirkend ab Einzug.
test('Staffeln: eine Mieterhöhung ohne Monat wird nicht gespeichert, „ab Einzug“ gibt es nur in der ersten Zeile', async () => {
  page([tenancy('t1', 'Müller', { start: '2025-02-01', baseRents: [{ from: '2025-02', monthlyCents: 80000 }] })])
  const [edit] = await screen.findAllByRole('button', { name: /Mietverhältnis bearbeiten/i }, SLOW)
  if (!edit) throw new Error('kein Bearbeiten-Knopf')
  fireEvent.click(edit)
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  const add = within(dialog).getByRole('button', { name: '+ Mieterhöhung ab Monat …' })
  fireEvent.click(add)
  const group = add.parentElement
  if (!group) throw new Error('keine Feldgruppe der Kaltmiete')
  const [first, second] = monthFields(group, 'Kaltmiete gültig ab')
  const amounts = within(group).getAllByRole('textbox', { name: 'Betrag €/Monat' }) as HTMLInputElement[]
  const amount = amounts[1]
  if (!first || !second || !amount) throw new Error('zweite Zeile fehlt')
  // nur die erste Zeile darf leer „ab Einzug“ heißen
  expect(first.value).toBe('Februar 2025')
  expect(second.placeholder).not.toBe('ab Einzug')
  fireEvent.change(amount, { target: { value: '900,00' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  expect(await within(dialog).findByText('Kaltmiete, Zeile 2: Geben Sie den Monat ein, ab dem der Betrag gilt.', undefined, SLOW)).toBeTruthy()
  expect(second.getAttribute('aria-invalid')).toBe('true')
  expect(sent.some((s) => s.url.startsWith('/api/tenancies'))).toBe(false)
})

// #287: Auch die Staffel der Heizvorauszahlung war ein `type="month"`. Das Feld zeigt den gespeicherten
// Monat, und gespeichert wird, was es zeigt; das Raster wählt ebenso.
// Durchsicht K3: Die Meldungen hängen am Index der Zeile. Wird danach eine Zeile entfernt, rückte die Meldung an
// die nachgerückte Zeile; das Entfernen nimmt die Meldungen deshalb weg (das Speichern prüft neu).
test('Staffeln: nach dem Entfernen einer Zeile steht keine Meldung an der nachgerückten', async () => {
  page([tenancy('t1', 'Müller', { start: '2025-02-01', baseRents: [{ from: '2025-02', monthlyCents: 80000 }] })])
  await openTenancy('Müller')
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  const add = within(dialog).getByRole('button', { name: '+ Mieterhöhung ab Monat …' })
  fireEvent.click(add)
  const group = add.parentElement
  if (!group) throw new Error('keine Feldgruppe der Kaltmiete')
  const amounts = within(group).getAllByRole('textbox', { name: 'Betrag €/Monat' }) as HTMLInputElement[]
  const amount = amounts[1]
  if (!amount) throw new Error('zweite Zeile fehlt')
  fireEvent.change(amount, { target: { value: '900,00' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  expect(await within(dialog).findByText('Kaltmiete, Zeile 2: Geben Sie den Monat ein, ab dem der Betrag gilt.', undefined, SLOW)).toBeTruthy()
  fireEvent.click(within(group).getAllByRole('button', { name: 'Zeile entfernen' })[0] as HTMLElement)
  const [left] = monthFields(group, 'Kaltmiete gültig ab')
  expect(left?.getAttribute('aria-invalid')).toBeNull()
  expect(within(dialog).queryByText(/Kaltmiete, Zeile 2/)).toBeNull()
})

test('Heizvorauszahlung: Monatsfeld und Raster, gespeichert wie gezeigt', async () => {
  page([tenancy('t1', 'Müller', { prepayments: [{ from: '2025-01', monthlyCents: 16500 }], heatingPrepayments: [{ from: '2025-05', monthlyCents: 11500 }] })])
  await openTenancy('Müller')
  const monat = screen.getByRole('textbox', { name: 'Heizvorauszahlung gültig ab' }) as HTMLInputElement
  expect(monat.value).toBe('Mai 2025')
  const raster = monat.parentElement?.querySelector('button')
  if (!raster) throw new Error('kein Knopf für das Raster')
  fireEvent.click(raster)
  fireEvent.click(screen.getByRole('gridcell', { name: 'Jun (Juni 2025)' }))
  expect(monat.value).toBe('Juni 2025')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  await vi.waitFor(() => expect(sent.some((s) => s.url.startsWith('/api/tenancies'))).toBe(true))
  expect(sent.find((s) => s.url.startsWith('/api/tenancies'))?.body.heatingPrepayments).toEqual([{ from: '2025-06', monthlyCents: 11500 }])
})

test('Personen-Staffel: die Beschriftung nennt die Staffel', async () => {
  page([tenancy('t1', 'Müller')])
  await openTenancy('Müller')
  expect((screen.getByLabelText('Personenzahl gültig ab') as HTMLInputElement).value).toBe('2025-01-01')
})

// Durchsicht von fix/monatsauswahl, Kann 3: Ein gespeicherter Wert mit Tag zeigte „ab Einzug“. Das Monatsfeld
// zeigt ihn, wie er gespeichert ist, und das Speichern meldet ihn, statt ihn als Februar zu deuten.
test('Staffeln: ein gespeicherter Wert, der kein Monat ist, steht im Feld und wird nicht still gespeichert', async () => {
  page([tenancy('t1', 'Müller', { baseRents: [{ from: '2024-02-15', monthlyCents: 80000 }] })])
  await openTenancy('Müller')
  const monat = screen.getByRole('textbox', { name: 'Kaltmiete gültig ab' }) as HTMLInputElement
  expect(monat.value).toBe('2024-02-15')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByText(/Kaltmiete, Zeile 1: Hier zählt nur der Monat ab dem Ersten/, undefined, SLOW)).toBeTruthy()
  expect(sent.some((s) => s.url.startsWith('/api/tenancies'))).toBe(false)
})

// Durchsicht K5 (#346, Schritt 2): Das IBAN-Feld schreibt die IBAN beim Verlassen um (getrimmt, in
// Vierergruppen). Das ist keine Änderung des Mietverhältnisses; Esc schließt danach ohne Rückfrage.
test('Seitenfenster Mietverhältnis: Umschreiben der IBAN beim Verlassen ist keine Änderung', async () => {
  page([tenancy('t1', 'Beispiel', { iban: ' de12 3 ' })])
  fireEvent.click(await screen.findByRole('button', { name: 'Mietverhältnis bearbeiten' }, SLOW))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  const iban = within(dialog).getByLabelText(/Mieter-IBAN/) as HTMLInputElement
  fireEvent.click(iban)
  iban.focus()
  fireEvent.blur(iban)
  await vi.waitFor(() => expect(iban.value).toBe('de12 3'))
  within(dialog).getByLabelText(/Mieter-IBAN/).focus()
  press('Escape')
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

// ---------- Nutzungswechsel (#259) ----------

test('Nutzungswechsel: eine Zeile ohne Tag meldet sich, mit Tag geht die Staffel im Rumpf mit', async () => {
  const dialog = await openUnit()
  fireEvent.click(within(dialog).getByRole('button', { name: /Wechsel ab Datum/ }))
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  expect((await within(dialog).findAllByText(/Datum fehlt/, undefined, SLOW)).length).toBeGreaterThan(0)
  expect(sent).toEqual([])
  fireEvent.change(within(dialog).getByLabelText(/Neue Nutzung ab/), { target: { value: '2025-07-01' } })
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ participates: true, usageChanges: [{ from: '2025-07-01', usage: 'eigen' }] })
})

test('Nutzungswechsel: die Liste nennt den Tag und die neue Nutzung', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={[{ ...UNITS[0]!, usageChanges: [{ from: '2025-07-01', usage: 'eigen' }] }, UNITS[1]!]} tenancies={[]} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  expect(await screen.findByText('vermietet bis 30.06.2025 · ab 01.07.2025 Eigennutzung', undefined, SLOW)).toBeTruthy()
})

// ---------- Anrede im Brief (#415, Teil 2) ----------

test('Anrede im Brief: Vorschlag aus dem Namen, gespeichert mit dem Mietverhältnis, leer als null', async () => {
  page([tenancy('t1', 'Müller', { letterSalutation: 'Sehr geehrte Frau Müller' })])
  await openTenancy('Müller')
  const field = screen.getByLabelText<HTMLInputElement>(/Anrede im Brief/)
  expect(field.value).toBe('Sehr geehrte Frau Müller')
  expect(field.placeholder).toBe('Guten Tag Müller,')
  fireEvent.change(field, { target: { value: '' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  await vi.waitFor(() => expect(sent.find((s) => s.method === 'PUT')?.body).toMatchObject({ letterSalutation: null }))
})

// Durchsicht K3: Wandert eine gespeicherte Zeile unter „Frühere“ (Auszug in der Vergangenheit), wird sie neu eingehängt.
// Der Abschnitt klappt auf, und der Fokus steht auf ihrem ✎, nicht auf body.
test('Mietverhältnisse: wandert die gespeicherte Zeile unter „Frühere“, klappt der Abschnitt auf und der Fokus folgt ihr', async () => {
  const before = [tenancy('t1', 'Zieht aus', { prepayments: [{ from: '2025-01', monthlyCents: 25000 }] }), tenancy('t2', 'Bleibt', { unitId: 'u2' })]
  const after = [{ ...before[0] as Tenancy, end: '2025-06-30' }, before[1] as Tenancy]
  function Host() {
    const [list, setList] = useState<Tenancy[]>(before)
    return <Stammdaten units={UNITS} tenancies={list} settings={null} reload={async () => { setList(after) }} />
  }
  const { container } = render(<PeriodProvider><PropertyProvider><UIProvider><Host /></UIProvider></PropertyProvider></PeriodProvider>)
  await screen.findByText('Zieht aus', undefined, SLOW)
  fireEvent.click(rowOf('Zieht aus').getByRole('button', { name: 'Mietverhältnis bearbeiten' }))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  await vi.waitFor(() => expect(screen.getByText('Frühere Mietverhältnisse (1)')).toBeTruthy())
  const details = container.querySelector('details:has(table.tenancy-table)') as HTMLDetailsElement | null
  await vi.waitFor(() => expect(details?.open).toBe(true))
  await vi.waitFor(() => expect(document.activeElement).toBe(rowOf('Zieht aus').getByRole('button', { name: 'Mietverhältnis bearbeiten' })))
})

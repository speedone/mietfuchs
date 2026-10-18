// @vitest-environment jsdom
// Die Karte „Lieferungen“ (Heizung PR 7). Geprüft wird, was die Logiktests nicht sehen: Die Auswahl
// der Lieferung an einer Position zeigt die gespeicherte Verknüpfung (CLAUDE.md, Kosten.test.tsx), und
// eine Änderung schickt sie an die Position.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GAS_BASIS_LABEL } from '../fuelForm'
import FuelCard from './FuelCard'
import { OpenFormScope, hasOpenForm } from '../testing/openForm'
import { UIProvider } from './feedback'
import { periodKey } from '../../../shared/period.ts'
import type { FuelDelivery, FuelExtractResult, HeatingPeriodView } from '../types'
import { noInfoView } from '../testing/heatingView'

const assert = { fail: (): never => { throw new Error('nicht gefunden') } }

const view: HeatingPeriodView = {
  plantId: 'hp', period: periodKey('2025-05'), label: '2025/2026', from: '2025-05-01', to: '2026-04-30', short: false, closed: false,
  ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null }, hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, stock: null,
  items: [
    { id: 'gas', description: 'Gas Abschlussrechnung', amountCents: 650000, key: 'area', fuelDeliveryId: 'd' },
    { id: 'wart', description: 'Wartung', amountCents: 20000, key: 'area', fuelDeliveryId: null },
  ],
}
const gas: FuelDelivery = {
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: null, co2CostCents: null,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], creditNoteKind: null,
}

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const auswahl = (label: string): HTMLSelectElement => {
  const el = screen.getByLabelText(label)
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Die Auswahl an jeder Position zeigt die gespeicherte Lieferung', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  expect(auswahl('Lieferung zu „Gas Abschlussrechnung“').value).toBe('d')
  expect(auswahl('Lieferung zu „Wartung“').value).toBe('')
  expect(screen.getByText(/15\.03\.2025–14\.03\.2026/)).toBeTruthy()
})

// #309: Die Verknüpfung ist ein Entwurf an ihrer Zeile; erst „Speichern“ schickt sie.
test('Eine Verknüpfung ändern sendet erst mit „Speichern“, genau einmal, und nur für ihre Position', async () => {
  const onSaved = vi.fn()
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={onSaved} />)
  fireEvent.change(auswahl('Lieferung zu „Wartung“'), { target: { value: 'd' } })
  expect(sent).toEqual([])
  const knopf = screen.getByRole('button', { name: 'Speichern (Lieferung zu „Wartung“)' })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(sent).toEqual([{ url: '/api/costItems/wart', method: 'PUT', body: { fuelDeliveryId: 'd' } }])
  fireEvent.change(auswahl('Lieferung zu „Gas Abschlussrechnung“'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Lieferung zu „Gas Abschlussrechnung“)' }))
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/costItems/gas', method: 'PUT', body: { fuelDeliveryId: null } }))
})

test('Eine Verknüpfung verwerfen stellt die gespeicherte her, ohne zu senden (#309)', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.change(auswahl('Lieferung zu „Gas Abschlussrechnung“'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Lieferung zu „Gas Abschlussrechnung“)' }))
  expect(auswahl('Lieferung zu „Gas Abschlussrechnung“').value).toBe('d')
  expect(screen.queryByRole('button', { name: /^Speichern/ })).toBeNull()
  expect(sent).toEqual([])
})

test('Scheitert das Verknüpfen, steht der Grund an der Zeile und der Entwurf bleibt (#309)', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Die Heizperiode ist abgeschlossen.' }), { status: 409, headers: { 'content-type': 'application/json' } }))
  const onSaved = vi.fn()
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={onSaved} />)
  fireEvent.change(auswahl('Lieferung zu „Wartung“'), { target: { value: 'd' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Lieferung zu „Wartung“)' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toMatch(/^Nicht gespeichert: .*abgeschlossen/)
  expect(auswahl('Lieferung zu „Wartung“').value).toBe('d')
  expect(onSaved).not.toHaveBeenCalled()
})

test('Beim Messdienst gibt es keine Verknüpfung, aber den Betrag und „vom Messdienst angesetzt“', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'service' }} view={view} deliveries={[{ ...gas, amountCents: 311747 }]} onSaved={() => {}} />)
  expect(screen.queryByLabelText('Lieferung zu „Wartung“')).toBeNull()
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.getByLabelText('Rechnungsbetrag')).toBeTruthy()
  expect(screen.getByLabelText('vom Messdienst angesetzt')).toBeTruthy()
})

test('Durchsicht: Die Karte sagt, dass ohne Verknüpfung nichts abgegrenzt wird; bei einer Wärmepumpe keine CO₂-Felder', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'heatPump' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  expect(screen.getByText(/Ohne Verknüpfung grenzt Mietfuchs nichts ab/)).toBeTruthy()
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.queryByLabelText('CO₂-Ausstoß laut Rechnung (kg)')).toBeNull()
  expect(screen.queryByLabelText('CO₂-Kosten laut Rechnung')).toBeNull()
})

test('Heizöl (Heizung PR 8): Lieferdatum, Menge und Einheit statt Rechnungszeitraum; die Auswahl zeigt die gespeicherte Einheit', async () => {
  const oel: FuelDelivery = { ...gas, label: '', invoiceFrom: null, invoiceTo: null, deliveredAt: '2025-10-10', invoiceDate: '2025-10-12', quantity: 2500, quantityUnit: 'l' }
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'oil' }} view={view} deliveries={[oel]} onSaved={() => {}} />)
  expect(screen.getByText(/geliefert am 10\.10\.2025 · 2\.500 l/)).toBeTruthy()
  expect(screen.getByText(/mit Lieferdatum und Menge/)).toBeTruthy()
  // Durchsicht von #237, M5: Der Betrag kommt aus der verknüpften Position, und die Karte sagt es.
  expect(screen.getByText(/Den Betrag nimmt Mietfuchs aus der verknüpften Kostenposition; ohne Verknüpfung geht die Bestandsrechnung nicht auf\./)).toBeTruthy()
  fireEvent.click(screen.getByText('Ändern'))
  expect(screen.queryByLabelText('Rechnungszeitraum von')).toBeNull()
  // M4: Ein leeres Rechnungsdatum ist das Lieferdatum, und das Feld sagt es.
  expect(screen.getByLabelText('Rechnungsdatum (leer: Lieferdatum)')).toBeTruthy()
  expect(auswahl('Einheit der Menge').value).toBe('l')
  fireEvent.change(screen.getByLabelText('Menge'), { target: { value: '2600' } })
  fireEvent.click(screen.getByText('Speichern'))
  await waitFor(() => expect(sent.at(-1)?.body).toMatchObject({ deliveredAt: '2025-10-10', quantity: 2600, quantityUnit: 'l' }))
})

test('Heizöl (Durchsicht von #237, M5): Die Zeile nennt den Betrag aus der verknüpften Position', () => {
  const oel: FuelDelivery = { ...gas, id: 'd', label: '', invoiceFrom: null, invoiceTo: null, deliveredAt: '2025-10-10', invoiceDate: '2025-10-12', quantity: 2500, quantityUnit: 'l' }
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'oil' }} view={view} deliveries={[oel]} onSaved={() => {}} />)
  // Die Position „Gas Abschlussrechnung“ der Ansicht zeigt auf „d“ und hat 6.500,00 €.
  expect(screen.getByText(/Betrag laut Position 6\.500,00 €/)).toBeTruthy()
})

test('Heizung PR 11: beim Vorrat Heizwert laut Rechnung, ohne ihn die Zeile der Tabelle; bei Gas Brennwert oder Heizwert', async () => {
  render(<FuelCard plant={{ id: 'hp', method: 'self', energy: 'pellets' }} view={view} deliveries={[]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  // Pellets haben genau eine Zeile; sie ist vorbelegt.
  expect(auswahl('Steht kein Heizwert auf der Rechnung: Brennstoff laut Heizkostenverordnung').value).toBe('woodPellets')
  fireEvent.change(screen.getByLabelText('Lieferdatum'), { target: { value: '2025-10-12' } })
  fireEvent.change(screen.getByLabelText('Menge'), { target: { value: '3000' } })
  fireEvent.change(auswahl('Einheit der Menge'), { target: { value: 'kg' } })
  fireEvent.change(screen.getByLabelText('Heizwert laut Rechnung (kWh je Kilogramm)'), { target: { value: '4,9' } })
  expect(screen.queryByLabelText('Steht kein Heizwert auf der Rechnung: Brennstoff laut Heizkostenverordnung')).toBeNull()
  fireEvent.click(screen.getByText('Anlegen'))
  await waitFor(() => expect(sent.at(-1)).toMatchObject({ url: '/api/heating-plants/hp/deliveries', method: 'POST', body: { heatingValue: 4.9, fuelGrade: null, quantityUnit: 'kg' } }))
  cleanup()
  render(<FuelCard plant={{ id: 'hp', method: 'self', energy: 'gas' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.queryByLabelText(/Heizwert laut Rechnung/)).toBeNull()
  expect(auswahl('Kilowattstunden der Rechnung berechnet nach').value).toBe('')
  // Ohne Formel für das Warmwasser kein Hinweis; die Angabe ist nicht vorbelegt.
  expect(screen.queryByText(/ohne sie rechnet die Formel nicht/)).toBeNull()
})

test('Durchsicht #240, Recht-I3: bei Formel für das Warmwasser sagt die Gasrechnung schon an der Lieferung, dass Brennwert/Heizwert fehlt', () => {
  const formel = { ...view, hotWater: { ...view.hotWater, dhwMethod: 'volumeFormula' as const } }
  render(<FuelCard plant={{ id: 'hp', method: 'self', energy: 'gas' }} view={formel} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.getByText(/ohne sie rechnet die Formel nicht/)).toBeTruthy()
  fireEvent.change(auswahl('Kilowattstunden der Rechnung berechnet nach'), { target: { value: 'hs' } })
  expect(screen.queryByText(/ohne sie rechnet die Formel nicht/)).toBeNull()
})

// Durchsicht von #246, R-K7: Der Hinweis der Prüfung steht auch an der Lieferung, wo sie eingetragen wird.
test('Ein Befund der CO₂-Prüfung steht an der Zeile der Lieferung', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} findings={{ [gas.id]: ['„Gas“: Die CO₂-Kosten passen nicht'] }} onSaved={() => {}} />)
  expect(screen.getByText('„Gas“: Die CO₂-Kosten passen nicht').className).toMatch(/hint/)
})

// Nachprüfung von #272, F1: Erzeugt der Lieferant die Wärme mit Wärmepumpe und Gasspitzenkessel (`mixed`), sind CO₂-Kosten
// aufzuteilen; die Karte muss die Felder dafür zeigen, sonst bliebe co2.missing ohne Ausweg. Die reine Wärmepumpe nicht.
test('Contracting mit Wärmepumpe und Gasspitzenkessel: die Lieferung hat die CO₂-Felder; reine Wärmepumpe nicht', () => {
  const { unmount } = render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'heatPump', contracting: true, heatGeneration: 'mixed' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.getByLabelText('CO₂-Ausstoß laut Rechnung (kg)')).toBeTruthy()
  expect(screen.getByLabelText('CO₂-Kosten laut Rechnung')).toBeTruthy()
  unmount()
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'heatPump', contracting: true, heatGeneration: 'single' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.queryByLabelText('CO₂-Ausstoß laut Rechnung (kg)')).toBeNull()
})

// Heizung PR 18 (#215, Prüfung M11): Netzentgelte bei Gas, Biobrennstoff auch beim Vorrat, dort nur 0.
test('Heizung nach § 43: Gas mit Netzentgelten und Biobrennstoff; ohne Merkmal keine Felder', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas', gmodg43InstalledOn: '2027-03-01' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.click(screen.getAllByText('Ändern')[0] ?? assert.fail())
  expect(screen.getByLabelText(/Netzentgelte laut Rechnung/)).toBeTruthy()
  expect(screen.getByLabelText(/Biobrennstoff, Preisbestandteil nach § 3 Abs\. 1 Nr\. 6/)).toBeTruthy()
  cleanup()
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas', gmodg43InstalledOn: null }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.click(screen.getAllByText('Ändern')[0] ?? assert.fail())
  expect(screen.queryByLabelText(/Netzentgelte laut Rechnung/)).toBeNull()
  expect(screen.queryByLabelText(/Biobrennstoff/)).toBeNull()
})

test('Ölheizung nach § 43: das Feld Biobrennstoff erscheint beim Vorrat und sendet 0 (Prüfung M11)', async () => {
  const stockView: HeatingPeriodView = { ...view, items: [] }
  render(<FuelCard plant={{ id: 'oel', method: 'manual', energy: 'oil', gmodg43InstalledOn: '2027-03-01' }} view={stockView} deliveries={[]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.queryByLabelText(/Netzentgelte laut Rechnung/)).toBeNull()
  expect(screen.getByText(/Bei Brennstoff aus dem Tank nur 0/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Lieferdatum'), { target: { value: '2029-02-01' } })
  fireEvent.change(screen.getByLabelText('Menge'), { target: { value: '3000' } })
  fireEvent.change(screen.getByLabelText('Einheit der Menge'), { target: { value: 'l' } })
  fireEvent.change(screen.getByLabelText(/Biobrennstoff, Preisbestandteil/), { target: { value: '0' } })
  fireEvent.click(screen.getByText('Anlegen'))
  await waitFor(() => expect(sent.at(-1)).toMatchObject({ url: '/api/heating-plants/oel/deliveries', method: 'POST', body: { bioCostCents: 0, quantity: 3000 } }))
})

// ---------- Heizung PR 20 (#103): Lieferantenrechnung mit der KI auslesen ----------

const extraction: FuelExtractResult = {
  file: 'gas.pdf',
  extraction: {
    vendor: 'Stadtwerke Beispielstadt', invoiceDate: '2026-03-20', periodStart: '2025-03-15', periodEnd: '2026-03-14',
    totalGrossEur: 4067.8, fixedEur: 207.06, quantity: 2890, quantityUnit: 'm3', energyKwh: 31285, gasBasis: 'hs', heatingValue: null,
    emissionsKg: 5674.8, co2CostEur: 380.99, co2CostNet: false, emissionFactor: 0.20088, bioCostEur: null,
    parts: [
      { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountEur: 2885.77, fixedEur: 165.65, emissionsKg: 4065, co2CostEur: 266.05 },
      { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 1182.03, fixedEur: 41.41, emissionsKg: 1609.8, co2CostEur: 114.94 },
    ],
    amountsNetUnadjusted: false,
  },
}
// Antwortet auf den Beleg mit der Auswertung, auf alles andere wie oben.
const withExtraction = (result: FuelExtractResult) => {
  const fields: Record<string, string>[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData) {
      const f: Record<string, string> = { url }
      init.body.forEach((v, k) => { if (typeof v === 'string' && k !== 'requestId') f[k] = v })
      fields.push(f)
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ai: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return fields
}
const choose = (file = new File(['x'], 'gas.jpg', { type: 'image/jpeg' })) =>
  fireEvent.change(screen.getByLabelText('Rechnung mit KI auslesen'), { target: { files: [file] } })

test('Neue Auswahlfelder zeigen den gespeicherten Wert: Einheit der Menge und Bezug der kWh bei Gas (Prüfung M4)', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas' }} view={view} deliveries={[{ ...gas, quantity: 2890, quantityUnit: 'm3', gasBasis: 'hs' }]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('Ändern'))
  expect(auswahl('Einheit der Menge laut Rechnung').value).toBe('m3')
  expect(auswahl('Kilowattstunden der Rechnung berechnet nach').value).toBe('hs')
  expect((screen.getByLabelText('Emissionsfaktor laut Rechnung (kg CO₂ je kWh)') as HTMLInputElement).value).toBe('')
  // Beim Vorrat gibt es die Auswahl für Gas nicht, und „Einheit der Menge“ nur einmal.
  cleanup()
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'oil' }} view={view} deliveries={[]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.queryByLabelText('Einheit der Menge laut Rechnung')).toBeNull()
  expect(screen.getAllByLabelText('Einheit der Menge')).toHaveLength(1)
})

test('Rechnung mit KI auslesen: das Formular ist vorbelegt, Teilmengen inklusive, gespeichert erst mit „Anlegen“', async () => {
  const fields = withExtraction(extraction)
  render(<FuelCard plant={{ id: 'hp', method: 'service', energy: 'gas', propertyId: 'objekt-1' }} view={view} deliveries={[]} onSaved={() => {}} />)
  choose()
  expect(await screen.findByDisplayValue('4.067,80')).toBeTruthy()
  expect(fields).toEqual([{ url: '/api/heating-plants/hp/fuel-invoice', propertyId: 'objekt-1', year: '2025' }])
  expect(sent.filter((x) => x.method !== 'GET')).toEqual([])
  expect(auswahl('Einheit der Menge laut Rechnung').value).toBe('m3')
  expect(auswahl('Kilowattstunden der Rechnung berechnet nach').value).toBe('hs')
  expect(screen.getByDisplayValue('2.885,77')).toBeTruthy()
  fireEvent.click(screen.getByText('Anlegen'))
  await waitFor(() => expect(sent.find((x) => x.method === 'POST')).toMatchObject({
    url: '/api/heating-plants/hp/deliveries',
    body: { amountCents: 406780, quantity: 2890, quantityUnit: 'm3', emissionFactor: 0.20088, gasBasis: 'hs', parts: [{ from: '2025-03-15', amountCents: 288577 }, { from: '2026-01-01', amountCents: 118203 }] },
  }))
})

test('Rechnung mit KI auslesen bei freien Schlüsseln: der Betrag steht als Satz da, die Prüfungen stehen über dem Formular', async () => {
  withExtraction({ ...extraction, extraction: { ...extraction.extraction, co2CostNet: true } })
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas' }} view={view} deliveries={[]} onSaved={() => {}} />)
  choose()
  expect(await screen.findByText(/Bei freien Schlüsseln steht der Rechnungsbetrag in der Kostenposition/)).toBeTruthy()
  expect(screen.getByText(/ohne Umsatzsteuer/)).toBeTruthy()
  expect(screen.queryByLabelText('Rechnungsbetrag')).toBeNull()
  // Eine Teilmenge lässt sich entfernen; danach fehlt sie im Rumpf.
  fireEvent.click(screen.getAllByText('Teilmenge entfernen')[1] ?? assert.fail())
  fireEvent.click(screen.getByText('Anlegen'))
  await waitFor(() => expect(sent.find((x) => x.method === 'POST')?.body.parts).toEqual([
    { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountCents: 288577, fixedCents: 16565, emissionsKg: 4065, co2CostCents: 26605 },
  ]))
})

test('Ölheizung nach § 43: ein gelesener Betrag zum Biobrennstoff kommt nicht ins Feld, die Karte sagt warum (Prüfung M6)', async () => {
  const oel: FuelExtractResult = { file: 'oel.pdf', extraction: { ...extraction.extraction, periodStart: undefined, periodEnd: undefined, deliveredAt: '2029-10-12', quantity: 3000, quantityUnit: 'l', gasBasis: null, parts: [], bioCostEur: 12.5 } }
  withExtraction(oel)
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'oil', gmodg43InstalledOn: '2027-03-01' }} view={{ ...view, items: [] }} deliveries={[]} onSaved={() => {}} />)
  choose()
  expect(await screen.findByText(/bei Brennstoff aus einem Vorrat noch nicht rechnet/)).toBeTruthy()
  expect((screen.getByLabelText(/Biobrennstoff, Preisbestandteil/) as HTMLInputElement).value).toBe('')
  expect(auswahl('Einheit der Menge').value).toBe('l')
})

test('Gasheizung ohne Einbau nach § 43: der gelesene Biobrennstoff wird genannt, nicht übernommen; ein neues Formular hat keine alten Prüfungen', async () => {
  withExtraction({ ...extraction, extraction: { ...extraction.extraction, bioCostEur: 12.5 } })
  render(<FuelCard plant={{ id: 'hp', method: 'service', energy: 'gas', gmodg43InstalledOn: null }} view={view} deliveries={[]} onSaved={() => {}} />)
  choose()
  expect(await screen.findByText(/kein Einbau nach § 43 Abs\. 1 GModG eingetragen/)).toBeTruthy()
  expect(screen.queryByLabelText(/Biobrennstoff, Preisbestandteil/)).toBeNull()
  fireEvent.click(screen.getByText('Anlegen'))
  await waitFor(() => expect(sent.find((x) => x.method === 'POST')?.body).not.toHaveProperty('bioCostCents'))
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.queryByText(/kein Einbau nach § 43 Abs\. 1 GModG eingetragen/)).toBeNull()
})

test('Rechnung mit KI auslesen gibt es nur, solange nichts bearbeitet wird und die Heizperiode offen ist', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[]} onSaved={() => {}} />)
  expect(screen.getByLabelText('Rechnung mit KI auslesen')).toBeTruthy()
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(screen.queryByLabelText('Rechnung mit KI auslesen')).toBeNull()
  cleanup()
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={{ ...view, closed: true }} deliveries={[]} onSaved={() => {}} />)
  expect(screen.queryByLabelText('Rechnung mit KI auslesen')).toBeNull()
})

test('Durchsicht S1: bei Wärmepumpe und Contracting ohne CO₂-Brennstoff geht keine gelesene CO₂-Angabe in den Rumpf', async () => {
  for (const plant of [
    { id: 'hp', method: 'service' as const, energy: 'heatPump' as const },
    { id: 'hp', method: 'service' as const, energy: 'heatPump' as const, contracting: true, heatGeneration: 'single' as const },
  ]) {
    sent = []
    withExtraction(extraction)
    render(<FuelCard plant={plant} view={view} deliveries={[]} onSaved={() => {}} />)
    choose()
    expect(await screen.findByText(/fragt Mietfuchs sie nicht ab und hat sie nicht übernommen/)).toBeTruthy()
    fireEvent.click(screen.getByText('Anlegen'))
    await waitFor(() => expect(sent.some((x) => x.method === 'POST')).toBe(true))
    const body = sent.find((x) => x.method === 'POST')?.body ?? assert.fail()
    expect([body.co2CostCents, body.emissionsKg, body.emissionFactor, body.gasBasis]).toEqual([null, null, null, null])
    expect((body.parts as { co2CostCents: unknown; emissionsKg: unknown }[]).map((p) => [p.co2CostCents, p.emissionsKg])).toEqual([[null, null], [null, null]])
    cleanup()
  }
})

// #251: Gutschrift ohne Rechnung. Die Auswahl der Lieferung, die sie berichtigt, zeigt die gewählte (CLAUDE.md: der
// angezeigte Wert eines Auswahlfelds entspricht dem gespeicherten); „Zuordnen“ schickt sie an die Route.
const d0: FuelDelivery = { ...gas, id: 'd0', label: 'Rechnung d0', invoiceFrom: '2024-05-01', invoiceTo: '2025-07-13' }
const d1: FuelDelivery = { ...gas, id: 'd1', label: 'Rechnung d1', invoiceFrom: '2025-07-14', invoiceTo: '2026-04-20' }
const mitGutschrift: HeatingPeriodView = { ...view, items: [{ id: 'p16', description: 'Gutschrift', amountCents: -30451, key: 'area', fuelDeliveryId: 'd1' }] }
const alle = [{ fuelDeliveryId: 'd0', amountCents: 617603 }, { fuelDeliveryId: 'd1', amountCents: -30451 }]

test('#251: Gutschrift ohne Rechnung: Frage mit drei Antworten; die Auswahl zeigt die gewählte Lieferung, „Zuordnen“ schickt sie', async () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas' }} view={mitGutschrift} deliveries={[d1]} allDeliveries={[d0, d1]} allItems={alle} onSaved={() => {}} />)
  expect(screen.getByText('Was ist diese Gutschrift?')).toBeTruthy()
  fireEvent.click(screen.getByText('Sie ist der Zahlbetrag nach Abzug der Abschläge'))
  expect(screen.getByText(/Abschläge sind Zahlungen, keine Kosten\./)).toBeTruthy()
  expect(sent).toEqual([])
  fireEvent.click(screen.getByText('Sie berichtigt eine andere Lieferung'))
  const ziel = auswahl('Lieferung, die die Gutschrift „Rechnung d1“ berichtigt')
  expect(ziel.value).toBe('')
  fireEvent.change(ziel, { target: { value: 'd0' } })
  expect(auswahl('Lieferung, die die Gutschrift „Rechnung d1“ berichtigt').value).toBe('d0')
  expect(screen.getByText('Hat der Lieferant Brennstoff zurückgenommen?')).toBeTruthy()
  fireEvent.click(screen.getByText('Zuordnen'))
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/fuel-deliveries/d1/reassign-credit', method: 'POST', body: { targetId: 'd0' } }))
})

test('#251: Antwort „Rechnung nicht in Mietfuchs“ speichert die Angabe an der Lieferung', async () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas' }} view={mitGutschrift} deliveries={[d1]} allDeliveries={[d0, d1]} allItems={alle} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('Sie ist eine Gutschrift, deren Rechnung nicht in Mietfuchs steht'))
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/fuel-deliveries/d1', method: 'PUT', body: { creditNoteKind: 'standalone' } }))
})

test('Durchsicht zu #309, MUSS 2: verschwindet die gewählte Lieferung, ist der Entwurf verworfen', () => {
  const zweite = { ...gas, id: 'd2', label: 'Gas 2026' }
  const { rerender } = render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas, zweite]} onSaved={() => {}} />)
  fireEvent.change(auswahl('Lieferung zu „Wartung“'), { target: { value: 'd2' } })
  expect(screen.getByRole('button', { name: 'Speichern (Lieferung zu „Wartung“)' })).toBeTruthy()
  rerender(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  expect(auswahl('Lieferung zu „Wartung“').value).toBe('')
  expect(screen.queryByRole('button', { name: 'Speichern (Lieferung zu „Wartung“)' })).toBeNull()
})

// #346, Schritt 7a und 7: Das Seitenfenster einer Lieferung meldet sich an, sobald etwas eingetragen ist; „Abbrechen“
// fragt dann, und nach „Verwerfen“ ist die Marke weg. Ein Formular mit dem Vorschlag der KI zählt schon beim Öffnen.
test('7a: das Formular einer Lieferung meldet sich mit der ersten Eingabe an, Verwerfen nimmt die Marke weg', async () => {
  render(<UIProvider><OpenFormScope><FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={() => {}} /></OpenFormScope></UIProvider>)
  expect(hasOpenForm()).toBe(false)
  fireEvent.click(screen.getByText('+ Lieferung anlegen'))
  expect(hasOpenForm()).toBe(false)
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Bezeichnung'), { target: { value: 'Gas' } })
  expect(hasOpenForm()).toBe(true)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abbrechen' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(hasOpenForm()).toBe(false)
  expect(sent).toEqual([])
})

test('7a: eine mit der KI gelesene Rechnung ist schon beim Öffnen ein offenes Formular', async () => {
  withExtraction(extraction)
  render(<OpenFormScope><FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas' }} view={view} deliveries={[]} onSaved={() => {}} /></OpenFormScope>)
  choose()
  await screen.findByRole('dialog', { name: 'Neue Lieferung' })
  expect(hasOpenForm()).toBe(true)
})

// ---------- #346 Schritt 7: die Lieferung im Seitenfenster, mit denselben Anfragen ----------
// Die Rümpfe hier sind die, die das Formular in der Karte vor dem Seitenfenster schickte, Feld für Feld.

/** Öffnet das Formular einer neuen Lieferung bzw. das der Lieferung `label`; gibt den Bereich des Formulars zurück. */
const openDelivery = async (label?: string): Promise<HTMLElement> => {
  if (label === undefined) fireEvent.click(screen.getByRole('button', { name: NEW_DELIVERY }))
  else fireEvent.click(screen.getByRole('button', { name: `Lieferung „${label}“ ändern` }))
  return deliveryForm()
}
const NEW_DELIVERY = '+ Lieferung anlegen'
const deliveryForm = (): HTMLElement => screen.getByRole('dialog')
const saveDelivery = (box: HTMLElement, name: 'Anlegen' | 'Speichern') => fireEvent.click(within(box).getByRole('button', { name }))

test('Lieferung anlegen: genau eine Anfrage mit dem Rumpf wie bisher, danach ist das Formular zu', async () => {
  const onSaved = vi.fn()
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas' }} view={view} deliveries={[gas]} onSaved={onSaved} />)
  const box = await openDelivery()
  const set = (label: string, value: string) => fireEvent.change(within(box).getByLabelText(label), { target: { value } })
  set('Bezeichnung', 'Gas 2026')
  set('Rechnungszeitraum von', '2026-03-15')
  set('bis', '2027-03-14')
  set('davon fester Preisbestandteil (Grund-, Mess-, Verrechnungspreis)', '207,06')
  set('Energie (kWh)', '31.285')
  set('Menge', '2.890')
  set('Einheit der Menge laut Rechnung', 'm3')
  set(GAS_BASIS_LABEL, 'hs')
  set('CO₂-Ausstoß laut Rechnung (kg)', '5.674,8')
  set('CO₂-Kosten laut Rechnung', '380,99')
  set('Emissionsfaktor laut Rechnung (kg CO₂ je kWh)', '0,20088')
  fireEvent.click(within(box).getByRole('button', { name: '+ weitere Teilmenge' }))
  set('Teilmenge 1: von', '2026-03-15')
  set('Teilmenge 1: bis', '2026-12-31')
  set('Teilmenge 1: Betrag', '2.885,77')
  saveDelivery(box, 'Anlegen')
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(sent).toEqual([{
    url: '/api/heating-plants/hp/deliveries', method: 'POST',
    body: {
      label: 'Gas 2026', invoiceFrom: '2026-03-15', invoiceTo: '2027-03-14', fixedCents: 20706, sharePermille: null, emissionsKg: 5674.8, co2CostCents: 38099,
      energyKwh: 31285, gasBasis: 'hs', quantity: 2890, quantityUnit: 'm3', emissionFactor: 0.20088,
      parts: [{ from: '2026-03-15', to: '2026-12-31', energyKwh: null, amountCents: 288577, fixedCents: null, emissionsKg: null, co2CostCents: null }],
    },
  }])
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('Lieferung ändern: PUT an die Lieferung mit dem ganzen Rumpf wie bisher', async () => {
  const onSaved = vi.fn()
  render(<FuelCard plant={{ id: 'hp', method: 'service', energy: 'gas' }} view={view} deliveries={[{ ...gas, amountCents: 406780, fixedCents: 20706 }]} onSaved={onSaved} />)
  const box = await openDelivery('Gas 2025/2026')
  fireEvent.change(within(box).getByLabelText('Rechnungsbetrag'), { target: { value: '4.100,00' } })
  saveDelivery(box, 'Speichern')
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(sent).toEqual([{
    url: '/api/fuel-deliveries/d', method: 'PUT',
    body: {
      label: 'Gas 2025/2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amountCents: 410000, fixedCents: 20706, sharePermille: null, emissionsKg: null, co2CostCents: null,
      energyKwh: null, gasBasis: null, usedByService: true, quantity: null, quantityUnit: null, emissionFactor: null, parts: [],
    },
  }])
})

test('Lieferung einer Etagenheizung: ohne Wohnung Meldung am Feld, mit Wohnung der Rumpf wie bisher', async () => {
  const onSaved = vi.fn()
  const units = [{ id: 'u1', name: 'EG' }, { id: 'u2', name: 'OG' }]
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas', supply: 'perUnit', units: [{ unitId: 'u2' }] as never }} view={view} deliveries={[]} units={units} onSaved={onSaved} />)
  const box = await openDelivery()
  fireEvent.change(within(box).getByLabelText('Rechnungszeitraum von'), { target: { value: '2026-01-01' } })
  fireEvent.change(within(box).getByLabelText('bis'), { target: { value: '2026-12-31' } })
  saveDelivery(box, 'Anlegen')
  expect(await within(box).findByText(/Bitte wählen Sie die Wohnung, deren Heizung die Rechnung betrifft\./)).toBeTruthy()
  expect(sent).toEqual([])
  fireEvent.change(within(box).getByLabelText(/^Wohnung/), { target: { value: 'u2' } })
  saveDelivery(box, 'Anlegen')
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(sent).toEqual([{
    url: '/api/heating-plants/hp/deliveries', method: 'POST',
    body: {
      label: '', invoiceFrom: '2026-01-01', invoiceTo: '2026-12-31', fixedCents: null, sharePermille: null, emissionsKg: null, co2CostCents: null,
      energyKwh: null, gasBasis: null, quantity: null, quantityUnit: null, emissionFactor: null, parts: [], unitId: 'u2',
    },
  }])
})

// Durchsicht S1: Ein Doppelklick legte die Lieferung zweimal an; die Abgrenzung verteilte das Geld dann doppelt.
test('Lieferung: Doppelklick und Strg+S legen genau eine an', async () => {
  const onSaved = vi.fn()
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas' }} view={view} deliveries={[]} onSaved={onSaved} />)
  const box = await openDelivery()
  fireEvent.change(within(box).getByLabelText('Rechnungszeitraum von'), { target: { value: '2026-01-01' } })
  fireEvent.change(within(box).getByLabelText('bis'), { target: { value: '2026-12-31' } })
  const knopf = within(box).getByRole('button', { name: 'Anlegen' })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  fireEvent.keyDown(box, { key: 's', ctrlKey: true })
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1)
})

// Durchsicht S2: Ein mit der KI vorbelegtes Fenster schloss mit Esc, ✕ oder Klick daneben ohne Rückfrage; die gelesene
// Rechnung war weg. Die Vorbelegung zählt jetzt als Änderung gegenüber dem leeren Formular.
test('S2: Esc in einer mit der KI vorbelegten Lieferung fragt „Änderungen verwerfen?“', async () => {
  withExtraction(extraction)
  render(<UIProvider><FuelCard plant={{ id: 'hp', method: 'manual', energy: 'gas' }} view={view} deliveries={[]} onSaved={() => {}} /></UIProvider>)
  choose()
  const box = await screen.findByRole('dialog', { name: 'Neue Lieferung' })
  fireEvent.keyDown(box, { key: 'Escape' })
  const ask = await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })
  fireEvent.click(within(ask).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.getByRole('dialog', { name: 'Neue Lieferung' })).toBeTruthy()
})

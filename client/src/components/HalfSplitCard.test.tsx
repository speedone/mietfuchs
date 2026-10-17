// @vitest-environment jsdom
// Die Karte „Heizung nach § 43 GModG“ (Heizung PR 18, #215): Auswahlfelder zeigen den gespeicherten Wert,
// Speichern schickt die Merkmale an die Anlage, die Mitteilung an das Mietverhältnis.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HalfSplitCard from './HalfSplitCard'

const plant = {
  id: 'hp', energy: 'gas' as const, units: null, gmodg43InstalledOn: '2028-03-01', emergencyInstall: true, emergencyPriorDuty: false,
  newBuildingFirstUse: '2028-01-15', buildingApplicationBefore20260513: true,
}
const tenancies = [{ id: 'ta', unitId: 'oben', tenantName: 'Mieter A', start: '2020-01-01', end: null }]
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

const PFLICHT = 'War die ausgefallene Heizung eine Gas-, Öl- oder Flüssiggasheizung, die nach dem 29.07.2026 in das bestehende Gebäude eingebaut wurde?'
const ANTRAG = 'Bauantrag, Antrag auf Zustimmung oder Bauanzeige vor dem 13.05.2026?'

test('Die Auswahlfelder zeigen die gespeicherten Werte', () => {
  render(<HalfSplitCard plant={plant} tenancies={tenancies} onSaved={() => {}} />)
  const pflicht = screen.getByLabelText(PFLICHT)
  const antrag = screen.getByLabelText(ANTRAG)
  if (!(pflicht instanceof HTMLSelectElement) || !(antrag instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect([pflicht.value, antrag.value]).toEqual(['no', 'yes'])
  // Prüfung M8 (Wortlaut der Gegenprüfung): die Erläuterung zur Frage.
  expect(screen.getByText(/gilt für eine solche Heizung die Pflicht nach § 43 Abs\. 1 GModG schon ab dem Einbau, auch bevor der erste Pflichtanteil 2029 greift \(BT-Drs\. 21\/7009, S\. 150 und 154\)/)).toBeTruthy()
  // Prüfung S13: was im Neubau als Tag des Einbaus gilt.
  expect(screen.getByText(/als Tag des Einbaus tragen Sie den Tag ein, an dem die Gas-, Öl- oder Flüssiggasheizung in Betrieb ging/)).toBeTruthy()
  // Prüfung M9: die gemeinsame Heizung gehört zur Ausnahme.
  expect(screen.getByText(/von denen Sie eine selbst bewohnen und die beide an dieser Heizung hängen/)).toBeTruthy()
})

test('Speichern schickt die Merkmale an die Anlage', async () => {
  render(<HalfSplitCard plant={{ ...plant, emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null }} tenancies={tenancies} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('Angaben speichern'))
  await waitFor(() => expect(sent.at(-1)).toEqual({
    url: '/api/heating-plants/hp', method: 'PUT',
    body: { gmodg43InstalledOn: '2028-03-01', emergencyInstall: false, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null },
  }))
})

test('Die Mitteilung nach § 5d Abs. 4 geht an das Mietverhältnis (Abweichung 3)', async () => {
  render(<HalfSplitCard plant={plant} tenancies={tenancies} onSaved={() => {}} />)
  fireEvent.change(screen.getByLabelText('Mitteilung an Mieter A nach § 5d Abs. 4 in Textform am'), { target: { value: '2028-03-15' } })
  fireEvent.click(screen.getByText('Mitteilung speichern'))
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/tenancies/ta', method: 'PUT', body: { halfSplitNoticeOn: '2028-03-15' } }))
})

// Durchsicht K1, K3: Stichtage, Netzentgelte nur bei Gas und die Grenze beim Biobrennstoff aus dem Register; die
// Mitteilung mit der Abrechnung als Regelfall der Begründung.
test('Die Karte nennt Stichtage, Netzentgelte nur bei Gas und die Grenze beim Biobrennstoff', () => {
  render(<HalfSplitCard plant={plant} tenancies={tenancies} onSaved={() => {}} />)
  expect(screen.getByText(/ab dem 01\.01\.2028 die Hälfte der CO₂-Kosten und, nur bei Gas, der Netzentgelte, ab dem 01\.01\.2029 auch die Hälfte der Kosten des Pflichtanteils an Biobrennstoff, höchstens für 30 % des verbrauchten Brennstoffs/)).toBeTruthy()
  expect(screen.getByText(/genügt nach der Begründung in der Regel die Mitteilung mit der Abrechnung/)).toBeTruthy()
})

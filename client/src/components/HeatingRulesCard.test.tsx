// @vitest-environment jsdom
// Karten „Ausnahmen und Vereinbarungen“ und „Angaben zur Abrechnung (§ 6a)“ (Heizung PR 14): Der angezeigte Wert
// jedes Auswahlfelds ist der geltende, eine Änderung geht an die Heizperiode, und geerbte Angaben sagen, woher.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { HeatingPeriodView, HeatingPlant } from '../types'
import { periodKey } from '../../../shared/period.ts'
import HeatingRulesCard from './HeatingRulesCard'
import HeatingInfoCard from './HeatingInfoCard'
import { UIProvider } from './feedback'
import { noInfoView } from '../testing/heatingView'
import { useState } from 'react'
import { PropertyProvider, useHasOpenForm } from '../property'

const PLANT = { id: 'hp', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'self' } as HeatingPlant
const view = (over: Partial<HeatingPeriodView> = {}): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null },
  hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, items: [], stock: null,
  ...noInfoView(), ...over,
})
let sent: { url: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const wrap = (ui: React.ReactElement) => render(<UIProvider>{ui}</UIProvider>)

test('die Auswahlfelder zeigen die geltenden Angaben, geerbte mit ihrer Heizperiode', () => {
  const rules = { ...noInfoView().rules, exemption: 'pre1981' as const, exemptionScope: 'both' as const, exemptionBillingAgreed: true, agreedOtherwise: 'fixedPercent' as const, monthlyInfoElsewhere: true,
    fromPeriod: { exemption: '2024-01', agreedOtherwise: '2025-01', monthlyInfoElsewhere: null, consumerContract: null } }
  wrap(<HeatingRulesCard plant={{ ...PLANT, method: 'manual' }} view={view({ rules, agreeable: true })} onChanged={() => {}} />)
  expect((screen.getByLabelText(/Ausnahme nach § 11/) as HTMLSelectElement).value).toBe('pre1981')
  expect((screen.getByLabelText(/auch das Warmwasser/) as HTMLSelectElement).value).toBe('both')
  expect((screen.getByLabelText(/Vereinbarung nach § 2/) as HTMLSelectElement).value).toBe('fixedPercent')
  expect((screen.getByLabelText(/Abrechnung der Heiz- und Warmwasserkosten vereinbart/) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText(/monatliche Verbrauchsinformation anders/) as HTMLInputElement).checked).toBe(true)
  expect(screen.getByText(/Übernommen aus der Heizperiode 2024/)).toBeTruthy()
})

test('ohne Ausnahme keine Frage nach dem Umfang; eine Änderung geht an die Heizperiode', async () => {
  wrap(<HeatingRulesCard plant={PLANT} view={view({ agreeable: true })} onChanged={() => {}} />)
  expect(screen.queryByLabelText(/auch das Warmwasser/)).toBeNull()
  expect((screen.getByLabelText(/Vereinbarung nach § 2/) as HTMLSelectElement).value).toBe('none')
  fireEvent.change(screen.getByLabelText(/Ausnahme nach § 11/), { target: { value: 'lowDemand' } })
  // #309: Die Auswahl allein sendet nichts; die Frage nach dem Umfang erscheint schon mit dem Entwurf.
  expect(sent).toEqual([])
  expect(screen.getByLabelText(/auch das Warmwasser/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Ausnahmen 2025)' }))
  // Erst nachgerechnet (Durchsicht von #243, G-K1), dann gespeichert.
  await waitFor(() => expect(sent).toEqual([
    { url: '/api/heating-plants/hp/periods/2025-01/rules', body: { exemption: 'lowDemand', dryRun: true } },
    { url: '/api/heating-plants/hp/periods/2025-01/rules', body: { exemption: 'lowDemand' } },
  ]))
})

test('Angaben nach § 6a: Verbrauchervertrag zeigt den geltenden Wert, Speichern schickt Zahlen mit Komma als Zahl', async () => {
  const v = view({
    info: { ...noInfoView().info, climateFactor: 1.08, climateFactorSource: 'DWD' },
    rules: { ...noInfoView().rules, consumerContract: 'none', fromPeriod: { ...noInfoView().rules.fromPeriod, consumerContract: '2024-01' } },
  })
  wrap(<HeatingInfoCard plant={PLANT} view={v} onChanged={() => {}} />)
  expect((screen.getByLabelText(/Ist Ihr Mietvertrag ein Verbrauchervertrag/) as HTMLSelectElement).value).toBe('none')
  expect((screen.getByLabelText(/Klimafaktor dieser Heizperiode/) as HTMLInputElement).value).toBe('1,08')
  fireEvent.change(screen.getByLabelText(/Klimafaktor der vorigen Heizperiode/), { target: { value: '1,15' } })
  fireEvent.change(screen.getByLabelText(/Vergleichswert eines Durchschnittsnutzers/), { target: { value: '120' } })
  fireEvent.click(screen.getByText('Angaben speichern'))
  // Ohne Quelle des Vergleichswerts wird nichts gesendet.
  expect(await screen.findByText(/Quelle des Vergleichswerts/, { selector: '.error' })).toBeTruthy()
  expect(sent).toEqual([])
  fireEvent.change(screen.getByLabelText(/Quelle des Vergleichswerts/), { target: { value: 'Ablesedienst 2025' } })
  fireEvent.click(screen.getByText('Angaben speichern'))
  await waitFor(() => expect(sent.length).toBe(1))
  expect(sent[0]?.body).toMatchObject({ climateFactor: 1.08, climateFactorPrev: 1.15, infoReferenceKwhPerM2: 120, infoReferenceSource: 'Ablesedienst 2025' })
})

test('Durchsicht von #243: § 2 im größeren Haus nicht wählbar (R-K7), ohne Warmwasser keine Frage nach dem Umfang (R-K6), feste Anteile nicht bei eigener Abrechnung (G-W3)', () => {
  const rules = { ...noInfoView().rules, exemption: 'lowDemand' as const, exemptionScope: 'both' as const }
  wrap(<HeatingRulesCard plant={PLANT} view={view({ rules, centralHotWater: false, agreeable: false })} onChanged={() => {}} />)
  expect(screen.queryByLabelText(/Vereinbarung nach § 2/)).toBeNull()
  expect(screen.getByText(/Nach den Stammdaten trifft das hier nicht zu/)).toBeTruthy()
  expect(screen.queryByLabelText(/auch das Warmwasser/)).toBeNull()
  expect(screen.getByText(/bereitet in dieser Heizperiode kein Warmwasser/)).toBeTruthy()
  expect(screen.getByLabelText(/Abrechnung der Heiz- und Warmwasserkosten vereinbart/)).toBeTruthy()
  cleanup()
  wrap(<HeatingRulesCard plant={PLANT} view={view({ agreeable: true })} onChanged={() => {}} />)
  const values = [...(screen.getByLabelText(/Vereinbarung nach § 2/) as HTMLSelectElement).options].map((o) => o.value)
  expect(values).toEqual(['none', 'area', 'consumption'])
})

test('Durchsicht von #243, G-K1: Wirkt die Angabe an einer abgeschlossenen Heizperiode vorbei, fragt die Karte nach; Abbrechen speichert nichts', async () => {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    sent.push({ url, body })
    return new Response(JSON.stringify({ later: { closed: ['2026-01'] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  wrap(<HeatingRulesCard plant={PLANT} view={view()} onChanged={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Ausnahme nach § 11/), { target: { value: 'lowDemand' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Ausnahmen 2025)' }))
  expect(await screen.findByText(/Die Heizperiode 2026 ist abgeschlossen/)).toBeTruthy()
  fireEvent.click(screen.getByText('Abbrechen'))
  await waitFor(() => expect(screen.queryByText(/Die Heizperiode 2026 ist abgeschlossen/)).toBeNull())
  expect(sent.map((x) => x.body)).toEqual([{ exemption: 'lowDemand', dryRun: true }])
  // #309: Abbrechen lässt den Entwurf ohne Fehlermeldung stehen.
  expect((screen.getByLabelText(/Ausnahme nach § 11/) as HTMLSelectElement).value).toBe('lowDemand')
  expect(screen.getByRole('button', { name: 'Speichern (Ausnahmen 2025)' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

// #309: Die Karte speichert nicht mehr beim Anklicken, sondern mit einem „Speichern“ für alle Felder.
test('#309: mehrere Änderungen gehen mit einem „Speichern“ genau einmal, nur die geänderten Felder', async () => {
  const onChanged = vi.fn()
  wrap(<HeatingRulesCard plant={{ ...PLANT, method: 'manual' }} view={view({ agreeable: true })} onChanged={onChanged} />)
  fireEvent.change(screen.getByLabelText(/Vereinbarung nach § 2/), { target: { value: 'area' } })
  fireEvent.click(screen.getByLabelText(/monatliche Verbrauchsinformation anders/))
  expect(sent).toEqual([])
  const speichern = screen.getByRole('button', { name: 'Speichern (Ausnahmen 2025)' })
  fireEvent.click(speichern)
  fireEvent.click(speichern)
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(sent.map((x) => x.body)).toEqual([
    { agreedOtherwise: 'area', monthlyInfoElsewhere: true, dryRun: true },
    { agreedOtherwise: 'area', monthlyInfoElsewhere: true },
  ])
})

test('#309: „Verwerfen“ stellt alle Felder her, ohne zu senden', () => {
  wrap(<HeatingRulesCard plant={PLANT} view={view({ agreeable: true })} onChanged={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Ausnahme nach § 11/), { target: { value: 'lowDemand' } })
  fireEvent.click(screen.getByLabelText(/monatliche Verbrauchsinformation anders/))
  expect(screen.getByText('Ungespeicherte Änderungen')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Ausnahmen 2025)' }))
  expect((screen.getByLabelText(/Ausnahme nach § 11/) as HTMLSelectElement).value).toBe('none')
  expect((screen.getByLabelText(/monatliche Verbrauchsinformation anders/) as HTMLInputElement).checked).toBe(false)
  expect(screen.queryByLabelText(/auch das Warmwasser/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Speichern (Ausnahmen 2025)' })).toBeNull()
  expect(sent).toEqual([])
})

test('#309: wird die Ausnahme im Entwurf wieder „keine“, gehen Umfang und vereinbarte Abrechnung nicht mit', async () => {
  const rules = { ...noInfoView().rules, exemption: 'pre1981' as const }
  wrap(<HeatingRulesCard plant={PLANT} view={view({ rules })} onChanged={() => {}} />)
  fireEvent.change(screen.getByLabelText(/auch das Warmwasser/), { target: { value: 'both' } })
  fireEvent.click(screen.getByLabelText(/Abrechnung der Heiz- und Warmwasserkosten vereinbart/))
  fireEvent.change(screen.getByLabelText(/Ausnahme nach § 11/), { target: { value: 'none' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Ausnahmen 2025)' }))
  await waitFor(() => expect(sent.length).toBe(2))
  expect(sent[1]?.body).toEqual({ exemption: 'none' })
})

test('#309: ein Fehler des Servers steht am Knopf, der Entwurf bleibt', async () => {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
    return new Response(JSON.stringify({ error: 'Die Heizperiode ist abgeschlossen.' }), { status: 409, headers: { 'content-type': 'application/json' } })
  })
  const onChanged = vi.fn()
  wrap(<HeatingRulesCard plant={PLANT} view={view()} onChanged={onChanged} />)
  fireEvent.click(screen.getByLabelText(/monatliche Verbrauchsinformation anders/))
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Ausnahmen 2025)' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toMatch(/^Nicht gespeichert: .*abgeschlossen/)
  expect(alert.closest('.draft-actions.border-t')).not.toBeNull()
  expect((screen.getByLabelText(/monatliche Verbrauchsinformation anders/) as HTMLInputElement).checked).toBe(true)
  expect(onChanged).not.toHaveBeenCalled()
})

test('Durchsicht von #243, R-W1: Bestätigung des beigelegten Vergleichs bei Heizkostenverteilern, nicht bei Wärmezählern', async () => {
  wrap(<HeatingInfoCard plant={PLANT} view={view({ capture: 'hca' })} onChanged={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Vergleich des Ablesedienstes liegt der Abrechnung bei/), { target: { value: 'Ablesedienst, Anlage 2' } })
  fireEvent.click(screen.getByText('Angaben speichern'))
  await waitFor(() => expect(sent.length).toBe(1))
  expect(sent[0]?.body).toMatchObject({ infoComparisonSource: 'Ablesedienst, Anlage 2' })
  cleanup()
  wrap(<HeatingInfoCard plant={PLANT} view={view({ capture: 'heatMeter' })} onChanged={() => {}} />)
  expect(screen.queryByLabelText(/Vergleich des Ablesedienstes liegt der Abrechnung bei/)).toBeNull()
})

test('Durchsicht von #243, Runde 2, R2-N-W1: bei Werten des Ablesedienstes deckt die Bestätigung Nr. 4 und Nr. 5', () => {
  wrap(<HeatingInfoCard plant={PLANT} view={view({ capture: 'serviceValues' })} onChanged={() => {}} />)
  expect(screen.getByText(/Mit Werten des Ablesedienstes rechnet Mietfuchs die Vergleiche mit einem Durchschnittsnutzer \(Nr\. 4\) und mit dem vorhergehenden Abrechnungszeitraum \(Nr\. 5\) nicht/)).toBeTruthy()
})

// #309: Ein offener Entwurf zählt als offenes Formular; der Wechsel von Objekt oder Zeitraum fragt dann nach.
function Offen() {
  const hasOpenForm = useHasOpenForm()
  const [seen, setSeen] = useState<boolean | null>(null)
  return <button type="button" onClick={() => setSeen(hasOpenForm())}>offen? {String(seen)}</button>
}

test('#309: ein ungespeicherter Entwurf der Karte zählt als offenes Formular', async () => {
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
  render(<PropertyProvider><UIProvider><HeatingRulesCard plant={PLANT} view={view()} onChanged={() => {}} /><Offen /></UIProvider></PropertyProvider>)
  const frage = () => {
    fireEvent.click(screen.getByRole('button', { name: /^offen\?/ }))
    return screen.getByRole('button', { name: /^offen\?/ }).textContent
  }
  fireEvent.click(await screen.findByLabelText(/monatliche Verbrauchsinformation anders/))
  expect(frage()).toBe('offen? true')
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Ausnahmen 2025)' }))
  expect(frage()).toBe('offen? false')
})

// Durchsicht zu #309, SOLLTE 5: Speichert eine andere Karte (etwa § 6a), kommt die Karte mit neuen Regeln wieder.
// Ein Entwurf bleibt dabei stehen und vergleicht danach gegen den neuen Stand.
test('#309: neue Regeln von außen lassen einen Entwurf stehen', async () => {
  const { rerender } = wrap(<HeatingRulesCard plant={PLANT} view={view({ agreeable: true })} onChanged={() => {}} />)
  fireEvent.click(screen.getByLabelText(/monatliche Verbrauchsinformation anders/))
  const neu = view({ agreeable: true, rules: { ...noInfoView().rules, consumerContract: 'none' } })
  rerender(<UIProvider><HeatingRulesCard plant={PLANT} view={neu} onChanged={() => {}} /></UIProvider>)
  expect((screen.getByLabelText(/monatliche Verbrauchsinformation anders/) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Ausnahmen 2025)' }))
  await waitFor(() => expect(sent.length).toBe(2))
  expect(sent[1]?.body).toEqual({ monthlyInfoElsewhere: true })
})

// Durchsicht zu #309, KANN 6: Wer die Ausnahme wählt, den Umfang ändert und die Ausnahme wieder auf „keine“
// stellt, hat nichts Sichtbares geändert und keinen Entwurf mehr.
test('#309: zurück auf „keine“ nimmt verborgene Änderungen mit', () => {
  wrap(<HeatingRulesCard plant={PLANT} view={view()} onChanged={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Ausnahme nach § 11/), { target: { value: 'lowDemand' } })
  fireEvent.change(screen.getByLabelText(/auch das Warmwasser/), { target: { value: 'both' } })
  fireEvent.change(screen.getByLabelText(/Ausnahme nach § 11/), { target: { value: 'none' } })
  expect(screen.queryByText('Ungespeicherte Änderungen')).toBeNull()
  expect(screen.queryByRole('button', { name: /^Speichern/ })).toBeNull()
})

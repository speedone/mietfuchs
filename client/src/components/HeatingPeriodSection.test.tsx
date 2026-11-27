// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import HeatingPeriodSection from './HeatingPeriodSection'
import { UIProvider } from './feedback'
import { CALENDAR_RULES } from '../../../shared/period.ts'
import type { HeatingPlant } from '../types'

const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null, nonResidential: false, restriction: 'none', districtEtsNew: false, secondPrepaymentCoversWater: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null, hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: null, heatPumpMajority: null, hcaModel: null, operatingPowerHandling: null, contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null, gmodg43InstalledOn: null, emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null, ...over,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Abschnitt „Zeitraum der Heizung“', () => {
  test('Jedes Auswahlfeld zeigt den gespeicherten Wert', () => {
    render(<HeatingPeriodSection plant={plant({ separateSettlement: false })} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    expect((screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }) as HTMLSelectElement).value).toBe('own')
    expect((screen.getByRole('combobox', { name: 'Heizperiode beginnt im' }) as HTMLSelectElement).value).toBe('5')
    expect((screen.getByRole('combobox', { name: 'Rechnen Sie die Heizkosten getrennt ab, mit eigener Heizkostenvorauszahlung?' }) as HTMLSelectElement).value).toBe('no')
  })

  test('Vorschau, dann Übernehmen mit den Antworten', async () => {
    const calls: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/period/preview')) {
        return json({ rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], effects: [],
          token: 'w1', moves: [{ costItemId: 'c1', description: 'Messdienst 2025/2026', amountCents: 100000, from: '2025-05', fromLabel: '2025/2026', to: '2026-01', toLabel: '2026',
            fromRange: '01.05.2025–30.04.2026', toRange: '01.01.–31.12.2026', options: [{ key: '2026-01', label: '2026', range: '01.01.–31.12.2026' }], check: false }] })
      }
      return json(plant({ periodStartMonth: null }))
    }))
    const changed = vi.fn(async () => {})
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={changed} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'object' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    await screen.findByRole('combobox', { name: /Heizperiode für „Messdienst 2025\/2026“ \(1\.000,00.€, bisher 01\.05\.2025–30\.04\.2026\)/ })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(changed).toHaveBeenCalled())
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/heating-plants/hp1/period/preview', { rules: null }],
      ['PUT', '/api/heating-plants/hp1/period', { rules: null, answers: { groups: {}, moves: { c1: '2026-01' }, overrides: {}, totals: {}, token: 'w1', understood: false } }],
    ])
  })

  test('Weicht die Heizung ab, stehen die drei Wege da, Weg 1 als Vorgabe', () => {
    render(<HeatingPeriodSection plant={plant({ periodStartMonth: null })} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    expect(screen.queryByText('Kalenderjahr, Heizung in der Heizperiode des Messdienstes')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'own' } })
    expect(screen.getByText('Kalenderjahr, Heizung in der Heizperiode des Messdienstes')).toBeTruthy()
    expect(screen.getByText('Alles auf den Zeitraum des Messdienstes umstellen')).toBeTruthy()
    expect(screen.getByText('Den Messdienst auf den 31.12. umstellen lassen')).toBeTruthy()
    expect(screen.getAllByText('Vorgabe')).toHaveLength(1)
  })
})

describe('Laienprobe B11, B3a', () => {
  const separatePreview = {
    separate: true, way: 'separate', month: '2025-05', earliestMonth: null, until: null, earliestUntil: null, share: { permille: 861, source: 'Abrechnung 2024' },
    steps: [{ tenancyId: 't1', tenantName: 'Familie Beispiel', rows: [{ from: '2025-05', totalCents: 25000, heatingCents: 21500 }] }],
    overrides: [], deadlines: [], keep: [], merge: [], blocked: [], token: 's1',
    effects: [{ label: '01.01.–30.06.2025', deadline: '2026-06-30', passed: true, replaces: [], tenants: [{ tenantName: 'Familie Beispiel', beforeCents: 17846, afterCents: -25154 }], lostClaimsCents: 25154 }],
  }
  test('„Ja, getrennt“: nach dem Zeitraum öffnet sich gleich die Aufteilung; mit abgelaufener Frist erst nach der Bestätigung übernehmbar', async () => {
    const calls: string[] = []
    const puts: unknown[] = []
    let conflict = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/separate') && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)))
        if (conflict) return json({ error: 'veraltet', preview: { ...separatePreview, token: 's2' } }, 409)
      }
      if (url.endsWith('/period/preview')) return json({ rules: { startMonth: 5, changes: [] }, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], effects: [], token: 'w1', moves: [] })
      if (url.endsWith('/separate/preview')) return json(separatePreview)
      return json(plant())
    }))
    const notes: string[] = []
    render(<HeatingPeriodSection plant={plant({ periodStartMonth: null })} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={(t) => notes.push(t)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'own' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Rechnen Sie die Heizkosten getrennt ab, mit eigener Heizkostenvorauszahlung?' }), { target: { value: 'yes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }))
    await screen.findByText(/Familie Beispiel: vorher Guthaben 178,46 €, nachher Nachzahlung 251,54 €/)
    expect(calls).toContain('POST /api/heating-plants/hp1/separate/preview')
    expect(notes.at(-1)).toMatch(/Noch nicht eingeschaltet ist die getrennte Heizkostenabrechnung/)
    const uebernehmen = screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement
    expect(uebernehmen.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Ich habe verstanden/ }))
    expect(uebernehmen.disabled).toBe(false)
    // Review Runde 1: Die Bestätigung geht an den Server; nach einer 409 gilt sie nicht mehr.
    conflict = true
    fireEvent.click(uebernehmen)
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ answers: { understood: true } }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(true))
  })

  // Systemprüfung 20.11.2026: Die erste Vorschau rechnet mit dem vorbelegten Heizanteil (ohne Anteil 0,00 €) und zeigt
  // deshalb keine abgelaufene Frist. Erst das Speichern mit den eingetragenen Beträgen ergibt die Rückfrage (409 mit
  // neuer Vorschau). Die neue Vorschau darf die Eingaben nicht auf 0,00 zurücksetzen.
  test('eine neue Vorschau des Servers nach „Speichern“ behält die eingetragenen Heizanteile', async () => {
    const stepsWith = (other: number) => [
      { tenancyId: 't1', tenantName: 'Familie Beispiel', rows: [{ from: '2025-05', totalCents: 25000, heatingCents: 0 }] },
      { tenancyId: 't2', tenantName: 'Herr Muster', rows: [{ from: '2025-05', totalCents: 20000, heatingCents: other }] },
    ]
    const first = { ...separatePreview, share: null, steps: stepsWith(0), effects: [] }
    const puts: { answers: { steps: unknown; understood: boolean } }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/separate') && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)))
        if (puts.length === 1) return json({ error: 'Bitte bestätigen Sie das in der Vorschau; gespeichert wurde nichts.', preview: { ...first, steps: stepsWith(5000), effects: separatePreview.effects } }, 409)
        return json(plant())
      }
      if (url.endsWith('/separate/preview')) return json(first)
      return json(plant())
    }))
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Getrennte Heizkostenabrechnung einschalten' }))
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    const name = /Familie Beispiel ab 05\/2025: davon Heizung/
    fireEvent.change(await screen.findByRole('textbox', { name }), { target: { value: '120,00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ich habe verstanden/ }))
    expect((screen.getByRole('textbox', { name }) as HTMLInputElement).value).toBe('120,00')
    // Durchsicht: Ein unberührtes Feld nimmt die Vorbelegung der neuen Vorschau.
    expect((screen.getByRole('textbox', { name: /Herr Muster ab 05\/2025: davon Heizung/ }) as HTMLInputElement).value).toBe('50,00')
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1].answers).toMatchObject({ steps: { t1: { '2025-05': 12000 }, t2: { '2025-05': 5000 } }, understood: true })
  })
})

test('Review Runde 2: Wechsel der Heizperiode mit abgelaufener Frist erst nach Bestätigung, und sie geht mit', async () => {
  const puts: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/period/preview')) {
      return json({ rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], moves: [], token: 'w1',
        effects: [{ label: '2024', deadline: '2025-12-31', passed: true, replaces: [], tenants: [{ tenantName: 'Müller', beforeCents: 260000, afterCents: 360000 }], lostClaimsCents: 0 }] })
    }
    if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)))
    return json(plant({ periodStartMonth: null }))
  }))
  render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'object' } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  await screen.findByText(/Müller: vorher Guthaben 2\.600,00.€, nachher Guthaben 3\.600,00.€/)
  // Review Runde 3 (N4): auch hier der früheste Wechsel mit offener Frist.
  expect(screen.getByText(/wechseln Sie frühestens ab/)).toBeTruthy()
  const uebernehmen = screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement
  expect(uebernehmen.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: /Ich habe verstanden/ }))
  fireEvent.click(uebernehmen)
  await waitFor(() => expect(puts.at(-1)).toMatchObject({ answers: { understood: true } }))
})

// #287: Safari und Firefox kennen `type="month"` nicht; Monat und Jahr sind zwei Auswahllisten, und
// sie zeigen, was im Formular steht (CLAUDE.md: sonst zeigt der Browser den ersten Eintrag).
describe('Monatsauswahl der Heizung (#287)', () => {
  test('„Neue Heizperiode beginnt ab“: Monat und Jahr zeigen den gewählten Wert und gehen als JJJJ-MM in die Vorschau', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)))
      if (url.endsWith('/period/preview')) return json({ rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], effects: [], token: 'w1', moves: [] })
      return json(plant())
    }))
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Ab einem Monat' }))
    const monat = screen.getByRole('textbox', { name: 'Neue Heizperiode beginnt ab Monat' }) as HTMLInputElement
    const year = String(new Date().getFullYear() + 1)
    fireEvent.change(monat, { target: { value: `10.${year}` } })
    fireEvent.blur(monat)
    expect(monat.value).toBe(`Oktober ${year}`)
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    await waitFor(() => expect(JSON.stringify(bodies.at(-1))).toContain(`"${year}-10"`))
  })

  test('getrennte Heizkostenabrechnung: der Monat aus der Vorschau steht in der Auswahl', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/separate/preview')) {
        return json({ separate: true, way: 'separate', month: '2025-05', earliestMonth: null, until: null, earliestUntil: null, share: null, steps: [], overrides: [], deadlines: [], keep: [], merge: [], blocked: [], token: 's1', effects: [] })
      }
      return json(plant())
    }))
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Getrennte Heizkostenabrechnung einschalten' }))
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    const label = 'Ab welchem Monat zahlen die Mieter eine eigene Heizkostenvorauszahlung?'
    const monat = await screen.findByRole('textbox', { name: label }) as HTMLInputElement
    await waitFor(() => expect(monat.value).toBe('Mai 2025'))
  })

  test('getrennte Heizkostenabrechnung: ein Monat ohne Jahr wird nicht an den Server geschickt, sondern am Feld gemeldet', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return json(plant())
    }))
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Getrennte Heizkostenabrechnung einschalten' }))
    const monat = screen.getByRole('textbox', { name: 'Ab welchem Monat zahlen die Mieter eine eigene Heizkostenvorauszahlung?' })
    fireEvent.change(monat, { target: { value: '03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    expect(await screen.findByText('Monat: Geben Sie zum Monat auch das Jahr ein, etwa „3.2025“.')).toBeTruthy()
    expect(monat.getAttribute('aria-invalid')).toBe('true')
    expect(calls.some((u) => u.endsWith('/separate/preview'))).toBe(false)
  })
})

// #346 Schritt 12 (aus den Durchsichten): „Zeitraum der Heizung ändern“ und die getrennte Heizkostenabrechnung öffnen
// im Seitenfenster wie der Wechsel des Abrechnungszeitraums (Schritt 7). „Speichern“ steht im Fuß und ist bis zur
// Vorschau gesperrt; eine Änderung danach verwirft die Vorschau (wie Durchsicht M2 beim Abrechnungszeitraum).
describe('Seitenfenster', () => {
  const preview = { rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], effects: [], token: 'w1', moves: [] }
  test('Zeitraum der Heizung: Seitenfenster, Speichern erst nach der Vorschau, eine Änderung verwirft sie', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(preview)))
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    const drawer = screen.getByRole('dialog', { name: 'Zeitraum der Heizung ändern' })
    const save = () => within(drawer).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement
    expect(save().disabled).toBe(true)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Vorschau' }))
    await waitFor(() => expect(save().disabled).toBe(false))
    fireEvent.change(within(drawer).getByRole('combobox', { name: 'Heizperiode beginnt im' }), { target: { value: '6' } })
    expect(save().disabled).toBe(true)
  })
  test('getrennte Heizkostenabrechnung: ebenfalls im Seitenfenster', () => {
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Getrennte Heizkostenabrechnung einschalten' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

// Durchsicht des Seitenfensters: Eine Vorschau, deren Antwort erst nach einer Änderung ankommt, gilt nicht (sonst
// kehrte M2 zurück); ohne Vorschau sagt ein Satz, warum „Speichern“ gesperrt ist; das zweite Fenster nach dem
// Speichern des Zeitraums ist vorbelegt und fragt beim Schließen.
describe('Seitenfenster, Durchsicht', () => {
  const preview = { rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], effects: [], token: 'w1', moves: [] }
  test('eine verspätete Vorschau nach einer Änderung gibt „Speichern“ nicht frei', async () => {
    let answer: (r: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve })))
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    const drawer = screen.getByRole('dialog', { name: 'Zeitraum der Heizung ändern' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Vorschau' }))
    fireEvent.change(within(drawer).getByRole('combobox', { name: 'Heizperiode beginnt im' }), { target: { value: '6' } })
    answer(json(preview))
    await new Promise((r) => setTimeout(r, 20))
    expect((within(drawer).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(drawer).getByText(/Sie haben die Angaben geändert\. Fordern Sie die Vorschau erneut an/)).toBeTruthy()
  })
  test('nach dem Speichern des Zeitraums fragt das vorbelegte Fenster zur getrennten Abrechnung beim Schließen', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/period/preview')) return json(preview)
      if (url.endsWith('/separate/preview')) return json({ separate: true, month: '2026-05', until: null, blocked: [], share: null, steps: [], overrides: [], deadlines: [], effects: [], keep: [], merge: [], token: 's1' })
      return json({})
    }))
    render(<UIProvider><HeatingPeriodSection plant={plant({ periodStartMonth: null })} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} /></UIProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    const first = screen.getByRole('dialog', { name: 'Zeitraum der Heizung ändern' })
    fireEvent.change(within(first).getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'own' } })
    fireEvent.change(within(first).getByRole('combobox', { name: /getrennt ab/ }), { target: { value: 'yes' } })
    fireEvent.click(within(first).getByRole('button', { name: 'Vorschau' }))
    await waitFor(() => expect((within(first).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(first).getByRole('button', { name: 'Speichern' }))
    const second = await screen.findByRole('dialog', { name: /Vorauszahlung aufteilen|getrennte Heizkostenabrechnung/i })
    await waitFor(() => expect((within(second).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(second).getByRole('button', { name: 'Abbrechen' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })
})

// #704: Rechnet die Heizung im Zeitraum des Objekts ab, gab es keinen Weg, die Vorauszahlung aufzuteilen.
describe('#704: Vorauszahlung aufteilen bei gleichem Zeitraum', () => {
  const on = { separate: true, way: 'samePeriod', month: '2026-01', earliestMonth: null, until: null, earliestUntil: null, blocked: [], share: null,
    steps: [{ tenancyId: 't1', tenantName: 'Meier', rows: [{ from: '2026-01', totalCents: 30000, heatingCents: 12000 }] }], overrides: [], deadlines: [], effects: [], keep: [], merge: [], token: 's1' }
  const off = { ...on, separate: false, steps: [], merge: [{ tenancyId: 't1', tenantName: 'Meier', rows: [{ from: '2026-03', prepaymentCents: 30000 }] }], month: '2026-03', token: 's2' }
  function setup(p: HeatingPlant) {
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = []
    const notes: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, method: init?.method ?? 'GET', body })
      if (url.endsWith('/separate/preview')) return json(body.separate === true ? on : off)
      return json({})
    }))
    render(<UIProvider><HeatingPeriodSection plant={p} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={(t) => notes.push(t)} /></UIProvider>)
    return { calls, notes }
  }

  test('ohne gespeicherte Antwort: der Knopf ist da, der Satz erklärt ihn, und gespeichert wird die Aufteilung', async () => {
    const { calls, notes } = setup(plant({ periodStartMonth: null, separateSettlement: null }))
    expect(screen.getByText(/eigene Vorauszahlung für Heizung und Warmwasser/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Vorauszahlung wieder zusammenführen' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Vorauszahlung aufteilen' }))
    const drawer = screen.getByRole('dialog', { name: 'Vorauszahlung aufteilen' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Vorschau' }))
    const field = await within(drawer).findByLabelText(/Meier ab 01\/2026: davon Heizung/) as HTMLInputElement
    expect(field.value).toBe('120,00')
    expect(calls.find((c) => c.url.endsWith('/separate/preview'))?.body).toEqual({ separate: true })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(notes).toEqual(['Vorauszahlung aufgeteilt. Neue Mietverhältnisse bekommen ihre Heizvorauszahlung im Formular des Mietverhältnisses.']))
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ separate: true, month: '2026-01', answers: { steps: { t1: { '2026-01': 12000 } }, token: 's1' } })
  })

  test('schon aufgeteilt: erneut aufteilen fragt die Aufteilung an, zusammenführen schickt den gewählten Monat als Monat', async () => {
    const { calls, notes } = setup(plant({ periodStartMonth: null, separateSettlement: true }))
    expect(screen.queryByText(/eigene Vorauszahlung für Heizung und Warmwasser/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Vorauszahlung aufteilen' }))
    const first = screen.getByRole('dialog', { name: 'Vorauszahlung aufteilen' })
    fireEvent.click(within(first).getByRole('button', { name: 'Vorschau' }))
    await within(first).findByLabelText(/Meier ab 01\/2026: davon Heizung/)
    expect(calls.at(-1)?.body).toEqual({ separate: true })
    fireEvent.click(within(first).getByRole('button', { name: 'Abbrechen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Vorauszahlung aufteilen' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Vorauszahlung wieder zusammenführen' }))
    const second = screen.getByRole('dialog', { name: 'Vorauszahlung wieder zusammenführen' })
    fireEvent.change(within(second).getByRole('textbox', { name: /Ab welchem Monat/ }), { target: { value: '3.2026' } })
    fireEvent.click(within(second).getByRole('button', { name: 'Vorschau' }))
    // Durchsicht M4: Bei gleichem Zeitraum gibt es kein Häkchen; ohne Zusammenführen bliebe alles aufgeteilt.
    await within(second).findByText(/Meier ab 03\/2026: wieder eine Vorauszahlung von 300,00 €/)
    expect(within(second).queryByRole('checkbox')).toBeNull()
    expect(calls.at(-1)?.body).toEqual({ separate: false, month: '2026-03' })
    fireEvent.click(within(second).getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(notes).toEqual(['Vorauszahlung wieder zusammengeführt.']))
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ separate: false, month: '2026-03', answers: { merge: true } })
  })
})

// Die Einrichtung „Heizung“ (Heizung PR 4, Entwurf 11.2), ohne DOM.
import { describe, expect, test } from 'vitest'
import { asksNewInstall, emptyHeatingForm, heatingPlantBody, heatingSummary, heatingToForm, whoHint, whoOptions, type HeatingForm } from './heatingForm'
import type { HeatingPlant, Unit } from './types'

const UNITS: Pick<Unit, 'id' | 'name' | 'noConnection'>[] = [{ id: 'eg', name: 'EG' }, { id: 'og', name: 'OG' }, { id: 'garage', name: 'Garage', noConnection: ['waerme'] }]
const ausgefuellt = (over: Partial<HeatingForm> = {}): HeatingForm => ({ ...emptyHeatingForm(UNITS), energy: 'gas', who: 'service', ...over })
const PLANT: HeatingPlant = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'heatPump', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'partial', devicesInstalledAfter2021: 'some', source: 'building', captureInstalledOn: '2025-06-01', capturedOnOct2024: false,
  warmRentAverageCents: 123456, changeSplit: 'degreeDays', periodStartMonth: null, units: [{ unitId: 'og', heatedAreaM2: null }],
  newDevicesInstall: 'single',
}

describe('Einrichtung Heizung', () => {
  test('Vorgabe: alle Wohnungen außer denen ohne Wärmeanschluss, und so heißt die Liste „alle“', () => {
    expect(emptyHeatingForm(UNITS).unitIds).toEqual(['eg', 'og'])
    expect(heatingPlantBody(ausgefuellt(), UNITS)).toEqual({
      body: {
        energy: 'gas', supply: 'central', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
        capturedOnOct2024: null, captureInstalledOn: null, warmRentAverageCents: null, units: null, newDevicesInstall: null,
      },
    })
    expect(heatingPlantBody(ausgefuellt({ unitIds: ['og'] }), UNITS)).toMatchObject({ body: { units: [{ unitId: 'og', heatedAreaM2: null }] } })
  })

  test('Ohne Antwort ein Satz statt einer Anlage', () => {
    expect(heatingPlantBody(emptyHeatingForm(UNITS), UNITS)).toEqual({ error: 'Bitte wählen Sie, womit geheizt wird.' })
    expect(heatingPlantBody({ ...emptyHeatingForm(UNITS), energy: 'gas' }, UNITS)).toEqual({ error: 'Bitte wählen Sie, wer die Heizkostenabrechnung erstellt.' })
    expect(heatingPlantBody(ausgefuellt({ unitIds: [] }), UNITS)).toEqual({ error: expect.stringMatching(/mindestens eine Wohnung/) })
  })

  test('Eigene Heizung je Wohnung: beim Mieter keine Anlage, beim Vermieter später', () => {
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit' }), UNITS)).toEqual({ error: 'Wer hat den Vertrag für die Heizung in der Wohnung?' })
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit', contract: 'tenant' }), UNITS)).toEqual({ none: expect.stringMatching(/keine Heizanlage/) })
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit', contract: 'landlord' }), UNITS)).toEqual({ error: expect.stringMatching(/späteren Version/) })
  })

  test('Eigene Abrechnung kommt später', () => {
    expect(heatingPlantBody(ausgefuellt({ who: 'self' }), UNITS)).toEqual({ error: expect.stringMatching(/eigene Heizkostenabrechnung kommt mit einer späteren Version/) })
    expect(whoHint('self', 'mfh')).toMatch(/späteren Version/)
  })

  test('Eigentumswohnung: die Gemeinschaft rechnet ab, übernommen wie vom Messdienst', () => {
    expect(whoOptions('etw')[0]).toEqual({ value: 'homeowners', label: 'Die Gemeinschaft (Hausverwaltung) rechnet ab' })
    expect(whoOptions('mfh').some((o) => o.value === 'homeowners')).toBe(false)
    expect(heatingPlantBody(ausgefuellt({ who: 'homeowners' }), UNITS)).toMatchObject({ body: { method: 'service', source: 'homeowners' } })
  })

  test('Wärmepumpe: Erfassung und Durchschnittskosten nur bei ihr', () => {
    expect(heatingPlantBody(ausgefuellt({ energy: 'heatPump', captured: 'no', captureInstalledOn: '2025-06-01', warmRentAverage: '1.234,56' }), UNITS))
      .toMatchObject({ body: { capturedOnOct2024: false, captureInstalledOn: '2025-06-01', warmRentAverageCents: 123456 } })
    expect(heatingPlantBody(ausgefuellt({ captured: 'no', captureInstalledOn: '2025-06-01', warmRentAverage: '1.234,56' }), UNITS))
      .toMatchObject({ body: { capturedOnOct2024: null, captureInstalledOn: null, warmRentAverageCents: null } })
    expect(heatingPlantBody(ausgefuellt({ energy: 'heatPump', warmRentAverage: 'viel' }), UNITS)).toEqual({ error: expect.stringMatching(/Betrag/) })
  })

  test('Niemand: der Satz nennt die Regel der Verordnung, im Zweifamilienhaus auch § 2', () => {
    expect(whoHint('manual', 'mfh')).toMatch(/50 bis 70 % der Heizkosten nach Verbrauch/)
    expect(whoHint('manual', 'mfh')).toMatch(/um 15 % kürzen/)
    expect(whoHint('manual', 'mfh')).not.toMatch(/§ 2/)
    expect(whoHint('manual', 'zfh')).toMatch(/§ 2 HeizkostenV/)
  })

  test('Bearbeiten: was gespeichert ist, steht wieder im Formular und geht unverändert zurück', () => {
    const form = heatingToForm(PLANT, UNITS)
    expect(form).toMatchObject({ energy: 'heatPump', who: 'service', unitIds: ['og'], remote: 'partial', installedAfter: 'some', captured: 'no', captureInstalledOn: '2025-06-01', warmRentAverage: '1.234,56' })
    expect(heatingPlantBody(form, UNITS)).toMatchObject({ body: { units: [{ unitId: 'og', heatedAreaM2: null }], warmRentAverageCents: 123456, capturedOnOct2024: false } })
    expect(heatingToForm({ ...PLANT, units: null }, UNITS).unitIds).toEqual(['eg', 'og'])
    expect(heatingToForm({ ...PLANT, source: 'homeowners' }, UNITS).who).toBe('homeowners')
  })

  test('Zusammenfassung auf der Karte', () => {
    expect(heatingSummary(PLANT, UNITS)).toEqual([
      'Energie: Wärmepumpe',
      'Abrechnung: Ein Messdienst oder die Hausverwaltung',
      'Angeschlossen: OG',
      'Aus der Ferne ablesbar: Nur einige',
    ])
    expect(heatingSummary({ ...PLANT, units: null }, UNITS)[2]).toBe('Angeschlossen: alle Wohnungen')
    expect(heatingSummary({ ...PLANT, units: [] }, UNITS)[2]).toBe('Angeschlossen: keine Wohnung')
  })

  test('Frage nach dem Einbau: nur, wenn nicht fernablesbare Geräte nach dem Stichtag dazukamen (Nachprüfung von #230)', () => {
    expect(asksNewInstall(ausgefuellt())).toBe(false)
    expect(asksNewInstall(ausgefuellt({ remote: 'all', installedAfter: 'all' }))).toBe(false)
    expect(asksNewInstall(ausgefuellt({ remote: 'none', installedAfter: 'none' }))).toBe(false)
    expect(asksNewInstall(ausgefuellt({ remote: 'none', installedAfter: 'some' }))).toBe(true)
    expect(asksNewInstall(ausgefuellt({ remote: 'partial', installedAfter: 'all' }))).toBe(true)
    expect(heatingPlantBody(ausgefuellt({ remote: 'none', installedAfter: 'all', newInstall: 'whole' }), UNITS)).toMatchObject({ body: { newDevicesInstall: 'whole' } })
    // Nicht mehr gefragt: die Antwort geht nicht mit.
    expect(heatingPlantBody(ausgefuellt({ remote: 'all', installedAfter: 'all', newInstall: 'whole' }), UNITS)).toMatchObject({ body: { newDevicesInstall: null } })
    expect(heatingToForm(PLANT, UNITS).newInstall).toBe('single')
  })
})

// Die Einrichtung „Heizung“ (Heizung PR 4, Entwurf 11.2), ohne DOM.
import { describe, expect, test } from 'vitest'
import { asksNewInstall, asksTakeOver, buildingOptions, canSwap, connectionNote, emptyHeatingForm, emptySwapForm, HOT_WATER_OPTIONS, hotWaterBody, isFormula, PER_UNIT_ENERGY_OPTIONS, plantOptions, swapBody, swapMetersOf, unmeasurableLabel, heatingPlantBody, heatingSummary, heatingToForm, whoHint, whoOptions, type HeatingForm } from './heatingForm'
import type { HeatingPlant, Unit } from './types'

const UNITS: Pick<Unit, 'id' | 'name' | 'noConnection'>[] = [{ id: 'eg', name: 'EG' }, { id: 'og', name: 'OG' }, { id: 'garage', name: 'Garage', noConnection: ['waerme'] }]
const ausgefuellt = (over: Partial<HeatingForm> = {}): HeatingForm => ({ ...emptyHeatingForm(UNITS), energy: 'gas', who: 'service', ...over })
const PLANT: HeatingPlant = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'heatPump', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'partial', devicesInstalledAfter2021: 'some', source: 'building', captureInstalledOn: '2025-06-01', capturedOnOct2024: false,
  warmRentAverageCents: 123456, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: [{ unitId: 'og', heatedAreaM2: null }],
  newDevicesInstall: 'single', nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null, hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null,
}

describe('Einrichtung Heizung', () => {
  test('Vorgabe: alle Wohnungen außer denen ohne Wärmeanschluss, und so heißt die Liste „alle“', () => {
    expect(emptyHeatingForm(UNITS).unitIds).toEqual(['eg', 'og'])
    expect(heatingPlantBody(ausgefuellt(), UNITS)).toEqual({
      body: {
        energy: 'gas', supply: 'central', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
        capturedOnOct2024: null, captureInstalledOn: null, warmRentAverageCents: null, heatPumpInstalledOn: null, units: null, newDevicesInstall: null, name: '', buildingWith: null,
      },
      adjust: [],
      setUpSelf: false,
    })
    expect(heatingPlantBody(ausgefuellt({ unitIds: ['og'] }), UNITS)).toMatchObject({ body: { units: [{ unitId: 'og', heatedAreaM2: null }] } })
  })

  test('Ohne Antwort ein Satz statt einer Anlage', () => {
    expect(heatingPlantBody(emptyHeatingForm(UNITS), UNITS)).toEqual({ error: 'Bitte wählen Sie, womit geheizt wird.' })
    expect(heatingPlantBody({ ...emptyHeatingForm(UNITS), energy: 'gas' }, UNITS)).toEqual({ error: 'Bitte wählen Sie, wer die Heizkostenabrechnung erstellt.' })
    expect(heatingPlantBody(ausgefuellt({ unitIds: [] }), UNITS)).toEqual({ error: expect.stringMatching(/mindestens eine Wohnung/) })
  })

  test('Eigene Heizung je Wohnung: beim Mieter keine Anlage, beim Vermieter eine Etagenheizung', () => {
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit' }), UNITS)).toEqual({ error: 'Wer hat den Vertrag für die Heizung in der Wohnung?' })
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit', contract: 'tenant' }), UNITS)).toEqual({ none: expect.stringMatching(/keine Heizanlage/) })
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit', contract: 'landlord' }), UNITS)).toEqual({ error: 'Womit heizen die Etagenheizungen?' })
  })

  test('„Ich selbst“: die Anlage entsteht zunächst bei „Niemand“, Schritt 7 stellt sie um (Heizung PR 10, Abweichung 21)', () => {
    expect(whoHint('self', 'mfh')).toMatch(/Wärmezähler und Warmwasserzähler/)
    expect(whoHint('self', 'mfh')).not.toMatch(/späteren Version/)
    expect(heatingPlantBody(ausgefuellt({ who: 'self' }), UNITS)).toMatchObject({ body: { method: 'manual' }, setUpSelf: true })
  })

  test('Wärmepumpe erst nach dem Stichtag eingebaut: Einbaudatum statt Erfassung (§ 12 Abs. 3, Heizung PR 10)', () => {
    const base = ausgefuellt({ energy: 'heatPump', who: 'manual', captured: 'newer' })
    expect(heatingPlantBody(base, UNITS)).toEqual({ error: expect.stringMatching(/Einbaudatum/) })
    expect(heatingPlantBody({ ...base, heatPumpInstalledOn: '2024-09-01' }, UNITS)).toEqual({ error: expect.stringMatching(/bis zum 01\.10\.2024/) })
    expect(heatingPlantBody({ ...base, heatPumpInstalledOn: '2025-03-01' }, UNITS)).toMatchObject({ body: { capturedOnOct2024: null, captureInstalledOn: null, heatPumpInstalledOn: '2025-03-01' }, setUpSelf: false })
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
    // Sichtprüfung E9: „alle Wohnungen“ stimmte nicht, wenn eine Einheit keinen Wärmeanschluss hat.
    expect(heatingSummary({ ...PLANT, units: null }, UNITS)[2]).toBe('Angeschlossen: alle Wohnungen außer Garage (ohne Wärmeanschluss)')
    expect(heatingSummary({ ...PLANT, units: null }, UNITS.slice(0, 2))[2]).toBe('Angeschlossen: alle Wohnungen')
    expect(UNITS.map(connectionNote)).toEqual([null, null, 'ohne Wärmeanschluss laut Wohnungsdaten'])
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

test('Warmwasser laut Messdienst (Heizung PR 6): die Bestätigung des Aufwands gibt es nur zu einer Formel', () => {
  expect(HOT_WATER_OPTIONS.map((o) => o.value)).toEqual(['', 'heatMeter', 'volumeFormula', 'areaFormula'])
  expect([isFormula('volumeFormula'), isFormula('areaFormula'), isFormula('heatMeter'), isFormula('')]).toEqual([true, true, false, false])
  expect(hotWaterBody('areaFormula', true)).toEqual({ dhwMethod: 'areaFormula', dhwUnmeasurable: true })
  expect(hotWaterBody('heatMeter', true)).toEqual({ dhwMethod: 'heatMeter', dhwUnmeasurable: null })
  expect(hotWaterBody('', false)).toEqual({ dhwMethod: null, dhwUnmeasurable: null })
})

test('Bestätigung je Formel nach ihrer Voraussetzung (§ 9 Abs. 2 Satz 2 und 4 HeizkostenV, Durchsicht M1)', () => {
  expect(unmeasurableLabel('volumeFormula')).toMatch(/Wärmemenge ließe sich nur mit unzumutbar hohem Aufwand messen/)
  expect(unmeasurableLabel('areaFormula')).toMatch(/Weder die Wärmemenge noch das Volumen des verbrauchten Warmwassers lässt sich messen/)
})

describe('Mehrere Heizanlagen und Etagenheizung (Heizung PR 9)', () => {
  // Eine dritte Wohnung nur hier, damit die Vorgaben der Tests aus PR 4 bleiben.
  const UNITS3: Pick<Unit, 'id' | 'name' | 'noConnection'>[] = [...UNITS, { id: 'dg', name: 'DG' }]
  const ERSTE: HeatingPlant = { ...PLANT, id: 'hp1', name: '', units: null }

  test('Die zweite Anlage braucht einen Namen, und die erste bekommt Namen und die übrigen Wohnungen im selben Schritt', () => {
    const ohneGebaeude = { ...emptyHeatingForm(UNITS3, [ERSTE]), energy: 'gas' as const, who: 'manual' as const, unitIds: ['dg'] }
    expect(ohneGebaeude.otherNames).toEqual({ hp1: '' })
    // Recht I3 der Durchsicht von #238: die Frage nach dem Gebäude, ohne Vorbelegung.
    expect(ohneGebaeude.building).toBe('')
    expect(heatingPlantBody(ohneGebaeude, UNITS3, [ERSTE])).toEqual({ error: expect.stringMatching(/im selben Gebäude wie eine bisherige/) })
    const form = { ...ohneGebaeude, building: 'hp1' }
    expect(heatingPlantBody(form, UNITS3, [ERSTE])).toEqual({ error: 'Bitte geben Sie der neuen Heizanlage einen Namen, etwa „Haus B“ oder „Gastherme DG“.' })
    expect(heatingPlantBody({ ...form, name: 'Haus B' }, UNITS3, [ERSTE])).toEqual({ error: 'Bitte geben Sie auch der bisherigen Heizanlage einen Namen, etwa „Zentralheizung“.' })
    const result = heatingPlantBody({ ...form, name: 'Haus B', otherNames: { hp1: 'Zentralheizung' } }, UNITS3, [ERSTE])
    if (!('body' in result)) throw new Error(JSON.stringify(result))
    expect(result.body).toMatchObject({ name: 'Haus B', supply: 'central', buildingWith: 'hp1', units: [{ unitId: 'dg', heatedAreaM2: null }] })
    expect(result.adjust).toEqual([{ id: 'hp1', name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }])
  })

  test('Die neue Anlage beginnt mit den Wohnungen, die noch an keiner hängen; nimmt sie der ersten alle, ein Satz', () => {
    const begrenzt: HeatingPlant = { ...ERSTE, name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }
    expect(emptyHeatingForm(UNITS3, [begrenzt]).unitIds).toEqual(['dg'])
    expect(emptyHeatingForm(UNITS3, [ERSTE]).unitIds).toEqual([])
    const alle = { ...emptyHeatingForm(UNITS3, [ERSTE]), energy: 'gas' as const, who: 'manual' as const, name: 'Neu', otherNames: { hp1: 'Alt' }, unitIds: ['eg', 'og', 'dg'], building: 'own' }
    expect(heatingPlantBody(alle, UNITS3, [ERSTE])).toEqual({ error: 'An „Alt“ hinge dann keine Wohnung mehr. Ändern Sie stattdessen die bisherige Heizanlage.' })
  })

  test('Etagenheizung mit Vertrag beim Vermieter: Anlage perUnit mit freien Schlüsseln, ohne Vorratsenergien', () => {
    // Recht M5 der Durchsicht von #238: Fernwärme ist eine Wärmelieferung, keine Etagenheizung.
    expect(PER_UNIT_ENERGY_OPTIONS.map((o) => o.value)).toEqual(['gas', 'heatPump', 'electric', 'other'])
    const form = { ...emptyHeatingForm(UNITS3), energy: 'perUnit' as const, contract: 'landlord' as const }
    expect(heatingPlantBody(form, UNITS3)).toEqual({ error: 'Womit heizen die Etagenheizungen?' })
    // Recht I4: Direktzuordnung je Wohnung setzt einen eigenen Gaszähler voraus.
    expect(heatingPlantBody({ ...form, perUnitEnergy: 'gas' }, UNITS3)).toEqual({ error: expect.stringMatching(/eigenen Gaszähler/) })
    const result = heatingPlantBody({ ...form, perUnitEnergy: 'gas', ownMeters: true }, UNITS3)
    if (!('body' in result)) throw new Error(JSON.stringify(result))
    expect(result.body).toMatchObject({ energy: 'gas', supply: 'perUnit', method: 'manual', source: 'building', units: null })
    expect(heatingPlantBody({ ...form, contract: 'tenant' }, UNITS3)).toHaveProperty('none')
    const zurueck = heatingToForm({ ...PLANT, supply: 'perUnit', method: 'manual', energy: 'gas' }, UNITS3)
    expect([zurueck.energy, zurueck.contract, zurueck.perUnitEnergy, zurueck.ownMeters]).toEqual(['perUnit', 'landlord', 'gas', true])
    expect(heatingSummary({ ...PLANT, name: 'Gasthermen', supply: 'perUnit', method: 'manual', energy: 'gas' }, UNITS3).slice(0, 3)).toEqual([
      'Name: Gasthermen', 'Energie: Gas, Etagenheizung je Wohnung (Vertrag bei Ihnen)', 'Abrechnung: Direktzuordnung der Rechnung jeder Wohnung',
    ])
  })

  test('Ändern einer Anlage: Name Pflicht, sobald es eine weitere gibt; keine Anpassung anderer Anlagen', () => {
    const zweite: HeatingPlant = { ...PLANT, id: 'hp2', name: 'Haus B', units: [{ unitId: 'dg', heatedAreaM2: null }] }
    const erste: HeatingPlant = { ...PLANT, id: 'hp1', name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }
    const form = heatingToForm(erste, UNITS3)
    expect(form.name).toBe('Zentralheizung')
    expect(heatingPlantBody({ ...form, name: ' ' }, UNITS3, [zweite], 'hp1')).toEqual({ error: 'Bitte geben Sie der Heizanlage einen Namen.' })
    const result = heatingPlantBody(form, UNITS3, [zweite], 'hp1')
    if (!('body' in result)) throw new Error(JSON.stringify(result))
    expect(result.adjust).toEqual([])
    expect(result.body.units).toEqual([{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }])
  })

  test('Gebäude: jede laufende andere Anlage oder ein eigenes Gebäude (Recht I3 der Durchsicht von #238)', () => {
    const alt: HeatingPlant = { ...PLANT, id: 'alt', name: 'Öl', endsOn: '2024-12-31' }
    const zentral: HeatingPlant = { ...PLANT, id: 'hp1', name: '' }
    expect(buildingOptions([alt, zentral], { hp1: 'Zentralheizung' })).toEqual([
      { value: 'hp1', label: 'Ja, im selben Gebäude wie „Zentralheizung“' },
      { value: 'own', label: 'Nein, in einem anderen Gebäude' },
    ])
  })

  test('Gebäude: Zeigt die gespeicherte Antwort auf eine stillgelegte Anlage, steht dort die laufende ihrer Linie mit dem gespeicherten Wert', () => {
    const alt: HeatingPlant = { ...PLANT, id: 'A', name: 'Öl', endsOn: '2025-06-30' }
    const neu: HeatingPlant = { ...PLANT, id: 'A2', name: 'Fernwärme', replacesPlantId: 'A' }
    expect(buildingOptions([alt, neu], {}, 'A')).toEqual([
      { value: 'A', label: 'Ja, im selben Gebäude wie „Fernwärme“' },
      { value: 'own', label: 'Nein, in einem anderen Gebäude' },
    ])
    expect(buildingOptions([alt, neu], {}, 'own')[0]).toEqual({ value: 'A2', label: 'Ja, im selben Gebäude wie „Fernwärme“' })
  })

  test('Öl → Öl: Die Antwort auf „Verheizt der neue Kessel …?“ geht mit, wenn die Anlage sie hat', () => {
    const neu: HeatingPlant = { ...PLANT, id: 'hp2', energy: 'oil', method: 'manual', name: 'Neu', replacesPlantId: 'hp1', takesOverStock: false }
    const form = heatingToForm(neu, UNITS3)
    expect(form.takesOverStock).toBe('no')
    const result = heatingPlantBody({ ...form, takesOverStock: 'yes' }, UNITS3, [{ ...PLANT, energy: 'oil', endsOn: '2025-06-30' }], 'hp2')
    if (!('body' in result)) throw new Error(JSON.stringify(result))
    expect(result.body.takesOverStock).toBe(true)
    expect('takesOverStock' in (heatingPlantBody(heatingToForm(PLANT, UNITS3), UNITS3) as { body: object }).body).toBe(false)
  })

  test('Auswahl der Anlage erst ab zwei; eine stillgelegte Anlage nur, wenn sie gerade gewählt ist', () => {
    expect(plantOptions([{ ...PLANT, id: 'hp1', name: 'A' }])).toEqual([])
    expect(plantOptions([{ ...PLANT, id: 'hp1', name: 'A' }, { ...PLANT, id: 'hp2', name: 'B' }])).toEqual([{ value: 'hp1', label: 'A' }, { value: 'hp2', label: 'B' }])
    const tausch: HeatingPlant[] = [{ ...PLANT, id: 'hp1', name: 'Öl', endsOn: '2025-06-30' }, { ...PLANT, id: 'hp2', name: 'Gas', replacesPlantId: 'hp1' }]
    expect(plantOptions(tausch))
      .toEqual([{ value: 'hp1', label: 'Öl (bis 30.06.2025)' }, { value: 'hp2', label: 'Gas' }])
  })
})

describe('Kessel getauscht (Heizung PR 9)', () => {
  const OEL: HeatingPlant = { ...PLANT, energy: 'oil', method: 'manual', name: '', units: null }

  test('Tag und neuer Energieträger sind Pflicht; die Namen sind vorbelegt', () => {
    const f = emptySwapForm(OEL)
    expect(f).toEqual({ date: '', energy: '', name: '', previousName: '', takesOverStock: 'yes' })
    expect(swapBody(f, OEL)).toEqual({ error: 'Bitte wählen Sie den Tag, an dem die neue Heizung in Betrieb ging.' })
    expect(swapBody({ ...f, date: '2025-07-01' }, OEL)).toEqual({ error: 'Womit heizt die neue Heizung?' })
    expect(swapBody({ ...f, date: '2025-07-01', energy: 'gas', name: ' Gastherme ', previousName: 'Ölkessel' }, OEL))
      .toEqual({ body: { date: '2025-07-01', energy: 'gas', name: 'Gastherme', previousName: 'Ölkessel' } })
  })

  test('Öl → Öl fragt, ob der neue Kessel den Brennstoff im Tank weiter verheizt; vorbelegt ist ja (Nachprüfung von #238)', () => {
    const f = { ...emptySwapForm(OEL), date: '2025-07-01', energy: 'oil' as const }
    expect(asksTakeOver(f, OEL)).toBe(true)
    expect(asksTakeOver({ energy: 'gas' }, OEL)).toBe(false)
    expect(swapBody(f, OEL)).toEqual({ body: { date: '2025-07-01', energy: 'oil', name: '', previousName: '', takesOverStock: true } })
    expect(swapBody({ ...f, takesOverStock: 'no' }, OEL)).toMatchObject({ body: { takesOverStock: false } })
  })

  test('Tauschen lässt sich nur eine laufende zentrale Anlage ohne getrennte Heizkostenabrechnung', () => {
    expect(canSwap(OEL)).toBe(true)
    expect(canSwap({ ...OEL, endsOn: '2025-06-30' })).toBe(false)
    expect(canSwap({ ...OEL, supply: 'perUnit' })).toBe(false)
    expect(canSwap({ ...OEL, separateSpans: [{ from: '2025-05', until: null }] })).toBe(false)
  })

  test('Die Zusammenfassung nennt Stilllegung und Nachfolge', () => {
    const alt: HeatingPlant = { ...OEL, name: 'Ölkessel', endsOn: '2025-06-30' }
    const neu: HeatingPlant = { ...OEL, id: 'hp2', energy: 'gas', name: 'Gastherme', replacesPlantId: 'hp1' }
    expect(heatingSummary(alt, UNITS, [alt, neu])).toContain('Außer Betrieb seit 01.07.2025, ersetzt durch „Gastherme“')
    expect(heatingSummary(neu, UNITS, [alt, neu])).toContain('In Betrieb seit 01.07.2025, ersetzt „Ölkessel“')
  })
})

describe('Durchsicht von #239, I3: Kesseltausch bei eigener Heizkostenabrechnung', () => {
  test('fragt die Zähler der Linie ab und schickt die eingetragenen Stände', () => {
    const plants = [{ id: 'alt', replacesPlantId: null }, { id: 'hp', replacesPlantId: 'alt' }, { id: 'fremd', replacesPlantId: null }]
    const meters = [
      { id: 'dh', name: 'Speicher', heatingPlantId: 'alt', heatingRole: 'dhwHeat' },
      { id: 'x', name: 'Fremd', heatingPlantId: 'fremd', heatingRole: 'dhwHeat' },
      { id: 'w', name: 'Wärme A', heatingPlantId: null, heatingRole: null, unitId: 'a' },
    ] as unknown as Parameters<typeof swapMetersOf>[2]
    expect(swapMetersOf({ id: 'hp', method: 'self', replacesPlantId: 'alt' }, plants, meters).map((m) => m.id)).toEqual(['dh'])
    expect(swapMetersOf({ id: 'hp', method: 'manual', replacesPlantId: 'alt' }, plants, meters)).toEqual([])
    const f = { ...emptySwapForm({ name: 'Gas' }), date: '2025-07-01', energy: 'districtHeating' as const }
    expect(swapBody({ ...f, meterValues: { dh: '4.500' } }, { energy: 'gas' }, [{ id: 'dh', name: 'Speicher' }])).toEqual({ body: { date: '2025-07-01', energy: 'districtHeating', name: '', previousName: 'Gas', meterReadings: [{ meterId: 'dh', value: 4500 }] } })
    expect(swapBody({ ...f, meterValues: { dh: 'viel' } }, { energy: 'gas' }, [{ id: 'dh', name: 'Speicher' }])).toEqual({ error: 'Der Stand für „Speicher“ ist keine Zahl.' })
    expect(swapBody(f, { energy: 'gas' }, [{ id: 'dh', name: 'Speicher' }])).toEqual({ body: { date: '2025-07-01', energy: 'districtHeating', name: '', previousName: 'Gas' } })
  })
})

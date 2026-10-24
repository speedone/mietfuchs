// Die Einrichtung „Heizung“ (Heizung PR 4, Entwurf 11.2), ohne DOM.
import { describe, expect, test } from 'vitest'
import { asksRemote, asksContracting, asksFuelContract, editFuelContractNote, FUEL_CONTRACT_OPTIONS, selfSupplyOffer, asksSwitch, contractingSwap, energyLabelOf, HOW_TO_TELL, PREVIOUS_SUPPLY_OPTIONS, asksGeneration, asksNewInstall, asksTakeOver, buildingOptions, canSwap, connectionNote, emptyHeatingForm, emptySwapForm, formulaFormOf, HEAT_GENERATION_OPTIONS, HOT_WATER_OPTIONS, hotWaterBody, isFormula, parseDecimal, SELF_HOT_WATER_OPTIONS, selfFormulaBody, PER_UNIT_ENERGY_OPTIONS, plantOptions, swapBody, swapMetersOf, unmeasurableLabel, heatingPlantBody, heatingSummary, heatingToForm, whoHint, whoOptions, type HeatingForm } from './heatingForm'
import type { HeatingPlant, Unit } from './types'

const UNITS: Pick<Unit, 'id' | 'name' | 'noConnection'>[] = [{ id: 'eg', name: 'EG' }, { id: 'og', name: 'OG' }, { id: 'garage', name: 'Garage', noConnection: ['waerme'] }]
const ausgefuellt = (over: Partial<HeatingForm> = {}): HeatingForm => ({ ...emptyHeatingForm(UNITS), energy: 'gas', who: 'service', ...over })
const PLANT: HeatingPlant = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'heatPump', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'partial', devicesInstalledAfter2021: 'some', source: 'building', captureInstalledOn: '2025-06-01', capturedOnOct2024: false,
  warmRentAverageCents: 123456, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: [{ unitId: 'og', heatedAreaM2: null }],
  newDevicesInstall: 'single', nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null, hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: null, heatPumpMajority: null, hcaModel: null, operatingPowerHandling: null, contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null, gmodg43InstalledOn: null, emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null,
}

describe('Einrichtung Heizung', () => {
  test('Vorgabe: alle Wohnungen außer denen ohne Wärmeanschluss, und so heißt die Liste „alle“', () => {
    expect(emptyHeatingForm(UNITS).unitIds).toEqual(['eg', 'og'])
    expect(heatingPlantBody(ausgefuellt(), UNITS)).toEqual({
      body: {
        energy: 'gas', supply: 'central', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
        capturedOnOct2024: null, captureInstalledOn: null, warmRentAverageCents: null, heatPumpInstalledOn: null, units: null, newDevicesInstall: null, name: '', buildingWith: null,
        contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null,
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
    // Heizung PR 19: der Anspruch nach § 6 Abs. 2 CO2KostAufG wird erklärt, und die Wohnungen gehen an das Angebot „Mieter heizt selbst“.
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit', contract: 'tenant' }), UNITS)).toEqual({ none: expect.stringMatching(/keine Heizanlage.*Seite Kosten unter „CO₂-Erstattung“/), selfSupplyUnitIds: ['eg', 'og'], central: false })
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
    // Befund M6 aus #341: Bei `manual` stand „Abrechnung: Niemand …“, auch nach „Ich selbst“ und „Später“,
    // denn bis zum Umstellen ist die Anlage so gespeichert. Die Zeile beschreibt jetzt, wie gerechnet wird.
    const manual = heatingSummary({ ...PLANT, method: 'manual' }, UNITS)[1]
    expect(manual).toBe('Abrechnung: nach den Umlageschlüsseln der Kostenpositionen, ohne eigene Heizkostenabrechnung')
    expect(manual).not.toMatch(/Niemand/)
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
    // Heizung PR 16: Öl → Öl mit Contracting ist Wärmelieferung; den Vorrat führt der Lieferant.
    expect(asksTakeOver({ energy: 'oil', contracting: true }, OEL)).toBe(false)
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

test('Warmwasser nach Formel (Heizung PR 11): Volumen und Temperatur deutsch und technisch, leer heißt keine Angabe', () => {
  expect(parseDecimal('32,5')).toBe(32.5)
  expect(parseDecimal('32.5')).toBe(32.5)
  expect(parseDecimal('1.234,5')).toBe(1234.5)
  expect(parseDecimal('')).toBe(null)
  expect(parseDecimal('viel')).toBe(undefined)
  expect(selfFormulaBody('volumeFormula', { volume: '120', temp: '60' })).toEqual({ body: { dhwVolumeM3: 120, dhwTempC: 60 } })
  expect(selfFormulaBody('volumeFormula', { volume: 'x', temp: '60' })).toEqual({ error: 'Das Volumen des Warmwassers ist keine Zahl.' })
  expect(selfFormulaBody('areaFormula', { volume: '120', temp: '60' })).toEqual({ body: {} })
  expect(formulaFormOf({ dhwMethod: 'volumeFormula', dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: 32.5, dhwTempC: null })).toEqual({ volume: '32,5', temp: '' })
  expect(HEAT_GENERATION_OPTIONS.map((o) => o.value)).toEqual(['', 'single', 'mixed'])
  // Bei eigener Abrechnung gibt es „keine Angabe“ nicht; die Vorgabe ist der Wärmezähler.
  expect(SELF_HOT_WATER_OPTIONS.map((o) => o.value)).toEqual(['heatMeter', 'volumeFormula', 'areaFormula'])
})

test('Durchsicht #240: Zahlen mit Tausenderpunkt (M3) und die Fragen an der Anlage (Recht-I1/I2)', () => {
  expect(parseDecimal('1.200')).toBe(1200)
  expect(parseDecimal('1.200,5')).toBe(1200.5)
  expect(parseDecimal('12.5')).toBe(12.5)
  expect([asksGeneration({ energy: 'heatPump', who: 'service' }), asksGeneration({ energy: 'gas', who: 'self' }), asksGeneration({ energy: 'gas', who: 'service' })]).toEqual([true, true, false])
  const wp = heatingPlantBody({ ...ausgefuellt({ energy: 'heatPump', who: 'manual' }), generation: 'mixed', majority: 'yes' }, UNITS)
  expect('body' in wp && [wp.body.heatGeneration, wp.body.heatPumpMajority]).toEqual(['mixed', 'yes'])
  const gas = heatingPlantBody({ ...ausgefuellt(), generation: 'single', majority: 'yes' }, UNITS)
  expect('body' in gas && ['heatGeneration' in gas.body, 'heatPumpMajority' in gas.body]).toEqual([false, false])
  expect(heatingToForm({ ...PLANT, heatGeneration: 'single', heatPumpMajority: 'unknown' }, UNITS)).toMatchObject({ generation: 'single', majority: 'unknown' })
})

test('Nachprüfung #240, W1: Volumen „60.125“ ist mehrdeutig und wird nachgefragt; „1.200,5“ und „1.234.567“ sind eindeutig', () => {
  expect(selfFormulaBody('volumeFormula', { volume: '60.125', temp: '60' })).toEqual({ error: 'Volumen des Warmwassers: Meinen Sie 60,125 oder 60125? Bitte schreiben Sie Nachkommastellen mit Komma (60,125) und Tausender ohne Punkt (60125).' })
  expect(selfFormulaBody('volumeFormula', { volume: '1.200,5', temp: '60' })).toEqual({ body: { dhwVolumeM3: 1200.5, dhwTempC: 60 } })
  expect(selfFormulaBody('volumeFormula', { volume: '1.234.567', temp: '60' })).toEqual({ body: { dhwVolumeM3: 1234567, dhwTempC: 60 } })
})

// ---------- Wärmelieferung (Heizung PR 16, #213) ----------

describe('Wärmelieferung (Heizung PR 16)', () => {
  test('Contracting bei jeder zentralen Anlage außer Fernwärme, auch bei der Wärmepumpe (Prüfung R-M4); Umstellung bei Contracting oder Fernwärme', () => {
    expect(asksContracting('gas')).toBe(true)
    expect(asksContracting('pellets')).toBe(true)
    expect(asksContracting('heatPump')).toBe(true)
    expect(asksContracting('districtHeating')).toBe(false)
    expect(asksContracting('perUnit')).toBe(false)
    expect(asksContracting('')).toBe(false)
    expect(asksSwitch(ausgefuellt({ energy: 'districtHeating' }))).toBe(true)
    expect(asksSwitch(ausgefuellt({ energy: 'gas', contracting: false }))).toBe(false)
    expect(asksSwitch(ausgefuellt({ energy: 'gas', contracting: true }))).toBe(true)
    expect(asksSwitch(ausgefuellt({ energy: 'perUnit', contracting: true }))).toBe(false)
  })

  test('Rumpf: Angaben zur Umstellung nur, wo gefragt; Contracting fällt bei Fernwärme und Etagenheizung weg', () => {
    const body = heatingPlantBody(ausgefuellt({ contracting: true, deliverySince: '2025-10-01', previousSupply: 'landlord', announcedOn: '2025-06-15' }), UNITS)
    expect('body' in body && body.body).toMatchObject({ contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord', switchAnnouncedOn: '2025-06-15' })
    const pumpe = heatingPlantBody(ausgefuellt({ energy: 'heatPump', contracting: true }), UNITS)
    expect('body' in pumpe && pumpe.body).toMatchObject({ energy: 'heatPump', contracting: true })
    const fern = heatingPlantBody(ausgefuellt({ energy: 'districtHeating', contracting: true, deliverySince: '2025-10-01' }), UNITS)
    expect('body' in fern && fern.body).toMatchObject({ contracting: false, heatDeliverySince: '2025-10-01' })
    const ohne = heatingPlantBody(ausgefuellt({ energy: 'gas', contracting: false, deliverySince: '2025-10-01', previousSupply: 'tenant' }), UNITS)
    expect('body' in ohne && ohne.body).toMatchObject({ contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null })
    const etage = heatingPlantBody(ausgefuellt({ energy: 'perUnit', contract: 'landlord', perUnitEnergy: 'gas', ownMeters: true, contracting: true, deliverySince: '2025-10-01' }), UNITS)
    expect('body' in etage && etage.body).toMatchObject({ supply: 'perUnit', contracting: false, heatDeliverySince: null })
    expect(heatingPlantBody(ausgefuellt({ contracting: true, announcedOn: '2025-06-15' }), UNITS))
      .toEqual({ error: 'Eine Ankündigung ohne Tag der Umstellung lässt sich nicht prüfen. Bitte tragen Sie den Tag der Umstellung ein oder leeren Sie beide.' })
  })

  test('Formular: gespeicherte Angaben kommen zurück', () => {
    const f = heatingToForm({ ...PLANT, energy: 'gas', contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'tenant', switchAnnouncedOn: null }, UNITS)
    expect([f.contracting, f.deliverySince, f.previousSupply, f.announcedOn]).toEqual([true, '2025-10-01', 'tenant', ''])
  })

  // Prüfung R-S2: maßgeblich ist der Vertrag; die Fälle ohne § 556c (Heizkosten in der Miete, schon vorher ein
  // Lieferant) stehen beim neutralen Eintrag, dann ist der Text der Abrechnung bedingt.
  test('Wer versorgte vorher? Beschriftungen nach der Prüfung', () => {
    expect(PREVIOUS_SUPPLY_OPTIONS.map((o) => o.value)).toEqual(['', 'landlord', 'tenant'])
    expect(PREVIOUS_SUPPLY_OPTIONS[1]?.label).toBe('Ich, mit einer eigenen Heizung; die Mieter zahlten die Heizkosten als Betriebskosten')
    expect(PREVIOUS_SUPPLY_OPTIONS[0]?.label).toMatch(/Heizkosten in der Miete enthalten.*schon vorher ein Wärmelieferant/)
  })

  // Prüfung C-M5: Der alte Rat („Steht dort Wärmelieferung, wählen Sie Fernwärme, auch wenn im Keller ein Kessel steht“)
  // widerspräche dem Merkmal.
  test('Woran erkenne ich das? Contracting ist der Brennstoff des Kessels mit dem Häkchen', () => {
    expect(HOW_TO_TELL.energy).toBe('Woran erkenne ich das? Am Brennstoff auf Ihrer Rechnung. Kommt die Wärme aus einem Wärmenetz, wählen Sie Fernwärme. Betreibt ein Lieferant den Kessel in Ihrem Haus und stellt Ihnen Wärme in Rechnung (Contracting), wählen Sie den Brennstoff des Kessels und setzen darunter das Häkchen „Ein Dritter betreibt die Heizung …“. Eine Wärmepumpe ist „Wärmepumpe“, nicht „Strom“; „Strom“ heißt Nachtspeicher- oder Elektroheizung.')
  })

  test('Beschriftung: Contracting nennt den Brennstoff', () => {
    expect(energyLabelOf({ energy: 'districtHeating', contracting: true, fuelEnergy: 'gas' })).toBe('Wärmelieferung (Contracting, erzeugt mit Gas)')
    expect(energyLabelOf({ energy: 'districtHeating', contracting: true, fuelEnergy: 'pellets' })).toBe('Wärmelieferung (Contracting, erzeugt mit Pellets)')
    expect(energyLabelOf({ energy: 'districtHeating' })).toBe('Fernwärme')
    expect(energyLabelOf({ energy: 'oil' })).toBe('Öl')
    expect(heatingSummary({ ...PLANT, energy: 'gas', contracting: true }, UNITS)[0]).toBe('Energie: Wärmelieferung (Contracting, erzeugt mit Gas)')
  })

  // Prüfung C-M1: Die Umstellung in einem offenen Zeitraum geht über den Kesseltausch; der Tag des Tauschs ist als Tag
  // der Umstellung vorgeschlagen, wenn die bisherige Anlage keine Wärmelieferung war.
  test('Kesseltausch auf Contracting: Tag der Umstellung vorgeschlagen, Angaben im Rumpf', () => {
    const OEL: HeatingPlant = { ...PLANT, energy: 'oil', method: 'manual', units: null }
    const f = contractingSwap({ ...emptySwapForm(OEL), date: '2025-10-01', energy: 'oil' }, true, OEL)
    expect([f.contracting, f.deliverySince]).toEqual([true, '2025-10-01'])
    expect(asksTakeOver(f, OEL)).toBe(false)
    expect(swapBody({ ...f, previousSupply: 'landlord' }, OEL)).toEqual({ body: { date: '2025-10-01', energy: 'oil', name: '', previousName: '', contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord' } })
    // War die bisherige schon Wärmelieferung, gibt es keinen Vorschlag.
    const fern: HeatingPlant = { ...PLANT, energy: 'districtHeating', method: 'manual' }
    expect(contractingSwap({ ...emptySwapForm(fern), date: '2025-10-01', energy: 'gas' }, true, fern).deliverySince).toBe('')
    // Zurück zur eigenen Heizung: contracting false und keine Angaben.
    const zurueck = swapBody(contractingSwap(f, false, OEL), OEL)
    expect(zurueck).toMatchObject({ body: { contracting: false } })
    expect('body' in zurueck && 'heatDeliverySince' in zurueck.body).toBe(false)
  })
})

// Heizung PR 19 (#97, Prüfung M1, Gegenprüfung M1): zentrale Heizung mit Brennstoffvertrag beim Mieter.
describe('Wer hat den Liefervertrag für den Brennstoff? (Heizung PR 19)', () => {
  test('gefragt bei Gas, Öl, Flüssiggas und Kohle einer neuen zentralen Anlage, nicht bei Contracting, Fernwärme oder beim Ändern', () => {
    for (const energy of ['gas', 'oil', 'lpg', 'coal'] as const) expect(asksFuelContract(ausgefuellt({ energy }), null)).toBe(true)
    for (const energy of ['heatPump', 'districtHeating', 'pellets', 'perUnit'] as const) expect(asksFuelContract(ausgefuellt({ energy }), null)).toBe(false)
    expect(asksFuelContract(ausgefuellt({ energy: 'gas', contracting: true }), null)).toBe(false)
    expect(asksFuelContract(ausgefuellt({ energy: 'gas' }), 'hp1')).toBe(false)
    // Voreinstellung „Ich“: Wer nichts ändert, merkt nichts.
    expect(emptyHeatingForm(UNITS).fuelContract).toBe('landlord')
    expect(FUEL_CONTRACT_OPTIONS.map((o) => o.value)).toEqual(['landlord', 'tenantAll', 'tenantOthers'])
  })

  test('Abdeckung V27: beim Ändern einer zentralen Anlage mit Gas, Öl, Flüssiggas oder Kohle sagt die Karte, dass bei Brennstoff des Mieters keine Anlage hierher gehört', () => {
    for (const energy of ['gas', 'oil', 'lpg', 'coal'] as const) {
      expect(editFuelContractNote(ausgefuellt({ energy }), 'hp1')).toBe(
        'Hat ein Mieter den Liefervertrag für den Brennstoff dieser Heizung, legen Sie dafür keine Heizanlage an: Klicken Sie unter der Anlage auf ' +
          '„Entfernen …“ (die Heizpositionen bleiben, nur ohne Anlage), dann auf „Heizung einrichten“, und wählen Sie bei „Wer hat den Liefervertrag für den Brennstoff?“ ' +
          '„Der Mieter, der alle angeschlossenen Wohnungen gemietet hat“.',
      )
    }
    expect(editFuelContractNote(ausgefuellt({ energy: 'gas' }), null)).toBeNull()
    expect(editFuelContractNote(ausgefuellt({ energy: 'gas', contracting: true }), 'hp1')).toBeNull()
    for (const energy of ['heatPump', 'districtHeating', 'pellets', 'perUnit'] as const) expect(editFuelContractNote(ausgefuellt({ energy }), 'hp1')).toBeNull()
  })

  test('„Der Mieter, der alle angeschlossenen Wohnungen gemietet hat“: keine Anlage, die Erklärung und die Wohnungen für das Angebot', () => {
    const r = heatingPlantBody(ausgefuellt({ energy: 'oil', fuelContract: 'tenantAll', who: '' }), UNITS)
    if (!('none' in r)) throw new Error(JSON.stringify(r))
    expect(r.selfSupplyUnitIds).toEqual(['eg', 'og'])
    expect(r.central).toBe(true)
    expect(r.none).toMatch(/Wartung, Messungen nach dem Immissionsschutzrecht oder Betriebsstrom über Ihren Zähler/)
    expect(r.none).toMatch(/§ 6 Abs\. 2 CO2KostAufG/)
    expect(r.none).toMatch(/§ 6 Abs\. 2 Satz 6/)
    expect(heatingPlantBody(ausgefuellt({ energy: 'oil', fuelContract: 'tenantAll', unitIds: [] }), UNITS)).toEqual({ error: 'Bitte haken Sie mindestens eine Wohnung an, die an dieser Heizung hängt.' })
  })

  test('„Ein Mieter, und darüber werden auch andere Wohnungen versorgt“: nicht abgedeckt, mit dem Satz der Gegenprüfung', () => {
    expect(heatingPlantBody(ausgefuellt({ energy: 'gas', fuelContract: 'tenantOthers' }), UNITS)).toEqual({
      error: 'Liefert ein Mieter über seinen Vertrag auch Wärme an andere Wohnungen, regeln Heizkostenverordnung und CO2KostAufG die Verteilung nicht ausdrücklich für diesen Fall. Mietfuchs rechnet das nicht; bitte klären Sie die Abrechnung gesondert.',
    })
  })

  test('Das Angebot: laufende Mietverhältnisse der Wohnungen; bei der zentralen Heizung nur ein Mieter, sonst nicht abgedeckt', () => {
    const t = (id: string, unitId: string, tenantName: string, over: { end?: string | null; heatingModel?: 'selfSupply'; selfSupplyKind?: 'central' | 'perUnit' } = {}) =>
      ({ id, unitId, tenantName, start: '2020-01-01', end: null, ...over })
    const list = [t('a', 'eg', 'Mieter A'), t('b', 'og', 'Mieter A'), t('c', 'og', 'Früher', { end: '2023-12-31' }), t('d', 'garage', 'Mieter G')]
    expect(selfSupplyOffer(['eg', 'og'], list, '2026-10-12', true)).toEqual({ tenancyIds: ['a', 'b'], names: ['Mieter A'], kindTenancyIds: [] })
    expect(selfSupplyOffer(['eg', 'og'], [...list, t('e', 'og', 'Mieter B')], '2026-10-12', true)).toEqual({ error: expect.stringMatching(/^Liefert ein Mieter über seinen Vertrag auch Wärme an andere Wohnungen/) })
    // Etagenheizung: jeder Mieter hat seinen eigenen Vertrag.
    expect(selfSupplyOffer(['eg', 'og'], [...list, t('e', 'og', 'Mieter B')], '2026-10-12', false)).toEqual({ tenancyIds: ['a', 'b', 'e'], names: ['Mieter A', 'Mieter B'], kindTenancyIds: [] })
    // Schon umgestellt: kein Angebot.
    expect(selfSupplyOffer(['eg'], [t('a', 'eg', 'Mieter A', { heatingModel: 'selfSupply', selfSupplyKind: 'central' })], '2026-10-12', true)).toEqual({ tenancyIds: [], names: [], kindTenancyIds: [] })
  })

  // Nachprüfung N-3 zu PR 19: Wer schon in den Stammdaten ohne Art auf „Mieter heizt selbst“ stand, bekommt die Art bei
  // der Einrichtung nachgetragen; sonst käme bei der zentralen Heizung nie der Hinweis zum Betriebsstrom.
  test('N-3: schon „Mieter heizt selbst“ ohne Art: die Art wird nachgetragen, mit anderer Art nicht', () => {
    const t = (id: string, unitId: string, over: { heatingModel?: 'selfSupply'; selfSupplyKind?: 'central' | 'perUnit' } = {}) =>
      ({ id, unitId, tenantName: 'Mieter A', start: '2020-01-01', end: null, ...over })
    expect(selfSupplyOffer(['eg', 'og'], [t('a', 'eg', { heatingModel: 'selfSupply' }), t('b', 'og')], '2026-10-12', true))
      .toEqual({ tenancyIds: ['b'], names: ['Mieter A'], kindTenancyIds: ['a'] })
    expect(selfSupplyOffer(['eg'], [t('a', 'eg', { heatingModel: 'selfSupply', selfSupplyKind: 'perUnit' })], '2026-10-12', true))
      .toEqual({ tenancyIds: [], names: [], kindTenancyIds: [] })
    expect(selfSupplyOffer(['eg'], [t('a', 'eg', { heatingModel: 'selfSupply' })], '2026-10-12', false))
      .toEqual({ tenancyIds: [], names: [], kindTenancyIds: ['a'] })
  })
})

test('Durchsicht S-4: bei der zentralen Heizung ist jede weitere angehakte Einheit Wärme an Dritte, auch selbstgenutzt oder leer', () => {
  const t = (id: string, unitId: string, tenantName: string) => ({ id, unitId, tenantName, start: '2020-01-01', end: null })
  const NOT = /^Liefert ein Mieter über seinen Vertrag auch Wärme an andere Wohnungen/
  // Leer: eine angehakte Wohnung ohne laufendes Mietverhältnis.
  expect(selfSupplyOffer(['eg', 'og'], [t('a', 'eg', 'Mieter A')], '2026-10-12', true)).toEqual({ error: expect.stringMatching(NOT) })
  // Selbstgenutzt.
  expect(selfSupplyOffer(['eg', 'dg'], [t('a', 'eg', 'Mieter A')], '2026-10-12', true)).toEqual({ error: expect.stringMatching(NOT) })
  // Alle angehakten Wohnungen an denselben Mieter: Angebot.
  expect(selfSupplyOffer(['eg', 'og'], [t('a', 'eg', 'Mieter A'), t('b', 'og', 'Mieter A')], '2026-10-12', true)).toEqual({ tenancyIds: ['a', 'b'], names: ['Mieter A'], kindTenancyIds: [] })
  // Etagenheizung: eine leere Wohnung ist kein Dritter.
  expect(selfSupplyOffer(['eg', 'og'], [t('a', 'eg', 'Mieter A')], '2026-10-12', false)).toEqual({ tenancyIds: ['a'], names: ['Mieter A'], kindTenancyIds: [] })
})

// #225: Rechnet der Wärmelieferant unmittelbar mit den Mietern ab, gilt die Verordnung für ihn (§ 1 Abs. 3 HeizkostenV);
// die Kosten der Hausanlagen, die der Vermieter gesondert abrechnet, sind von §§ 3 bis 7 ausgenommen (§ 11 Abs. 1 Nr. 4).
describe('Wärmelieferant rechnet unmittelbar mit den Mietern ab (#225)', () => {
  const SUPPLIER = { value: 'supplier', label: 'Der Wärmelieferant rechnet unmittelbar mit den Mietern ab' }

  test('die Antwort gibt es nur bei einer neuen Anlage mit Wärmelieferung (Fernwärme oder Contracting)', () => {
    expect(whoOptions('mfh', { energy: 'districtHeating', contracting: false }, null)).toContainEqual(SUPPLIER)
    expect(whoOptions('mfh', { energy: 'gas', contracting: true }, null)).toContainEqual(SUPPLIER)
    expect(whoOptions('mfh', { energy: 'gas', contracting: false }, null)).not.toContainEqual(SUPPLIER)
    expect(whoOptions('mfh', { energy: 'districtHeating', contracting: false }, 'hp1')).not.toContainEqual(SUPPLIER)
    expect(whoOptions('mfh')).not.toContainEqual(SUPPLIER)
  })

  test('keine Anlage; die Erklärung nennt § 1 Abs. 3 und § 11 Abs. 1 Nr. 4, und jeder Mieter hat seinen eigenen Vertrag', () => {
    const r = heatingPlantBody(ausgefuellt({ energy: 'districtHeating', who: 'supplier' }), UNITS)
    if (!('none' in r)) throw new Error(JSON.stringify(r))
    // Durchsicht PR #296, S1: § 1 Abs. 3 nur mit seiner zweiten Voraussetzung; misst der Lieferant je Wohnung, gilt die Verordnung nicht.
    expect(r.none).toMatch(/^Rechnet der Wärmelieferant unmittelbar mit den Mietern ab, legt Mietfuchs keine Heizanlage an\./)
    expect(r.none).toMatch(/Legt er dabei die Anteile der Mieter am Gesamtverbrauch zugrunde und nicht den für jede Wohnung gemessenen Verbrauch, gelten nach § 1 Abs\. 3 HeizkostenV die Pflichten des Gebäudeeigentümers aus der Verordnung für ihn\./)
    expect(r.none).toMatch(/Misst er den Verbrauch jeder Wohnung selbst und rechnet danach ab, gilt die Verordnung für diese Verteilung nicht\./)
    expect(r.none).toMatch(/legt Mietfuchs keine Heizanlage an/)
    expect(r.none).toMatch(/§ 11 Abs\. 1 Nr\. 4 HeizkostenV/)
    expect(r.none).toMatch(/„Heizung und Warmwasser“/)
    expect(r.selfSupplyUnitIds).toEqual(['eg', 'og'])
    expect(r.central).toBe(true)
    expect(r.singleTenant).toBe(false)
  })

  // Durchsicht PR #296, S2: Mit „Lieferant“ entfallen die Fragen nach Geräten und Umstellung, und die Erklärung steht vorher da.
  test('„Lieferant“: keine Fragen nach Fernablesbarkeit, Einbau und Umstellung, deren Prüfung greift nicht, und die Erklärung steht als Satz unter der Frage', () => {
    expect(asksRemote('supplier')).toBe(false)
    expect(asksSwitch({ energy: 'districtHeating', contracting: false, who: 'supplier' })).toBe(false)
    expect(asksSwitch({ energy: 'districtHeating', contracting: false, who: 'manual' })).toBe(true)
    const r = heatingPlantBody(ausgefuellt({ energy: 'districtHeating', who: 'supplier', announcedOn: '2025-01-01', deliverySince: '' }), UNITS)
    if (!('none' in r)) throw new Error(JSON.stringify(r))
    expect(whoHint('supplier', 'mfh')).toBe(r.none)
  })

  test('das Angebot nimmt mehrere Mieter an, auch an der zentralen Anlage', () => {
    const t = (id: string, unitId: string, tenantName: string) => ({ id, unitId, tenantName, start: '2020-01-01', end: null })
    expect(selfSupplyOffer(['eg', 'og'], [t('a', 'eg', 'Mieter A'), t('b', 'og', 'Mieter B')], '2026-10-12', true, false))
      .toEqual({ tenancyIds: ['a', 'b'], names: ['Mieter A', 'Mieter B'], kindTenancyIds: [] })
  })
})

test('#225: wird die Energie danach auf eine eigene Heizung gestellt, gilt die Antwort „Lieferant“ nicht mehr (das Auswahlfeld zeigt sie dann auch nicht)', () => {
  expect(heatingPlantBody(ausgefuellt({ energy: 'gas', who: 'supplier' }), UNITS)).toEqual({ error: 'Bitte wählen Sie, wer die Heizkostenabrechnung erstellt.' })
})

describe('#322: beheizte Fläche und umbauter Raum beim Ändern der Anlage', () => {
  test('bleiben je Wohnung erhalten, und die Liste steht ausdrücklich da', () => {
    const plant: HeatingPlant = { ...PLANT, method: 'self', areaBasisHeat: 'volume', units: null }
    const valued: HeatingPlant = { ...plant, units: [{ unitId: 'eg', heatedAreaM2: null, volumeM3: 180 }, { unitId: 'og', heatedAreaM2: 55, volumeM3: 210 }] }
    const form = heatingToForm(valued, UNITS)
    expect(heatingPlantBody(form, UNITS, [], 'hp1', valued)).toMatchObject({ body: { units: [{ unitId: 'eg', heatedAreaM2: null, volumeM3: 180 }, { unitId: 'og', heatedAreaM2: 55, volumeM3: 210 }] } })
    // Ohne gespeicherte Werte wie bisher: alle Wohnungen heißt „alle“.
    expect(heatingPlantBody(heatingToForm(plant, UNITS), UNITS, [], 'hp1', plant)).toMatchObject({ body: { units: null } })
  })
})

// „Passend zu Ihrem Bestand“ (#488, Teil 4): je Regel ein Treffer und ein Fehlschlag, die Grenzfälle (Mieterwechsel im
// Vorjahr, Leerstand, mehrere Objekte, Kesseltausch am Ende des Zeitraums), Reihenfolge und Obergrenze.
import { describe, expect, test } from 'vitest'
import type { HeatingPlant, Property, Tenancy, Unit } from '../../shared/types.ts'
import { GUIDES } from '../../shared/guides.ts'
import { keepIfEqual, numberWord, suggestGuides, type HelpStock } from './helpSuggestions'

const property = (over: Partial<Property> = {}): Property => ({
  id: 'p1', name: 'Lindenweg 12', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', landlordName: null, iban: null,
  paymentDeadlineDays: null, periodRules: { startMonth: 1, changes: [] }, ...over,
})
let n = 0
const unit = (over: Partial<Unit> = {}): Unit => ({ id: `u${++n}`, propertyId: 'p1', name: `Wohnung ${n}`, areaM2: 60, participates: true, ...over })
const tenancy = (unitId: string, start: string, end: string | null, over: Partial<Tenancy> = {}): Tenancy => ({
  id: `t${++n}`, unitId, tenantName: `Mieter ${n}`, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'p1', name: 'Heizung', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null,
  newDevicesInstall: null, nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null,
  buildingWith: null, takesOverStock: null, hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null,
  heatGeneration: null, heatPumpMajority: null, hcaModel: null, operatingPowerHandling: null, contracting: false, heatDeliverySince: null,
  previousSupply: null, switchAnnouncedOn: null, gmodg43InstalledOn: null, emergencyInstall: null, emergencyPriorDuty: null,
  newBuildingFirstUse: null, buildingApplicationBefore20260513: null, ...over,
})
const Y2025 = { from: '2025-01-01', to: '2025-12-31', label: '2025', calendar: true }

// Ein Bestand, in dem keine Regel greift: ein Objekt (Einfamilienhaus) mit einer vermieteten Wohnung, ganzjährig vermietet,
// ohne Heizanlage.
function stock(over: Partial<HelpStock> = {}): HelpStock {
  const u = unit({ id: 'w1', name: 'Wohnung' })
  const p = property({ kind: 'efh' })
  return { properties: [p], property: p, units: [u], tenancies: [tenancy('w1', '2020-01-01', null)], plants: [], period: Y2025, ...over }
}
const ids = (s: HelpStock) => suggestGuides(s).map((x) => x.guideId)
const reasonOf = (s: HelpStock, id: string) => suggestGuides(s, 99).find((x) => x.guideId === id)?.reason

describe('ohne Bestand und ohne Treffer nichts', () => {
  test('kein Bestand, kein Objekt, keine Regel', () => {
    expect(suggestGuides(null)).toEqual([])
    expect(suggestGuides(stock({ property: null, properties: [] }))).toEqual([])
    expect(suggestGuides(stock())).toEqual([])
  })
})

describe('Zahlwörter', () => {
  test('bis zwölf als Wort, darüber als Ziffer', () => {
    expect(numberWord(2)).toBe('zwei')
    expect(numberWord(6)).toBe('sechs')
    expect(numberWord(12)).toBe('zwölf')
    expect(numberWord(13)).toBe('13')
  })
})

describe('Mieterwechsel und Leerstand im Zeitraum', () => {
  const two = (ts: Tenancy[], over: Partial<HelpStock> = {}) => stock({ units: [unit({ id: 'w1', name: 'EG links' })], tenancies: ts, ...over })

  // Durchsicht von Teil 4, S2: gezählt werden Wechsel, nicht Wohnungen mit Wechsel.
  test('zwei Wechsel in derselben Wohnung sind zwei', () => {
    const s = two([tenancy('w1', '2020-01-01', '2025-03-31'), tenancy('w1', '2025-04-01', '2025-08-31'), tenancy('w1', '2025-09-01', null)])
    expect(reasonOf(s, 'tenantChange')).toBe('Weil 2025 zwei Mieterwechsel erfasst sind')
  })

  test('Auszug und Einzug in derselben Wohnung im Jahr: Mieterwechsel', () => {
    const s = two([tenancy('w1', '2020-01-01', '2025-06-30'), tenancy('w1', '2025-07-01', null)])
    expect(suggestGuides(s)).toEqual([{ guideId: 'tenantChange', reason: 'Weil 2025 ein Mieterwechsel erfasst ist' }])
  })

  test('mehrere Wechsel als Zahl, abweichender Zeitraum mit seiner Bezeichnung', () => {
    const units = [unit({ id: 'w1' }), unit({ id: 'w2' })]
    const ts = [tenancy('w1', '2020-01-01', '2025-06-30'), tenancy('w1', '2025-07-01', null), tenancy('w2', '2020-01-01', '2025-08-31'), tenancy('w2', '2025-09-01', null)]
    expect(reasonOf(stock({ units, tenancies: ts }), 'tenantChange')).toBe('Weil 2025 zwei Mieterwechsel erfasst sind')
    const period = { from: '2025-05-01', to: '2026-04-30', label: '2025/2026', calendar: false }
    expect(reasonOf(two([tenancy('w1', '2020-01-01', '2025-06-30'), tenancy('w1', '2025-07-01', null)], { period }), 'tenantChange'))
      .toBe('Weil im Zeitraum 2025/2026 ein Mieterwechsel erfasst ist')
  })

  test('Wechsel im Vorjahr oder genau an der Grenze zählt nicht', () => {
    expect(ids(two([tenancy('w1', '2020-01-01', '2024-06-30'), tenancy('w1', '2024-07-01', null)]))).toEqual([])
    expect(ids(two([tenancy('w1', '2020-01-01', '2024-12-31'), tenancy('w1', '2025-01-01', null)]))).toEqual([])
    // Auszug am letzten Tag, Einzug im Folgejahr: nicht in diesem Jahr
    expect(ids(two([tenancy('w1', '2020-01-01', '2025-12-31'), tenancy('w1', '2026-01-01', null)]))).toEqual([])
  })

  test('Leerstand: Auszug ohne Nachfolger oder Einzug nach einer Lücke, mit dem Namen der Wohnung', () => {
    expect(reasonOf(two([tenancy('w1', '2020-01-01', '2025-09-30')]), 'tenantChange')).toBe('Weil „EG links“ 2025 zeitweise nicht vermietet ist')
    expect(reasonOf(two([tenancy('w1', '2025-03-01', null)]), 'tenantChange')).toBe('Weil „EG links“ 2025 zeitweise nicht vermietet ist')
    // Wechsel mit Lücke ist ein Mieterwechsel
    expect(reasonOf(two([tenancy('w1', '2020-01-01', '2025-03-31'), tenancy('w1', '2025-06-01', null)]), 'tenantChange')).toBe('Weil 2025 ein Mieterwechsel erfasst ist')
  })

  test('kein Leerstand: Wohnung ohne Mietverhältnis im Jahr (unvollständig erfasst), Eigennutzung, nicht beteiligt', () => {
    expect(ids(two([]))).toEqual([])
    expect(ids(two([tenancy('w1', '2020-01-01', '2023-12-31')]))).toEqual([])
    const own = unit({ id: 'w1', participates: false, selfUsed: true })
    expect(ids(stock({ units: [own], tenancies: [] }))).toEqual([])
    // Ab Juli Eigennutzung: Das Mietverhältnis endet mit der Vermietung, keine Lücke
    const changed = unit({ id: 'w1', usageChanges: [{ from: '2025-07-01', usage: 'eigen' }] })
    expect(ids(stock({ units: [changed], tenancies: [tenancy('w1', '2020-01-01', '2025-06-30')] }))).toEqual([])
  })

  test('mehrere leere Wohnungen als Zahl', () => {
    const units = [unit({ id: 'w1' }), unit({ id: 'w2' })]
    const ts = [tenancy('w1', '2020-01-01', '2025-09-30'), tenancy('w2', '2025-04-01', null)]
    expect(reasonOf(stock({ units, tenancies: ts }), 'tenantChange')).toBe('Weil zwei Wohnungen 2025 zeitweise nicht vermietet sind')
  })
})

describe('Abrechnungszeitraum', () => {
  test('Objekt mit Zeitraum Mai bis April', () => {
    const p = property({ kind: 'efh', periodRules: { startMonth: 5, changes: [] } })
    const period = { from: '2025-05-01', to: '2026-04-30', label: '2025/2026', calendar: false }
    expect(suggestGuides(stock({ property: p, properties: [p], period }))).toEqual([{ guideId: 'periodMayApril', reason: 'Weil Lindenweg 12 von Mai bis April abrechnet' }])
  })

  test('nur die Heizung mit eigener Heizperiode', () => {
    expect(reasonOf(stock({ plants: [plant({ method: 'manual', energy: 'heatPump', periodStartMonth: 5 })] }), 'periodMayApril'))
      .toBe('Weil die Heizung von Mai bis April abgerechnet wird')
  })

  test('Kalenderjahr: keine Kachel', () => {
    expect(reasonOf(stock({ plants: [plant({ method: 'manual', energy: 'heatPump' })] }), 'periodMayApril')).toBeUndefined()
  })

  // Durchsicht von Teil 4, M1: entschieden wird am gewählten Zeitraum, nicht an den Regeln des Objekts.
  test('Objekt mit Wechsel: im Kalenderjahr vor oder nach dem Wechsel keine Kachel, im Rumpf ein eigener Grund', () => {
    const withRules = (periodRules: Property['periodRules'], period: HelpStock['period']) => {
      const p = property({ kind: 'efh', periodRules })
      return reasonOf(stock({ property: p, properties: [p], period }), 'periodMayApril')
    }
    expect(withRules({ startMonth: 5, changes: ['2024-01'] }, Y2025)).toBeUndefined()
    expect(withRules({ startMonth: 1, changes: ['2027-05'] }, Y2025)).toBeUndefined()
    const rump = { from: '2026-01-01', to: '2026-04-30', label: '01.01.–30.04.2026', calendar: false }
    expect(withRules({ startMonth: 1, changes: ['2026-05'] }, rump)).toBe('Weil Lindenweg 12 auf einen anderen Abrechnungszeitraum umstellt')
    const after = { from: '2026-05-01', to: '2027-04-30', label: '2026/2027', calendar: false }
    expect(withRules({ startMonth: 1, changes: ['2026-05'] }, after)).toBe('Weil Lindenweg 12 von Mai bis April abrechnet')
  })

  // M2: die Heizperiode aus dem Rhythmus der Anlage (Beginnmonat und Wechsel), die im gewählten Zeitraum endet.
  test('Heizung mit Wechsel: nach dem Wechsel aufs Kalenderjahr keine Kachel, nach dem Wechsel auf Mai die Kachel', () => {
    const heat = (over: Partial<HeatingPlant>, period: HelpStock['period'] = Y2025) =>
      reasonOf(stock({ period, plants: [plant({ method: 'manual', energy: 'heatPump', ...over })] }), 'periodMayApril')
    expect(heat({ periodStartMonth: 5, periodChanges: ['2024-01'] })).toBeUndefined()
    expect(heat({ periodStartMonth: 1, periodChanges: ['2025-05'] })).toBe('Weil die Heizung auf eine andere Heizperiode umstellt')
    expect(heat({ periodStartMonth: 1, periodChanges: ['2025-05'] }, { from: '2026-01-01', to: '2026-12-31', label: '2026', calendar: true }))
      .toBe('Weil die Heizung von Mai bis April abgerechnet wird')
    expect(heat({ periodStartMonth: 7 })).toBe('Weil die Heizung von Juli bis Juni abgerechnet wird')
  })
})

describe('Heizung', () => {
  test('CO₂: Gas, Öl, Flüssiggas oder Kohle, abgerechnet vom Messdienst, ab dem ersten Zeitraum der Aufteilung', () => {
    expect(reasonOf(stock({ plants: [plant()] }), 'co2Costs')).toBe('Weil eine Gas-Zentralheizung eingetragen ist')
    expect(reasonOf(stock({ plants: [plant({ energy: 'oil' })] }), 'co2Costs')).toBe('Weil eine Öl-Zentralheizung eingetragen ist')
    expect(reasonOf(stock({ plants: [plant({ contracting: true })] }), 'co2Costs')).toBe('Weil eine Wärmelieferung aus Gas eingetragen ist')
    expect(reasonOf(stock({ plants: [plant({ energy: 'pellets' })] }), 'co2Costs')).toBeUndefined()
    expect(reasonOf(stock({ plants: [plant({ energy: 'districtHeating' })] }), 'co2Costs')).toBeUndefined()
    expect(reasonOf(stock({ plants: [plant({ method: 'self' })] }), 'co2Costs')).toBeUndefined()
    const period = { from: '2022-01-01', to: '2022-12-31', label: '2022', calendar: true }
    expect(reasonOf(stock({ plants: [plant()], period }), 'co2Costs')).toBeUndefined()
  })

  test('Messdienst: nur beim Haus, nicht bei der Abrechnung der Gemeinschaft', () => {
    expect(reasonOf(stock({ plants: [plant()] }), 'meteringService')).toBe('Weil ein Messdienst Ihre Heizkosten abrechnet')
    expect(reasonOf(stock({ plants: [plant({ source: 'homeowners' })] }), 'meteringService')).toBeUndefined()
    expect(reasonOf(stock({ plants: [plant({ method: 'manual' })] }), 'meteringService')).toBeUndefined()
  })

  test('selbst nach der Heizkostenverordnung', () => {
    expect(reasonOf(stock({ plants: [plant({ method: 'self', energy: 'heatPump' })] }), 'heatingSelf')).toBe('Weil Sie die Heizkosten selbst abrechnen')
    expect(reasonOf(stock({ plants: [plant({ method: 'manual' })] }), 'heatingSelf')).toBeUndefined()
  })

  test('Vorrat: Brennstoff im Tank oder Lager, nicht beim Messdienst und nicht bei Wärmelieferung', () => {
    expect(reasonOf(stock({ plants: [plant({ energy: 'oil', method: 'manual' })] }), 'stockFuel')).toBe('Weil eine Heizung mit Heizöl eingetragen ist')
    expect(reasonOf(stock({ plants: [plant({ energy: 'pellets', method: 'self' })] }), 'stockFuel')).toBe('Weil eine Heizung mit Pellets eingetragen ist')
    expect(reasonOf(stock({ plants: [plant({ energy: 'oil' })] }), 'stockFuel')).toBeUndefined()
    expect(reasonOf(stock({ plants: [plant({ energy: 'oil', method: 'manual', contracting: true })] }), 'stockFuel')).toBeUndefined()
    expect(reasonOf(stock({ plants: [plant({ energy: 'gas', method: 'manual' })] }), 'stockFuel')).toBeUndefined()
  })

  test('erneuert im Zeitraum, nicht am letzten Tag und nicht im Vorjahr', () => {
    const old = (endsOn: string) => plant({ id: 'alt', energy: 'oil', method: 'manual', endsOn })
    const neu = plant({ id: 'neu', energy: 'gas', method: 'manual', replacesPlantId: 'alt' })
    expect(reasonOf(stock({ plants: [old('2025-08-31'), neu] }), 'heatingRenewed')).toBe('Weil die Heizung 2025 erneuert wurde')
    expect(reasonOf(stock({ plants: [old('2025-12-31'), neu] }), 'heatingRenewed')).toBeUndefined()
    expect(reasonOf(stock({ plants: [old('2024-08-31'), neu] }), 'heatingRenewed')).toBeUndefined()
  })

  test('zwei Anlagen zugleich oder Etagenheizungen; Anlagen anderer Objekte zählen nicht', () => {
    const two = [plant({ id: 'a', method: 'manual' }), plant({ id: 'b', method: 'manual', name: 'Therme DG' })]
    expect(reasonOf(stock({ plants: two }), 'heatingRenewed')).toBe('Weil in Lindenweg 12 zwei Heizanlagen eingetragen sind')
    expect(reasonOf(stock({ plants: [plant({ supply: 'perUnit', method: 'manual' })] }), 'heatingRenewed')).toBe('Weil in Lindenweg 12 Etagenheizungen eingetragen sind')
    expect(ids(stock({ plants: [plant({ propertyId: 'p2' })] }))).toEqual([])
  })

  test('eine stillgelegte Anlage aus dem Vorjahr zählt nicht mehr', () => {
    expect(ids(stock({ plants: [plant({ endsOn: '2024-06-30' })] }))).toEqual([])
  })
})

describe('Mietverhältnisse und Objekt', () => {
  test('Pauschale oder Inklusivmiete im Zeitraum', () => {
    expect(reasonOf(stock({ tenancies: [tenancy('w1', '2020-01-01', null, { costModel: 'flatRate', tenantName: 'Familie Ott' })] }), 'flatRate'))
      .toBe('Weil mit Familie Ott eine Pauschale vereinbart ist')
    expect(reasonOf(stock({ tenancies: [tenancy('w1', '2020-01-01', null, { heatingModel: 'inclusive', tenantName: 'Ott' })] }), 'flatRate'))
      .toBe('Weil mit Ott eine Inklusivmiete vereinbart ist')
    const units = [unit({ id: 'w1' }), unit({ id: 'w2' })]
    const ts = [tenancy('w1', '2020-01-01', null, { costModel: 'flatRate' }), tenancy('w2', '2020-01-01', null, { costModel: 'inclusive' })]
    expect(reasonOf(stock({ units, tenancies: ts }), 'flatRate')).toBe('Weil für zwei Mietverhältnisse eine Pauschale oder Inklusivmiete vereinbart ist')
    // Durchsicht von Teil 4, S3: ohne Namen der allgemeine Satz
    expect(reasonOf(stock({ tenancies: [tenancy('w1', '2020-01-01', null, { costModel: 'flatRate', tenantName: '  ' })] }), 'flatRate'))
      .toBe('Weil für ein Mietverhältnis eine Pauschale vereinbart ist')
    // Eine Garage ohne Nebenkosten trägt die Inklusivmiete nach der Anleitung zur Garage; das ist keine Pauschale der Wohnung
    const garage = unit({ id: 'g1', name: 'Garage 1', areaM2: 0 })
    expect(reasonOf(stock({ units: [unit({ id: 'w1' }), garage], tenancies: [tenancy('w1', '2020-01-01', null), tenancy('g1', '2020-01-01', null, { costModel: 'inclusive', heatingModel: 'inclusive' })] }), 'flatRate')).toBeUndefined()
    // Vor dem Jahr beendet, oder mit Abrechnung
    expect(reasonOf(stock({ tenancies: [tenancy('w1', '2020-01-01', '2024-12-31', { costModel: 'flatRate' }), tenancy('w1', '2025-01-01', null)] }), 'flatRate')).toBeUndefined()
    expect(reasonOf(stock({ tenancies: [tenancy('w1', '2020-01-01', null, { costModel: 'settlement', heatingModel: 'selfSupply' })] }), 'flatRate')).toBeUndefined()
  })

  test('Eigentumswohnung', () => {
    const p = property({ kind: 'etw', name: 'ETW Hafenstraße' })
    expect(reasonOf(stock({ property: p, properties: [p] }), 'condo')).toBe('Weil ETW Hafenstraße als Eigentumswohnung eingetragen ist')
  })

  test('Einliegerwohnung: genau zwei Wohnungen, eine selbst genutzt, eine vermietet', () => {
    const own = unit({ id: 'e', participates: false, selfUsed: true })
    const rented = unit({ id: 'w1' })
    const p = property({ kind: 'zfh', name: 'Haus Ott' })
    expect(reasonOf(stock({ property: p, properties: [p], units: [own, rented] }), 'granny')).toBe('Weil Sie in Haus Ott eine Wohnung selbst nutzen und eine vermieten')
    expect(reasonOf(stock({ property: p, properties: [p], units: [rented, unit()] }), 'granny')).toBeUndefined()
    expect(reasonOf(stock({ property: p, properties: [p], units: [own, rented, unit()] }), 'granny')).toBeUndefined()
  })

  test('Mehrfamilienhaus ab drei Wohnungen; nicht beteiligte Einheiten und Garagen zählen nicht', () => {
    const six = Array.from({ length: 6 }, () => unit())
    expect(reasonOf(stock({ units: six }), 'multiFamily')).toBe('Weil Lindenweg 12 sechs Wohnungen hat')
    expect(reasonOf(stock({ units: [unit(), unit(), unit({ participates: false })] }), 'multiFamily')).toBeUndefined()
    expect(reasonOf(stock({ units: [unit(), unit(), unit({ name: 'Garage 1', areaM2: 0 })] }), 'multiFamily')).toBeUndefined()
    const many = Array.from({ length: 14 }, () => unit())
    expect(reasonOf(stock({ units: many }), 'multiFamily')).toBe('Weil Lindenweg 12 14 Wohnungen hat')
  })

  // Durchsicht von Teil 4, S1: nur das erste Wort des Namens; „Wohnung über der Garage“ ist eine Wohnung.
  test('Garage nur, wenn der Name mit ihr beginnt', () => {
    const units = [unit({ name: 'Wohnung über der Garage' }), unit({ name: 'Garagenhof-Blick EG' }), unit()]
    expect(reasonOf(stock({ units }), 'garage')).toBeUndefined()
    expect(reasonOf(stock({ units }), 'multiFamily')).toBe('Weil Lindenweg 12 drei Wohnungen hat')
    for (const name of ['TG-Stellplatz 3', 'Tiefgarage 2', 'Carport', 'Doppelgarage', 'stellplatz 7', 'Garage1']) {
      expect(reasonOf(stock({ units: [unit(), unit({ name })] }), 'garage')).toBe(`Weil Lindenweg 12 die Einheit „${name}“ hat`)
    }
  })

  test('Garage oder Stellplatz am Namen der Einheit', () => {
    expect(reasonOf(stock({ units: [unit(), unit({ name: 'Garage 1', areaM2: 0 })] }), 'garage')).toBe('Weil Lindenweg 12 die Einheit „Garage 1“ hat')
    expect(reasonOf(stock({ units: [unit({ name: 'Stellplatz 3' }), unit({ name: 'Tiefgaragenplatz 4' })] }), 'garage')).toBe('Weil Lindenweg 12 zwei Garagen oder Stellplätze hat')
    expect(reasonOf(stock({ units: [unit({ name: 'DG rechts' })] }), 'garage')).toBeUndefined()
  })

  test('mehrere Objekte: alle zählen, sonst gilt das gewählte', () => {
    const a = property()
    const b = property({ id: 'p2', name: 'Hafenstraße 3' })
    expect(reasonOf(stock({ properties: [a, b], property: a }), 'properties')).toBe('Weil Sie zwei Objekte angelegt haben')
    expect(reasonOf(stock(), 'properties')).toBeUndefined()
    // Wohnungen und Anlagen eines anderen Objekts als des gewählten zählen nicht
    const foreign = Array.from({ length: 4 }, () => unit({ propertyId: 'p2' }))
    expect(reasonOf(stock({ properties: [a, b], property: a, units: foreign }), 'multiFamily')).toBeUndefined()
  })
})

describe('Reihenfolge und Obergrenze', () => {
  // Wie im Vorschlag: Mieterwechsel 2025, Gas-Zentralheizung vom Messdienst, sechs Wohnungen, dazu zwei Objekte
  const six = Array.from({ length: 6 }, (_, i) => unit({ id: `w${i}` }))
  const ts = [tenancy('w0', '2020-01-01', '2025-06-30'), tenancy('w0', '2025-07-01', null), ...six.slice(1).map((u) => tenancy(u.id, '2020-01-01', null))]
  const a = property()
  const full = stock({ properties: [a, property({ id: 'p2', name: 'Hafenstraße 3' })], property: a, units: six, tenancies: ts, plants: [plant()] })

  test('höchstens drei, Ereignis des Jahres zuerst, je Gruppe eine, ehe eine Gruppe zwei bekommt', () => {
    expect(suggestGuides(full)).toEqual([
      { guideId: 'tenantChange', reason: 'Weil 2025 ein Mieterwechsel erfasst ist' },
      { guideId: 'co2Costs', reason: 'Weil eine Gas-Zentralheizung eingetragen ist' },
      { guideId: 'multiFamily', reason: 'Weil Lindenweg 12 sechs Wohnungen hat' },
    ])
  })

  test('alle Treffer ohne Grenze in der Rangfolge, jede Anleitung höchstens einmal', () => {
    const all = suggestGuides(full, 99).map((x) => x.guideId)
    expect(all).toEqual(['tenantChange', 'co2Costs', 'meteringService', 'multiFamily', 'properties'])
    expect(new Set(all).size).toBe(all.length)
  })

  test('der Abrechnungszeitraum kommt vor der Heizung, ein Kesseltausch im Jahr vor ihm', () => {
    const p = property({ kind: 'efh', periodRules: { startMonth: 5, changes: [] } })
    const period = { from: '2025-05-01', to: '2026-04-30', label: '2025/2026', calendar: false }
    const plants = [plant({ id: 'alt', energy: 'oil', method: 'manual', endsOn: '2025-08-31' }), plant({ id: 'neu', replacesPlantId: 'alt' })]
    expect(suggestGuides(stock({ property: p, properties: [p], period, plants })).map((x) => x.guideId)).toEqual(['heatingRenewed', 'periodMayApril', 'co2Costs'])
  })

  test('jede vorgeschlagene Anleitung gibt es', () => {
    for (const s of suggestGuides(full, 99)) expect(GUIDES[s.guideId]).toBeTruthy()
  })
})

// Durchsicht von Teil 4, S4: Die App fragt die Heizanlagen bei jedem Seitenwechsel neu ab; ist die Antwort inhaltlich
// gleich, bleibt die alte Liste, sonst zeichnete die ganze App einmal mehr und die Vorschläge rechneten neu.
describe('gleiche Liste behalten', () => {
  test('inhaltlich gleich: die alte Liste, sonst die neue', () => {
    const a = [plant()]
    expect(keepIfEqual(a, [plant()])).toBe(a)
    const b = [plant({ energy: 'oil' })]
    expect(keepIfEqual(a, b)).toBe(b)
    expect(keepIfEqual(a, [])).toEqual([])
  })
})

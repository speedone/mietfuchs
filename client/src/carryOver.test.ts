// „Aus dem Vorjahr übernehmen“ (#141): Die Positionen des Vorjahres werden zur Vorlage, ohne
// Betrag und ohne Beleg. Gespeichert wird nur, was durch dieselbe Prüfung geht wie das Formular.
import { CALENDAR_RULES, calendarPeriod, calendarYearPeriod, contextOf, periodKey, periodOfKey } from '../../shared/period.ts'
import { describe, expect, test } from 'vitest'
import type { CostItem, HeatingPlant, Unit } from './types'
import { alreadyCarried, carryKeyDetails, carryOverBody, carryOverRows, replaceYear, withCarryAmount, type CarryRow } from './carryOver'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'p', name: 'EG', areaM2: 50, participates: true },
  { id: 'u2', propertyId: 'p', name: 'OG', areaM2: 70, participates: true },
]
let n = 0
const item = (over: Partial<CostItem> & Pick<CostItem, 'period' | 'category' | 'description'>): CostItem => ({
  id: `k${++n}`, propertyId: 'p', amountCents: 50000, key: 'area', ...over,
})
const rowOf = (rows: CarryRow[], description: string): CarryRow => {
  const r = rows.find((x) => x.source.description === description)
  if (!r) throw new Error(`keine Zeile ${description}`)
  return r
}

describe('Jahreszahl in der Beschreibung', () => {
  test('das Vorjahr als ganzes Wort wird ersetzt, andere Zahlen nicht', () => {
    expect(replaceYear('Grundsteuer 2025', 2025, 2026)).toBe('Grundsteuer 2026')
    expect(replaceYear('Abrechnung 01.01.2025–31.12.2025', 2025, 2026)).toBe('Abrechnung 01.01.2026–31.12.2026')
    expect(replaceYear('Rechnung 120250 vom Mai', 2025, 2026)).toBe('Rechnung 120250 vom Mai')
    expect(replaceYear('Hausgeld 2024/2025', 2025, 2026)).toBe('Hausgeld 2024/2026')
    expect(replaceYear('Wartung Aufzug', 2025, 2026)).toBe('Wartung Aufzug')
  })
})

describe('Vorlagen aus dem Vorjahr', () => {
  const items = [
    item({ period: calendarPeriod(2024), category: 'Grundsteuer', description: 'Grundsteuer 2024' }),
    item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025', vendor: 'Stadt', invoiceFile: 'gs.pdf', labor35aCents: 0 }),
    item({ period: calendarPeriod(2025), category: 'Hauswart', description: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 480000 }, labor35aCents: 3000 }),
    item({ period: calendarPeriod(2025), category: 'Heizung und Warmwasser', description: 'Heizung ista', key: 'amounts', tenancyAmounts: { t1: 30000 } }),
    item({ period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Müll 2026' }),
    item({ period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Müll 2025', key: 'persons' }),
  ]
  const rows = carryOverRows(items, 2026)

  test('nur das Vorjahr, mit neuer Beschreibung, ohne Betrag, Lohnanteil und Beleg; nichts angehakt', () => {
    expect(rows.map((r) => r.source.description)).toEqual(['Grundsteuer 2025', 'Hauswart', 'Heizung ista', 'Müll 2025'])
    const gs = rowOf(rows, 'Grundsteuer 2025')
    expect(gs).toMatchObject({ description: 'Grundsteuer 2026', vendor: 'Stadt', amount: '', labor35a: '', externalTotalAmount: '', checked: false })
    expect(rows.every((r) => !r.checked)).toBe(true)
  })

  test('schon im Jahr erfasst (gleiche Kostenart und Beschreibung) wird vermerkt', () => {
    expect(rowOf(rows, 'Müll 2025').already).toBe(true)
    expect(rowOf(rows, 'Grundsteuer 2025').already).toBe(false)
  })

  test('Einzelbeträge lassen sich nicht in einer Zeile übernehmen', () => {
    expect(rowOf(rows, 'Heizung ista').inline).toBe(false)
    expect(rowOf(rows, 'Hauswart').inline).toBe(true)
  })

  test('Durchsicht: eine schon erfasste Zeile wird durch einen Betrag nicht angehakt', () => {
    const muell = rowOf(rows, 'Müll 2025')
    expect(withCarryAmount(muell, '400,00', true).checked).toBe(false)
  })

  test('Durchsicht: vereinbarte Anteile mit Summe, Direktzuordnung mit Wohnung', () => {
    const anteile = carryKeyDetails(item({ period: calendarPeriod(2025), category: 'Hauswart', description: 'H', key: 'custom', customShares: { u1: 40, u2: 40 } }), UNITS)
    expect(anteile).toEqual({ text: 'EG: 40 % · OG: 40 % (zusammen 80 %)', warn: true })
    expect(carryKeyDetails(item({ period: calendarPeriod(2025), category: 'Hauswart', description: 'H', key: 'custom', customShares: { u1: 40, u2: 60 } }), UNITS)).toEqual({ text: 'EG: 40 % · OG: 60 %', warn: false })
    expect(carryKeyDetails(item({ period: calendarPeriod(2025), category: 'Sonstige Betriebskosten', description: 'S', key: 'direct', directUnitId: 'u2' }), UNITS)).toEqual({ text: 'direkt OG', warn: false })
    expect(carryKeyDetails(item({ period: calendarPeriod(2025), category: 'Sonstige Betriebskosten', description: 'S', key: 'direct', directUnitId: null }), UNITS)).toEqual({ text: 'Wohnung fehlt', warn: true })
  })

  test('ein eingetragener Betrag hakt die Zeile an, ein geleerter ab', () => {
    const gs = withCarryAmount(rowOf(rows, 'Grundsteuer 2025'), '610,00')
    expect(gs.checked).toBe(true)
    expect(withCarryAmount(gs, '').checked).toBe(false)
  })

  test('Rumpf: Schlüssel und Angaben des Vorjahres, Betrag des Jahres, kein Beleg', () => {
    const gs = withCarryAmount(rowOf(rows, 'Grundsteuer 2025'), '610,00')
    expect(carryOverBody(gs, UNITS, 2026)).toMatchObject({
      body: { period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Grundsteuer 2026', vendor: 'Stadt', amountCents: 61000, key: 'area', invoiceFile: null },
    })
  })

  test('Betrag fehlt: nicht übernehmbar, mit Grund', () => {
    const r = carryOverBody({ ...rowOf(rows, 'Grundsteuer 2025'), checked: true }, UNITS, 2026)
    expect(r).toEqual({ error: 'Betrag fehlt.' })
  })

  test('Gemeinschaftsabrechnung: Maßstab und Summe mit, die Kosten der Gemeinschaft sind neu einzutragen', () => {
    const hw = withCarryAmount(rowOf(rows, 'Hauswart'), '130,00')
    expect(carryOverBody(hw, UNITS, 2026)).toMatchObject({ error: expect.stringMatching(/Gemeinschaft/) })
    const ok = carryOverBody({ ...hw, externalTotalAmount: '52.000,00' }, UNITS, 2026)
    expect(ok).toMatchObject({ body: { key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 5200000 }, amountCents: 13000 } })
  })

  test('Einzelbeträge: ins Formular, nicht über die Zeile', () => {
    expect(carryOverBody(withCarryAmount(rowOf(rows, 'Heizung ista'), '900,00'), UNITS, 2026)).toMatchObject({ error: expect.stringMatching(/Formular/) })
  })

  test('0 € bleibt keine Kostenposition (#139)', () => {
    expect(carryOverBody(withCarryAmount(rowOf(rows, 'Grundsteuer 2025'), '0'), UNITS, 2026)).toMatchObject({ error: expect.stringMatching(/0 €/) })
  })
})

// Zusammenspiel mit der KI-Erfassung (Befund B): Erst kommt die Rechnung per KI, dann „Aus dem
// Vorjahr übernehmen“. Die KI beschreibt anders als die Vorlage, der Vergleich der Beschreibung
// traf nie, und die Zeile wurde angehakt und doppelt angelegt. Jetzt gilt die gemeinsame Regel
// aus shared/duplicates.ts.
describe('schon erfasst nach der gemeinsamen Regel', () => {
  test('KI-Beschreibung bei gleicher Kostenart: als erfasst erkannt, ein Betrag hakt nicht an', () => {
    const items = [
      item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025', vendor: 'Stadt' }),
      item({ period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Abgabenbescheid Stadt Musterstadt Q1–Q4', invoiceFile: 'gs.pdf' }),
    ]
    const row = rowOf(carryOverRows(items, 2026), 'Grundsteuer 2025')
    expect(row.already).toBe(true)
    expect(alreadyCarried(items, row, 2026)).toBe(true)
    expect(withCarryAmount(row, '610,00', row.already).checked).toBe(false)
  })

  test('eine Gutschrift des Vorjahres gilt nicht als erfasst, weil es eine Rechnung derselben Art gibt (rc.1)', () => {
    const items = [
      item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025', vendor: 'Stadt' }),
      item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Erstattung Grundsteuer', vendor: 'Stadt', amountCents: -5745 }),
      item({ period: calendarPeriod(2026), category: 'Grundsteuer', description: 'Abgabenbescheid', vendor: 'Stadt', invoiceFile: 'gs.pdf' }),
    ]
    const rows = carryOverRows(items, 2026)
    expect(rowOf(rows, 'Grundsteuer 2025').already).toBe(true)
    expect(rowOf(rows, 'Erstattung Grundsteuer').already).toBe(false)
  })

  test('breite Kostenart mit anderer Beschreibung und anderem Steller: nicht erfasst', () => {
    const items = [
      item({ period: calendarPeriod(2025), category: 'Sonstige Betriebskosten', description: 'Wartung Hebeanlage 2025', vendor: 'Pumpen Huber' }),
      item({ period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Reinigung Dachrinne', vendor: 'Dach Maier' }),
    ]
    expect(rowOf(carryOverRows(items, 2026), 'Wartung Hebeanlage 2025').already).toBe(false)
    // derselbe Steller schon: dann ist es wohl dieselbe Wartung
    const same = [items[0]!, item({ period: calendarPeriod(2026), category: 'Sonstige Betriebskosten', description: 'Jahresrechnung', vendor: 'Pumpen Huber GmbH' })]
    expect(rowOf(carryOverRows(same, 2026), 'Wartung Hebeanlage 2025').already).toBe(true)
  })

  test('eine schon übernommene Schwesterposition macht die andere nicht zu „erfasst“', () => {
    const items = [
      item({ period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Restmüll 2025' }),
      item({ period: calendarPeriod(2025), category: 'Müllabfuhr', description: 'Biomüll 2025' }),
      item({ period: calendarPeriod(2026), category: 'Müllabfuhr', description: 'Restmüll 2026' }),
    ]
    const rows = carryOverRows(items, 2026)
    expect(rowOf(rows, 'Restmüll 2025').already).toBe(true)
    expect(rowOf(rows, 'Biomüll 2025').already).toBe(false)
  })
})

describe('Nicht umlagefähig mit Einheit für die Steuer (#163)', () => {
  test('die Übernahme behält die Einheit, die die Position für die Steuer betrifft', () => {
    const items = [item({ period: calendarPeriod(2025), category: 'Nicht umlagefähig', description: 'Wartung Therme EG', key: 'direct', directUnitId: 'u1' })]
    const row = withCarryAmount(rowOf(carryOverRows(items, 2026), 'Wartung Therme EG'), '180,00')
    expect(carryOverBody(row, UNITS, 2026)).toMatchObject({ body: { category: 'Nicht umlagefähig', key: 'direct', directUnitId: 'u1' } })
  })
})

test('Mai bis April: die Übernahme verschiebt das Jahr der Zahlung um ein Jahr, sonst lehnte der Server jede Zeile ab (#208)', () => {
  // Ein Zeitraum über zwei Kalenderjahre verlangt das Jahr der Zahlung. Die Liste zeigt das Feld
  // nicht; übernommen wird der Rhythmus der Vorlage: 2024/2025 im Jahr 2025 gezahlt, also
  // 2025/2026 im Jahr 2026.
  const MAI = { startMonth: 5, changes: [] }
  const vorjahr = periodOfKey(MAI, periodKey('2024-05')) ?? expect.unreachable('2024-05')
  const jetzt = periodOfKey(MAI, periodKey('2025-05')) ?? expect.unreachable('2025-05')
  const items = [item({ period: periodKey('2024-05'), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 48000, key: 'area', taxYear: 2025 })]
  const [row] = carryOverRows(items, contextOf(jetzt, vorjahr))
  if (!row) return expect.unreachable('keine Zeile')
  const built = carryOverBody(withCarryAmount(row, '480,00'), UNITS, jetzt)
  if ('error' in built) return expect.unreachable(built.error)
  expect([built.body.period, built.body.taxYear]).toEqual(['2025-05', 2026])
  // Ohne Jahr der Zahlung an der Vorlage (Kalenderjahr) bleibt es leer.
  const [kalender] = carryOverRows([item({ period: calendarPeriod(2024), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 48000, key: 'area' })], 2025)
  if (!kalender) return expect.unreachable('keine Zeile')
  const k = carryOverBody(withCarryAmount(kalender, '480,00'), UNITS, 2025)
  if ('error' in k) return expect.unreachable(k.error)
  expect(k.body.taxYear).toBeNull()
})

test('Direkt nach einem Wechsel: Die Übernahme belegt das Jahr der Zahlung mit dem Startjahr des Ziels vor (Durchsicht von #226, I2)', () => {
  // Die Vorlagen stehen im Rumpf 01.01.–30.04.2025 und tragen kein Jahr der Zahlung; das Ziel
  // 2025/2026 reicht über zwei Kalenderjahre und verlangt eines. Ohne Vorbelegung lehnte der Server
  // jede Zeile ab.
  const RULES = { startMonth: 1, changes: ['2025-05'] }
  const rumpf = periodOfKey(RULES, periodKey('2025-01')) ?? expect.unreachable('2025-01')
  const ziel = periodOfKey(RULES, periodKey('2025-05')) ?? expect.unreachable('2025-05')
  const items = [item({ period: periodKey('2025-01'), category: 'Müllabfuhr', description: 'Müll', amountCents: 10000, key: 'area' })]
  const [row] = carryOverRows(items, contextOf(ziel, rumpf), ziel)
  if (!row) return expect.unreachable('keine Zeile')
  expect(row.taxYear).toBe('2025')
  const built = carryOverBody(withCarryAmount(row, '100,00'), UNITS, ziel)
  if ('error' in built) return expect.unreachable(built.error)
  expect(built.body.taxYear).toBe(2025)
  // Ein verschobenes Jahr außerhalb der Spanne wird in sie geklemmt: 2022/2023 im Jahr 2025
  // gezahlt, drei Zeiträume weiter wäre es 2028, erlaubt sind 2025 bis 2027.
  const MAI = { startMonth: 5, changes: [] }
  const alt = periodOfKey(MAI, periodKey('2022-05')) ?? expect.unreachable('2022-05')
  const neu = periodOfKey(MAI, periodKey('2025-05')) ?? expect.unreachable('2025-05')
  const vorlage = [item({ period: periodKey('2022-05'), category: 'Müllabfuhr', description: 'Müll', amountCents: 10000, key: 'area', taxYear: 2025 })]
  expect(carryOverRows(vorlage, contextOf(neu, alt), neu)[0]?.taxYear).toBe('2027')
  // Liegt das Ziel in einem Kalenderjahr, gibt es keines.
  expect(carryOverRows(vorlage, contextOf(neu, alt), { from: '2025-05-01', to: '2025-12-31' })[0]?.taxYear).toBe('')
})

// Eine Heizposition mit eigener Heizperiode gehört zum Abrechnungszeitraum, in dem ihre Heizperiode
// endet (client/src/costPeriods.ts). Das Vorjahr ist der Zeitraum davor nach derselben Regel, und die
// Übernahme bekommt die Heizperiode derselben Anlage, die im Ziel endet.
describe('Vorjahr mit eigener Heizperiode', () => {
  const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
    id: 'hp1', propertyId: 'p', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null, nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null, ...over,
  })
  const at2026 = contextOf(calendarYearPeriod(2026), calendarYearPeriod(2025))
  const heizung = (period: string, over: Partial<CostItem> = {}) =>
    item({ period: periodKey(period), category: 'Heizung und Warmwasser', description: 'Messdienst Heizung', key: 'units', heatingPlantId: 'hp1', taxYear: 2025, ...over })

  test('die Heizposition der Heizperiode, die im Vorjahr endet, wird angeboten und landet in der, die im Ziel endet', () => {
    const items = [heizung('2024-05'), item({ period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer 2025' })]
    const rows = carryOverRows(items, at2026, calendarYearPeriod(2026), { rules: CALENDAR_RULES, plants: [plant()] })
    const row = rowOf(rows, 'Messdienst Heizung')
    expect(row.heating).toEqual({ plantId: 'hp1', period: '2025-05' })
    expect([row.inline, row.taxYear, row.already]).toEqual([true, '2026', false])
    const built = carryOverBody({ ...row, amount: '1.200,00' }, UNITS, calendarYearPeriod(2026))
    expect(built).toMatchObject({ body: { period: '2025-05', heatingPlantId: 'hp1', taxYear: 2026, amountCents: 120000 } })
    expect(rowOf(rows, 'Grundsteuer 2025').heating).toBe(null)
    // Ohne die Anlagen sah die Liste die Heizposition gar nicht (Schlüssel '2024-05' ist nicht '2025-01').
    expect(carryOverRows(items, at2026, calendarYearPeriod(2026)).map((r) => r.source.description)).toEqual(['Grundsteuer 2025'])
  })

  test('schon im Ziel erfasst: die Heizposition der Heizperiode, die dort endet', () => {
    const items = [heizung('2024-05'), heizung('2025-05', { description: 'Messdienst Heizung 2025/2026' })]
    const row = rowOf(carryOverRows(items, at2026, calendarYearPeriod(2026), { rules: CALENDAR_RULES, plants: [plant()] }), 'Messdienst Heizung')
    expect(row.already).toBe(true)
  })

  test('enden im Ziel zwei Heizperioden der Anlage, wird nicht vorbelegt, sondern im Formular gefragt', () => {
    const items = [heizung('2024-05')]
    const row = rowOf(carryOverRows(items, at2026, calendarYearPeriod(2026), { rules: CALENDAR_RULES, plants: [plant({ periodChanges: ['2027-01'] })] }), 'Messdienst Heizung')
    expect([row.heating, row.inline]).toEqual([null, false])
    expect(carryOverBody({ ...row, amount: '100' }, UNITS, calendarYearPeriod(2026))).toEqual({ error: expect.stringMatching(/Heizperiode.*Formular/) })
  })

  // Durchsicht: Eine Heizposition des Vorjahres ohne Anlage bekäme beim Speichern vom Server still die
  // einzige Anlage des Objekts, deren Heizperiode und ein Jahr der Zahlung (defaultHeatingPlant). Die
  // Zeile sagt das vorher und legt es ausdrücklich so an.
  test('Heizposition ohne Anlage: die Zeile nennt Anlage, Heizperiode und Jahr der Zahlung', () => {
    const ohne = heizung('2025-01', { heatingPlantId: undefined })
    const row = rowOf(carryOverRows([ohne], at2026, calendarYearPeriod(2026), { rules: CALENDAR_RULES, plants: [plant({ name: 'Keller' })] }), 'Messdienst Heizung')
    expect(row.heating).toEqual({ plantId: 'hp1', period: '2025-05' })
    expect(row.heatingNote).toBe('Wird der Heizanlage „Keller“ zugeordnet: Heizperiode 2025/2026 (01.05.2025–30.04.2026), Jahr der Zahlung 2026.')
    expect(carryOverBody({ ...row, amount: '100' }, UNITS, calendarYearPeriod(2026))).toMatchObject({ body: { period: '2025-05', heatingPlantId: 'hp1', taxYear: 2026 } })
    const gleich = rowOf(carryOverRows([ohne], at2026, calendarYearPeriod(2026), { rules: CALENDAR_RULES, plants: [plant({ periodStartMonth: null })] }), 'Messdienst Heizung')
    expect([gleich.heating, gleich.heatingNote]).toEqual([null, 'Wird der Heizanlage zugeordnet.'])
    const zwei = rowOf(carryOverRows([ohne], at2026, calendarYearPeriod(2026), { rules: CALENDAR_RULES, plants: [plant(), plant({ id: 'hp2' })] }), 'Messdienst Heizung')
    expect([zwei.heating, zwei.heatingNote]).toEqual([null, undefined])
  })

  test('ohne eigene Heizperiode wie bisher', () => {
    const items = [heizung('2025-01', { taxYear: undefined })]
    const row = rowOf(carryOverRows(items, at2026, calendarYearPeriod(2026), { rules: CALENDAR_RULES, plants: [plant({ periodStartMonth: null })] }), 'Messdienst Heizung')
    expect(row.heating).toBe(null)
    expect(carryOverBody({ ...row, amount: '100' }, UNITS, calendarYearPeriod(2026))).toMatchObject({ body: { period: '2026-01' } })
  })
})

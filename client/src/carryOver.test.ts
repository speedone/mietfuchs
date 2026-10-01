// „Aus dem Vorjahr übernehmen“ (#141): Die Positionen des Vorjahres werden zur Vorlage, ohne
// Betrag und ohne Beleg. Gespeichert wird nur, was durch dieselbe Prüfung geht wie das Formular.
import { describe, expect, test } from 'vitest'
import type { CostItem, Unit } from './types'
import { carryKeyDetails, carryOverBody, carryOverRows, replaceYear, withCarryAmount, type CarryRow } from './carryOver'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'p', name: 'EG', areaM2: 50, participates: true },
  { id: 'u2', propertyId: 'p', name: 'OG', areaM2: 70, participates: true },
]
let n = 0
const item = (over: Partial<CostItem> & Pick<CostItem, 'year' | 'category' | 'description'>): CostItem => ({
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
    item({ year: 2024, category: 'Grundsteuer', description: 'Grundsteuer 2024' }),
    item({ year: 2025, category: 'Grundsteuer', description: 'Grundsteuer 2025', vendor: 'Stadt', invoiceFile: 'gs.pdf', labor35aCents: 0 }),
    item({ year: 2025, category: 'Hauswart', description: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 480000 }, labor35aCents: 3000 }),
    item({ year: 2025, category: 'Heizung und Warmwasser', description: 'Heizung ista', key: 'amounts', tenancyAmounts: { t1: 30000 } }),
    item({ year: 2026, category: 'Müllabfuhr', description: 'Müll 2026' }),
    item({ year: 2025, category: 'Müllabfuhr', description: 'Müll 2025', key: 'persons' }),
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
    const anteile = carryKeyDetails(item({ year: 2025, category: 'Hauswart', description: 'H', key: 'custom', customShares: { u1: 40, u2: 40 } }), UNITS)
    expect(anteile).toEqual({ text: 'EG: 40 % · OG: 40 % (zusammen 80 %)', warn: true })
    expect(carryKeyDetails(item({ year: 2025, category: 'Hauswart', description: 'H', key: 'custom', customShares: { u1: 40, u2: 60 } }), UNITS)).toEqual({ text: 'EG: 40 % · OG: 60 %', warn: false })
    expect(carryKeyDetails(item({ year: 2025, category: 'Sonstige Betriebskosten', description: 'S', key: 'direct', directUnitId: 'u2' }), UNITS)).toEqual({ text: 'direkt OG', warn: false })
    expect(carryKeyDetails(item({ year: 2025, category: 'Sonstige Betriebskosten', description: 'S', key: 'direct', directUnitId: null }), UNITS)).toEqual({ text: 'Wohnung fehlt', warn: true })
  })

  test('ein eingetragener Betrag hakt die Zeile an, ein geleerter ab', () => {
    const gs = withCarryAmount(rowOf(rows, 'Grundsteuer 2025'), '610,00')
    expect(gs.checked).toBe(true)
    expect(withCarryAmount(gs, '').checked).toBe(false)
  })

  test('Rumpf: Schlüssel und Angaben des Vorjahres, Betrag des Jahres, kein Beleg', () => {
    const gs = withCarryAmount(rowOf(rows, 'Grundsteuer 2025'), '610,00')
    expect(carryOverBody(gs, UNITS, 2026)).toMatchObject({
      body: { year: 2026, category: 'Grundsteuer', description: 'Grundsteuer 2026', vendor: 'Stadt', amountCents: 61000, key: 'area', invoiceFile: null },
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

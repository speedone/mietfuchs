// Cockpit-Prüfungen (#142): Nicht umlagefähige Positionen werden nie verteilt; ihr gespeicherter
// Schlüssel darf deshalb weder Ablesungen verlangen noch die Verteilbasis prüfen lassen.
import { expect, test } from 'vitest'
import type { CostItem } from './types'
import { itemsDetail, meterTypesInUse, tenanciesDetail, usesUnitBasis } from './cockpitChecks'

const item = (category: string, patch: Partial<CostItem>): CostItem => ({
  id: category, propertyId: 'p', year: 2025, category, description: category, amountCents: 100, key: 'area', ...patch,
})

test('verbrauchsabhängige Umlage: nur umlagefähige Positionen mit Verbrauchsschlüssel zählen', () => {
  expect(meterTypesInUse([item('Wasser/Abwasser', { key: 'meter', meterType: 'kaltwasser' })])).toEqual(new Set(['kaltwasser']))
  expect(meterTypesInUse([
    item('Nicht umlagefähig', { key: 'meter', meterType: 'kaltwasser' }),
    item('Zuführung Erhaltungsrücklage', { key: 'meter', meterType: 'waerme' }),
  ])).toEqual(new Set())
})

test('Verteilbasis: nur umlagefähige Positionen nach Fläche, Einheiten, Personen oder Gemeinschaft zählen', () => {
  expect(usesUnitBasis([item('Grundsteuer', { key: 'area' })])).toBe(true)
  expect(usesUnitBasis([item('Hauswart', { key: 'direct' })])).toBe(false)
  expect(usesUnitBasis([item('Nicht umlagefähig', { key: 'area' }), item('Zuführung Erhaltungsrücklage', { key: 'persons' })])).toBe(false)
})

// Ein- und Mehrzahl statt „Mietverhältnis(se)“, „Wohnung(en)“, „Position(en)“ und „Belegdatei(en)“ (#180).
test('Zeile „Mietverhältnisse & Flächen“: Ein- und Mehrzahl, Aufzählung mit „und“', () => {
  expect(tenanciesDetail(1, 0, 1, [])).toBe('1 Mietverhältnis · 1 beteiligte Wohnung · vollständig')
  expect(tenanciesDetail(3, 1, 2, ['G1', 'G2'])).toBe('3 Mietverhältnisse, davon 1 ohne Abrechnung · 2 beteiligte Wohnungen · 0 m² und 0 Personen: G1 und G2')
})

// fmtEuro setzt ein geschütztes Leerzeichen vor das Eurozeichen.
const plain = (s: string) => s.replace(/\u00a0/g, ' ')

test('Zeile „Belege erfasst“: Ein- und Mehrzahl', () => {
  expect(plain(itemsDetail(1, 12345, 0))).toBe('1 Position · Summe 123,45 €')
  expect(plain(itemsDetail(12, 100, 1))).toBe('12 Positionen · Summe 1,00 € · 1 Belegdatei')
  expect(plain(itemsDetail(12, 100, 3))).toBe('12 Positionen · Summe 1,00 € · 3 Belegdateien')
})

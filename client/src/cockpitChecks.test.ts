// Cockpit-Prüfungen (#142): Nicht umlagefähige Positionen werden nie verteilt; ihr gespeicherter
// Schlüssel darf deshalb weder Ablesungen verlangen noch die Verteilbasis prüfen lassen.
import { expect, test } from 'vitest'
import type { CostItem } from './types'
import { meterTypesInUse, usesUnitBasis } from './cockpitChecks'

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

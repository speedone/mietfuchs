// Eigene Kostenarten (gewerbliche Abrechnung): Prüfung des Seitenfensters, Zuordnung bei der Vorjahresübernahme, Auswahl
// im Kostenformular und der Name auf der Abrechnung.
import { expect, test } from 'vitest'
import { carriedTypeId, costTypeProblems, EMPTY_COST_TYPE_DRAFT, rowCategory } from './costTypeForm'
import { categoryChoices, categoryValue, chooseCategory, EMPTY_ITEM_FORM, itemToForm } from './costForm'
import type { CostItem, CostType } from './types'

const type = (id: string, name: string, period: string, baseCategory = 'Sonstige Betriebskosten'): CostType =>
  ({ id, propertyId: 'p', period: period as CostType['period'], name, baseCategory, position: 0, itemCount: 0 })
const TYPES = [type('a', 'Sicherheitsdienst', '2025-01'), type('b', 'Verwaltung', '2025-01', 'Nicht umlagefähig'), type('v', 'Sicherheitsdienst', '2024-01')]

test('Seitenfenster: Name Pflicht, höchstens 80 Zeichen, im Zeitraum eindeutig ohne Groß/Klein, Grundart aus der Liste', () => {
  expect(costTypeProblems({ ...EMPTY_COST_TYPE_DRAFT, name: ' ' }, TYPES, null).map((p) => p.field)).toEqual(['name'])
  expect(costTypeProblems({ ...EMPTY_COST_TYPE_DRAFT, name: 'x'.repeat(81) }, TYPES, null).map((p) => p.short)).toEqual(['Höchstens 80 Zeichen'])
  expect(costTypeProblems({ ...EMPTY_COST_TYPE_DRAFT, name: 'sicherheitsdienst' }, TYPES.filter((t) => t.period === '2025-01'), null).map((p) => p.short)).toEqual(['Gibt es schon'])
  // Der eigene Name beim Bearbeiten ist kein Doppel.
  expect(costTypeProblems({ ...EMPTY_COST_TYPE_DRAFT, name: 'Sicherheitsdienst' }, TYPES.filter((t) => t.period === '2025-01'), 'a')).toEqual([])
  expect(costTypeProblems({ name: 'Neu', baseCategory: 'Erfunden' }, TYPES, null).map((p) => p.field)).toEqual(['baseCategory'])
  expect(EMPTY_COST_TYPE_DRAFT.baseCategory).toBe('Sonstige Betriebskosten')
})

test('Vorjahresübernahme: die gleichnamige Kostenart des Zeitraums, sonst keine', () => {
  expect(carriedTypeId('v', TYPES, '2025-01')).toBe('a')
  expect(carriedTypeId('v', TYPES, '2026-01')).toBe('')
  expect(carriedTypeId(undefined, TYPES, '2025-01')).toBe('')
  expect(carriedTypeId('weg', TYPES, '2025-01')).toBe('')
})

test('Auswahl im Kostenformular: eigene Kostenart setzt ihre Grundart, Kostenart von Mietfuchs löst sie; angezeigt = gespeichert', () => {
  const own = chooseCategory({ ...EMPTY_ITEM_FORM, category: 'Aufzug' }, 'typ:b', TYPES, [], [])
  expect([own.category, own.costTypeId, categoryValue(own)]).toEqual(['Nicht umlagefähig', 'b', 'typ:b'])
  const base = chooseCategory(own, 'Gartenpflege', TYPES, [], [])
  expect([base.category, base.costTypeId, categoryValue(base)]).toEqual(['Gartenpflege', '', 'Gartenpflege'])
  // Eine gespeicherte Kostenart, die es im Zeitraum nicht (mehr) gibt, steht trotzdem in der Auswahl.
  const choices = categoryChoices(TYPES.filter((t) => t.period === '2025-01'), { costTypeId: 'weg' })
  expect(choices.own.map((o) => o.value)).toEqual(['typ:a', 'typ:b', 'typ:weg'])
  expect(choices.own[0]?.label).toBe('Sicherheitsdienst (Sonstige Betriebskosten)')
})

test('Formular und Rumpf: die eigene Kostenart geht hin und zurück, leer als null', () => {
  const item = { id: 'i', propertyId: 'p', period: '2025-01', category: 'Sonstige Betriebskosten', costTypeId: 'a', description: 'Wache', amountCents: 100, key: 'area' } as CostItem
  expect(itemToForm(item).costTypeId).toBe('a')
  expect(itemToForm({ ...item, costTypeId: undefined }).costTypeId).toBe('')
})

test('Zeile der Abrechnung: der Name der eigenen Kostenart, sonst die Kostenart', () => {
  expect(rowCategory({ category: 'Sonstige Betriebskosten', costType: 'Sicherheitsdienst' })).toBe('Sicherheitsdienst')
  expect(rowCategory({ category: 'Aufzug' })).toBe('Aufzug')
})

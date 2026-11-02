// Wohin ein Knopf springt (#554): zum Eintrag, wenn es genau einen gibt, sonst zur Karte, in der man das Offene
// erledigt; „Anlegen“ öffnet das Formular. Ohne DOM prüfbar; die Zielseiten prüft sprungziele.test.tsx.
import { expect, test } from 'vitest'
import { isSubject, type JumpTarget } from './focus'
import { AI_SETTINGS_TARGET, CHECKS_TARGET, NEW_COST_ITEM_TARGET, NEW_TENANCY_TARGET, NEW_UNIT_TARGET, SENT_AT_TARGET, TAX_HEADER_TARGET, TENANCIES_TARGET, UPDATE_GUIDE_TARGET, senderFix, soleSubject, unitsTarget } from './jumpTargets'

test('eine Wohnung öffnet sich selbst, mehrere führen zur Karte „Wohnungen“', () => {
  expect(unitsTarget(['u1'])).toEqual({ kind: 'unit', id: 'u1' })
  expect(unitsTarget(['u1', 'u2'])).toEqual({ kind: 'section', section: 'units' })
  expect(unitsTarget([])).toEqual({ kind: 'section', section: 'units' })
})

test('ein Zähler oder eine Position nur, wenn es genau einen gibt; sonst bleibt es bei der Seite', () => {
  expect(soleSubject('meter', ['m1'])).toEqual({ kind: 'meter', id: 'm1' })
  expect(soleSubject('meter', ['m1', 'm2'])).toBeUndefined()
  expect(soleSubject('costItem', [])).toBeUndefined()
})

test('fehlender Absender: zum Vermieter des Objekts oder in die Karte der Einstellungen', () => {
  expect(senderFix(true)).toEqual({ tab: 'stammdaten', label: 'Hier beheben → Stammdaten', focus: { kind: 'property', part: 'landlord' } })
  expect(senderFix(false)).toEqual({ tab: 'einstellungen', label: 'Hier beheben → Einstellungen', focus: { kind: 'section', section: 'landlord' } })
})

test('die festen Ziele der Knöpfe', () => {
  expect(NEW_UNIT_TARGET).toEqual({ kind: 'new', what: 'unit' })
  expect(NEW_TENANCY_TARGET).toEqual({ kind: 'new', what: 'tenancy' })
  expect(NEW_COST_ITEM_TARGET).toEqual({ kind: 'new', what: 'costItem' })
  expect(TENANCIES_TARGET).toEqual({ kind: 'section', section: 'tenancies' })
  expect(CHECKS_TARGET).toEqual({ kind: 'section', section: 'checks' })
  expect(SENT_AT_TARGET).toEqual({ kind: 'section', section: 'sentAt' })
  expect(TAX_HEADER_TARGET).toEqual({ kind: 'property', part: 'tax' })
  expect(AI_SETTINGS_TARGET).toEqual({ kind: 'section', section: 'ai' })
  expect(UPDATE_GUIDE_TARGET).toEqual({ kind: 'section', section: 'about' })
})

test('ein Eintrag des Servers bleibt ein Eintrag, alles andere ist ein Sprungziel der Oberfläche', () => {
  const targets: JumpTarget[] = [{ kind: 'tenancy', id: 't1' }, NEW_UNIT_TARGET, CHECKS_TARGET, TAX_HEADER_TARGET]
  expect(targets.map(isSubject)).toEqual([true, false, false, false])
})

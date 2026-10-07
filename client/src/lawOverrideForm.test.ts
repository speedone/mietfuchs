import { expect, test } from 'vitest'
import { draftOf, overrideBody, statusText, unitOf } from './lawOverrideForm'
import type { LawOverrideSlot } from './types'

const slot = (over: Partial<LawOverrideSlot> = {}): LawOverrideSlot => ({
  paramId: 'co2.price', title: 'CO₂-Preis je Tonne (Plausibilität)', norm: '§ 3 Abs. 3, § 4 Abs. 1 CO2KostAufG', reason: 'UBA veröffentlicht …',
  year: 2027, validFrom: '2027-01-01', official: null, override: null, status: 'open', ...over,
})
const eintrag = { paramId: 'co2.price', validFrom: '2027-01-01', value: 64.2, source: 'UBA', enteredAt: '2026-12-20' }

test('Status in Worten', () => {
  expect(statusText(slot())).toBe('2027: noch nicht veröffentlicht')
  expect(statusText(slot({ status: 'entered', override: eintrag }))).toBe('2027: 64,20 von Ihnen eingetragen am 20.12.2026 (Quelle: UBA)')
  expect(statusText(slot({ status: 'superseded', official: 64.2, override: { ...eintrag, value: 65 } }))).toBe('2027: amtlich 64,20; Ihr Eintrag 65,00 ist überholt')
})

test('Rumpf: Zahl mit Komma und Quelle Pflicht', () => {
  expect(overrideBody({ value: '64,20', source: 'UBA' })).toEqual({ body: { value: 64.2, source: 'UBA' } })
  expect(overrideBody({ value: '64.2', source: ' UBA ' })).toEqual({ body: { value: 64.2, source: 'UBA' } })
  expect(overrideBody({ value: '', source: 'UBA' })).toEqual({ error: 'Bitte geben Sie den Wert als Zahl an, etwa 64,20.' })
  expect(overrideBody({ value: '0', source: 'UBA' })).toEqual({ error: 'Bitte geben Sie den Wert als Zahl an, etwa 64,20.' })
  expect(overrideBody({ value: '64,20', source: ' ' })).toEqual({ error: 'Bitte nennen Sie die Quelle, etwa „UBA, Bekanntmachung vom …“.' })
})

test('Entwurf: leer ohne Eintrag, sonst der Eintrag; Einheit je Wert', () => {
  expect(draftOf(slot())).toEqual({ value: '', source: '' })
  expect(draftOf(slot({ status: 'entered', override: eintrag }))).toEqual({ value: '64,20', source: 'UBA' })
  expect(unitOf(slot())).toBe('€ je Tonne CO₂')
  expect(unitOf({ paramId: 'unbekannt' })).toBeNull()
})

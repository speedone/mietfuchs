import { expect, test } from 'vitest'
import { draftOf, earlyHint, fieldLabel, overrideBody, statusText, unitOf } from './lawOverrideForm'
import type { LawOverrideSlot } from './types'

const slot = (over: Partial<LawOverrideSlot> = {}): LawOverrideSlot => ({
  paramId: 'co2.price', title: 'CO₂-Preis je Tonne (Plausibilität)', norm: '§ 3 Abs. 3, § 4 Abs. 1 CO2KostAufG', reason: 'UBA veröffentlicht …',
  year: 2027, yearLabel: '2027', validFrom: '2027-01-01', official: null, override: null, status: 'open', ...over,
})
const ets = (over: Partial<LawOverrideSlot> = {}) => slot({ paramId: 'co2.price-ets', title: 'Durchschnittspreis des EU-Emissionshandels (Plausibilität)', yearLabel: 'für Rechnungen aus 2027 (Durchschnitt der Versteigerungen 2026)', ...over })
const eintrag = { paramId: 'co2.price', validFrom: '2027-01-01', value: 64.2, source: 'UBA', enteredAt: '2026-12-20' }

test('Status in Worten, mit Einheit (R-K2) und dem Jahr, wie es zu lesen ist (R-W4)', () => {
  expect(statusText(slot())).toBe('2027: noch nicht veröffentlicht')
  expect(statusText(slot({ status: 'entered', override: eintrag }))).toBe('2027: 64,20 €/t von Ihnen eingetragen am 20.12.2026 (Quelle: UBA)')
  expect(statusText(slot({ status: 'superseded', official: 64.2, override: { ...eintrag, value: 65 } }))).toBe('2027: amtlich 64,20 €/t; Ihr Eintrag 65,00 €/t ist überholt')
  expect(statusText(ets())).toBe('Für Rechnungen aus 2027 (Durchschnitt der Versteigerungen 2026): noch nicht veröffentlicht')
})

test('Feld: welches Jahr, welche Einheit, ohne Umsatzsteuer (R-W4, R-K2)', () => {
  expect(fieldLabel(slot())).toBe('Wert 2027, in € je Tonne CO₂ ohne Umsatzsteuer')
  expect(fieldLabel(ets())).toBe('Wert für Rechnungen aus 2027 (Durchschnitt der Versteigerungen 2026), in € je Tonne CO₂ ohne Umsatzsteuer')
  expect(fieldLabel({ ...slot(), paramId: 'unbekannt' })).toBe('Wert 2027')
})

test('R-K3: vor Dezember des Vorjahres kann der Wert noch nicht veröffentlicht sein', () => {
  expect(earlyHint(slot(), '2026-10-07')).toMatch(/frühestens im Dezember 2026/)
  expect(earlyHint(slot(), '2026-12-01')).toBeNull()
  expect(earlyHint(slot({ status: 'superseded', official: 64.2 }), '2026-10-07')).toBeNull()
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
  expect(unitOf(slot())).toBe('€/t')
  expect(unitOf({ paramId: 'unbekannt' })).toBeNull()
})

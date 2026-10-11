// Karte „Betriebsstrom der Heizung“ (#266): wann sie erscheint, welche Auswahl sie bietet und was sie speichert.
import { expect, test } from 'vitest'
import type { HeatingPlant } from './types'
import { handlingBody, handlingOptions, handlingValue, showsHandlingCard } from './operatingPowerHandling'
import { OPERATING_POWER_HANDLING_LABELS } from '../../shared/operatingPower.ts'

const plant = (over: Partial<HeatingPlant> = {}) => ({ energy: 'gas', method: 'manual', source: 'building', supply: 'central', ...over }) as HeatingPlant

test('sichtbar bei Zentralheizungen mit Brenner ohne Messdienst, sonst nicht', () => {
  expect(showsHandlingCard(plant())).toBe(true)
  expect(showsHandlingCard(plant({ method: 'self', energy: 'oil' }))).toBe(true)
  expect(showsHandlingCard(plant({ method: 'service' }))).toBe(false)
  expect(showsHandlingCard(plant({ source: 'homeowners', method: 'service' }))).toBe(false)
  expect(showsHandlingCard(plant({ supply: 'perUnit' }))).toBe(false)
  for (const energy of ['districtHeating', 'heatPump', 'electric', 'other'] as const) expect(showsHandlingCard(plant({ energy }))).toBe(false)
})

test('Auswahl: „Keine Angabe“ zuerst, dann jede Angabe mit der gemeinsamen Beschriftung', () => {
  expect(handlingOptions()).toEqual([
    { value: '', label: 'Keine Angabe' },
    { value: 'ownMeter', label: OPERATING_POWER_HANDLING_LABELS.ownMeter },
    { value: 'deducted', label: OPERATING_POWER_HANDLING_LABELS.deducted },
    { value: 'landlordPays', label: OPERATING_POWER_HANDLING_LABELS.landlordPays },
  ])
})

test('angezeigter Wert ist der gespeicherte; keine Angabe ist der leere Eintrag', () => {
  for (const v of ['ownMeter', 'deducted', 'landlordPays'] as const) expect(handlingValue(plant({ operatingPowerHandling: v }))).toBe(v)
  expect(handlingValue(plant({ operatingPowerHandling: null }))).toBe('')
  // Ein Tab von vor dem Update kennt das Feld nicht.
  expect(handlingValue(plant())).toBe('')
  for (const { value } of handlingOptions()) expect(handlingOptions().map((o) => o.value)).toContain(handlingValue(plant({ operatingPowerHandling: value === '' ? null : value })))
})

test('Rumpf: leer heißt null, sonst die Angabe', () => {
  expect(handlingBody('')).toEqual({ operatingPowerHandling: null })
  expect(handlingBody('deducted')).toEqual({ operatingPowerHandling: 'deducted' })
})

// Die Karte „Betriebsstrom“ (Heizung PR 15, #212) ohne DOM: Auswahl der Stromrechnung, Vorschau und Rumpf.
import { expect, test } from 'vitest'
import { emptyOperatingPowerForm, generalItemOptions, operatingPowerPreview, operatingPowerRequest, type OperatingPowerForm } from './operatingPowerForm'
import { CALENDAR_RULES, periodKey } from '../../shared/period.ts'
import type { CostItem } from './types'

const strom: CostItem = { id: 'strom', propertyId: 'o', period: periodKey('2025-01'), category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'area' }
const ausgefuellt = (over: Partial<OperatingPowerForm> = {}): OperatingPowerForm => ({
  ...emptyOperatingPowerForm(), generalItemId: 'strom', billKwh: '3.000', heatingDays: '220',
  devices: [{ label: 'Brenner', watts: '120', hours: '6', days: '' }, { label: 'Umwälzpumpe', watts: '45', hours: '24', days: '' }, { label: 'Regelung', watts: '5', hours: '24', days: '' }],
  ...over,
})

test('Auswahl: nur Allgemeinstrom mit positivem Betrag und ohne Kennzeichnung, mit leerem ersten Eintrag', () => {
  const abzug: CostItem = { ...strom, id: 'ab', amountCents: -100, operatingPower: 'deduction' }
  const grund: CostItem = { ...strom, id: 'g', category: 'Grundsteuer' }
  expect(generalItemOptions([strom, abzug, grund], { from: '2025-01-01', to: '2025-12-31' }, CALENDAR_RULES)).toEqual([
    { value: '', label: 'Bitte wählen …' },
    { value: 'strom', label: 'Hausstrom 2025 · 2025 · 1.050,00\u00a0€' },
  ])
})

// Durchsicht von #252, G-K1 und N1: nur Stromrechnungen, deren Zeitraum sich mit der Heizperiode
// überschneidet, beschriftet mit ihrem Zeitraum.
test('Auswahl: nur Stromrechnungen, die die Heizperiode berühren; bei Heizperiode Mai–April beide Kalenderjahre', () => {
  const alt: CostItem = { ...strom, id: 'alt', period: periodKey('2024-01'), description: 'Hausstrom' }
  const neu: CostItem = { ...strom, id: 'neu', period: periodKey('2026-01'), description: 'Hausstrom' }
  const kalender = generalItemOptions([alt, strom, neu], { from: '2025-01-01', to: '2025-12-31' }, CALENDAR_RULES).map((o) => o.value)
  expect(kalender).toEqual(['', 'strom'])
  const maiApril = generalItemOptions([alt, strom, neu], { from: '2025-05-01', to: '2026-04-30' }, CALENDAR_RULES).map((o) => o.label)
  expect(maiApril).toEqual(['Bitte wählen …', 'Hausstrom 2025 · 2025 · 1.050,00\u00a0€', 'Hausstrom · 2026 · 1.050,00\u00a0€'])
})

test('Vorschau: 147,84 € mit Rechenweg; ohne Stromrechnung ein Satz', () => {
  const v = operatingPowerPreview(ausgefuellt(), [strom])
  expect(v).toEqual({ ok: true, cents: 14784, lines: expect.arrayContaining(['zusammen 422,4 kWh von 3.000 kWh der Stromrechnung = 14,08 %', '14,08 % des Rechnungsbetrags einschließlich Grundpreis (1.050,00 €) = 147,84 €']) })
  expect(operatingPowerPreview(ausgefuellt({ generalItemId: '' }), [strom])).toEqual({ ok: false, text: 'Bitte wählen Sie die Stromrechnung des Hauses.' })
})

test('Gemessen: die Geräte zählen nicht', () => {
  const v = operatingPowerPreview(ausgefuellt({ mode: 'measured', measuredKwh: '500' }), [strom])
  expect(v).toMatchObject({ ok: true, cents: 17500 })
})

test('Rumpf: Zahlen mit Komma, gemessen ohne Geräte', () => {
  expect(operatingPowerRequest(ausgefuellt({ devices: [{ label: 'Pumpe', watts: '45,5', hours: '24', days: '' }] }), '2025-01')).toEqual({
    period: '2025-01', generalItemId: 'strom', billKwh: 3000, devices: [{ label: 'Pumpe', watts: 45.5, hoursPerDay: 24, days: null }], heatingDays: 220,
  })
  expect(operatingPowerRequest(ausgefuellt({ mode: 'measured', measuredKwh: '500' }), '2025-01')).toEqual({
    period: '2025-01', generalItemId: 'strom', billKwh: 3000, measuredKwh: 500,
  })
})

// P-K8: eigene Tage je Gerät; leer heißt die Heiztage.
test('Tage je Gerät: leer ist null, sonst die Zahl', () => {
  const form = ausgefuellt({ devices: [{ label: 'Pumpe', watts: '45', hours: '24', days: '' }, { label: 'WW-Pumpe', watts: '25', hours: '4', days: '360' }] })
  expect(operatingPowerRequest(form, '2025-01')).toMatchObject({
    devices: [{ label: 'Pumpe', watts: 45, hoursPerDay: 24, days: null }, { label: 'WW-Pumpe', watts: 25, hoursPerDay: 4, days: 360 }],
  })
  expect(operatingPowerPreview(form, [strom])).toMatchObject({ ok: true, cents: 9576 })
})

// P-W2: der dritte Weg, ohne kWh und ohne Geräte.
test('Selbst geschätzt: Vorschau mit Grundlage, Rumpf mit Cent und Grundlage', () => {
  const form = ausgefuellt({ mode: 'own', ownAmount: '147,84', basis: 'Bruchteil der Brennstoffkosten 2025' })
  expect(operatingPowerPreview(form, [strom])).toEqual({ ok: true, cents: 14784, lines: ['selbst geschätzt: 147,84 €', 'Grundlage der Schätzung: Bruchteil der Brennstoffkosten 2025'] })
  expect(operatingPowerRequest(form, '2025-01')).toEqual({ period: '2025-01', generalItemId: 'strom', ownCents: 14784, basis: 'Bruchteil der Brennstoffkosten 2025' })
  expect(operatingPowerPreview({ ...form, basis: '' }, [strom])).toMatchObject({ ok: false, text: expect.stringMatching(/Grundlage der Schätzung/) })
})

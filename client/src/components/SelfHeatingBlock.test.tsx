// @vitest-environment jsdom
// Durchsicht von #241, Recht-I1: Der Druckblock des Nachmieters zeigt nur sein Gerätesegment.
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SelfHeatingBlock from './SelfHeatingBlock'
import type { SelfHeatingStatement, SelfUserView } from '../types'

afterEach(() => cleanup())

const user = (key: string, from: string, to: string): SelfUserView => ({
  key, role: 'tenancy', tenancyId: key, label: `Mieter ${key}`, from, to, days: 1, degreeDayPermille: 0,
  heatingConsumption: 1, waterConsumption: null, heatingGroup: false, waterGroup: false, heatingCents: 0, waterCents: 0, heatingCo2Cents: 0, waterCo2Cents: 0,
})
const self: SelfHeatingStatement = {
  ok: true, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'none', alpha: null, shares: null,
  pots: [{ pot: 'heating', costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2: 60, consumption: 500, consumptionUnit: 'Einheiten', baseCentsPerM2: 0, consumptionCentsPerUnit: null }],
  units: [{ unitId: 'c', unitName: 'C', areaM2: 60, heatAreaM2: 60, readings: [], boundaries: [], users: [user('C1', '2025-01-01', '2025-09-30'), user('C2', '2025-10-01', '2025-12-31')] }],
  devices: [
    { unitId: 'c', meterId: 'c1', name: 'Wohnzimmer', scale: 'unit', factor: 1.25, raw: 300, rated: 375, userKeys: ['C1'], from: '2025-01-01', to: '2025-09-30' },
    { unitId: 'c', meterId: 'c1', name: 'Wohnzimmer', scale: 'unit', factor: 1.25, raw: 200, rated: 250, userKeys: ['C2'], from: '2025-10-01', to: '2025-12-31' },
  ],
}

test('Der Nachmieter sieht sein Gerätesegment, nicht das des Vormieters', () => {
  render(<SelfHeatingBlock self={self} tenancyId="C2" plantName="" />)
  expect(screen.getByText(/Ablesewert 200 × Bewertungsfaktor 1,25 = 250 Einheiten/)).toBeTruthy()
  expect(screen.queryByText(/Ablesewert 300/)).toBeNull()
})

test('Durchsicht von #243, G-W3: Nach einer Vereinbarung nach § 2 „nach Wohnfläche“ sagt der Druck es', () => {
  render(<SelfHeatingBlock self={{ ...self, agreedArea: true }} tenancyId="C2" plantName="" />)
  expect(screen.getByText(/Verteilt nach der Wohnfläche, wie mit den Mietern vereinbart \(§ 2 HeizkostenV\)/)).toBeTruthy()
  cleanup()
  render(<SelfHeatingBlock self={self} tenancyId="C2" plantName="" />)
  expect(screen.queryByText(/wie mit den Mietern vereinbart/)).toBeNull()
})

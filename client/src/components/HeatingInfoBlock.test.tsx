// @vitest-environment jsdom
// Durchsicht von #243, Runde 3 (N2-K1): Der Druckblock eines Mieters im ersten Jahr sagt keinen Vorjahresvergleich zu.
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import HeatingInfoBlock from './HeatingInfoBlock'
import type { HeatingInfoStatement } from '../types'

afterEach(() => cleanup())

const user = (tenancyId: string, firstPeriod: boolean) => ({
  tenancyId, label: tenancyId, days: 365, prevDays: firstPeriod ? null : 365, heating: null, water: null, firstPeriod, prevUnknown: false, estimated: false, missing: [], ghgKg: null,
})
const info: HeatingInfoStatement = {
  scope: 'full', carriers: [{ energy: 'gas', percent: 100 }], district: null, taxesText: 'Energiesteuer', meteringCents: null, comparisonSource: 'Ablesedienst, Anlage 2', comparisonCoversPrev: true,
  reference: null, referenceComparable: false, contacts: [], contactsChecked: '2026-10-07', dispute: { kind: 'none' },
  climate: { factor: null, factorPrev: null, source: null }, units: { heating: 'Einheiten', water: 'm³' },
  users: [user('A', false), user('C2', true)], missing: [], uncertain: [], comparisons: true, mixedGeneration: false, heatExempt: false,
}

test('Mieter im ersten Jahr: nur der Vergleich mit dem Durchschnittsnutzer liegt bei', () => {
  render(<HeatingInfoBlock info={info} tenancyId="C2" plantName="" />)
  expect(screen.getByText('Vergleich mit einem Durchschnittsnutzer: liegt der Abrechnung bei (Ablesedienst, Anlage 2)')).toBeTruthy()
  cleanup()
  render(<HeatingInfoBlock info={info} tenancyId="A" plantName="" />)
  expect(screen.getByText('Vergleich mit einem Durchschnittsnutzer und mit dem vorhergehenden Abrechnungszeitraum: liegt der Abrechnung bei (Ablesedienst, Anlage 2)')).toBeTruthy()
})

// Nebenkostenmodell am Mietverhältnis (#93), die Seite der Oberfläche.
import { expect, test } from 'vitest'
import { COST_MODEL_LABELS, costModelBody, notSettledText, prepaymentLabel } from './tenancyModel'

test('die Staffel heißt bei einer Pauschale „Pauschale“, sonst „Vorauszahlung“', () => {
  expect(prepaymentLabel('flatRate', 'settlement')).toMatch(/Pauschale/)
  expect(prepaymentLabel('settlement', 'settlement')).toMatch(/Vorauszahlung/)
  expect(prepaymentLabel(undefined, undefined)).toMatch(/Vorauszahlung/)
})

test('„Abrechnung“ wird als null gespeichert, damit ohne Angabe dasselbe gilt wie vorher', () => {
  expect(costModelBody('settlement', 'inclusive')).toEqual({ costModel: null, heatingModel: 'inclusive' })
})

test('der Hinweis „Ohne Abrechnung“ nennt das Modell in Worten', () => {
  expect(notSettledText({ tenancyId: 't', tenantName: 'Jonas Schulz', unitName: 'OG', costModel: 'flatRate', heatingModel: 'settlement' }))
    .toBe('Jonas Schulz (OG): Nebenkosten als Pauschale')
  expect(notSettledText({ tenancyId: 't', tenantName: 'A', unitName: 'EG', costModel: 'inclusive', heatingModel: 'inclusive' }))
    .toBe('A (EG): Nebenkosten in der Miete enthalten, Heizung in der Miete enthalten')
  expect(Object.keys(COST_MODEL_LABELS)).toEqual(['settlement', 'flatRate', 'inclusive'])
})

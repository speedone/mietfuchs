// @vitest-environment jsdom
// Druck des Schreibens einer Mieterhöhung (#191, Nacharbeit): Das Schreiben hat mit der Zustimmungserklärung zwei
// Seiten; wie die Abrechnung druckt es „Seite x von y“ im Seitenrand (`pageNumbers` in printJob.ts), mit Briefpapier nicht.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { RentIncreasePrint } from './RentIncreaseLetter'
import type { RentIncrease, RentIncreaseBasis, RentIncreasePlan } from '../types'

const PLAN: RentIncreasePlan = {
  kind: 'comparison', state: 'possible', reasons: [], warnings: [], needs: [], currentCents: 50000, currentSince: '2020-01-01',
  receivedOn: '2026-11-20', today: '2026-11-20', capBaseDay: null, earliestReceivedOn: '2026-11-20', effectiveFrom: '2027-02', earliestEffectiveFrom: '2027-02',
  consent: { consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitFrom: '2027-02-02', suitEnd: '2027-04-30' }, cap: null,
  comparison: { centsPerM2: 1000, areaM2: 60, rentCents: 60000, operatingCostsCents: null, limitCents: 60000 }, index: null, maxCents: 60000, newCents: 60000,
  steps: [], staggered: null, legalValues: [], refusals: [],
}
const BASIS: RentIncreaseBasis = {
  version: 1, letterDate: '2026-11-20', request: { kind: 'comparison' }, plan: PLAN,
  letter: { justification: 'expert', survey: null, expert: { name: 'Dipl.-Ing. Muster', date: '2026-10-01' }, database: null, comparables: [], qualifiedSurvey: 'no', qualified: null, recipientName: 'Erika Mustermann', severalLandlords: false, allLandlordsNamed: true, allTenantsNamed: true, extraParagraph: '' },
  rentCap: { answer: 'yes', answeredOn: '2026-11-20' },
  sender: { name: 'Max Vermieter', address: '', contact: '', returnLine: 'Max Vermieter', footer: '' },
  recipient: ['Erika Mustermann'], salutation: 'Guten Tag Erika Mustermann,',
  premises: { propertyName: 'Haus', address: '', unitName: 'EG', areaM2: 60 }, inclusive: false,
  prepayments: { operatingCents: 0, heatingCents: 0, flatRateCents: 0 }, sentPlan: null,
}
const INCREASE: RentIncrease = {
  id: 'r1', tenancyId: 't1', kind: 'comparison', createdOn: '2026-11-20', receivedOn: null, effectiveFrom: '2027-02', fromCents: 50000, toCents: 60000,
  basis: BASIS, status: 'draft', agreedCents: null, decidedOn: null,
}

beforeEach(() => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ installation: { logo: null, paper: null, paperNext: 'same', paperNextFile: null, margins: { top: 45, right: 20, bottom: 30, left: 25 } }, property: null }), { status: 200, headers: { 'content-type': 'application/json' } }))
  window.print = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Mieterhöhung, Druck: ohne Briefpapier steht „Seite x von y“ im Seitenrand, und nach dem Abbau ist die Angabe wieder weg', async () => {
  const { unmount } = render(<RentIncreasePrint increase={INCREASE} propertyId="p1" onDone={() => {}} />)
  await waitFor(() => expect(document.body.classList.contains('print-rent-increase')).toBe(true))
  const style = document.head.querySelector('style[data-page-numbers]')
  expect(style?.textContent).toMatch(/"Seite " counter\(page\) " von " counter\(pages\)/)
  unmount()
  expect(document.head.querySelector('style[data-page-numbers]')).toBeNull()
})

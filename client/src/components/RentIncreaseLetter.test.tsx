// @vitest-environment jsdom
// Druck des Schreibens einer Mieterhöhung (#191, Nacharbeit): Das Schreiben hat mit der Zustimmungserklärung zwei
// Seiten; wie die Abrechnung druckt es „Seite x von y“ im Seitenrand (`pageNumbers` in printJob.ts), mit Briefpapier nicht.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { RentIncreaseLetterSheet, RentIncreasePrint } from './RentIncreaseLetter'
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

// Mit Briefpapier druckt die Seite ohne Rand; die Ränder je Druckseite hält der Rahmen der Hülle `PrintPages`. Ohne ihn
// lief das Schreiben über den Fuß des Briefpapiers und begann Seite 2 an der Blattkante (nachgemessen im PDF; die Lagen
// selbst prüft scripts/print-width-check.mjs, Fall `mieterhoehung-briefpapier`).
test('Mieterhöhung, Druck mit Briefpapier: Schreiben und Zustimmungserklärung je im Rahmen mit den Rändern, das Papier der Folgeseiten im Kopf', () => {
  const design = { logo: null, paper: 'data:image/png;base64,AAAA', follow: 'data:image/png;base64,BBBB', margins: { top: 42, right: 20, bottom: 38, left: 25 }, ready: true, failed: [] }
  const { container, unmount } = render(<RentIncreaseLetterSheet increase={INCREASE} design={design} />)
  const frames = [...container.querySelectorAll('.print-pages-frame')]
  expect(frames).toHaveLength(2)
  expect(frames.map((f) => f.classList.contains('print-pages-new'))).toEqual([false, true])
  for (const f of frames) {
    expect(f.querySelector('thead img.paper-follow')?.getAttribute('src')).toBe(design.follow)
    expect(f.querySelector('tbody section.letter.rent-increase-paged')).not.toBeNull()
  }
  expect(frames[0]?.querySelector('img.letter-paper')?.getAttribute('src')).toBe(design.paper)
  expect(frames[1]?.querySelector('.rent-increase-consent')).not.toBeNull()
  unmount()
  // Ohne Briefpapier (auch in einem Browser, der es nicht je Seite drucken kann) bleibt der Aufbau, wie er war.
  const plain = render(<RentIncreaseLetterSheet increase={INCREASE} design={{ ...design, paper: null, follow: null, margins: null }} />)
  expect(plain.container.querySelector('.print-pages-frame, .print-pages, .rent-increase-paged')).toBeNull()
  expect(plain.container.querySelectorAll('section.letter')).toHaveLength(2)
})

test('Mieterhöhung, Druck: die Erklärung zur Indexmiete hat keine Zustimmungserklärung und druckt keine Seitenzahl („Seite 1 von 1“)', async () => {
  const index: RentIncrease = { ...INCREASE, kind: 'index', basis: { ...BASIS, plan: { ...PLAN, kind: 'index', consent: null, comparison: null, index: { from: { month: '2024-01', value: 100, base: 2020 }, to: { month: '2026-09', value: 106.1, base: 2020 } } }, letter: { ...BASIS.letter, justification: null, expert: null, qualifiedSurvey: null } } }
  render(<RentIncreasePrint increase={index} propertyId="p1" onDone={() => {}} />)
  await waitFor(() => expect(document.body.classList.contains('print-rent-increase')).toBe(true))
  expect(document.head.querySelector('style[data-page-numbers]')).toBeNull()
})

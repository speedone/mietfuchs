// @vitest-environment jsdom
// Der Brief zur Aufstellung der Kaution im Druck mit Briefpapier (#228, Durchsicht): Mit vielen Buchungen läuft er über
// mehr als eine Seite. Die Ränder je Druckseite hält der Rahmen der Hülle `PrintPages`, wie beim Schreiben der
// Mieterhöhung; ohne ihn lief der Text über den Fuß des Briefpapiers (nachgemessen im PDF; die Lagen prüft
// scripts/print-width-check.mjs, Fall `kaution-briefpapier`).
import { afterEach, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DepositLetterSheet } from './DepositLetter'
import { depositLetterView } from '../depositLetter'
import type { DepositSettlement } from '../depositSettlement'

afterEach(cleanup)

const SETTLEMENT: DepositSettlement = {
  rows: [{ label: 'Eingang', cents: 240000, date: '2022-01-05' }],
  balanceCents: 240000, hold: null, payoutCents: 240000, lastStatement: null, lastHeatingStatement: null, pending: [],
}
const VIEW = depositLetterView({
  tenancy: { tenantName: 'Erika Mustermann' }, end: '2025-12-31', unitName: 'EG links', property: { name: 'Haus Birke', address: 'Lindenweg 12, 12345 Musterstadt' },
  landlord: { landlordName: 'Petra Vermieterin', landlordAddress: '', landlordContact: '' }, settlement: SETTLEMENT, today: '2026-01-15',
})

test('mit Briefpapier steht der Brief im Rahmen mit den Rändern, das Papier der Folgeseiten im Kopf', () => {
  const design = { logo: null, paper: 'data:image/png;base64,AAAA', follow: 'data:image/png;base64,BBBB', margins: { top: 45, right: 20, bottom: 30, left: 25 }, ready: true, failed: [] }
  const { container } = render(<DepositLetterSheet view={VIEW} settlement={SETTLEMENT} design={design} />)
  const frames = [...container.querySelectorAll('.print-pages-frame')]
  expect(frames).toHaveLength(1)
  expect(frames[0]?.querySelector('thead img.paper-follow')?.getAttribute('src')).toBe(design.follow)
  expect(frames[0]?.querySelector('tbody section.letter.letter-paged')).not.toBeNull()
  expect(frames[0]?.querySelector('img.letter-paper')?.getAttribute('src')).toBe(design.paper)
})

test('ohne Briefpapier (auch in einem Browser, der es nicht je Seite drucken kann) bleibt der Aufbau ohne Hülle', () => {
  const { container } = render(<DepositLetterSheet view={VIEW} settlement={SETTLEMENT} design={{ logo: null, paper: null, follow: null, margins: null, ready: true, failed: [] }} />)
  expect(container.querySelector('.print-pages-frame, .print-pages, .letter-paged')).toBeNull()
  expect(container.querySelectorAll('section.letter')).toHaveLength(1)
})

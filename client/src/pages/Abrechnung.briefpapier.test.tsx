// @vitest-environment jsdom
// Logo und Briefpapier auf der Seite Abrechnung (#415, Teil 2b): was im Druck erscheint und was mit Briefpapier
// entfällt. Die Lage auf dem Blatt prüft der Druck mit Chromium (siehe PR), hier nur der Aufbau.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PeriodProvider } from '../period'
import type { LetterTemplates, Settings, Settlement, Statement, Tenancy } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung from './Abrechnung'
import { DEFAULT_LETTER_TEXTS, lettersOf } from '../../../shared/letter.ts'
import { DEFAULT_LETTER_DESIGN } from '../../../shared/letterDesign.ts'
import type { LetterDesign } from '../../../shared/types.ts'
import { calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const YEAR = new Date().getFullYear() - 1
const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ')

const TENANCIES: Tenancy[] = [{
  id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }],
  start: '2020-01-01', end: null, prepayments: [{ from: '2020-01', monthlyCents: 4000 }], prepaymentOverrides: {}, baseRents: [],
}]
const STATEMENT: Statement = {
  tenancyId: 't1', unitId: 'u1', tenantName: 'Meier', unitName: 'EG', persons: 1, days: 365, personDays: 365,
  periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`,
  rows: [{ costItemId: 'k1', category: 'Grundsteuer', description: 'Grundsteuer', totalCents: 120000, keyLabel: 'Wohnfläche', basisText: '60 m² von 120 m²', shareCents: 60000 }],
  totalShareCents: 60000, total35aCents: 0, prepaymentCents: 48000, prepaymentOverridden: false, suggestedMonthlyCents: 5000, balanceCents: -12000,
}
const SETTINGS: Settings = { houseName: '', address: '', landlordName: 'Max Vermieter', iban: 'DE02120300000000202051', paymentDeadlineDays: 14, ollamaUrl: '', ollamaModel: '' }
const TEMPLATES: LetterTemplates = { defaults: DEFAULT_LETTER_TEXTS, installation: {}, property: {}, adjustDefault: 'suggestion' }

let settlement: Settlement
let designs: unknown
let missingFiles: string[]
let templates: LetterTemplates
let costItems: unknown[]
let ownLetters: Record<string, unknown>
let puts: { url: string, body: unknown }[]
beforeEach(() => {
  const base: Settlement = {
    year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, statements: [STATEMENT],
    landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 120000, warnings: [], notices: [], closed: null,
  }
  const property = { id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh' as const, address: 'Lindenweg 12, 12345 Musterstadt', landlordName: null, iban: null, paymentDeadlineDays: null }
  settlement = { ...base, letters: lettersOf(base, { settings: SETTINGS, property, tenancies: TENANCIES, installation: {}, propertyTexts: {}, own: {} }) }
  puts = []
  ownLetters = {}
  templates = TEMPLATES
  costItems = []
  designs = { installation: DEFAULT_LETTER_DESIGN, property: null }
  missingFiles = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (init?.method === 'PUT') {
      puts.push({ url: path, body: JSON.parse(String(init.body)) })
      return json({ ok: true })
    }
    if (path === '/api/properties') return json([property])
    if (path === `/api/settlement/${YEAR}`) return json(settlement)
    if (path === '/api/costItems') return json(costItems)
    if (path === '/api/letter-texts') return json(templates)
    if (path === '/api/letter-design') return json(designs)
    if (missingFiles.some((f) => path.endsWith(f))) return new Response('{}', { status: 404 })
    if (path === `/api/settlement/${YEAR}/letters`) return json(ownLetters)
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const show = (settings: Settings = SETTINGS) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider><Abrechnung settings={settings} units={[]} tenancies={TENANCIES} reload={async () => {}} /></UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

const LOGO = { file: 'logo-0123456789abcdef.png', type: 'png' as const }
const PAPER = { file: 'paper-0123456789abcdef.png', type: 'png' as const }
const NEXT = { file: 'paper-1123456789abcdef.jpg', type: 'jpg' as const }
const url = (f: { file: string }) => `/api/letter-design/files/${f.file}`
const statementOf = async () => {
  const letter = await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  return letter.closest('.statement') ?? (() => { throw new Error('keine Mieterabrechnung') })()
}

test('Logo ohne Briefpapier: oben rechts im Briefkopf, sonst bleibt alles wie bisher', async () => {
  designs = { installation: { ...DEFAULT_LETTER_DESIGN, logo: LOGO }, property: null }
  const { container } = show()
  const card = await statementOf()
  await waitFor(() => expect(card.querySelector('img.letter-logo')?.getAttribute('src')).toBe(url(LOGO)), SLOW)
  expect(card.querySelector('.letter-head')?.textContent).toContain('Max Vermieter')
  expect(card.classList.contains('paper-print')).toBe(false)
  expect(container.querySelector('style')).toBeNull()
})

test('Briefpapier: ohne Seitenrand, Papier auf der ersten und den Folgeseiten, ohne Absender und Fußzeile von Mietfuchs', async () => {
  const own: LetterDesign = { ...DEFAULT_LETTER_DESIGN, logo: LOGO, paper: PAPER, paperNext: 'other', paperNextFile: NEXT, margins: { top: 40, right: 15, bottom: 30, left: 25 } }
  designs = { installation: DEFAULT_LETTER_DESIGN, property: own }
  const { container } = show({ ...SETTINGS, printFooter: true })
  const card = await statementOf()
  await waitFor(() => expect(card.querySelector('img.letter-paper')?.getAttribute('src')).toBe(url(PAPER)), SLOW)
  expect(card.classList.contains('paper-print')).toBe(true)
  expect((card as HTMLElement).style.getPropertyValue('--paper-top')).toBe('40mm')
  expect(container.querySelector('style')?.textContent).toMatch(/@page\s*\{\s*margin:\s*0/)
  // Das Papier der Folgeseiten liegt im Kopf der Hülle, den der Browser je Seite wiederholt, nicht unter den Belegkopien.
  expect(card.querySelector('.print-pages > thead img.paper-follow')?.getAttribute('src')).toBe(url(NEXT))
  expect(container.querySelectorAll('img.paper-follow')).toHaveLength(1)
  // Der Absender steht auf dem Briefpapier; die Rücksendeangabe im Fenster bleibt.
  expect(card.querySelector('.letter-head')).toBeNull()
  expect(card.querySelector('.letter-return')?.textContent).toBeTruthy()
  expect(card.querySelector('img.letter-logo')).not.toBeNull()
  expect(card.querySelector('.letter-footer')).toBeNull()
  expect(card.querySelector('.statement-footnote')?.textContent).not.toContain('DE02')
  // Der Kopf jeder Druckseite der Aufstellung hält den oberen Rand frei.
  expect(card.querySelector('.print-pages > thead .print-pages-spacer')).not.toBeNull()
})

test('Briefpapier nur auf der ersten Seite: kein Papier auf den Folgeseiten', async () => {
  designs = { installation: { ...DEFAULT_LETTER_DESIGN, paper: PAPER, paperNext: 'none' }, property: null }
  const { container } = show()
  const card = await statementOf()
  await waitFor(() => expect(card.querySelector('img.letter-paper')).not.toBeNull(), SLOW)
  expect(container.querySelector('img.paper-follow')).toBeNull()
})

test('vor #415 abgeschlossen: ohne Logo und Briefpapier, wie damals gedruckt', async () => {
  designs = { installation: { ...DEFAULT_LETTER_DESIGN, logo: LOGO, paper: PAPER }, property: null }
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null }, letters: undefined }
  const { container } = show()
  await screen.findByText(/Nachzahlung zu Ihren Lasten/, undefined, SLOW)
  await waitFor(() => expect(container.querySelector('.statement')).not.toBeNull())
  expect(container.querySelector('img.letter-logo, img.letter-paper, img.paper-follow, style')).toBeNull()
})

test('fehlt das Briefpapier, druckt die Seite wie ohne: mit Rand, Absender und Hinweis, und „Drucken“ geht (Durchsicht M2)', async () => {
  designs = { installation: { ...DEFAULT_LETTER_DESIGN, logo: LOGO, paper: PAPER }, property: null }
  missingFiles = [PAPER.file]
  const { container } = show()
  const card = await statementOf()
  await waitFor(() => expect(container.textContent).toContain("Briefpapier: Die Datei fehlt"), SLOW)
  expect(container.querySelector('style')).toBeNull()
  expect(card.classList.contains('paper-print')).toBe(false)
  expect(card.querySelector('img.letter-paper')).toBeNull()
  expect(card.querySelector('.letter-head')?.textContent).toContain('Max Vermieter')
  expect(card.querySelector('img.letter-logo')?.getAttribute('src')).toBe(url(LOGO))
  expect((within(card as HTMLElement).getByRole("button", { name: /Drucken/ }) as HTMLButtonElement).disabled).toBe(false)
})

test('meldet der Server eine fehlende Datei, nennt die Seite sie', async () => {
  designs = { installation: { ...DEFAULT_LETTER_DESIGN, logo: null }, property: null, missing: ['Logo'] }
  show()
  await statementOf()
  await screen.findByText(/Logo: Die Datei fehlt im Datenordner/, undefined, SLOW)
})

// @vitest-environment jsdom
// Das Anschreiben auf der Seite Abrechnung (#415): Seite 1 vor der Aufstellung, Ergebniskasten, die
// Pflichtangaben der Aufstellung bleiben, und Bearbeiten je Mieter im Seitenfenster.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PeriodProvider } from '../period'
import type { LetterTemplates, Settings, Settlement, Statement, Tenancy } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung from './Abrechnung'
import { DEFAULT_LETTER_TEXTS, lettersOf } from '../../../shared/letter.ts'
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
  settlement = { ...base, letters: lettersOf(base, { settings: SETTINGS, property, tenancies: TENANCIES, installation: {}, propertyTexts: {}, own: {}, asOf: '2026-10-30' }) }
  puts = []
  ownLetters = {}
  templates = TEMPLATES
  costItems = []
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

test('Seite 1 ist das Anschreiben, danach die Aufstellung mit Ergebniskasten und allen Pflichtangaben', async () => {
  show()
  const letter = await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  const card = letter.closest('.statement')
  if (!card) throw new Error('keine Mieterabrechnung')
  // Das Anschreiben steht vor der Tabelle.
  const table = within(card as HTMLElement).getByRole('table')
  expect(letter.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const text = plain(letter.textContent)
  expect(text).toContain('Nebenkostenabrechnung')
  expect(text).toContain('Guten Tag Meier,')
  expect(text).toContain('Es ergibt sich eine Nachzahlung von 120,00 €. Bitte überweisen Sie den Betrag innerhalb von 14 Tagen nach Zugang dieser Abrechnung auf das Konto DE02 1203 0000 0000 2020 51 (Max Vermieter).')
  expect(text).toContain('§ 560 Abs. 4 BGB ab Dezember 2026 auf 50,00 € angepasst')
  expect(text).toContain('Die zugrunde liegenden Belege können nach Terminvereinbarung eingesehen werden.')
  expect(text).toContain('Mit freundlichen Grüßen')
  expect(within(letter).getByText(/Lindenweg 12, 12345 Musterstadt/, { selector: '.letter-return' })).toBeTruthy()
  // Der Satz steht nicht mehr zusätzlich unter der Tabelle.
  expect(plain(card.textContent).split('Es ergibt sich eine Nachzahlung').length).toBe(2)

  // Ergebniskasten
  const box = card.querySelector('dl.result-box')
  expect(plain(box?.textContent)).toMatch(/Ihre Kosten600,00 €Ihre Vorauszahlungen480,00 €Nachzahlung120,00 €Zahlbarinnerhalb von 14 Tagen nach Zugang/)
  // Die Aufstellung bleibt, wie Mietfuchs sie rechnet: Kostenart, Gesamtkosten, Schlüssel samt Basis, Anteil, Vorauszahlungen, Saldo.
  const t = plain(table.textContent)
  for (const part of ['Grundsteuer', '1.200,00 €', 'Wohnfläche', '60 m² von 120 m²', '600,00 €', '− 480,00 €', 'Nachzahlung zu Ihren Lasten', '120,00 €']) expect(t).toContain(part)
  // Neutral fett statt rot.
  const saldo = table.querySelector('.saldo')
  expect(saldo?.getAttribute('style')).toBeNull()
})

test('Anschreiben bearbeiten: unbekannter Platzhalter am Feld, Chips, eigener Betrag mit Hinweis, Speichern sendet nur die Änderung', async () => {
  show()
  await openPreview()
  fireEvent.click(await screen.findByRole('button', { name: /Anschreiben bearbeiten/ }, SLOW))
  const dialog = await screen.findByRole('dialog', {}, SLOW)
  const greeting = within(dialog).getByRole('textbox', { name: 'Gruß' })
  fireEvent.change(greeting, { target: { value: 'Gruß {Nam}' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(greeting.getAttribute('aria-invalid')).toBe('true'), SLOW)
  expect(within(dialog).getAllByText(/Den Platzhalter \{Nam\} gibt es nicht/).length).toBeGreaterThan(0)
  expect(puts).toEqual([])

  fireEvent.change(greeting, { target: { value: 'Viele Grüße, ' } })
  const chips = within(dialog).getByRole('group', { name: 'Platzhalter für Gruß' })
  fireEvent.click(within(chips).getByRole('button', { name: '{Vermieter}' }))
  expect((greeting as HTMLTextAreaElement).value).toBe('Viele Grüße, {Vermieter}')
  expect(plain(dialog.textContent)).toContain('Vorschau: Viele Grüße, Max Vermieter')
  expect(within(chips).getByRole('button', { name: /Auf Vorgabe zurücksetzen/ })).toBeTruthy()

  fireEvent.click(within(dialog).getByRole('radio', { name: /Eigenen Betrag ankündigen/ }))
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Neue monatliche Vorauszahlung/ }), { target: { value: '80,00' } })
  expect(plain(dialog.textContent)).toMatch(/über dem Vorschlag von 50,00 €.*§ 560 Abs\. 4 BGB/)

  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(puts).toHaveLength(1), SLOW)
  expect(puts[0]).toEqual({ url: `/api/settlement/${YEAR}/letters/t1`, body: { texts: { greeting: 'Viele Grüße, {Vermieter}' }, adjustment: { mode: 'custom', cents: 8000, from: null } } })
})

// Druck (#415): Ohne Anrede beim Mietverhältnis beginnt der Brief mit „Guten Tag Meier,“; das Fenster sagt es und führt dorthin,
// wo die Anrede eingetragen wird.
test('Anschreiben bearbeiten: ohne eingetragene Anrede ein Hinweis mit dem Weg in die Stammdaten', async () => {
  show()
  await openPreview()
  fireEvent.click(await screen.findByRole('button', { name: /Anschreiben bearbeiten/ }, SLOW))
  const dialog = await screen.findByRole('dialog', {}, SLOW)
  expect(plain(dialog.textContent)).toContain('Für Meier ist keine Anrede eingetragen; der Brief beginnt mit „Guten Tag Meier,“.')
  // Ein eigener Text ohne {Anrede}: nichts zu sagen.
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Anrede' }), { target: { value: 'Liebe Familie Meier,' } })
  expect(plain(dialog.textContent)).not.toContain('keine Anrede eingetragen')
})

test('#317: Ab Monat im Anschreiben, Vorschau und gesendeter Monat', async () => {
  show()
  await openPreview()
  fireEvent.click(await screen.findByRole('button', { name: /Anschreiben bearbeiten/ }, SLOW))
  const dialog = await screen.findByRole('dialog', {}, SLOW)
  const month = within(dialog).getByRole('textbox', { name: /Ab Monat/ })
  fireEvent.change(month, { target: { value: '2.2099' } })
  fireEvent.blur(month)
  await waitFor(() => expect(plain(dialog.textContent)).toMatch(/Vorschau: Auf Basis dieser Abrechnung wird die monatliche Nebenkostenvorauszahlung gemäß § 560 Abs\. 4 BGB ab Februar 2099 auf 50,00 € angepasst/), SLOW)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(puts).toHaveLength(1), SLOW)
  expect(puts[0]?.body).toEqual({ texts: {}, adjustment: { mode: 'suggestion', cents: null, from: '2099-02' } })
})

test('eine abgeschlossene Abrechnung druckt ihr eingefrorenes Anschreiben und lässt es nicht bearbeiten', async () => {
  const frozen = settlement.letters?.t1
  if (!frozen) throw new Error('kein Anschreiben')
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: `${YEAR + 1}-02-03` }, letters: { t1: { ...frozen, texts: { ...frozen.texts, greeting: 'Eingefrorener Gruß' } } } }
  show()
  const letter = await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  expect(letter.textContent).toContain('Eingefrorener Gruß')
  expect(letter.textContent).toContain(`03.02.${YEAR + 1}`)
  await openPreview()
  expect((screen.getByRole('button', { name: /Anschreiben bearbeiten/ }) as HTMLButtonElement).disabled).toBe(true)
})

// Durchsicht zu PR #435, S1: Das Versanddatum liegt nach dem Monat, den das eingefrorene Schreiben nennt.
test('S1: ein spätes Versanddatum fragt nach dem Monat der Anpassung, Abbrechen speichert nichts', async () => {
  const frozen = settlement.letters?.t1
  if (!frozen) throw new Error('kein Anschreiben')
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null }, letters: { t1: { ...frozen, adjustment: { ...frozen.adjustment, from: `${YEAR + 1}-04` } } } }
  show()
  const field = await screen.findByLabelText(/versendet am/, {}, SLOW)
  fireEvent.change(field, { target: { value: `${YEAR + 1}-04-02` } })
  fireEvent.click(await screen.findByRole('button', { name: /Speichern.*Versanddatum/ }, SLOW))
  const question = await screen.findByRole('alertdialog', {}, SLOW)
  expect(plain(question.textContent)).toMatch(/Meier: Das Schreiben nennt April .*schon begonnen.*Wieder öffnen/)
  fireEvent.click(within(question).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), SLOW)
  expect(puts).toEqual([])
})

// ---------- Durchsicht zu #421 ----------

test('S1: eine vor #415 abgeschlossene Abrechnung druckt wie bisher, ohne Anschreiben und ohne Ergebniskasten', async () => {
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null }, letters: undefined }
  show()
  await screen.findByRole('button', { name: /Drucken \/ PDF/ }, SLOW)
  expect(screen.queryByRole('region', { name: /Anschreiben/ })).toBeNull()
  const card = document.querySelector('.card.statement')
  if (!card) throw new Error('keine Mieterabrechnung')
  expect(card.querySelector('dl.result-box')).toBeNull()
  const text = plain(card.textContent)
  expect(text).toContain('Meier · EG · 1 Person')
  expect(text).toContain('Es ergibt sich eine Nachzahlung von 120,00 €. Bitte überweisen Sie den Betrag innerhalb von 14 Tagen nach Zugang dieser Abrechnung auf das Konto DE02 1203 0000 0000 2020 51 (Max Vermieter).')
  expect(text).toContain('Abgerechnet werden die Kosten des Abrechnungsjahres')
  expect(text).toContain('Die zugrunde liegenden Belege können nach Terminvereinbarung eingesehen werden.')
  expect(card.querySelector('address')).not.toBeNull()
  expect(card.querySelector('.saldo')?.getAttribute('style')).toContain('var(--red)')
  cleanup()
  settlement = { ...settlement, statements: [{ ...STATEMENT, balanceCents: 0, prepaymentCents: 60000 }] }
  show()
  await screen.findByRole('button', { name: /Drucken \/ PDF/ }, SLOW)
  expect(plain(document.querySelector('.card.statement')?.textContent)).toContain('Es ergibt sich ein Guthaben von 0,00 €.')
})

test('S2: abgeschlossen nehmen Frist, Absender und Anschrift den eingefrorenen Stand', async () => {
  const frozen = settlement.letters?.t1
  if (!frozen) throw new Error('kein Anschreiben')
  settlement = {
    ...settlement,
    closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null },
    letters: { t1: { ...frozen, values: { ...frozen.values, Zahlungsfrist: '21' }, sender: { name: 'Alt Vermieter', returnLine: 'Alt Vermieter · Altweg 1' }, recipient: ['Meier', 'Altweg 1'] } },
  }
  show()
  const letter = await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  expect(letter.querySelector('.letter-return')?.textContent).toBe('Alt Vermieter · Altweg 1')
  expect(letter.querySelector('.letter-head')?.textContent).toBe('Alt Vermieter')
  expect(letter.querySelector('address')?.textContent).toBe('MeierAltweg 1')
  expect(plain(document.querySelector('dl.result-box')?.textContent)).toContain('innerhalb von 21 Tagen nach Zugang')
})

test('K3: bei 0 € sagt die Tabelle „ausgeglichen“', async () => {
  settlement = { ...settlement, statements: [{ ...STATEMENT, balanceCents: 0, prepaymentCents: 60000 }] }
  settlement = { ...settlement, letters: lettersOf(settlement, { settings: SETTINGS, property: null, tenancies: TENANCIES, installation: {}, propertyTexts: {}, own: {}, asOf: '2026-10-30' }) }
  show()
  const table = (await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)).closest('.statement')?.querySelector('table')
  expect(plain(table?.textContent)).toMatch(/Ausgeglichen/)
  expect(plain(table?.textContent)).not.toMatch(/Guthaben zu Ihren Gunsten/)
})

test('K10: der Grund für den gesperrten Knopf steht daneben', async () => {
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null } }
  show()
  await openPreview()
  const button = await screen.findByRole('button', { name: /Anschreiben bearbeiten/ }, SLOW)
  const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '')
  expect(reason?.textContent).toMatch(/abgeschlossen.*eingefroren/i)
})

test('S3: ein Anschreiben länger als eine Seite bekommt eine Warnung', async () => {
  const l = settlement.letters?.t1
  if (!l) throw new Error('kein Anschreiben')
  settlement = { ...settlement, letters: { t1: { ...l, texts: { ...l.texts, closing: 'Sehr langer Text. '.repeat(250) } } } }
  show()
  expect((await screen.findAllByText(/länger als eine Seite/, {}, SLOW)).length).toBeGreaterThan(0)
})

test('S4 und K6: Vorschau mit dem neuen Betrag aus dem Entwurf, Anpassung auf Vorgabe zurücksetzen', async () => {
  ownLetters = { t1: { texts: {}, adjustment: { mode: 'custom', cents: 7000 } } }
  show()
  await openPreview()
  fireEvent.click(await screen.findByRole('button', { name: /Anschreiben bearbeiten/ }, SLOW))
  const dialog = await screen.findByRole('dialog', {}, SLOW)
  const amount = await within(dialog).findByRole('textbox', { name: /Neue monatliche Vorauszahlung/ }, SLOW)
  expect((amount as HTMLInputElement).value).toBe('70,00')
  fireEvent.change(amount, { target: { value: '80,00' } })
  expect(plain(dialog.textContent)).toMatch(/Vorschau: Auf Basis dieser Abrechnung wird die monatliche Nebenkostenvorauszahlung gemäß § 560 Abs\. 4 BGB ab Dezember 2026 auf 80,00 € angepasst\./)
  fireEvent.click(within(dialog).getByRole('button', { name: /Anpassung auf Vorgabe zurücksetzen/ }))
  expect((within(dialog).getByRole('radio', { name: /Vorschlag von Mietfuchs/ }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(puts).toHaveLength(1), SLOW)
  expect(puts[0]).toEqual({ url: `/api/settlement/${YEAR}/letters/t1`, body: { texts: {}, adjustment: null } })
})

// ---------- Teil 2 von #415 ----------

// Die Vorschau eines Mieters (Seite Abrechnung, Zone „Übersicht“) und das Fenster „Drucken“ mit den Häkchen.
async function openPreview() {
  fireEvent.click(await screen.findByRole('button', { name: /^Ansehen/ }, SLOW))
}
async function openPrintDrawer(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /Drucken \/ PDF/ }, SLOW))
  return screen.findByRole('dialog', { name: 'Drucken' }, SLOW)
}

const statementCard = async (): Promise<HTMLElement> => {
  await screen.findByRole('button', { name: /Drucken \/ PDF/ }, SLOW)
  const card = document.querySelector<HTMLElement>('.card.statement')
  if (!card) throw new Error('keine Mieterabrechnung')
  return card
}

test('Teil 2: ohne Anschreiben beginnt die Aufstellung mit Anschrift, Datum und Betreff; die Sätze stehen unter der Tabelle', async () => {
  templates = { ...TEMPLATES, printLetter: false, propertyPrintLetter: null }
  show()
  const card = await statementCard()
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Anschreiben an Meier' })).toBeNull(), SLOW)
  const top = card.querySelector('.letter-top')
  if (!top) throw new Error('kein Briefkopf')
  expect(top.querySelector('.letter-return')?.textContent).toBe('Max Vermieter · Lindenweg 12, 12345 Musterstadt')
  expect(top.querySelector('address')?.textContent).toBe('MeierLindenweg 1212345 Musterstadt')
  expect(card.querySelector('h2')?.textContent).toBe(`Nebenkostenabrechnung ${YEAR}, Wohnung EG`)
  const text = plain(card.textContent)
  expect(text).not.toContain('Guten Tag')
  expect(text).not.toContain('Mit freundlichen Grüßen')
  // Ergebnis, Anpassung und Belegeinsicht unter der Tabelle, mit denselben Texten wie im Anschreiben.
  const table = within(card).getByRole('table')
  const after = [...card.querySelectorAll('p.statement-letter-text')]
  expect(after.map((p) => plain(p.textContent))).toEqual([
    'Es ergibt sich eine Nachzahlung von 120,00 €. Bitte überweisen Sie den Betrag innerhalb von 14 Tagen nach Zugang dieser Abrechnung auf das Konto DE02 1203 0000 0000 2020 51 (Max Vermieter).',
    'Auf Basis dieser Abrechnung wird die monatliche Nebenkostenvorauszahlung gemäß § 560 Abs. 4 BGB ab Dezember 2026 auf 50,00 € angepasst (ein Zwölftel Ihrer Jahreskosten, gerundet).',
    'Die zugrunde liegenden Belege können nach Terminvereinbarung eingesehen werden.',
  ])
  for (const p of after) expect(table.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  // Für diesen Druck umschaltbar, ohne etwas zu speichern.
  const box = within(await openPrintDrawer()).getByRole('checkbox', { name: /Anschreiben mitdrucken/ }) as HTMLInputElement
  expect(box.checked).toBe(false)
  fireEvent.click(box)
  expect(await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)).toBeTruthy()
  expect(card.querySelector('.letter-top')).toBeNull()
  expect(card.querySelectorAll('p.statement-letter-text')).toHaveLength(0)
  expect(puts).toEqual([])
})

test('Teil 2: am Objekt abweichend; die Anschrift des Vermieters steht in der Rücksendeangabe', async () => {
  templates = { ...TEMPLATES, printLetter: true, propertyPrintLetter: false }
  const l = settlement.letters?.t1
  if (!l) throw new Error('kein Anschreiben')
  settlement = { ...settlement, letters: { t1: { ...l, sender: { name: 'Max Vermieter', returnLine: 'Max Vermieter · Hauptstr. 1, 10115 Berlin', address: 'Hauptstr. 1, 10115 Berlin', footer: 'Max Vermieter · Hauptstr. 1, 10115 Berlin · IBAN DE02 1203 0000 0000 2020 51' } } } }
  show()
  const card = await statementCard()
  await waitFor(() => expect(card.querySelector('.letter-top .letter-return')?.textContent).toBe('Max Vermieter · Hauptstr. 1, 10115 Berlin'), SLOW)
  expect(card.querySelector('.letter-top .letter-head')?.textContent).toBe('Max VermieterHauptstr. 1, 10115 Berlin')
})

test('Druck: jede Seite der Aufstellung trägt Abrechnung, Objekt und Wohnung; Kontakt und Bank nur der Brief', async () => {
  const l = settlement.letters?.t1
  if (!l) throw new Error('kein Anschreiben')
  settlement = { ...settlement, letters: { t1: { ...l, sender: { name: 'Max Vermieter', returnLine: 'x', address: '', footer: 'Max Vermieter · IBAN DE02 1203 0000 0000 2020 51' } } } }
  show()
  const card = await statementCard()
  const foot = card.querySelector('table.print-pages > tfoot')
  if (!foot) throw new Error('kein Fußvermerk')
  expect(plain(foot.textContent)).toBe(`Nebenkostenabrechnung ${YEAR} · Lindenweg 12, EG`)
  // Die Aufstellung steht im Rumpf, das Anschreiben davor nicht.
  expect(card.querySelector('table.print-pages > tbody table')).not.toBeNull()
  expect(card.querySelector('table.print-pages .letter')).toBeNull()
  // Die Fußzeile mit Kontakt und Bank nur mit dem Häkchen, dann auch auf dem Anschreiben.
  expect(card.querySelector('.letter-footer')).toBeNull()
  fireEvent.click(within(await openPrintDrawer()).getByRole('checkbox', { name: /Fußzeile mit Kontakt und Bank/ }))
  await waitFor(() => expect(plain(card.querySelector('.letter-footer')?.textContent)).toBe('Max Vermieter · IBAN DE02 1203 0000 0000 2020 51'), SLOW)
  // Nicht auf jeder Seite: Kontakt und Bank stehen auf der Briefseite (DIN 5008, Fuß des Geschäftsbriefs).
  expect(plain(foot.textContent)).toBe(`Nebenkostenabrechnung ${YEAR} · Lindenweg 12, EG`)
  cleanup()
  // Gespeichert wird die Vorgabe der Fußzeile mit den übrigen Druckeinstellungen.
  show({ ...SETTINGS, printFooter: true })
  const again = await statementCard()
  await waitFor(() => expect(again.querySelector('.letter-footer')).not.toBeNull(), SLOW)
})

// Druck (#415): Der Kopf der Aufstellung nennt, wen und was sie betrifft (Mindestangaben nach BGH VIII ZR 84/07, Rn. 15, und
// der Abrechnungszeitraum); der Zeitraum steht dort einmal, nicht noch im Ergebniskasten und in einem Satz darunter. Der
// Lohnanteil nach § 35a EStG ist eine Tabelle.
test('Druck: Kopf der Aufstellung mit Mieter, Mietobjekt, Wohnung, Zeitraum und Personen; § 35a als Tabelle', async () => {
  const st: Statement = {
    ...STATEMENT,
    rows: [...STATEMENT.rows, { costItemId: 'k2', category: 'Hauswart', description: 'Hausmeisterdienst', totalCents: 180000, keyLabel: 'Wohnfläche', basisText: '60 m² von 120 m²', shareCents: 90000, labor35aCents: 75000 }],
    totalShareCents: 150000, total35aCents: 75000, balanceCents: -102000,
  }
  const l = settlement.letters?.t1
  if (!l) throw new Error('kein Anschreiben')
  settlement = { ...settlement, statements: [st], letters: { t1: { ...l, premises: { address: 'Lindenweg 12, 12345 Musterstadt', areaM2: 60 }, labor35a: { k2: { amountCents: 180000, laborCents: 150000 } } } } }
  show()
  const card = await statementCard()
  const facts = card.querySelector('dl.statement-facts')
  if (!facts) throw new Error('kein Kopf der Aufstellung')
  expect(plain(facts.textContent)).toBe(`MieterMeierMietobjektLindenweg 12, 12345 MusterstadtWohnungEGWohnfläche60 m²Abrechnungszeitraum01.01.${YEAR} – 31.12.${YEAR} (365 Tage)Personen1 Person`)
  expect(plain(card.querySelector('dl.result-box')?.textContent)).not.toContain('Zeitraum')
  expect(plain(card.textContent)).not.toContain('Abgerechnet werden die Kosten')
  const labor = within(card).getByRole('table', { name: /§ 35a EStG/ })
  expect([...labor.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Leistung', 'Gesamtbetrag', 'Lohnanteil', 'Ihr Anteil'])
  expect(plain(labor.querySelector(':scope > tbody > tr')?.textContent)).toBe('Hauswart: Hausmeisterdienst1.800,00 €1.500,00 €750,00 €')
  expect(plain(labor.textContent)).not.toContain('—')
})

// Durchsicht K2: Ein Anschreiben, das vor dieser Änderung abgeschlossen wurde, kennt Rechnungsbetrag und Lohnanteil nicht.
test('Druck: § 35a ohne eingefrorenen Lohnanteil der Rechnung nur mit Leistung und Ihrem Anteil', async () => {
  const st: Statement = {
    ...STATEMENT,
    rows: [...STATEMENT.rows, { costItemId: 'k2', category: 'Hauswart', description: 'Hausmeisterdienst', totalCents: 180000, keyLabel: 'Wohnfläche', basisText: '60 m² von 120 m²', shareCents: 90000, labor35aCents: 75000 }],
    totalShareCents: 150000, total35aCents: 75000, balanceCents: -102000,
  }
  const l = settlement.letters?.t1
  if (!l) throw new Error('kein Anschreiben')
  const { labor35a: _labor, ...frozen } = l
  settlement = { ...settlement, statements: [st], letters: { t1: frozen }, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null } }
  show()
  const card = await statementCard()
  const labor = await within(card).findByRole('table', { name: /§ 35a EStG/ }, SLOW)
  expect([...labor.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Leistung', 'Ihr Anteil'])
  expect(plain(labor.querySelector(':scope > tbody > tr')?.textContent)).toBe('Hauswart: Hausmeisterdienst750,00 €')
  expect(plain(labor.querySelector(':scope > tfoot > tr')?.textContent)).toBe('Summe Ihres Anteils an den Arbeitskosten750,00 €')
})

test('Teil 2: eine vor #415 abgeschlossene Abrechnung bekommt keinen Fußvermerk', async () => {
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null }, letters: undefined }
  show()
  const card = await statementCard()
  expect(card.querySelector('table.print-pages')).toBeNull()
  expect(card.querySelector('.letter-top')).toBeNull()
})

test('Teil 2: am Objekt „Anschreiben mitdrucken“ wie die Vorgabe, ja oder nein, mit den Texten gespeichert', async () => {
  templates = { ...TEMPLATES, printLetter: true, propertyPrintLetter: null }
  show()
  fireEvent.click(await screen.findByRole('button', { name: /^Mehr/ }, SLOW))
  fireEvent.click(await screen.findByRole('button', { name: 'Vorlage für dieses Objekt bearbeiten' }, SLOW))
  const dialog = await screen.findByRole('dialog', {}, SLOW)
  const select = within(dialog).getByRole('combobox', { name: /Anschreiben mitdrucken/ }) as HTMLSelectElement
  expect([...select.options].map((o) => o.text)).toEqual(['Wie in den Einstellungen (ja)', 'Ja', 'Nein'])
  expect(select.value).toBe('inherit')
  fireEvent.change(select, { target: { value: 'no' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(puts).toHaveLength(1), SLOW)
  expect(puts[0]).toEqual({ url: '/api/properties/objekt-1/letter-texts', body: { texts: {}, printLetter: false } })
})

// ---------- Durchsicht zu PR #427 ----------

test('S1: mit Fußzeile hält der Brief unten Platz frei, damit sie die Unterschrift nicht überdruckt', async () => {
  show({ ...SETTINGS, printFooter: true })
  const letter = await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  await waitFor(() => expect(letter.querySelector('.letter-footer')).not.toBeNull(), SLOW)
  expect(letter.classList.contains('letter-with-footer')).toBe(true)
  cleanup()
  show()
  const without = await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  expect(without.classList.contains('letter-with-footer')).toBe(false)
})

test('K2: auch die Belegkopien tragen den Fußvermerk', async () => {
  costItems = [{ id: 'k1', propertyId: 'objekt-1', period: `${YEAR}-01`, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 120000, key: 'area', invoiceFile: 'beleg.pdf' }]
  show({ ...SETTINGS, printAttachments: true })
  const card = await statementCard()
  await waitFor(() => expect(card.querySelector('.attachments')).not.toBeNull(), SLOW)
  expect(card.querySelector('table.print-pages > tbody .attachments')).not.toBeNull()
})

test('K3: ein Abschluss ohne eingefrorene Fußzeile druckt keine, statt Kontakt und Bank von heute zu nehmen', async () => {
  const frozen = settlement.letters?.t1
  if (!frozen) throw new Error('kein Anschreiben')
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null }, letters: { t1: { ...frozen, sender: { name: 'Max Vermieter', returnLine: 'Max Vermieter · Altweg 1' } } } }
  show({ ...SETTINGS, printFooter: true })
  const letter = await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  expect(letter.querySelector('.letter-footer')).toBeNull()
  expect(plain(document.querySelector('table.print-pages > tfoot')?.textContent)).not.toContain('IBAN')
})

// #229: Nach dem Auszug ohne neue Anschrift warnt die Seite; ist die Abrechnung abgeschlossen und die Anschrift danach
// eingetragen, sagt sie, dass die eingefrorene gedruckt wird. Nach dem Versand schweigt sie.
test('#229: Anschrift nach dem Auszug fehlt oder hat sich nach dem Abschluss geändert', async () => {
  const movedOut: Tenancy[] = [{ ...TENANCIES[0]!, end: `${YEAR}-06-30` }]
  const showWith = (tenancies: Tenancy[]) => render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Abrechnung settings={SETTINGS} units={[]} tenancies={tenancies} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  showWith(movedOut)
  // Am Brief des Mieters und in „Zu prüfen“
  expect(await screen.findAllByText('Anschrift nach dem Auszug fehlt', {}, SLOW)).toHaveLength(2)
  cleanup()

  // Abgeschlossen mit der Anschrift der Wohnung, danach die neue eingetragen.
  const frozen = settlement.letters?.t1
  if (!frozen) throw new Error('kein Anschreiben')
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null } }
  showWith([{ ...movedOut[0]!, correspondenceAddress: 'Birkenweg 3, 54321 Anderswo' }])
  expect(await screen.findAllByText('Anschrift nach dem Abschluss geändert', {}, SLOW)).toHaveLength(2)
  const letter = await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  expect(letter.querySelector('address')?.textContent).toBe(frozen.recipient?.join(''))
  cleanup()

  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: `${YEAR + 1}-02-02` } }
  showWith(movedOut)
  await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  expect(screen.queryByText(/Anschrift nach dem/)).toBeNull()
})

// #229, Durchsicht S1: Eine Anschrift, die nicht ins Fensterfeld passt, nennt die Seite vor dem Druck.
test('#229 S1: eine Anschrift mit mehr als sechs Zeilen wird vor dem Druck genannt', async () => {
  const l = settlement.letters?.t1
  if (!l) throw new Error('kein Anschreiben')
  settlement = { ...settlement, letters: { t1: { ...l, recipient: ['Meier', 'c/o Weber', 'Hinterhaus', '3. OG', 'Birkenweg 3', 'Postfach 12', '54321 Anderswo'] } } }
  show()
  expect(await screen.findByText('Anschrift zu lang für das Fensterfeld', {}, SLOW)).toBeTruthy()
  expect(screen.getAllByText(/Die Anschrift hat 7 Zeilen; im Anschriftfeld passen 6/)).toHaveLength(2)
  // In „Zu prüfen“ mit dem Mieter
  expect(screen.getByText('Anschrift zu lang für das Fensterfeld (Meier, EG)')).toBeTruthy()
})

test('K7: eine Rücksendeangabe, die nicht in die Vermerkzone passt, wird vor dem Druck genannt', async () => {
  const l = settlement.letters?.t1
  if (!l) throw new Error('kein Anschreiben')
  const long = `Max Vermieter · ${'Sehr lange Straße mit Hausnummer 1, '.repeat(4)}12345 Musterstadt`
  settlement = { ...settlement, letters: { t1: { ...l, sender: { name: 'Max Vermieter', returnLine: long, address: '', footer: '' } } } }
  show()
  // Am Brief und einmal in „Zu prüfen“ (dort Kopf und Text)
  await screen.findAllByText(/Rücksendeangabe zu lang/, {}, SLOW)
  expect(screen.getAllByText('Rücksendeangabe zu lang')).toHaveLength(2)
})

// Praxistest: Ohne Namen des Vermieters druckte das Anschreiben ohne Absender und Unterschrift, und „Zu prüfen“ sagte
// nichts. Eine Anpassung nach § 560 Abs. 4 BGB braucht Textform; dafür muss der Erklärende genannt sein (§ 126b BGB).
test('ohne Namen des Vermieters: „Absender fehlt“ in „Zu prüfen“ mit Weg in die Einstellungen', async () => {
  const navigated: unknown[] = []
  const noName: Settings = { ...SETTINGS, landlordName: '' }
  const l = settlement.letters?.t1
  if (!l) throw new Error('kein Anschreiben')
  settlement = { ...settlement, letters: { t1: { ...l, sender: { name: '', returnLine: 'Lindenweg 12, 12345 Musterstadt', address: '', footer: '' }, texts: { ...l.texts, signature: '' } } } }
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Abrechnung settings={noName} units={[]} tenancies={TENANCIES} reload={async () => {}} onNavigate={(t) => navigated.push(t)} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  expect(await screen.findByText('Absender fehlt', {}, SLOW)).toBeTruthy()
  expect(screen.getByText(/§ 126b BGB/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Hier beheben → Einstellungen/ }))
  expect(navigated).toEqual(['einstellungen'])
})

test('mit Namen des Vermieters: kein „Absender fehlt“', async () => {
  show()
  await screen.findByRole('region', { name: 'Anschreiben an Meier' }, SLOW)
  expect(screen.queryByText('Absender fehlt')).toBeNull()
})

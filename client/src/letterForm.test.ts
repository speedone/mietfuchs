// Bearbeiten des Anschreibens und Ergebniskasten (#415), ohne DOM.
import { expect, test } from 'vitest'
import { DEFAULT_LETTER_TEXTS, mergeLetterTexts, SAMPLE_LETTER_VALUES } from '../../shared/letter.ts'
import { CREDIT_MOVED_OUT_HINT, creditMovedOutHint, customHeatingCentsOf, insertField, letterProblems, monthlessAdjustTexts, ownOf, salutationHint, setText, shownText, splitlessAdjustTexts, textChanges, type LetterDraft } from './letterForm'
import { letterParagraphs, resultRows } from './letterView'
import type { Statement, StatementLetter } from './types'

const base = mergeLetterTexts({ greeting: 'Viele Grüße' })
const draft = (over: Partial<LetterDraft> = {}): LetterDraft => ({ own: ownOf({}), adjust: 'suggestion', adjustOwn: true, customCents: '', ...over })
const plain = (s: string) => s.replace(/ /g, ' ')

test('ein Text gleich der Vorlage ist keine eigene Angabe; geschickt wird nur, was sich geändert hat', () => {
  let d = setText(draft(), base, 'greeting', 'Herzliche Grüße')
  expect(shownText(d, base, 'greeting')).toBe('Herzliche Grüße')
  expect(textChanges(ownOf({}), d.own)).toEqual({ greeting: 'Herzliche Grüße' })
  d = setText(d, base, 'greeting', 'Viele Grüße')
  expect(d.own.greeting).toBeNull()
  expect(textChanges(ownOf({}), d.own)).toEqual({})
  // Zurücksetzen einer gespeicherten eigenen Angabe schickt `null`.
  expect(textChanges(ownOf({ closing: 'Danke.' }), ownOf({}))).toEqual({ closing: null })
  // Leer ist eine Angabe: weglassen.
  expect(setText(draft(), base, 'closing', '').own.closing).toBe('')
})

test('ein unbekannter Platzhalter ist eine Meldung am Feld des Bausteins', () => {
  const d = setText(draft(), base, 'intro', 'Hallo {Nam}')
  expect(letterProblems(d, base, 'property')).toEqual([{
    field: 'intro',
    short: 'Den Platzhalter {Nam} gibt es nicht. Wählen Sie einen aus der Liste unter dem Feld.',
    text: 'Einleitung: Den Platzhalter {Nam} gibt es nicht. Wählen Sie einen aus der Liste unter dem Feld.',
  }])
  expect(letterProblems(draft(), base, 'installation')).toEqual([])
  // Ein eigener Betrag braucht einen Betrag.
  expect(letterProblems(draft({ adjust: 'custom', customCents: 'abc' }), base, 'tenancy').map((p) => p.field)).toEqual(['customCents'])
  expect(letterProblems(draft({ adjust: 'custom', customCents: '105,00' }), base, 'tenancy')).toEqual([])
})

test('ein Platzhalter landet an der Einfügemarke und ersetzt eine Auswahl', () => {
  expect(insertField('Guten Tag ,', 10, 10, 'Name')).toEqual({ text: 'Guten Tag {Name},', caret: 16 })
  expect(insertField('Betrag: X', 8, 9, 'Betrag')).toEqual({ text: 'Betrag: {Betrag}', caret: 16 })
})

const ST: Statement = {
  tenancyId: 't1', unitId: 'u1', tenantName: 'Meier', unitName: 'EG', persons: 1, days: 365, personDays: 365,
  periodStart: '2025-01-01', periodEnd: '2025-12-31', rows: [], totalShareCents: 60000, total35aCents: 0,
  prepaymentCents: 50000, prepaymentOverridden: false, suggestedMonthlyCents: 5000, balanceCents: -10000,
}

test('Ergebniskasten: Zeitraum, Kosten, Vorauszahlungen, Ergebnis und Frist; die Nachzahlung fett', () => {
  expect(resultRows(ST, 14).map((r) => [r.label, plain(r.value), r.strong === true])).toEqual([
    ['Ihre Kosten', '600,00 €', false],
    ['Ihre Vorauszahlungen', '500,00 €', false],
    ['Nachzahlung', '100,00 €', true],
    ['Zahlbar', 'innerhalb von 14 Tagen nach Zugang', false],
  ])
  expect(resultRows({ ...ST, balanceCents: 2500 }, null).slice(2).map((r) => [r.label, plain(r.value)])).toEqual([['Guthaben', '25,00 €']])
  expect(resultRows({ ...ST, balanceCents: 0 }, null).slice(2).map((r) => r.value)).toEqual(['ausgeglichen'])
})

test('das gedruckte Anschreiben: gewählte Bausteine mit Datum und Zahl der Belege', () => {
  const letter: StatementLetter = {
    texts: { ...DEFAULT_LETTER_TEXTS, attachments: 'Beigefügt: {AnzahlBelege}.', intro: 'Stand {Datum}.' },
    adjustment: { mode: 'none', newCents: null },
    values: SAMPLE_LETTER_VALUES,
  }
  const p = letterParagraphs(letter, -100, { date: '2026-03-15', attachments: 2 })
  expect(p.map((x) => x.block)).toEqual(['subject', 'salutation', 'intro', 'backPayment', 'attachments', 'closing', 'greeting', 'signature'])
  expect(p.find((x) => x.block === 'intro')?.text).toBe('Stand 15.03.2026.')
  expect(p.find((x) => x.block === 'attachments')?.text).toBe('Beigefügt: 2 Belege.')
})

// Durchsicht zu PR #435, K3: Auch eine Vorlage der Installation oder des Objekts ohne {AnpassungAb} nennt den Monat nicht.
test('K3: eigener Text zur Anpassung ohne {AnpassungAb}, auf jeder Ebene', () => {
  const draft = (own: Partial<Record<string, string | null>>, adjust: LetterDraft['adjust'] = 'suggestion'): LetterDraft =>
    ({ own: { ...ownOf({}), ...own }, adjust, adjustOwn: true, customCents: '' })
  const base = mergeLetterTexts()
  expect(monthlessAdjustTexts(draft({}), base, 'installation')).toEqual([])
  expect(monthlessAdjustTexts(draft({ adjustCustom: 'Ab dem übernächsten Monat {VorauszahlungNeu}.' }), base, 'installation')).toEqual(['adjustCustom'])
  expect(monthlessAdjustTexts(draft({ adjustSuggestion: 'Neu: {VorauszahlungNeu}.' }), base, 'property')).toEqual(['adjustSuggestion'])
  // Beim Mieter zählt nur der Baustein der gewählten Anpassung.
  expect(monthlessAdjustTexts(draft({ adjustCustom: 'Neu: {VorauszahlungNeu}.' }), base, 'tenancy')).toEqual([])
  expect(monthlessAdjustTexts(draft({ adjustCustom: 'Neu: {VorauszahlungNeu}.' }, 'custom'), base, 'tenancy')).toEqual(['adjustCustom'])
  expect(monthlessAdjustTexts(draft({ adjustCustom: 'Neu.' }, 'none'), base, 'tenancy')).toEqual([])
})

// Druck (#415): Ohne eingetragene Anrede beginnt der Brief mit „Guten Tag {Name},“. Das Seitenfenster sagt es und nennt, wo
// eine persönliche Anrede eingetragen wird; mit eigenem Text ohne {Anrede} gibt es nichts zu sagen.
test('Anrede: Hinweis, solange beim Mietverhältnis keine eingetragen ist', () => {
  expect(salutationHint(['Anna Becker'], 1, '{Anrede}')).toBe('Für Anna Becker ist keine Anrede eingetragen; der Brief beginnt mit „Guten Tag Anna Becker,“. Eine persönliche Anrede wie „Sehr geehrte Frau Becker“ tragen Sie in den Stammdaten beim Mietverhältnis ein, im Feld „Anrede im Brief“.')
  expect(salutationHint(['Anna Becker', 'Jonas Hartmann'], 4, '{Anrede}')).toBe('Für 2 von 4 Mietern (Anna Becker und Jonas Hartmann) ist keine Anrede eingetragen; deren Brief beginnt mit „Guten Tag {Name},“. Eine persönliche Anrede wie „Sehr geehrte Frau Becker“ tragen Sie in den Stammdaten beim Mietverhältnis ein, im Feld „Anrede im Brief“.')
  expect(salutationHint([], 4, '{Anrede}')).toBeNull()
  expect(salutationHint(['Anna Becker'], 1, 'Liebe Mieter,')).toBeNull()
})

// #704 Teil 2: Führt das Mietverhältnis zwei Staffeln, gehört zum eigenen Betrag der Teil für Heizung und Warmwasser;
// ohne ihn ließe sich die Anpassung später nicht in die Staffeln übernehmen.
test('#704: eigener Betrag bei zwei Staffeln verlangt den Teil für die Heizung, nicht über dem Betrag; sonst wird er nicht gefragt', () => {
  const two = { split: true }
  const fields = (d: LetterDraft, o: { split: boolean } = two) => letterProblems(d, base, 'tenancy', o).map((p) => p.field)
  expect(fields(draft({ adjust: 'custom', customCents: '310,00', customHeatingCents: '' }))).toEqual(['customHeatingCents'])
  expect(fields(draft({ adjust: 'custom', customCents: '310,00', customHeatingCents: 'abc' }))).toEqual(['customHeatingCents'])
  expect(fields(draft({ adjust: 'custom', customCents: '310,00', customHeatingCents: '320,00' }))).toEqual(['customHeatingCents'])
  expect(fields(draft({ adjust: 'custom', customCents: '310,00', customHeatingCents: '140,00' }))).toEqual([])
  expect(fields(draft({ adjust: 'custom', customCents: '310,00', customHeatingCents: '0' }))).toEqual([])
  // Ohne zwei Staffeln, beim Vorschlag und ohne Anpassung wird nicht gefragt.
  expect(fields(draft({ adjust: 'custom', customCents: '310,00' }), { split: false })).toEqual([])
  expect(fields(draft({ adjust: 'suggestion', customHeatingCents: 'abc' }))).toEqual([])
  expect(customHeatingCentsOf(draft({ customHeatingCents: '140,00' }))).toBe(14000)
  expect(customHeatingCentsOf(draft({ customHeatingCents: '' }))).toBeNull()
})

test('#704: ein eigener Text der Anpassung ohne {Aufteilung} nennt die Teile nicht; das Fenster sagt es nur bei zwei Staffeln', () => {
  const own = setText(draft({ adjust: 'suggestion' }), base, 'adjustSuggestion', 'Neu ab {AnpassungAb}: {VorauszahlungNeu}.')
  expect(splitlessAdjustTexts(own, base, 'tenancy')).toEqual(['adjustSuggestion'])
  expect(splitlessAdjustTexts(draft({ adjust: 'suggestion' }), base, 'tenancy')).toEqual([])
  expect(splitlessAdjustTexts(draft({ adjust: 'none' }), base, 'tenancy')).toEqual([])
})

// #712: Das Feld für den zweiten Teil heißt, wie die Heizanlage die zweite Vorauszahlung führt; die Meldungen nennen es so.
test('#712: Meldungen zum zweiten Teil nennen Wasser/Abwasser, wenn die zweite Vorauszahlung es deckt', () => {
  const texts = (d: LetterDraft, coversWater: boolean) => letterProblems(d, base, 'tenancy', { split: true, coversWater }).map((p) => p.text)
  expect(texts(draft({ adjust: 'custom', customCents: '310,00', customHeatingCents: '' }), true)).toEqual(['Davon für Heizung, Warmwasser und Wasser/Abwasser: Geben Sie einen Betrag in Euro ein, etwa 45,00; ohne diese Vorauszahlung 0.'])
  expect(texts(draft({ adjust: 'custom', customCents: '310,00', customHeatingCents: '320,00' }), true)).toEqual(['Davon für Heizung, Warmwasser und Wasser/Abwasser: Der Teil liegt über der neuen Vorauszahlung.'])
  // ohne die Angabe wortgleich wie vor #712
  expect(texts(draft({ adjust: 'custom', customCents: '310,00', customHeatingCents: '' }), false)).toEqual(['Davon für Heizung und Warmwasser: Geben Sie einen Betrag in Euro ein, etwa 45,00; ohne Heizvorauszahlung 0.'])
  expect(texts(draft({ adjust: 'custom', customCents: '310,00', customHeatingCents: '320,00' }), false)).toEqual(['Davon für Heizung und Warmwasser: Der Teil liegt über der neuen Vorauszahlung.'])
})

// #691, Durchsicht: Ein eigener Text zum Guthaben in Vorlage oder Objekt gilt nicht für ausgezogene Mieter; das Fenster sagt
// es, solange keine Ebene einen eigenen Text zum Guthaben nach dem Auszug hat. Beim Mieter gilt sein eigener ohnehin.
test('#691: eigener Text zum Guthaben ohne einen nach dem Auszug: Hinweis in Vorlage und Objekt, nicht beim Mieter', () => {
  const draft = (own: Partial<Record<string, string | null>>): LetterDraft => ({ own: { ...ownOf({}), ...own }, adjust: 'suggestion', adjustOwn: true, customCents: '' })
  const base = mergeLetterTexts()
  expect(creditMovedOutHint(draft({}), base, 'installation')).toBe(false)
  expect(creditMovedOutHint(draft({ credit: 'Eigener Satz {Betrag}.' }), base, 'installation')).toBe(true)
  expect(creditMovedOutHint(draft({ credit: 'Eigener Satz {Betrag}.', creditMovedOut: 'Nach dem Auszug {Betrag}.' }), base, 'installation')).toBe(false)
  // Am Objekt: geerbt aus der Vorlage zählt mit, ein eigener nach dem Auszug darüber ebenso
  expect(creditMovedOutHint(draft({}), mergeLetterTexts({ credit: 'Vorlage {Betrag}.' }), 'property')).toBe(true)
  expect(creditMovedOutHint(draft({}), mergeLetterTexts({ credit: 'Vorlage {Betrag}.', creditMovedOut: 'Auszug {Betrag}.' }), 'property')).toBe(false)
  expect(creditMovedOutHint(draft({ credit: 'Eigener Satz {Betrag}.' }), base, 'tenancy')).toBe(false)
  expect(CREDIT_MOVED_OUT_HINT).toMatch(/Text für „Guthaben nach dem Auszug“ anpassen/)
})

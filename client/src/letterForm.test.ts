// Bearbeiten des Anschreibens und Ergebniskasten (#415), ohne DOM.
import { expect, test } from 'vitest'
import { DEFAULT_LETTER_TEXTS, mergeLetterTexts, SAMPLE_LETTER_VALUES } from '../../shared/letter.ts'
import { insertField, letterProblems, ownOf, setText, shownText, textChanges, type LetterDraft } from './letterForm'
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
    ['Zeitraum', '01.01.2025 – 31.12.2025 (365 Tage)', false],
    ['Ihre Kosten', '600,00 €', false],
    ['Ihre Vorauszahlungen', '500,00 €', false],
    ['Nachzahlung', '100,00 €', true],
    ['Zahlbar', 'innerhalb von 14 Tagen nach Zugang', false],
  ])
  expect(resultRows({ ...ST, balanceCents: 2500 }, null).slice(3).map((r) => [r.label, plain(r.value)])).toEqual([['Guthaben', '25,00 €']])
  expect(resultRows({ ...ST, balanceCents: 0 }, null).slice(3).map((r) => r.value)).toEqual(['ausgeglichen'])
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

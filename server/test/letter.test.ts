// Das Anschreiben zur Abrechnung (#415): Platzhalter prüfen und einsetzen, Bausteine wählen, und dass
// die Vorgaben die Sätze wortgleich drucken, die bis #415 fest unter der Aufstellung standen.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  adjustedCents, adjustmentHint, buildLetter, chooseLetterBlocks, DEFAULT_LETTER_TEXTS, LETTER_BLOCK_IDS, LETTER_FIELDS, mergeLetterTexts, parseLetterAdjustment,
  exceedsOnePage, lettersOf, parseLetterTexts, printsLetter, renderLetterText, resolveTemplate, statementBlocks, templateProblems, type LetterFacts,
} from '../../shared/letter.ts'
import type { LetterAdjustment, Property, Settings, Tenancy } from '../../shared/types.ts'
import { calendarYearPeriod, settlementPeriod } from '../../shared/period.ts'

const facts = (over: Partial<LetterFacts> = {}): LetterFacts => ({
  tenantName: 'Erika Mustermann',
  unitName: 'EG links',
  propertyName: 'Lindenweg 12',
  title: 'Nebenkostenabrechnung 2025',
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  totalShareCents: 124000,
  prepaymentCents: 120000,
  balanceCents: -4000,
  paymentDeadlineDays: 30,
  iban: 'DE02120300000000202051',
  landlordName: 'Max Vermieter',
  prepaymentKind: 'monatliche Nebenkostenvorauszahlung',
  prepaymentBeforeCents: 10000,
  basis: 'ein Zwölftel Ihrer Jahreskosten, gerundet',
  ...over,
})
// Beträge formatiert Intl mit geschütztem Leerzeichen vor dem €; verglichen wird der Wortlaut.
const plain = (s: string | null | undefined): string => (s ?? '').replace(/\u00a0/g, ' ')
const suggestion: LetterAdjustment = { mode: 'suggestion', cents: null }
const letter = (over: Partial<LetterFacts> = {}, adjustment: LetterAdjustment = suggestion, suggestedCents = 10500) =>
  buildLetter({ texts: DEFAULT_LETTER_TEXTS, facts: facts(over), adjustment, suggestedCents, from: '2027-01' })

test('ein unbekannter Platzhalter ist eine Meldung, nie ein leerer Text', () => {
  assert.deepEqual(templateProblems('intro', 'Guten Tag {Nam}'), ['Den Platzhalter {Nam} gibt es nicht. Wählen Sie einen aus der Liste unter dem Feld.'])
  assert.deepEqual(templateProblems('intro', 'Guten Tag {Name}'), [])
  // Der neue Betrag gibt es nur, wo eine Anpassung angekündigt wird.
  assert.match(templateProblems('intro', '{VorauszahlungNeu}')[0] ?? '', /im Baustein „Einleitung“ nicht/)
  assert.deepEqual(templateProblems('adjustCustom', '{VorauszahlungNeu}'), [])
  assert.match(templateProblems('intro', 'Kosten { 12')[0] ?? '', /Geschweifte Klammern/)
  // Unbekannt bleibt beim Einsetzen stehen, statt still zu verschwinden.
  assert.equal(resolveTemplate('Hallo {Nam}', { Name: 'X' }), 'Hallo {Nam}')
})

test('jede Vorgabe enthält nur bekannte Platzhalter, und jeder Platzhalter hat ein Beispiel', () => {
  for (const b of LETTER_BLOCK_IDS) assert.deepEqual(templateProblems(b, DEFAULT_LETTER_TEXTS[b]), [], b)
  for (const f of LETTER_FIELDS) assert.notEqual(f.example, '', f.id)
})

test('die Vorgaben drucken die bisherigen Sätze wortgleich', () => {
  const back = letter()
  assert.equal(plain(back.texts.backPayment),
    'Es ergibt sich eine Nachzahlung von 40,00 €. Bitte überweisen Sie den Betrag innerhalb von 30 Tagen nach Zugang dieser Abrechnung auf das Konto DE02 1203 0000 0000 2020 51 (Max Vermieter).')
  // Ohne IBAN entfiel der Teil mit dem Konto, ohne Vermieter der Name in Klammern.
  assert.equal(plain(letter({ iban: '' }).texts.backPayment),
    'Es ergibt sich eine Nachzahlung von 40,00 €. Bitte überweisen Sie den Betrag innerhalb von 30 Tagen nach Zugang dieser Abrechnung.')
  assert.equal(plain(letter({ landlordName: '' }).texts.backPayment),
    'Es ergibt sich eine Nachzahlung von 40,00 €. Bitte überweisen Sie den Betrag innerhalb von 30 Tagen nach Zugang dieser Abrechnung auf das Konto DE02 1203 0000 0000 2020 51.')
  // Ohne Zahlungsfrist galten 30 Tage.
  assert.match(plain(letter({ paymentDeadlineDays: 0 }).texts.backPayment), /innerhalb von 30 Tagen/)
  assert.match(plain(letter({ paymentDeadlineDays: 14 }).texts.backPayment), /innerhalb von 14 Tagen/)
  assert.equal(plain(letter({ balanceCents: 2550 }).texts.credit),
    'Es ergibt sich ein Guthaben von 25,50 €. Der Betrag wird Ihnen erstattet bzw. mit der nächsten Mietzahlung verrechnet.')
  assert.equal(plain(back.texts.adjustSuggestion),
    'Auf Basis dieser Abrechnung wird die monatliche Nebenkostenvorauszahlung gemäß § 560 Abs. 4 BGB ab Januar 2027 auf 105,00 € angepasst (ein Zwölftel Ihrer Jahreskosten, gerundet).')
  assert.equal(plain(back.texts.receipts), 'Die zugrunde liegenden Belege können nach Terminvereinbarung eingesehen werden.')
  assert.equal(plain(renderLetterText(back.texts.attachments, { date: '2026-03-15', attachments: 3 })), 'Kopien der zugrunde liegenden Belege sind als Anlage beigefügt (3 Belege).')
  assert.equal(plain(renderLetterText(back.texts.attachments, { date: '2026-03-15', attachments: 1 })), 'Kopien der zugrunde liegenden Belege sind als Anlage beigefügt (1 Beleg).')
})

test('Mietfuchs wählt die Bausteine nach dem Ergebnis und der Anpassung', () => {
  const back = letter()
  assert.deepEqual(chooseLetterBlocks(back, -4000, 0), ['subject', 'salutation', 'intro', 'backPayment', 'adjustSuggestion', 'receipts', 'closing', 'greeting', 'signature'])
  assert.deepEqual(chooseLetterBlocks(letter({ balanceCents: 1 }), 1, 2).filter((b) => ['credit', 'backPayment', 'balanced', 'receipts', 'attachments'].includes(b)), ['credit', 'attachments'])
  assert.ok(chooseLetterBlocks(letter({ balanceCents: 0 }), 0, 0).includes('balanced'))
  // Keine Anpassung, ein Vorschlag von 0 € (wie bisher nicht angekündigt) und ein eigener Betrag.
  assert.ok(!chooseLetterBlocks(letter({}, { mode: 'none', cents: null }), -4000, 0).some((b) => b.startsWith('adjust')))
  assert.ok(!chooseLetterBlocks(letter({}, suggestion, 0), -4000, 0).some((b) => b.startsWith('adjust')))
  const custom = letter({}, { mode: 'custom', cents: 12000 })
  assert.ok(chooseLetterBlocks(custom, -4000, 0).includes('adjustCustom'))
  assert.match(plain(custom.texts.adjustCustom), /auf 120,00 € angepasst\.$/)
  // Ein leerer Baustein erscheint nicht.
  const noClosing = buildLetter({ texts: mergeLetterTexts({ closing: '' }), facts: facts(), adjustment: suggestion, suggestedCents: 10500, from: '2027-01' })
  assert.ok(!chooseLetterBlocks(noClosing, -4000, 0).includes('closing'))
})

test('Ebenen: die oberste, die einen Baustein führt, gilt', () => {
  const merged = mergeLetterTexts({ greeting: 'Viele Grüße' }, null, { greeting: 'Herzliche Grüße', closing: 'Danke.' })
  assert.equal(merged.greeting, 'Herzliche Grüße')
  assert.equal(merged.closing, 'Danke.')
  assert.equal(merged.salutation, DEFAULT_LETTER_TEXTS.salutation)
})

test('Datum und Zahl der Belege bleiben für den Druck stehen', () => {
  const l = buildLetter({ texts: mergeLetterTexts({ intro: 'Stand {Datum}, {Name}' }), facts: facts(), adjustment: suggestion, suggestedCents: 10500, from: '2027-01' })
  assert.equal(l.texts.intro, 'Stand {Datum}, Erika Mustermann')
  assert.equal(plain(renderLetterText(l.texts.intro, { date: '2026-03-15', attachments: 0 })), 'Stand 15.03.2026, Erika Mustermann')
})

test('Anpassung: neuer Betrag und Hinweis über dem Vorschlag', () => {
  assert.equal(adjustedCents({ mode: 'none', cents: null }, 10500), null)
  assert.equal(adjustedCents(suggestion, 10500), 10500)
  assert.equal(adjustedCents({ mode: 'custom', cents: 9000 }, 10500), 9000)
  assert.equal(adjustmentHint('custom', 9000, 10500), null)
  assert.match(plain(adjustmentHint('custom', 12000, 10500)), /über dem Vorschlag von 105,00 €.*§ 560 Abs\. 4 BGB.*angemessene Höhe/)
})

test('Rümpfe werden geprüft', () => {
  assert.deepEqual(parseLetterTexts({ greeting: 'Gruß\r\n', closing: null }), { texts: { greeting: 'Gruß', closing: null } })
  assert.match(String(Reflect.get(parseLetterTexts({ foo: 'x' }), 'error')), /Baustein „foo“/)
  assert.match(String(Reflect.get(parseLetterTexts({ intro: '{Nam}' }), 'error')), /Einleitung.*\{Nam\}/)
  assert.deepEqual(parseLetterAdjustment({ mode: 'custom', cents: 12000 }), { mode: 'custom', cents: 12000, from: null })
  assert.deepEqual(parseLetterAdjustment({ mode: 'suggestion', cents: 5 }), { mode: 'suggestion', cents: null, from: null })
  assert.ok('error' in (parseLetterAdjustment({ mode: 'custom', cents: -1 }) ?? {}))
  assert.equal(parseLetterAdjustment(null), null)
})

// Durchsicht zu #421
test('K2: ein Wert mit geschweiften Klammern wird nie als Platzhalter gelesen, auch nicht beim Druck', () => {
  const l = letter({ tenantName: 'Max {Datum} {Nam}' })
  assert.equal(renderLetterText(l.texts.salutation, { date: '2026-03-15', attachments: 0 }), 'Guten Tag Max {Datum} {Nam},')
})

test('K4: ohne Vorschlag kein Hinweis „über dem Vorschlag“', () => {
  assert.equal(adjustmentHint('custom', 12000, 0), null)
})

test('S2: Absender, Rücksendeangabe und Anschrift stehen im Anschreiben und frieren mit ein', () => {
  const out = lettersOf({
    statements: [{ tenancyId: 't1', unitId: 'u1', tenantName: 'Erika', unitName: 'EG', persons: 1, days: 365, personDays: 365, periodStart: '2025-01-01', periodEnd: '2025-12-31', rows: [], totalShareCents: 1, total35aCents: 0, prepaymentCents: 0, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: -1 }],
    period: settlementPeriod(calendarYearPeriod(2025)),
    daysInYear: 365,
  }, {
    settings: { landlordName: 'Max', iban: '', paymentDeadlineDays: 30 },
    property: { id: 'p', name: 'Haus', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', landlordName: null, iban: null, paymentDeadlineDays: null },
    tenancies: [{ id: 't1', end: null, prepayments: [], correspondenceAddress: '' }],
    installation: {}, propertyTexts: {}, own: {}, asOf: '2026-03-15',
  })
  const l = out.t1
  if (!l) return assert.fail('kein Anschreiben')
  assert.deepEqual(l.sender, { name: 'Max', returnLine: 'Max · Haus · Lindenweg 12, 12345 Musterstadt', address: '', footer: 'Max' })
  assert.deepEqual(l.recipient, ['Erika', 'EG', 'Lindenweg 12', '12345 Musterstadt'])
})

test('S3: ein Anschreiben, das nicht auf eine Seite passt, wird erkannt', () => {
  assert.equal(exceedsOnePage(Object.values(DEFAULT_LETTER_TEXTS)), false)
  assert.equal(exceedsOnePage([...Object.values(DEFAULT_LETTER_TEXTS), 'Wort '.repeat(700)]), true)
  assert.equal(exceedsOnePage(Array.from({ length: 30 }, () => 'Kurzer Absatz.')), true)
})

// ---------- Teil 2 von #415 ----------

test('Teil 2: {Anrede} nimmt die Anrede des Mietverhältnisses, sonst „Guten Tag {Name},“', () => {
  assert.equal(DEFAULT_LETTER_TEXTS.salutation, '{Anrede}')
  assert.deepEqual(templateProblems('salutation', '{Anrede}'), [])
  assert.equal(letter().texts.salutation, 'Guten Tag Erika Mustermann,')
  assert.equal(letter({ salutation: 'Sehr geehrte Frau Mustermann' }).texts.salutation, 'Sehr geehrte Frau Mustermann,')
  // Ein eigenes Satzzeichen am Ende bleibt; Leerzeichen zählen nicht als Anrede.
  assert.equal(letter({ salutation: 'Liebe Erika!' }).texts.salutation, 'Liebe Erika!')
  assert.equal(letter({ salutation: 'Hallo Erika,' }).texts.salutation, 'Hallo Erika,')
  assert.equal(letter({ salutation: '   ' }).texts.salutation, 'Guten Tag Erika Mustermann,')
})

const oneStatement = {
  statements: [{ tenancyId: 't1', unitId: 'u1', tenantName: 'Erika', unitName: 'EG', persons: 1, days: 365, personDays: 365, periodStart: '2025-01-01', periodEnd: '2025-12-31', rows: [], totalShareCents: 1, total35aCents: 0, prepaymentCents: 0, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: -1 }],
  period: settlementPeriod(calendarYearPeriod(2025)),
  daysInYear: 365,
}
const house: Property = { id: 'p', name: 'Haus', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', landlordName: null, iban: null, paymentDeadlineDays: null }

test('Teil 2: die Anschrift des Vermieters steht in Rücksendeangabe und Fußzeile, am Objekt abweichend', () => {
  const src = (settings: Partial<Settings>, property: Partial<Property> = {}, tenancy: Partial<Tenancy> = {}) => lettersOf(oneStatement, {
    settings: { landlordName: 'Max', iban: 'DE02120300000000202051', paymentDeadlineDays: 30, ...settings },
    property: { ...house, ...property },
    tenancies: [{ id: 't1', end: null, prepayments: [], correspondenceAddress: '', ...tenancy }],
    installation: {}, propertyTexts: {}, own: {}, asOf: '2026-03-15',
  }).t1 ?? assert.fail('kein Anschreiben')
  const withAddress = src({ landlordAddress: 'Hauptstr. 1, 10115 Berlin', landlordContact: 'Tel. 030 123456' })
  assert.deepEqual(withAddress.sender, {
    name: 'Max',
    returnLine: 'Max · Hauptstr. 1, 10115 Berlin',
    address: 'Hauptstr. 1, 10115 Berlin',
    footer: 'Max · Hauptstr. 1, 10115 Berlin · Tel. 030 123456 · IBAN DE02 1203 0000 0000 2020 51',
  })
  // Ohne Anschrift wie bisher: Vermieter, Objekt und Adresse des Objekts.
  assert.equal(src({}).sender?.returnLine, 'Max · Haus · Lindenweg 12, 12345 Musterstadt')
  assert.equal(src({}).sender?.address, '')
  // Am Objekt abweichend; eine leere Angabe am Objekt heißt „keine“, `null` „die Vorgabe gilt“.
  assert.equal(src({ landlordAddress: 'Hauptstr. 1, 10115 Berlin' }, { landlordAddress: 'Am Hang 3, 01067 Dresden' }).sender?.returnLine, 'Max · Am Hang 3, 01067 Dresden')
  assert.equal(src({ landlordAddress: 'Hauptstr. 1, 10115 Berlin' }, { landlordAddress: null }).sender?.returnLine, 'Max · Hauptstr. 1, 10115 Berlin')
  assert.equal(src({ landlordAddress: 'Hauptstr. 1, 10115 Berlin' }, { landlordAddress: '' }).sender?.returnLine, 'Max · Haus · Lindenweg 12, 12345 Musterstadt')
  // Die Anrede des Mietverhältnisses kommt ins Anschreiben.
  assert.equal(src({}, {}, { letterSalutation: 'Sehr geehrte Frau Becker' }).texts.salutation, 'Sehr geehrte Frau Becker,')
})

test('Teil 2: Anschreiben mitdrucken: Objekt vor Einstellungen, ohne Angabe an', () => {
  assert.equal(printsLetter(null, {}), true)
  assert.equal(printsLetter({ printLetter: null }, { printLetter: false }), false)
  assert.equal(printsLetter({ printLetter: true }, { printLetter: false }), true)
  assert.equal(printsLetter({ printLetter: false }, {}), false)
})

test('Teil 2: ohne Anschreiben stehen Ergebnis, Anpassung und Belegeinsicht unter der Aufstellung', () => {
  assert.deepEqual(statementBlocks(letter(), -4000, 0), ['backPayment', 'adjustSuggestion', 'receipts'])
  assert.deepEqual(statementBlocks(letter({ balanceCents: 0 }, { mode: 'none', cents: null }), 0, 2), ['balanced', 'attachments'])
})

// Durchsicht zu PR #427, K8
test('K8: ein Fragezeichen am Ende der Anrede bekommt kein Komma', () => {
  assert.equal(letter({ salutation: 'Wie geht es Ihnen?' }).texts.salutation, 'Wie geht es Ihnen?')
})

test('K8: eine Zeile oder ein Ja/Nein falscher Art ist ein eigener Fehler mit 400', async () => {
  const { LetterInputError, nullableBoolean, nullableLine } = await import('../src/db/repository.ts')
  assert.throws(() => nullableLine(5, 'Die Anschrift'), (e: unknown) => e instanceof LetterInputError && e.status === 400 && /Die Anschrift ist kein Text/.test(e.message))
  assert.throws(() => nullableBoolean('ja', '„Anschreiben mitdrucken“'), (e: unknown) => e instanceof LetterInputError && e.status === 400)
})

// ---------- #317: der Monat der Anpassung ----------

test('#317: das Schreiben nennt den Monat, ab dem die Vorauszahlung angepasst wird', () => {
  assert.match(DEFAULT_LETTER_TEXTS.adjustSuggestion, /ab \{AnpassungAb\} auf/)
  assert.match(DEFAULT_LETTER_TEXTS.adjustCustom, /ab \{AnpassungAb\} auf/)
  assert.doesNotMatch(DEFAULT_LETTER_TEXTS.adjustSuggestion, /übernächsten/)
  assert.deepEqual(templateProblems('adjustCustom', '{AnpassungAb}'), [])
  assert.match(templateProblems('intro', '{AnpassungAb}')[0] ?? '', /im Baustein „Einleitung“ nicht/)
  const l = letter()
  assert.equal(l.adjustment.from, '2027-01')
  assert.equal(l.values.AnpassungAb, 'Januar 2027')
  assert.equal(plain(letter({}, { mode: 'custom', cents: 9000 }).texts.adjustCustom),
    'Auf Basis dieser Abrechnung wird die monatliche Nebenkostenvorauszahlung gemäß § 560 Abs. 4 BGB ab Januar 2027 auf 90,00 € angepasst.')
  // Ohne Anpassung kein Monat.
  assert.equal(letter({}, { mode: 'none', cents: null }).adjustment.from, null)
})

test('#317: Vorgabe ist der übernächste Monat nach dem Tag des Briefs, je Mieter abweichend', () => {
  const tenancy = { id: 't1', end: null, prepayments: [{ from: '2024-01', monthlyCents: 4000 }], correspondenceAddress: '' }
  const st = { ...oneStatement, statements: oneStatement.statements.map((x) => ({ ...x, suggestedMonthlyCents: 5000 })) }
  const base = { settings: { landlordName: 'Max', iban: '', paymentDeadlineDays: 30 }, property: house, tenancies: [tenancy], installation: {}, propertyTexts: {} }
  assert.equal(lettersOf(st, { ...base, own: {}, asOf: '2026-10-30' }).t1?.adjustment.from, '2026-12')
  assert.equal(lettersOf(st, { ...base, own: {}, asOf: '2026-11-01' }).t1?.adjustment.from, '2027-01')
  const own = { t1: { texts: {}, adjustment: { mode: 'suggestion' as const, cents: null, from: '2027-03' } } }
  const l = lettersOf(st, { ...base, own, asOf: '2026-10-30' }).t1
  assert.equal(l?.adjustment.from, '2027-03')
  assert.match(plain(l?.texts.adjustSuggestion), /ab März 2027 auf 50,00 €/)
})

test('#317: der Monat der Anpassung wird geprüft', () => {
  assert.deepEqual(parseLetterAdjustment({ mode: 'suggestion', from: '2027-01' }), { mode: 'suggestion', cents: null, from: '2027-01' })
  assert.deepEqual(parseLetterAdjustment({ mode: 'custom', cents: 100, from: null }), { mode: 'custom', cents: 100, from: null })
  assert.deepEqual(parseLetterAdjustment({ mode: 'custom', cents: 100 }), { mode: 'custom', cents: 100, from: null })
  for (const from of ['2027-13', '2027-1', 'Januar', 2027]) {
    const r = parseLetterAdjustment({ mode: 'suggestion', from })
    assert.ok(r !== null && 'error' in r, String(from))
  }
})

// Der Druck der Abrechnung (#415): Informationsblock, Kopf der Abrechnung, Fußvermerk, Ergebniskasten und die Tabelle nach
// § 35a EStG, ohne DOM geprüft. Die Werte kommen aus dem Anschreiben (abgeschlossen also eingefroren) und der Abrechnung.
import { describe, expect, test } from 'vitest'
import type { Statement, StatementLetter } from './types'
import { contactRows, footnoteText, infoRows, labor35aTable, resultRows, statementHeadRows, senderMissing, ibanMissing } from './letterView'

const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

const st = (over: Partial<Statement> = {}): Statement => ({
  tenancyId: 't1', unitId: 'u1', tenantName: 'Anna Becker', unitName: 'EG links', persons: 2, days: 365, personDays: 730,
  periodStart: '2025-01-01', periodEnd: '2025-12-31', rows: [], totalShareCents: 350054, total35aCents: 0, prepaymentCents: 336000,
  prepaymentOverridden: false, suggestedMonthlyCents: 29200, balanceCents: -14054, ...over,
})
const values = { Abrechnung: 'Nebenkostenabrechnung 2025', Objekt: 'Lindenweg 12', Wohnung: 'EG links' } as StatementLetter['values']
const letter = (over: Partial<StatementLetter> = {}): StatementLetter => ({
  texts: {} as StatementLetter['texts'], adjustment: { mode: 'none', newCents: null }, values,
  sender: { name: 'Klaus Wegener', returnLine: 'Klaus Wegener · Ahornstraße 3, 12345 Musterstadt', address: 'Ahornstraße 3, 12345 Musterstadt', contact: 'Tel. 0123 456789, E-Mail klaus@example.org', footer: '' },
  premises: { address: 'Lindenweg 12, 12345 Musterstadt', areaM2: 72 },
  ...over,
})

test('Kontakt des Vermieters: Telefon und E-Mail werden erkannt, Freitext bleibt ohne Beschriftung', () => {
  expect(contactRows('Tel. 0123 456789, E-Mail klaus@example.org')).toEqual([
    { label: 'Telefon', value: '0123 456789' }, { label: 'E-Mail', value: 'klaus@example.org' },
  ])
  expect(contactRows('klaus@example.org · 0171 2345678')).toEqual([
    { label: 'E-Mail', value: 'klaus@example.org' }, { label: 'Telefon', value: '0171 2345678' },
  ])
  expect(contactRows('Telefon: 030 123; Fax 030 124; Mobil 0171 1')).toEqual([
    { label: 'Telefon', value: '030 123' }, { label: 'Telefax', value: '030 124' }, { label: 'Mobil', value: '0171 1' },
  ])
  expect(contactRows('Sprechzeiten montags')).toEqual([{ label: null, value: 'Sprechzeiten montags' }])
  // Durchsicht K3: Ein Komma trennt nur vor einer erkannten Telefonnummer oder E-Mail; Zeilenumbruch und Semikolon immer.
  expect(contactRows('Sprechzeiten Mo, Mi 9–12 Uhr')).toEqual([{ label: null, value: 'Sprechzeiten Mo, Mi 9–12 Uhr' }])
  expect(contactRows('Sprechzeiten Mo, Mi 9–12 Uhr, Tel. 0123 456789')).toEqual([
    { label: null, value: 'Sprechzeiten Mo, Mi 9–12 Uhr' }, { label: 'Telefon', value: '0123 456789' },
  ])
  expect(contactRows('Hausverwaltung, 2. OG\nklaus@example.org')).toEqual([
    { label: null, value: 'Hausverwaltung, 2. OG' }, { label: 'E-Mail', value: 'klaus@example.org' },
  ])
  // Der Kontakt aus dem Beispielbestand (scripts/demo-stock.mjs im Druckprobenlauf)
  expect(contactRows('Tel. 0123 456789, E-Mail klaus.wegener@example.org')).toEqual([
    { label: 'Telefon', value: '0123 456789' }, { label: 'E-Mail', value: 'klaus.wegener@example.org' },
  ])
  expect(contactRows('')).toEqual([])
  expect(contactRows(undefined)).toEqual([])
})

test('Informationsblock nach DIN 5008: Ansprechpartner, Kontakt, Ort und Datum', () => {
  expect(infoRows(letter().sender, '24.10.2026')).toEqual([
    { label: 'Ansprechpartner', value: 'Klaus Wegener' },
    { label: 'Telefon', value: '0123 456789' },
    { label: 'E-Mail', value: 'klaus@example.org' },
    { label: null, value: 'Musterstadt, 24.10.2026' },
  ])
  // Ohne Anschrift des Vermieters kein Ort; ohne Kontakt (Abschluss aus Teil 1) nur, was es gibt.
  expect(infoRows({ name: 'Klaus Wegener', returnLine: 'x' }, '24.10.2026')).toEqual([
    { label: 'Ansprechpartner', value: 'Klaus Wegener' }, { label: 'Datum', value: '24.10.2026' },
  ])
  expect(infoRows(undefined, '24.10.2026')).toEqual([{ label: 'Datum', value: '24.10.2026' }])
})

test('Kopf der Abrechnung: Mieter, Mietobjekt, Wohnung, Wohnfläche, Zeitraum und Personen', () => {
  const period = { from: '2025-01-01', to: '2025-12-31' }
  expect(statementHeadRows(st(), letter(), { period, persons: '2 Personen' }).map((r) => [r.label, plain(r.value)])).toEqual([
    ['Mieter', 'Anna Becker'],
    ['Mietobjekt', 'Lindenweg 12, 12345 Musterstadt'],
    ['Wohnung', 'EG links'],
    ['Wohnfläche', '72 m²'],
    ['Abrechnungszeitraum', '01.01.2025 – 31.12.2025 (365 Tage)'],
    ['Personen', '2 Personen'],
  ])
  // Auszug: der eigene Nutzungszeitraum daneben. Ohne Fläche (Garage, vor dieser Änderung eingefroren) keine Zeile, ohne
  // Anschrift der Name des Objekts.
  const moved = statementHeadRows(st({ periodEnd: '2025-06-30', days: 181 }), letter({ premises: undefined }), { period, persons: '1 Person' })
  expect(moved.map((r) => [r.label, plain(r.value)])).toEqual([
    ['Mieter', 'Anna Becker'],
    ['Mietobjekt', 'Lindenweg 12'],
    ['Wohnung', 'EG links'],
    ['Abrechnungszeitraum', '01.01.2025 – 31.12.2025'],
    ['Ihr Nutzungszeitraum', '01.01.2025 – 30.06.2025 (181 Tage)'],
    ['Personen', '1 Person'],
  ])
  expect(statementHeadRows(st(), letter({ premises: { address: 'X', areaM2: 64.5 } }), { period, persons: null }).find((r) => r.label === 'Wohnfläche')?.value).toBe('64,5 m²')
})

test('Fußvermerk je Seite: Abrechnung, Objekt und Wohnung, ohne Namen des Mieters', () => {
  expect(footnoteText(letter())).toBe('Nebenkostenabrechnung 2025 · Lindenweg 12, EG links')
  // Nennt die Wohnung das Objekt schon (Eigentumswohnung), steht es nicht doppelt da.
  expect(footnoteText(letter({ values: { ...values, Objekt: 'Kastanienallee 5, WE 7', Wohnung: 'WE 7, 2. OG rechts' } }))).toBe('Nebenkostenabrechnung 2025 · Kastanienallee 5, WE 7, 2. OG rechts')
})

test('Ergebniskasten ohne Zeitraum: der steht im Kopf der Abrechnung', () => {
  expect(resultRows(st(), 30).map((r) => r.label)).toEqual(['Ihre Kosten', 'Ihre Vorauszahlungen', 'Nachzahlung', 'Zahlbar'])
})

test('§ 35a EStG als Tabelle: Leistung, Gesamtbetrag, Lohnanteil, Ihr Anteil', () => {
  const rows = [
    { costItemId: 'k1', category: 'Hauswart', description: 'Hausmeisterdienst', totalCents: 180000, keyLabel: 'Wohnfläche', shareCents: 48000, labor35aCents: 40000 },
    { costItemId: 'k2', category: 'Grundsteuer', description: 'Grundsteuer', totalCents: 61240, keyLabel: 'Wohnfläche', shareCents: 16331, labor35aCents: 0 },
    { costItemId: 'k3', category: 'Schornsteinfeger', description: 'Schornsteinfeger', totalCents: 9530, keyLabel: 'Wohnfläche', shareCents: 2541, labor35aCents: 1685 },
  ]
  const show = (t: ReturnType<typeof labor35aTable>) => ({ full: t.full, rows: t.rows.map((r) => ({ ...r, total: plain(r.total), labor: plain(r.labor), share: plain(r.share) })) })
  const full = labor35aTable(st({ rows }), letter({ labor35a: { k1: { amountCents: 180000, laborCents: 150000 }, k3: { amountCents: 9530, laborCents: 6320 } } }))
  expect(show(full)).toEqual({ full: true, rows: [
    { service: 'Hauswart: Hausmeisterdienst', total: '1.800,00 €', labor: '1.500,00 €', share: '400,00 €' },
    { service: 'Schornsteinfeger', total: '95,30 €', labor: '63,20 €', share: '16,85 €' },
  ] })
  // Durchsicht K2: Ein Anschreiben, das vor dieser Änderung eingefroren wurde, kennt Rechnungsbetrag und Lohnanteil nicht;
  // dann stehen nur Leistung und Ihr Anteil da, keine leeren Spalten.
  expect(show(labor35aTable(st({ rows }), letter()))).toEqual({ full: false, rows: [
    { service: 'Hauswart: Hausmeisterdienst', total: '', labor: '', share: '400,00 €' },
    { service: 'Schornsteinfeger', total: '', labor: '', share: '16,85 €' },
  ] })
  expect(labor35aTable(st({ rows }), null).full).toBe(false)
})

// Praxistest: Ohne Namen des Vermieters druckte das Anschreiben weder Absender noch Unterschrift, ohne Warnung.
describe('Absender fehlt (senderMissing)', () => {
  test('ohne Namen und ohne Unterschrift fehlt der Absender; ein Name an einer der beiden Stellen genügt', () => {
    expect(senderMissing({ sender: '', signature: '', paper: false })).toBe(true)
    expect(senderMissing({ sender: '  ', signature: null, paper: false })).toBe(true)
    expect(senderMissing({ sender: 'Max Vermieter', signature: '', paper: false })).toBe(false)
    // Eine eigene Unterschrift nennt den Erklärenden ebenso (§ 126b BGB verlangt keinen Briefkopf).
    expect(senderMissing({ sender: '', signature: 'Erika Muster', paper: false })).toBe(false)
  })

  test('mit Briefpapier trägt das Papier den Absender; Mietfuchs sieht es nicht und warnt nicht', () => {
    expect(senderMissing({ sender: '', signature: '', paper: true })).toBe(false)
  })
})

// Systemprüfung: Ohne IBAN bat der Brief um Überweisung der Nachzahlung, ohne ein Konto zu nennen, und nichts wies darauf hin.
describe('Bankverbindung fehlt (ibanMissing)', () => {
  const sentence = 'Es ergibt sich eine Nachzahlung von 120,00 €. Bitte überweisen Sie den Betrag innerhalb von 30 Tagen nach Zugang dieser Abrechnung.'
  const missing = (over: Partial<Parameters<typeof ibanMissing>[0]> = {}) => ibanMissing({ balanceCents: -12000, iban: '', sentence, paper: false, ...over })

  test('nur bei einer Nachzahlung, deren Satz zur Überweisung auffordert und kein Konto nennt', () => {
    expect(missing()).toBe(true)
    expect(missing({ iban: 'DE02 1203 0000 0000 2020 51' })).toBe(false)
    // Guthaben und ausgeglichen: Es ist nichts zu überweisen.
    expect(missing({ balanceCents: 12000 })).toBe(false)
    expect(missing({ balanceCents: 0 })).toBe(false)
  })

  // Durchsicht (S2): wie beim Absender. Mit Briefpapier trägt das Papier die Bankverbindung, und Mietfuchs sieht es nicht.
  test('mit Briefpapier kein Hinweis', () => {
    expect(missing({ paper: true })).toBe(false)
  })

  test('wer bar oder per Lastschrift kassiert und den Satz so schreibt, bekommt keinen Hinweis; im Zweifel keiner', () => {
    expect(missing({ sentence: 'Die Nachzahlung von 120,00 € ziehe ich mit der nächsten Miete per Lastschrift ein.' })).toBe(false)
    expect(missing({ sentence: '' })).toBe(false)
    expect(missing({ sentence: null })).toBe(false)
    // Durchsicht (S2): Das Wort allein ist keine Aufforderung, und eine verneinte ist keine.
    expect(missing({ sentence: 'Bitte keine Überweisung, ich buche den Betrag ab.' })).toBe(false)
    expect(missing({ sentence: 'Bitte überweisen Sie nichts, ich buche den Betrag von 120,00 € ab.' })).toBe(false)
    expect(missing({ sentence: 'Eine Überweisung ist nicht nötig.' })).toBe(false)
    // Die Verneinung eines anderen Satzes zählt nicht.
    expect(missing({ sentence: 'Ihre Vorauszahlungen haben nicht gereicht. Bitte überweisen Sie 120,00 €.' })).toBe(true)
    // Das Konto steht im eigenen Text statt im Platzhalter.
    expect(missing({ sentence: 'Bitte überweisen Sie 120,00 € auf das Konto DE02 1203 0000 0000 2020 51.' })).toBe(false)
    expect(missing({ sentence: 'Bitte überweisen Sie 120,00 € auf das Konto DE02120300000000202051.' })).toBe(false)
  })
})

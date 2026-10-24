// Der Druck der Abrechnung (#415): Informationsblock, Kopf der Abrechnung, Fußvermerk, Ergebniskasten und die Tabelle nach
// § 35a EStG, ohne DOM geprüft. Die Werte kommen aus dem Anschreiben (abgeschlossen also eingefroren) und der Abrechnung.
import { expect, test } from 'vitest'
import type { Statement, StatementLetter } from './types'
import { contactRows, footnoteText, infoRows, labor35aRows, resultRows, statementHeadRows } from './letterView'

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
  const out = labor35aRows(st({ rows }), letter({ labor35a: { k1: { amountCents: 180000, laborCents: 150000 } } }))
  expect(out.map((r) => ({ ...r, total: plain(r.total), labor: plain(r.labor), share: plain(r.share) }))).toEqual([
    { service: 'Hauswart: Hausmeisterdienst', total: '1.800,00 €', labor: '1.500,00 €', share: '400,00 €' },
    // Ohne eingefrorenen Lohnanteil der Rechnung (Abschluss vor dieser Änderung) bleibt die Spalte leer.
    { service: 'Schornsteinfeger', total: '95,30 €', labor: '', share: '16,85 €' },
  ])
})

// Rechnungsdatum aus der Textschicht einer PDF (#487, Entscheidung 3B): ohne KI nur ein Datum, nie ein Betrag. Ein
// beschriftetes Datum gewinnt; ohne Beschriftung nur, wenn im Text genau ein Datum steht. Im Zweifel keins.
import { describe, expect, test } from 'vitest'
import { invoiceDateFromText } from './invoiceDateText'

describe('Rechnungsdatum aus dem Text', () => {
  test('beschriftet mit Doppelpunkt', () => {
    expect(invoiceDateFromText('Stadtwerke\nRechnungsdatum: 14.02.2025\nBetrag 480,00 €')).toBe('2025-02-14')
  })
  test('ausgeschriebener Monat', () => {
    expect(invoiceDateFromText('Datum 14. Februar 2025')).toBe('2025-02-14')
    expect(invoiceDateFromText('Datum: 3. März 2025')).toBe('2025-03-03')
    expect(invoiceDateFromText('Rechnungsdatum 7. Okt. 2025')).toBe('2025-10-07')
  })
  test('Beschriftung und Datum in getrennten Textstücken, auch über einen Zeilenumbruch', () => {
    expect(invoiceDateFromText('Rechnungsdatum\n  14.02.2025')).toBe('2025-02-14')
    expect(invoiceDateFromText('Rechnung vom 3.1.2025')).toBe('2025-01-03')
  })
  test('mehrere Daten ohne Beschriftung: keins', () => {
    expect(invoiceDateFromText('Abrechnungszeitraum 01.01.2024 bis 31.12.2024')).toBeNull()
  })
  test('mehrere Daten, eines beschriftet: das beschriftete', () => {
    expect(invoiceDateFromText('Leistungszeitraum 01.01.2024 – 31.12.2024\nRechnungsdatum: 15.01.2025\nfällig am 15.02.2025')).toBe('2025-01-15')
  })
  test('„Rechnungsdatum“ geht vor einem bloßen „Datum“', () => {
    expect(invoiceDateFromText('Datum: 02.01.2025\nRechnungsdatum: 15.01.2025')).toBe('2025-01-15')
  })
  test('zwei verschiedene Rechnungsdaten: keins', () => {
    expect(invoiceDateFromText('Rechnungsdatum: 15.01.2025\nRechnungsdatum: 16.01.2025')).toBeNull()
  })
  test('Fälligkeits- und Lieferdatum sind kein Rechnungsdatum', () => {
    expect(invoiceDateFromText('Fälligkeitsdatum: 28.02.2025\nLieferdatum: 01.02.2025')).toBeNull()
  })
  test('genau ein Datum ohne Beschriftung, auch mehrmals', () => {
    expect(invoiceDateFromText('Hamburg, 14.02.2025')).toBe('2025-02-14')
    expect(invoiceDateFromText('Hamburg, 14.02.2025 … Seite 2 … 14.02.2025')).toBe('2025-02-14')
  })
  test('kein gültiger Tag, kein Datum', () => {
    expect(invoiceDateFromText('Rechnungsdatum: 31.02.2025')).toBeNull()
    expect(invoiceDateFromText('Rechnung Nr. 4711, Betrag 480,00 €')).toBeNull()
    expect(invoiceDateFromText('')).toBeNull()
  })
  test('zweistelliges Jahr und ISO-Schreibweise', () => {
    expect(invoiceDateFromText('Rechnungsdatum: 14.02.25')).toBe('2025-02-14')
    expect(invoiceDateFromText('Datum: 2025-02-14')).toBe('2025-02-14')
  })
  test('Beträge und Nummern sind kein Datum', () => {
    expect(invoiceDateFromText('Summe 1.234,56 €\nKundennr. 12.345.678')).toBeNull()
  })
})

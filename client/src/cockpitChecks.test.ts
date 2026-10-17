// Cockpit-Prüfungen (#142): Nicht umlagefähige Positionen werden nie verteilt; ihr gespeicherter
// Schlüssel darf deshalb weder Ablesungen verlangen noch die Verteilbasis prüfen lassen.
import { calendarPeriod } from '../../shared/period.ts'
import { expect, test } from 'vitest'
import type { CostItem } from './types'
import { cockpitSubtitle, itemsDetail, meterTypesInUse, tenanciesDetail, usesUnitBasis } from './cockpitChecks'

const item = (category: string, patch: Partial<CostItem>): CostItem => ({
  id: category, propertyId: 'p', period: calendarPeriod(2025), category, description: category, amountCents: 100, key: 'area', ...patch,
})

test('verbrauchsabhängige Umlage: nur umlagefähige Positionen mit Verbrauchsschlüssel zählen', () => {
  expect(meterTypesInUse([item('Wasser/Abwasser', { key: 'meter', meterType: 'kaltwasser' })])).toEqual(new Set(['kaltwasser']))
  expect(meterTypesInUse([
    item('Nicht umlagefähig', { key: 'meter', meterType: 'kaltwasser' }),
    item('Zuführung Erhaltungsrücklage', { key: 'meter', meterType: 'waerme' }),
  ])).toEqual(new Set())
})

test('Verteilbasis: nur umlagefähige Positionen nach Fläche, Einheiten, Personen oder Gemeinschaft zählen', () => {
  expect(usesUnitBasis([item('Grundsteuer', { key: 'area' })])).toBe(true)
  expect(usesUnitBasis([item('Hauswart', { key: 'direct' })])).toBe(false)
  expect(usesUnitBasis([item('Nicht umlagefähig', { key: 'area' }), item('Zuführung Erhaltungsrücklage', { key: 'persons' })])).toBe(false)
})

// Ein- und Mehrzahl statt „Mietverhältnis(se)“, „Wohnung(en)“, „Position(en)“ und „Belegdatei(en)“ (#180).
test('Zeile „Mietverhältnisse & Flächen“: Ein- und Mehrzahl, Aufzählung mit „und“', () => {
  expect(tenanciesDetail(1, 0, 1, [])).toBe('1 Mietverhältnis · 1 beteiligte Wohnung · vollständig')
  expect(tenanciesDetail(3, 1, 2, ['G1', 'G2'])).toBe('3 Mietverhältnisse, davon 1 ohne Abrechnung · 2 beteiligte Wohnungen · 0 m² und 0 Personen: G1 und G2')
})

// fmtEuro setzt ein geschütztes Leerzeichen vor das Eurozeichen.
const plain = (s: string) => s.replace(/\u00a0/g, ' ')

test('Zeile „Belege erfasst“: Ein- und Mehrzahl', () => {
  expect(plain(itemsDetail(1, 12345, 0))).toBe('1 Position · Summe 123,45 €')
  expect(plain(itemsDetail(12, 100, 1))).toBe('12 Positionen · Summe 1,00 € · 1 Belegdatei')
  expect(plain(itemsDetail(12, 100, 3))).toBe('12 Positionen · Summe 1,00 € · 3 Belegdateien')
})

// #180: Beim Erststart zeigt das Cockpit keine Checkliste, sondern zwei Knöpfe zum Anfangen.
// Eine Zahl offener Punkte, die nirgends aufgezählt sind, ließe den Vermieter ratlos zurück.
test('Unterzeile beim Erststart nennt keine Zahl offener Punkte, sondern den ersten Schritt', () => {
  const text = cockpitSubtitle({ loaded: true, fresh: true, openCount: 4 })
  expect(text).not.toMatch(/\d/)
  expect(text).not.toMatch(/offen/)
  expect(text).toMatch(/Stammdaten/)
})

test('Unterzeile mit Checkliste: Zahl offener Punkte in Ein- und Mehrzahl, sonst bereit', () => {
  expect(cockpitSubtitle({ loaded: false, fresh: false, openCount: 0 })).toBe('Lade Abrechnungsstand …')
  expect(cockpitSubtitle({ loaded: true, fresh: false, openCount: 0 })).toBe('Alles bereit — die Abrechnung ist vollständig.')
  expect(cockpitSubtitle({ loaded: true, fresh: false, openCount: 1 })).toBe('Noch 1 Punkt offen, dann ist die Abrechnung versandfertig.')
  expect(cockpitSubtitle({ loaded: true, fresh: false, openCount: 3 })).toBe('Noch 3 Punkte offen, dann ist die Abrechnung versandfertig.')
})

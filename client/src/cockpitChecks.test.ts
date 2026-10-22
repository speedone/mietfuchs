// Cockpit-Prüfungen (#142): Nicht umlagefähige Positionen werden nie verteilt; ihr gespeicherter
// Schlüssel darf deshalb weder Ablesungen verlangen noch die Verteilbasis prüfen lassen.
import { calendarPeriod } from '../../shared/period.ts'
import { expect, test } from 'vitest'
import type { CostItem } from './types'
import { cockpitSubtitle, itemsDetail, meterTypesInUse, tenanciesDetail, usesUnitBasis, countsByUnits, missingSincePrevious, condoWithoutHousingMoney } from './cockpitChecks'

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
  // Befund N2 aus #341 (Durchsicht): Zählt eine Einheit bei einer Position nach Einheiten mit? Nur ohne
  // Teilnehmerliste oder als Teilnehmer, und nur bei umlagefähigen Positionen.
  expect(countsByUnits([item('Grundsteuer', { key: 'units' })], 'g1')).toBe(true)
  expect(countsByUnits([item('Grundsteuer', { key: 'units', participantUnitIds: null })], 'g1')).toBe(true)
  expect(countsByUnits([item('Nicht umlagefähig', { key: 'units' }), item('Grundsteuer', { key: 'area' })], 'g1')).toBe(false)
  expect(countsByUnits([item('Müllabfuhr', { key: 'units', participantUnitIds: ['eg', 'og'] })], 'g1')).toBe(false)
  expect(countsByUnits([item('Müllabfuhr', { key: 'units', participantUnitIds: ['eg', 'g1'] })], 'g1')).toBe(true)
})

// Ein- und Mehrzahl statt „Mietverhältnis(se)“, „Wohnung(en)“, „Position(en)“ und „Belegdatei(en)“ (#180).
test('Zeile „Mietverhältnisse & Flächen“: Ein- und Mehrzahl, Aufzählung mit „und“', () => {
  expect(tenanciesDetail(1, 0, 1, [])).toBe('1 Mietverhältnis · 1 beteiligte Wohnung · vollständig')
  // Befund N2 aus #341: „0 m² und 0 Personen: G1 und G2“ stand ohne Kontext da. Die Zeile sagt jetzt,
  // warum das in Ordnung ist: Einheiten ohne Wohnfläche und ohne Bewohner tragen bei Fläche und Personen nichts;
  // beim Schlüssel nach Einheiten zählen sie je als eine Einheit mit (calc.ts, `basisUnits`).
  expect(tenanciesDetail(3, 1, 2, ['G1', 'G2'])).toBe('3 Mietverhältnisse, davon 1 ohne Abrechnung · 2 beteiligte Wohnungen · '
    + 'G1 und G2 ohne Wohnfläche und ohne Bewohner (etwa Garage oder Stellplatz): Bei Fläche und Personen zählen sie nicht mit')
  expect(tenanciesDetail(3, 0, 3, ['Garage 1'], ['Garage 1'])).toBe('3 Mietverhältnisse · 3 beteiligte Wohnungen · '
    + 'Garage 1 ohne Wohnfläche und ohne Bewohner (etwa Garage oder Stellplatz): Bei Fläche und Personen zählt sie nicht mit, nach Einheiten als eine Einheit')
  expect(tenanciesDetail(3, 0, 3, ['G1', 'G2'], ['G1', 'G2'])).toMatch(/zählen sie nicht mit, nach Einheiten je als eine Einheit$/)
  // Nur G1 nimmt an der Position nach Einheiten teil: Der Zusatz nennt nur G1.
  expect(tenanciesDetail(3, 0, 3, ['G1', 'G2'], ['G1'])).toMatch(/zählen sie nicht mit, nach Einheiten zählt G1 als eine Einheit$/)
  expect(tenanciesDetail(3, 0, 3, ['G1', 'G2', 'G3'], ['G1', 'G3'])).toMatch(/nach Einheiten zählen G1 und G3 je als eine Einheit$/)
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
  const text = cockpitSubtitle({ loaded: true, fresh: true, open: ['a', 'b', 'c', 'd'] })
  expect(text).not.toMatch(/\d/)
  expect(text).not.toMatch(/offen/)
  expect(text).toMatch(/Stammdaten/)
  // Mit dem ersten Schritt aus emptyStock.ts nennt die Zeile genau diesen (#346, N12).
  expect(cockpitSubtitle({ loaded: true, fresh: true, open: [], start: 'Legen Sie zuerst eine Wohnung an.' })).toBe('Legen Sie zuerst eine Wohnung an.')
})

test('Unterzeile mit Checkliste: Zahl offener Punkte in Ein- und Mehrzahl, sonst bereit', () => {
  expect(cockpitSubtitle({ loaded: false, fresh: false, open: [] })).toBe('Lade Abrechnungsstand …')
  expect(cockpitSubtitle({ loaded: true, fresh: false, open: [] })).toBe('Nichts mehr offen.')
  expect(cockpitSubtitle({ loaded: true, fresh: false, open: ['Belege erfasst'] })).toBe('Noch 1 Punkt offen.')
  expect(cockpitSubtitle({ loaded: true, fresh: false, open: ['a', 'b', 'c'] })).toBe('Noch 3 Punkte offen.')
})

// #409: Ob alle Rechnungen des Jahres vorliegen, weiß nur der Vermieter. Eine Rechnung, die nie erfasst
// wurde, sieht keine Prüfung; die Zeile darf deshalb weder „vollständig“ noch „versandfertig“ versprechen.
test('Unterzeile verspricht keine Vollständigkeit, die Mietfuchs nicht kennen kann (#409)', () => {
  for (const open of [[], ['Abgeschlossen & versendet'], ['a', 'b']]) {
    expect(cockpitSubtitle({ loaded: true, fresh: false, open })).not.toMatch(/vollständig|versandfertig|bereit/)
  }
})

// #409: Eine Kostenart, die es im Vorjahr gab und jetzt nicht, ist eine fehlende Rechnung oder eine
// Antwort wert. Vorher übersprang der Vergleich sie, weil er nur über die Kostenarten des Jahres lief.
test('Kostenarten des Vorjahres, die im Jahr fehlen (#409)', () => {
  const prev = [item('Grundsteuer', {}), item('Wasser/Abwasser', {}), item('Heizung und Warmwasser', {}), item('Nicht umlagefähig', {})]
  expect(missingSincePrevious([item('Grundsteuer', {})], prev)).toEqual(['Wasser/Abwasser', 'Heizung und Warmwasser'])
  expect(missingSincePrevious(prev, prev)).toEqual([])
  // Ohne Vorjahr fehlt nichts; nicht umlagefähige Positionen gehören nicht in die Abrechnung des Mieters.
  expect(missingSincePrevious([item('Grundsteuer', {})], [])).toEqual([])
  expect(missingSincePrevious([], [item('Nicht umlagefähig', {})])).toEqual([])
  // Eine Kostenart mehrfach im Vorjahr: einmal genannt.
  expect(missingSincePrevious([], [item('Heizung und Warmwasser', {}), item('Heizung und Warmwasser', { id: 'h2' })])).toEqual(['Heizung und Warmwasser'])
})

// #409: Bei einer Eigentumswohnung stehen alle umlagefähigen Kosten außer der Grundsteuer in der
// Hausgeldabrechnung (shared/assessment.ts). Ist nur die Grundsteuer erfasst, fehlt sie noch.
test('Eigentumswohnung ohne Positionen aus der Hausgeldabrechnung (#409)', () => {
  expect(condoWithoutHousingMoney('etw', [item('Grundsteuer', {})])).toBe(true)
  expect(condoWithoutHousingMoney('etw', [item('Grundsteuer', {}), item('Nicht umlagefähig', {})])).toBe(true)
  expect(condoWithoutHousingMoney('etw', [item('Grundsteuer', {}), item('Beleuchtung/Allgemeinstrom', { key: 'external' })])).toBe(false)
  // Ohne Kosten sagt schon „Belege erfasst“, dass nichts da ist.
  expect(condoWithoutHousingMoney('etw', [])).toBe(false)
  expect(condoWithoutHousingMoney('mfh', [item('Grundsteuer', {})])).toBe(false)
  expect(condoWithoutHousingMoney(undefined, [item('Grundsteuer', {})])).toBe(false)
})

// UI-Durchsicht M9 (#341): Nach dem Versand ist nichts mehr „versandfertig“ zu machen.
test('Unterzeile nach Abschluss und Versand nennt den Stand und die offenen Punkte beim Namen', () => {
  expect(cockpitSubtitle({ loaded: true, fresh: false, open: ['Belege vollständig'], closed: true, sentAt: '2026-03-02' }))
    .toBe('Versendet am 02.03.2026; noch offen: „Belege vollständig“.')
  expect(cockpitSubtitle({ loaded: true, fresh: false, open: [], closed: true, sentAt: '2026-03-02' })).toBe('Versendet am 02.03.2026; nichts mehr offen.')
  // Durchsicht S2: keine Doppelung der Zeile, und die Frist läuft weiter
  expect(cockpitSubtitle({ loaded: true, fresh: false, open: ['Abgeschlossen & versendet'], closed: true, deadline: '2026-12-31' }))
    .toBe('Abgeschlossen, Versanddatum fehlt (Frist am 31.12.2026).')
  // Nach Ablauf der Frist versendet: das steht da, statt still „nichts mehr offen“
  expect(cockpitSubtitle({ loaded: true, fresh: false, open: ['Abgeschlossen & versendet'], closed: true, sentAt: '2027-01-05', deadline: '2026-12-31' }))
    .toBe('Versendet am 05.01.2027, nach Ablauf der Frist (31.12.2026).')
  for (const text of [cockpitSubtitle({ loaded: true, fresh: false, open: ['x'], closed: true }), cockpitSubtitle({ loaded: true, fresh: false, open: ['x'], closed: true, sentAt: '2026-03-02' })]) {
    expect(text).not.toMatch(/versandfertig/)
  }
})

// Der Hinweis im Cockpit auf vermutlich falsch eingetragene IBANs (#279).
import { expect, test } from 'vitest'
import { ibanHintTitle, invalidIbans } from './ibanCheck'

const OK = 'DE89370400440532013000'
const YEAR = 2025
const mv = (id: string, tenantName: string, iban?: string, end: string | null = null) => ({ id, tenantName, end, ...(iban === undefined ? {} : { iban }) })

test('alles gültig oder leer: kein Befund', () => {
  expect(invalidIbans({ iban: '' }, { name: 'Haus', iban: null }, [mv('t1', 'Müller')], YEAR)).toEqual([])
  expect(invalidIbans({ iban: OK }, { name: 'Haus', iban: 'de89 3704 0044 0532 0130 00' }, [mv('t1', 'Müller', OK)], YEAR)).toEqual([])
  expect(invalidIbans(null, null, [], YEAR)).toEqual([])
  // '' am Objekt heißt „bewusst keine“ und ist kein Befund
  expect(invalidIbans({ iban: OK }, { name: 'Haus', iban: '' }, [], YEAR)).toEqual([])
})

test('jede ungültige wird mit Ort und Sprung genannt', () => {
  const befunde = invalidIbans(
    { iban: 'DE00 1111' },
    { name: 'Gartenweg 3', iban: null },
    [mv('t1', 'Müller', OK), mv('t2', 'Schmidt', 'XX12')],
    YEAR,
  )
  expect(befunde.map((b) => b.where)).toEqual([
    'Einstellungen, Bankverbindung des Vermieters',
    'Mietverhältnis „Schmidt“',
  ])
  expect(befunde.map((b) => [b.tab, b.focus])).toEqual([
    ['einstellungen', null],
    ['stammdaten', { kind: 'tenancy', id: 't2' }],
  ])
  expect(befunde[0]?.problem).toMatch(/DE hat 22 Zeichen/)
  expect(befunde[1]?.problem).toMatch(/„XX“/)
  const objekt = invalidIbans({ iban: OK }, { name: 'Gartenweg 3', iban: 'DE00370400440532013000' }, [], YEAR)
  expect(objekt.map((b) => [b.where, b.tab])).toEqual([['Objekt „Gartenweg 3“, abweichende Bankverbindung', 'stammdaten']])
  expect(objekt[0]?.problem).toMatch(/Prüfziffer/)
})

test('die IBAN der Einstellungen nur, wenn sie für das gewählte Objekt gilt', () => {
  // Das Objekt hat eine eigene (oder bewusst keine): Die Vorgabe steht auf keiner seiner Abrechnungen.
  expect(invalidIbans({ iban: 'DE00 1111' }, { name: 'Haus', iban: OK }, [], YEAR)).toEqual([])
  expect(invalidIbans({ iban: 'DE00 1111' }, { name: 'Haus', iban: '' }, [], YEAR)).toEqual([])
  expect(invalidIbans({ iban: 'DE00 1111' }, { name: 'Haus', iban: null }, [], YEAR)).toHaveLength(1)
})

test('Mietverhältnisse, die vor dem Vorjahr endeten, werden nicht mehr genannt', () => {
  const befunde = invalidIbans(null, null, [
    mv('alt', 'Längst ausgezogen', 'DE00', '2023-12-31'),
    mv('vorjahr', 'Im Vorjahr ausgezogen', 'DE00', '2024-01-01'),
    mv('jahr', 'Im Jahr ausgezogen', 'DE00', '2025-06-30'),
    mv('offen', 'Wohnt noch', 'DE00'),
  ], YEAR)
  expect(befunde.map((b) => b.focus?.id)).toEqual(['vorjahr', 'jahr', 'offen'])
})

test('Überschrift in Einzahl und Mehrzahl', () => {
  expect(ibanHintTitle(1)).toBe('Eine IBAN ist vermutlich falsch eingetragen')
  expect(ibanHintTitle(2)).toBe('2 IBANs sind vermutlich falsch eingetragen')
})

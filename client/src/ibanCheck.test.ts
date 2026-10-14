// Der Hinweis im Cockpit auf vermutlich falsch eingetragene IBANs (#279).
import { expect, test } from 'vitest'
import { ibanHintTitle, invalidIbans } from './ibanCheck'

const OK = 'DE89370400440532013000'

test('alles gültig oder leer: kein Befund', () => {
  expect(invalidIbans({ iban: '' }, { name: 'Haus', iban: null }, [{ id: 't1', tenantName: 'Müller' }])).toEqual([])
  expect(invalidIbans({ iban: OK }, { name: 'Haus', iban: 'de89 3704 0044 0532 0130 00' }, [{ id: 't1', tenantName: 'Müller', iban: OK }])).toEqual([])
  expect(invalidIbans(null, null, [])).toEqual([])
  // '' am Objekt heißt „bewusst keine“ und ist kein Befund
  expect(invalidIbans({ iban: OK }, { name: 'Haus', iban: '' }, [])).toEqual([])
})

test('jede ungültige wird mit Ort und Sprung genannt', () => {
  const befunde = invalidIbans(
    { iban: 'DE00 1111' },
    { name: 'Gartenweg 3', iban: 'DE00370400440532013000' },
    [{ id: 't1', tenantName: 'Müller', iban: OK }, { id: 't2', tenantName: 'Schmidt', iban: 'XX12' }],
  )
  expect(befunde.map((b) => b.where)).toEqual([
    'Einstellungen, Bankverbindung des Vermieters',
    'Objekt „Gartenweg 3“, abweichende Bankverbindung',
    'Mietverhältnis „Schmidt“',
  ])
  expect(befunde.map((b) => [b.tab, b.focus])).toEqual([
    ['einstellungen', null],
    ['stammdaten', null],
    ['stammdaten', { kind: 'tenancy', id: 't2' }],
  ])
  expect(befunde[0]?.problem).toMatch(/DE hat 22 Zeichen/)
  expect(befunde[1]?.problem).toMatch(/Prüfziffer/)
  expect(befunde[2]?.problem).toMatch(/„XX“/)
})

test('Überschrift in Einzahl und Mehrzahl', () => {
  expect(ibanHintTitle(1)).toBe('Eine IBAN ist vermutlich falsch eingetragen')
  expect(ibanHintTitle(2)).toBe('2 IBANs sind vermutlich falsch eingetragen')
})

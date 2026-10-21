import { expect, test } from 'vitest'
import { parseYearText } from './yearText'

test('Jahresfeld liest ein vierstelliges Jahr, leer ist leer', () => {
  expect(parseYearText('2031')).toEqual({ kind: 'year', year: 2031 })
  expect(parseYearText(' 2028 ')).toEqual({ kind: 'year', year: 2028 })
  expect(parseYearText('2031.')).toEqual({ kind: 'year', year: 2031 })
  expect(parseYearText('1900')).toEqual({ kind: 'year', year: 1900 })
  expect(parseYearText('2100')).toEqual({ kind: 'year', year: 2100 })
  expect(parseYearText('')).toEqual({ kind: 'empty' })
  expect(parseYearText('   ')).toEqual({ kind: 'empty' })
})

test('Jahresfeld rät kein zweistelliges Jahr, sondern meldet es', () => {
  for (const t of ['28', '5', '202']) {
    expect(parseYearText(t)).toEqual({ kind: 'invalid', short: 'Jahr vierstellig angeben', text: 'Geben Sie das Jahr vierstellig ein, etwa „2031“.' })
  }
})

test('Jahresfeld: außerhalb 1900 bis 2100 und Unlesbares ergeben eine Meldung', () => {
  expect(parseYearText('1899')).toEqual({ kind: 'invalid', short: 'Jahr außerhalb 1900 bis 2100', text: 'Das Jahr 1899 liegt außerhalb von 1900 bis 2100. Bitte prüfen Sie das Jahr.' })
  expect(parseYearText('0999')).toMatchObject({ kind: 'invalid', short: 'Jahr außerhalb 1900 bis 2100' })
  expect(parseYearText('2101')).toMatchObject({ kind: 'invalid', short: 'Jahr außerhalb 1900 bis 2100' })
  for (const t of ['M22', '2028,5', '20280', '2028-01']) {
    expect(parseYearText(t)).toEqual({ kind: 'invalid', short: 'Kein Jahr', text: `„${t}“ ist kein Jahr. Geben Sie das Jahr vierstellig ein, etwa „2031“.` })
  }
})

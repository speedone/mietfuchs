import { describe, expect, test } from 'vitest'
import { buildReadingBody, EMPTY_READING, type ReadingForm } from './readingForm'

const form = (patch: Partial<ReadingForm>): ReadingForm => ({ ...EMPTY_READING, date: '2025-12-31', value: '123', ...patch })
const bodyOf = (f: ReadingForm) => {
  const r = buildReadingBody(f, 'm1')
  if ('problems' in r) throw new Error(`unerwartete Meldung: ${r.problems.map((p) => p.text).join(' ')}`)
  return r.body
}

describe('Ablesung (#149)', () => {
  test('ein leerer Zählerstand wird nicht als 0 gespeichert, sondern gemeldet', () => {
    expect(buildReadingBody(form({ value: '' }), 'm1')).toEqual({ problems: [{ field: 'value', short: 'Zählerstand fehlt', text: 'Bitte den Zählerstand eintragen.' }] })
    expect(buildReadingBody(form({ value: '   ' }), 'm1')).toEqual({ problems: [{ field: 'value', short: 'Zählerstand fehlt', text: 'Bitte den Zählerstand eintragen.' }] })
  })

  test('ein leerer Endstand beim Zählerwechsel ist kein Endstand von 0, sondern keiner', () => {
    // null: Dann greift die Warnung „Endstand fehlt“ aus #83, statt ein falsches Segment zu bilden.
    expect(bodyOf(form({ replacement: true, oldEndValue: '' }))).toMatchObject({ replacement: true, oldEndValue: null })
    expect(bodyOf(form({ replacement: true, oldEndValue: '0' }))).toMatchObject({ oldEndValue: 0 })
  })

  test('gelesen wird wie jede Menge: „1.234“ ist eintausendzweihundertvierunddreißig', () => {
    expect(bodyOf(form({ value: '1.234' })).value).toBe(1234)
    expect(bodyOf(form({ value: '1.234,5' })).value).toBe(1234.5)
    expect(bodyOf(form({ value: '12.5' })).value).toBe(12.5)
    expect(bodyOf(form({ replacement: true, oldEndValue: '9.876' })).oldEndValue).toBe(9876)
  })

  test('Unlesbares und fehlendes Datum werden gemeldet', () => {
    const fields = (f: ReadingForm) => {
      const r = buildReadingBody(f, 'm1')
      return 'problems' in r ? r.problems.map((p) => p.field) : []
    }
    expect(fields(form({ value: 'viel' }))).toEqual(['value'])
    expect(fields(form({ replacement: true, oldEndValue: 'x' }))).toEqual(['oldEndValue'])
    expect(fields(form({ date: '' }))).toEqual(['date'])
  })

  // #346, Schritt 3: alle Angaben auf einmal, nicht nur die erste (GOV.UK, Sammelmeldung).
  test('fehlen Datum und Stand, werden beide gemeldet', () => {
    const r = buildReadingBody(form({ date: '', value: '' }), 'm1')
    expect('problems' in r && r.problems.map((p) => [p.field, p.short])).toEqual([['date', 'Datum fehlt'], ['value', 'Zählerstand fehlt']])
  })

  test('ohne Zählerwechsel kein Endstand im Rumpf', () => {
    expect(bodyOf(form({ oldEndValue: '5' }))).toEqual({ meterId: 'm1', date: '2025-12-31', value: 123, replacement: undefined, oldEndValue: undefined, note: undefined })
  })
})

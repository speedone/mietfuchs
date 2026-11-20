import { describe, expect, test } from 'vitest'
import { buildReadingBody, buildReadingUpdate, EMPTY_READING, newReadingForm, readingQuestion, readingToForm, type ReadingForm } from './readingForm'
import type { Reading } from './types'

const form = (patch: Partial<ReadingForm>): ReadingForm => ({ ...EMPTY_READING, date: '2025-12-31', value: '123', ...patch })
const bodyOf = (f: ReadingForm, asksYear = false) => {
  const r = buildReadingBody(f, 'm1', asksYear)
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

describe('Eichjahr des neuen Zählers beim Wechsel (Praxistest)', () => {
  test('nur beim Wechsel und an einem eichpflichtigen Zähler; leer heißt: nichts senden', () => {
    expect(bodyOf(form({ replacement: true, newCalibratedUntil: '2031' }), true)).toMatchObject({ newCalibratedUntil: 2031 })
    expect(bodyOf(form({ replacement: true, newCalibratedUntil: '' }), true)).not.toHaveProperty('newCalibratedUntil')
    expect(bodyOf(form({ replacement: false, newCalibratedUntil: '2031' }), true)).not.toHaveProperty('newCalibratedUntil')
    expect(bodyOf(form({ replacement: true, newCalibratedUntil: '2031' }), false)).not.toHaveProperty('newCalibratedUntil')
  })

  test('ein unlesbares Jahr ist eine Meldung am Feld', () => {
    const r = buildReadingBody(form({ replacement: true, newCalibratedUntil: '31' }), 'm1', true)
    expect('problems' in r && r.problems.map((p) => p.field)).toEqual(['newCalibratedUntil'])
  })
})


describe('Geschätzte Ablesung (#98)', () => {
  test('mit Begründung: estimated und die Begründung im Rumpf, ohne Haken nichts davon', () => {
    expect(bodyOf(form({ estimated: true, estimateReason: '  Zähler defekt ' }))).toMatchObject({ estimated: true, estimateReason: 'Zähler defekt' })
    const plain = bodyOf(form({ estimated: false, estimateReason: 'vergessen' }))
    expect(plain).not.toHaveProperty('estimated')
    expect(plain).not.toHaveProperty('estimateReason')
  })

  test('ohne Begründung eine Meldung am Feld', () => {
    const r = buildReadingBody(form({ estimated: true, estimateReason: '   ' }), 'm1')
    expect('problems' in r && r.problems.map((p) => [p.field, p.short])).toEqual([['estimateReason', 'Begründung fehlt']])
  })
})

describe('Ablesung bearbeiten: Formular aus der Ablesung und Rumpf für PUT', () => {
  const stored: Reading = { id: 'r1', meterId: 'm1', date: '2025-06-30', value: 1234.5, replacement: true, oldEndValue: 980, note: 'Tausch', estimated: true, estimateReason: 'Zähler defekt' }

  test('das Formular zeigt die gespeicherten Werte in deutscher Schreibweise', () => {
    expect(readingToForm(stored)).toEqual({ date: '2025-06-30', value: '1234,5', replacement: true, oldEndValue: '980', newCalibratedUntil: '', note: 'Tausch', estimated: true, estimateReason: 'Zähler defekt' })
    expect(readingToForm({ id: 'r2', meterId: 'm1', date: '2025-01-01', value: 12.3456 })).toEqual({ ...EMPTY_READING, date: '2025-01-01', value: '12,3456' })
    // Ein Wechsel ohne Endstand bleibt einer ohne Endstand (leer, nicht 0).
    expect(readingToForm({ id: 'r3', meterId: 'm1', date: '2025-01-01', value: 3, replacement: true }).oldEndValue).toBe('')
  })

  test('unverändert gespeichert ergibt dieselben Werte', () => {
    expect(buildReadingUpdate(readingToForm(stored))).toEqual({ body: { date: '2025-06-30', value: 1234.5, replacement: true, oldEndValue: 980, note: 'Tausch', estimated: true, estimateReason: 'Zähler defekt' } })
  })

  // Der Server lässt stehen, was im Rumpf fehlt: Abgewählt wird deshalb ausdrücklich. Das Eichjahr des neuen Zählers
  // und den Zähler selbst schickt das Bearbeiten nie (das Eichjahr lehnt der Server im PUT mit 400 ab).
  test('abgewählter Wechsel, geleerter Hinweis und abgewählte Schätzung gehen ausdrücklich hinaus', () => {
    const r = buildReadingUpdate({ ...readingToForm(stored), replacement: false, note: ' ', estimated: false, newCalibratedUntil: '2031' })
    expect(r).toEqual({ body: { date: '2025-06-30', value: 1234.5, replacement: false, oldEndValue: null, note: null, estimated: false } })
  })

  test('dieselben Meldungen wie beim Anlegen', () => {
    const r = buildReadingUpdate({ ...readingToForm(stored), value: '', estimateReason: '' })
    expect('problems' in r && r.problems.map((p) => p.field)).toEqual(['value', 'estimateReason'])
  })
})

describe('Rückfrage vor dem Speichern einer Ablesung', () => {
  const others: Reading[] = [
    { id: 'a', meterId: 'm1', date: '2024-12-31', value: 400 },
    { id: 'b', meterId: 'm1', date: '2025-12-31', value: 450.8 },
    { id: 'x', meterId: 'm2', date: '2026-01-31', value: 9000 },
  ]
  const ask = (c: { date: string; value: number; replacement?: boolean }, extra: { editingId?: string; list?: Reading[] } = {}) =>
    readingQuestion({ meterId: 'm1', replacement: false, ...c }, extra.list ?? others, { today: '2026-11-20', unit: 'm³', editingId: extra.editingId })

  test('ein plausibler Stand fragt nicht; Ablesungen anderer Zähler zählen nicht', () => {
    expect(ask({ date: '2026-06-30', value: 470 })).toBeNull()
    expect(ask({ date: '2026-11-20', value: 450.8 })).toBeNull()
    expect(readingQuestion({ meterId: 'm3', date: '2026-06-30', value: 5, replacement: false }, others, { today: '2026-11-20' })).toBeNull()
  })

  test('Stand unter dem vorigen Stand: Rückfrage mit beiden Ständen, beim Zählerwechsel nicht', () => {
    expect(ask({ date: '2026-06-30', value: 12.5 })).toEqual({
      title: 'Ablesung trotzdem anlegen?',
      message: 'Der Stand 12,5 m³ liegt unter dem vorigen Stand 450,8 m³ vom 31.12.2025; der Verbrauch dazwischen wäre negativ. Wurde der Zähler getauscht, haken Sie „Zählerwechsel“ an.',
      confirmLabel: 'Trotzdem anlegen',
    })
    expect(ask({ date: '2026-06-30', value: 12.5, replacement: true })).toBeNull()
  })

  test('verglichen wird mit dem Stand unmittelbar davor, nicht mit dem jüngsten', () => {
    // Nachgetragen zwischen 400 und 450,8: 420 ist plausibel, 399 nicht.
    expect(ask({ date: '2025-06-30', value: 420 })).toBeNull()
    expect(ask({ date: '2025-06-30', value: 399 })?.message).toMatch(/unter dem vorigen Stand 400 m³ vom 31\.12\.2024/)
  })

  test('Stand über dem folgenden Stand: Rückfrage, außer dort wurde der Zähler gewechselt', () => {
    expect(ask({ date: '2025-06-30', value: 4508 })?.message).toBe('Der Stand 4.508 m³ liegt über dem folgenden Stand 450,8 m³ vom 31.12.2025; der Verbrauch dazwischen wäre negativ.')
    const swapped: Reading[] = [{ id: 'a', meterId: 'm1', date: '2024-12-31', value: 400 }, { id: 'b', meterId: 'm1', date: '2025-12-31', value: 3, replacement: true, oldEndValue: 460 }]
    expect(ask({ date: '2025-06-30', value: 430 }, { list: swapped })).toBeNull()
  })

  test('Datum nach heute: Rückfrage; heute selbst nicht', () => {
    expect(ask({ date: '2052-12-31', value: 500 })?.message).toBe('Das Datum 31.12.2052 liegt in der Zukunft.')
    expect(ask({ date: '2026-11-20', value: 500 })).toBeNull()
  })

  test('beides zusammen steht in einer Rückfrage', () => {
    expect(ask({ date: '2052-12-31', value: 12.5 })?.message).toMatch(/^Das Datum 31\.12\.2052 liegt in der Zukunft\. Der Stand 12,5 m³ liegt unter dem vorigen Stand 450,8 m³/)
  })

  test('beim Bearbeiten zählt die Ablesung selbst nicht als voriger Stand, und das Verb ist „speichern“', () => {
    expect(ask({ date: '2025-12-31', value: 440 }, { editingId: 'b' })).toBeNull()
    expect(ask({ date: '2025-12-31', value: 399 }, { editingId: 'b' })).toMatchObject({ title: 'Ablesung trotzdem speichern?', confirmLabel: 'Trotzdem speichern' })
  })
})

test('eine neue Ablesung ist mit dem heutigen Datum vorbelegt, sonst leer', () => {
  expect(newReadingForm('2026-11-20')).toEqual({ ...EMPTY_READING, date: '2026-11-20' })
})

// Entwurf, Speichern, Verwerfen (#309): die Logik hinter useDraft ohne React.
import { describe, expect, test } from 'vitest'
import { afterSave, discarded, initialDraft, isDirty, sameDraft, shownValue, withEdit, withSaved } from './draft'

describe('sameDraft', () => {
  test('Werte, Listen und einfache Objekte Stück für Stück', () => {
    expect(sameDraft('2025-01-12', '2025-01-12')).toBe(true)
    expect(sameDraft('', null)).toBe(false)
    expect(sameDraft(0, -0)).toBe(false)
    expect(sameDraft(Number.NaN, Number.NaN)).toBe(true)
    expect(sameDraft([1, { a: 'x' }], [1, { a: 'x' }])).toBe(true)
    expect(sameDraft([1, 2], [2, 1])).toBe(false)
    expect(sameDraft({ a: 1, b: { c: [true] } }, { b: { c: [true] }, a: 1 })).toBe(true)
    expect(sameDraft({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameDraft([], {})).toBe(false)
  })

  test('ein fehlender Schlüssel gleicht einem mit undefined, nicht einem mit null', () => {
    expect(sameDraft({ a: 1 }, { a: 1, b: undefined })).toBe(true)
    expect(sameDraft({ a: 1 }, { a: 1, b: null })).toBe(false)
  })
})

describe('Entwurf', () => {
  test('ohne Eingabe zeigt er den gespeicherten Wert und ist nicht geändert', () => {
    const s = initialDraft('2025-01-12')
    expect(shownValue(s)).toBe('2025-01-12')
    expect(isDirty(s)).toBe(false)
  })

  test('eine Eingabe ist ein Entwurf; zurück zum gespeicherten Wert ist keiner mehr', () => {
    const s = withEdit(initialDraft('2025-01-12'), '2025-01-15')
    expect(shownValue(s)).toBe('2025-01-15')
    expect(isDirty(s)).toBe(true)
    expect(isDirty(withEdit(s, '2025-01-12'))).toBe(false)
  })

  test('Verwerfen stellt den gespeicherten Wert her', () => {
    const s = discarded(withEdit(initialDraft({ on: true }), { on: false }))
    expect(shownValue(s)).toEqual({ on: true })
    expect(isDirty(s)).toBe(false)
  })

  test('neuer Stand von außen ohne Entwurf: das Feld zeigt ihn', () => {
    const s = withSaved(initialDraft('a'), 'b')
    expect(shownValue(s)).toBe('b')
    expect(isDirty(s)).toBe(false)
  })

  test('neuer Stand von außen mit Entwurf: der Entwurf bleibt, gleicht er dem Stand, ist er erledigt', () => {
    const editing = withEdit(initialDraft('a'), 'c')
    const other = withSaved(editing, 'b')
    expect(shownValue(other)).toBe('c')
    expect(isDirty(other)).toBe(true)
    // Verwerfen führt jetzt zum neuen Stand, nicht zum alten.
    expect(shownValue(discarded(other))).toBe('b')
    expect(isDirty(withSaved(editing, 'c'))).toBe(false)
  })

  test('derselbe Stand von außen ändert nichts, auch nicht als neues Objekt', () => {
    const s = withEdit(initialDraft({ a: [1] }), { a: [2] })
    expect(withSaved(s, { a: [1] })).toBe(s)
  })

  test('ein anderer Bereich (andere Abrechnung) verwirft den Entwurf', () => {
    const s = withEdit(initialDraft('a', 'abrechnung-2024'), 'c')
    const next = withSaved(s, 'a', 'abrechnung-2025')
    expect(isDirty(next)).toBe(false)
    expect(shownValue(next)).toBe('a')
  })

  test('nach dem Speichern zeigt das Feld den gespeicherten Wert, auch bevor die Seite neu lädt', () => {
    const s = withEdit(initialDraft(''), '2025-01-15')
    const saved = afterSave(s, '2025-01-15', '')
    expect(shownValue(saved)).toBe('2025-01-15')
    expect(isDirty(saved)).toBe(false)
    // Lädt die Seite danach, übernimmt sie ihren Stand.
    expect(shownValue(withSaved(saved, '2025-01-15'))).toBe('2025-01-15')
  })

  test('hat die Seite beim Speichern schon neu geladen, gilt ihr Stand (der Server kann geradegerückt haben)', () => {
    const s = withSaved(withEdit(initialDraft(''), ' 2025-01-15'), '2025-01-15')
    const saved = afterSave(s, ' 2025-01-15', '')
    expect(shownValue(saved)).toBe('2025-01-15')
    expect(isDirty(saved)).toBe(false)
  })

  test('eine Änderung während des Speicherns bleibt ein Entwurf', () => {
    const during = withEdit(withEdit(initialDraft(''), '2025-01-15'), '2025-01-16')
    const saved = afterSave(during, '2025-01-15', '')
    expect(isDirty(saved)).toBe(true)
    expect(shownValue(saved)).toBe('2025-01-16')
    expect(shownValue(discarded(saved))).toBe('2025-01-15')
  })
})

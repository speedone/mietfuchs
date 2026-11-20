import { expect, test } from 'vitest'
import { ApiError, fmtEuro } from './api'
import { changedFields, ifUnchanged, isStale, staleText, type StaleFields } from './staleRecord'

const FIELDS: StaleFields = {
  amountCents: { label: 'Betrag', now: (v) => (typeof v === 'number' ? fmtEuro(v) : null) },
  description: 'Beschreibung',
}
const seen = { id: 'c1', description: 'Versicherung', amountCents: 138000, key: 'area', year: 2025 }
const stale = (current: unknown) => new ApiError('Die Kostenposition „Versicherung“ wurde inzwischen an anderer Stelle geändert. Gespeichert wurde nichts.', 409, { stale: true, current })

test('ifUnchanged: der Stand vom Öffnen geht mit, ohne ihn nichts', () => {
  expect(ifUnchanged(seen)).toEqual({ ifUnchanged: seen })
  expect(ifUnchanged(undefined)).toEqual({})
  expect(ifUnchanged(null)).toEqual({})
})

test('changedFields: nennt die geänderten Angaben mit dem Wert von jetzt, den Rest als „weitere Angaben“', () => {
  expect(changedFields(seen, { ...seen, amountCents: 150000 }, FIELDS)).toEqual([`Betrag (jetzt ${fmtEuro(150000)})`])
  expect(changedFields(seen, { ...seen, description: 'Neu', key: 'units' }, FIELDS)).toEqual(['Beschreibung', 'weitere Angaben'])
  // Fehlend und `null` sind dasselbe, und was nur die Liste dazusetzt, zählt nicht.
  const { year: _year, ...stored } = seen
  expect(changedFields(seen, { ...stored, vendor: null }, FIELDS)).toEqual([])
  expect(changedFields(undefined, seen, FIELDS)).toEqual([])
})

test('staleText: Satz des Servers, was sich geändert hat, und dass die Eingabe bleibt; sonst null', () => {
  const text = staleText(stale({ ...seen, amountCents: 150000 }), seen, FIELDS)
  expect(text).toContain('wurde inzwischen an anderer Stelle geändert')
  expect(text).toContain(`Inzwischen geändert: Betrag (jetzt ${fmtEuro(150000)}).`)
  expect(text).toContain('Ihre Eingabe bleibt stehen')
  expect(staleText(stale(undefined), seen, FIELDS)).not.toContain('Inzwischen geändert')
  expect(staleText(new ApiError('Rückfrage', 409, { question: 'paidOn' }), seen, FIELDS)).toBeNull()
  expect(staleText(new Error('Netz weg'), seen, FIELDS)).toBeNull()
  expect(isStale(stale(seen))).toBe(true)
})

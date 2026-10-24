import { expect, test } from 'vitest'
import { EMPTY_FILTER, filterActive, journalQuery, KIND_OPTIONS, revertActions, revertQuestion, type RevertPreview } from './journalRevert'
import { JOURNAL_KINDS } from '../../shared/journal.ts'

const preview = (over: Partial<RevertPreview> = {}): RevertPreview => ({
  kind: 'journal', mode: 'including', entry: { id: 9, firstId: 9, at: '2026-10-24T08:15:00.000Z', title: 'Zahlung angelegt' }, startId: 9,
  entries: [{ id: 9, at: '2026-10-24T08:15:00.000Z', title: 'Zahlung angelegt', rows: 1, reverted: false }], changes: 1, refusals: [],
  files: { restore: 0, trash: 0 }, notes: ['Zustimmungen bleiben.'], token: 't', ...over,
})

test('Abfrage: ohne Filter nur Objekt und Seite, mit Filter jede Angabe, „bis“ schließt den Tag ein', () => {
  expect(journalQuery(EMPTY_FILTER, 'objekt-1', null, 50)).toBe('/api/journal?limit=50&property=objekt-1')
  expect(journalQuery({ ...EMPTY_FILTER, scope: 'all' }, 'objekt-1', 12, 50)).toBe('/api/journal?limit=50&before=12')
  const q = new URL(`http://x${journalQuery({ scope: 'property', kind: 'heating', from: '2026-03-01', to: '2026-03-31', q: ' Öl ' }, 'o', null, 50)}`).searchParams
  expect(q.get('kind')).toBe('heating')
  expect(q.get('q')).toBe('Öl')
  const from = new Date(q.get('from') ?? '')
  const to = new Date(q.get('to') ?? '')
  expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()]).toEqual([2026, 2, 1, 0])
  expect([to.getFullYear(), to.getMonth(), to.getDate(), to.getHours()]).toEqual([2026, 3, 1, 0])
  // Ein unvollständiges Datum geht nicht hinaus.
  expect(journalQuery({ ...EMPTY_FILTER, from: '2026-1' }, null, null, 50)).toBe('/api/journal?limit=50')
  expect(filterActive(EMPTY_FILTER)).toBe(false)
  expect(filterActive({ ...EMPTY_FILTER, q: '  ' })).toBe(false)
  expect(filterActive({ ...EMPTY_FILTER, kind: 'costs' })).toBe(true)
})

test('Bereiche: jede Art des Servers steht zur Wahl, dazu „alle“', () => {
  expect(KIND_OPTIONS.map((o) => o.value)).toEqual(['', ...JOURNAL_KINDS])
})

test('Rückfrage: ein Eintrag heißt „rückgängig machen“, mehrere „zurückkehren“ mit Liste', () => {
  const one = revertQuestion(preview())
  expect([one.title, one.confirmLabel, one.entries]).toEqual(['„Zahlung angelegt“ rückgängig machen?', 'Rückgängig machen', []])
  const many = revertQuestion(preview({ mode: 'after', entries: [preview().entries[0], { id: 10, at: '2026-10-24T09:00:00.000Z', title: 'Zahlung geändert', rows: 2, reverted: false }], changes: 3, files: { restore: 0, trash: 2 } }))
  expect(many.title).toMatch(/^Zum Stand nach „Zahlung angelegt“ \(.+ Uhr\) zurückkehren\?$/)
  expect(many.intro).toBe('Zurückgenommen werden 2 Einträge mit zusammen 3 Änderungen, die neueste zuerst:')
  expect(many.entries).toHaveLength(2)
  expect(many.notes[0]).toBe('2 Belege oder Logos wandern in den Papierkorb.')
  expect(many.notes).toContain('Zustimmungen bleiben.')
  expect(many.confirmLabel).toBe('Zurückkehren')
  expect(revertQuestion(preview({ entries: [...preview().entries, ...preview().entries] })).title).toMatch(/^Zum Stand vor/)
})

test('Rücksprünge: keiner bei Schranke oder nur lesbar, am obersten nur der Stand davor', () => {
  expect(revertActions({ readOnly: false, barrier: null }, true)).toEqual(['including'])
  expect(revertActions({ readOnly: false, barrier: null }, false)).toEqual(['including', 'after'])
  expect(revertActions({ readOnly: true, barrier: null }, false)).toEqual([])
  expect(revertActions({ readOnly: true, barrier: 'restore' }, true)).toEqual([])
})

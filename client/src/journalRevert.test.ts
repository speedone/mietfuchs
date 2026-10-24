import { expect, test } from 'vitest'
import {
  EMPTY_FILTER, fileSize, filterActive, isSnapshot, journalQuery, KIND_OPTIONS, revertActions, revertQuestion, snapshotQuestion, snapshotWhen,
  type RevertPreview, type SnapshotPreview,
} from './journalRevert'
import { JOURNAL_KINDS } from '../../shared/journal.ts'

const preview = (over: Partial<RevertPreview> = {}): RevertPreview => ({
  kind: 'journal', mode: 'including', entry: { id: 9, firstId: 9, at: '2026-10-24T08:15:00.000Z', title: 'Zahlung angelegt' }, startId: 9,
  entries: [{ id: 9, at: '2026-10-24T08:15:00.000Z', title: 'Zahlung angelegt', rows: 1, reverted: false }], changes: 1, refusals: [],
  files: { restore: 0, trash: 0 }, notes: ['Zustimmungen bleiben.'], frozen: [], token: 't', ...over,
})

test('Abfrage: ohne Filter nur Objekt und Seite, mit Filter jede Angabe, „bis“ schließt den Tag ein', () => {
  expect(journalQuery(EMPTY_FILTER, 'objekt-1', null, 50)).toBe('/api/journal?limit=50&snapshots=1&property=objekt-1')
  expect(journalQuery({ ...EMPTY_FILTER, scope: 'all' }, 'objekt-1', 12, 50)).toBe('/api/journal?limit=50&snapshots=1&before=12')
  const q = new URL(`http://x${journalQuery({ scope: 'property', kind: 'heating', from: '2026-03-01', to: '2026-03-31', q: ' Öl ' }, 'o', null, 50)}`).searchParams
  expect(q.get('kind')).toBe('heating')
  expect(q.get('q')).toBe('Öl')
  const from = new Date(q.get('from') ?? '')
  const to = new Date(q.get('to') ?? '')
  expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()]).toEqual([2026, 2, 1, 0])
  expect([to.getFullYear(), to.getMonth(), to.getDate(), to.getHours()]).toEqual([2026, 3, 1, 0])
  // Ein unvollständiges Datum geht nicht hinaus.
  expect(journalQuery({ ...EMPTY_FILTER, from: '2026-1' }, null, null, 50)).toBe('/api/journal?limit=50&snapshots=1')
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
  // Seit den Sicherungspunkten (#318) bietet auch ein nur lesbarer Eintrag den Rücksprung an: Die Vorschau entscheidet,
  // ob er über eine Sicherung geht oder nicht.
  expect(revertActions({ readOnly: true, barrier: null }, false)).toEqual(['including', 'after'])
  expect(revertActions({ readOnly: true, barrier: 'restore' }, true)).toEqual([])
})

const snapshot = (over: Partial<SnapshotPreview> = {}): SnapshotPreview => ({
  kind: 'snapshot',
  snapshot: { kind: 'snapshot', name: 'mietfuchs.sqlite.vor-restore', type: 'restore', at: '2026-10-20T08:15:00.000Z', timeFrom: 'file', size: 10, version: null, title: 'Vor dem Einspielen eines Backups' },
  entry: null, mode: null, reasons: [], later: 1, missing: [], fromTrash: 0, consents: ['Zustimmungen bleiben.'], notes: [], refusals: [], frozen: [], token: 't', ...over,
})

test('Rückfrage zu einer Sicherung: ersetzt wird alles danach, die aktuelle wird vorher gesichert', () => {
  const q = snapshotQuestion(snapshot())
  expect(q.title).toMatch(/^Zum Stand „Vor dem Einspielen eines Backups“ vom 20\.10\.2026, .+ Uhr \(laut Datei\) zurückkehren\?$/)
  expect(q.confirmLabel).toBe('Zurückkehren')
  expect(q.lines[0]).toBe('Alles, was danach kam, wird durch diesen Stand ersetzt: ein Eintrag im Verlauf seit diesem Zeitpunkt.')
  expect(q.lines.some((l) => /vorher als mietfuchs\.sqlite\.vor-restore/.test(l))).toBe(true)
  expect(q.lines).toContain('Zustimmungen bleiben.')
  expect(q.lines.at(-1)).toMatch(/lädt Mietfuchs die Seite neu/)
  const more = snapshotQuestion(snapshot({ later: 0, missing: ['a.pdf', 'b.pdf'], fromTrash: 2 }))
  expect(more.lines[0]).toBe('Alles, was danach kam, wird durch diesen Stand ersetzt.')
  expect(more.lines).toContain('2 Belege oder Logos, auf die dieser Stand verweist, fehlen danach: a.pdf, b.pdf.')
  expect(more.lines).toContain('2 Belege oder Logos kommen aus dem Papierkorb zurück.')
  // Vom Eintrag des Verlaufs aus: Titel nach dem Eintrag, und warum es nur über die Sicherung geht.
  const fromEntry = snapshotQuestion(snapshot({ entry: { id: 4, firstId: 4, at: '2026-10-01T10:00:00.000Z', title: 'Wohnung angelegt: EG' }, mode: 'including', reasons: ['Grund.'] }))
  expect(fromEntry.title).toMatch(/^Zum Stand vor „Wohnung angelegt: EG“ \(.+\) zurückkehren\?$/)
  expect(fromEntry.lines[0]).toMatch(/^Schritt für Schritt geht das nicht, nur über die Sicherung „Vor dem Einspielen eines Backups“ vom /)
  expect(fromEntry.lines[1]).toBe('Grund.')
})

// Durchsicht von PR #442, K1: Lässt sich nicht sicher zählen (Zeitpunkt aus der Datei, Gruppe nicht im Verlauf),
// nennt die Rückfrage keine Zahl.
test('Rückfrage zu einer Sicherung ohne sichere Zählung nennt keine Zahl', () => {
  const q = snapshotQuestion(snapshot({ later: null }))
  expect(q.lines[0]).toBe('Alles, was nach dieser Sicherung kam, wird durch ihren Stand ersetzt; wie viele Einträge das sind, lässt sich nicht sicher sagen.')
})

test('Sicherungen: Größe und Zeitpunkt, Abfrage mit snapshots=1', () => {
  expect(fileSize(2 * 1024 * 1024)).toBe('2,0 MB')
  expect(fileSize(512 * 1024)).toBe('512 KB')
  expect(fileSize(10)).toBe('1 KB')
  expect(snapshotWhen(snapshot().snapshot)).toMatch(/^20\.10\.2026, .+ Uhr \(laut Datei\)$/)
  expect(isSnapshot(snapshot().snapshot)).toBe(true)
  expect(new URL(`http://x${journalQuery(EMPTY_FILTER, null, null, 50)}`).searchParams.get('snapshots')).toBe('1')
})

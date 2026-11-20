import { expect, test } from 'vitest'
import { ageText, backupReminderText, calendarDaysSince, lastBackupLine, recheckUntilChanged } from './backupView'

// Ortszeit, wie die Oberfläche das Datum bildet
const local = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min)

test('Alter in Worten', () => {
  expect(ageText(0)).toBe('heute')
  expect(ageText(1)).toBe('gestern')
  expect(ageText(45)).toBe('vor 45 Tagen')
})

test('Alter in Kalendertagen des Ortes, nicht in vollen 24 Stunden', () => {
  // gestern 23:00, heute 09:00: zehn Stunden, aber ein Kalendertag
  expect(calendarDaysSince(local(2026, 11, 19, 23).toISOString(), local(2026, 11, 20, 9))).toBe(1)
  // heute 00:05 und heute 23:55
  expect(calendarDaysSince(local(2026, 11, 20, 0, 5).toISOString(), local(2026, 11, 20, 23, 55))).toBe(0)
  // gestern 00:05, heute 23:55: fast 48 Stunden, aber gestern
  expect(calendarDaysSince(local(2026, 11, 19, 0, 5).toISOString(), local(2026, 11, 20, 23, 55))).toBe(1)
  // über die Zeitumstellung (25.10.2026) und den Monatswechsel
  expect(calendarDaysSince(local(2026, 10, 24, 23).toISOString(), local(2026, 10, 26, 1))).toBe(2)
  expect(calendarDaysSince(local(2026, 10, 31, 23).toISOString(), local(2026, 11, 1, 1))).toBe(1)
  // eine Uhr, die nachgeht, ergibt nie ein negatives Alter
  expect(calendarDaysSince(local(2026, 11, 21, 9).toISOString(), local(2026, 11, 20, 9))).toBe(0)
})

test('Zeile in den Einstellungen: Datum und Alter passen zueinander, ehrlich „heruntergeladen“', () => {
  expect(lastBackupLine({ lastDownloadAt: null, reminder: 'never' }, local(2026, 11, 20))).toBe('Von diesem Rechner wurde bisher kein Backup heruntergeladen.')
  const late = lastBackupLine({ lastDownloadAt: local(2026, 11, 19, 23).toISOString(), reminder: null }, local(2026, 11, 20, 9))
  expect(late).toBe('Backup zuletzt heruntergeladen am 19.11.2026 (gestern).')
  const line = lastBackupLine({ lastDownloadAt: local(2026, 11, 17).toISOString(), reminder: null }, local(2026, 11, 20))
  expect(line).toBe('Backup zuletzt heruntergeladen am 17.11.2026 (vor 3 Tagen).')
  expect(line).not.toMatch(/gesichert|gespeichert/)
})

test('Erinnerung: je Anlass ein Titel, ohne Anlass nichts', () => {
  const now = local(2026, 11, 20)
  expect(backupReminderText({ lastDownloadAt: local(2026, 11, 17).toISOString(), reminder: null }, now)).toBeNull()
  expect(backupReminderText({ lastDownloadAt: null, reminder: 'never' }, now)?.title).toBe('Noch kein Backup heruntergeladen')
  expect(backupReminderText({ lastDownloadAt: local(2026, 10, 1).toISOString(), reminder: 'old' }, now)?.title).toBe('Das letzte Backup wurde vor 50 Tagen heruntergeladen')
  const closed = backupReminderText({ lastDownloadAt: local(2026, 11, 17).toISOString(), reminder: 'closed' }, now)
  expect(closed?.title).toBe('Seit dem letzten Backup wurde eine Abrechnung abgeschlossen')
  expect(closed?.text).toMatch(/nicht auf diesem Rechner/)
})

test('nach dem Klick fragt die Karte in wachsendem Abstand nach, bis sich der Zeitpunkt ändert, höchstens rund zwei Minuten', async () => {
  const waited: number[] = []
  const wait = async (ms: number) => { waited.push(ms) }
  // ändert sich beim dritten Nachfragen
  let asked = 0
  const changed = await recheckUntilChanged(async () => { asked++; return { lastDownloadAt: asked >= 3 ? 'neu' : 'alt', reminder: null } }, 'alt', { wait })
  expect(changed?.lastDownloadAt).toBe('neu')
  expect(asked).toBe(3)
  expect(waited.length).toBe(3)
  // ändert sich nie: Schluss nach der letzten Wartezeit, Abstände wachsen
  waited.length = 0
  asked = 0
  expect(await recheckUntilChanged(async () => { asked++; return { lastDownloadAt: null, reminder: 'never' } }, null, { wait })).toBeNull()
  expect(asked).toBe(waited.length)
  expect(waited).toEqual([...waited].sort((a, b) => a - b))
  const total = waited.reduce((sum, ms) => sum + ms, 0)
  expect(total).toBeGreaterThanOrEqual(90_000)
  expect(total).toBeLessThanOrEqual(130_000)
  // ein Lesefehler beendet das Nachfragen nicht, und `stopped` beendet es sofort
  asked = 0
  const afterError = await recheckUntilChanged(async () => { asked++; if (asked === 1) throw new Error('Netz'); return { lastDownloadAt: 'neu', reminder: null } }, null, { wait })
  expect(afterError?.lastDownloadAt).toBe('neu')
  asked = 0
  expect(await recheckUntilChanged(async () => { asked++; return null }, null, { wait, stopped: () => true })).toBeNull()
  expect(asked).toBe(0)
})

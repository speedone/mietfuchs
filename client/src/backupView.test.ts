import { expect, test } from 'vitest'
import { ageText, backupReminderText, lastBackupLine } from './backupView'

test('Alter in Worten', () => {
  expect(ageText(0)).toBe('heute')
  expect(ageText(1)).toBe('gestern')
  expect(ageText(45)).toBe('vor 45 Tagen')
})

test('Zeile in den Einstellungen: ehrlich „heruntergeladen“, mit Datum und Alter', () => {
  expect(lastBackupLine({ lastDownloadAt: null, ageDays: null, reminder: 'never' })).toBe('Von diesem Rechner wurde bisher kein Backup heruntergeladen.')
  const line = lastBackupLine({ lastDownloadAt: '2026-11-17T12:00:00.000Z', ageDays: 3, reminder: null })
  expect(line).toBe('Backup zuletzt heruntergeladen am 17.11.2026 (vor 3 Tagen).')
  expect(line).not.toMatch(/gesichert|gespeichert/)
})

test('Erinnerung: je Anlass ein Titel, ohne Anlass nichts', () => {
  expect(backupReminderText({ lastDownloadAt: '2026-11-17T12:00:00.000Z', ageDays: 3, reminder: null })).toBeNull()
  expect(backupReminderText({ lastDownloadAt: null, ageDays: null, reminder: 'never' })?.title).toBe('Noch kein Backup heruntergeladen')
  expect(backupReminderText({ lastDownloadAt: '2026-10-01T12:00:00.000Z', ageDays: 50, reminder: 'old' })?.title).toBe('Das letzte Backup wurde vor 50 Tagen heruntergeladen')
  const closed = backupReminderText({ lastDownloadAt: '2026-11-17T12:00:00.000Z', ageDays: 3, reminder: 'closed' })
  expect(closed?.title).toBe('Seit dem letzten Backup wurde eine Abrechnung abgeschlossen')
  expect(closed?.text).toMatch(/nicht auf diesem Rechner/)
})

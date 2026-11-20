// Wann zuletzt ein Backup heruntergeladen wurde, und ob das Cockpit daran erinnert.
//
// **Der Zeitpunkt steht bewusst nicht in der Datenbank**, sondern in `letztes-backup.json` im Datenordner: Ein
// eingespieltes Backup brächte sonst seinen eigenen, alten Zeitpunkt mit (es entstand ja vor dem Download), und eine
// Vorversion ebenso. Aus demselben Grund geht die Datei nicht ins Backup und nicht in den Umzug; auf einem neuen
// Rechner gibt es noch kein Backup dieses Bestands von dort.
//
// Geschrieben wird wie secrets.json und zugang.json über Zwischendatei und Umbenennen. **Ein Fehler verhindert nie
// den Download**, er steht nur auf der Konsole; im schreibgeschützten und im umgezogenen Ordner wird gar nicht
// geschrieben, dann gilt der Zeitpunkt nur, solange der Server läuft.
//
// Gemerkt wird, wann das Archiv vollständig **gesendet** wurde. Ob der Browser es gespeichert hat und wohin, weiß der
// Server nicht; die Oberfläche sagt deshalb „zuletzt heruntergeladen“, nicht „gesichert“.
import fs from 'node:fs'
import path from 'node:path'
import type { BackupReminder, BackupStatus } from '../../shared/types.ts'
import { writable } from './paths.ts'

export const BACKUP_MARK_FILE = 'letztes-backup.json'
// Nach so vielen Tagen ohne Backup erinnert das Cockpit. Eine feste Spanne, keine Einstellung: Wer monatlich Zahlungen
// einträgt, verliert bei einem Plattenschaden höchstens einen Monat Arbeit.
export const BACKUP_REMINDER_DAYS = 30
const DAY_MS = 86_400_000

const timeOf = (iso: string | null): number | null => {
  if (iso === null) return null
  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : time
}

// Die Regel für sich, ohne Uhr und ohne Platte. `latestClosedAt` ist der jüngste Abschluss einer Abrechnung oder
// Heizkostenabrechnung: Ein abgeschlossener Stand ist das, was der Vermieter am wenigsten neu erfassen kann.
export function backupReminder({ hasStock, lastAt, latestClosedAt, now }: { hasStock: boolean, lastAt: string | null, latestClosedAt: string | null, now: Date }): BackupReminder | null {
  if (!hasStock) return null
  const last = timeOf(lastAt)
  if (last === null) return 'never'
  const closed = timeOf(latestClosedAt)
  if (closed !== null && closed > last) return 'closed'
  return now.getTime() - last > BACKUP_REMINDER_DAYS * DAY_MS ? 'old' : null
}

export function backupStatus(input: { hasStock: boolean, lastAt: string | null, latestClosedAt: string | null, now: Date }): BackupStatus {
  const last = timeOf(input.lastAt)
  return {
    lastDownloadAt: last === null ? null : new Date(last).toISOString(),
    ageDays: last === null ? null : Math.max(0, Math.floor((input.now.getTime() - last) / DAY_MS)),
    reminder: backupReminder(input),
  }
}

// Der gemerkte Zeitpunkt: der aus der Datei oder, wenn sie sich nicht schreiben ließ, der dieses Laufs; der jüngere gilt.
export function createBackupMark(dataDir: string) {
  const file = path.join(dataDir, BACKUP_MARK_FILE)
  let inMemory: string | null = null

  const stored = (): string | null => {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (typeof raw !== 'object' || raw === null || !('at' in raw) || typeof raw.at !== 'string') return null
      return timeOf(raw.at) === null ? null : raw.at
    } catch {
      // Fehlt die Datei oder ist sie verdorben, gibt es eben keinen Zeitpunkt.
      return null
    }
  }

  return {
    read(): string | null {
      const fromFile = stored()
      if (inMemory === null) return fromFile
      return fromFile !== null && Date.parse(fromFile) > Date.parse(inMemory) ? fromFile : inMemory
    },
    // `persist: false` im umgezogenen Ordner: Dort schreibt Mietfuchs nichts mehr. Wirft nie.
    record(at: Date, { persist }: { persist: boolean }): void {
      const iso = at.toISOString()
      // Nur wo nicht geschrieben wird, gilt der Zeitpunkt dieses Laufs; sonst ist die Datei die eine Quelle.
      inMemory = iso
      if (!persist || !writable(dataDir)) return
      const tmp = `${file}.tmp`
      try {
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, at: iso }, null, 2), 'utf8')
        fs.renameSync(tmp, file)
        inMemory = null
      } catch (err) {
        fs.rmSync(tmp, { force: true })
        console.error(`Der Zeitpunkt des Backups ließ sich nicht merken (${file}): ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}

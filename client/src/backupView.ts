// Texte zur Datensicherung: die Zeile „zuletzt heruntergeladen“ in den Einstellungen und die Erinnerung im Cockpit.
// Ob erinnert wird, entscheidet der Server (`GET /api/backup/status`, server/src/backupMark.ts); hier steht nur der
// Wortlaut, ohne Seite prüfbar. **„Heruntergeladen“, nie „gesichert“**: Der Server weiß nur, dass er das Archiv ganz
// gesendet hat, nicht, ob und wo der Browser es gespeichert hat.
import type { BackupStatus } from './types'

// Die Antwort des Servers, nur wenn sie die erwartete Gestalt hat (eine ältere Fassung kennt die Route nicht).
export function asBackupStatus(value: unknown): BackupStatus | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Partial<BackupStatus>
  const lastOk = v.lastDownloadAt === null || (typeof v.lastDownloadAt === 'string' && !Number.isNaN(Date.parse(v.lastDownloadAt)))
  const reminderOk = v.reminder === null || v.reminder === 'never' || v.reminder === 'old' || v.reminder === 'closed'
  return lastOk && reminderOk ? { lastDownloadAt: v.lastDownloadAt ?? null, reminder: v.reminder ?? null } : null
}

const dateOf = (iso: string): string => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

// **Das Alter zählt Kalendertage des Ortes, an dem auch das Datum gebildet wird**, nicht volle 24 Stunden: Ein Backup
// von gestern 23 Uhr ist heute um 9 Uhr „gestern“, passend zum gezeigten Datum. Gerechnet über die Mitternacht beider
// Tage in UTC-Zählung ihrer Ortsdaten, damit die Zeitumstellung (ein Tag mit 23 oder 25 Stunden) nichts verschiebt.
export function calendarDaysSince(iso: string, now: Date): number {
  const then = new Date(iso)
  const day = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.max(0, Math.round((day(now) - day(then)) / 86_400_000))
}

export function ageText(days: number): string {
  if (days <= 0) return 'heute'
  if (days === 1) return 'gestern'
  return `vor ${days} Tagen`
}

// Die Zeile in der Karte „Daten & Sicherung“
export function lastBackupLine(status: BackupStatus, now: Date = new Date()): string {
  if (status.lastDownloadAt === null) return 'Von diesem Rechner wurde bisher kein Backup heruntergeladen.'
  return `Backup zuletzt heruntergeladen am ${dateOf(status.lastDownloadAt)} (${ageText(calendarDaysSince(status.lastDownloadAt, now))}).`
}

export type BackupReminderText = { title: string, text: string }
const KEEP_ELSEWHERE = 'Laden Sie ein Backup herunter und bewahren Sie es nicht auf diesem Rechner auf, etwa auf einem USB-Stick oder einer externen Festplatte.'

export function backupReminderText(status: BackupStatus, now: Date = new Date()): BackupReminderText | null {
  switch (status.reminder) {
    case null:
      return null
    case 'never':
      return { title: 'Noch kein Backup heruntergeladen', text: `Ihre Daten liegen nur auf diesem Rechner; geht er kaputt oder verloren, sind sie weg. ${KEEP_ELSEWHERE}` }
    case 'closed':
      return { title: 'Seit dem letzten Backup wurde eine Abrechnung abgeschlossen', text: `Der abgeschlossene Stand steht noch in keinem Backup. ${KEEP_ELSEWHERE}` }
    case 'old':
      return {
        title: status.lastDownloadAt === null ? 'Das letzte Backup ist lange her' : `Das letzte Backup wurde ${ageText(calendarDaysSince(status.lastDownloadAt, now))} heruntergeladen`,
        text: `Was Sie seither erfasst haben, steht in keinem Backup. ${KEEP_ELSEWHERE}`,
      }
  }
}

// Nach dem Klick auf den Download: Wann das Archiv ganz gesendet ist, erfährt die Seite nicht, und ein großes braucht
// Minuten. Deshalb fragt sie in wachsendem Abstand nach, bis der Server einen anderen Zeitpunkt nennt als vorher,
// zusammen rund zwei Minuten; danach bleibt das Nachfragen beim Fokus des Fensters. Ein Lesefehler zählt wie „noch
// nicht“. `stopped`: die Seite ist weg oder ein neuer Klick hat übernommen.
export const BACKUP_RECHECK_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000, 60_000]
export async function recheckUntilChanged(
  ask: () => Promise<BackupStatus | null>,
  before: string | null,
  { wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }), stopped = () => false }: { wait?: (ms: number) => Promise<void>, stopped?: () => boolean } = {},
): Promise<BackupStatus | null> {
  for (const ms of BACKUP_RECHECK_MS) {
    if (stopped()) return null
    await wait(ms)
    if (stopped()) return null
    let status: BackupStatus | null = null
    try {
      status = await ask()
    } catch {
      // noch nicht
    }
    if (status && status.lastDownloadAt !== before) return status
  }
  return null
}

// Der Backup-Link lädt in einen unsichtbaren Rahmen (Einstellungen.tsx): Ein Download lädt dort kein Dokument, eine
// Ablehnung des Servers schon. Daraus der Satz für die Karte: der aus `#meldung` der Fehlerseite (`backupFailure` in
// server/src/index.ts), sonst `error` einer JSON-Antwort (etwa die abgelaufene Anmeldung), sonst der Text selbst. Leer
// heißt: nichts zu melden (der leere Rahmen beim Einhängen).
export function frameMessage(doc: Document | null): string {
  if (!doc?.body) return ''
  const marked = doc.getElementById('meldung')?.textContent?.trim()
  if (marked) return marked
  const text = doc.body.textContent?.trim() ?? ''
  if (!text) return ''
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') return parsed.error
  } catch {
    // kein JSON, dann der Text
  }
  return text.slice(0, 500)
}

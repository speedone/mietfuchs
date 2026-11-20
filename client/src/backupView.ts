// Texte zur Datensicherung: die Zeile „zuletzt heruntergeladen“ in den Einstellungen und die Erinnerung im Cockpit.
// Ob erinnert wird, entscheidet der Server (`GET /api/backup/status`, server/src/backupMark.ts); hier steht nur der
// Wortlaut, ohne Seite prüfbar. **„Heruntergeladen“, nie „gesichert“**: Der Server weiß nur, dass er das Archiv ganz
// gesendet hat, nicht, ob und wo der Browser es gespeichert hat.
import type { BackupStatus } from './types'

// Die Antwort des Servers, nur wenn sie die erwartete Gestalt hat (eine ältere Fassung kennt die Route nicht).
export function asBackupStatus(value: unknown): BackupStatus | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Partial<BackupStatus>
  const lastOk = v.lastDownloadAt === null || typeof v.lastDownloadAt === 'string'
  const ageOk = v.ageDays === null || typeof v.ageDays === 'number'
  const reminderOk = v.reminder === null || v.reminder === 'never' || v.reminder === 'old' || v.reminder === 'closed'
  return lastOk && ageOk && reminderOk ? { lastDownloadAt: v.lastDownloadAt ?? null, ageDays: v.ageDays ?? null, reminder: v.reminder ?? null } : null
}

const dateOf = (iso: string): string => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function ageText(days: number): string {
  if (days <= 0) return 'heute'
  if (days === 1) return 'gestern'
  return `vor ${days} Tagen`
}

// Die Zeile in der Karte „Daten & Sicherung“
export function lastBackupLine(status: BackupStatus): string {
  if (status.lastDownloadAt === null || status.ageDays === null) return 'Von diesem Rechner wurde bisher kein Backup heruntergeladen.'
  return `Backup zuletzt heruntergeladen am ${dateOf(status.lastDownloadAt)} (${ageText(status.ageDays)}).`
}

export type BackupReminderText = { title: string, text: string }
const KEEP_ELSEWHERE = 'Laden Sie ein Backup herunter und bewahren Sie es nicht auf diesem Rechner auf, etwa auf einem USB-Stick oder einer externen Festplatte.'

export function backupReminderText(status: BackupStatus): BackupReminderText | null {
  switch (status.reminder) {
    case null:
      return null
    case 'never':
      return { title: 'Noch kein Backup heruntergeladen', text: `Ihre Daten liegen nur auf diesem Rechner; geht er kaputt oder verloren, sind sie weg. ${KEEP_ELSEWHERE}` }
    case 'closed':
      return { title: 'Seit dem letzten Backup wurde eine Abrechnung abgeschlossen', text: `Der abgeschlossene Stand steht noch in keinem Backup. ${KEEP_ELSEWHERE}` }
    case 'old':
      return { title: `Das letzte Backup wurde ${ageText(status.ageDays ?? 0)} heruntergeladen`, text: `Was Sie seither erfasst haben, steht in keinem Backup. ${KEEP_ELSEWHERE}` }
  }
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

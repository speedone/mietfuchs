import { useEffect, useState } from 'react'
import { api } from '../api'
import { asBackupStatus, backupReminderText } from '../backupView'
import type { BackupStatus } from '../types'
import { NoticeBox } from './Notice'

// Die Erinnerung ans Backup im Cockpit: ein ruhiger Hinweis der Seite, kein Hinweis der Berechnung. Wann erinnert wird,
// entscheidet der Server (`GET /api/backup/status`); lässt sich der Stand nicht lesen, bleibt die Erinnerung aus.
export default function BackupReminder({ onOpen }: { onOpen: () => void }) {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  useEffect(() => {
    let current = true
    api<unknown>('/api/backup/status')
      .then((s) => { if (current) setStatus(asBackupStatus(s)) })
      .catch(() => {})
    return () => { current = false }
  }, [])
  const reminder = status && backupReminderText(status)
  if (!reminder) return null
  return <NoticeBox level="hint" className="no-print" title={reminder.title} action={reminder.text} fix={{ label: 'Zum Backup → Einstellungen', onClick: onOpen }} />
}

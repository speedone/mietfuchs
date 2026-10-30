// Filter und Rücksprung auf der Seite „Verlauf“ (#318, Schritt 4). Logik ohne DOM, geprüft in journalRevert.test.ts.
//
// Ein Rücksprung nimmt immer ein Ende des Verlaufs zurück (server/src/db/revert.ts): einen Eintrag und alles danach
// (Stand vor dem Eintrag) oder nur alles danach (Stand nach dem Eintrag). Am obersten Eintrag heißt das erste
// „Rückgängig“. Die Vorschau trägt `kind`: `journal` (Schritt für Schritt) oder `snapshot` (über eine Sicherung im
// Datenordner, server/src/db/snapshotPreview.ts). Den Weg entscheidet der Server.
import { JOURNAL_KINDS, type JournalKind } from '../../shared/journal.ts'
import { journalWhen, type JournalGroup } from './journalView'

export type { JournalKind }

export const JOURNAL_KIND_LABELS: Record<JournalKind, string> = {
  units: 'Wohnungen und Mietverhältnisse',
  costs: 'Kosten',
  meters: 'Zähler und Ablesungen',
  payments: 'Zahlungen',
  heating: 'Heizung',
  receipts: 'Belege',
  settlements: 'Abrechnung und Anschreiben',
  settings: 'Objekt und Einstellungen',
}
export const KIND_OPTIONS: { value: JournalKind | '', label: string }[] = [
  { value: '', label: 'Alle Bereiche' },
  ...JOURNAL_KINDS.map((k) => ({ value: k, label: JOURNAL_KIND_LABELS[k] })),
]

export type JournalFilter = {
  // `property`: nur das Objekt der Seitenleiste (und was alle Objekte betrifft); `all`: alle Objekte.
  scope: 'property' | 'all'
  kind: JournalKind | ''
  // Tage als JJJJ-MM-TT, wie <input type="date"> sie liefert; leer heißt offen.
  from: string
  to: string
  q: string
}
export const EMPTY_FILTER: JournalFilter = { scope: 'property', kind: '', from: '', to: '', q: '' }

export const filterActive = (f: JournalFilter): boolean => f.scope !== 'property' || f.kind !== '' || f.from !== '' || f.to !== '' || f.q.trim() !== ''

// Ein Tag in der Zeitzone des Browsers als Zeitpunkt; `to` schließt den ganzen Tag ein (der Server rechnet `to`
// ausschließlich).
function dayStart(day: string, plusDays = 0): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + plusDays)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function journalQuery(filter: JournalFilter, propertyId: string | null, before: number | null, limit: number): string {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  // Die Sicherungspunkte zeitlich einsortiert (#318); Bereich und Suche blendet der Server sie aus.
  params.set('snapshots', '1')
  if (before !== null) params.set('before', String(before))
  if (filter.scope === 'property' && propertyId) params.set('property', propertyId)
  if (filter.kind) params.set('kind', filter.kind)
  const from = dayStart(filter.from)
  const to = dayStart(filter.to, 1)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (filter.q.trim()) params.set('q', filter.q.trim())
  return `/api/journal?${params.toString()}`
}

export type RevertMode = 'including' | 'after'

export type RevertEntry = { id: number, at: string, title: string, rows: number, reverted: boolean }
export type RevertPreview = {
  kind: 'journal'
  mode: RevertMode
  entry: { id: number, firstId: number, at: string, title: string }
  startId: number
  entries: RevertEntry[]
  changes: number
  refusals: string[]
  files: { restore: number, trash: number }
  // Sätze des Servers, etwa dass Zustimmungen bleiben, wie sie sind.
  notes: string[]
  // Abrechnungen (Objekt, Jahr), deren Abschluss, Wiederöffnen oder Versanddatum im Bereich liegt.
  frozen: string[]
  token: string
}

const changes = (n: number) => (n === 1 ? 'eine Änderung' : `${n} Änderungen`)
const entriesText = (n: number) => (n === 1 ? 'ein Eintrag' : `${n} Einträge`)

export const SHOWN_ENTRIES = 8

export type RevertQuestion = { title: string, intro: string, entries: string[], more: number, notes: string[], confirmLabel: string }

// Was die Rückfrage sagt. „Stand vor“ und „Stand nach“ stehen im Titel; darunter, was zurückgenommen wird.
export function revertQuestion(preview: RevertPreview): RevertQuestion {
  const when = journalWhen(preview.entry.at)
  const single = preview.mode === 'including' && preview.entries.length === 1
  const title = single
    ? `„${preview.entry.title}“ rückgängig machen?`
    : preview.mode === 'including'
      ? `Zum Stand vor „${preview.entry.title}“ (${when}) zurückkehren?`
      : `Zum Stand nach „${preview.entry.title}“ (${when}) zurückkehren?`
  const intro = single
    ? `Zurückgenommen ${preview.changes === 1 ? 'wird' : 'werden'} ${changes(preview.changes)}.`
    : `Zurückgenommen ${preview.entries.length === 1 ? 'wird' : 'werden'} ${entriesText(preview.entries.length)} mit zusammen ${changes(preview.changes)}, die neueste zuerst:`
  const notes: string[] = []
  if (preview.files.restore > 0) notes.push(preview.files.restore === 1 ? 'Ein Beleg oder Logo kommt aus dem Papierkorb zurück.' : `${preview.files.restore} Belege oder Logos kommen aus dem Papierkorb zurück.`)
  if (preview.files.trash > 0) notes.push(preview.files.trash === 1 ? 'Ein Beleg oder Logo wandert in den Papierkorb.' : `${preview.files.trash} Belege oder Logos wandern in den Papierkorb.`)
  notes.push(...preview.notes)
  notes.push('Der Rücksprung steht danach selbst im Verlauf und lässt sich dort genauso zurücknehmen.')
  return {
    title,
    intro,
    entries: single ? [] : preview.entries.slice(0, SHOWN_ENTRIES).map((e) => `${journalWhen(e.at)} · ${e.title}${e.reverted ? ' (zurückgenommen)' : ''}`),
    more: single ? 0 : Math.max(0, preview.entries.length - SHOWN_ENTRIES),
    notes,
    confirmLabel: single ? 'Rückgängig machen' : 'Zurückkehren',
  }
}

// Welche Rücksprünge ein Eintrag anbietet. Eine Schranke keinen; der oberste nur `including` („Rückgängig …“), die
// übrigen beide („Diese und alle späteren Änderungen zurücknehmen …“, „Nur die späteren Änderungen zurücknehmen …“; die
// Texte stehen in Verlauf.tsx, wo der Wächter S16 sie liest). Auch ein nur lesbarer Eintrag (#318): Schritt für Schritt
// geht es dort nicht, aber liegt der Stand als Sicherung vor, nimmt die Vorschau sie; sonst nennt sie die Grenze.
export function revertActions(entry: { readOnly: boolean, barrier: string | null }, newest: boolean): RevertMode[] {
  if (entry.barrier !== null) return []
  return newest && !entry.readOnly ? ['including'] : ['including', 'after']
}

// ---------- Sicherungspunkte (#318) ----------

// Eine Sicherung im Datenordner, wie der Server sie in der Zeitachse liefert (server/src/db/snapshots.ts).
export type SnapshotPoint = {
  kind: 'snapshot'
  name: string
  type: 'weekly' | 'update' | 'restore'
  at: string
  // `file`: Der Zeitpunkt stammt aus der Dateizeit und ist nur so verlässlich wie diese.
  timeFrom: 'name' | 'notice' | 'file'
  size: number
  version: string | null
  title: string
}
export type JournalItem = JournalGroup | SnapshotPoint
export const isSnapshot = (item: JournalGroup | SnapshotPoint): item is SnapshotPoint => 'kind' in item && item.kind === 'snapshot'

// Die Vorschau zum Einspielen einer Sicherung (server/src/db/snapshotPreview.ts).
export type SnapshotPreview = {
  kind: 'snapshot'
  snapshot: SnapshotPoint
  entry: { id: number, firstId: number, at: string, title: string } | null
  mode: RevertMode | null
  reasons: string[]
  // `null`: nicht sicher zu zählen (Zeitpunkt aus der Datei, die Sicherung stammt nicht aus diesem Verlauf).
  later: number | null
  // Abrechnungen (Objekt, Jahr), die seither abgeschlossen, wieder geöffnet oder mit Versanddatum versehen wurden.
  frozen: string[]
  missing: string[]
  fromTrash: number
  consents: string[]
  notes: string[]
  refusals: string[]
  token: string
}

export const fileSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

export const snapshotWhen = (point: Pick<SnapshotPoint, 'at' | 'timeFrom'>): string =>
  `${journalWhen(point.at)}${point.timeFrom === 'file' ? ' (laut Datei)' : ''}`

export type SnapshotQuestion = { title: string, lines: string[], confirmLabel: string }

// Was die Rückfrage vor dem Einspielen sagt: dass alles danach ersetzt wird, wo die aktuellen Daten bleiben, welche
// Belege fehlen, welche Zustimmungen gelten. Kam die Vorschau von einem Eintrag, steht er im Titel, und darunter, warum
// es nur über die Sicherung geht.
export function snapshotQuestion(preview: SnapshotPreview): SnapshotQuestion {
  const point = preview.snapshot
  const named = `„${point.title}“ vom ${snapshotWhen(point)}`
  const title = preview.entry
    ? `Zum Stand ${preview.mode === 'after' ? 'nach' : 'vor'} „${preview.entry.title}“ (${journalWhen(preview.entry.at)}) zurückkehren?`
    : `Zum Stand ${named} zurückkehren?`
  const lines: string[] = []
  if (preview.entry) {
    lines.push(`Schritt für Schritt geht das nicht, nur über die Sicherung ${named}. Sie wird als Ganzes eingespielt:`)
    lines.push(...preview.reasons)
  }
  lines.push(preview.later === null
    ? 'Alles, was nach dieser Sicherung kam, wird durch ihren Stand ersetzt; wie viele Einträge das sind, lässt sich nicht sicher sagen.'
    : preview.later > 0
      ? `Alles, was danach kam, wird durch diesen Stand ersetzt: ${preview.later === 1 ? 'ein Eintrag' : `${preview.later} Einträge`} im Verlauf seit diesem Zeitpunkt.`
      : 'Alles, was danach kam, wird durch diesen Stand ersetzt.')
  lines.push('Ihre aktuellen Daten sichert Mietfuchs vorher als mietfuchs.sqlite.vor-restore im Datenordner; sie stehen danach als „Vor dem Einspielen eines Backups“ in dieser Zeitachse, und Sie können zu ihnen zurückkehren.')
  if (preview.missing.length > 0) {
    const shown = preview.missing.slice(0, 5).join(', ')
    const rest = preview.missing.length > 5 ? ' …' : ''
    lines.push(preview.missing.length === 1
      ? `Ein Beleg oder Logo, auf den dieser Stand verweist, fehlt danach: ${shown}.`
      : `${preview.missing.length} Belege oder Logos, auf die dieser Stand verweist, fehlen danach: ${shown}${rest}.`)
  }
  if (preview.fromTrash > 0) {
    lines.push(preview.fromTrash === 1 ? 'Ein Beleg oder Logo kommt aus dem Papierkorb zurück.' : `${preview.fromTrash} Belege oder Logos kommen aus dem Papierkorb zurück.`)
  }
  lines.push(...preview.consents, ...preview.notes)
  lines.push('Danach lädt Mietfuchs die Seite neu.')
  return { title, lines, confirmLabel: 'Zurückkehren' }
}

// Die Hinweise des Servers nach dem Einspielen überstehen das Neuladen in sessionStorage (Durchsicht S2 der früheren
// Karte „Automatische Vorversionen“): Nach dem Einspielen wird **immer** neu geladen, denn jede Seite hält noch Daten
// des alten Stands. Der Speicher kann fehlen oder werfen (privates Fenster); dann bleibt es beim Neuladen ohne Hinweise.
const NOTES_KEY = 'mietfuchs.sicherung.hinweise'
export function keepRestoreNotes(text: string): void {
  try {
    sessionStorage.setItem(NOTES_KEY, text)
  } catch {
    // siehe oben
  }
}
// Gelesen beim Einhängen, entfernt erst im Effekt: React ruft den Anfangswert im StrictMode zweimal auf.
export function readRestoreNotes(): string {
  try {
    return sessionStorage.getItem(NOTES_KEY) ?? ''
  } catch {
    return ''
  }
}
export function dropRestoreNotes(): void {
  try {
    sessionStorage.removeItem(NOTES_KEY)
  } catch {
    // siehe oben
  }
}

// Die Mitteilung danach: ein Eintrag mit seinem Titel, mehrere mit ihrer Zahl (Durchsicht von PR #439, K4).
export function revertedMessage(preview: RevertPreview): string {
  const n = preview.entries.length
  return n === 1
    ? `Rückgängig gemacht: „${preview.entries[0]?.title ?? preview.entry.title}“.`
    : `${n} Einträge zurückgenommen. Der Rücksprung steht oben im Verlauf und lässt sich dort wieder rückgängig machen.`
}

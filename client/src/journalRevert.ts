// Filter und Rücksprung auf der Seite „Verlauf“ (#318, Schritt 4). Logik ohne DOM, geprüft in journalRevert.test.ts.
//
// Ein Rücksprung nimmt immer ein Ende des Verlaufs zurück (server/src/db/revert.ts): einen Eintrag und alles danach
// (Stand vor dem Eintrag) oder nur alles danach (Stand nach dem Eintrag). Am obersten Eintrag heißt das erste
// „Rückgängig“. Die Vorschau trägt `kind`; heute gibt es nur `journal`, ein späterer Weg (Sicherung einspielen) bekommt
// eine eigene Art mit derselben Gestalt.
import { JOURNAL_KINDS, type JournalKind } from '../../shared/journal.ts'
import { journalWhen } from './journalView'

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
    ? `Zurückgenommen wird ${changes(preview.changes)}.`
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

// Welche Rücksprünge ein Eintrag anbietet. Eine Schranke und ein nur lesbarer Eintrag keinen; der oberste nur `including`
// („Rückgängig …“), die übrigen beide („Diese und alle späteren Änderungen zurücknehmen …“, „Nur die späteren Änderungen
// zurücknehmen …“; die Texte stehen in Verlauf.tsx, wo der Wächter S16 sie liest).
export function revertActions(entry: { readOnly: boolean, barrier: string | null }, newest: boolean): RevertMode[] {
  if (entry.readOnly || entry.barrier !== null) return []
  return newest ? ['including'] : ['including', 'after']
}

// Die Mitteilung danach: ein Eintrag mit seinem Titel, mehrere mit ihrer Zahl (Durchsicht von PR #439, K4).
export function revertedMessage(preview: RevertPreview): string {
  const n = preview.entries.length
  return n === 1
    ? `Rückgängig gemacht: „${preview.entries[0]?.title ?? preview.entry.title}“.`
    : `${n} Einträge zurückgenommen. Der Rücksprung steht oben im Verlauf und lässt sich dort wieder rückgängig machen.`
}

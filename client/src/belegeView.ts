// Entscheidungslogik der Seite „Belege“ (#490) mit den Ansichten Eingang und Ordner, getrennt von der Darstellung
// (pages/Belege.tsx, pages/BelegeEingang.tsx, pages/BelegeOrdner.tsx). Geprüft in belegeView.test.ts.
import type { BelegeView } from './nav'
import type { QueueEntry } from './evaluationQueue'
import { isReceipt, type FolderFilter, type ReceiptCard } from './receipts'
import type { AiStatus } from './types'

// ---------- Zuletzt benutzte Ansicht ----------

// Die Seitenleiste öffnet die Ansicht, die zuletzt offen war, gemerkt je Sitzung (sessionStorage). Ohne Speicher
// (privates Fenster, gesperrt) beginnt die Seite mit dem Eingang; das macht nichts kaputt.
export const VIEW_KEY = 'mietfuchs.belege.view'

export function readView(): BelegeView {
  try {
    return sessionStorage.getItem(VIEW_KEY) === 'ordner' ? 'ordner' : 'eingang'
  } catch {
    return 'eingang'
  }
}

export function writeView(view: BelegeView): void {
  try {
    sessionStorage.setItem(VIEW_KEY, view)
  } catch {
    // Ohne Speicher gilt die Ansicht nur bis zum Neuladen.
  }
}

// ---------- Ablage ----------

// Als Beleg lässt sich nur ein PDF oder ein Bild ablegen. Was sonst dabei ist, wird übergangen, und die Seite sagt es
// mit demselben Satz, gleich wo abgelegt wird (Eingang, Kosten, „Nur ablegen“).
export const SKIPPED_FILES = 'Nur PDFs und Bilder lassen sich als Beleg hochladen; die übrigen Dateien wurden übergangen.'
export const isAcceptedFile = (f: Pick<File, 'type'>): boolean => /^(application\/pdf|image\/)/.test(f.type)

export function splitFiles(files: Iterable<File>): { ok: File[]; skipped: number } {
  const all = [...files]
  const ok = all.filter(isAcceptedFile)
  return { ok, skipped: all.length - ok.length }
}

// Ob die Ablage auswertet oder nur speichert. Nur wenn die KI ausdrücklich „nicht erreichbar“ meldet (Grund wie bei einem
// gescheiterten Beleg, #487) und gerade nichts läuft, speichert die Ablage nur, und jeder Beleg steht danach unter „Ohne
// Position“ (Regel 5 in #490). Eine Zeitüberschreitung, ein abgelehnter Schlüssel oder keine Antwort sind kein „ohne KI“:
// Dann wertet sie aus wie vorher, und scheitert es, bleibt der Beleg gespeichert (KeptReceipt). Ein Dienst im Internet
// wird dafür nie gefragt (`external`), das Öffnen einer Seite soll nichts hinausschicken.
export type AiMode = 'ki' | 'ohne'
export function aiMode(status: Pick<AiStatus, 'ok' | 'reason'> | null, external: boolean, busy = false): AiMode {
  return !external && !busy && status?.ok === false && status.reason === 'unreachable' ? 'ohne' : 'ki'
}

// ---------- Eingang: „Ohne Position“ ----------

// Die Belege ohne Position, die der Eingang unter „Ohne Position“ zeigt: die des gewählten Objekts und Jahres und die
// ohne Zuordnung (`inboxOf`). Ausgelassen wird, was der Eingang schon anderswo zeigt: ein Beleg, der gerade
// ausgewertet wird oder wartet, und einer, dessen offene Auswertung unter „Zu prüfen“ steht. Ein gespeicherter, nicht
// ausgewerteter Beleg (#487) behält seine Karte; `kept` nennt den Eintrag der Warteschlange dazu, damit die Karte den
// Grund und „Erneut versuchen“ zeigt.
export function withoutPosition(here: readonly ReceiptCard[], queue: readonly QueueEntry[], shownAssessments: ReadonlySet<string>):
  { cards: ReceiptCard[]; kept: Map<string, QueueEntry> } {
  const busy = new Set(queue.filter((x) => x.status === 'wartend' || x.status === 'läuft').flatMap((x) => (x.file ? [x.file] : [])))
  const kept = new Map<string, QueueEntry>()
  for (const x of queue) if (x.status === 'gespeichert' && x.failure && !x.failure.meterPhoto) kept.set(x.failure.file, x)
  const cards = here.filter((c) => !busy.has(c.upload.file) && !(c.upload.assessment?.open && shownAssessments.has(c.upload.assessment.id)))
  return { cards, kept }
}

// Belege ohne Position, die einem anderen Objekt oder Jahr zugedacht sind: je Objekt und Jahr ihre Zahl, für die Zeile
// mit dem Sprung dorthin. `null` heißt: ohne Angabe, es bleibt beim gewählten.
export type ElsewhereGroup = { propertyId: string | null; year: number | null; count: number }
export function elsewhereGroups(cards: readonly ReceiptCard[], filter: FolderFilter): ElsewhereGroup[] {
  const groups: ElsewhereGroup[] = []
  for (const c of cards) {
    if (c.items.length > 0 || !isReceipt(c)) continue
    const { propertyId, year } = c.upload
    const otherProperty = filter.propertyId !== 'all' && propertyId !== null && propertyId !== filter.propertyId
    const otherYear = filter.year !== 'all' && year !== null && year !== filter.year
    if (!otherProperty && !otherYear) continue
    const key = { propertyId: otherProperty ? propertyId : null, year: otherYear ? year : null }
    const g = groups.find((x) => x.propertyId === key.propertyId && x.year === key.year)
    if (g) g.count++
    else groups.push({ ...key, count: 1 })
  }
  return groups
}

// ---------- Ordner: Suche ----------

// Wo ein Treffer der Suche liegt: Die Suche durchsucht alle Objekte und Jahre und nennt beides am Treffer. Ein Beleg an
// Positionen nennt deren Objekte und Jahre, einer ohne Position, wem er zugedacht ist. Das Objekt nur ab zwei Objekten.
export function hitPlace(card: ReceiptCard, nameOf: (propertyId: string) => string, manyProperties: boolean): string {
  const linked = card.items.length > 0
  const ids = linked ? card.propertyIds : card.upload.propertyId ? [card.upload.propertyId] : []
  const years = linked ? card.years : card.upload.year !== null ? [card.upload.year] : []
  const where = manyProperties ? (ids.length > 0 ? ids.map(nameOf).join(', ') : 'ohne Objekt') : null
  const when = years.length > 0 ? years.join(', ') : 'ohne Jahr'
  return [where, when].filter(Boolean).join(' · ')
}

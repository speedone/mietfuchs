// Umzug der Daten ins Programmfenster (#517). Beim ersten Start im Fenster ohne Bestand zeigt die Oberfläche statt des
// Cockpits „Ihre bisherigen Daten übernehmen“ (pages/Umzug.tsx). Hier steht, was der Bildschirm entscheidet, ohne React.
// Den Ablauf (Fundorte, Kopie, Vergleich, Vermerk) erklärt server/src/CLAUDE.md, „Umzug ins Programmfenster“.
import type { DesktopBridge } from './desktopNetwork'
import { labelOfKey } from './periodForm'
import { RELEASES_URL, STORE_URL } from './update'
import { isCalendarRules } from '../../shared/period.ts'
import type { PeriodKey, PeriodRules } from '../../shared/types.ts'

export type RelocationCandidate = {
  // Kennung des Fundes beim Server; übernommen wird nur mit ihr, nie mit dem Pfad (K11)
  id: string
  dataDir: string
  kind: 'database' | 'json' | null
  modifiedAt: string | null
  properties: number | null
  tenancies: number | null
  // Antwortet auf Port 3001 ein Mietfuchs mit diesem Datenordner (oder einem, den es nicht nennt)?
  running: boolean
  source: 'remembered' | 'fixed' | 'search' | 'chosen'
  appVersion: string | null
  // Die Namen der Objekte
  names: string[]
  // Schon vor dem Klick bekannt (Praxistest J, I): beschädigt oder aus einer neueren Fassung; dann ist „Daten übernehmen“
  // gesperrt
  problem: 'damaged' | 'newer' | null
  // Automatische Vorversionen im alten Ordner
  priorVersions: number
  // Der Ort in Worten (server/src/relocation.ts, `placeOf`)
  place: PlaceInWords
}
export type PlaceInWords = { folder: string, within: 'Downloads' | 'Schreibtisch' | 'Dokumente' | 'OneDrive' | null }
// `store`: aus dem Microsoft Store, dann führt der Weg zur neuesten Version dorthin
export type RelocationCandidates = { offered: boolean, ownStock?: boolean, store?: boolean, candidates?: RelocationCandidate[], searched?: boolean, complete?: boolean }
export type AdoptCounts = { properties: number, tenancies: number, costItems: number, receipts: number }
export type AdoptResult = { ok: boolean, notes: string[], counts?: AdoptCounts, error?: string }

type WithBridge = { mietfuchsDesktop?: DesktopBridge }
const currentWindow = (): WithBridge | undefined => (typeof window === 'undefined' ? undefined : window)

// Nur im Programmfenster: Öffnet jemand die Adresse des Fensters im Browser oder auf dem Handy, erscheint der
// Bildschirm nicht; dort fehlt die Brücke (desktop/src/preload.cjs).
export const inWindow = (w: WithBridge | undefined = currentWindow()): boolean => Boolean(w?.mietfuchsDesktop)

// „Ordner der alten Programmdatei wählen …“ über den Dialog des Fensters; ein Fenster vor dieser Fassung kennt ihn nicht.
export function folderBridge(w: WithBridge | undefined = currentWindow()): (() => Promise<string | null>) | null {
  const choose = w?.mietfuchsDesktop?.chooseFolder
  return typeof choose === 'function' ? choose : null
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })

const WITHIN: Record<NonNullable<PlaceInWords['within']>, string> = {
  Downloads: 'in Downloads', Schreibtisch: 'auf dem Schreibtisch', Dokumente: 'in Dokumente', OneDrive: 'in OneDrive',
}
// „Ordner „mietfuchs-0.14.1“ in Downloads“ statt eines langen Pfads (Praxistest B-01, D, M, O)
export const placeText = (p: PlaceInWords): string => `Ordner „${p.folder}“${p.within ? ` ${WITHIN[p.within]}` : ''}`

// „A“, „A und B“, „A, B, C und 2 weitere“
function namesText(names: readonly string[]): string | null {
  if (names.length === 0) return null
  if (names.length > 3) return `${names.slice(0, 3).join(', ')} und ${names.length - 3} weitere`
  return names.length === 1 ? names[0] ?? null : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
}

export function candidateFacts(c: RelocationCandidate): { place: string, path: string, names: string | null, modified: string | null, stock: string | null } {
  const parts = [
    c.properties !== null ? plural(c.properties, 'Objekt', 'Objekte') : null,
    c.tenancies !== null ? plural(c.tenancies, 'Mietverhältnis', 'Mietverhältnisse') : null,
  ].filter((p): p is string => p !== null)
  return {
    place: placeText(c.place),
    path: c.dataDir,
    names: namesText(c.names),
    modified: c.modifiedAt ? `Zuletzt geändert am ${longDate(c.modifiedAt)}` : null,
    stock: parts.length > 0 ? parts.join(', ') : null,
  }
}

// Mehrere Funde (Praxistest D): der zuletzt geänderte zuerst als „Neuester Stand“, die übrigen „Älterer Stand“ mit
// zurückhaltendem Knopf. Ohne Datum hinten.
export type RankedCandidate = { candidate: RelocationCandidate, role: 'only' | 'newest' | 'older' }
export function rankCandidates(list: readonly RelocationCandidate[]): RankedCandidate[] {
  const sorted = [...list].sort((a, b) => {
    const x = a.modifiedAt ?? ''
    const y = b.modifiedAt ?? ''
    return x < y ? 1 : x > y ? -1 : 0
  })
  if (sorted.length === 1) return sorted.map((candidate) => ({ candidate, role: 'only' }))
  return sorted.map((candidate, i) => ({ candidate, role: i === 0 ? 'newest' : 'older' }))
}

// Was gegen die Übernahme eines Fundes spricht, schon vor dem Klick (Praxistest J, I). Der Weg zur neuesten Version
// ist ein fester Link (update.ts), nie einer aus einer Antwort.
export type CandidateProblem = { title: string, text: string, link: { label: string, href: string } | null }
export function candidateProblem(c: RelocationCandidate, store: boolean): CandidateProblem | null {
  if (c.problem === 'damaged') {
    const prior = c.priorVersions > 0
      ? ` Im alten Ordner liegen außerdem ${c.priorVersions === 1 ? 'eine automatische Vorversion' : `${c.priorVersions} automatische Vorversionen`} (Ordner „vorversionen“), ältere Kopien Ihrer Daten. Löschen Sie den alten Ordner deshalb nicht.`
      : ''
    return {
      title: 'Beschädigt, lässt sich nicht lesen',
      text: `Diese Daten lassen sich nicht übernehmen. An der Datei wurde nichts verändert. Haben Sie ein Backup (eine ZIP-Datei), spielen Sie es hier ein.${prior}`,
      link: null,
    }
  }
  if (c.problem === 'newer') {
    return {
      title: 'Aus einer neueren Mietfuchs-Version',
      text: 'Diese Daten hat eine neuere Version von Mietfuchs gespeichert; dieses Mietfuchs kann sie noch nicht lesen. An ihnen wurde nichts verändert. ' +
        (store ? 'Aktualisieren Sie Mietfuchs im Microsoft Store und übernehmen Sie die Daten danach.' : 'Installieren Sie die neueste Version und übernehmen Sie die Daten danach.'),
      link: store ? { label: 'Mietfuchs im Microsoft Store aktualisieren', href: STORE_URL } : { label: 'Neueste Version herunterladen', href: RELEASES_URL },
    }
  }
  return null
}

export function adoptedText(counts: AdoptCounts): string {
  const parts = [
    plural(counts.properties, 'Objekt', 'Objekte'),
    plural(counts.tenancies, 'Mietverhältnis', 'Mietverhältnisse'),
    plural(counts.costItems, 'Kostenposition', 'Kostenpositionen'),
    counts.receipts > 0 ? plural(counts.receipts, 'Beleg', 'Belege') : null,
  ].filter((p): p is string => p !== null)
  const last = parts.pop()
  return `Übernommen: ${parts.join(', ')} und ${last}.`
}

// Fortschritt der Übernahme (Ergänzung 4), wie der Server ihn meldet
export type AdoptProgress = { phase: 'idle' | 'copy' | 'check' | 'switch', files: number, totalFiles: number, bytes: number, totalBytes: number }

const mb = (bytes: number): string => `${Math.round(bytes / 1024 ** 2).toLocaleString('de-DE')}`
export function progressText(p: AdoptProgress): string | null {
  if (p.phase === 'copy') return `${p.files} von ${p.totalFiles} Dateien kopiert (${mb(p.bytes)} von ${mb(p.totalBytes)} MB)`
  if (p.phase === 'check') return 'Die Kopie wird mit dem Original verglichen …'
  if (p.phase === 'switch') return 'Die Daten werden umgeschaltet …'
  return null
}

// Nach dem Umzug im alten Mietfuchs noch etwas geändert (Ergänzung 2, aus GET /api/relocation)
// `place`: der Ort in Worten, `running`: ob das alte Mietfuchs noch läuft (Praxistest M)
export type NewerStockInfo = { from: string, modifiedAt: string | null, place: PlaceInWords, running: boolean }
export const movedLongDate = longDate

// ---------- Ankunft nach Umzug, Backup oder neuerem Stand (Praxistest B-04, E-04, F-04, H-04, P-05) ----------
//
// Nach dem Umzug lud die Seite neu und stand im Cockpit des aktuellen Jahres mit „0,00 €“, obwohl die Kosten in einem
// früheren Jahr liegen; das sah aus wie Datenverlust. Der Anlass reist deshalb in der Adresse über das Neuladen
// (`?arrived=…`, ohne Speicher des Browsers), und danach steht einmal oben, was da ist, im Zeitraum mit den jüngsten
// erfassten Kosten.
export type Arrival = 'moved' | 'backup' | 'newer'
const ARRIVALS: readonly Arrival[] = ['moved', 'backup', 'newer']
export function arrivalUrl(href: string, arrival: Arrival): string {
  const url = new URL(href)
  url.searchParams.set('arrived', arrival)
  return url.toString()
}
export function arrivalFrom(search: string): Arrival | null {
  const value = new URLSearchParams(search).get('arrived')
  return ARRIVALS.find((a) => a === value) ?? null
}
// Neu laden mit dem Anlass in der Adresse; App.tsx zeigt danach die Bestätigung
export function reloadWithArrival(arrival: Arrival): void {
  window.location.replace(arrivalUrl(window.location.href, arrival))
}
// Die Adresse ohne den Anlass, damit ein späteres Neuladen ihn nicht noch einmal zeigt
export function withoutArrival(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('arrived')
  return url.toString()
}

export type ArrivalStock = { property: { id: string, name: string, rules: PeriodRules }, tenancies: number, periods: readonly PeriodKey[] }
export type ArrivalSummary = { title: string, text: string, target: { propertyId: string, periodKey: PeriodKey } | null }
const ARRIVAL_TITLES: Record<Arrival, string> = {
  moved: 'Ihre Daten sind da',
  backup: 'Ihr Backup ist eingespielt',
  newer: 'Der neuere Stand ist übernommen',
}
export function arrivalSummary(arrival: Arrival, stock: readonly ArrivalStock[], currentId: string | null): ArrivalSummary {
  if (stock.length === 0) return { title: ARRIVAL_TITLES[arrival], text: '', target: null }
  const tenancies = stock.reduce((sum, s) => sum + s.tenancies, 0)
  const count = tenancies === 0 ? 'Noch kein Mietverhältnis' : plural(tenancies, 'Mietverhältnis', 'Mietverhältnisse')
  const where = stock.length === 1 ? `„${stock[0]?.property.name ?? ''}“` : plural(stock.length, 'Objekt', 'Objekten')
  // Der jüngste Zeitraum mit Kosten; bei Gleichstand das gewählte Objekt
  let best: { s: ArrivalStock, key: PeriodKey } | null = null
  for (const s of stock) {
    for (const key of s.periods) {
      if (!best || key > best.key || (key === best.key && s.property.id === currentId)) best = { s, key }
    }
  }
  const head = `${count} in ${where}.`
  if (!best) return { title: ARRIVAL_TITLES[arrival], text: head, target: null }
  const calendar = isCalendarRules(best.s.property.rules)
  const label = `${calendar ? 'Abrechnungsjahr' : 'Abrechnungszeitraum'} ${labelOfKey(best.s.property.rules, best.key)}`
  const shown = stock.length === 1 ? `das ${label}` : `„${best.s.property.name}“, ${label}`
  const other = calendar ? 'Ein anderes Jahr wählen Sie unter „Abrechnungsjahr“.' : 'Einen anderen Zeitraum wählen Sie unter „Abrechnungszeitraum“.'
  return {
    title: ARRIVAL_TITLES[arrival],
    text: `${head} Mietfuchs zeigt ${shown}, in dem zuletzt Kosten erfasst sind. ${other}`,
    target: { propertyId: best.s.property.id, periodKey: best.key },
  }
}

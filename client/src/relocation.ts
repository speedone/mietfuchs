// Umzug der Daten ins Programmfenster (#517). Beim ersten Start im Fenster ohne Bestand zeigt die Oberfläche statt des
// Cockpits „Ihre bisherigen Daten übernehmen“ (pages/Umzug.tsx). Hier steht, was der Bildschirm entscheidet, ohne React.
// Den Ablauf (Fundorte, Kopie, Vergleich, Vermerk) erklärt server/src/CLAUDE.md, „Umzug ins Programmfenster“.
import type { DesktopBridge } from './desktopNetwork'

export type RelocationCandidate = {
  dataDir: string
  kind: 'database' | 'json' | null
  modifiedAt: string | null
  properties: number | null
  tenancies: number | null
  // Antwortet auf Port 3001 ein Mietfuchs mit diesem Datenordner (oder einem, den es nicht nennt)?
  running: boolean
  source: 'remembered' | 'fixed' | 'search' | 'chosen'
  appVersion: string | null
}
export type RelocationCandidates = { offered: boolean, candidates?: RelocationCandidate[], searched?: boolean, complete?: boolean }
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

export function candidateFacts(c: RelocationCandidate): { place: string, modified: string | null, stock: string | null } {
  const parts = [
    c.properties !== null ? plural(c.properties, 'Objekt', 'Objekte') : null,
    c.tenancies !== null ? plural(c.tenancies, 'Mietverhältnis', 'Mietverhältnisse') : null,
  ].filter((p): p is string => p !== null)
  return {
    place: c.dataDir,
    modified: c.modifiedAt ? `Zuletzt geändert am ${longDate(c.modifiedAt)}` : null,
    stock: parts.length > 0 ? parts.join(', ') : null,
  }
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

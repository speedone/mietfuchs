// Die Seiten der Oberfläche und ihre Navigation, gruppiert nach Arbeitsphase statt als flache
// Tab-Liste: erst der Überblick, dann „Sammeln“ (übers Jahr laufend), „Abrechnen“ (Jahresende)
// und „Einrichten“ (Objekt, Einstellungen, Hilfe). Eigene Datei, damit die Anleitungen der Hilfe (#164) ihre Sprünge
// gegen dieselben Kennungen prüfen können.

import type { GuidePage, GuideView } from '../../shared/guides.ts'

export type Tab =
  | 'cockpit' | 'zaehler' | 'kosten' | 'mietkonto'
  | 'heizkosten' | 'abrechnung' | 'uebersicht' | 'steuer'
  | 'stammdaten' | 'belege' | 'einstellungen' | 'verlauf' | 'hilfe'

// `short` ist die Beschriftung in der unteren Leiste am Handy (#346, Schritt 9), wo fünf Einträge
// nebeneinander stehen; fehlt sie, gilt `label`.
export type NavItem = { id: Tab; label: string; icon: string; short?: string }
export const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ id: 'cockpit', label: 'Cockpit', icon: '◎' }] },
  {
    section: 'Sammeln',
    items: [
      // Die Seite „Belege“ (#490) mit den Ansichten Eingang (Ablage und Arbeitsliste) und Ordner (Register je
      // Kostenart); sie ersetzt Schnellerfassung und Belegordner. Am Handy heißt sie in der unteren Leiste „Erfassen“
      // und öffnet dort immer den Eingang.
      { id: 'belege', label: 'Belege', icon: '📥', short: 'Erfassen' },
      { id: 'zaehler', label: 'Zähler & Stände', icon: '🔢', short: 'Zähler' },
      { id: 'kosten', label: 'Kosten', icon: '🧾' },
      { id: 'mietkonto', label: 'Mietkonto', icon: '💶' },
    ],
  },
  {
    section: 'Abrechnen',
    items: [
      // Heizung PR 6 (Entwurf 11.4): erst ab einer Heizanlage sichtbar, siehe `navFor`.
      { id: 'heizkosten', label: 'Heizkosten', icon: '🔥' },
      { id: 'abrechnung', label: 'Abrechnung', icon: '📄' },
      { id: 'uebersicht', label: 'Kostenvergleich', icon: '📊' },
      { id: 'steuer', label: 'Steuer (Anlage V)', icon: '🧮' },
    ],
  },
  {
    section: 'Einrichten',
    items: [
      { id: 'stammdaten', label: 'Stammdaten', icon: '🏠' },
      { id: 'einstellungen', label: 'Einstellungen', icon: '⚙️' },
      // Das Änderungsjournal (#318, Schritt 3): was wann geändert wurde.
      { id: 'verlauf', label: 'Verlauf', icon: '🕘' },
      { id: 'hilfe', label: 'Hilfe & Begriffe', icon: '❓' },
    ],
  },
]

// Die beiden Ansichten der Seite Belege (#490). Ein Sprung kann eine davon nennen (`belege:eingang`); ohne Ansicht
// öffnet die Seite die zuletzt benutzte.
export type BelegeView = GuideView
export const BELEGE_VIEWS: readonly BelegeView[] = ['eingang', 'ordner']
export type NavTarget = Tab | `belege:${BelegeView}`

// Ein Ziel ist eine Seite der Navigation, auf der Seite Belege mit Ansicht. Ungültiges wirft: Ein Tippfehler fiele sonst
// still auf die falsche Seite (Durchsicht S4).
export function splitTarget(target: NavTarget): { tab: Tab; view: BelegeView | null } {
  const [tab, view, ...rest] = target.split(':')
  const known = NAV.some((g) => g.items.some((i) => i.id === tab))
  if (!known || rest.length > 0 || (view !== undefined && (tab !== 'belege' || !BELEGE_VIEWS.includes(view as BelegeView)))) {
    throw new Error(`Unbekanntes Ziel: ${target}`)
  }
  return { tab: tab as Tab, view: (view as BelegeView | undefined) ?? null }
}

// Jede Seite einer Anleitung ist eine Seite der Navigation; sonst übersetzt diese Zeile nicht.
const guidePageAsTab = (p: GuidePage): Tab => p

// Die Beschriftung einer Seite, wie sie in der Navigation steht.
export function pageLabel(p: GuidePage): string {
  return tabLabel(guidePageAsTab(p))
}

// Die Seite Heizkosten gibt es erst ab einer Heizanlage (Entwurf 11.1, 11.4): Wer keine hat, sieht
// keine neue Seite.
export function navFor(hasHeatingPlant: boolean): typeof NAV {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== 'heizkosten' || hasHeatingPlant) }))
}

// Die untere Leiste am Handy (#346, Schritt 9): die Wege, die man vor Ort mit dem Handy geht
// (Zähler ablesen, Beleg fotografieren), dazu „Mehr“ für das Menüblatt. Die Einträge kommen aus NAV,
// damit es keine zweite Liste gibt; ein Wächter in uiRules.test.ts verbietet sie anderswo.
export const BOTTOM_TABS: readonly Tab[] = ['cockpit', 'belege', 'zaehler', 'stammdaten']

export function bottomNav(): NavItem[] {
  const items = NAV.flatMap((g) => g.items)
  return BOTTOM_TABS.map((id) => {
    const item = items.find((i) => i.id === id)
    if (!item) throw new Error(`${id} fehlt in NAV`)
    return item
  })
}

// Die Beschriftung einer Seite, wie sie im Kopf am Handy steht.
export function tabLabel(tab: Tab): string {
  return NAV.flatMap((g) => g.items).find((i) => i.id === tab)?.label ?? tab
}

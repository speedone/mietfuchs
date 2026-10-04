// Die Seiten der Oberfläche und ihre Navigation, gruppiert nach Arbeitsphase statt als flache
// Tab-Liste: erst der Überblick, dann „Sammeln" (übers Jahr laufend), „Abrechnen" (Jahresende)
// und „Einrichten" (selten). Eigene Datei, damit die Anleitungen der Hilfe (#164) ihre Sprünge
// gegen dieselben Kennungen prüfen können.

import type { GuidePage } from '../../shared/guides.ts'

export type Tab =
  | 'cockpit' | 'schnellerfassung' | 'zaehler' | 'kosten' | 'mietkonto'
  | 'abrechnung' | 'uebersicht' | 'steuer'
  | 'stammdaten' | 'belege' | 'einstellungen' | 'hilfe'

export type NavItem = { id: Tab; label: string; icon: string }
export const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ id: 'cockpit', label: 'Cockpit', icon: '◎' }] },
  {
    section: 'Sammeln · laufend',
    items: [
      { id: 'schnellerfassung', label: 'Schnellerfassung', icon: '📥' },
      { id: 'zaehler', label: 'Zähler & Stände', icon: '🔢' },
      { id: 'kosten', label: 'Kosten', icon: '🧾' },
      // Der Belegordner (#170) gehört zum laufenden Sammeln: Dort landen neue Belege im Posteingang.
      { id: 'belege', label: 'Belegordner', icon: '📁' },
      { id: 'mietkonto', label: 'Mietkonto', icon: '💶' },
    ],
  },
  {
    section: 'Abrechnen · Jahresende',
    items: [
      { id: 'abrechnung', label: 'Abrechnung', icon: '📄' },
      { id: 'uebersicht', label: 'Kostenvergleich', icon: '📊' },
      { id: 'steuer', label: 'Steuer (Anlage V)', icon: '🧮' },
    ],
  },
  {
    section: 'Einrichten · selten',
    items: [
      { id: 'stammdaten', label: 'Stammdaten', icon: '🏠' },
      { id: 'einstellungen', label: 'Einstellungen', icon: '⚙️' },
      { id: 'hilfe', label: 'Hilfe & Begriffe', icon: '❓' },
    ],
  },
]

// Jede Seite einer Anleitung ist eine Seite der Navigation; sonst übersetzt diese Zeile nicht.
const guidePageAsTab = (p: GuidePage): Tab => p

// Die Beschriftung einer Seite, wie sie in der Navigation steht.
export function pageLabel(p: GuidePage): string {
  const tab = guidePageAsTab(p)
  return NAV.flatMap((g) => g.items).find((i) => i.id === tab)?.label ?? tab
}

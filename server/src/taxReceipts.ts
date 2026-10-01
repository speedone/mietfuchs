// „Belege für die Steuer“ (#170): alle Belege eines Objekts und Jahres als ZIP, geordnet nach den
// Gruppen der Anlage V, für den Steuerberater oder die eigene Ablage.
//
// **Alle Positionen, auch die nicht umlagefähigen.** Für die Steuer zählen Verwaltung und
// Instandhaltung ebenso wie die umgelegten Betriebskosten; gerade sie fehlen in einer Mappe, die
// nur aus der Abrechnung entsteht. Die Gruppen sind dieselben wie in der Steuerübersicht
// (`ANLAGE_V_GROUP` in calc.ts), damit Ordner und Übersicht zusammenpassen. Die Zuführung zur
// Erhaltungsrücklage steht dort gesondert (#143) und hier in einem eigenen Ordner.
//
// Daneben eine Übersicht als CSV mit jeder Position, auch denen ohne Beleg: Was fehlt, soll der
// Steuerberater sehen und nicht erst vermissen.
import type { CostItem } from '../../shared/types.ts'
import { ANLAGE_V_GROUP, ANLAGE_V_GROUP_ORDER } from './calc.ts'

const RESERVE_GROUP = 'Erhaltungsrücklage (gesondert)'
const FALLBACK_GROUP = 'Sonstige Werbungskosten'
const GROUPS = [...ANLAGE_V_GROUP_ORDER, RESERVE_GROUP]

export function taxGroupOf(category: string): string {
  if (!Object.hasOwn(ANLAGE_V_GROUP, category)) return FALLBACK_GROUP
  return ANLAGE_V_GROUP[category] ?? RESERVE_GROUP
}

// Ein Name, der in jedem Dateisystem und jedem Entpacker hält: keine Schrägstriche, keine
// Doppelpunkte und keine Zeichen, die Windows ablehnt.
const safeName = (name: string): string => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim()

const euro = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',')

const csvField = (value: string): string => (/[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export type TaxArchivePlan = {
  files: { zipPath: string, file: string }[]
  overviewCsv: string
}

// `names`: die Dateien im Belegordner mit ihrem Originalnamen. Ein Verweis auf eine Datei, die
// dort fehlt, steht in der Übersicht als „Datei fehlt“.
export function planTaxArchive(items: CostItem[], names: Map<string, string>): TaxArchivePlan {
  const rank = (group: string) => GROUPS.indexOf(group)
  const sorted = [...items].sort((a, b) =>
    rank(taxGroupOf(a.category)) - rank(taxGroupOf(b.category)) ||
    a.category.localeCompare(b.category, 'de') ||
    a.description.localeCompare(b.description, 'de'))

  const files: TaxArchivePlan['files'] = []
  const placed = new Map<string, string>() // Gruppe|Datei → Pfad im Archiv
  const taken = new Set<string>()
  const rows: string[] = []
  for (const c of sorted) {
    const group = taxGroupOf(c.category)
    let beleg = 'kein Beleg'
    if (c.invoiceFile) {
      const original = names.get(c.invoiceFile)
      if (original === undefined) {
        beleg = 'Datei fehlt'
      } else {
        const key = `${group}|${c.invoiceFile}`
        let zipPath = placed.get(key)
        if (!zipPath) {
          const folder = `${rank(group) + 1} ${group}`
          const base = safeName(`${c.category} - ${original}`)
          const dot = base.lastIndexOf('.')
          const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, '']
          zipPath = `${folder}/${base}`
          for (let n = 2; taken.has(zipPath); n++) zipPath = `${folder}/${stem} (${n})${ext}`
          taken.add(zipPath)
          placed.set(key, zipPath)
          files.push({ zipPath, file: c.invoiceFile })
        }
        beleg = zipPath
      }
    }
    rows.push([
      group, c.category, c.description, c.vendor ?? '', euro(c.amountCents),
      c.labor35aCents ? euro(c.labor35aCents) : '', beleg,
    ].map(csvField).join(';'))
  }
  const header = 'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);Lohnanteil § 35a (EUR);Beleg'
  return { files, overviewCsv: `﻿${[header, ...rows].join('\r\n')}\r\n` }
}

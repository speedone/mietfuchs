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
// Steuerberater sehen und nicht erst vermissen. Bei teilweiser Eigennutzung trägt jede Position
// ihren privaten und ihren abziehbaren Teil (#163), entnommen der Steuerübersicht
// (`taxReport(...).expenses.items`) und nicht hier ein zweites Mal gerechnet: Die Summen der
// beiden Spalten sind deshalb genau die der Übersicht. Die Zuführung zur Rücklage steht dort nicht
// in den Werbungskosten und hat hier leere Felder.
import type { CostItem, TaxExpenseItem } from '../../shared/types.ts'
import { ANLAGE_V_GROUP, ANLAGE_V_GROUP_ORDER, validLabor35aCents } from './calc.ts'

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

// Ein Textfeld, das mit = + - @ (oder Tab, Wagenrücklauf) beginnt, liest eine Tabellenkalkulation
// als Formel. Rechnungssteller und Beschreibung können aus der KI-Auswertung eines fremden Belegs
// stammen, deshalb wird entschärft: ein Apostroph davor, wie es die OWASP-Empfehlung zur
// CSV-Einschleusung vorsieht. Beträge sind keine Textfelder; eine Gutschrift bleibt „-5,00“.
const textField = (value: string): string => csvField(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value)

export type TaxArchivePlan = {
  files: { zipPath: string, file: string }[]
  overviewCsv: string
}

// `names`: die Dateien im Belegordner mit ihrem Originalnamen. Ein Verweis auf eine Datei, die
// dort fehlt, steht in der Übersicht als „Datei fehlt“.
//
// `booked`: je Position die Belege, die über gebuchte Zeilen einer Auswertung an ihr hängen
// (Belegbuchung); sie liegen neben `invoiceFile` im Archiv, die Position steht trotzdem einmal in
// der Übersicht, mit allen ihren Belegen in einer Zelle.
//
// `split`: je Position privat und abziehbar aus der Steuerübersicht (#163).
export type TaxSplitOfItem = Pick<TaxExpenseItem, 'privateCents' | 'deductibleCents'>
export function planTaxArchive(
  items: CostItem[], names: Map<string, string>, booked: ReadonlyMap<string, readonly string[]> = new Map(),
  split: ReadonlyMap<string, TaxSplitOfItem> = new Map(),
): TaxArchivePlan {
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
    const parts: string[] = []
    for (const file of new Set([c.invoiceFile, ...(booked.get(c.id) ?? [])].filter((f): f is string => !!f))) {
      const original = names.get(file)
      if (original === undefined) {
        parts.push('Datei fehlt')
        continue
      }
      const key = `${group}|${file}`
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
        files.push({ zipPath, file })
      }
      parts.push(zipPath)
    }
    const beleg = parts.length > 0 ? parts.join(' | ') : 'kein Beleg'
    const part = split.get(c.id)
    // Derselbe Lohnanteil wie in der Steuerübersicht: ein ungültiger (über dem Betrag oder negativ)
    // zählt dort nicht, und hier steht er dann ebenso wenig (Integrationsdurchsicht vor 0.10).
    const labor = validLabor35aCents(c) ?? 0
    rows.push([
      textField(group), textField(c.category), textField(c.description), textField(c.vendor ?? ''), csvField(euro(c.amountCents)),
      part ? csvField(euro(part.privateCents)) : '', part ? csvField(euro(part.deductibleCents)) : '',
      csvField(labor ? euro(labor) : ''), textField(beleg),
    ].join(';'))
  }
  const header = 'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg'
  return { files, overviewCsv: `﻿${[header, ...rows].join('\r\n')}\r\n` }
}

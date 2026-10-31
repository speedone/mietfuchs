// „Belege für die Steuer“ (#170): alle Belege eines Objekts und Jahres als ZIP, geordnet nach den
// Gruppen der Anlage V, für den Steuerberater oder die eigene Ablage.
//
// **Alle Positionen, auch die nicht umlagefähigen.** Für die Steuer zählen Verwaltung und
// Instandhaltung ebenso wie die umgelegten Betriebskosten; gerade sie fehlen in einer Mappe, die
// nur aus der Abrechnung entsteht. Die Gruppen sind dieselben wie in der Steuerübersicht
// (`ANLAGE_V_GROUP` in calc.ts), damit Ordner und Übersicht zusammenpassen. Die Zuführung zur
// Erhaltungsrücklage steht dort gesondert (#143) und hier in einem eigenen Ordner; die Entnahme
// aus der Rücklage (#96) in ihrer Gruppe „Erhaltungsaufwand“, deren Ordner vor „Verwaltung &
// Instandhaltung“ steht (die Nummern der folgenden Ordner rücken deshalb seit #96 um eins).
//
// Daneben eine Übersicht als CSV mit jeder Position, auch denen ohne Beleg: Was fehlt, soll der
// Steuerberater sehen und nicht erst vermissen. Bei teilweiser Eigennutzung trägt jede Position
// ihren privaten und ihren abziehbaren Teil (#163), entnommen der Steuerübersicht
// (`taxReport(...).expenses.items`) und nicht hier ein zweites Mal gerechnet: Die Summen der
// beiden Spalten sind deshalb genau die der Übersicht. Die Zuführung zur Rücklage steht dort nicht
// in den Werbungskosten und hat hier leere Felder.
import type { CostItem, TaxExpenseItem, TaxReport } from '../../shared/types.ts'
import { ANLAGE_V_GROUP, ANLAGE_V_GROUP_ORDER, validLabor35aCents, type TaxPart } from './calc.ts'
import { outflowShares } from './outflow.ts'
import { startYearOf } from '../../shared/period.ts'

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

export const euro = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',')

export const csvField = (value: string): string => (/[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

// Ein Textfeld, das mit = + - @ (oder Tab, Wagenrücklauf) beginnt, liest eine Tabellenkalkulation
// als Formel. Rechnungssteller und Beschreibung können aus der KI-Auswertung eines fremden Belegs
// stammen, deshalb wird entschärft: ein Apostroph davor, wie es die OWASP-Empfehlung zur
// CSV-Einschleusung vorsieht. Beträge sind keine Textfelder; eine Gutschrift bleibt „-5,00“.
export const textField = (value: string): string => csvField(/^[=+\-@]/.test(value.replace(/^[\s\u00a0\ufeff]+/, '')) || /^[\t\r]/.test(value) ? `'${value}` : value)

// Welche Positionen ins Archiv eines Steuerjahres gehören: **genau die der Steuerübersicht**, also die Positionen der
// Teile aus `taxPartsFor` (das Jahr der Zahlung aus `outflowShares`, outflow.ts, #255), in der Reihenfolge des
// Bestands. Keine eigene Auswahl daneben: Vorher wählte das Archiv beim Kalenderobjekt nach dem Zeitraum aus, die
// Übersicht über die Teile, und ein Jahr der Zahlung außerhalb des Zeitraums hätte beide getrennt.
export function taxArchiveItems<C extends Pick<CostItem, 'id'>>(costItems: readonly C[], parts: readonly Pick<TaxPart, 'items'>[]): C[] {
  const ids = new Set(parts.flatMap((p) => p.items.map((c) => c.id)))
  return costItems.filter((c) => ids.has(c.id))
}

// Die Teile je Quelle (#455); Positionen ohne Quelle fehlen. Wie `partsBySource` in client/src/receipts.ts.
export function partsBySource<C extends Pick<CostItem, 'sourceId'>>(items: readonly C[]): Map<string, C[]> {
  const out = new Map<string, C[]>()
  for (const c of items) if (c.sourceId) out.set(c.sourceId, [...(out.get(c.sourceId) ?? []), c])
  return out
}

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
// Dazu das Jahr der Zahlung samt Quelle und bei einer verschobenen Position ihre Abrechnung (#255, PR 4), ebenfalls aus
// der Steuerübersicht; die Spalte „Jahr der Zahlung“ sagt dem Steuerberater, warum eine Position in diesem Jahr steht.
export type TaxSplitOfItem = Pick<TaxExpenseItem, 'privateCents' | 'deductibleCents'> & Partial<Pick<TaxExpenseItem, 'outflow' | 'settlementPeriod' | 'outsideSpan' | 'gratuitousCents' | 'deferredCents' | 'spread'>>
const fmtDay = (iso: string): string => iso.split('-').reverse().join('.')
function reserveOutflow(c: Pick<CostItem, 'period' | 'amountCents' | 'taxYear' | 'paidOn'>): Pick<TaxSplitOfItem, 'outflow'> {
  const share = outflowShares(c, { from: `${startYearOf(c.period)}-01-01` })[0]
  return share === undefined ? {} : { outflow: { year: share.year, source: share.source, ...(share.source === 'paid' && c.paidOn != null ? { paidOn: c.paidOn } : {}) } }
}
export function outflowText(part: Partial<TaxSplitOfItem> | undefined): string {
  const o = part?.outflow
  if (o === undefined) return ''
  const why = o.source === 'paid' && o.paidOn !== undefined ? `bezahlt am ${fmtDay(o.paidOn)}`
    : o.source === 'stated' ? 'als Jahr der Zahlung angegeben'
      : o.source === 'bill' ? 'wie die Stromrechnung'
        : 'Jahr der Abrechnung (ohne Angabe)'
  // Verteilt nach § 82b EStDV (#262, E-12): der Zeitraum des Abzugs, wie ihn die Steuerübersicht rechnet.
  const years = part?.spread?.rates.map((r) => r.year) ?? []
  const spread = part?.spread ? [`auf ${part.spread.years} Jahre verteilt, ${years[0]}${years.length > 1 ? ` bis ${years[years.length - 1]}` : ''}`] : []
  return [String(o.year), why, ...(part?.settlementPeriod ? [`aus Abrechnung ${part.settlementPeriod.label}`] : []),
    ...(part?.outsideSpan ? ['außerhalb der üblichen Spanne, bitte prüfen'] : []), ...spread].join(', ')
}
// `derived`: Zeilen der Steuerübersicht, die keine Position sind: der Ausgleich beim Betriebsstrom (#268), dessen Beleg
// die Stromrechnung ist, und die an einen Selbstversorger ausgezahlte CO₂-Erstattung (Heizung PR 19, Nachprüfung N-4),
// belegt durch die Auszahlung. Sie stehen in der Übersicht mit ihrem Betrag und ihrer Aufteilung, aber ohne Beleg.
// Dazu der Anteil einer Verteilung nach § 82b EStDV aus einem Vorjahr (#262, E-12): Sein Beleg liegt im Archiv des Jahres
// des Abflusses und wird hier nicht noch einmal beigelegt.
// Damit ergibt die Übersicht in jeder Spalte die Summe der Steuerübersicht.
export const derivedTaxLines = (report: Pick<TaxReport, 'expenses'>): TaxExpenseItem[] =>
  report.expenses.items.filter((i) => i.operatingPowerBalance || i.co2RefundPaidOut || i.spreadFrom)
const derivedNote = (d: TaxExpenseItem | undefined): string =>
  d?.spreadFrom ? `kein eigener Beleg (Anteil ${d.spreadFrom.index} von ${d.spreadFrom.of} aus ${d.spreadFrom.outflowYear}, Beleg im Steuer-ZIP ${d.spreadFrom.outflowYear})`
    : d?.co2RefundPaidOut ? 'kein eigener Beleg (Auszahlung an den Mieter, Nachweis über den Kontoauszug)' : 'kein eigener Beleg (Teil der Stromrechnung)'

//
// `parts`: die Teile je Quelle (#455) über alle Zeiträume des Objekts, auch die anderer Steuerjahre. Ein Teil einer
// aufgeteilten Rechnung ohne eigenen Beleg (keiner seiner Verweise liegt im Belegordner) nennt den Beleg seiner
// Rechnung, also die Dateien der anderen Teile derselben Quelle, und nimmt sie mit ins Archiv (#469); dieselbe Regel wie
// `isItemCovered` im Belegordner (client/src/receipts.ts), sonst hieße ein Teil dort belegt und hier „kein Beleg“.
// Liegt die Datei schon in der Gruppe, kommt sie nicht ein zweites Mal hinein. Kein Betrag ändert sich.
export function planTaxArchive(
  items: CostItem[], names: Map<string, string>, booked: ReadonlyMap<string, readonly string[]> = new Map(),
  split: ReadonlyMap<string, TaxSplitOfItem> = new Map(), derived: readonly TaxExpenseItem[] = [],
  parts: ReadonlyMap<string, readonly Pick<CostItem, 'id' | 'invoiceFile'>[]> = new Map(),
): TaxArchivePlan {
  const rank = (group: string) => GROUPS.indexOf(group)
  type Row = { c: Pick<CostItem, 'id' | 'category' | 'description' | 'vendor' | 'amountCents' | 'invoiceFile' | 'labor35aCents' | 'sourceId'>; derived: boolean }
  const filesOf = (x: Pick<CostItem, 'id' | 'invoiceFile'>): string[] => [x.invoiceFile, ...(booked.get(x.id) ?? [])].filter((f): f is string => !!f)
  const receiptsOf = (c: Row['c']): string[] => {
    const own = filesOf(c)
    if (!c.sourceId || own.some((f) => names.has(f))) return own
    const siblings = (parts.get(c.sourceId) ?? []).filter((x) => x.id !== c.id).flatMap(filesOf).filter((f) => names.has(f))
    return [...own, ...siblings]
  }
  const all: Row[] = [
    ...items.map((c) => ({ c, derived: false })),
    ...derived.map((d) => ({ c: { id: d.costItemId, category: d.category, description: d.description, amountCents: d.amountCents }, derived: true })),
  ]
  const sorted = all.sort((a, b) =>
    rank(taxGroupOf(a.c.category)) - rank(taxGroupOf(b.c.category)) ||
    a.c.category.localeCompare(b.c.category, 'de') ||
    Number(a.derived) - Number(b.derived) ||
    a.c.description.localeCompare(b.c.description, 'de'))

  const files: TaxArchivePlan['files'] = []
  const placed = new Map<string, string>() // Gruppe|Datei → Pfad im Archiv
  const taken = new Set<string>()
  const rows: string[] = []
  // Verbilligte Vermietung (#257): die Spalte „unentgeltlich“ nur, wenn es einen unentgeltlichen Teil gibt; sonst bliebe
  // Betrag − privat ≠ abziehbar unerklärt. Ohne ihn ist die Übersicht wie vorher.
  const withGratuitous = [...split.values()].some((p) => p.gratuitousCents)
  const gratuitousCol = (p: TaxSplitOfItem | undefined): string[] => (withGratuitous ? [p?.gratuitousCents ? csvField(euro(p.gratuitousCents)) : ''] : [])
  // Ebenso die Spalte „verteilt“ (#262, E-12): im Jahr des Abflusses der verschobene Teil, in Folgejahren der übernommene
  // mit Minus; dann gilt je Zeile Betrag = privat + unentgeltlich + verteilt + abziehbar.
  const withDeferred = [...split.values(), ...derived].some((p) => p.deferredCents)
  const deferredCol = (p: TaxSplitOfItem | undefined): string[] => (withDeferred ? [p?.deferredCents ? csvField(euro(p.deferredCents)) : ''] : [])
  for (const { c, derived: isDerived } of sorted) {
    const group = taxGroupOf(c.category)
    if (isDerived) {
      const part = derived.find((d) => d.costItemId === c.id)
      rows.push([
        textField(group), textField(c.category), textField(c.description), '', csvField(euro(c.amountCents)),
        part ? csvField(euro(part.privateCents)) : '', ...gratuitousCol(part), ...deferredCol(part), part ? csvField(euro(part.deductibleCents)) : '', '',
        textField(derivedNote(part)), textField(part?.spreadFrom ? `${part.spreadFrom.outflowYear}, Anteil ${part.spreadFrom.index} von ${part.spreadFrom.of}` : ''),
      ].join(';'))
      continue
    }
    const parts: string[] = []
    for (const file of new Set(receiptsOf(c))) {
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
    // Die Zuführung zur Rücklage steht nicht in der Steuerübersicht, wohl aber wegen ihres Jahres der Zahlung im Archiv
    // (Durchsicht von PR 4, K3): Jahr und Quelle dann aus `outflowShares`, derselben Stelle wie überall.
    const part = split.get(c.id)
    const stored = group === RESERVE_GROUP ? items.find((x) => x.id === c.id) : undefined
    const outflowPart = part ?? (stored ? reserveOutflow(stored) : undefined)
    // Derselbe Lohnanteil wie in der Steuerübersicht: ein ungültiger (über dem Betrag oder negativ)
    // zählt dort nicht, und hier steht er dann ebenso wenig (Integrationsdurchsicht vor 0.10).
    const labor = validLabor35aCents(c) ?? 0
    rows.push([
      textField(group), textField(c.category), textField(c.description), textField(c.vendor ?? ''), csvField(euro(c.amountCents)),
      part ? csvField(euro(part.privateCents)) : '', ...gratuitousCol(part), ...deferredCol(part), part ? csvField(euro(part.deductibleCents)) : '',
      csvField(labor ? euro(labor) : ''), textField(beleg), textField(outflowText(outflowPart)),
    ].join(';'))
  }
  const header = `Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);${withGratuitous ? 'unentgeltlich § 21 Abs. 2 EStG (EUR);' : ''}${withDeferred ? 'verteilt § 82b EStDV (EUR);' : ''}abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg;Jahr der Zahlung`
  return { files, overviewCsv: `﻿${[header, ...rows].join('\r\n')}\r\n` }
}

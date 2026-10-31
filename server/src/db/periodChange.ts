// Wechsel des Abrechnungszeitraums mit Vorschau (#208, Entwurf 3.6).
//
// Ein Objekt rechnet nach seinen Regeln ab (Beginnmonat und Wechsel, shared/period.ts). Ändern
// sich die Regeln, ändern sich Zeiträume, an denen Daten hängen: Kostenpositionen,
// Jahreskorrekturen, Abschlüsse, gewählte Zeiträume von Belegauswertungen. Diese Datei rechnet,
// was mit jeder dieser Zeilen geschieht, zeigt es vorher (Vorschau) und schreibt es dann in einer
// Transaktion, und zwar nur mit den Antworten, die die Vorschau verlangt.
//
// **Abgeschlossene Zeiträume sind unantastbar.** Hätte eine abgeschlossene Abrechnung nach dem
// Wechsel einen anderen Zeitraum, wird nicht gewechselt (409); wer das will, öffnet sie wieder
// (#56). Ein früherer Abschluss im Verlauf sperrt nur, wenn es seinen Zeitraum gar nicht mehr gäbe.
//
// **Eine tatsächlich gezahlte Summe lässt sich nicht auf Monate verteilen** (N4). Hat ein
// Mietverhältnis eine Jahreskorrektur und nach dem Wechsel Monate in mehr als einem Zeitraum oder
// in einem anders geschnittenen, fragt die Vorschau je neuem Zeitraum „tatsächlich gezahlt …“ und
// rechnet nicht. Liegen seine Monate unverändert in einem Zeitraum, wandert die Korrektur dorthin.
// Ohne Antwort würden sonst im Rumpf 2.400 € statt 800 € angerechnet (Testfall G-A1).
//
// **Kalte Rechnungen mit Leistungszeitraum werden nach Tagen aufgeteilt** (Entwurf 3.4, dieselbe
// Regel wie beim Speichern, serviceSplit.ts). Ohne Leistungszeitraum und bei Heizkosten (die nie
// nach Tagen geteilt werden) ordnet der Vermieter je bisherigem Zeitraum zu.
//
// Gelesen wird vor der Transaktion (die Lesefunktionen aus read.ts nehmen die Verbindung); die
// Schlange in open.ts lässt zwischen Lesen und Schreiben keine andere Anfrage herein.

import crypto from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { SPLIT_FIELDS, SPLIT_SUFFIX, splitBlocker } from '../../../shared/splitPart.ts'
import { plantRules, settledSeparately } from '../../../shared/heatingPeriod.ts'
import {
  formatDayRange, parsePeriodKey, periodContaining, periodLabel, periodMonths, periodOfKey, periodsBetween, rulesOf, settlementDeadline, spansTwoYears,
} from '../../../shared/period.ts'
import type { BillingPeriod, CostItem, PeriodChangePreview, PeriodEffect, PeriodKey, PeriodRules, Property, Tenancy } from '../../../shared/types.ts'
import { baseDescription, deriveSourceParts, splitByService, splitDeductionsAlike, type ServicePart } from '../serviceSplit.ts'
import type { Database, Transaction } from './client.ts'
import { readClosedSettlements, readCostItems, readFuelDeliveries, readHeatingPlants, readProperties, readStock, readTenancies, readUnits } from './read.ts'
import { tenancyMonths } from '../calc.ts'
import { dryRun, earliestTenancyStart, lostClaims, outcomeOf } from './dryRun.ts'
import { dropEmptySource, HeatingError, insertCostSource, PeriodConflict, PeriodError, rewriteCostItemFamily, settleOperatingPowerLinks, writeCostItemParts } from './repository.ts'
import { assessmentLines, assessments, closedSettlementHistory, costItems, periodChanges, prepaymentOverrides, properties } from './schema.ts'
import { GENERAL_POWER_CATEGORY } from '../../../shared/operatingPower.ts'
import { droppedLettersText, dropLetterDocs, letterDocPrefix, letterDocsWithPrefix } from './letters.ts'
import { euro } from '../../../shared/costItem.ts'
import { storedOutflowYear } from '../outflow.ts'
import { paidOnSpan } from '../../../shared/paidOn.ts'

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const monthName = (key: string): string => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7)} ${key.slice(0, 4)}`

// Monate in Worten: „01–04/2025“, über den Jahreswechsel „05/2025–04/2026“, ein Monat „03/2025“.
export function monthsText(months: readonly string[]): string {
  const first = months[0]
  const last = months[months.length - 1]
  if (first === undefined || last === undefined) return ''
  const mm = (m: string) => m.slice(5, 7)
  const yy = (m: string) => m.slice(0, 4)
  if (first === last) return `${mm(first)}/${yy(first)}`
  return yy(first) === yy(last) ? `${mm(first)}–${mm(last)}/${yy(first)}` : `${mm(first)}/${yy(first)}–${mm(last)}/${yy(last)}`
}

// Die neuen Regeln aus dem Rumpf, geprüft. Ein Wechsel auf einen Monat, in dem ohnehin ein
// Zeitraum beginnt, ist keiner: Es entstünde kein Rumpf, und die Liste hätte einen toten Eintrag.
export function checkRules(raw: unknown): PeriodRules {
  if (raw === null || typeof raw !== 'object') throw new PeriodError('Bitte geben Sie den Rhythmus an: den Monat des Beginns und die Wechsel.')
  const startMonth: unknown = Reflect.get(raw, 'startMonth')
  const changes: unknown = Reflect.get(raw, 'changes')
  if (typeof startMonth !== 'number' || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new PeriodError('Der Abrechnungszeitraum beginnt in einem Monat von Januar bis Dezember.')
  }
  if (!Array.isArray(changes)) throw new PeriodError('Bitte geben Sie den Rhythmus an: den Monat des Beginns und die Wechsel.')
  const keys: PeriodKey[] = []
  for (const c of changes) {
    const key = parsePeriodKey(c)
    if (key === null) throw new PeriodError(`„${String(c)}“ ist kein Monat (JJJJ-MM).`)
    if (!keys.includes(key)) keys.push(key)
  }
  keys.sort()
  const rules: PeriodRules = { startMonth, changes: [] }
  for (const key of keys) {
    if (periodContaining(rules, `${key}-01`).from === `${key}-01`) {
      throw new PeriodError(`Ab ${monthName(key)} beginnt ohnehin ein Abrechnungszeitraum; ein Wechsel dorthin ändert nichts.`)
    }
    rules.changes.push(key)
  }
  return rules
}

type Status = 'same' | 'grows' | 'shrinks' | 'gone'
type Affected = { key: PeriodKey; old: BillingPeriod; now: BillingPeriod | null; status: Status }

function affectedOf(before: PeriodRules, next: PeriodRules, key: PeriodKey): Affected | null {
  const old = periodOfKey(before, key)
  // Ein Schlüssel ohne Zeitraum ist verwaist; das Wiederherstellen lehnt ihn ab (orphanPeriodKeys).
  if (old === null) return null
  const now = periodOfKey(next, key)
  const status: Status = now === null ? 'gone'
    : now.from === old.from && now.to === old.to ? 'same'
      : now.from <= old.from && now.to >= old.to ? 'grows' : 'shrinks'
  return { key, old, now, status }
}


const MS_DAY = 86400000
const overlapDays = (a: BillingPeriod, b: BillingPeriod): number => {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from > to ? 0 : Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY) + 1
}

// Der neue Zeitraum für Daten eines bisherigen: derselbe Schlüssel, wenn es ihn noch gibt, sonst
// der mit der größten Überschneidung, bei Gleichstand der frühere.
function bestFor(a: Affected, options: readonly BillingPeriod[]): BillingPeriod {
  if (a.now !== null && options.some((p) => p.key === a.now?.key)) return a.now
  let best = options[0] ?? a.old
  for (const p of options) if (overlapDays(p, a.old) > overlapDays(best, a.old)) best = p
  return best
}

type Group = { from: PeriodKey; old: BillingPeriod; heating: boolean; amounts: boolean; items: CostItem[]; options: BillingPeriod[]; split: Map<string, ServicePart[]> | null }

// Das Jahr der Zahlung, das eine Position heute für die Steuer hat (Entwurf 3.10), aus derselben Stelle wie die
// Steuerübersicht (`storedOutflowYear` in outflow.ts, #255): das gespeicherte, sonst das Kalenderjahr ihres Zeitraums.
// Gefragt wird es nur für Positionen, die kein Abzug beim Betriebsstrom sind (`followsBill`).
const effectiveTaxYear = (item: CostItem): number => storedOutflowYear(item)

// Ein Abzug beim Betriebsstrom hat kein eigenes Jahr der Zahlung (#267): Er steht im Jahr seiner Stromrechnung
// (outflow.ts) und folgt ihr beim Wechsel ohnehin in jeden Zeitraum. Die Vorschau fragt deshalb kein Jahr für ihn, und
// in den Sätzen zur Verschiebung zählt er nicht: Wechselt die Rechnung das Jahr, wechselt er mit, und der Ausgleich beim
// Betriebsstrom (#268) hält die Werbungskosten jedes Jahres bei der bezahlten Rechnung.
const followsBill = (item: Pick<CostItem, 'operatingPower'>): boolean => item.operatingPower === 'deduction'

// Eine Position mit Zahlungsdatum (#255 PR 3) behält ihr Steuerjahr in jedem Zeitraum: Das Datum bleibt beim Wechsel
// stehen und geht dem Jahr der Zahlung vor (outflow.ts). Die Vorschau fragt für sie kein Jahr, kündigt keine
// Verschiebung an und wählt die Vorgabe nicht danach (Durchsicht von PR 3, S1).
//
// #478: Ebenso eine Position mit angegebenem Jahr der Zahlung. Das Jahr ist eine Tatsache über die Zahlung (§ 11 Abs. 2
// Satz 1 EStG, bei einer Gutschrift der Zufluss nach Abs. 1 Satz 1), am Abrechnungszeitraum hängt es nicht. Vorher bekam
// ein Teil in einem Zeitraum innerhalb eines Kalenderjahres still dessen Jahr, und hin und zurück kehrte es nicht wieder.
const keepsTaxYear = (item: Pick<CostItem, 'operatingPower' | 'paidOn' | 'taxYear'>): boolean =>
  followsBill(item) || item.paidOn !== undefined || item.taxYear !== undefined

// Das gehaltene Jahr der Zahlung (#478): das gespeicherte, wenn eines angegeben ist, sonst `null`. Alle drei Stellen,
// die das Jahr im Ziel bestimmen (Vorschau, Probelauf, Schreiben), fragen zuerst hier; erst danach die Antwort der
// Vorschau bzw. ihre Vorgabe. Gleich dem Kalenderjahr des Ziels bleibt es trotzdem gespeichert: Es ist eine Angabe des
// Vermieters, und Zurückwechseln braucht sie. Beim Abzug beim Betriebsstrom keines (#267, `mergeCostItem` leert es).
const keptTaxYear = (item: Pick<CostItem, 'operatingPower' | 'taxYear'>): number | null =>
  followsBill(item) ? null : item.taxYear ?? null

// Eine kalte Rechnung mit Leistungszeitraum, die der Wechsel nach Tagen neu teilt (#455, Entwurf „Wechsel des
// Rhythmus“). Mit Quelle: `family` sind die bewegten Teile (Zeitraum `shrinks` oder `gone`), `standing` die übrigen
// Teile derselben Quelle (`same` oder `grows`), `parts` die Teile der bewegten Summe. Ohne Quelle: der Teil allein,
// geteilt über seinen Teil des Leistungszeitraums wie bisher; `newSource`, wenn er dabei mehrere Teile ergibt.
// `wholeFamily` (#471, Durchsicht I1): Alle Teile der Quelle, stehende und bewegte, decken zusammen den Leistungszeitraum
// (je Teil sein Leistungszeitraum im bisherigen Zeitraum). Nur dann trägt eine einzige verbleibende Zeile die ganze
// Rechnung; fehlt ein früher gelöschter Teil, bleibt der Zusatz „(anteilig …)“.
type Split = { item: CostItem; parts: ServicePart[]; family?: CostItem[]; standing?: CostItem[]; sourceId?: string; newSource?: boolean; wholeFamily?: boolean }

// Felder, die beim Zusammenfassen nicht zählen (#455, M1): je Teil gesetzt (`part` in SPLIT_FIELDS), in einer Quelle
// gleich (Objekt, Leistungszeitraum, Quelle), schon geprüft (Zahlungsdatum) oder ohne Einfluss auf die Verteilung
// (Rechnungssteller, Beleg; den Beleg übernimmt der stehende Teil, `heir`). Jedes übrige Feld, auch ein neues, muss
// gleich sein: Schlüssel, Teilnehmer, Direktzuordnung, Zählertyp, vereinbarte Anteile, nicht vereinbart, Einzelbeträge,
// Gemeinschaftsabrechnung, Heizung und Betriebsstrom.
const MERGE_IGNORED = new Set<string>(['propertyId', 'serviceFrom', 'serviceTo', 'sourceId', 'paidOn', 'vendor', 'invoiceFile'])
const ALLOCATION_FIELDS = (Object.keys(SPLIT_FIELDS) as (keyof typeof SPLIT_FIELDS)[])
  .filter((f) => SPLIT_FIELDS[f] !== 'part' && !MERGE_IGNORED.has(f))

// Gleich heißt hier: derselbe Wert, Listen als Mengen (Reihenfolge ohne Bedeutung), leer wie nicht angegeben.
const allocationValue = (v: unknown): unknown => {
  if (v === null || v === undefined) return undefined
  if (Array.isArray(v)) return v.length === 0 ? undefined : JSON.stringify([...v].map((x) => JSON.stringify(x)).sort())
  if (typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined && x !== null).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return entries.length === 0 ? undefined : JSON.stringify(entries)
  }
  return v
}
const sameAllocation = (a: CostItem, b: CostItem): boolean => ALLOCATION_FIELDS.every((f) => allocationValue(a[f]) === allocationValue(b[f]))

type YearIn = (target: BillingPeriod, item: CostItem) => number | null

const dayAfter = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
// Ob die Spannen den ganzen Leistungszeitraum der Rechnung lückenlos decken (#471).
function coversService(c: Pick<CostItem, 'serviceFrom' | 'serviceTo'>, spans: readonly { from: string; to: string }[]): boolean {
  if (c.serviceFrom === undefined || c.serviceTo === undefined) return true
  let next = c.serviceFrom
  for (const s of [...spans].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) {
    if (s.from > next) return false
    if (s.to >= next) next = dayAfter(s.to)
  }
  return next > c.serviceTo
}

// Ob eine Zeile die ganze Rechnung trägt (#471): Ihr Leistungszeitraum liegt ganz in ihrem Zeitraum. Dann gehört der
// Zusatz „(anteilig …)“ nicht mehr an die Beschreibung, wenn ihr die Quelle als einzige Zeile bleibt.
function carriesWholeInvoice(rules: PeriodRules, c: { period: PeriodKey; serviceFrom?: string | null; serviceTo?: string | null }): boolean {
  const p = periodOfKey(rules, c.period)
  return p !== null && typeof c.serviceFrom === 'string' && typeof c.serviceTo === 'string' && c.serviceFrom >= p.from && c.serviceTo <= p.to
}

// Der stehende Teil, zu dem ein Ergebnis kommt, statt eine zweite Zeile im selben Zeitraum anzulegen (#455,
// „Zusammenfassen“): derselbe Zeitraum, dasselbe Zahlungsdatum und nach dem Wechsel dasselbe Jahr der Zahlung, sonst
// wechselten Werbungskosten das Jahr. Das Jahr eines stehenden Teils ist die Antwort, wenn die Vorschau es fragt (ein
// Zeitraum, der wächst und danach über zwei Kalenderjahre reicht), sonst das gespeicherte; das des Ergebnisses die
// Antwort für den führenden Teil, sonst das Jahr, das es ohne Angabe hätte (Zahlungsdatum oder Beginn des Zeitraums).
// Durchsicht von PR 2 zu #455, M1: dazu dieselbe Verteilung (`sameAllocation`), sonst verteilte ein einzeln berichtigter
// Teil den hinzukommenden Anteil nach seinem Schlüssel und nicht nach dem der Rechnung.
//
// Integrationsdurchsicht zu #455, I1: `earlier` sind die eigenen Zeilen, die eine frühere Rechnung derselben Quelle mit
// anderem bisherigem Jahr (`poolOf`) in diesem Wechsel schon anlegt. Haben sie danach dasselbe Jahr, kommt der Anteil
// zu ihnen; so gibt es auch dann je Zeitraum und Jahr nur eine Zeile (Invariante 2).
function mergeTargetOf(split: Split, part: ServicePart, yearIn: YearIn, earlier: readonly CostItem[] = []): CostItem | undefined {
  const movedYear = movedYearOf(split, part, yearIn)
  return mergeCandidates(split, part, earlier).find((s) => yearOf(part, s, yearIn) === movedYear)
}
const movedYearOf = (split: Split, part: ServicePart, yearIn: YearIn): number =>
  yearIn(part.period, split.item) ?? storedOutflowYear({ ...split.item, period: part.period.key, taxYear: undefined })
const yearOf = (part: ServicePart, s: CostItem, yearIn: YearIn): number => yearIn(part.period, s) ?? storedOutflowYear(s)
// Die Zeilen derselben Quelle, zu denen der Anteil kommen könnte, ohne Rücksicht auf das Jahr der Zahlung: stehende Teile
// nach Kennung, dann die eigenen Zeilen einer früheren Rechnung derselben Quelle.
function mergeCandidates(split: Split, part: ServicePart, earlier: readonly CostItem[]): CostItem[] {
  const lead = split.item
  const fits = (s: CostItem): boolean => s.period === part.period.key && s.paidOn === lead.paidOn && sameAllocation(s, lead)
  const byId = (a: CostItem, b: CostItem): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return [...(split.standing ?? []).filter(fits).sort(byId), ...earlier.filter(fits)]
}

// Befund 3 zu #455: Der Name eines stehenden Teils, zu dem Anteile kommen. Vorher behielt er seinen Zusatz, und nach hin
// und zurück hieß eine Zeile über 10/2025–06/2026 „Gebäudeversicherung (anteilig 01.10.–31.12.2025)“. Der Zusatz nennt
// danach, was die Zeile trägt: ihre bisherige Spanne (Leistungszeitraum im bisherigen Zeitraum) und die jedes Anteils
// (`span`). Stoßen die Spannen aneinander oder überlappen sie, eine Spanne vom ersten bis zum letzten Tag wie bei einem
// frisch geteilten Teil; liegt eine Lücke dazwischen (ein Teil wurde gelöscht, Durchsicht M1), jede für sich
// („01.01.–30.04. und 01.09.–31.12.2025“), sonst nennte der Zusatz Tage, die die Zeile nicht trägt.
//
// Je Wechsel ein Namensgeber, denn mehrere Rechnungen derselben Quelle können zum selben Teil kommen; Vorschau und
// Schreiben rufen ihn in derselben Reihenfolge. Eine Zeile, die eine frühere Rechnung derselben Quelle in diesem Wechsel
// erst anlegt (`earlier`, Durchsicht M2), hat keinen bisherigen Zeitraum; ihre Spanne meldet `seed` beim Anlegen. Eine
// Zeile ohne bekannte Spanne und eine ohne Zusatz (von Hand umbenannt) behalten ihren Namen. Trägt die Zeile danach als
// einzige die ganze Rechnung, streicht das Schreiben den Zusatz ohnehin (#471). `record: false` fragt nur
// (`mergeWithYear`: zusammengefasst erst mit anderem Jahr) und merkt sich nichts, denn mit dem vorbelegten Jahr kommt der
// Anteil nicht dazu.
type Span = { from: string; to: string }
type MergedNamer = {
  name: (target: CostItem, part: ServicePart, description?: string, record?: boolean) => string
  seed: (id: string, period: PeriodKey, span: Span | undefined) => void
  // #478: Zwei Zeilen derselben Quelle im selben Zeitraum werden eine; der Zusatz nennt die Spannen beider.
  fold: (target: CostItem, other: CostItem, description: string) => string
}
function mergedNamer(before: PeriodRules, standingIds: ReadonlySet<string>): MergedNamer {
  const spans = new Map<string, Span[]>()
  const keyOf = (id: string, period: PeriodKey): string => `${id}|${period}`
  const ownSpan = (target: CostItem): Span | undefined => {
    if (!standingIds.has(target.id)) return undefined
    const old = periodOfKey(before, target.period)
    if (old === null || target.serviceFrom === undefined || target.serviceTo === undefined) return undefined
    return target.serviceFrom <= old.to && target.serviceTo >= old.from
      ? { from: target.serviceFrom > old.from ? target.serviceFrom : old.from, to: target.serviceTo < old.to ? target.serviceTo : old.to }
      : { from: target.serviceFrom, to: target.serviceTo }
  }
  const spansOf = (c: CostItem): Span[] | undefined => {
    const first = ownSpan(c)
    return spans.get(keyOf(c.id, c.period)) ?? (first === undefined ? undefined : [first])
  }
  return {
    seed: (id, period, span) => {
      if (span !== undefined) spans.set(keyOf(id, period), [span])
    },
    fold: (target, other, description) => {
      const a = spansOf(target)
      const b = spansOf(other)
      if (a === undefined || b === undefined || !SPLIT_SUFFIX.test(description)) return description
      const merged = unionSpans([...a, ...b])
      spans.set(keyOf(target.id, target.period), merged)
      return `${baseDescription(description)} (anteilig ${spansText(merged)})`
    },
    name: (target, part, description = target.description, record = true) => {
      const key = keyOf(target.id, target.period)
      const first = ownSpan(target)
      const own = spans.get(key) ?? (first === undefined ? undefined : [first])
      if (own === undefined || part.span === undefined || !SPLIT_SUFFIX.test(description)) return description
      const merged = unionSpans([...own, part.span])
      if (record) spans.set(key, merged)
      return `${baseDescription(description)} (anteilig ${spansText(merged)})`
    },
  }
}

// Spannen sortiert und zusammengefasst, wo sie überlappen oder aneinanderstoßen.
function unionSpans(list: readonly Span[]): Span[] {
  const out: Span[] = []
  for (const s of [...list].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) {
    const last = out[out.length - 1]
    if (last !== undefined && s.from <= dayAfter(last.to)) last.to = s.to > last.to ? s.to : last.to
    else out.push({ ...s })
  }
  return out
}

// „01.01.–30.04. und 01.09.–31.12.2025“: jede Spanne wie `formatDayRange`; liegen alle in einem Jahr, steht es nur am Ende.
function spansText(list: readonly Span[]): string {
  const texts = list.map((s) => formatDayRange(s.from, s.to))
  const first = list[0]
  const last = list[list.length - 1]
  const year = last?.to.slice(0, 4)
  const oneYear = first !== undefined && year !== undefined && first.from.slice(0, 4) === year
  const shown = texts.map((t, i) => (oneYear && i < texts.length - 1 && t.endsWith(year) ? t.slice(0, -year.length) : t))
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} und ${shown[shown.length - 1]}`
}

// Die eigene Zeile, die ein Teil ergibt, für die Vorschau: Felder des führenden Teils, Zeitraum, Betrag und Beschreibung
// des Teils, das Jahr der Zahlung aus `yearIn`. Mit der Kennung des führenden Teils findet `yearIn` dessen Frage.
function producedRow(lead: CostItem, part: ServicePart, yearIn: YearIn): CostItem {
  const { taxYear: _was, ...rest } = lead
  const year = yearIn(part.period, lead)
  const row = { ...rest, period: part.period.key, amountCents: part.amountCents, description: part.description }
  return year === null ? row : { ...row, taxYear: year }
}

type OverrideAsk = { tenancy: Tenancy; drop: Set<PeriodKey>; from: { key: PeriodKey; label: string; cents: number }[]; ask: Map<PeriodKey, { period: BillingPeriod; months: string[] }> }

type Plan = {
  preview: PeriodChangePreview
  splits: Split[]
  // Je Gruppe (Laienprobe B2): kalte Kosten und Heizkosten eines bisherigen Zeitraums getrennt, die
  // kalten mit den Teilen, in die sie nach Tagen aufgeteilt würden.
  groups: Map<string, Group>
  overrideRekeys: { tenancyId: string; from: PeriodKey; to: PeriodKey }[]
  overrideAsks: OverrideAsk[]
  assessmentMoves: { id: string; to: PeriodKey }[]
  // Integrationsdurchsicht zu #415: die Schlüssel der Anschreiben je Mieter, deren Zeitraum sich ändert.
  letterDocs: string[]
  // Positionen eines Zeitraums, der nur wächst und danach über zwei Kalenderjahre reicht (M4).
  regrows: { item: CostItem; target: BillingPeriod }[]
  // Abzüge des Betriebsstroms, deren Stromrechnung einen Leistungszeitraum hat (Folge-PR zu #252, Geld-K1): Sie
  // folgen dem Endzustand ihrer Rechnung, gemeinsam geteilt (`splitDeductionsAlike`), und stehen in keiner Gruppe.
  follows: { item: CostItem; parts: ServicePart[] }[]
  taxEntries: Map<string, PeriodChangePreview['taxYears'][number]>
  next: PeriodRules
  before: PeriodRules
}

// Das Jahr der Zahlung einer Position in einem Zeitraum über zwei Kalenderjahre (Entwurf 3.10,
// Durchsicht von #226, I1): zur Wahl steht vom Jahr des Beginns bis ein Jahr nach dem Ende. Gefragt
// wird seit #478 nur für Positionen ohne Datum und ohne Jahr; die Schreibprüfung in repository.ts
// lässt die weitere übliche Spanne zu (`paidOnSpan`), die Auswahl hier bleibt die engere. Vorbelegt
// wird das bisherige Jahr, sonst das Kalenderjahr, in dem ihr bisheriger Zeitraum begann, und zwar in
// die Auswahl geklemmt.
const taxKey = (item: Pick<CostItem, 'id'>, p: Pick<BillingPeriod, 'key'>): string => `${item.id}|${p.key}`
function taxEntry(item: CostItem, p: BillingPeriod): PeriodChangePreview['taxYears'][number] {
  const start = Number(p.from.slice(0, 4))
  const end = Number(p.to.slice(0, 4)) + 1
  const was = effectiveTaxYear(item)
  return {
    key: taxKey(item, p), costItemId: item.id, description: item.description, period: p.key, label: periodLabel(p),
    suggested: Math.min(Math.max(was, start), end), options: Array.from({ length: end - start + 1 }, (_, i) => start + i),
  }
}

// Die Marke einer Vorschau (M2): alles, was der Wechsel schreibt oder fragt. Der Zeitraum der Liste
// hängt am heutigen Tag und gehört nicht dazu.
function tokenOf(p: Omit<PeriodChangePreview, 'token' | 'periods'>): string {
  return crypto.createHash('sha256').update(JSON.stringify([p.rules, p.newShort, p.blocked, p.moves, p.groups, p.overrides, p.assessments, p.taxYears, p.letters ?? [], p.keptTaxYears])).digest('hex')
}

// Was zwischen Steuerjahren wechselt (#478, E3): je Jahr der Betrag vorher und nachher; was in einem Jahr fehlt, kommt
// in ein Jahr, das mehr hat, in der Folge der Jahre. `null`, wenn jedes Jahr seinen Betrag behält.
function yearShiftText(was: ReadonlyMap<number, number>, now: ReadonlyMap<number, number>): string | null {
  const years = [...new Set([...was.keys(), ...now.keys()])].sort((a, b) => a - b)
  const out = years.flatMap((y) => {
    const d = (was.get(y) ?? 0) - (now.get(y) ?? 0)
    return d > 0 ? [{ year: y, cents: d }] : []
  })
  const into = years.flatMap((y) => {
    const d = (now.get(y) ?? 0) - (was.get(y) ?? 0)
    return d > 0 ? [{ year: y, cents: d }] : []
  })
  const moves: string[] = []
  for (const from of out) {
    for (const to of into) {
      const cents = Math.min(from.cents, to.cents)
      if (cents <= 0) continue
      moves.push(`${euro(cents)} aus dem Jahr der Zahlung ${from.year} nach ${to.year}`)
      from.cents -= cents
      to.cents -= cents
    }
  }
  return moves.length === 0 ? null
    : `Für die Steuer kämen ${moves.join(', ')}, obwohl sich an der Zahlung nichts ändert. Prüfen Sie danach das Jahr der Zahlung der Teile.`
}

// Positionen, die ihr angegebenes Jahr der Zahlung behalten (#478, E1) und danach in einem Zeitraum stehen, dessen
// Kalenderjahre es nicht enthalten: In der Steuerübersicht stehen sie dann als verschoben (`shiftNotes`), und die
// Vorschau sagt es vorher. Liegt das Jahr außerhalb der üblichen Spanne des Ziels (`paidOnSpan`), sagt der Satz das
// dazu; gefragt wird beim Wechsel nicht (E2). Bei einer Gruppe je wählbarem Zeitraum ein Eintrag (wie `taxYears`).
function keptTaxYearsOf(splits: readonly Split[], groups: ReadonlyMap<string, Group>, regrows: readonly { item: CostItem; target: BillingPeriod }[]): PeriodChangePreview['keptTaxYears'] {
  const out = new Map<string, PeriodChangePreview['keptTaxYears'][number]>()
  const note = (item: CostItem, target: BillingPeriod, description: string) => {
    const year = keptTaxYear(item)
    if (year === null || item.paidOn !== undefined) return
    const startYear = Number(target.from.slice(0, 4))
    const endYear = Number(target.to.slice(0, 4))
    if (year >= startYear && year <= endYear) return
    const key = taxKey(item, target)
    if (out.has(key)) return
    const label = periodLabel(target)
    const span = paidOnSpan({ startYear, endYear })
    const outside = year < span.from || year > span.to
      ? ` Das Jahr liegt außerhalb der üblichen Spanne von ${span.from} bis ${span.to} für diesen Zeitraum; bitte prüfen Sie es.`
      : ''
    out.set(key, {
      costItemId: item.id, description, taxYear: year, period: target.key, label,
      text: `„${description}“ behält das Jahr der Zahlung ${year}; im Zeitraum ${label} steht sie für die Steuer deshalb als verschoben.${outside}`,
    })
  }
  for (const split of splits) for (const p of split.parts) note(split.item, p.period, split.family ? baseDescription(split.item.description) : split.item.description)
  for (const g of groups.values()) for (const o of g.options) for (const item of g.items) note(item, o, item.description)
  for (const { item, target } of regrows) note(item, target, item.description)
  return [...out.values()]
}

// Eine Stromrechnung mit Leistungszeitraum, die der Wechsel nicht teilt, bleibt ganz in ihrem Zeitraum (K1).
function stayingParts(next: PeriodRules, g: CostItem): ServicePart[] {
  const p = periodOfKey(next, g.period)
  return p === null ? [] : [{ period: p, days: overlapDays(p, p), amountCents: g.amountCents, labor35aCents: null, description: g.description }]
}

async function planPeriodChange(db: Database, propertyId: string, rawRules: unknown, today: string): Promise<Plan | null> {
  const property = (await readProperties(db)).find((p) => p.id === propertyId)
  if (!property) return null
  const next = checkRules(rawRules)
  const before = rulesOf(property)
  if (before.startMonth === next.startMonth && before.changes.join() === next.changes.join()) {
    throw new PeriodError('Es ändert sich nichts: Der Abrechnungszeitraum ist schon so eingestellt.')
  }
  const unitIds = new Set((await readUnits(db)).filter((u) => u.propertyId === propertyId).map((u) => u.id))
  const tenancies = (await readTenancies(db)).filter((t) => unitIds.has(t.unitId))
  const items = (await readCostItems(db)).filter((c) => c.propertyId === propertyId)
  // Heizung PR 5: Heizpositionen einer Anlage mit eigener Heizperiode tragen deren Schlüssel und
  // bleiben beim Wechsel des Objektzeitraums, wo sie sind; in welcher Abrechnung ihre Heizperiode
  // steht, ergibt sich danach von selbst (Entwurf 3.0).
  const plants = (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)
  const ownPlantIds = new Set(plants.filter((p) => p.periodStartMonth !== null).map((p) => p.id))
  // Abdeckung V20: das Rechnungsende je Brennstoffrechnung, wie es die Prüfung beim Speichern liest (repository.ts).
  const deliveryEnd = new Map((await readFuelDeliveries(db)).map((d) => [d.id, d.invoiceTo ?? d.deliveredAt]))
  const requiredPeriodOf = (item: CostItem): PeriodKey | null => {
    if (!item.fuelDeliveryId || !item.heatingPlantId || ownPlantIds.has(item.heatingPlantId)) return null
    const end = deliveryEnd.get(item.fuelDeliveryId)
    return end ? periodContaining(next, end).key : null
  }
  const closed = (await readClosedSettlements(db)).filter((c) => c.propertyId === propertyId)
  const history = await db.select({ period: closedSettlementHistory.period }).from(closedSettlementHistory).where(eq(closedSettlementHistory.propertyId, propertyId))
  const assessmentRows = await db.select({ id: assessments.id, file: assessments.file, period: assessments.requestedPeriod }).from(assessments).where(eq(assessments.propertyId, propertyId))
  // Positionen mit gebuchten Belegzeilen (Review der Laienprobe, Runde 1): Ihr Betrag ist die Summe
  // der Zeilen (Summenregel der Belegbuchung); geteilt stünde ein Teil gegen die ganze Summe.
  const bookedIds = new Set((await db.select({ id: assessmentLines.costItemId }).from(assessmentLines)).flatMap((r) => (r.id === null ? [] : [r.id])))

  const memo = new Map<PeriodKey, Affected | null>()
  const changed = (key: PeriodKey): Affected | null => {
    if (!memo.has(key)) memo.set(key, affectedOf(before, next, key))
    const a = memo.get(key) ?? null
    return a !== null && a.status !== 'same' ? a : null
  }
  const optionsFor = (a: Affected): BillingPeriod[] => periodsBetween(next, a.old.from, a.old.to)

  const blocked = new Set<string>()
  for (const c of closed) {
    const a = changed(c.period)
    if (a) blocked.add(`Die Abrechnung ${periodLabel(a.old)} ist abgeschlossen; nach dem Wechsel hätte sie einen anderen Zeitraum. Öffnen Sie sie wieder, wenn Sie den Wechsel so wollen, oder wählen Sie einen späteren Beginn.`)
  }
  for (const h of history) {
    const a = changed(h.period)
    if (a?.status === 'gone') blocked.add(`Für ${periodLabel(a.old)} gibt es frühere Abschlüsse im Verlauf; diesen Zeitraum gäbe es nach dem Wechsel nicht mehr. Wählen Sie einen späteren Beginn.`)
  }
  // Heizung PR 5: Ob eine Heizperiode getrennt abgerechnet wird, hängt auch am Objektzeitraum (bei
  // H = P gibt es eine Gesamtabrechnung, Entwurf 3.1). Ein Wechsel, der das für eine Heizperiode
  // umschaltet, ginge an der Vorschau der Heizung vorbei, die die Vorauszahlungen aufteilt.
  for (const plant of plants) {
    const first = plant.separateSpans[0]
    if (plant.periodStartMonth === null || first === undefined) continue
    const rules = plantRules(plant, before)
    for (const h of periodsBetween(rules, `${first.from}-01`, `${Number(today.slice(0, 4)) + 2}-12-31`)) {
      const vorher = settledSeparately(plant, before, h)
      if (vorher === settledSeparately(plant, next, h)) continue
      blocked.add(
        `Die Heizkosten ${periodLabel(h)}${plant.name ? ` der Heizanlage „${plant.name}“` : ''} würden nach dem Wechsel ${vorher ? 'nicht mehr getrennt' : 'getrennt'} abgerechnet. ` +
          'Stellen Sie zuerst unter Stammdaten → Heizung den Zeitraum der Heizung oder die getrennte Heizkostenabrechnung um; dort zeigt eine Vorschau, was mit den Vorauszahlungen geschieht.',
      )
      break
    }
  }

  const splits: Plan['splits'] = []
  const groups: Plan['groups'] = new Map()
  const regrows: Plan['regrows'] = []
  // Die Teile einer Quelle (#455): Die Familie sagt allein `sourceId`, gleich in welchem Zeitraum. Teile in einem
  // Zeitraum, der bleibt oder wächst, stehen fest (ein berichtigter Betrag bleibt so an seinem Teil); die übrigen
  // gehen mit ihrer Summe und ihren Spannen (Leistungszeitraum im bisherigen Zeitraum) in `deriveSourceParts`, als
  // eine Rechnung. Jeden Teil einzeln zu teilen, summierte die Rundungen (Nachprüfung von #226, 2), und Teile in einem
  // Zeitraum ergäben je eine eigene Zeile (die Zeilenvermehrung aus #455).
  const bySource = new Map<string, CostItem[]>()
  for (const c of items) if (c.sourceId !== undefined) bySource.set(c.sourceId, [...(bySource.get(c.sourceId) ?? []), c])
  // Integrationsdurchsicht zu #455, I1: Stehen bewegte Teile im selben Zeitraum (aus dem Datenschritt, oder das
  // Zusammenfassen ließ sie wegen verschiedener Jahre getrennt), zählen sie nur zusammen, wenn sie dasselbe Jahr der
  // Zahlung und dasselbe Zahlungsdatum haben. Sonst bekämen alle das Jahr des führenden Teils (gefragt wird nur nach
  // ihm), und Werbungskosten wechselten das Jahr, ohne dass sich an der Zahlung etwas ändert. Je Jahr und Zahlungsdatum
  // dann eine eigene Rechnung mit eigenem führendem Teil und eigener Frage. Liegt jeder bewegte Teil in einem anderen
  // Zeitraum, bleibt es eine Rechnung wie vor dem Umbau (`wholeInvoice`, Invariante 4).
  const sourceSplit = (sourceId: string): Split[] => {
    const family = bySource.get(sourceId) ?? []
    const isMoving = (m: CostItem): boolean => {
      const am = changed(m.period)
      return am !== null && am.status !== 'grows'
    }
    const allMoving = family.filter(isMoving).sort((x, y) => (x.period < y.period ? -1 : x.period > y.period ? 1 : x.id < y.id ? -1 : 1))
    const standing = family.filter((m) => !isMoving(m))
    const shared = new Set(allMoving.map((m) => m.period)).size < allMoving.length
    // #478: Ebenso, wenn bewegte Teile mit Datum oder angegebenem Jahr verschiedene Jahre haben (etwa zwei Abschläge,
    // 2025 und 2026 bezahlt): Als eine Rechnung bekämen alle Teile das gehaltene Jahr des führenden Teils, und ein
    // angegebenes Jahr wanderte.
    const yearKey = (m: CostItem): string => `${m.paidOn ?? ''}|${storedOutflowYear(m)}`
    const keptApart = allMoving.some(keepsTaxYear) && new Set(allMoving.map(yearKey)).size > 1
    const poolOf = (m: CostItem): string => (shared || keptApart ? yearKey(m) : '')
    const pools = new Map<string, CostItem[]>()
    for (const m of allMoving) pools.set(poolOf(m), [...(pools.get(poolOf(m)) ?? []), m])
    // Führend ist in jeder Rechnung ein Teil mit angegebenem Jahr, wenn es einen gibt (#478): Sein Jahr hält die ganze
    // Rechnung, und es ist das wirksame Jahr jedes ihrer Teile (gleiches Jahr je Rechnung, oben). Mit einem Teil ohne
    // Angabe vorn bekäme ein Teil im anderen Kalenderjahr dessen Jahr statt des angegebenen.
    for (const [key, list] of pools) {
      const held = list.find((m) => keptTaxYear(m) !== null)
      if (held !== undefined && held !== list[0]) pools.set(key, [held, ...list.filter((m) => m !== held)])
    }
    const spanIn = (m: CostItem, old: BillingPeriod | null | undefined): { from: string; to: string }[] => {
      if (old === undefined || old === null || m.serviceFrom === undefined || m.serviceTo === undefined) return []
      const from = m.serviceFrom > old.from ? m.serviceFrom : old.from
      const to = m.serviceTo < old.to ? m.serviceTo : old.to
      return [from <= to ? { from, to } : { from: m.serviceFrom, to: m.serviceTo }]
    }
    const first = family[0]
    const wholeFamily = first !== undefined && coversService(first, family.flatMap((m) => spanIn(m, periodOfKey(before, m.period))))
    // Befund 4 zu #455 (hin und zurück wandert ein Cent): Kommt ein Anteil zu einem stehenden Teil eines wachsenden
    // Zeitraums, behielt dieser seine Rundung, und der Anteil rundete ein zweites Mal. Nach „Januar ab 2026“ und zurück
    // stand eine Gutschrift mit −92,34/−31,11 statt −92,33/−31,12 da. Sind die bewegten Teile und dieser stehende Teil
    // zusammen eine unveränderte Teilung nach Tagen (im bisherigen Rhythmus aus ihrer Summe und ihren Spannen genau so
    // geteilt), wird ihre Summe als eine Rechnung im neuen Rhythmus geteilt; der Anteil ist dann, was dem stehenden Teil zu
    // seinem neuen Betrag fehlt. Kehren die Regeln zurück, kehren so auch die Beträge zurück, centgenau und bei jedem Hin
    // und Zurück gleich, denn eine Teilung nach Tagen hängt nur an Summe, Tagen und Zeiträumen (der Entscheid beim
    // Restcent am Schlüssel des Zeitraums, serviceSplit.ts).
    //
    // Was nicht neu geteilt wird: Teile in Zeiträumen, die bleiben (sie gehören keiner geänderten Abrechnung an, und ein
    // abgeschlossener Zeitraum ist immer einer davon, sonst sperrte `blocked`), und ein einzeln berichtigter Teil (die
    // Prüfung im bisherigen Rhythmus schlägt dann fehl): Eine Berichtigung bleibt an ihrem Teil (server/src/CLAUDE.md),
    // und es kommt wie bisher der Anteil der bewegten Teile dazu. Ebenso, wenn die bewegten Teile in mehreren Rechnungen je
    // Jahr der Zahlung stehen (`poolOf`): Welcher davon zum stehenden Teil kommt, entscheidet erst das Jahr.
    const withStandingShare = (plain: ServicePart[], moving: readonly CostItem[], standing: readonly CostItem[], tieId: string): ServicePart[] => {
      const lead = moving[0]
      if (lead === undefined) return plain
      const byId = (a: CostItem, b: CostItem): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      const absorbed = plain.flatMap((p) => {
        const s = standing
          .filter((x) => x.period === p.period.key && changed(x.period)?.status === 'grows' && x.paidOn === lead.paidOn && sameAllocation(x, lead))
          .sort(byId)[0]
        return s === undefined ? [] : [s]
      })
      if (absorbed.length === 0) return plain
      const pool = [...moving, ...absorbed]
      const sum = (rows: readonly CostItem[], f: (c: CostItem) => number): number => rows.reduce((a, c) => a + f(c), 0)
      const poolLabor = sum(pool, (c) => c.labor35aCents ?? 0)
      const invoice = (rules: PeriodRules) => deriveSourceParts(rules, {
        tieId, description: baseDescription(lead.description), amountCents: sum(pool, (c) => c.amountCents),
        ...(poolLabor ? { labor35aCents: poolLabor } : {}), spans: pool.flatMap((m) => spanIn(m, periodOfKey(before, m.period))), marked: true,
      })
      const was = invoice(before)
      const keys = new Set(pool.map((m) => m.period))
      const untouched = was.length === keys.size && was.every((w) => {
        const rows = pool.filter((m) => m.period === w.period.key)
        return w.amountCents === sum(rows, (c) => c.amountCents) && (w.labor35aCents ?? 0) === sum(rows, (c) => c.labor35aCents ?? 0)
      })
      if (!untouched) return plain
      const now = invoice(next)
      if (now.length !== plain.length || now.some((n, i) => n.period.key !== plain[i]?.period.key)) return plain
      const parts = plain.map((p, i): ServicePart => {
        const n = now[i] ?? p
        const s = absorbed.find((x) => x.period === p.period.key)
        const amountCents = n.amountCents - (s?.amountCents ?? 0)
        const labor = (n.labor35aCents ?? 0) - (s?.labor35aCents ?? 0)
        return { ...p, amountCents, labor35aCents: p.labor35aCents === null && labor === 0 ? null : labor }
      })
      // Ein Anteil mit anderem Vorzeichen als der bewegte Betrag wäre keine Rundung mehr.
      return parts.some((x, i) => Math.sign(x.amountCents) * Math.sign(plain[i]?.amountCents ?? 0) < 0) ? plain : parts
    }
    return [...pools.values()].flatMap((moving) => {
      const lead = moving[0]
      if (lead === undefined) return []
      const spans = moving.flatMap((m) => {
        const old = changed(m.period)?.old
        if (old === undefined || m.serviceFrom === undefined || m.serviceTo === undefined) return []
        const from = m.serviceFrom > old.from ? m.serviceFrom : old.from
        const to = m.serviceTo < old.to ? m.serviceTo : old.to
        // Liegt der Leistungszeitraum ganz außerhalb des Zeitraums (erlaubt, die Abrechnung warnt), zählt er ganz, wie
        // beim Teil ohne Quelle unten.
        return [from <= to ? { from, to } : { from: m.serviceFrom, to: m.serviceTo }]
      })
      const labor = moving.reduce((sum, c) => sum + (c.labor35aCents ?? 0), 0)
      const tieId = family.map((c) => c.id).sort()[0] ?? lead.id
      const plain = deriveSourceParts(next, {
        tieId,
        description: baseDescription(lead.description),
        amountCents: moving.reduce((sum, c) => sum + c.amountCents, 0),
        ...(labor ? { labor35aCents: labor } : {}),
        spans,
        // Es bleiben Teile stehen, oder es gibt neben diesem Jahr noch ein anderes: Die Teile tragen den Zusatz. Ebenso,
        // wenn die bewegten Teile den Leistungszeitraum nicht ganz decken (ein Teil wurde früher gelöscht, #471): Dann
        // ist auch eine einzige Zeile nur ein Anteil der Rechnung.
        marked: family.length > moving.length || !coversService(lead, spans),
      })
      const parts = pools.size === 1 ? withStandingShare(plain, moving, standing, tieId) : plain
      return [{ item: lead, parts, family: moving, standing, sourceId, wholeFamily }]
    })
  }
  // Folge-PR zu #252 (Geld-K1, -H1): Ein Abzug des Betriebsstroms folgt immer seiner Stromrechnung. Hat sie einen
  // Leistungszeitraum, steht ihr Endzustand schon im Plan fest; der Abzug geht dann in keine Gruppe und wird nicht
  // nach eigenem Leistungszeitraum geteilt, sondern mit allen Abzügen derselben Rechnung gemeinsam wie sie.
  const byId = new Map(items.map((c) => [c.id, c]))
  const isGeneral = (c: CostItem): boolean => c.category === GENERAL_POWER_CATEGORY && c.operatingPower === undefined
  const generalOf = (c: CostItem): CostItem | undefined => {
    if (c.operatingPower !== 'deduction' || c.operatingPowerGeneralId === undefined) return undefined
    const g = byId.get(c.operatingPowerGeneralId)
    return g !== undefined && isGeneral(g) ? g : undefined
  }
  const withService = (c: CostItem): boolean => c.serviceFrom !== undefined && c.serviceTo !== undefined
  const followers: CostItem[] = []
  const done = new Set<string>()
  for (const item of items) {
    if (item.heatingPlantId && ownPlantIds.has(item.heatingPlantId)) continue
    const a = changed(item.period)
    if (a === null) continue
    // Ein Zeitraum, der nur wächst, behält seine Positionen: Sie gehören weiter hinein. Reicht er
    // danach über zwei Kalenderjahre, braucht jede ihr Jahr der Zahlung (M4).
    if (a.status === 'grows') {
      if (a.now !== null && spansTwoYears(a.now)) regrows.push({ item, target: a.now })
      continue
    }
    const general = generalOf(item)
    if (general !== undefined && withService(general)) {
      followers.push(item)
      continue
    }
    // Ein Abzug auf eine Rechnung ohne Leistungszeitraum geht mit ihr in die Gruppe, auch wenn er selbst einen trägt.
    if (item.category !== HEATING_CATEGORY && item.serviceFrom !== undefined && item.serviceTo !== undefined && general === undefined) {
      if (done.has(item.id)) continue
      // Einzelbeträge teilt Mietfuchs nicht nach Tagen (#454, `splitBlocker`): Reicht die Rechnung über die neue
      // Grenze, sperrt das den Wechsel mit dem Rat, sie vorher je Zeitraum zu erfassen; sonst wandert sie ganz.
      const blocker = splitBlocker(item)
      if (blocker !== null) {
        const from = item.serviceFrom > a.old.from ? item.serviceFrom : a.old.from
        const to = item.serviceTo < a.old.to ? item.serviceTo : a.old.to
        const parts = splitByService(next, { ...item, ...(from <= to ? { serviceFrom: from, serviceTo: to } : { serviceFrom: item.serviceFrom, serviceTo: item.serviceTo }) })
        if (parts.length > 1) blocked.add(`${blocker} Danach lässt sich der Abrechnungszeitraum umstellen.`)
        else if (parts[0] !== undefined && parts[0].period.key !== item.period) splits.push({ item, parts })
        continue
      }
      if (item.sourceId !== undefined) {
        splits.push(...sourceSplit(item.sourceId))
        for (const m of bySource.get(item.sourceId) ?? [item]) done.add(m.id)
        continue
      }
      // Geteilt wird der Teil des Leistungszeitraums, der im bisherigen Zeitraum liegt: Ein schon
      // aufgeteilter Teil trägt den ganzen Leistungszeitraum der Rechnung, sein Betrag ist aber nur
      // der Anteil seines Zeitraums. Über den ganzen geteilt, landete ein Teil davon ein zweites Mal
      // dort, wo schon der andere Teil steht. Liegt der Leistungszeitraum ganz außerhalb (erlaubt,
      // die Abrechnung warnt), wird er ganz geteilt.
      const from = item.serviceFrom > a.old.from ? item.serviceFrom : a.old.from
      const to = item.serviceTo < a.old.to ? item.serviceTo : a.old.to
      const own = from <= to ? { serviceFrom: from, serviceTo: to } : { serviceFrom: item.serviceFrom, serviceTo: item.serviceTo }
      const parts = splitByService(next, { ...item, ...own })
      if (parts.length === 1 && parts[0]?.period.key === item.period) continue
      // Teile ohne Quelle (alter Bestand oder eine gewöhnliche Position) behalten diesen Weg; was dabei mehrere Teile
      // ergibt, ist danach eine Rechnung mit Quelle (#455).
      splits.push({ item, parts, ...(parts.length > 1 ? { newSource: true } : {}) })
      continue
    }
    // Laienprobe B2: Kalte Kosten ohne Leistungszeitraum standen im bisherigen Zeitraum und sind nach
    // dem Leistungsprinzip (Entwurf 3.4) dessen Kosten. Ganz in einen Rumpf gelegt, stünde dort die
    // Jahresrechnung gegen wenige Monate Vorauszahlung; deshalb wird das Aufteilen nach Tagen über den
    // bisherigen Zeitraum angeboten und vorbelegt. Heizkosten nie (VIII ZR 156/11, Entwurf 3.4).
    const heating = item.category === HEATING_CATEGORY
    // Abdeckung V20: Eine Position, die mit einer Brennstoffrechnung verknüpft ist, gehört in die Heizperiode, in der die
    // Rechnung endet; das Speichern lehnt jeden anderen Zeitraum ab. Die Vorschau bietet deshalb nur diesen an.
    const required = heating ? requiredPeriodOf(item) : null
    // Einzelbeträge (#454) wie Heizkosten in eigener Gruppe ohne Aufteilen: Der Vermieter wählt den Zeitraum. Ein Abzug
    // beim Betriebsstrom geht mit seiner Rechnung (Durchsicht, Befund 4), sonst teilte er sich nach Tagen und sie nicht.
    const amounts = !heating && (splitBlocker(item) !== null || (general !== undefined && splitBlocker(general) !== null))
    const id = heating ? (required ? `${a.key}|heizung|${required}` : `${a.key}|heizung`) : amounts ? `${a.key}|einzelbetraege` : a.key
    const allowed = optionsFor(a).filter((p) => required === null || p.key === required)
    const g = groups.get(id) ?? { from: a.key, old: a.old, heating, amounts, items: [], options: allowed.length > 0 ? allowed : optionsFor(a), split: heating || amounts ? null : new Map<string, ServicePart[]>() }
    g.items.push(item)
    if (g.split !== null) {
      const parts = splitByService(next, { ...item, serviceFrom: a.old.from, serviceTo: a.old.to })
      if (parts.length > 1) g.split.set(item.id, parts)
      else g.split = null
    }
    groups.set(id, g)
  }

  // Der Endzustand jeder Stromrechnung mit Leistungszeitraum, an der ein folgender Abzug hängt: ihre Teile aus
  // `splits` (auch als Familie einer schon aufgeteilten Rechnung, H2), sonst bleibt sie ganz in ihrem Zeitraum
  // (K1: Leistungszeitraum ganz in einem neuen Zeitraum, die Rechnung steht deshalb nicht in `splits`).
  const follows: Plan['follows'] = []
  const pools = new Map<string, { parts: ServicePart[]; deductions: CostItem[] }>()
  for (const d of followers) {
    const g = generalOf(d)
    if (g === undefined) continue
    const index = splits.findIndex((s) => (s.family ?? [s.item]).some((m) => m.id === g.id))
    const key = index >= 0 ? `split:${index}` : `stay:${g.id}`
    const pool = pools.get(key) ?? { parts: index >= 0 ? splits[index]?.parts ?? [] : stayingParts(next, g), deductions: [] }
    pool.deductions.push(d)
    pools.set(key, pool)
  }
  for (const pool of pools.values()) {
    if (pool.parts.length === 0) continue
    const shares = splitDeductionsAlike(pool.deductions, pool.parts)
    pool.deductions.forEach((d, j) => follows.push({ item: d, parts: shares[j] ?? [] }))
  }
  // Ohne Leistungszeitraum steht die Rechnung mit ihren Abzügen in einer Gruppe. Beim Aufteilen nach Tagen teilen sich
  // die Abzüge gemeinsam wie die Teile der Rechnung (H1), nicht jeder für sich nach Tagen.
  for (const g of groups.values()) {
    if (g.split === null) continue
    const byGeneral = new Map<string, CostItem[]>()
    for (const item of g.items) {
      const general = generalOf(item)
      if (general === undefined || !g.items.includes(general) || !g.split.has(general.id)) continue
      byGeneral.set(general.id, [...(byGeneral.get(general.id) ?? []), item])
    }
    for (const [generalId, deductions] of byGeneral) {
      const shares = splitDeductionsAlike(deductions, g.split.get(generalId) ?? [])
      deductions.forEach((d, j) => g.split?.set(d.id, shares[j] ?? []))
    }
  }

  const overrideRekeys: Plan['overrideRekeys'] = []
  const asks = new Map<string, OverrideAsk>()
  for (const t of tenancies) {
    for (const [schluessel, cents] of Object.entries(t.prepaymentOverrides)) {
      const key = parsePeriodKey(schluessel)
      const a = key === null ? null : changed(key)
      if (key === null || a === null) continue
      const oldMonths = tenancyMonths(t, a.old)
      const withMonths = optionsFor(a).map((p) => ({ period: p, months: tenancyMonths(t, p) })).filter((x) => x.months.length > 0)
      const only = withMonths.length === 1 ? withMonths[0] : undefined
      if (only && only.months.join() === oldMonths.join()) {
        if (only.period.key !== key) overrideRekeys.push({ tenancyId: t.id, from: key, to: only.period.key })
        continue
      }
      const entry: OverrideAsk = asks.get(t.id) ?? { tenancy: t, drop: new Set<PeriodKey>(), from: [], ask: new Map() }
      entry.drop.add(key)
      entry.from.push({ key, label: periodLabel(a.old), cents })
      for (const x of withMonths) entry.ask.set(x.period.key, x)
      asks.set(t.id, entry)
    }
  }

  const assessmentMoves: Plan['assessmentMoves'] = []
  const assessmentPreview: PeriodChangePreview['assessments'] = []
  for (const r of assessmentRows) {
    const a = r.period === null ? null : changed(r.period)
    if (a === null || a.status !== 'gone') continue
    const to = bestFor(a, optionsFor(a))
    assessmentMoves.push({ id: r.id, to: to.key })
    assessmentPreview.push({ assessmentId: r.id, file: r.file, from: a.key, to: to.key, toLabel: periodLabel(to) })
  }

  // Integrationsdurchsicht zu #415: Eigene Anschreiben eines Zeitraums, der sich ändert, gehörten zu einem anderen Brief;
  // sie entfallen, und die Vorschau sagt es. Abgeschlossene ändert der Wechsel nie (blocked).
  const letterDocs: string[] = []
  const lettersPreview: string[] = []
  for (const d of await letterDocsWithPrefix(db, letterDocPrefix({ propertyId }))) {
    const key = parsePeriodKey(d.period)
    const a = key === null ? null : changed(key)
    if (a === null) continue
    letterDocs.push(d.doc)
    lettersPreview.push(droppedLettersText(d.tenancyIds.map((id) => tenancies.find((t) => t.id === id)?.tenantName ?? 'einem früheren Mieter'), periodLabel(a.old)))
  }

  // Die Zeiträume im Umfeld des Wechsels, für die Liste der Vorschau.
  const years = [...[...memo.values()].flatMap((a) => (a ? [a.old.from] : [])), ...next.changes.map((c) => `${c}-01`), ...before.changes.map((c) => `${c}-01`), today].sort()
  const listFrom = `${Number((years[0] ?? today).slice(0, 4)) - 1}-01-01`
  const listTo = `${Number((years[years.length - 1] ?? today).slice(0, 4)) + 1}-12-31`
  const periods = periodsBetween(next, listFrom, listTo)
  const wasShort = (p: BillingPeriod): boolean => {
    const old = periodOfKey(before, p.key)
    return old !== null && old.short && old.from === p.from && old.to === p.to
  }

  const preview: PeriodChangePreview = {
    rules: next,
    periods: periods.map((p) => ({ key: p.key, label: periodLabel(p), short: p.short })),
    newShort: periods.filter((p) => p.short && !wasShort(p)).map((p) => ({ key: p.key, label: periodLabel(p) })),
    blocked: [...blocked],
    // Erst mit den Fragen nach dem Jahr der Zahlung bekannt, ob ein Ergebnis mit einem stehenden Teil zusammengefasst
    // wird (unten).
    moves: [],
    groups: [...groups.entries()].map(([id, g]) => {
      const a = changed(g.from) ?? noFinding(g.from)
      const yearIn = (item: CostItem, p: BillingPeriod): number => (spansTwoYears(p) ? taxEntry(item, p).suggested : Number(p.from.slice(0, 4)))
      const { notes, taxShift: taxShiftBySplit } = g.split === null ? { notes: [], taxShift: false } : splitNotes(g, bookedIds, yearIn)
      const advisable = g.split !== null && notes.length === 0
      // Ganz verschoben: vorbelegt ist ein Zeitraum, in dem jede Position ihr Jahr der Zahlung behält,
      // sonst der mit der größten Überschneidung (Review der Laienprobe, Runde 1).
      const shiftOf = (p: BillingPeriod): number => g.items.reduce((sum, i) => sum + (!keepsTaxYear(i) && yearIn(i, p) !== effectiveTaxYear(i) ? i.amountCents : 0), 0)
      const keeping = g.options.filter((p) => shiftOf(p) === 0)
      // Verschöbe das Teilen das Jahr der Zahlung, gibt es keine Vorgabe: Ganz in einen Zeitraum
      // gelegt, verschöbe sich entweder ebenfalls das Steuerjahr oder die Abrechnung; entscheiden muss
      // der Vermieter, und die Vorschau nennt beides. Bei gebuchten Belegzeilen gilt ein Zeitraum, der
      // das Steuerjahr behält. Ohne Teilen (Heizkosten) wie bisher.
      const whole = g.split === null ? bestFor(a, g.options).key
        : taxShiftBySplit ? ''
          : keeping.length > 0 ? bestFor(a, keeping).key : ''
      return {
        id,
        from: g.from,
        fromLabel: periodLabel(a.old),
        heating: g.heating,
        ...(g.amounts ? { individualAmounts: true } : {}),
        items: g.items.map((i) => ({ costItemId: i.id, description: i.description, amountCents: i.amountCents })),
        options: g.options.map((p) => ({ key: p.key, label: periodLabel(p) })),
        split: g.split === null ? null : {
          range: formatDayRange(g.old.from, g.old.to),
          items: [...g.split.entries()].map(([costItemId, parts]) => ({ costItemId, parts: parts.map((p) => ({ period: p.period.key, label: periodLabel(p.period), amountCents: p.amountCents })) })),
          notes,
        },
        taxShifts: g.options.flatMap((p) => {
          const cents = shiftOf(p)
          if (cents === 0) return []
          // Je Position mit ihrem eigenen Jahr (Review Runde 2): Positionen einer Gruppe können verschiedene haben.
          const moved = g.items.filter((i) => !keepsTaxYear(i) && yearIn(i, p) !== effectiveTaxYear(i))
            .map((i) => `„${i.description}“ ${euro(i.amountCents)} von ${effectiveTaxYear(i)} nach ${yearIn(i, p)}`)
          return [{ key: p.key, text: `Ganz nach ${periodLabel(p)} verschoben, wechselten für die Steuer ${moved.length === 1 ? 'das Jahr der Zahlung' : `zusammen ${euro(cents)} das Jahr der Zahlung`}: ${moved.join('; ')}, obwohl sich an der Zahlung nichts ändert.` }]
        }),
        suggested: advisable ? 'split' : whole,
      }
    }),
    effects: [],
    overrides: [...asks.values()].map((o) => ({
      tenancyId: o.tenancy.id,
      tenantName: o.tenancy.tenantName,
      from: o.from,
      ask: [...o.ask.values()].map((x) => ({ period: x.period.key, label: periodLabel(x.period), months: monthsText(x.months) })),
    })),
    assessments: assessmentPreview,
    letters: lettersPreview,
    taxYears: [],
    keptTaxYears: [],
    token: '',
  }
  const taxEntries: Plan['taxEntries'] = new Map()
  // #267: Ein Abzug beim Betriebsstrom wird nicht gefragt (`followsBill`). Vorher nahm er das Jahr seiner
  // Betriebsstrom-Position (G-H4), und die Vorschau bot für den Betriebsstrom nur Jahre im Schnitt der Spannen seiner
  // Abzugsteile an; ging ein Ziel gar nicht, sperrte sie es (Geld H1, `noYearText`). Seit der Abzug seiner Stromrechnung
  // folgt, liegt er immer in deren Zeitraum und hat damit deren Spanne, und beides entfällt (Durchsicht von #268, K4).
  const ask = (item: CostItem, p: BillingPeriod) => {
    if (!spansTwoYears(p) || keepsTaxYear(item)) return
    const entry = taxEntry(item, p)
    taxEntries.set(entry.key, entry)
  }
  for (const { item, parts } of splits) for (const part of parts) ask(item, part.period)
  for (const { item, parts } of follows) for (const part of parts) ask(item, part.period)
  for (const g of groups.values()) for (const o of g.options) for (const item of g.items) ask(item, o)
  for (const { item, target } of regrows) ask(item, target)
  // Geld H2, Variante (b) (Nachtrag nach Fixrunde 87a418b): Hier sagte die Vorschau, dass sich ein Teil eines folgenden
  // Abzugs mit festem Steuerjahr in der Anlage V verschiebt, wenn der Betriebsstrom in ein anderes Jahr geht. Seit #268
  // gleicht die Steuerübersicht je Steuerjahr aus (Σ Abzüge − Σ Heizpositionen `included`): Jedes Jahr zeigt die in ihm
  // bezahlten Rechnungen, es verschiebt sich nichts, und der Satz entfällt.
  preview.taxYears = [...taxEntries.values()]
  // Die Vorschau sagt, welches Ergebnis zu einem stehenden Teil kommt (#455), gerechnet mit den vorbelegten Jahren.
  // Hängt das Zusammenfassen an einer Frage nach dem Jahr der Zahlung (des bewegten oder des stehenden Teils), gilt die
  // Ankündigung nur für das vorbelegte Jahr, und die Vorschau sagt das (Integrationsdurchsicht zu #455, M1).
  // #478: zuerst das gehaltene Jahr (`keptTaxYear`), dann die Vorgabe der Frage.
  const suggestedYear: YearIn = (target, item) => keptTaxYear(item) ?? taxEntries.get(taxKey(item, target))?.suggested ?? null
  const produced = new Map<string, CostItem[]>()
  const namer = mergedNamer(before, new Set(splits.flatMap((sp) => (sp.standing ?? []).map((c) => c.id))))
  const ownRows = new Map<ServicePart, CostItem>()
  preview.moves = splits.map((split) => {
    const earlier = split.sourceId === undefined ? [] : produced.get(split.sourceId) ?? []
    const own: CostItem[] = []
    const parts = split.parts.map((p) => {
      const target = split.family ? mergeTargetOf(split, p, suggestedYear, earlier) : undefined
      const mergedAs = target === undefined ? undefined : namer.name(target, p)
      if (split.family && target === undefined) {
        const row = producedRow(split.item, p, suggestedYear)
        namer.seed(row.id, row.period, p.span)
        own.push(row)
        ownRows.set(p, row)
      }
      const isAsked = (c: CostItem): boolean => taxEntries.has(taxKey(c, p.period))
      const asked = target !== undefined && (isAsked(split.item) || isAsked(target))
      // #471, der umgekehrte Fall: Mit den vorbelegten Jahren kein Zusammenfassen, aber im Zeitraum steht eine Zeile
      // derselben Rechnung und Verteilung, und eines der Jahre ist gefragt. Mit demselben Jahr für beide käme der Anteil
      // dazu; die Vorschau nennt das Jahr, das ihn zusammenfasst (das der anderen Zeile, ist sie nicht gefragt, das des
      // Anteils).
      const sibling = split.family && target === undefined
        ? mergeCandidates(split, p, earlier).find((s) => isAsked(split.item) || isAsked(s))
        : undefined
      const siblingAs = sibling === undefined ? undefined : namer.name(sibling, p, sibling.description, false)
      const withYear = sibling === undefined ? undefined
        : {
          into: sibling.description, year: isAsked(split.item) ? yearOf(p, sibling, suggestedYear) : movedYearOf(split, p, suggestedYear),
          ...(siblingAs !== undefined && siblingAs !== sibling.description ? { mergedAs: siblingAs } : {}),
        }
      return {
        period: p.period.key, label: periodLabel(p.period), amountCents: p.amountCents, ...(target ? { mergedInto: target.description } : {}),
        ...(mergedAs !== undefined && mergedAs !== target?.description ? { mergedAs } : {}),
        ...(asked ? { mergeDependsOnYear: true as const } : {}), ...(withYear ? { mergeWithYear: withYear } : {}),
      }
    })
    if (split.sourceId !== undefined) produced.set(split.sourceId, [...earlier, ...own])
    // #478 (E3): Wechselt Geld dieser Rechnung das Steuerjahr (nur bei Teilen ohne Datum und ohne Jahr möglich), sagt
    // die Vorschau es mit Betrag, altem und neuem Jahr, gerechnet mit den vorbelegten Jahren.
    const was = new Map<number, number>()
    for (const m of split.family ?? [split.item]) was.set(storedOutflowYear(m), (was.get(storedOutflowYear(m)) ?? 0) + m.amountCents)
    const now = new Map<number, number>()
    for (const p of split.parts) {
      const year = movedYearOf(split, p, suggestedYear)
      now.set(year, (now.get(year) ?? 0) + p.amountCents)
    }
    const taxShift = yearShiftText(was, now)
    return {
      costItemId: split.item.id, description: split.family ? baseDescription(split.item.description) : split.item.description,
      amountCents: (split.family ?? [split.item]).reduce((sum, c) => sum + c.amountCents, 0),
      parts,
      ...(taxShift === null ? {} : { taxShift }),
    }
  })
  // #471: Bleibt einer Quelle mit den vorbelegten Jahren eine einzige Zeile und trägt sie die ganze Rechnung, verliert sie
  // den Zusatz „(anteilig …)“ (wie beim Schreiben); die Vorschau nennt die neue Beschreibung an jeder Rechnung der Quelle,
  // deren Anteil zu ihr kommt.
  const remaining = new Map<string, CostItem[]>()
  for (const split of splits) {
    if (!split.family || split.sourceId === undefined || remaining.has(split.sourceId)) continue
    remaining.set(split.sourceId, [...(split.standing ?? []), ...(produced.get(split.sourceId) ?? [])])
  }
  const sourceMoves = sourceMovesOf(splits, remaining, ownRows, next, preview.moves)
  preview.moves = sourceMoves.concat(follows.map(({ item, parts }) => ({
    costItemId: item.id, description: item.description, amountCents: item.amountCents,
    parts: parts.map((p) => ({ period: p.period.key, label: periodLabel(p.period), amountCents: p.amountCents })),
  })))
  preview.keptTaxYears = keptTaxYearsOf(splits, groups, regrows)
  preview.token = tokenOf(preview)
  return { preview, splits, groups, overrideRekeys, overrideAsks: [...asks.values()], assessmentMoves, letterDocs, regrows, follows, taxEntries, next, before }
}

// Die Rechnungen mit Quelle in der Vorschau, mit `renamedTo` an denen, deren Anteil zur einzigen verbleibenden Zeile ihrer
// Quelle kommt, wenn diese danach die ganze Rechnung trägt (#471). Ebenso am Anteil mit `mergeWithYear` (Durchsicht, M2):
// Fiele mit dem genannten Jahr seine eigene Zeile weg und bliebe dann nur die andere, die die ganze Rechnung trägt, steht
// ihr neuer Name dort.
function sourceMovesOf(
  splits: readonly Split[], remaining: ReadonlyMap<string, CostItem[]>, ownRows: ReadonlyMap<ServicePart, CostItem>, next: PeriodRules, moves: PeriodChangePreview['moves'],
): PeriodChangePreview['moves'] {
  const renamedOf = (row: CostItem | undefined, split: Split | undefined): string | undefined => {
    if (row === undefined || split?.wholeFamily !== true || !carriesWholeInvoice(next, row)) return undefined
    const renamed = baseDescription(row.description)
    return renamed === row.description ? undefined : renamed
  }
  return moves.map((m, i) => {
    const split = splits[i]
    const rest = split?.sourceId === undefined ? undefined : remaining.get(split.sourceId)
    const parts = m.parts.map((p, j) => {
      const own = split?.parts[j] === undefined ? undefined : ownRows.get(split.parts[j])
      if (p.mergeWithYear === undefined || rest === undefined || own === undefined) return p
      const left = rest.filter((r) => r !== own)
      const renamed = left.length === 1 && left[0]?.description === p.mergeWithYear.into ? renamedOf(left[0], split) : undefined
      if (renamed === undefined) return p
      const { mergedAs: _as, ...withYear } = p.mergeWithYear
      return { ...p, mergeWithYear: { ...withYear, renamedTo: renamed } }
    })
    const renamed = rest?.length === 1 && m.parts.some((p) => p.mergedInto !== undefined) ? renamedOf(rest[0], split) : undefined
    // Streicht `renamedTo` den Zusatz ganz, nennt der Anteil keinen neuen Zusatz (`mergedAs`).
    const named = renamed === undefined ? parts : parts.map(({ mergedAs: _as, ...p }) => p)
    return { ...m, parts: named, ...(renamed === undefined ? {} : { renamedTo: renamed }) }
  })
}

// Warum das Aufteilen einer Gruppe nicht vorbelegt wird (Review der Laienprobe, Runde 1): Eine
// Position mit gebuchten Belegzeilen hätte danach Teile, deren Summe die Belegbuchung nicht kennt;
// und ein Teil, der in ein anderes Jahr der Zahlung fiele, verschöbe Werbungskosten zwischen zwei
// Steuererklärungen, ohne dass sich an der Zahlung etwas geändert hat. Wählbar bleibt es; die Sätze
// sagen dann, was es bewirkt, die Verschiebung in Euro.
function splitNotes(g: Group, bookedIds: ReadonlySet<string>, partYear: (item: CostItem, p: BillingPeriod) => number): { notes: string[]; taxShift: boolean } {
  const notes: string[] = []
  const booked = g.items.filter((i) => bookedIds.has(i.id))
  if (booked.length > 0) {
    notes.push(`${booked.map((i) => `„${i.description}“`).join(', ')} ${booked.length === 1 ? 'ist' : 'sind'} aus einem Beleg gebucht. Geteilt ließe sich ein Teil nicht mehr mit einer weiteren Zeile dieses Belegs verknüpfen; vorbelegt ist deshalb, die Rechnung ganz zu verschieben.`)
  }
  const shifts = new Map<string, number>()
  for (const item of g.items) {
    if (keepsTaxYear(item)) continue
    const was = effectiveTaxYear(item)
    for (const part of g.split?.get(item.id) ?? []) {
      const year = partYear(item, part.period)
      if (year !== was) shifts.set(`${was}→${year}`, (shifts.get(`${was}→${year}`) ?? 0) + part.amountCents)
    }
  }
  for (const [move, cents] of shifts) {
    const [from, to] = move.split('→')
    notes.push(`Geteilt kämen für die Steuer ${euro(cents)} aus dem Jahr der Zahlung ${from} nach ${to}, obwohl sich an der Zahlung nichts ändert. Wählen Sie das Teilen nur, wenn das stimmt, und prüfen Sie danach das Jahr der Zahlung der Teile.`)
  }
  return { notes, taxShift: shifts.size > 0 }
}

// Laienprobe B3, Review Runde 1: begründet, nicht absolut. § 556 Abs. 3 S. 3 BGB schließt die
// Nachforderung aus, „es sei denn, der Vermieter hat die verspätete Geltendmachung nicht zu
// vertreten“; wer den Zeitraum selbst rückwirkend umstellt, hat die Verspätung zu vertreten.
export function passedDeadlineText(labels: readonly string[], cause = 'den Zeitraum selbst umstellen'): string {
  return `Die Abrechnungsfrist für ${labels.join(', ')} ist schon abgelaufen. Weil Sie ${cause}, haben Sie die Verspätung zu vertreten; eine Nachzahlung aus diesem Zeitraum können Sie deshalb nicht mehr verlangen (§ 556 Abs. 3 Satz 3 BGB).`
}


// Eine Gruppe ohne betroffenen Zeitraum gibt es nicht; der Aufruf oben fragt nur bekannte.
function noFinding(key: PeriodKey): never {
  throw new Error(`Zeitraum ${key} ohne Befund in der Vorschau`)
}

export async function previewPeriodChange(db: Database, propertyId: string, rawRules: unknown, today: string): Promise<PeriodChangePreview | null> {
  const plan = await planPeriodChange(db, propertyId, rawRules, today)
  return plan === null ? null : withEffects(db, propertyId, plan, today)
}

// Laienprobe B3: Was der Wechsel mit Abrechnungen macht, die schon begonnen haben. Ein Wechsel mit
// Beginn in der Vergangenheit legt einen Rumpf an, dessen Frist (§ 556 Abs. 3 S. 2 BGB) schon
// abgelaufen sein kann; eine Nachforderung daraus ist dann ausgeschlossen (S. 3), auch wenn die
// bisherige Abrechnung über das ganze Jahr noch offen war. Die Vorschau nennt je solchem Zeitraum die
// Frist und, im Probelauf mit den Vorschlägen dieser Vorschau gerechnet, das Ergebnis je Mieter vorher
// und nachher. Ein abgeschlossener Zeitraum kommt hier nicht vor: Ihn ändert der Wechsel nie (blocked).
//
// Mit `given` (beim Speichern) wird mit den Antworten des Vermieters gerechnet, sonst mit den
// Vorschlägen; wo es keinen gibt, mit dem Aufteilen nach Tagen bzw. dem ersten Zeitraum.
async function withEffects(db: Database, propertyId: string, plan: Plan, today: string, given?: Answers): Promise<PeriodChangePreview> {
  const { before, next } = plan
  const touched = (p: BillingPeriod): boolean => {
    const old = periodOfKey(before, p.key)
    return old === null || old.from !== p.from || old.to !== p.to
  }
  const firstOld = periodsBetween(before, '2000-01-01', today).find((p) => {
    const now = periodOfKey(next, p.key)
    return now === null || now.from !== p.from || now.to !== p.to
  })
  if (firstOld === undefined) return plan.preview
  const stockBefore = await readStock(db)
  const moved = await earliestTenancyStart(db, propertyId)
  if (moved === null) return plan.preview
  const targets = periodsBetween(next, moved > firstOld.from ? moved : firstOld.from, today).filter((p) => p.from <= today && touched(p))
  if (targets.length === 0) return plan.preview
  const answers: Answers = given ?? {
    groups: Object.fromEntries(plan.preview.groups.map((g) => [g.id, g.suggested || (g.split !== null ? 'split' : g.options[0]?.key ?? '')])),
    overrides: Object.fromEntries(plan.overrideAsks.map((o) => [o.tenancy.id, Object.fromEntries([...o.ask.keys()].map((k) => [k, null]))])),
    taxYears: {},
    token: plan.preview.token,
  }
  const taxYearIn = (target: BillingPeriod, item: CostItem): number | null => {
    const kept = keptTaxYear(item)
    if (kept !== null) return kept
    const entry = plan.taxEntries.get(taxKey(item, target))
    if (entry === undefined) return null
    const chosen = answers.taxYears[entry.key]
    return typeof chosen === 'number' && entry.options.includes(chosen) ? chosen : entry.suggested
  }
  const after = await dryRun(db, (tx) => writeChangeIn(tx, plan, answers, propertyId, next, () => crypto.randomUUID(), taxYearIn),
    (stock) => targets.map((p) => outcomeOf(stock, propertyId, p)))
  const effects = targets.map((p, i): PeriodEffect => {
    const deadline = settlementDeadline(p)
    const passed = deadline < today
    const old = periodOfKey(before, p.key)
    const beforeOutcome = old === null ? null : outcomeOf(stockBefore, propertyId, old)
    const now = after?.[i] ?? null
    const tenants = (now?.tenants ?? []).map((t) => ({
      tenantName: t.tenantName,
      beforeCents: beforeOutcome?.tenants.find((b) => b.tenancyId === t.tenancyId)?.balanceCents ?? null,
      afterCents: t.balanceCents,
    }))
    return {
      label: periodLabel(p),
      deadline,
      passed,
      replaces: periodsBetween(before, p.from, p.to).filter((o) => {
        const n = periodOfKey(next, o.key)
        return n === null || n.from !== o.from || n.to !== o.to
      }).map((o) => ({ label: periodLabel(o), deadline: settlementDeadline(o) })),
      tenants,
      lostClaimsCents: passed ? lostClaims(tenants, old !== null && settlementDeadline(old) < today) : 0,
    }
  })
  return { ...plan.preview, effects }
}

type Answers = { groups: Record<string, unknown>; overrides: Record<string, unknown>; taxYears: Record<string, unknown>; token: unknown; understood?: unknown }
const objectOr = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
const readAnswers = (raw: unknown): Answers => {
  const a = objectOr(raw)
  return { groups: objectOr(a.groups), overrides: objectOr(a.overrides), taxYears: objectOr(a.taxYears), token: a.token, understood: a.understood }
}
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

// Was an Antworten fehlt oder nicht passt, als Sätze für die Meldung. Ein Tab von vor der Laienprobe
// antwortet je bisherigem Zeitraum (`from`); seit kalte und Heizkosten getrennte Gruppen mit gleichem
// `from` haben, fehlt ihm die Antwort der Heizgruppe (`<from>|heizung`), und es gibt die 409 mit
// Satz. Absichtlich: Die Heizkosten still dem Zeitraum der kalten Gruppe zu folgen ließe, wäre die
// Warnung aus B2 umgangen.
function missingAnswers(plan: Plan, answers: Answers): string[] {
  const missing: string[] = []
  for (const [id, g] of plan.groups) {
    const chosen = answers.groups[id]
    if (!(chosen === 'split' && g.split !== null) && !g.options.some((p) => p.key === chosen)) {
      missing.push(`Zeitraum für ${g.items.map((i) => `„${i.description}“`).join(', ')} wählen.`)
    }
  }
  for (const o of plan.overrideAsks) {
    const given = objectOr(answers.overrides[o.tenancy.id])
    for (const x of o.ask.values()) {
      const v = given[x.period.key]
      if (!Object.hasOwn(given, x.period.key) || !(v === null || isCents(v))) {
        missing.push(`${o.tenancy.tenantName}: tatsächlich gezahlt ${monthsText(x.months)} eintragen (oder „keine Korrektur“).`)
      }
    }
  }
  for (const [key, given] of Object.entries(answers.taxYears)) {
    const entry = plan.taxEntries.get(key)
    if (entry && !(typeof given === 'number' && entry.options.includes(given))) {
      missing.push(`„${entry.description}“: Das Jahr der Zahlung für ${entry.label} muss zwischen ${entry.options[0]} und ${entry.options[entry.options.length - 1]} liegen.`)
    }
  }
  return missing
}

export async function applyPeriodChange(
  db: Database, propertyId: string, rawRules: unknown, rawAnswers: unknown, newId: () => string, today: string,
): Promise<{ property: Property } | { error: string; preview: PeriodChangePreview } | null> {
  const plan = await planPeriodChange(db, propertyId, rawRules, today)
  if (plan === null) return null
  // Jede Antwort mit Vorschau trägt deren Fristen und Ergebnisse (Review der Laienprobe, Runde 1):
  // Sonst fehlte nach einer 409 die rote Zeile, und die Bestätigung ließe sich umgehen.
  if (plan.preview.blocked.length > 0) return { error: `${plan.preview.blocked.join(' ')} Gespeichert wurde nichts.`, preview: await withEffects(db, propertyId, plan, today) }
  const answers = readAnswers(rawAnswers)
  if (answers.token !== plan.preview.token) {
    return { error: 'Die Vorschau ist nicht mehr aktuell: Seit sie erstellt wurde, hat sich am Bestand etwas geändert. Bitte prüfen Sie die neue Vorschau; gespeichert wurde nichts.', preview: await withEffects(db, propertyId, plan, today) }
  }
  const missing = missingAnswers(plan, answers)
  if (missing.length > 0) return { error: `Für den Wechsel fehlen Angaben: ${missing.join(' ')} Gespeichert wurde nichts.`, preview: await withEffects(db, propertyId, plan, today) }
  // Laienprobe B3, Review Runde 1: Entsteht oder ändert sich eine Abrechnung mit abgelaufener Frist,
  // speichert der Server nur mit ausdrücklicher Bestätigung (`understood`), gerechnet mit den Antworten.
  const checked = await withEffects(db, propertyId, plan, today, answers)
  const passed = checked.effects.filter((e) => e.passed)
  if (passed.length > 0 && answers.understood !== true) {
    return { error: `${passedDeadlineText(passed.map((e) => e.label))} Bitte bestätigen Sie das in der Vorschau; gespeichert wurde nichts.`, preview: checked }
  }
  // Das Jahr der Zahlung im neuen Zeitraum: ein angegebenes bleibt (#478, `keptTaxYear`), sonst die Antwort, sonst der
  // Vorschlag; ohne Angabe in einem Zeitraum in einem Kalenderjahr keines (Entwurf 3.10).
  const taxYearIn = (target: BillingPeriod, item: CostItem): number | null => {
    const kept = keptTaxYear(item)
    if (kept !== null) return kept
    const entry = plan.taxEntries.get(taxKey(item, target))
    if (entry === undefined) return null
    const given = answers.taxYears[entry.key]
    return typeof given === 'number' && entry.options.includes(given) ? given : entry.suggested
  }
  const { next } = plan
  try {
    await writeChange(db, plan, answers, propertyId, next, newId, taxYearIn)
  } catch (err) {
    // Eine Schreibprüfung, die im Wechsel scheitert, ist ein Konflikt mit dem Bestand und keine
    // falsche Anfrage (I1): 409 mit der Vorschau, die Transaktion hat nichts geschrieben.
    if (err instanceof PeriodError) return { error: `${err.message} Gespeichert wurde nichts.`, preview: checked }
    if (err instanceof PeriodConflict) return { error: err.message, preview: checked }
    // Nachprüfung von #252, G2-N-W1: auch eine Prüfung des Betriebsstroms ist hier ein Konflikt mit dem
    // Bestand, nie eine nackte 400.
    if (err instanceof HeatingError) return { error: `${err.message} Gespeichert wurde nichts.`, preview: checked }
    throw err
  }
  const property = (await readProperties(db)).find((p) => p.id === propertyId)
  return property ? { property } : null
}

async function writeChange(
  db: Database, plan: Plan, answers: Answers, propertyId: string, next: PeriodRules, newId: () => string,
  taxYearIn: (target: BillingPeriod, item: CostItem) => number | null,
): Promise<void> {
  await db.transaction(async (tx) => writeChangeIn(tx, plan, answers, propertyId, next, newId, taxYearIn))
}

async function writeChangeIn(
  tx: Transaction, plan: Plan, answers: Answers, propertyId: string, next: PeriodRules, newId: () => string,
  rawTaxYearIn: (target: BillingPeriod, item: CostItem) => number | null,
): Promise<void> {
  // Positionen gehen durch dieselbe Verschmelzung und Schreibprüfung wie beim Speichern
  // (`writeCostItemParts`), auch die verschobenen: ein rohes Update umginge die Prüfung des Jahres
  // der Zahlung (Durchsicht von #226, I1).
  // Nachprüfung von #252, G2-N-W1: Stromrechnung und Abzüge wandern nacheinander; geprüft wird der Endstand
  // (`settleOperatingPowerLinks`), und dafür merkt sich der Wechsel die Teile jeder Position.
  // #267: Ein Abzug beim Betriebsstrom wird nicht gefragt und bekommt kein Jahr (`taxYearIn` ergibt für ihn `null`);
  // `mergeCostItem` leert es ohnehin.
  const taxYearIn = rawTaxYearIn
  const guard = { splitPart: true, periodChange: true }
  const written = new Map<string, { id: string; period: PeriodKey }[]>()
  const remember = (item: CostItem, periods: readonly PeriodKey[], ids: readonly string[]) =>
    written.set(item.id, ids.map((id, i) => ({ id, period: periods[i] ?? item.period })))
  const move = async (item: CostItem, target: BillingPeriod) =>
    remember(item, [target.key], await writeCostItemParts(tx, item, [{ period: target.key, amountCents: item.amountCents, labor35aCents: item.labor35aCents ?? null, description: item.description, taxYear: taxYearIn(target, item) }], newId, item.id, guard))
  {
    await tx.update(properties).set({ periodStartMonth: next.startMonth }).where(eq(properties.id, propertyId))
    await tx.delete(periodChanges).where(eq(periodChanges.propertyId, propertyId))
    if (next.changes.length > 0) await tx.insert(periodChanges).values(next.changes.map((fromMonth) => ({ propertyId, fromMonth })))
    // Zusammenfassen (#455): Ergebnisse, die zu einem stehenden Teil kommen, werden erst nach den Positionen eines
    // wachsenden Zeitraums geschrieben (`regrows`), denn die schreiben ihren Betrag aus dem Plan.
    const merges: { target: CostItem; part: ServicePart }[] = []
    // Derselbe Namensgeber wie in der Vorschau, mit den eigenen Zeilen, sobald sie geschrieben sind (`seed`).
    const namer = mergedNamer(plan.before, new Set(plan.splits.flatMap((sp) => (sp.standing ?? []).map((c) => c.id))))
    const sources = new Set<string>()
    const partial = new Set<string>()
    // Integrationsdurchsicht zu #455, I1: die eigenen Zeilen jeder Quelle, die frühere Rechnungen derselben Quelle mit
    // anderem bisherigem Jahr schon geschrieben haben (`mergeTargetOf`, `earlier`); gelesen nur, wo eine weitere folgt.
    const produced = new Map<string, CostItem[]>()
    const poolsLeft = new Map<string, number>()
    for (const s of plan.splits) if (s.family && s.sourceId !== undefined) poolsLeft.set(s.sourceId, (poolsLeft.get(s.sourceId) ?? 0) + 1)
    for (const split of plan.splits) {
      const { item, parts, family } = split
      const write = (p: ServicePart) => ({
        period: p.period.key, amountCents: p.amountCents, labor35aCents: p.labor35aCents, description: p.description, taxYear: taxYearIn(p.period, item),
      })
      if (family) {
        if (split.sourceId !== undefined) {
          sources.add(split.sourceId)
          if (split.wholeFamily !== true) partial.add(split.sourceId)
        }
        const earlier = split.sourceId === undefined ? [] : produced.get(split.sourceId) ?? []
        const targets = parts.map((p) => mergeTargetOf(split, p, taxYearIn, earlier))
        const own = parts.filter((_, i) => targets[i] === undefined)
        const heir = targets.find((t) => t !== undefined)
        const ids = await rewriteCostItemFamily(tx, family, own.map(write), newId, guard, heir)
        own.forEach((p, k) => {
          const id = ids[k]
          if (id !== undefined) namer.seed(id, p.period.key, p.span)
        })
        if (split.sourceId !== undefined) {
          const left = (poolsLeft.get(split.sourceId) ?? 1) - 1
          poolsLeft.set(split.sourceId, left)
          if (left > 0 && ids.length > 0) {
            const fresh = new Set(ids)
            produced.set(split.sourceId, [...earlier, ...(await readCostItems(tx)).filter((c) => fresh.has(c.id))])
          }
        }
        parts.forEach((p, i) => {
          const target = targets[i]
          if (target !== undefined) merges.push({ target, part: p })
        })
        // Jeder bisherige Teil kennt danach die Teile der Rechnung je Zeitraum, auch ein zusammengefasster (Abzüge
        // beim Betriebsstrom finden so den Teil ihres Zeitraums, `settleOperatingPowerLinks`).
        let k = 0
        const all = parts.map((p, i) => ({ id: targets[i]?.id ?? ids[k++] ?? item.id, period: p.period.key }))
        for (const m of family) written.set(m.id, all)
        continue
      }
      let sourceId: string | null = null
      if (split.newSource) {
        sourceId = newId()
        await insertCostSource(tx, propertyId, sourceId)
      }
      remember(item, parts.map((p) => p.period.key), await writeCostItemParts(tx, item, parts.map(write), newId, item.id, guard, sourceId))
    }
    for (const [id, g] of plan.groups) {
      if (answers.groups[id] === 'split' && g.split !== null) {
        for (const item of g.items) {
          const parts = g.split.get(item.id) ?? []
          // Laienprobe B2: Die Teile tragen danach den bisherigen Zeitraum als Leistungszeitraum und sind eine Rechnung
          // mit Quelle (#455); ein Abzug beim Betriebsstrom ist nie Teil einer Quelle, er folgt seiner Stromrechnung.
          let sourceId: string | null = null
          if (parts.length > 1 && item.operatingPower !== 'deduction') {
            sourceId = newId()
            await insertCostSource(tx, propertyId, sourceId)
          }
          remember(item, parts.map((p) => p.period.key), await writeCostItemParts(tx, { ...item, serviceFrom: g.old.from, serviceTo: g.old.to }, parts.map((p) => ({
            period: p.period.key, amountCents: p.amountCents, labor35aCents: p.labor35aCents, description: p.description, taxYear: taxYearIn(p.period, item),
          })), newId, item.id, guard, sourceId))
        }
        continue
      }
      const target = g.options.find((p) => p.key === answers.groups[id]) ?? null
      if (target === null) continue
      for (const item of g.items) await move(item, target)
    }
    for (const { item, target } of plan.regrows) await move(item, target)
    // Der Betrag (und Lohnanteil) eines Ergebnisses kommt zum stehenden Teil, gelesen nach allen übrigen Schreibvorgängen.
    for (const { target, part } of merges) {
      const now = (await readCostItems(tx)).find((c) => c.id === target.id)
      if (now === undefined) throw new Error(`Der stehende Teil ${target.id} fehlt im Wechsel`)
      const labor = now.labor35aCents === undefined && part.labor35aCents === null ? null : (now.labor35aCents ?? 0) + (part.labor35aCents ?? 0)
      await writeCostItemParts(tx, now, [{ period: now.period, amountCents: now.amountCents + part.amountCents, labor35aCents: labor, description: namer.name(target, part, now.description), taxYear: now.taxYear ?? null }], newId, now.id, guard)
    }
    // #478: Ein stehender Teil ohne Angabe in einem Zeitraum, der auf zwei Kalenderjahre wächst, bekommt mit der Antwort
    // ein Jahr; stimmt es mit dem gehaltenen Jahr eines anderen Teils derselben Quelle im selben Zeitraum überein, gäbe es
    // zwei Zeilen je Zeitraum und Jahr (Invariante 2 aus #455). Sie werden eine: Betrag und Lohnanteil zusammen, Beleg
    // und gebuchte Zeilen an der Zeile mit der kleineren Kennung (`rewriteCostItemFamily`).
    for (const sourceId of sources) {
      const rows = (await readCostItems(tx)).filter((c) => c.sourceId === sourceId).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const folded = new Set<string>()
      for (const keep of rows) {
        if (folded.has(keep.id)) continue
        const twins = rows.filter((c) => c !== keep && !folded.has(c.id) && c.period === keep.period && c.paidOn === keep.paidOn &&
          storedOutflowYear(c) === storedOutflowYear(keep) && sameAllocation(c, keep))
        if (twins.length === 0) continue
        let description = keep.description
        for (const t of twins) description = namer.fold(keep, t, description)
        const sumLabor = [keep, ...twins].every((c) => c.labor35aCents === undefined) ? null : [keep, ...twins].reduce((a, c) => a + (c.labor35aCents ?? 0), 0)
        await rewriteCostItemFamily(tx, [keep, ...twins], [{
          period: keep.period, amountCents: [keep, ...twins].reduce((a, c) => a + c.amountCents, 0), labor35aCents: sumLabor, description, taxYear: keep.taxYear ?? null,
        }], newId, guard)
        for (const t of twins) folded.add(t.id)
        const gone = new Set(twins.map((t) => t.id))
        for (const [id, list] of written) written.set(id, list.map((w) => (gone.has(w.id) ? { ...w, id: keep.id } : w)))
      }
    }
    // Folge-PR zu #252 (Geld-K1, -H1): Die Abzüge auf eine Rechnung mit Leistungszeitraum folgen deren Teilen.
    // Gelesen nach dem Zusammenfassen (Durchsicht von PR 2 zu #455, I1): Wurde der Teil der Rechnung, auf den ein Abzug
    // zeigte, gelöscht, zeigt der Abzug jetzt auf den verbleibenden (`rewriteCostItemFamily`); der Stand aus dem Plan
    // nennte noch den gelöschten.
    const current = new Map((await readCostItems(tx)).map((c) => [c.id, c]))
    for (const { item: planned, parts } of plan.follows) {
      const item = current.get(planned.id) ?? planned
      remember(item, parts.map((p) => p.period.key), await writeCostItemParts(tx, item, parts.map((p) => ({
        period: p.period.key, amountCents: p.amountCents, labor35aCents: null, description: p.description, taxYear: taxYearIn(p.period, item),
      })), newId, item.id, guard))
    }
    for (const r of plan.overrideRekeys) {
      await tx.update(prepaymentOverrides).set({ period: r.to }).where(and(eq(prepaymentOverrides.tenancyId, r.tenancyId), eq(prepaymentOverrides.period, r.from)))
    }
    for (const o of plan.overrideAsks) {
      await tx.delete(prepaymentOverrides).where(and(eq(prepaymentOverrides.tenancyId, o.tenancy.id), inArray(prepaymentOverrides.period, [...o.drop])))
      const given = objectOr(answers.overrides[o.tenancy.id])
      const rows = [...o.ask.keys()].flatMap((key) => {
        const cents = given[key]
        return isCents(cents) ? [{ tenancyId: o.tenancy.id, period: key, amountCents: cents }] : []
      })
      if (rows.length > 0) await tx.insert(prepaymentOverrides).values(rows)
    }
    for (const m of plan.assessmentMoves) await tx.update(assessments).set({ requestedPeriod: m.to }).where(eq(assessments.id, m.id))
    await dropLetterDocs(tx, plan.letterDocs)
    // Invariante 3 (#455): Bleibt einer Quelle ein einziger Teil, ist er eine gewöhnliche Position, und die Quelle entfällt.
    for (const sourceId of sources) {
      const rest = await tx.select({ id: costItems.id, period: costItems.period, description: costItems.description, serviceFrom: costItems.serviceFrom, serviceTo: costItems.serviceTo })
        .from(costItems).where(eq(costItems.sourceId, sourceId))
      const only = rest.length === 1 ? rest[0] : undefined
      if (only !== undefined) {
        // #471: Trägt die Zeile danach die ganze Rechnung, entfällt auch der Zusatz „(anteilig …)“.
        const whole = !partial.has(sourceId) && carriesWholeInvoice(next, only)
        await tx.update(costItems).set({ sourceId: null, ...(whole ? { description: baseDescription(only.description) } : {}) }).where(eq(costItems.sourceId, sourceId))
      }
      await dropEmptySource(tx, sourceId)
    }
    await settleOperatingPowerLinks(tx, propertyId, written)
  }
}

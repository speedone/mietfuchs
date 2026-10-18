import type { CostModel, HeatingModel, NotSettled, SelfSupplyKind, Tenancy, Unit } from './types'
import { fmtDate, fmtEuro, parseEuro } from './api'
import { overlapsOf } from '../../shared/tenancyOverlap.ts'
import { andList } from '../../shared/wording.ts'
import type { Problem } from './formProblems'
import { co2SelfSupply, halfSplitEnactedOn } from '../../shared/law/co2kostaufg.ts'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

// Das Nebenkostenmodell am Mietverhältnis (#93) in der Oberfläche: Beschriftungen und der Rumpf.
// Die Regeln der Berechnung stehen in calc.ts; hier steht nur, wie sie heißen.

export const COST_MODEL_LABELS: Record<CostModel, string> = {
  settlement: 'Vorauszahlung mit Abrechnung',
  flatRate: 'Pauschale (keine Abrechnung)',
  inclusive: 'in der Miete enthalten (Inklusiv-/Warmmiete)',
}

// Für die Heizung zusätzlich „Mieter heizt selbst“ (Heizung PR 19, #97): Der Mieter bezieht Brennstoff oder Wärme
// über einen eigenen Vertrag, etwa für eine Gastherme oder eine zentrale Heizung. Nur hier wählbar, nie bei den
// kalten Kosten.
export const HEATING_MODEL_LABELS: Record<HeatingModel, string> = {
  ...COST_MODEL_LABELS,
  selfSupply: 'Mieter heizt selbst (eigener Vertrag für Brennstoff oder Wärme)',
}

// Welche Heizung der Mieter selbst betreibt (Durchsicht S-2). Bei der zentralen Heizung prüft die Abrechnung, ob ihr
// Betriebsstrom im Allgemeinstrom steckt; bei der Heizung in der Wohnung läuft er über den Zähler des Mieters.
export const SELF_SUPPLY_KIND_OPTIONS: { value: SelfSupplyKind | ''; label: string }[] = [
  { value: '', label: 'Keine Angabe' },
  { value: 'perUnit', label: 'Eine Heizung in der Wohnung, etwa eine Gastherme' },
  { value: 'central', label: 'Eine zentrale Heizung im Haus, deren Brennstoff der Mieter bezieht' },
]

// Der Satz unter der Auswahl, wenn der Mieter selbst heizt (Prüfung M1, S1; § 6 Abs. 2 Satz 3, 6 CO2KostAufG).
const SELF = valueAt(co2SelfSupply, LAW_AS_OF)
export const SELF_SUPPLY_TENANCY_HINT =
  'Der Mieter bezieht Brennstoff oder Wärme über einen eigenen Vertrag, etwa für eine Gastherme in der Wohnung oder für eine zentrale Heizung, deren Brennstoff er selbst kauft. ' +
  'Wartung und Betriebsstrom, die Sie tragen, rechnet Mietfuchs weiter ab. ' +
  `Den Anteil seiner CO₂-Kosten, den nach dem Stufenmodell Sie tragen, kann er binnen ${SELF.claimMonths} Monaten nach der Abrechnung seines Lieferanten in Textform von Ihnen verlangen (§ 6 Abs. 2 CO2KostAufG); erfassen Sie seine Anzeige auf der Seite Kosten unter „CO₂-Erstattung“. ` +
  `Bei Abschluss eines Mietvertrags ab dem ${germanDate(halfSplitEnactedOn())} und beim Einbau einer Heizung nach § 43 GModG müssen Sie ihn in Textform auf den Erstattungsanspruch und auf die Pflicht nach § 43 Abs. 1 GModG hinweisen (§ 6 Abs. 2 Satz 6 CO2KostAufG).`

// Die Staffel der Pauschale erscheint nur, wenn eine der beiden Arten pauschal ist. Sie ist eine
// eigene Staffel und nicht die der Vorauszahlung: Das Mietkonto führt sie im Soll, die
// Abrechnung rechnet sie nie an.
export function showsFlatRates(costModel: CostModel | undefined, heatingModel: HeatingModel | undefined): boolean {
  return costModel === 'flatRate' || heatingModel === 'flatRate'
}

// „Abrechnung“ ist die Voreinstellung und wird als null gespeichert.
export function costModelBody(costModel: CostModel, heatingModel: HeatingModel): { costModel: CostModel | null, heatingModel: HeatingModel | null } {
  return {
    costModel: costModel === 'settlement' ? null : costModel,
    heatingModel: heatingModel === 'settlement' ? null : heatingModel,
  }
}

const WORDS: Record<CostModel, string> = { settlement: 'abgerechnet', flatRate: 'als Pauschale', inclusive: 'in der Miete enthalten' }

// Eine Zeile im Kasten „Ohne Abrechnung“ auf der Seite Abrechnung.
export function notSettledText(n: NotSettled): string {
  const teile = [`Nebenkosten ${WORDS[n.costModel]}`]
  if (n.heatingModel !== 'settlement') teile.push(`Heizung ${WORDS[n.heatingModel]}`)
  return `${n.tenantName} (${n.unitName}): ${teile.join(', ')}`
}

// Das Kennzeichen in der Liste der Mietverhältnisse (#142): nichts, solange beides abgerechnet
// wird, denn das ist der Normalfall. Sind beide Arten gleich, ein Wort, sonst beide getrennt.
const SHORT: Record<HeatingModel, string> = { settlement: 'abgerechnet', flatRate: 'pauschal', inclusive: 'inklusiv', selfSupply: 'selbst' }
export function costModelBadge(costModel: CostModel | null | undefined, heatingModel: HeatingModel | null | undefined): string | null {
  const cold = costModel ?? 'settlement'
  const heat = heatingModel ?? 'settlement'
  if (cold === 'settlement' && heat === 'settlement') return null
  // Heizt der Mieter selbst und wird kalt abgerechnet, genügt die Heizung (Heizung PR 19).
  if (cold === 'settlement' && heat === 'selfSupply') return 'Heizung selbst'
  if (cold === heat) return cold === 'flatRate' ? 'Pauschale' : 'inklusiv'
  return `kalt ${SHORT[cold]} · Heizung ${SHORT[heat]}`
}

// Personenzahl aus dem Formular (#135): eine ganze Zahl ab 0. Null ist eine Angabe, etwa bei einer
// vermieteten Garage oder einem Stellplatz, die dann beim Personenschlüssel nicht mitzählen; ein
// leeres Feld ist dagegen keine, sonst würde aus einer vergessenen Eingabe still eine 0.
export function parsePersons(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  return Number(t)
}

export const PERSONS_HINT = 'Personen bitte als ganze Zahl ab 0 angeben; 0 für Garage, Stellplatz oder Lager.'

// Die Personen-Staffel aus den Formularzeilen. Eine erste Zeile ohne Datum gilt ab Einzug.
export function buildPersonHistory(
  rows: { from: string, persons: string }[],
  start: string,
): { error: string } | { personHistory: { from: string, persons: number }[] } {
  if (rows.length === 0) return { error: 'Mindestens eine Personenzahl angeben.' }
  const personHistory: { from: string, persons: number }[] = []
  for (const [i, row] of rows.entries()) {
    const persons = parsePersons(row.persons)
    const from = row.from || (i === 0 ? start : '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: 'Bitte Personen-Staffel prüfen: Jede weitere Zeile braucht ein Datum.' }
    if (persons === null) return { error: `Bitte Personen-Staffel prüfen: ${PERSONS_HINT}` }
    personHistory.push({ from, persons })
  }
  personHistory.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  return { personHistory }
}

// Monat einer Staffel (Kaltmiete, Vorauszahlung, Pauschale) aus dem Formular, als 'JJJJ-MM'.
// Das Feld war ein `<input type="month">`. Safari auf dem Mac und Firefox haben keine
// Monatsauswahl: Je nach Fassung zeigen sie ein Textfeld, in dem nur „2026-01“ durch die Prüfung
// kam, oder ein Feld, in das sich gar nichts eingeben ließ. Heute wählt man Monat und Jahr aus
// zwei Listen (MonthPicker), deren Wert 'MM.JJJJ' ist. Gelesen wird trotzdem großzügig („1.2026“,
// „01/2026“, „01.01.2026“, „2026-01“), denn die Funktion ist die eine Stelle, die einen Monat einer
// Staffel prüft. Ein Tag nur als Erster: Eine Staffel gilt ab Monatsanfang, und „15.10.2026“ still
// als Oktober zu lesen, hieße raten. `null`: nicht lesbar.
const YEAR_MIN = 1900
const YEAR_MAX = 2100

export function parseScheduleMonth(text: string): string | null {
  const t = text.trim()
  // Ein Jahr außerhalb von 1900 bis 2100 ist ein Tippfehler („01.0026“): Als frühester Eintrag
  // gälte die Staffel sonst still ab Einzug, als späterer nie.
  const month = (y: string, m: string) => {
    const n = Number(m)
    const year = Number(y)
    return n >= 1 && n <= 12 && year >= YEAR_MIN && year <= YEAR_MAX ? `${y}-${String(n).padStart(2, '0')}` : null
  }
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(t)
  if (m) return m[3] === undefined || Number(m[3]) === 1 ? month(m[1], m[2]) : null
  m = /^(?:(\d{1,2})\.)?(\d{1,2})[./](\d{4})$/.exec(t)
  if (m) return m[1] === undefined || Number(m[1]) === 1 ? month(m[3], m[2]) : null
  return null
}

// Was an einem nicht lesbaren „gültig ab“ fehlt, als Satz für die Meldung beim Speichern. `first`:
// die erste Zeile einer Staffel, nur dort heißt „beides leer“ ab Einzug.
export function scheduleMonthProblem(text: string, first = true): string {
  // Ein gespeicherter Teil, den die Auswahl nicht anbietet (ein Jahr vor 1900, ein Monat 13), steht
  // dort leer. „Bitte noch das Jahr wählen“ klänge dann, als sei keines gespeichert (Durchsicht von #287).
  const raw = /^(\d{2})?\.(\d{4})?$/.exec(text.trim())
  if (raw?.[2] !== undefined && (Number(raw[2]) < YEAR_MIN || Number(raw[2]) > YEAR_MAX)) {
    return `Das gespeicherte Jahr ${raw[2]} liegt außerhalb von ${YEAR_MIN} bis ${YEAR_MAX}. Bitte wählen Sie das Jahr neu.`
  }
  if (raw?.[1] !== undefined && (Number(raw[1]) < 1 || Number(raw[1]) > 12)) {
    return `Den gespeicherten Monat ${raw[1]} gibt es nicht. Bitte wählen Sie den Monat neu.`
  }
  const both = first ? ' (beides leer heißt ab Einzug).' : '.'
  const { month, year } = monthPickerParts(text)
  if (month && !year) return `Bitte noch das Jahr wählen${both}`
  if (year && !month) return `Bitte noch den Monat wählen${both}`
  return `Der gespeicherte Monat „${text.trim()}“ ist ungültig. Bitte Monat und Jahr neu wählen.`
}

// Die Staffeln am Mietverhältnis, die nach Monat gelten. Name für Meldungen, die Änderung für den
// fehlenden Monat und die Beschriftung des Felds, je Staffel eindeutig (Screenreader, Tests).
export type ScheduleKind = 'baseRent' | 'prepayment' | 'flatRate' | 'heatingPrepayment'
const SCHEDULES: Record<ScheduleKind, { name: string; change: string; label: string }> = {
  baseRent: { name: 'Kaltmiete-Staffel', change: 'die Mieterhöhung', label: 'Kaltmiete gültig ab' },
  prepayment: { name: 'Vorauszahlungs-Staffel', change: 'die Änderung der Vorauszahlung', label: 'Vorauszahlung gültig ab' },
  flatRate: { name: 'Staffel der Pauschale', change: 'die Änderung der Pauschale', label: 'Pauschale gültig ab' },
  heatingPrepayment: { name: 'Staffel der Heizvorauszahlung', change: 'die Änderung der Heizvorauszahlung', label: 'Heizvorauszahlung gültig ab' },
}
export const scheduleLabel = (kind: ScheduleKind): string => SCHEDULES[kind].label

// Eine Staffel aus den Zeilen des Formulars ('MM.JJJJ' aus dem MonthPicker), als 'JJJJ-MM'. Ganz
// leere Zeilen fallen weg. Ohne Monat gilt nur die erste Zeile ab Einzug; in jeder weiteren ist ein
// fehlender Monat ein Fehler. Vorher galt `row.from || start` für jede Zeile: Eine Mieterhöhung,
// deren Monat stehen blieb, ergab einen zweiten Eintrag zum Einzugsmonat, und nach „es gilt der
// letzte“ (schedule.ts) galt der neue Betrag rückwirkend ab Einzug (Durchsicht von #287). Aus
// demselben Grund werden zwei Zeilen zum selben Monat abgelehnt statt still zusammengelegt.
export function buildSchedule(
  rows: readonly { from: string; amount: string }[],
  start: string,
  kind: ScheduleKind,
): { schedule: { from: string; monthlyCents: number }[] } | { error: string } {
  const { name, change } = SCHEDULES[kind]
  const schedule: { from: string; monthlyCents: number }[] = []
  for (const [i, row] of rows.entries()) {
    if (isBlankRow(row)) continue
    // Die erste Stufe ist die erste Zeile mit Inhalt, nicht die erste im Formular (Durchsicht, Kann 2).
    const first = startsSchedule(rows, i)
    let from: string | null
    if (row.from.trim()) {
      from = parseScheduleMonth(row.from)
      if (from === null) return { error: `${name}: ${scheduleMonthProblem(row.from, first)}` }
    } else if (first) {
      from = start.slice(0, 7)
    } else {
      return { error: `${name}: Bitte wählen Sie für ${change} den Monat, ab dem sie gilt.` }
    }
    const cents = parseEuro(row.amount)
    if (cents === null || cents < 0) return { error: `Bitte den Betrag der ${name} prüfen.` }
    // Eine weitere Stufe vor dem Einzug gälte nie: Die erste gilt ab Einzug, und diese läge davor
    // (etwa ein vertipptes Jahr bei einer Mieterhöhung; Durchsicht, Kann 1).
    if (!first && from < start.slice(0, 7)) {
      return { error: `${name}: Die Zeile ab ${scheduleMonthText(from)} liegt vor dem Einzug (${scheduleMonthText(start.slice(0, 7))}) und gälte deshalb nie. Bitte prüfen Sie Monat und Jahr.` }
    }
    if (schedule.some((e) => e.from === from)) {
      return { error: `${name}: Zwei Zeilen gelten ab ${scheduleMonthText(from)}. Bitte wählen Sie für jede Zeile einen eigenen Monat.` }
    }
    schedule.push({ from, monthlyCents: cents })
  }
  return { schedule }
}

const isBlankRow = (row: { from: string; amount: string }): boolean => !row.from.trim() && !row.amount.trim()

// Beginnt Zeile i die Staffel, steht also davor keine Zeile mit Inhalt? Nur dort heißt ein leerer
// Monat „ab Einzug“, beim Speichern wie in der Auswahl.
export function startsSchedule(rows: readonly { from: string; amount: string }[], i: number): boolean {
  return rows.slice(0, i).every(isBlankRow)
}

// Monatsauswahl der Staffeln (MonthPicker): zwei Auswahllisten statt Freitext, damit jeder Browser
// gleich aussieht und sich kein Tippfehler einschleicht (Safari kennt `type="month"` nicht). Der
// Wert im Formular bleibt der Text 'MM.JJJJ', den parseScheduleMonth liest; ist nur eine der beiden
// Listen gewählt, entsteht ein unvollständiger Text ('03.' bzw. '.2026'), und das Speichern meldet
// es, statt still „ab Einzug“ anzunehmen.
export function monthPickerParts(text: string): { month: string; year: string } {
  const parsed = parseScheduleMonth(text)
  if (parsed) return { month: parsed.slice(5, 7), year: parsed.slice(0, 4) }
  // Nur Teile, die es als Auswahl gibt: Ein älterer Wert wie '2024-13' oder '0024-01' (das frühere
  // Textfeld in Safari ließ ihn durch) zeigte sonst eine Auswahl, die nicht dem Wert entspricht
  const m = /^(\d{2})?\.(\d{4})?$/.exec(text.trim())
  if (!m) return { month: '', year: '' }
  const month = m[1] !== undefined && Number(m[1]) >= 1 && Number(m[1]) <= 12 ? m[1] : ''
  const year = m[2] !== undefined && Number(m[2]) >= YEAR_MIN && Number(m[2]) <= YEAR_MAX ? m[2] : ''
  return { month, year }
}

// Der Text des leeren Monats. Ein gespeicherter Wert, den die Auswahl nicht lesen kann (etwa
// '2024-02-15' aus einem Aufruf an der Oberfläche vorbei), wird benannt statt „ab Einzug“ zu zeigen:
// Die Berechnung vergleicht Text, '2024-02-15' gälte dort erst ab März, und ihn als Februar zu lesen,
// verschöbe beim Speichern still die Staffel (Durchsicht, Kann 3). Das Speichern meldet ihn.
export function monthPickerEmptyLabel(value: string, emptyLabel: string | undefined): string {
  const { month, year } = monthPickerParts(value)
  if (value.trim() && !month && !year) return `gespeichert: ${value.trim()}`
  return !year && emptyLabel ? emptyLabel : '– Monat –'
}

export function monthPickerText(month: string, year: string): string {
  return month === '' && year === '' ? '' : `${month}.${year}`
}

// Dieselbe Auswahl für Felder, deren Wert 'JJJJ-MM' bleibt (Zeitraumwechsel, Heizperiode): vollständig
// als 'JJJJ-MM', unvollständig wie oben, sodass deren Prüfung (etwa parsePeriodKey) es ablehnt und die
// Auswahl die gewählte Hälfte weiter zeigt.
export function monthPickerIso(month: string, year: string): string {
  return month !== '' && year !== '' ? `${year}-${month}` : monthPickerText(month, year)
}

// Jahre zur Auswahl: ab dem Einzugsjahr (ohne Einzug zehn Jahre zurück) bis zehn Jahre nach dem
// späteren von Einzug und heute, damit ein Staffelmietvertrag (§ 557a BGB) seine Stufen über Jahre
// im Voraus eintragen kann; dazu das Jahr eines schon gespeicherten Werts. Ein Wert außerhalb der
// Liste zeigte der Browser sonst als ersten Eintrag an, ohne dass sich etwas ändert. Begrenzt auf
// die Jahre, die parseScheduleMonth annimmt, damit ein Tippfehler im Einzug die Liste nicht aufbläht.
export function monthPickerYears(start: string, value: string, today: string): string[] {
  const now = Number(today.slice(0, 4))
  const startYear = /^\d{4}/.test(start) ? Number(start.slice(0, 4)) : null
  const valid = startYear !== null && startYear >= YEAR_MIN && startYear <= YEAR_MAX
  const from = valid ? Math.min(startYear, now) : now - 10
  const to = Math.min((valid ? Math.max(startYear, now) : now) + 10, YEAR_MAX)
  const years = new Set<number>()
  for (let y = Math.max(from, YEAR_MIN); y <= to; y++) years.add(y)
  const own = monthPickerParts(value).year
  if (own) years.add(Number(own))
  return [...years].sort((a, b) => a - b).map(String)
}

// Gespeichertes 'JJJJ-MM' fürs Formular als 'MM.JJJJ'.
export function scheduleMonthText(from: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(from)
  return m ? `${m[2]}.${m[1]}` : from
}

// Die Wohnung, die der Dialog für ein neues Mietverhältnis vorwählt (#142). Vorher die erste
// überhaupt, oft die selbstgenutzte. Jetzt die erste vermietbare ohne laufendes Mietverhältnis,
// sonst die erste vermietbare, und nur wenn es keine gibt, die erste Wohnung.
export function defaultTenancyUnitId(units: Unit[], tenancies: Tenancy[], today: string): string {
  const rentable = units.filter((u) => u.participates)
  const occupied = new Set(tenancies.filter((t) => t.end === null || t.end >= today).map((t) => t.unitId))
  return (rentable.find((u) => !occupied.has(u.id)) ?? rentable[0] ?? units[0])?.id ?? ''
}

// Die Rückfrage beim Speichern eines Mietverhältnisses, das sich mit einem anderen derselben
// Wohnung überschneidet (#204). Für die gemeinsamen Tage trügen beide Mieter die Nebenkosten der
// Wohnung voll. Meist ist ein Datum vertippt; es kann aber gewollt sein (etwa ein Untermieter, der
// als eigenes Mietverhältnis geführt wird), deshalb fragt die Oberfläche nur, und der Server lehnt
// nicht ab. Die Regel, wann sich zwei überschneiden, steht in shared/tenancyOverlap.ts.
export function overlapQuestion(
  candidate: { id?: string | null, unitId: string, start: string, end: string | null },
  tenancies: readonly Tenancy[],
): { title: string, message: string, confirmLabel: string } | null {
  if (!candidate.start || !candidate.unitId) return null
  const found = overlapsOf({ ...candidate, end: candidate.end || null }, tenancies)
  if (found.length === 0) return null
  const parts = found.map((o) => `„${o.other.tenantName}“ ${o.to === null ? `ab dem ${fmtDate(o.from)}` : `vom ${fmtDate(o.from)} bis ${fmtDate(o.to)}`}`)
  return {
    title: 'Mietverhältnisse überschneiden sich',
    message: `Dieses Mietverhältnis überschneidet sich in derselben Wohnung mit ${andList(parts)}. ` +
      'Für diese Zeit trügen beide Mieter die Nebenkosten der Wohnung voll, und die Abrechnung meldet es als Fehler. ' +
      'Ist ein Datum vertippt, korrigieren Sie bitte Einzug oder Auszug; für einen Wechsel nutzen Sie am besten den Mieterwechsel. Trotzdem speichern?',
    confirmLabel: 'Trotzdem speichern',
  }
}

// Die Spalte „Vorauszahlung je Monat“ der Mietverhältnisse (Sichtprüfung E12): die Staffel und,
// bei getrennter Heizkostenabrechnung, die Heizvorauszahlung daneben. Ohne sie sah die übrige
// Vorauszahlung nach dem Aufteilen aus wie eine gesunkene.
export function prepaymentColumn(t: Pick<Tenancy, 'prepayments' | 'heatingPrepayments'>): { label: string | null; amount: string }[] {
  const heating = t.heatingPrepayments ?? []
  const withFrom = t.prepayments.length > 1 || heating.length > 1
  const month = (from: string) => `${from.slice(5, 7)}/${from.slice(0, 4)}`
  return [
    ...t.prepayments.map((p) => ({ label: t.prepayments.length > 1 ? `ab ${month(p.from)}:` : null, amount: fmtEuro(p.monthlyCents) })),
    ...heating.map((p) => ({ label: withFrom ? `+ Heizung ab ${month(p.from)}:` : '+ Heizung:', amount: fmtEuro(p.monthlyCents) })),
  ]
}

// Die Pflichtangaben eines Mietverhältnisses (#346, Schritt 3), je mit Feld. Vorher stand für alle drei ein
// Satz „Bitte Mieter, Wohnung und Einzugsdatum prüfen.“, der nicht sagte, welches Feld fehlt (UI-Durchsicht M5).
export type TenancyField = 'tenantName' | 'unitId' | 'start' | 'deposit' | 'contractDate' | 'iban'
export function tenancyRequired(form: { tenantName: string; unitId: string; start: string }): Problem<TenancyField>[] {
  const problems: Problem<TenancyField>[] = []
  if (!form.tenantName.trim()) problems.push({ field: 'tenantName', short: 'Mieter fehlt', text: 'Mieter: Geben Sie den Namen des Mieters ein, etwa „Familie Müller“.' })
  if (!form.unitId) problems.push({ field: 'unitId', short: 'Wohnung fehlt', text: 'Wohnung: Wählen Sie die Wohnung, die vermietet ist.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.start)) problems.push({ field: 'start', short: 'Einzug fehlt', text: 'Einzug: Geben Sie das Datum des Einzugs ein.' })
  return problems
}

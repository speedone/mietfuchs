import type { CostModel, NotSettled, Tenancy, Unit } from './types'
import { fmtDate } from './api'
import { overlapsOf } from '../../shared/tenancyOverlap.ts'
import { andList } from '../../shared/wording.ts'

// Das Nebenkostenmodell am Mietverhältnis (#93) in der Oberfläche: Beschriftungen und der Rumpf.
// Die Regeln der Berechnung stehen in calc.ts; hier steht nur, wie sie heißen.

export const COST_MODEL_LABELS: Record<CostModel, string> = {
  settlement: 'Vorauszahlung mit Abrechnung',
  flatRate: 'Pauschale (keine Abrechnung)',
  inclusive: 'in der Miete enthalten (Inklusiv-/Warmmiete)',
}

// Die Staffel der Pauschale erscheint nur, wenn eine der beiden Arten pauschal ist. Sie ist eine
// eigene Staffel und nicht die der Vorauszahlung: Das Mietkonto führt sie im Soll, die
// Abrechnung rechnet sie nie an.
export function showsFlatRates(costModel: CostModel | undefined, heatingModel: CostModel | undefined): boolean {
  return costModel === 'flatRate' || heatingModel === 'flatRate'
}

// „Abrechnung“ ist die Voreinstellung und wird als null gespeichert.
export function costModelBody(costModel: CostModel, heatingModel: CostModel): { costModel: CostModel | null, heatingModel: CostModel | null } {
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
const SHORT: Record<CostModel, string> = { settlement: 'abgerechnet', flatRate: 'pauschal', inclusive: 'inklusiv' }
export function costModelBadge(costModel: CostModel | null | undefined, heatingModel: CostModel | null | undefined): string | null {
  const cold = costModel ?? 'settlement'
  const heat = heatingModel ?? 'settlement'
  if (cold === 'settlement' && heat === 'settlement') return null
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

// Was an einem nicht lesbaren „gültig ab“ fehlt, als Satz für die Meldung beim Speichern
export function scheduleMonthProblem(text: string): string {
  const { month, year } = monthPickerParts(text)
  if (month && !year) return 'Bitte noch das Jahr wählen (beides leer heißt ab Einzug).'
  if (year && !month) return 'Bitte noch den Monat wählen (beides leer heißt ab Einzug).'
  return `Der gespeicherte Monat „${text.trim()}“ ist ungültig. Bitte Monat und Jahr neu wählen.`
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

export function monthPickerText(month: string, year: string): string {
  return month === '' && year === '' ? '' : `${month}.${year}`
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

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
// kam, oder ein Feld, in das sich gar nichts eingeben ließ. Es ist deshalb ein Textfeld für
// „MM.JJJJ“, in jedem Browser gleich. Angenommen wird auch, was ein Mensch sonst tippt: „1.2026“,
// „01/2026“, „01.01.2026“ und „2026-01“. Ein Tag nur als Erster: Eine Staffel gilt ab
// Monatsanfang, und „15.10.2026“ still als Oktober zu lesen, hieße raten. `null`: nicht lesbar.
export function parseScheduleMonth(text: string): string | null {
  const t = text.trim()
  const month = (y: string, m: string) => {
    const n = Number(m)
    return n >= 1 && n <= 12 ? `${y}-${String(n).padStart(2, '0')}` : null
  }
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(t)
  if (m) return m[3] === undefined || Number(m[3]) === 1 ? month(m[1], m[2]) : null
  m = /^(?:(\d{1,2})\.)?(\d{1,2})[./](\d{4})$/.exec(t)
  if (m) return m[1] === undefined || Number(m[1]) === 1 ? month(m[3], m[2]) : null
  return null
}

export const SCHEDULE_MONTH_HINT = 'Monat als MM.JJJJ, etwa 01.2026; leer heißt ab Einzug.'

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

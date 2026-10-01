import type { CostModel, NotSettled, Tenancy, Unit } from './types'

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

// Die Wohnung, die der Dialog für ein neues Mietverhältnis vorwählt (#142). Vorher die erste
// überhaupt, oft die selbstgenutzte. Jetzt die erste vermietbare ohne laufendes Mietverhältnis,
// sonst die erste vermietbare, und nur wenn es keine gibt, die erste Wohnung.
export function defaultTenancyUnitId(units: Unit[], tenancies: Tenancy[], today: string): string {
  const rentable = units.filter((u) => u.participates)
  const occupied = new Set(tenancies.filter((t) => t.end === null || t.end >= today).map((t) => t.unitId))
  return (rentable.find((u) => !occupied.has(u.id)) ?? rentable[0] ?? units[0])?.id ?? ''
}

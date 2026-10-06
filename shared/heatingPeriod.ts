// Die eigene Heizperiode einer Heizanlage (#217, Heizung PR 5, Entwurf 3.0, 3.1).
//
// Eine Anlage rechnet im Zeitraum ihres Objekts ab (`periodStartMonth` null) oder in einem eigenen
// Rhythmus, etwa Mai bis April wie ihr Messdienst. Die Heizperioden werden wie die Zeiträume des
// Objekts berechnet (shared/period.ts) und nie gespeichert; ihr Schlüssel ist der Monat des Beginns.
//
// **Wo eine Heizperiode abgerechnet wird.** Ohne getrennte Abrechnung gehört sie in die
// Betriebskostenabrechnung des Objektzeitraums, in dem sie endet (Weg b, BGH VIII ZR 240/07: zulässig,
// wenn über die Heizkosten nicht getrennt abzurechnen ist). Werden die Heizkosten mit eigener
// Vorauszahlung getrennt abgerechnet, bekommt jede Heizperiode ihre eigene Heizkostenabrechnung mit
// eigener Frist (Weg d, Auslegung nach 15.1 Nr. 21), aber nur, wenn sie kein Abrechnungszeitraum des
// Objekts ist: Bei H = P gibt es eine Gesamtabrechnung, die beide Vorauszahlungen getrennt ausweist.
// Ob Weg d gilt, sagen die gespeicherten Spannen (`separateSpans`), nicht die Antwort von heute:
// Ein Ausschalten wirkt erst ab W, und eine Heizperiode davor bleibt getrennt (D1).
//
// **Jeder Monat der Heizstaffel wird genau einmal angerechnet** (6.1 Nr. 5): in der
// Heizkostenabrechnung der getrennten Heizperiode, die ihn enthält, sonst in der Abrechnung P, die
// ihn enthält. Die Regel steht hier und nur hier (`separateOwner`); P und die Heizkostenabrechnung
// fragen beide.

import { periodContaining, periodOfKey, periodsBetween, settlementDeadline } from './period.ts'
import type { BillingPeriod, PeriodKey, PeriodRules, SeparateSpan, Unit } from './types.ts'

export type PlantRhythm = { periodStartMonth: number | null; periodChanges: readonly string[] }
export type PlantWay = PlantRhythm & { separateSpans: readonly SeparateSpan[] }

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const monthName = (month: string): string => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)

export const hasOwnRhythm = (plant: Pick<PlantRhythm, 'periodStartMonth'>): boolean => plant.periodStartMonth !== null

export const plantRules = (plant: PlantRhythm, objectRules: PeriodRules): PeriodRules =>
  plant.periodStartMonth === null ? objectRules : { startMonth: plant.periodStartMonth, changes: [...plant.periodChanges] }

export const sameSpan = (a: Pick<BillingPeriod, 'from' | 'to'>, b: Pick<BillingPeriod, 'from' | 'to'>): boolean => a.from === b.from && a.to === b.to

// Ist die Heizperiode zugleich ein Abrechnungszeitraum des Objekts? Verglichen werden die Grenzen,
// nicht der Schlüssel: Der Rumpf 01.01.–30.04.2025 des Objekts und das Kalenderjahr 2025 der Anlage
// tragen beide '2025-01'.
export function isObjectPeriod(objectRules: PeriodRules, h: BillingPeriod): boolean {
  const p = periodOfKey(objectRules, h.key)
  return p !== null && sameSpan(p, h)
}

// Die Heizperioden, deren Ende in P liegt, in ihrer Reihenfolge. Bei zwei Zwölfmonatsrhythmen genau
// eine; nur ein Wechsel kann zwei oder keine ergeben (Entwurf 3.0).
export function heatingPeriodsEndingIn(rules: PeriodRules, p: Pick<BillingPeriod, 'from' | 'to'>): BillingPeriod[] {
  return periodsBetween(rules, p.from, p.to).filter((h) => h.to >= p.from && h.to <= p.to)
}

// Die Spanne, in die eine Heizperiode reicht: Sie endet am oder nach dem Monat X und beginnt vor W.
// Monate als 'JJJJ-MM' werden Zeichen für Zeichen verglichen, wie `compareText` in calc.ts.
export const spanOf = (spans: readonly SeparateSpan[], h: BillingPeriod): SeparateSpan | undefined =>
  spans.find((s) => h.to.slice(0, 7) >= s.from && (s.until === null || h.key < s.until))

export function settledSeparately(plant: PlantWay, objectRules: PeriodRules, h: BillingPeriod): boolean {
  return hasOwnRhythm(plant) && !isObjectPeriod(objectRules, h) && spanOf(plant.separateSpans, h) !== undefined
}

// Die getrennt abgerechnete Heizperiode, der ein Monat der Heizstaffel gehört; `null` heißt: Die
// Abrechnung P, die den Monat enthält, rechnet ihn an. Ein Monat vor X gehört P, auch wenn seine
// Heizperiode getrennt abgerechnet wird: Seine Vorauszahlung stand beim Umstellen ganz in
// `prepayments` und ist dort angerechnet (C3).
export function separateOwner(plant: PlantWay, objectRules: PeriodRules, month: string): BillingPeriod | null {
  if (!hasOwnRhythm(plant)) return null
  const h = periodContaining(plantRules(plant, objectRules), `${month}-01`)
  const span = isObjectPeriod(objectRules, h) ? undefined : spanOf(plant.separateSpans, h)
  return span !== undefined && month >= span.from ? h : null
}

// Der Abrechnungszeitraum P, zu dem eine Kostenposition gehört (Sichtprüfung E48, E32): Eine
// Heizposition einer Anlage mit eigener Heizperiode trägt den Schlüssel ihrer Heizperiode und gehört
// in den Zeitraum, der deren Ende enthält (Entwurf 3.0); `separate`: nach Weg d in einer eigenen
// Heizkostenabrechnung. Jede andere Position gehört zu ihrem Schlüssel. Die Regel steht hier, weil
// Oberfläche (Kostenvergleich, Belegordner, Vorjahr) und Berechnung (Vergleich mit dem Vorjahr)
// dasselbe meinen müssen.
export function settlementKeyOf(
  item: { period: PeriodKey; heatingPlantId?: string | null },
  objectRules: PeriodRules,
  plants: readonly (PlantWay & { id: string })[],
): { key: PeriodKey; separate: boolean } {
  const plant = item.heatingPlantId ? plants.find((p) => p.id === item.heatingPlantId) : undefined
  if (!plant || !hasOwnRhythm(plant)) return { key: item.period, separate: false }
  const h = periodOfKey(plantRules(plant, objectRules), item.period)
  if (h === null) return { key: item.period, separate: false }
  return { key: periodContaining(objectRules, h.to).key, separate: settledSeparately(plant, objectRules, h) }
}

// Ohne Liste versorgt eine Anlage alle Wohnungen ohne „kein Anschluss: Wärme“ (#117), mit Liste
// genau diese (PR 4, `units_limited`).
export function servesUnit(plant: { units: readonly { unitId: string }[] | null }, unit: Pick<Unit, 'id' | 'noConnection'>): boolean {
  if (plant.units === null) return !(unit.noConnection ?? []).includes('waerme')
  return plant.units.some((u) => u.unitId === unit.id)
}

// Kesseltausch (Heizung PR 9): Zwei Anlagen hängen zusammen, wenn die eine die andere ersetzt, auch über
// mehrere Täusche hinweg (A → A2 → A3, Durchsicht von #238, C1). Sie dürfen dieselben Wohnungen versorgen,
// denn sie heizen nacheinander.
type Succession = { id: string; replacesPlantId?: string | null }
export const replaces = (a: Succession, b: Succession): boolean => a.replacesPlantId === b.id || b.replacesPlantId === a.id

// Die Anlage und ihre Vorgängerinnen mit demselben Brennstoff, die nächste zuerst (Kesseltausch Öl → Öl,
// Nachprüfung von #238, K1): Hat die neue Anlage im Jahr des Tauschs noch keine eigene Brennstoffposition,
// folgen die Überträge dem Schlüssel der Vorgängerin. Das gilt auch, wenn sie den Restbestand nicht
// übernimmt: Ihr eigener Anfangsbestand wird ebenso verbraucht und braucht denselben Schlüssel.
export function sameFuelLine<P extends Succession & { energy: string }>(plant: P, plants: readonly P[]): string[] {
  const ids = [plant.id]
  let cur = plant
  while (cur.replacesPlantId) {
    const prev = plants.find((p) => p.id === cur.replacesPlantId)
    if (!prev || prev.energy !== plant.energy || ids.includes(prev.id)) break
    ids.push(prev.id)
    cur = prev
  }
  return ids
}

// Die erste Anlage einer Linie von Täuschen; ein Verweis ins Leere oder ein Kreis endet dort.
export function lineRoot(plant: Succession, plants: readonly Succession[]): string {
  let cur = plant
  const seen = new Set<string>([cur.id])
  while (cur.replacesPlantId) {
    const prev = plants.find((p) => p.id === cur.replacesPlantId)
    if (!prev || seen.has(prev.id)) break
    seen.add(prev.id)
    cur = prev
  }
  return cur.id
}
export const sameLine = (a: Succession, b: Succession, plants: readonly Succession[]): boolean => a.id !== b.id && lineRoot(a, plants) === lineRoot(b, plants)

// Das Gebäude einer Anlage (Heizung PR 9, § 5 Abs. 1 CO2KostAufG): die erste Anlage ihrer Linie und,
// steht diese im selben Gebäude wie eine andere, deren Gebäude. Ohne Angabe ein eigenes.
type Housed = Succession & { buildingWith?: string | null }
// Der Weg über die Angaben zum Gebäude: die Linienanfänge nacheinander und, verweisen sie im Kreis, ab
// welchem Eintrag der Kreis beginnt.
function buildingWalk(plant: Housed, plants: readonly Housed[]): { roots: string[]; cycleFrom: number | null } {
  const roots: string[] = []
  let root = lineRoot(plant, plants)
  for (;;) {
    const at = roots.indexOf(root)
    if (at >= 0) return { roots, cycleFrom: at }
    roots.push(root)
    const head = plants.find((p) => p.id === root)
    const other = head?.buildingWith && head.buildingWith !== 'own' ? plants.find((p) => p.id === head.buildingWith) : undefined
    if (!other) return { roots, cycleFrom: null }
    root = lineRoot(other, plants)
  }
}
// Ein Kreis kommt über die Routen nicht zustande (heating.ts lehnt ihn ab); in einem Archiv kann er
// stehen. Dann ist die Wurzel die kleinste Kennung im Kreis, von jeder Anlage aus dieselbe (Nachprüfung von
// #238, I-C).
export function buildingRoot(plant: Housed, plants: readonly Housed[]): string {
  const { roots, cycleFrom } = buildingWalk(plant, plants)
  if (cycleFrom === null) return roots[roots.length - 1] ?? plant.id
  return roots.slice(cycleFrom).reduce((a, b) => (b < a ? b : a))
}
// Die Linienanfänge eines Kreises aus mindestens zwei Gebäudeangaben, sonst `null`. Verweist eine Anlage
// auf eine ihrer eigenen Linie, ist das kein Kreis zwischen Gebäuden.
export function buildingCycle(plants: readonly Housed[]): string[] | null {
  for (const p of plants) {
    const { roots, cycleFrom } = buildingWalk(p, plants)
    if (cycleFrom !== null && roots.length - cycleFrom >= 2) return roots.slice(cycleFrom)
  }
  return null
}
export const sameBuilding = (a: Housed, b: Housed, plants: readonly Housed[]): boolean => a.id !== b.id && buildingRoot(a, plants) === buildingRoot(b, plants)

// Die Tage, an denen eine Anlage heizt (Heizung PR 9): ab dem Tag nach dem letzten Betriebstag der
// Anlage, die sie ersetzt, bis zu ihrem eigenen letzten Betriebstag. `null` heißt offen.
export function plantSpan(plant: Succession & { endsOn?: string | null }, plants: readonly (Succession & { endsOn?: string | null })[]): { from: string | null; to: string | null } {
  const before = plant.replacesPlantId ? plants.find((p) => p.id === plant.replacesPlantId) : undefined
  const from = before?.endsOn ? new Date(Date.parse(`${before.endsOn}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null
  return { from, to: plant.endsOn ?? null }
}

// Eine Abrechnung nur mit Heizkosten für einen Zeitraum, in dem der Mieter nicht mehr gewohnt hat,
// ist nicht entschieden (15.1 Nr. 2). Empfohlen wird die Frist des Zeitraums, in dem das
// Mietverhältnis endete; die zwölf Monate kommen aus dem Rechtsregister (`settlementDeadline`).
export function recommendedDeadline(objectRules: PeriodRules, end: string): string {
  return settlementDeadline(periodContaining(objectRules, end))
}

// Bis wann die Abrechnung des Messdienstes anzufordern ist, damit die empfohlene Frist hält: zwei
// Monate vorher, wie im Beispiel des Entwurfs (3.1, L3: Frist 31.12.2026, Anforderung bis Oktober
// 2026). Eine Festlegung für den Text, keine Rechtsfrist.
export function requestMonth(deadline: string): string {
  const index = Number(deadline.slice(0, 4)) * 12 + Number(deadline.slice(5, 7)) - 1 - 2
  const year = Math.floor(index / 12)
  return `${MONTH_NAMES[index - year * 12] ?? ''} ${year}`
}

// „Mai bis Dezember 2025“, über den Jahreswechsel „Dezember 2025 bis Januar 2026“, ein Monat „Mai 2025“.
export function monthSpanText(months: readonly string[]): string {
  const first = months[0]
  const last = months[months.length - 1]
  if (first === undefined || last === undefined) return ''
  if (first === last) return `${monthName(first)} ${first.slice(0, 4)}`
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${monthName(first)} bis ${monthName(last)} ${first.slice(0, 4)}`
    : `${monthName(first)} ${first.slice(0, 4)} bis ${monthName(last)} ${last.slice(0, 4)}`
}

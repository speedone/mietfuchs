// Die eigene Heizkostenabrechnung nach der Heizkostenverordnung (Heizung PR 10, Entwurf 8), als
// reine Funktionen. Kein Geld, keine Uhr, keine Locale: Die Gewichte sind Bruchteile der Töpfe
// Heizung und Warmwasser, und eine Position mit Betrag A bekommt in calc.ts die Rohwerte A · g_r(Ziel),
// verteilt mit `distributeCents` (#202).
//
// **Nutzer.** Je Wohnung die Mieter der Heizperiode und dazwischen die Zeiten ohne Mietverhältnis:
// Leerstand, bei einer selbstgenutzten Wohnung die Eigennutzung, bei einer Wohnung außerhalb der
// Abrechnungseinheit „außerhalb“. Der Vermieter ist Nutzer der leeren Räume, sein Eintritt ist ein
// Nutzerwechsel (§ 9b Abs. 1, §§ 6, 7 Abs. 1 Satz 5 HeizkostenV; Entwurf 3.5).
//
// **Ablesung an einer Grenze** (Entwurf 3.5, Abweichung 9 des Plans). Grenzen sind das Ende des Tages
// vor der Heizperiode, ihr letzter Tag und der letzte Tag jedes Nutzers. Eine Ablesung aus dem
// Mieterwechsel gehört fest zu ihrer Grenze. Sonst, als Festlegung nach der Praxis der Messdienste
// ohne Quelle, die Ablesung, die der Grenze am nächsten liegt, aus denen, die ihr näher liegen als
// jeder anderen Grenze der Wohnung über H−1, H und H+1 (genau in der Mitte: zur früheren Grenze; zwei
// gleich weit: die frühere). Zwei verschiedene Werte am selben Tag sind ein Befund. Ist die Vorperiode
// abgeschlossen, ist ihr eingefrorener Endstand der Anfangsstand. Gerechnet wird mit dem Wert, wie er
// abgelesen ist: ohne Rückrechnung (LG Osnabrück, NZM 2004, 95) und **ohne lineare Interpolation**
// (Entwurf 8.4). Ab der Warngrenze neben einem Wechsel wählt der Vermieter (§ 9b Abs. 3 Alt. 2).
//
// **§ 9b.** Verbrauch nach der Zwischenablesung; übrige Wärmekosten nach Gradtagen oder Tagen
// (`change_split`), übrige Warmwasserkosten nach Tagen (Abs. 2). Fehlt die Ablesung an einer Grenze
// zwischen zwei Nutzern, bilden sie eine Gruppe, deren gesamte Kosten so geteilt werden (Abs. 3).
// Fehlt sie zu Beginn oder Ende der Heizperiode, ist das ein Fall des § 9a (PR 13); bis dahin ein
// Fehler, und die Anlage wird nicht verteilt (Abweichung 5).
//
// Die Gradtagstabelle und die Warngrenze kommen als Argument herein (Register, `law()` in calc.ts).
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import type { DegreeDayTable, HeatPumpCapture } from '../../shared/law/heizkostenv.ts'
import type { ReadingOffWarning } from '../../shared/law/practice.ts'
import { dayAfter, dayBefore, type LawLog } from '../../shared/law/register.ts'
import { dhwInputOf, dhwShareOf, type DhwContext, type DhwProblem } from './dhw.ts'
import { lineRoot } from '../../shared/heatingPeriod.ts'
import type {
  SelfSpanRange,
  AreaBasisHeat, CaptureMethod, ChangeSplit, ComparableUnit, EstimatePart, EstimateProposal, DhwMethod, DhwStatement, HeatingEnergy, HeatingPart, HeatingTarget, HotWater, InsulationRule, InterimGap, InterimGapStatus, MeterType, SelfPot, SelfReadingView, SelfRole,
} from '../../shared/types.ts'

export type SelfUnit = { id: string; name: string; areaM2: number; heatedAreaM2: number | null; role: 'rented' | 'self' | 'outside' }
export type SelfTenancy = { id: string; unitId: string; tenantName: string; start: string; end: string | null }
// `factor` (Heizung PR 12): Die Differenz zweier Ablesungen zählt mal diesem Faktor; beim
// Heizkostenverteiler mit Einheitsskala der Bewertungsfaktor, sonst 1 (hca.ts `meterFactor`). Fehlt: 1.
export type SelfMeter = { id: string; name: string; unitId: string; type: MeterType; factor?: number }
// `boundFor`: Grenze einer Ablesung aus dem Mieterwechsel (`readings.interim_for`, Abweichung 9, 23).
export type SelfReading = { meterId: string; date: string; value: number; replacement?: boolean; oldEndValue?: number | null; boundFor?: string | null }
export type SelfInput = {
  h: { from: string; to: string }
  // Beginn der vorigen und Ende der folgenden Heizperiode als äußerste Grenzen der Zellen.
  neighbors: { before: string; after: string }
  // Je Wohnung die Wechselgrenzen in H−1 und H+1, damit H−1, H und H+1 einer Ablesung dieselbe Grenze
  // geben (Abweichung 9). Fehlt der Eintrag, gibt es dort keinen Wechsel.
  outerChanges?: ReadonlyMap<string, readonly string[]>
  // Je Zähler der eingefrorene Endstand der abgeschlossenen Vorperiode; er ist der Anfangsstand.
  opening?: ReadonlyMap<string, SelfReading>
  changeSplit: ChangeSplit
  hotWater: HotWater
  areaBasisHeat: AreaBasisHeat
  units: readonly SelfUnit[]
  tenancies: readonly SelfTenancy[]
  meters: readonly SelfMeter[]
  readings: readonly SelfReading[]
  gaps: readonly InterimGap[]
  table: DegreeDayTable
  // Nur gefragt, wenn eine Ablesung neben ihrer Grenze liegt; so steht die Warngrenze nur dann im
  // Rechtsstand der Abrechnung.
  offRule: () => ReadingOffWarning
  // Womit die Heizung erfasst wird (Heizung PR 12): bei `hca` die Zähler vom Typ `hkv`; Werte eines
  // Ablesedienstes kommen als gedachte Zähler vom Typ `waerme`/`warmwasser` (hca.ts `serviceMeters`).
  // Fehlt: Wärmezähler wie in PR 10.
  capture?: CaptureMethod
  // Geschätzte Verbräuche nach § 9a (Heizung PR 13) je `estimateKey(unitId, pot)`: der Verbrauch der
  // Wohnung in diesem Topf für die ganze Heizperiode, in der Einheit der Erfassung (beim Heizkostenverteiler
  // bewertete Einheiten, ohne Faktor). Er tritt nur an die Stelle des nicht erfassten Verbrauchs (§ 9a Abs. 1
  // Satz 1, Durchsicht von #242 R-I4): Nutzer mit gültigen Ablesungen behalten ihren Messwert, die übrigen bekommen zusammen ihren
  // Anteil nach Gradtagen bzw. Tagen und teilen ihn unter sich wie nach § 9b Abs. 3.
  estimates?: ReadonlyMap<string, number>
  // Die Grenze des § 9a Abs. 2 in Prozent; nur gefragt, wenn es eine Schätzung gibt, damit sie nur dann
  // im Rechtsstand der Abrechnung steht.
  estimateThreshold?: () => number
}

export type SelfUser = {
  key: string
  role: SelfRole
  tenancyId: string | null
  unitId: string
  label: string
  from: string
  to: string
  days: number
  degreeDayPermille: number
}
// Je Topf: der Bruchteil an den Grundkosten und an den Verbrauchskosten des Topfs (ohne den Anteil
// nach Verbrauch), der gemessene Verbrauch (bei einer Gruppe der rechnerische Teil) und ob der Nutzer
// in einer Gruppe nach § 9b Abs. 3 steht. `estimated` (Heizung PR 13): Der Verbrauch dieses Nutzers in
// diesem Topf kommt aus einer Schätzung nach § 9a; fehlt, wenn er abgelesen ist.
export type SelfUserPot = { base: number; consumption: number; value: number | null; group: boolean; estimated?: boolean }
export type SelfUserPlan = SelfUser & { pots: Record<SelfPot, SelfUserPot> }
export type SelfBoundary = { date: string; kind: 'start' | 'end' | 'change'; readingDates: (string | null)[]; gap: InterimGapStatus | null; far: boolean }
export type SelfUnitPlan = {
  unit: SelfUnit
  heatArea: number
  users: SelfUserPlan[]
  boundaries: SelfBoundary[]
  readings: SelfReadingView[]
  consumption: Record<SelfPot, number>
  // Je Zähler und Nutzer (bei einer Gruppe nach § 9b Abs. 3 je Gruppe) die abgelesene Menge vor dem Faktor
  // (Heizung PR 12, Durchsicht von #241, Recht-I1), aus denselben Differenzen, mit denen verteilt wird; für
  // den Ausweis je Heizkostenverteiler und Nutzungszeitraum.
  measured: { meterId: string; pot: SelfPot; raw: number; userKeys: string[]; from: string; to: string }[]
  // Schätzung (Heizung PR 13): je Topf, ob geschätzt ist, ob der Verbrauch ohne Schätzung und ohne Fehler
  // erfasst ist (für die Vorschläge der Schätzung anderer Wohnungen) und ob eine Schätzung neben
  // vollständigen Ablesungen steht (`heating.estimate-complete`, Prüfbericht A9).
  estimated: Record<SelfPot, boolean>
  captured: Record<SelfPot, boolean>
  estimateComplete: Record<SelfPot, boolean>
  // Grenzen mit zwei verschiedenen Ständen am selben Tag, die eine Schätzung deckt (Durchsicht von #242, G-M7).
  sameDayCovered: Record<SelfPot, string[]>
  // Die Schätzung ersetzt ein gemessenes Teilstück eines Nutzers (Durchsicht von #242 Runde 2, N-I2).
  replacesMeasured: Record<SelfPot, boolean>
}
export type SelfProblem =
  | { kind: 'noArea'; pot: SelfPot }
  | { kind: 'missing'; pot: SelfPot; unitId: string; unitName: string; boundary: string | null; reason: 'noMeter' | 'noReading' | 'replacement' | 'negative' | 'sameDay'; meterName: string | null }
  // Zwischenablesung ab der Warngrenze ohne Wahl des Vermieters (§ 9b Abs. 3 Alt. 2, Abweichung 22).
  | { kind: 'farInterim'; unitId: string; unitName: string; boundary: string; readingDate: string; days: number }
export type SelfFinding =
  | { kind: 'datesDiffer'; boundary: string; readingDate: string; unitName: string; days: number; permille: number; far: boolean }
  | { kind: 'interimOff'; unitId: string; unitName: string; boundary: string; readingDate: string; days: number; permille: number; far: boolean }
  | { kind: 'noInterim'; unitId: string; unitName: string; boundary: string; pots: SelfPot[]; status: InterimGapStatus | null; reason: string; tenancyIds: string[] }
export type SelfPlan = {
  pots: SelfPot[]
  units: SelfUnitPlan[]
  // `estimatedArea`: Fläche des Topfs mit geschätztem Verbrauch; `overThreshold`: sie überschreitet die
  // Grenze des § 9a Abs. 2, der Topf wird ausschließlich nach Fläche verteilt (Heizung PR 13).
  totals: Record<SelfPot, { area: number; consumption: number; measured: boolean; estimatedArea: number; overThreshold: boolean }>
  problems: SelfProblem[]
  findings: SelfFinding[]
}
export type SelfWeights = { heating: number; water: number; both: number }

export const POT_METER: Record<SelfPot, MeterType> = { heating: 'waerme', water: 'warmwasser' }

const MS_DAY = 86400000
const dayNumber = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / MS_DAY)
const spanDays = (from: string, to: string): number => dayNumber(to) - dayNumber(from) + 1
const maxText = (a: string, b: string): string => (a > b ? a : b)
const minText = (a: string, b: string): string => (a < b ? a : b)
const degreeDays = (from: string, to: string, table: DegreeDayTable): number => (from <= to ? degreeDayPermille([{ from, to }], table) : 0)

// ---------- Nutzer ----------

const GAP_LABEL: Record<Exclude<SelfRole, 'tenancy'>, string> = { vacancy: 'Leerstand', self: 'Eigennutzung', outside: 'außerhalb der Abrechnungseinheit' }

// Die Nutzer einer Wohnung in der Heizperiode, nach Beginn. Überschneiden sich zwei Mietverhältnisse
// (#204), behält jedes seine Tage; eine Lücke gibt es dann nicht, und die Zeile des Vermieters wird in
// calc.ts negativ, wie bei jeder Überschneidung.
export function usersOf(unit: SelfUnit, tenancies: readonly SelfTenancy[], h: { from: string; to: string }): SelfUser[] {
  const gapRole: Exclude<SelfRole, 'tenancy'> = unit.role === 'self' ? 'self' : unit.role === 'outside' ? 'outside' : 'vacancy'
  const own = tenancies
    .filter((t) => t.unitId === unit.id && t.start <= h.to && (t.end === null || t.end >= h.from))
    .slice()
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1))
  const users: SelfUser[] = []
  const gap = (from: string, to: string) => {
    users.push({ key: `${gapRole}:${unit.id}:${from}`, role: gapRole, tenancyId: null, unitId: unit.id, label: GAP_LABEL[gapRole], from, to, days: spanDays(from, to), degreeDayPermille: 0 })
  }
  let cursor = h.from
  for (const t of own) {
    const from = maxText(t.start, h.from)
    const to = minText(t.end ?? h.to, h.to)
    if (from > cursor) gap(cursor, dayBefore(from))
    users.push({ key: t.id, role: 'tenancy', tenancyId: t.id, unitId: unit.id, label: t.tenantName, from, to, days: spanDays(from, to), degreeDayPermille: 0 })
    cursor = maxText(cursor, dayAfter(to))
  }
  if (cursor <= h.to) gap(cursor, h.to)
  return users
}

// ---------- Ablesungen ----------

// Nach Datum; am selben Tag in der Reihenfolge der Erfassung.
export function sortReadings(readings: readonly SelfReading[]): SelfReading[] {
  return readings.map((r, i) => ({ r, i })).sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i)).map((x) => x.r)
}

// Je Grenze die Ablesung eines Zählers (`null`, wenn keine passt; Abweichung 9). `cells` ist die
// aufsteigende Liste aller Grenzen der Wohnung über H−1, H und H+1 samt den äußeren Nachbarn und
// enthält `boundaries`.
// 1. Gebunden vor nah: eine Ablesung aus dem Mieterwechsel gehört zu ihrer Grenze (bei mehreren die
//    nächste, bei gleichem Abstand die frühere).
// 2. Rückfall, Festlegung nach der Praxis der Messdienste ohne Quelle: die nächste ungebundene in der
//    Zelle der Grenze; genau in der Mitte gehört sie zur früheren Grenze, von zwei gleich weit
//    entfernten gilt die frühere. Eine an eine andere Grenze der Zellen gebundene zählt nicht mit.
// Zwei verschiedene Werte am selben Tag wählt diese Funktion nicht aus; das meldet `sameDayConflict`.
export function boundaryReadingsOf(sorted: readonly SelfReading[], boundaries: readonly string[], cells: readonly string[]): Map<string, SelfReading | null> {
  const nums = cells.map(dayNumber)
  const cellSet = new Set(cells)
  const nearest = (candidates: readonly SelfReading[], bn: number): SelfReading | null => {
    let best: SelfReading | null = null
    let bestDist = Number.POSITIVE_INFINITY
    let bestDay = 0
    for (const r of candidates) {
      const d = dayNumber(r.date)
      const dist = Math.abs(d - bn)
      if (dist < bestDist || (dist === bestDist && d < bestDay)) {
        best = r
        bestDist = dist
        bestDay = d
      }
    }
    return best
  }
  const out = new Map<string, SelfReading | null>()
  for (const b of boundaries) {
    const k = cells.indexOf(b)
    const bn = nums[k] ?? dayNumber(b)
    const tied = sorted.filter((r) => r.boundFor === b)
    if (tied.length > 0) {
      out.set(b, nearest(tied, bn))
      continue
    }
    const lo = nums[k - 1] ?? Number.NEGATIVE_INFINITY
    const hi = nums[k + 1] ?? Number.POSITIVE_INFINITY
    // Näher an dieser Grenze als an der früheren (strikt) und nicht ferner als an der späteren.
    out.set(b, nearest(sorted.filter((r) => {
      if (r.boundFor && cellSet.has(r.boundFor)) return false
      const d = dayNumber(r.date)
      return d - lo > bn - d && hi - d >= d - bn
    }), bn))
  }
  return out
}

// Ein anderer Wert desselben Zählers am selben Tag (ohne Zählerwechsel): ein Befund, keine Wahl (#69).
export function sameDayConflict(sorted: readonly SelfReading[], chosen: SelfReading): boolean {
  return !chosen.replacement && sorted.some((x) => x !== chosen && x.date === chosen.date && !x.replacement && x.value !== chosen.value)
}

// Verbrauch zwischen zwei Ablesungen desselben Zählers: Differenz der Stände, über Zählerwechsel
// hinweg mit dem Endstand des alten Geräts. Ein Wechsel ohne Endstand oder ein negativer Verbrauch
// ist ein Fall des § 9a (PR 13).
export function measuredBetween(sorted: readonly SelfReading[], a: SelfReading, b: SelfReading): { value: number } | { problem: 'replacement' | 'negative' } {
  const ia = sorted.indexOf(a)
  const ib = sorted.indexOf(b)
  if (ia < 0 || ib < 0 || ib <= ia) return { value: 0 }
  let sum = 0
  for (let k = ia + 1; k <= ib; k++) {
    const prev = sorted[k - 1]
    const cur = sorted[k]
    if (!prev || !cur) continue
    if (cur.replacement) {
      if (cur.oldEndValue === null || cur.oldEndValue === undefined) return { problem: 'replacement' }
      sum += cur.oldEndValue - prev.value
    } else {
      sum += cur.value - prev.value
    }
  }
  return sum < 0 ? { problem: 'negative' } : { value: sum }
}

// Ein Datum n Monate später (n negativ: früher), am Monatsende abgeschnitten (31.01. + 1 Monat =
// 28.02.).
export function addMonths(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1 + n
  const ty = y + Math.floor(m / 12)
  const tm = ((m % 12) + 12) % 12
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const d = Math.min(Number(iso.slice(8, 10)), last)
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Wie weit eine Ablesung neben ihrer Grenze liegt: Tage, Gradtagsanteil der Tage dazwischen (ohne
// den früheren der beiden Tage, denn eine Ablesung gilt zum Tagesende) und ob die Warngrenze erreicht
// ist (`practice.reading-off-warning`: mindestens die Monate der Regel und ein Wintermonat
// dazwischen).
export function readingOff(boundary: string, date: string, table: DegreeDayTable, rule: ReadingOffWarning): { days: number; permille: number; far: boolean } {
  const early = minText(boundary, date)
  const late = maxText(boundary, date)
  const days = dayNumber(late) - dayNumber(early)
  if (days === 0) return { days: 0, permille: 0, far: false }
  const permille = degreeDays(dayAfter(early), late, table)
  const monthAway = date > boundary ? date >= addMonths(boundary, rule.months) : date <= addMonths(boundary, -rule.months)
  let winter = false
  for (let t = dayNumber(dayAfter(early)); t <= dayNumber(late) && !winter; t++) {
    winter = rule.winterMonths.includes(new Date(t * MS_DAY).toISOString().slice(5, 7))
  }
  return { days, permille, far: monthAway && winter }
}

// ---------- Plan ----------

const POTS_OF: Record<HotWater, SelfPot[]> = { combined: ['heating', 'water'], separate: ['heating', 'water'], none: ['heating'] }
const emptyPot = (): SelfUserPot => ({ base: 0, consumption: 0, value: null, group: false })

// Schlüssel einer Schätzung in `SelfInput.estimates` (Heizung PR 13).
export const estimateKey = (unitId: string, pot: SelfPot): string => `${unitId}:${pot}`

export function planSelf(input: SelfInput): SelfPlan {
  const { h, table } = input
  const pots = POTS_OF[input.hotWater]
  const problems: SelfProblem[] = []
  const findings: SelfFinding[] = []
  const hDays = spanDays(h.from, h.to)
  const hDegree = degreeDays(h.from, h.to, table)
  const heatSplit = (u: SelfUser): number => (input.changeSplit === 'degreeDays' ? u.degreeDayPermille : u.days)
  const heatSplitTotal = input.changeSplit === 'degreeDays' ? hDegree : hDays
  const splitOf = (pot: SelfPot, u: SelfUser): number => (pot === 'heating' ? heatSplit(u) : u.days)
  const splitTotal = (pot: SelfPot): number => (pot === 'heating' ? heatSplitTotal : hDays)
  const heatAreaOf = (u: SelfUnit): number => (input.areaBasisHeat === 'heatedArea' ? (u.heatedAreaM2 ?? u.areaM2) : u.areaM2) || 0
  const areaOf = (pot: SelfPot, u: SelfUnit): number => (pot === 'heating' ? heatAreaOf(u) : u.areaM2 || 0)
  // Heizung PR 12: Der Gerätetyp der Heizung folgt der Erfassung.
  const meterTypeOf = (pot: SelfPot): MeterType => (pot === 'heating' && input.capture === 'hca' ? 'hkv' : POT_METER[pot])
  const metersOf = (unitId: string, pot: SelfPot) => input.meters.filter((m) => m.unitId === unitId && m.type === meterTypeOf(pot))
  // Schätzung (Heizung PR 13): der geschätzte Verbrauch einer Wohnung in einem Topf für die ganze
  // Heizperiode. Er tritt nur an die Stelle des nicht erfassten Verbrauchs (§ 9a Abs. 1 Satz 1); die
  // Ablesungen der Wohnung bleiben deshalb in der Rechnung. Für Hinweise neben einem Wechsel und fehlende
  // Zwischenablesungen zählen die Geräte einer geschätzten Wohnung nicht mit (`liveMetersOf`): Ein Hinweis
  // auf eine Ablesung an einem ausgefallenen Gerät sagte nichts.
  const estimateOf = (unitId: string, p: SelfPot): number | undefined => input.estimates?.get(estimateKey(unitId, p))
  const liveMetersOf = (unitId: string, p: SelfPot) => (estimateOf(unitId, p) === undefined ? metersOf(unitId, p) : [])
  const startBoundary = dayBefore(h.from)
  // Der eingefrorene Endstand der abgeschlossenen Vorperiode steht in der Liste, auch wenn die
  // Ablesung seither geändert wurde; er gilt (er steht in der zugestellten Abrechnung).
  const openingOf = (meterId: string): SelfReading | null => input.opening?.get(meterId) ?? null
  const sortedOf = new Map(input.meters.map((m) => {
    const own = input.readings.filter((r) => r.meterId === m.id)
    const o = openingOf(m.id)
    const same = o ? own.find((x) => x.date === o.date && x.value === o.value) : undefined
    return [m.id, sortReadings(o && !same ? [...own, { ...o, boundFor: null }] : own)]
  }))

  const totals = Object.fromEntries(pots.map((p) => [p, {
    area: input.units.reduce((a, u) => a + areaOf(p, u), 0), consumption: 0, measured: false, estimatedArea: 0, overThreshold: false,
  }])) as SelfPlan['totals']
  // Ein Topf ohne einen einzigen Zähler ist nicht erfasst (nur nach Fläche, `heating.no-consumption`);
  // ein Topf mit Zählern verlangt einen an jeder Wohnung mit Fläche.
  const potHasMeters = Object.fromEntries(pots.map((p) => [p, input.units.some((u) => metersOf(u.id, p).length > 0)])) as Record<SelfPot, boolean>
  for (const p of pots) if (!(totals[p].area > 0)) problems.push({ kind: 'noArea', pot: p })

  const units: SelfUnitPlan[] = input.units.map((unit) => {
    const users: SelfUserPlan[] = usersOf(unit, input.tenancies, h).map((u) => ({
      ...u,
      degreeDayPermille: degreeDays(u.from, u.to, table),
      pots: { heating: emptyPot(), water: emptyPot() },
    }))
    const boundarySet = new Set<string>([startBoundary, h.to])
    for (const u of users) {
      boundarySet.add(dayBefore(u.from))
      boundarySet.add(u.to)
    }
    const boundaries = [...boundarySet].sort()
    const cells = [...new Set([input.neighbors.before, ...(input.outerChanges?.get(unit.id) ?? []), ...boundaries, input.neighbors.after])].sort()
    const readingAt = new Map<string, Map<string, SelfReading | null>>()
    const sameDayCovered: Record<SelfPot, string[]> = { heating: [], water: [] }
    for (const p of pots) {
      for (const m of metersOf(unit.id, p)) {
        const sorted = sortedOf.get(m.id) ?? []
        const at = boundaryReadingsOf(sorted, boundaries, cells)
        const o = openingOf(m.id)
        if (o) at.set(startBoundary, sorted.find((x) => x.date === o.date && x.value === o.value) ?? null)
        readingAt.set(m.id, at)
        // Zwei verschiedene Werte am selben Tag (Abweichung 9); der eingefrorene Anfangsstand gilt.
        for (const b of boundaries) {
          const chosen = at.get(b) ?? null
          if (chosen && !(o && b === startBoundary) && sameDayConflict(sorted, chosen)) {
            // Bei einer geschätzten Wohnung ist diese Grenze dann nicht erfasst, und die Schätzung deckt sie
            // (Heizung PR 13); sonst ein Befund (PR 10 Abweichung 9).
            if (estimateOf(unit.id, p) !== undefined) {
              at.set(b, null)
              // Durchsicht von #242, G-M7: die Grenze merken; der Hinweis spricht dann nicht von widerspruchsfreien Ablesungen.
              if (!sameDayCovered[p].includes(b)) sameDayCovered[p].push(b)
            } else problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: b, reason: 'sameDay', meterName: m.name })
          }
        }
      }
    }
    const consumption: Record<SelfPot, number> = { heating: 0, water: 0 }
    const measured: SelfUnitPlan['measured'] = []
    const answerAt = (b: string): InterimGapStatus | null => input.gaps.find((x) => x.unitId === unit.id && x.date === b)?.status ?? null
    const isChange = (b: string): boolean => users.some((u, i) => i < users.length - 1 && u.to === b && users[i + 1]?.from === dayAfter(b))
    // Wie weit die Ablesungen einer Grenze daneben liegen (die fernste über alle Zähler).
    const offAt = new Map<string, { date: string; days: number; permille: number; far: boolean }>()
    // Durchsicht von #242, G-I2: Die Geräte einer geschätzten Wohnung zählen hier mit, wenn ihre Ablesung an der
    // Grenze einen behaltenen Messwert begrenzt (Stand an der Grenze und an einer Nachbargrenze): Behält der Vormieter
    // seinen Wert bis zu einer Ablesung Wochen nach dem Wechsel, entscheidet der Vermieter wie ohne Schätzung, ob sie
    // gilt oder nach § 9b Abs. 3 geteilt wird. Ohne solchen Stand sagte ein Hinweis zum ausgefallenen Gerät nichts.
    const allAt = (p: SelfPot, b: string | undefined): boolean => b !== undefined && metersOf(unit.id, p).every((m) => (readingAt.get(m.id)?.get(b) ?? null) !== null)
    const usableAt = (p: SelfPot, b: string): boolean => {
      if (estimateOf(unit.id, p) === undefined) return true
      const i = boundaries.indexOf(b)
      return metersOf(unit.id, p).length > 0 && allAt(p, b) && (allAt(p, boundaries[i - 1]) || allAt(p, boundaries[i + 1]))
    }
    for (const b of boundaries) {
      const dates = pots.flatMap((p) => (usableAt(p, b) ? metersOf(unit.id, p) : [])).map((m) => readingAt.get(m.id)?.get(b)?.date ?? null)
      if (dates.length === 0 || dates.some((d) => d === null)) continue
      const farthest = (dates as string[]).filter((d) => d !== b).reduce<string | null>((a, d) => (a === null || Math.abs(dayNumber(d) - dayNumber(b)) > Math.abs(dayNumber(a) - dayNumber(b)) ? d : a), null)
      if (farthest !== null) offAt.set(b, { date: farthest, ...readingOff(b, farthest, table, input.offRule()) })
    }
    // Ab der Warngrenze neben einem Wechsel wählt der Vermieter (§ 9b Abs. 3 Alt. 2, Abweichung 22).
    for (const b of boundaries.filter(isChange)) {
      const off = offAt.get(b)
      const answer = answerAt(b)
      if (off?.far && answer !== 'imprecise' && answer !== 'useReading') {
        problems.push({ kind: 'farInterim', unitId: unit.id, unitName: unit.name, boundary: b, readingDate: off.date, days: off.days })
      }
    }

    // Grundkosten: Fläche der Wohnung im Topf mal Anteil an Gradtagen bzw. Tagen der Heizperiode.
    for (const p of pots) {
      for (const u of users) u.pots[p].base = (totals[p].area > 0 ? areaOf(p, unit) / totals[p].area : 0) * (splitOf(p, u) / splitTotal(p))
    }

    const estimateComplete: Record<SelfPot, boolean> = { heating: false, water: false }
    const replacesMeasured: Record<SelfPot, boolean> = { heating: false, water: false }
    for (const p of pots) {
      const meters = metersOf(unit.id, p)
      const estimated = estimateOf(unit.id, p)
      if (meters.length === 0 && estimated === undefined) {
        if (potHasMeters[p] && areaOf(p, unit) > 0) problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: null, reason: 'noMeter', meterName: null })
        continue
      }
      // „Nach § 9b Abs. 3“ gewählt: die Ablesung gilt als nicht hinreichend genau (Abweichung 22).
      const has = (b: string): boolean => answerAt(b) !== 'imprecise' && meters.every((m) => (readingAt.get(m.id)?.get(b) ?? null) !== null)
      // Ohne Schätzung fehlt ein Stand zu Beginn oder Ende (ein Fall des § 9a); mit Schätzung deckt sie ihn.
      if (estimated === undefined) {
        for (const b of [startBoundary, h.to]) {
          for (const m of meters) {
            if ((readingAt.get(m.id)?.get(b) ?? null) === null) problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: b, reason: 'noReading', meterName: m.name })
          }
        }
      }
      // Gruppen: Nutzer, zwischen denen die Ablesung fehlt (§ 9b Abs. 3).
      const groups: SelfUserPlan[][] = []
      users.forEach((u, i) => {
        const prev = users[i - 1]
        const clean = prev !== undefined && prev.to === dayBefore(u.from)
        const last = groups[groups.length - 1]
        if (prev && clean && !has(prev.to) && last) last.push(u)
        else groups.push([u])
      })
      // Verbrauch einer Gruppe zwischen ihren äußeren Grenzen, mit den Differenzen je Gerät vor dem Faktor;
      // `null`, wenn er nicht erfasst ist.
      const measuredOf = (g: readonly SelfUserPlan[]): { v: number; raws: [string, number][] } | null => {
        const first = g[0]
        const lastUser = g[g.length - 1]
        if (!first || !lastUser || meters.length === 0) return null
        const from = dayBefore(first.from)
        const to = lastUser.to
        let v = 0
        let ok = true
        const raws: [string, number][] = []
        for (const m of meters) {
          const a = readingAt.get(m.id)?.get(from) ?? null
          const b = readingAt.get(m.id)?.get(to) ?? null
          if (a === null || b === null) {
            ok = false
            if (estimated === undefined && from !== startBoundary && to !== h.to) problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: a === null ? from : to, reason: 'noReading', meterName: m.name })
            continue
          }
          const result = measuredBetween(sortedOf.get(m.id) ?? [], a, b)
          if ('problem' in result) {
            ok = false
            if (estimated === undefined) problems.push({ kind: 'missing', pot: p, unitId: unit.id, unitName: unit.name, boundary: to, reason: result.problem, meterName: m.name })
            continue
          }
          // Heizung PR 12: jede Differenz mit dem Faktor ihres Geräts.
          v += result.value * (m.factor ?? 1)
          raws.push([m.id, result.value])
        }
        return ok ? { v, raws } : null
      }
      // Ein Verbrauch für eine Gruppe: allein ganz, sonst nach Gradtagen bzw. Tagen geteilt (§ 9b Abs. 3).
      const assign = (g: readonly SelfUserPlan[], v: number, fromEstimate: boolean): void => {
        const splitSum = g.reduce((a, u) => a + splitOf(p, u), 0)
        for (const u of g) {
          u.pots[p].value = g.length === 1 ? v : splitSum > 0 ? (v * splitOf(p, u)) / splitSum : 0
          u.pots[p].group = g.length > 1
          if (fromEstimate) u.pots[p].estimated = true
        }
      }
      // Ein abgelesener Verbrauch: zugeteilt und je Gerät für den Ausweis festgehalten.
      const keep = (g: readonly SelfUserPlan[], m: { v: number; raws: [string, number][] }): void => {
        const first = g[0]
        const lastUser = g[g.length - 1]
        if (!first || !lastUser) return
        for (const [id, raw] of m.raws) measured.push({ meterId: id, pot: p, raw, userKeys: g.map((u) => u.key), from: first.from, to: lastUser.to })
        consumption[p] += m.v
        assign(g, m.v, false)
      }
      const results = groups.map((g) => ({ g, m: measuredOf(g) }))
      if (estimated === undefined) {
        for (const { g, m } of results) if (m !== null) keep(g, m)
        continue
      }
      // § 9a Abs. 1 Satz 1 (Heizung PR 13, Prüfbericht A5; Durchsicht von #242, R-I4): Der geschätzte Verbrauch tritt nur an die Stelle
      // des nicht erfassten. Er gilt für die ganze Heizperiode der Wohnung; Nutzer ohne erfassten Verbrauch
      // bekommen zusammen ihren Anteil daran nach Gradtagen bzw. Tagen (wie § 9b Abs. 3), Nutzer mit gültigen
      // Ablesungen (etwa der Vormieter bis zur Zwischenablesung) behalten ihren Messwert, und kein Geld
      // wandert zwischen ihnen. Ist alles vollständig abgelesen, ersetzt die Schätzung alles (sie ist dann die
      // Markierung „unbrauchbar“, Abweichung 3 des Plans) und wird gemeldet (Prüfbericht A9).
      const complete = results.length > 0 && results.every((x) => x.m !== null)
      estimateComplete[p] = complete
      if (!complete) for (const { g, m } of results) if (m !== null) keep(g, m)
      const takers = complete ? users : results.filter((x) => x.m === null).flatMap((x) => x.g)
      // Durchsicht von #242 Runde 2, N-I2: Ersetzt die Schätzung bei einem Nutzer ein gemessenes Teilstück (zwei Stände
      // desselben Geräts mit Abstand in seinem Zeitraum)? Ein bloßer Anfangsstand ist kein abgelesener Zeitraum.
      replacesMeasured[p] = !complete && takers.some((u) => meters.some((m) => new Set((sortedOf.get(m.id) ?? [])
        .map((r) => r.date).filter((d) => d >= dayBefore(u.from) && d <= u.to)).size >= 2))
      const splitAll = users.reduce((a, u) => a + splitOf(p, u), 0)
      const part = splitAll > 0 ? (estimated * takers.reduce((a, u) => a + splitOf(p, u), 0)) / splitAll : 0
      consumption[p] += part
      assign(takers, part, true)
    }

    // Die Grenzen der Wohnung mit ihren Ablesungen (Ausweis, Ampel, Hinweise).
    const bounds: SelfBoundary[] = boundaries
      .filter((b) => b === startBoundary || b === h.to || isChange(b))
      .map((b) => {
        const all = pots.flatMap((p) => liveMetersOf(unit.id, p)).map((m) => readingAt.get(m.id)?.get(b)?.date ?? null)
        const kind = b === startBoundary ? 'start' : b === h.to ? 'end' : 'change'
        const gap = kind === 'change' ? answerAt(b) : null
        return { date: b, kind, readingDates: all, gap, far: offAt.get(b)?.far ?? false }
      })
    // Hinweise an den Wechseln: Ablesung daneben, oder keine (dann mit der Antwort des Vermieters).
    for (const bd of bounds.filter((x) => x.kind === 'change')) {
      const answer = input.gaps.find((x) => x.unitId === unit.id && x.date === bd.date)
      const imprecise = answer?.status === 'imprecise'
      const missingPots = imprecise
        ? pots.filter((p) => liveMetersOf(unit.id, p).length > 0)
        : pots.filter((p) => liveMetersOf(unit.id, p).length > 0 && liveMetersOf(unit.id, p).some((m) => (readingAt.get(m.id)?.get(bd.date) ?? null) === null))
      if (missingPots.length > 0) {
        const around = users.filter((u) => u.to === bd.date || u.from === dayAfter(bd.date))
        // „Ablesung verwenden“ passt nicht zu einer fehlenden Ablesung und zählt dann nicht als Antwort.
        const status = answer && answer.status !== 'useReading' ? answer.status : null
        findings.push({
          kind: 'noInterim', unitId: unit.id, unitName: unit.name, boundary: bd.date, pots: missingPots,
          status, reason: answer?.reason ?? '', tenancyIds: around.flatMap((u) => (u.tenancyId ? [u.tenancyId] : [])),
        })
        continue
      }
      const off = offAt.get(bd.date)
      if (off) findings.push({ kind: 'interimOff', unitId: unit.id, unitName: unit.name, boundary: bd.date, readingDate: off.date, days: off.days, permille: off.permille, far: off.far })
    }

    const readings: SelfReadingView[] = pots.flatMap((p) => metersOf(unit.id, p).flatMap((m) => bounds.map((bd) => {
      const r = readingAt.get(m.id)?.get(bd.date) ?? null
      const oldEnd = r?.replacement && r.oldEndValue !== null && r.oldEndValue !== undefined ? { oldEndValue: r.oldEndValue } : {}
      return { meterId: m.id, meterName: m.name, pot: p, boundary: bd.date, date: r?.date ?? null, value: r?.value ?? null, ...oldEnd }
    })))
    const estimatedPots = { heating: estimateOf(unit.id, 'heating') !== undefined, water: estimateOf(unit.id, 'water') !== undefined }
    const captured = Object.fromEntries((['heating', 'water'] as const).map((p) => [p,
      pots.includes(p) && !estimatedPots[p] && metersOf(unit.id, p).length > 0 &&
      !problems.some((x) => x.kind === 'missing' && x.unitId === unit.id && x.pot === p),
    ])) as Record<SelfPot, boolean>
    return { unit, heatArea: heatAreaOf(unit), users, boundaries: bounds, readings, consumption, measured, estimated: estimatedPots, captured, estimateComplete, sameDayCovered, replacesMeasured }
  })

  // Summe des Verbrauchs je Topf, dann die Bruchteile.
  for (const p of pots) {
    totals[p].consumption = units.reduce((a, u) => a + u.consumption[p], 0)
    totals[p].measured = potHasMeters[p] && totals[p].consumption > 0
    // § 9a Abs. 2 (Heizung PR 13): Überschreitet die geschätzte Fläche die Grenze der für die Verteilung
    // maßgeblichen Fläche dieses Topfs, wird er ausschließlich nach Fläche verteilt. „Überschreitet“:
    // streng größer, verglichen über Produkte, nie über einen gerundeten Anteil. Betroffen ist die Fläche
    // der Wohnung, auch wenn nur ein Teil der Heizperiode geschätzt ist (Festlegung, Abweichung 2 des Plans).
    totals[p].estimatedArea = units.filter((u) => u.estimated[p]).reduce((a, u) => a + areaOf(p, u.unit), 0)
    if (totals[p].estimatedArea > 0) {
      const limit = input.estimateThreshold?.()
      totals[p].overThreshold = limit !== undefined && totals[p].estimatedArea * 100 > totals[p].area * limit
    }
    for (const u of units) {
      for (const user of u.users) {
        const v = user.pots[p].value
        user.pots[p].consumption = totals[p].measured && v !== null ? v / totals[p].consumption : 0
      }
    }
  }

  // Ablesung neben dem Stichtag (Facette 5): je äußerer Grenze die größte Abweichung über alle Zähler.
  for (const b of [startBoundary, h.to]) {
    let worst: { date: string; unitName: string } | null = null
    for (const u of units) {
      for (const d of u.boundaries.find((x) => x.date === b)?.readingDates ?? []) {
        if (d === null || d === b) continue
        if (worst === null || Math.abs(dayNumber(d) - dayNumber(b)) > Math.abs(dayNumber(worst.date) - dayNumber(b))) worst = { date: d, unitName: u.unit.name }
      }
    }
    if (worst) {
      const off = readingOff(b, worst.date, table, input.offRule())
      findings.push({ kind: 'datesDiffer', boundary: b, readingDate: worst.date, unitName: worst.unitName, days: off.days, permille: off.permille, far: off.far })
    }
  }

  return { pots, units, totals, problems, findings }
}

// ---------- Gewichte (Entwurf 8.5, 8.6) ----------

// g_r(T) = (1 − p_T) · Grundanteil + p_T · Verbrauchsanteil; ohne erfassten Verbrauch nur der
// Grundanteil (`heating.no-consumption`); bei `overThreshold` ebenso nur der Grundanteil (§ 9a Abs. 2,
// Heizung PR 13). g_r(both) = (1 − α) · g_r(heating) + α · g_r(water).
// `shares` in Prozent, `alpha` als Bruchteil (`null`: keine verbundene Warmwasserbereitung).
export function weightsOf(plan: SelfPlan, shares: { heating: number; water: number }, alpha: number | null): Map<string, SelfWeights> {
  const out = new Map<string, SelfWeights>()
  for (const u of plan.units) {
    for (const user of u.users) {
      const g = (p: SelfPot): number => {
        if (!plan.pots.includes(p)) return 0
        // Nicht erfasst oder nach § 9a Abs. 2 nur nach Fläche (Heizung PR 13): kein Anteil nach Verbrauch.
        const share = plan.totals[p].measured && !plan.totals[p].overThreshold ? shares[p] / 100 : 0
        return (1 - share) * user.pots[p].base + share * user.pots[p].consumption
      }
      const heating = g('heating')
      const water = g('water')
      out.set(user.key, { heating, water, both: alpha === null ? heating : (1 - alpha) * heating + alpha * water })
    }
  }
  return out
}

// ---------- Schätzung nach § 9a: Vorschläge (Heizung PR 13, Entwurf 8.7) ----------

// Die Fläche einer Wohnung im Topf: beheizte Fläche nur beim Topf Heizung, wenn eingestellt (§ 7 Abs. 1
// Satz 5), sonst Wohnfläche (§ 8 Abs. 1).
const potAreaOf = (u: SelfUnitPlan, p: SelfPot): number => (p === 'heating' ? u.heatArea : u.unit.areaM2 || 0)

// Die drei Wege des § 9a Abs. 1 als Vorschläge für eine Wohnung und einen Topf.
// - Durchschnitt des Gebäudes (Vorgabe): Summe des erfassten Verbrauchs der übrigen Wohnungen ohne
//   Schätzung und ohne Fehler durch ihre Fläche, mal der Fläche der Wohnung (Abweichung 7 des Plans).
// - Vergleichbare andere Räume: dieselbe Rechnung für eine einzelne Wohnung; welche vergleichbar ist,
//   wählt der Vermieter, deshalb ohne eigenen Wert und mit der Liste `comparable` (Abweichung 6).
// - Vergleichbare Zeiträume: derselbe Topf derselben Wohnung in der vorigen Heizperiode, nur bei
//   gleicher Länge (Abweichung 5).
export function estimateProposals(plan: SelfPlan, prev: SelfPlan | null, sameLength: boolean, unitId: string, pot: SelfPot): { proposals: EstimateProposal[]; comparable: ComparableUnit[] } {
  const target = plan.units.find((u) => u.unit.id === unitId)
  const area = target ? potAreaOf(target, pot) : 0
  const others = plan.units.filter((u) => u.unit.id !== unitId && u.captured[pot] && potAreaOf(u, pot) > 0)
  const comparable: ComparableUnit[] = others.map((u) => {
    const perM2 = u.consumption[pot] / potAreaOf(u, pot)
    return { unitId: u.unit.id, unitName: u.unit.name, perM2, value: perM2 * area }
  })
  const sumArea = others.reduce((a, u) => a + potAreaOf(u, pot), 0)
  const sumUse = others.reduce((a, u) => a + u.consumption[pot], 0)
  const average: EstimateProposal = sumArea > 0
    ? { method: 'buildingAverage', value: (sumUse / sumArea) * area, perM2: sumUse / sumArea, why: 'ok' }
    : { method: 'buildingAverage', value: null, perM2: null, why: 'noMeasured' }
  const before = prev?.units.find((u) => u.unit.id === unitId)
  const previous: EstimateProposal = !before || !before.captured[pot]
    ? { method: 'previousPeriod', value: null, perM2: null, why: 'noPrevious' }
    : !sameLength
      ? { method: 'previousPeriod', value: null, perM2: null, why: 'lengthDiffers' }
      : { method: 'previousPeriod', value: before.consumption[pot], perM2: null, why: 'ok' }
  const byUnit: EstimateProposal = { method: 'comparableUnit', value: null, perM2: null, why: comparable.length > 0 ? 'ok' : 'noMeasured' }
  return { proposals: [average, previous, byUnit], comparable }
}

// Welches Gerät eine Wohnung für eine Schätzung haben muss (Abweichung 4 des Plans): § 9a setzt ein
// Gerät voraus, das ausfällt. `null`: Mietfuchs kennt die Geräte nicht (Werte eines Ablesedienstes,
// PR 12) und prüft nicht.
export function estimateDeviceType(capture: CaptureMethod | null, part: EstimatePart): Extract<MeterType, 'waerme' | 'hkv' | 'warmwasser'> | null {
  if (part === 'water') return capture === 'serviceValues' ? null : 'warmwasser'
  if (capture === 'hca') return 'hkv'
  if (capture === 'serviceValues') return null
  return 'waerme'
}

// ---------- Ziel einer Position ----------

// Passt das Ziel zur Warmwasserbereitung der Anlage? `null` heißt ja, sonst der Satz für den Hinweis
// `heating.target-invalid` (Abweichung 18 des Plans).
export function targetProblem(hotWater: HotWater, part: HeatingPart | null, target: HeatingTarget | null): string | null {
  if (part === null) return 'Bei der eigenen Heizkostenabrechnung braucht jede Position einen Teil (Brennstoff, Betrieb oder Messung)'
  if (target === null) return 'Bei der eigenen Heizkostenabrechnung braucht jede Position ein Ziel (Heizung und Warmwasser, nur Heizung oder nur Warmwasser)'
  if (hotWater === 'none' && target !== 'heating') return 'Die Heizanlage bereitet kein Warmwasser; die Position gehört zur Heizung'
  if (hotWater === 'separate' && target === 'both') return 'Das Warmwasser wird getrennt bereitet; ordnen Sie die Position der Heizung oder dem Warmwasser zu'
  if (hotWater === 'combined' && part === 'fuel' && target !== 'both') {
    return 'Bereitet die Anlage auch das Warmwasser, gehört der Brennstoff zu beidem und wird nach dem Warmwasseranteil aufgeteilt (§ 9 Abs. 1 HeizkostenV)'
  }
  return null
}

// ---------- Warmwasseranteil (Entwurf 8.3; ab Heizung PR 11 aus dhw.ts) ----------

// Was die eigene Heizkostenabrechnung zum Warmwasseranteil hineinreicht (dhw.ts `DhwContext`), dazu die
// Warmwasserbereitung der Anlage und das Protokoll der Rechtswerte, denn die Formeln fragen das Register.
// Die Sperren `formulaLater` und `heatingValueLater` aus PR 10 (Abweichung 10 dort) fallen: dhw.ts rechnet
// alle drei Verfahren des § 9 Abs. 2 und Brennstoff als Menge mit dem Heizwert (Abs. 3).
export type AlphaInput = DhwContext & { hotWater: HotWater; log: LawLog }
export type AlphaProblem = DhwProblem
// α mit dem Rechenweg aus dhw.ts. `referenceKwh` ist die Energie des Nenners in kWh, auch bei Brennstoff
// als Menge: B / Menge = Q / (Menge · Hᵢ).
export type Alpha = { value: number; dhwHeatKwh: number; referenceKwh: number; reference: 'fuel' | 'totalHeat'; estimated: boolean; statement: DhwStatement }

// α nach § 9 Abs. 1 Satz 2, Abs. 2 und 3 HeizkostenV. Ohne verbundene Warmwasserbereitung gibt es kein α.
export function hotWaterShareOf(i: AlphaInput): { ok: true; alpha: Alpha | null } | { ok: false; problem: AlphaProblem; reasons: string[] } {
  if (i.hotWater !== 'combined') return { ok: true, alpha: null }
  const o = dhwShareOf(dhwInputOf(i), i.log)
  if (!o.ok) return { ok: false, problem: o.problem, reasons: o.reasons }
  const st = o.statement
  return {
    ok: true,
    alpha: {
      value: st.alpha, dhwHeatKwh: st.heatKwh, referenceKwh: st.energyKwh,
      reference: st.denominator.kind === 'measuredTotalHeat' ? 'totalHeat' : 'fuel',
      estimated: st.estimated, statement: st,
    },
  }
}

// ---------- Zeitraum der eigenen Abrechnung (Durchsicht von #239, Runde 3) ----------

// Gilt die eigene Heizkostenabrechnung in der Heizperiode `key`? In jedem ihrer Zeiträume, der laufende nur,
// solange die Anlage selbst abrechnet; ohne Zeiträume gilt die Art der Anlage.
export type SelfSpanned = { method: string; selfSpans?: readonly SelfSpanRange[] }
export function selfActive(p: SelfSpanned, key: string): boolean {
  const spans = p.selfSpans ?? []
  if (spans.length === 0) return p.method === 'self'
  return spans.some((s) => key >= s.from && (s.until === null ? p.method === 'self' : key < s.until))
}
// Der laufende Zeitraum und sein Beginn.
export const openSelfSpan = (p: SelfSpanned): SelfSpanRange | null => (p.method === 'self' ? (p.selfSpans ?? []).find((s) => s.until === null) ?? null : null)
export const selfFromOf = (p: SelfSpanned): string | null => openSelfSpan(p)?.from ?? null

// ---------- Anteil nach Verbrauch (Entwurf 8.5, R-A7) ----------

// „Öl- oder Gasheizung“ im Sinne des § 7 Abs. 1 Satz 2. Flüssiggas zählt als Gas (Abweichung 13 des
// Plans); Wärmelieferung nicht (§ 7 Abs. 3), Wärmepumpe und Strom nicht.
export const OIL_OR_GAS: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg']

// `above70Agreed` (Heizung PR 14): mehr als 70 % nach Verbrauch sind mit den Mietern vereinbart (§ 10).
export type ShareRow = { period: string; heatConsumptionPct: number | null; waterConsumptionPct: number | null; insulationRule: InsulationRule | null; above70Agreed?: boolean | null }
export type ConsumptionShares = {
  heating: number
  // null: kein eigener Wert für das Warmwasser (§ 8 Abs. 1); bei verbundener oder getrennter
  // Warmwasserbereitung ist das `heating.self-incomplete` (Abweichung 14).
  water: number | null
  forced: boolean
  previous: { heating: number; water: number | null } | null
  own: boolean
  changed: boolean
  // Die Antwort zum Wärmeschutz (§ 7 Abs. 1 Satz 2), aus der eigenen Zeile oder der letzten davor.
  insulation: InsulationRule | null
  // Heizung PR 14: Mehr als 70 % sind vereinbart (§ 10); die Vereinbarung gehört zum Anteil und wird mit ihm
  // geerbt.
  above70Agreed: boolean
}

// Der Anteil nach Verbrauch gehört zur **Linie** einer Anlage (Durchsicht von #239, I3): Beim
// Kesseltausch übernimmt die neue Anlage den Anteil der alten, denn § 6 Abs. 4 HeizkostenV lässt ihn
// nur für künftige Abrechnungszeiträume ändern, und ein Tausch ist kein neuer Zeitraum. Die Zeilen der
// Linie werden je Heizperiode zusammengelegt; die eigene Zeile geht vor, eine ohne Anteil tritt hinter
// eine mit Anteil zurück.
type LinePlant = { id: string; replacesPlantId?: string | null }
export type PlantShareRow = ShareRow & { plantId: string }
export function lineShareRows(rows: readonly PlantShareRow[], plants: readonly LinePlant[], plantId: string): ShareRow[] {
  const plant = plants.find((p) => p.id === plantId)
  const root = plant ? lineRoot(plant, plants) : plantId
  const inLine = new Set(plants.filter((p) => lineRoot(p, plants) === root).map((p) => p.id))
  const ordered = [...rows.filter((r) => r.plantId === plantId), ...rows.filter((r) => r.plantId !== plantId && inLine.has(r.plantId))]
  const byPeriod = new Map<string, ShareRow>()
  for (const r of ordered) {
    const cur = byPeriod.get(r.period)
    const row: ShareRow = { period: r.period, heatConsumptionPct: r.heatConsumptionPct, waterConsumptionPct: r.waterConsumptionPct, insulationRule: r.insulationRule, above70Agreed: r.above70Agreed ?? null }
    if (!cur || (cur.heatConsumptionPct === null && r.heatConsumptionPct !== null)) byPeriod.set(r.period, row)
  }
  return [...byPeriod.values()]
}


// Der Anteil nach Verbrauch einer Heizperiode, in Prozent. **Vorgabe ist der Anteil der vorigen
// Heizperiode** (§ 6 Abs. 4: der Gebäudeeigentümer wählt, ändern nur für künftige Zeiträume durch
// Erklärung); die eigene Zeile gilt, wenn sie einen Wert hat. Ohne beides `null` (Abweichung 14). Das
// Warmwasser hat seinen eigenen Wert aus der eigenen Zeile oder der Vorperiode und bekommt nie still den
// der Heizung (§ 8 Abs. 1 verlangt eine eigene Wahl); fehlt er, ist `water` null. Bei Öl und Gas
// mit `insulationRule = 'applies'` zwingend `forced()` für die Heizung (§ 7 Abs. 1 Satz 2); das
// Warmwasser regelt § 8 und bleibt, wie es ist.
export function consumptionSharesOf(rows: readonly ShareRow[], key: string, energy: HeatingEnergy, forced: () => number): ConsumptionShares | null {
  const own = rows.find((r) => r.period === key)
  const earlier = rows.filter((r) => r.period < key).slice().sort((a, b) => (a.period < b.period ? 1 : -1))
  const prevShare = earlier.find((r) => r.heatConsumptionPct !== null)
  const previous = prevShare && prevShare.heatConsumptionPct !== null
    ? { heating: prevShare.heatConsumptionPct, water: prevShare.waterConsumptionPct }
    : null
  const ownHeat = own?.heatConsumptionPct ?? null
  const heat = ownHeat ?? previous?.heating ?? null
  if (heat === null) return null
  const water = ownHeat !== null ? (own?.waterConsumptionPct ?? null) : (previous?.water ?? null)
  const insulation = own?.insulationRule ?? earlier.find((r) => r.insulationRule !== null)?.insulationRule ?? null
  const isForced = insulation === 'applies' && OIL_OR_GAS.includes(energy)
  // § 10 (Heizung PR 14): Die Vereinbarung über mehr als 70 % gehört zum Anteil und wird mit ihm geerbt. Beim
  // Pflichtanteil des § 7 Abs. 1 Satz 2 bleibt ein vereinbarter höherer Anteil (§ 10 nennt § 7 Abs. 1 als
  // Ganzes; Auslegung von Mietfuchs), nie ein niedrigerer.
  const agreed = ownHeat !== null ? own?.above70Agreed === true : prevShare?.above70Agreed === true
  const pflicht = isForced ? forced() : null
  return {
    heating: pflicht !== null && !(agreed && heat > pflicht) ? pflicht : heat,
    water,
    forced: isForced,
    previous,
    own: ownHeat !== null,
    changed: ownHeat !== null && previous !== null && (ownHeat !== previous.heating || water !== previous.water),
    insulation,
    above70Agreed: agreed,
  }
}

// ---------- Wärmepumpen (§ 12 Abs. 3 HeizkostenV, Entwurf 4.3, 4.7) ----------

export type HeatPumpVerdict = { kind: 'applies' } | { kind: 'notYet'; captureInstalledOn: string | null } | { kind: 'missing' }

// Gilt die Verordnung im Zeitraum, der am `hFrom` beginnt? `null` bei einer anderen Energie.
// - Am 01.10.2024 schon erfasst: ja.
// - Nach dem 01.10.2024 eingebaut: ja, Abs. 3 betrifft nur Wärmepumpen, deren Verbrauch an diesem Tag
//   „noch nicht erfasst“ wird (F5, Abweichung 1).
// - Am 01.10.2024 nicht erfasst und die Erfassung später eingebaut: ab dem Zeitraum, der danach
//   beginnt (Satz 2).
// - Ohne Erfassung: bis zur Frist noch nicht; danach ist die Pflicht aus Satz 1 verletzt, und Mietfuchs
//   rechnet mit 15 % nach § 12 Abs. 1 Satz 1, als Auslegung (15.1 Nr. 22).
// - Unbekannt: nach der Verordnung; die Einrichtung fragt (Schritt 6).
export function heatPumpVerdict(
  plant: { energy: HeatingEnergy; capturedOnOct2024: boolean | null; captureInstalledOn: string | null; heatPumpInstalledOn: string | null },
  hFrom: string,
  rule: HeatPumpCapture,
): HeatPumpVerdict | null {
  if (plant.energy !== 'heatPump') return null
  if (plant.capturedOnOct2024 === true) return { kind: 'applies' }
  if (plant.heatPumpInstalledOn !== null && plant.heatPumpInstalledOn > rule.capturedBy) return { kind: 'applies' }
  if (plant.capturedOnOct2024 === false) {
    if (plant.captureInstalledOn !== null) return hFrom > plant.captureInstalledOn ? { kind: 'applies' } : { kind: 'notYet', captureInstalledOn: plant.captureInstalledOn }
    return hFrom > rule.installBy ? { kind: 'missing' } : { kind: 'notYet', captureInstalledOn: null }
  }
  return { kind: 'applies' }
}

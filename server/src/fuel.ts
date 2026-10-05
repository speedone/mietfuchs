// Brennstofflieferungen (Heizung PR 7, #97; Entwurf 3.2, 3.3, 5.4, 8.2): welcher Teil einer
// Versorgerrechnung in eine Heizperiode gehört, was eine Heizperiode deshalb herein- oder hinausbucht,
// wie viel CO₂ sie ausgestoßen hat und welche Lücken bleiben. Reine Funktionen. Die Gradtagstabelle
// reicht der Aufrufer aus dem Register herein (`law()` protokolliert sie); hier steht keine Zahl der
// Tabelle und kein Datum (law-literals.test.ts).
//
// **Die Stufen** (3.2), je Lieferung und Heizperiode die erste zutreffende: 0 eingetragen (nur für den
// verbrauchsabhängigen Teil), 1 gemessen (Versorgungszähler mit Ständen genau an den Grenzen), 2
// Zwischenrechnung (ganz drin oder ganz draußen), 3 Teilmengen laut Rechnung (jede für sich nach 1, 4
// oder 5), 4 Ortswerte, 5 Gradtagstabelle; 6, die Schätzung mit Vorbehalt, ist eine eigene Lieferung.
// Tagesgenau gibt es für den Verbrauch nicht, es verschöbe Winterverbrauch. **Feste
// Preisbestandteile** hängen an der Zeit und gehen immer nach Tagen (R1; § 12 Abs. 2 GasGVV betrifft
// nur die verbrauchsabhängigen Preise). CO₂ hängt nur an der Menge.
//
// **Überträge** (8.2): Die Positionen einer Lieferung stehen in der Heizperiode, die das Ende der
// Rechnung enthält. Sie bucht den Teil jeder anderen Heizperiode hinaus, die andere bucht ihn herein.
// Ist die andere abgeschlossen, gilt, was sie eingefroren hat; hat sie stattdessen eine Schätzung
// eingefroren, steht die Differenz beim Vermieter; hat sie nichts, trägt er den ganzen Teil.
import type { DegreeDayTable } from '../../shared/law/heizkostenv.ts'
import { dayAfter, dayBefore } from '../../shared/law/register.ts'
import { degreeDayPermille, unionOf, type DayRange } from '../../shared/degreeDays.ts'
import { formatDayRange, parsePeriodKey, periodContaining, periodOfKey, periodsBetween } from '../../shared/period.ts'
import type { BillingPeriod, FuelDelivery, FuelDeliveryLine, FuelGap, FuelMethod, HeatingEnergy, HeatingMethod, PeriodRules } from '../../shared/types.ts'

// Lieferungen mit Vorrat brauchen die Bestandsrechnung (PR 8); mit Rechnungszeitraum abgegrenzt werden
// Gas, Fernwärme und Strom.
export const STOCK_ENERGIES: readonly HeatingEnergy[] = ['oil', 'lpg', 'pellets', 'wood', 'coal']
export const METERED_ENERGIES: readonly HeatingEnergy[] = ['gas', 'districtHeating', 'heatPump', 'electric']

export type FuelReading = { date: string; value: number; replacement?: boolean; oldEndValue?: number | null }
export type ShareContext = { table: DegreeDayTable; local: ReadonlyMap<string, number>; readings: readonly FuelReading[] | null }
export type FuelDeliveryInput = Pick<
  FuelDelivery,
  'id' | 'label' | 'invoiceFrom' | 'invoiceTo' | 'deliveredAt' | 'amountCents' | 'fixedCents' | 'sharePermille' | 'emissionsKg' | 'co2CostCents' | 'estimated' | 'usedByService' | 'parts'
>

const MS_DAY = 86400000
const toUTC = (iso: string): number => Date.parse(`${iso}T00:00:00Z`)
const isoOf = (t: number): string => new Date(t).toISOString().slice(0, 10)
const daysOf = (r: DayRange): number => (r.from > r.to ? 0 : Math.round((toUTC(r.to) - toUTC(r.from)) / MS_DAY) + 1)
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()
const intersect = (a: DayRange, b: DayRange): DayRange | null => {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from <= to ? { from, to } : null
}
// Kaufmännisch, auch für negative Beträge (eine Gutschrift ist das Spiegelbild der Rechnung).
const roundHalf = (x: number): number => (Math.sign(x) * Math.round(Math.abs(x))) || 0
const isRange = (r: DayRange | null): r is DayRange => r !== null
// Die Tage von `r`, die keine der (vereinigten, aufsteigenden) Spannen abdeckt.
function subtractRanges(r: DayRange, union: readonly DayRange[]): DayRange[] {
  const out: DayRange[] = []
  let cursor = r.from
  for (const u of union) {
    if (u.to < cursor || u.from > r.to) continue
    if (u.from > cursor) out.push({ from: cursor, to: dayBefore(u.from) })
    if (u.to >= cursor) cursor = dayAfter(u.to)
  }
  if (cursor <= r.to) out.push({ from: cursor, to: r.to })
  return out
}

// Der Zeitraum einer Lieferung: der Rechnungszeitraum, sonst der Tag der Lieferung.
export function rangeOf(d: Pick<FuelDelivery, 'invoiceFrom' | 'invoiceTo' | 'deliveredAt'>): DayRange | null {
  if (d.invoiceFrom && d.invoiceTo) return { from: d.invoiceFrom, to: d.invoiceTo }
  return d.deliveredAt ? { from: d.deliveredAt, to: d.deliveredAt } : null
}

// Die Gradtagzahlen des Orts über eine Spanne (Stufe 4): je Tag der Monatswert ÷ Tage des Monats, wie
// bei der Tabelle (3.5). `null`, wenn ein Monat fehlt; dann gilt die Tabelle.
export function localDegreeDaySum(range: DayRange, values: ReadonlyMap<string, number>): number | null {
  if (values.size === 0) return null
  let sum = 0
  for (let t = toUTC(range.from); t <= toUTC(range.to); t += MS_DAY) {
    const iso = isoOf(t)
    const v = values.get(iso.slice(0, 7))
    if (v === undefined) return null
    sum += v / daysInMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)))
  }
  return sum
}

// Die Menge am Versorgungszähler zwischen dem Ende des Tages vor `from` und dem Ende von `to` (Stufe 1).
// Nur mit Ablesungen genau an diesen beiden Tagen; je Tag gilt die letzte. Ein Zählerwechsel zählt mit
// seinem Endstand; ohne Endstand ist die Menge unbekannt, und erfunden wird nichts (wie #83).
export function meterQuantity(readings: readonly FuelReading[], range: DayRange): number | null {
  const start = dayBefore(range.from)
  const sorted = readings.map((r, i) => ({ r, i })).sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i)).map((x) => x.r)
  const lastOn = (date: string): FuelReading | undefined => sorted.filter((r) => r.date === date).at(-1)
  let prev = lastOn(start)
  if (!prev || !lastOn(range.to)) return null
  let sum = 0
  for (const r of sorted) {
    if (r.date <= start || r.date > range.to) continue
    if (r.replacement) {
      if (r.oldEndValue == null) return null
      sum += r.oldEndValue - prev.value
    } else {
      sum += r.value - prev.value
    }
    prev = r
  }
  return sum
}

export type VariableShare = { share: number; method: FuelMethod }

// Der verbrauchsabhängige Anteil eines Abschnitts an einer Heizperiode, Stufen 1, 2, 4 und 5.
export function variableShare(seg: DayRange, h: DayRange, ctx: ShareContext): VariableShare {
  const cut = intersect(seg, h)
  if (!cut) return { share: 0, method: 'inside' }
  if (cut.from === seg.from && cut.to === seg.to) return { share: 1, method: 'inside' }
  if (ctx.readings) {
    const all = meterQuantity(ctx.readings, seg)
    const part = meterQuantity(ctx.readings, cut)
    if (all !== null && part !== null && all > 0) return { share: part / all, method: 'measured' }
  }
  const localAll = localDegreeDaySum(seg, ctx.local)
  const localPart = localDegreeDaySum(cut, ctx.local)
  if (localAll !== null && localPart !== null && localAll > 0) return { share: localPart / localAll, method: 'localDegreeDays' }
  const all = degreeDayPermille([seg], ctx.table)
  return { share: all > 0 ? degreeDayPermille([cut], ctx.table) / all : daysOf(cut) / daysOf(seg), method: 'degreeDays' }
}

// Der Anteil nach Tagen, für feste Preisbestandteile (R1).
export function dayShare(seg: DayRange, h: DayRange): number {
  const cut = intersect(seg, h)
  return cut ? daysOf(cut) / daysOf(seg) : 0
}

// `ratio`: Anteil des Betrags an der Heizperiode, feste Teile nach Tagen; `kgShare`: Anteil von Menge,
// Ausstoß und CO₂-Kosten. `split`: Die Lieferung ist auf mehrere Heizperioden verteilt.
export type DeliveryShare = { ratio: number; kgShare: number; method: FuelMethod; fixedKnown: boolean; split: boolean }

// Der Teil einer Lieferung an einer Heizperiode. `entered`: der eingetragene Anteil des
// verbrauchsabhängigen Teils für diese Heizperiode in Promille (Stufe 0), oder `null`.
export function deliveryShare(d: FuelDeliveryInput, totalCents: number, h: DayRange, ctx: ShareContext, entered: number | null): DeliveryShare {
  const range = rangeOf(d)
  if (!range) return { ratio: 0, kgShare: 0, method: 'inside', fixedKnown: true, split: false }
  const money = (fixed: number, variable: number, ds: number, vs: number, total: number): number => (total !== 0 ? (fixed * ds + variable * vs) / total : vs)
  if (entered !== null) {
    const fixed = d.fixedCents ?? 0
    const v = entered / 1000
    return { ratio: money(fixed, totalCents - fixed, dayShare(range, h), v, totalCents), kgShare: v, method: 'entered', fixedKnown: d.fixedCents !== null, split: v > 0 && v < 1 }
  }
  if (d.parts.length > 0) {
    let moneyIn = 0, amounts = 0, kgIn = 0, kgAll = 0, varIn = 0, varAll = 0
    let split = false
    for (const p of d.parts) {
      const seg = { from: p.from, to: p.to }
      const vs = variableShare(seg, h, ctx)
      const fixed = p.fixedCents ?? 0
      moneyIn += fixed * dayShare(seg, h) + (p.amountCents - fixed) * vs.share
      amounts += p.amountCents
      varIn += (p.amountCents - fixed) * vs.share
      varAll += p.amountCents - fixed
      if (p.emissionsKg !== null) {
        kgIn += p.emissionsKg * vs.share
        kgAll += p.emissionsKg
      }
      if (vs.share > 0 && vs.share < 1) split = true
    }
    const ratio = amounts !== 0 ? moneyIn / amounts : 0
    const kgShare = kgAll > 0 ? kgIn / kgAll : varAll !== 0 ? varIn / varAll : ratio
    return { ratio, kgShare, method: 'parts', fixedKnown: d.parts.every((p) => p.fixedCents !== null), split }
  }
  const vs = variableShare(range, h, ctx)
  const fixed = d.fixedCents ?? 0
  return { ratio: money(fixed, totalCents - fixed, dayShare(range, h), vs.share, totalCents), kgShare: vs.share, method: vs.method, fixedKnown: d.fixedCents !== null, split: vs.share > 0 && vs.share < 1 }
}

// Abdeckung einer Heizperiode durch Rechnungen in Promille ihrer Gradtage, und die Lücken (3.3).
export function coverageOf(h: DayRange, ranges: readonly DayRange[], table: DegreeDayTable): { permille: number; gaps: DayRange[] } {
  const inside = unionOf(ranges.map((r) => intersect(r, h)).filter(isRange))
  const gaps: DayRange[] = []
  let cursor = h.from
  for (const r of inside) {
    if (r.from > cursor) gaps.push({ from: cursor, to: dayBefore(r.from) })
    if (r.to >= cursor) cursor = dayAfter(r.to)
  }
  if (cursor <= h.to) gaps.push({ from: cursor, to: h.to })
  const all = degreeDayPermille([h], table)
  return { permille: all > 0 ? (degreeDayPermille(inside, table) / all) * 1000 : 0, gaps }
}

export type FuelItem = { id: string; period: string; amountCents: number; fuelDeliveryId?: string | null }
export type FuelFrozen = { deliveryId: string; period: string; cents: number; emissionsKg: number; co2Cents: number }
export type FuelPlantInput = {
  method: HeatingMethod
  h: BillingPeriod
  rules: PeriodRules
  deliveries: readonly FuelDeliveryInput[]
  items: readonly FuelItem[]
  frozen: readonly FuelFrozen[]
  closed: ReadonlySet<string>
  ctx: ShareContext
  // Die Heizpositionen der Anlage in dieser Heizperiode ohne Lieferung, mit ihrem Leistungszeitraum
  // (Durchsicht I4). Fehlt die Angabe, gibt es keine.
  loose?: readonly { from: string | null; to: string | null }[]
  // Was abgeschlossene Heizperioden je Lieferung in andere übertragen haben (`period` die abgeschlossene).
  closedCarries?: readonly { period: string; deliveryId: string; other: string; cents: number; totalCents?: number }[]
}

// Ein Übertrag der Mieterseite dieser Heizperiode: `out` hinaus in die frühere (die Positionen stehen
// hier), `in` herein aus der Heizperiode der Positionen, `estimate` eine geschätzte Lieferung dieser
// Heizperiode. `landlord` ist die Gegenzeile beim Vermieter (Summe = −cents). `templates` verteilt den
// Übertrag auf die Positionen, deren Schlüssel er folgt.
export type FuelCarry = {
  deliveryId: string
  kind: 'out' | 'in' | 'estimate'
  other: BillingPeriod
  cents: number
  totalCents: number
  ratio: number
  method: FuelMethod
  frozen: boolean
  // Die andere Heizperiode hat 0 eingefroren, weil die Lieferung beim Abschluss noch keine Position hatte.
  zeroFrozen: boolean
  // Storniert (Summe der Positionen 0): was die abgeschlossene Heizperiode `other` hereingebucht hatte.
  cancelled?: number
  // Beim Gegenstück: der Teil, den die abgeschlossene Heizperiode der Positionen hierher hinausgebucht hat.
  cancelledOut?: number
  landlord: { reason: 'fuelCarry' | 'fuelClosedPeriod' | 'fuelEstimateDiff'; cents: number }[]
  templates: { itemId: string; raw: number }[]
  estimate: { cents: number; ids: string[] } | null
}

export type FuelResult = {
  lines: FuelDeliveryLine[]
  carries: FuelCarry[]
  coveragePermille: number
  gaps: FuelGap[]
  emissionsKg: number | null
  co2Cents: number | null
  serviceCo2Cents: number | null
  serviceGrossCents: number | null
  missingCo2: string[]
  // Eine Heizposition ohne Lieferung und ohne Leistungszeitraum steht neben einer Lücke (Durchsicht I4).
  looseWithoutRange: boolean
  // Lieferungen, deren Heizperiode der Positionen abgeschlossen ist, ohne hierher etwas hinausgebucht zu
  // haben, obwohl heute `cents` hierher gehörten.
  ownerClosedUnlinked: { deliveryId: string; owner: BillingPeriod; cents: number }[]
}

// Die Lieferungen einer Anlage in einer Heizperiode. `null`, wenn keine die Heizperiode berührt und
// nichts übertragen wird: Dann gibt es nichts zu bewerten und keine Lücke zu melden.
export function plantFuel(input: FuelPlantInput): FuelResult | null {
  const { h, rules, ctx } = input
  const withItems = input.method === 'manual'
  const ranged = input.deliveries.filter((d) => rangeOf(d) !== null)
  const itemsOf = (id: string): FuelItem[] => input.items.filter((c) => c.fuelDeliveryId === id)
  // Storniert (Nachprüfung von 47f2373, M2/G1): Bei freien Schlüsseln ergeben die Positionen einer
  // Rechnung 0. Sie verdrängt keine Schätzung, deckt keine Tage ab und zählt nicht in der Bewertung; ihre
  // Überträge bleiben, damit eine abgeschlossene Heizperiode ihre Gegenbuchung bekommt.
  const cancelled = (d: FuelDeliveryInput): boolean =>
    withItems && !d.estimated && itemsOf(d.id).length > 0 && itemsOf(d.id).reduce((a, c) => a + c.amountCents, 0) === 0
  const real = ranged.filter((d) => !d.estimated && !cancelled(d))
  const realUnion = unionOf(real.map(rangeOf).filter(isRange))
  // Eine Schätzung zählt nur für die Tage, die keine echte Rechnung abdeckt (8.2, Wiederöffnen;
  // Durchsicht von #233, I3): ganz abgedeckt gar nicht, teilweise im Verhältnis der Gradtage der
  // übrigen Tage, dieselbe Regel wie `estimatesIn` unten.
  const estimateFactor = new Map<string, number>()
  for (const d of ranged.filter((x) => x.estimated)) {
    const r = rangeOf(d)
    if (!r) continue
    const rest = subtractRanges(r, realUnion)
    const all = degreeDayPermille([r], ctx.table)
    estimateFactor.set(d.id, all > 0 ? degreeDayPermille(rest, ctx.table) / all : rest.reduce((a, x) => a + daysOf(x), 0) / daysOf(r))
  }
  const effective = ranged.filter((d) => !d.estimated || (estimateFactor.get(d.id) ?? 0) > 0)
  const counted = effective.filter((d) => !cancelled(d))
  const totalOf = (d: FuelDeliveryInput): number =>
    d.estimated
      ? roundHalf((d.amountCents ?? 0) * (estimateFactor.get(d.id) ?? 1))
      : !withItems ? (d.amountCents ?? 0) : itemsOf(d.id).reduce((a, c) => a + c.amountCents, 0)
  // Ein eingefrorener Wert gilt nur für eine abgeschlossene Heizperiode (Abweichung 7).
  const frozenOf = (id: string, key: string): FuelFrozen | null =>
    input.closed.has(key) ? (input.frozen.find((f) => f.deliveryId === id && f.period === key) ?? null) : null
  const rangeFor = (d: FuelDeliveryInput): DayRange => rangeOf(d) ?? { from: h.from, to: h.from }
  const share = (d: FuelDeliveryInput, target: BillingPeriod): DeliveryShare => {
    const r = rangeFor(d)
    const touched = periodsBetween(rules, r.from, r.to)
    const end = periodContaining(rules, r.to)
    const entered = d.sharePermille !== null && touched.length === 2 ? (target.key === end.key ? d.sharePermille : 1000 - d.sharePermille) : null
    return deliveryShare(d, totalOf(d), target, ctx, entered)
  }
  const touchesH = (d: FuelDeliveryInput): boolean => intersect(rangeFor(d), h) !== null
  const labelOf = (d: FuelDeliveryInput): string => d.label || formatDayRange(rangeFor(d).from, rangeFor(d).to)

  // Bewertung: je Lieferung, die die Heizperiode berührt, Anteil, Ausstoß und CO₂-Kosten.
  const lines: FuelDeliveryLine[] = []
  let kg = 0
  let kgKnown = false
  let co2 = 0
  let co2Known = false
  const missingCo2: string[] = []
  for (const d of counted.filter(touchesH)) {
    const s = share(d, h)
    const f = frozenOf(d.id, h.key)
    // Bei einer teilweise abgedeckten Schätzung nur der Teil der übrigen Tage (Durchsicht I3).
    const part = d.estimated ? (estimateFactor.get(d.id) ?? 1) : 1
    const e = f ? f.emissionsKg : d.emissionsKg === null ? null : d.emissionsKg * s.kgShare * part
    const c = f ? f.co2Cents : d.co2CostCents === null ? null : d.co2CostCents * s.kgShare * part
    if (e !== null) {
      kg += e
      kgKnown = true
    }
    if (c !== null) {
      co2 += c
      co2Known = true
    }
    if (e === null || c === null) missingCo2.push(labelOf(d))
    const total = totalOf(d)
    const r = rangeFor(d)
    lines.push({
      deliveryId: d.id, label: d.label, from: r.from, to: r.to, estimated: d.estimated, method: s.method, sharePermille: s.kgShare * 1000,
      fixedKnown: s.fixedKnown, split: s.split, amountCents: total, inPeriodCents: withItems || d.estimated ? roundHalf(total * s.ratio) : null,
      emissionsKg: e, co2Cents: c === null ? null : roundHalf(c),
    })
  }
  const coverage = coverageOf(h, counted.map(rangeOf).filter(isRange), ctx.table)
  const emissionsKg = kgKnown ? (coverage.permille > 0 ? (kg * 1000) / coverage.permille : kg) : null
  // Lücken (Durchsicht I4): Eine Heizposition der Anlage in dieser Heizperiode ohne Lieferung deckt mit
  // ihrem Leistungszeitraum ebenfalls ab; ohne Leistungszeitraum weiß Mietfuchs nicht, welche Tage sie
  // bezahlt, und schlägt keine Schätzung vor, sonst stünde dieselbe Rechnung zweimal da.
  const loose = input.loose ?? []
  const looseRanges = loose.flatMap((l) => (l.from && l.to ? [{ from: l.from, to: l.to }] : []))
  const looseWithoutRange = loose.some((l) => !l.from || !l.to)
  const billCoverage = looseRanges.length > 0 ? coverageOf(h, [...counted.map(rangeOf).filter(isRange), ...looseRanges], ctx.table) : coverage

  // Messdienst (7.6, G-A3): C sind die CO₂-Kosten der Rechnungen, die er angesetzt hat, ganz; gezählt
  // in der Heizperiode, in der die Rechnung endet.
  const owned = real.filter((d) => d.usedByService && periodContaining(rules, rangeFor(d).to).key === h.key)
  const serviceCo2Cents = input.method === 'service' && owned.length > 0 && owned.every((d) => d.co2CostCents !== null)
    ? owned.reduce((a, d) => a + (d.co2CostCents ?? 0), 0)
    : null
  const serviceGrossCents = input.method === 'service' && owned.length > 0 && owned.every((d) => d.amountCents !== null)
    ? owned.reduce((a, d) => a + (d.amountCents ?? 0), 0)
    : null

  // Die Rechnung, aus der eine Schätzung verteilt wird oder die eine Lücke schätzt: die letzte echte
  // mit Positionen, die vorher endet, sonst die letzte überhaupt. Eine Regel für beides.
  const templateFor = (from: string): FuelDeliveryInput | null => {
    const candidates = real.filter((d) => itemsOf(d.id).length > 0 && totalOf(d) !== 0).sort((a, b) => (rangeFor(a).to < rangeFor(b).to ? -1 : 1))
    return candidates.filter((d) => rangeFor(d).to < from).at(-1) ?? candidates.at(-1) ?? null
  }

  // Überträge (8.2), nur bei freien Schlüsseln: Dort sind die Rechnungen Positionen.
  const carries: FuelCarry[] = []
  const ownerClosedUnlinked: FuelResult['ownerClosedUnlinked'] = []
  if (withItems) {
    // Die Schätzungen einer abgeschlossenen Heizperiode, die eine echte Rechnung ersetzt, mit ihrem
    // eingefrorenen Betrag im Verhältnis der Gradtage, die die Rechnung von ihnen abdeckt.
    const estimatesIn = (other: BillingPeriod, r: DayRange): { cents: number; ids: string[] } => {
      let cents = 0
      const ids: string[] = []
      for (const e of input.deliveries.filter((x) => x.estimated)) {
        const er = rangeOf(e)
        const f = frozenOf(e.id, other.key)
        if (!er || !f || er.from < other.from || er.to > other.to) continue
        const cut = intersect(er, r)
        if (!cut) continue
        const all = degreeDayPermille([er], ctx.table)
        cents += f.cents * (all > 0 ? degreeDayPermille([cut], ctx.table) / all : daysOf(cut) / daysOf(er))
        ids.push(e.id)
      }
      return { cents: roundHalf(cents), ids }
    }
    for (const d of effective) {
      const r = rangeFor(d)
      if (d.estimated) {
        if (!touchesH(d)) continue
        const template = templateFor(r.from)
        if (!template) continue
        const f = frozenOf(d.id, h.key)
        const cents = f ? f.cents : totalOf(d)
        const T = totalOf(template)
        if (cents === 0) continue
        carries.push({
          deliveryId: d.id, kind: 'estimate', other: h, cents, totalCents: d.amountCents ?? 0, ratio: 1, method: 'inside', frozen: f !== null, zeroFrozen: false,
          landlord: [{ reason: 'fuelCarry', cents: -cents }],
          templates: itemsOf(template.id).map((c) => ({ itemId: c.id, raw: (cents * c.amountCents) / T })),
          estimate: null,
        })
        continue
      }
      const items = itemsOf(d.id)
      const T = totalOf(d)
      if (items.length === 0) continue
      // Die Heizperiode der Positionen; die Schreibprüfung hält sie bei der, die das Ende enthält.
      const ownerKey = parsePeriodKey(items[0]?.period)
      const owner = (ownerKey && periodOfKey(rules, ownerKey)) ?? periodContaining(rules, r.to)
      const touched = periodsBetween(rules, r.from, r.to)
      if (T === 0) {
        // Storniert oder auf 0 € gesetzt (Nachprüfung von #233, W1): Hat eine abgeschlossene Heizperiode
        // schon einen Teil hereingebucht, haben ihre Mieter ihn zu viel getragen. Verteilt wird hier
        // nichts mehr (die Positionen ergeben 0); beim Vermieter stehen die Gegenbuchung und, mit
        // umgekehrtem Vorzeichen, der Teil der abgeschlossenen Heizperiode, den er den Mietern schuldet.
        if (owner.key !== h.key) {
          // Gegenstück: Die Heizperiode der Positionen ist abgeschlossen und hat einen Teil hierher
          // hinausgebucht. Hier wird nichts verteilt; die Gegenbuchung steht ausgewiesen beim Vermieter.
          const frozenOut = touchesH(d) && input.closed.has(owner.key) && input.closedCarries !== undefined
            ? input.closedCarries.find((c) => c.period === owner.key && c.deliveryId === d.id && c.other === h.key)
            : undefined
          const out = frozenOut?.cents ?? 0
          if (out !== 0) {
            // `cancelled`: was die Mieter jener Heizperiode von der Rechnung getragen haben (Summe beim Abschluss
            // ohne den hinausgebuchten Teil); fehlt die Summe im eingefrorenen Stand, der hinausgebuchte Teil.
            carries.push({
              deliveryId: d.id, kind: 'in', other: owner, cents: 0, totalCents: 0, ratio: 0, method: 'inside', frozen: true, zeroFrozen: false,
              cancelled: frozenOut?.totalCents !== undefined ? frozenOut.totalCents + out : -out, cancelledOut: -out,
              landlord: [{ reason: 'fuelCarry', cents: out }, { reason: 'fuelClosedPeriod', cents: -out }], templates: [], estimate: null,
            })
          }
          continue
        }
        for (const other of touched) {
          if (other.key === h.key) continue
          const f = frozenOf(d.id, other.key)
          if (!f || f.cents === 0) {
            // Mit Schätzung abgeschlossen (Nachprüfung von 47f2373, M2): Die Mieter jener Heizperiode haben
            // die Schätzung getragen; die Abweichung ist die ganze Schätzung, wie X − Schätzung bei X = 0.
            const est = f ? { cents: 0, ids: [] } : input.closed.has(other.key) ? estimatesIn(other, r) : { cents: 0, ids: [] }
            if (est.cents === 0) continue
            carries.push({
              deliveryId: d.id, kind: 'out', other, cents: 0, totalCents: 0, ratio: 0, method: 'inside', frozen: true, zeroFrozen: false, cancelled: est.cents,
              landlord: [{ reason: 'fuelCarry', cents: est.cents }, { reason: 'fuelEstimateDiff', cents: -est.cents }], templates: [], estimate: est,
            })
            continue
          }
          carries.push({
            deliveryId: d.id, kind: 'out', other, cents: 0, totalCents: 0, ratio: 0, method: 'inside', frozen: true, zeroFrozen: false, cancelled: f.cents,
            landlord: [{ reason: 'fuelCarry', cents: f.cents }, { reason: 'fuelClosedPeriod', cents: -f.cents }], templates: [], estimate: null,
          })
        }
        continue
      }
      if (owner.key === h.key) {
        for (const other of touched) {
          if (other.key === h.key) continue
          const s = share(d, other)
          const found = frozenOf(d.id, other.key)
          const calc = roundHalf(T * s.ratio)
          // Hat die andere Heizperiode 0 eingefroren, obwohl ihr Teil heute nicht 0 ist, hatte die
          // Lieferung beim Abschluss noch keine Position (Durchsicht von #233, I1). Dann hat diese
          // Heizperiode nichts hereingebucht; ihr Teil geht an den Vermieter wie im Fall c.
          const f = found !== null && found.cents === 0 && calc !== 0 ? null : found
          const X = f ? f.cents : calc
          if (X === 0) continue
          let landlord: FuelCarry['landlord'] = [{ reason: 'fuelCarry', cents: X }]
          let estimate: FuelCarry['estimate'] = null
          if (!f && input.closed.has(other.key)) {
            const est = estimatesIn(other, r)
            if (est.ids.length > 0) {
              estimate = est
              landlord = [{ reason: 'fuelCarry', cents: est.cents }, ...(X - est.cents !== 0 ? [{ reason: 'fuelEstimateDiff' as const, cents: X - est.cents }] : [])]
            } else {
              landlord = [{ reason: 'fuelClosedPeriod', cents: X }]
            }
          }
          carries.push({
            deliveryId: d.id, kind: 'out', other, cents: -X, totalCents: T, ratio: s.ratio, method: s.method, frozen: f !== null, zeroFrozen: found !== null && f === null, landlord,
            templates: items.map((c) => ({ itemId: c.id, raw: (-X * c.amountCents) / T })), estimate,
          })
        }
      } else if (touchesH(d)) {
        const s = share(d, h)
        const f = frozenOf(d.id, h.key)
        const ownerFrozen = frozenOf(d.id, owner.key)
        // Ist die Heizperiode der Positionen abgeschlossen, nimmt diese genau, was jene hierher
        // hinausgebucht hat, auch bei drei Heizperioden und wenn sich die Positionen danach geändert
        // haben (Nachprüfung der Durchsicht von #233); nichts, wenn sie nichts hinausgebucht hat.
        const ownerOut = input.closed.has(owner.key) && input.closedCarries !== undefined
          ? (input.closedCarries.find((c) => c.period === owner.key && c.deliveryId === d.id && c.other === h.key)?.cents ?? 0)
          : null
        const Y = f ? f.cents : ownerOut !== null ? -ownerOut : ownerFrozen && touched.length === 2 ? -ownerFrozen.cents : roundHalf(T * s.ratio)
        // Die Heizperiode der Positionen ist abgeschlossen und hat nichts hierher hinausgebucht, obwohl
        // heute ein Teil hierher gehörte: Die Position war beim Abschluss noch nicht verknüpft. Dort ist
        // die Rechnung ganz verteilt; hier kommt nichts dazu, aber ein Hinweis (Nachprüfung von #233).
        if (!f && ownerOut === 0) {
          const calc = roundHalf(T * s.ratio)
          if (calc !== 0) ownerClosedUnlinked.push({ deliveryId: d.id, owner, cents: calc })
        }
        if (Y === 0) continue
        carries.push({
          deliveryId: d.id, kind: 'in', other: owner, cents: Y, totalCents: T, ratio: s.ratio, method: s.method, frozen: f !== null || ownerFrozen !== null, zeroFrozen: false,
          landlord: [{ reason: 'fuelCarry', cents: -Y }],
          templates: items.map((c) => ({ itemId: c.id, raw: (Y * c.amountCents) / T })), estimate: null,
        })
      }
    }
  }

  // Eine stornierte Rechnung, die die Heizperiode berührt, lässt die Lücke sichtbar (Nachprüfung, G1).
  if (lines.length === 0 && carries.length === 0 && !effective.some(touchesH)) return null

  // Lücken (3.3) und, bei freien Schlüsseln, der Vorschlag einer Schätzung aus der letzten Rechnung
  // (8.2 Nr. 2): verbrauchsabhängiger Teil nach dem eigenen Zählerstand, sonst nach Gradtagen; fester
  // Teil nach Tagen; kg und CO₂-Kosten im Verhältnis des verbrauchsabhängigen Teils.
  const gaps: FuelGap[] = billCoverage.gaps.map((g) => {
    const permille = degreeDayPermille([g], ctx.table)
    let estimate: FuelGap['estimate'] = null
    const t = withItems && !looseWithoutRange ? templateFor(g.from) : null
    if (t) {
      const tr = rangeFor(t)
      const T = totalOf(t)
      const fixed = t.fixedCents ?? 0
      const qGap = ctx.readings ? meterQuantity(ctx.readings, g) : null
      const qT = ctx.readings ? meterQuantity(ctx.readings, tr) : null
      const byMeter = qGap !== null && qT !== null && qT > 0
      const tPermille = degreeDayPermille([tr], ctx.table)
      const factor = byMeter ? (qGap ?? 0) / (qT ?? 1) : tPermille > 0 ? permille / tPermille : daysOf(g) / daysOf(tr)
      estimate = {
        from: g.from, to: g.to,
        amountCents: roundHalf((T - fixed) * factor + (fixed * daysOf(g)) / daysOf(tr)),
        emissionsKg: t.emissionsKg === null ? null : Math.round(t.emissionsKg * factor * 10) / 10,
        co2CostCents: t.co2CostCents === null ? null : roundHalf(t.co2CostCents * factor),
        basedOn: labelOf(t), byMeter, factorPermille: Math.round(factor * 100000) / 100,
      }
    }
    return { from: g.from, to: g.to, days: daysOf(g), permille, estimate }
  })

  return {
    lines, carries, coveragePermille: coverage.permille, gaps, emissionsKg,
    co2Cents: co2Known ? roundHalf(co2) : null, serviceCo2Cents, serviceGrossCents, missingCo2,
    looseWithoutRange: looseWithoutRange && gaps.length > 0,
    ownerClosedUnlinked,
  }
}

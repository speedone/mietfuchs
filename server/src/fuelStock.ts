// Brennstoffvorrat (Heizung PR 8, #97, #99; Entwurf 8.2). Reine Funktionen.
//
// Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle wird nicht jede Lieferung im selben Zeitraum
// verbraucht. Umgelegt werden die Kosten „der verbrauchten Brennstoffe und ihrer Lieferung“ (§ 7
// Abs. 2 HeizkostenV, BGH VIII ZR 156/11), und die CO₂-Aufteilung braucht Ausstoß und CO₂-Kosten des
// verbrauchten Brennstoffs. Beides ergibt die Bestandsrechnung: Anfangsbestand + Lieferungen −
// Endbestand. Die Kosten einer Lieferung sind ihr ganzer Rechnungsbetrag samt Lieferkosten.
//
// **Bewertung** — eine Bewertungsregel, denn die HeizkostenV regelt die Bewertung des Restbestands
// nicht: „Bei einem Brennstoffrest am Ende der Abrechnungsperiode ist, wenn im Öltank mehrere
// Liefermengen miteinander vermischt sind, rechnerisch davon auszugehen, dass als erste Menge das älteste
// Öl verbraucht wurde“ (Kinne/Schach/Bieber-Kinne, BGB § 556 Rn. 121, zitiert nach Haufe, FAQ
// Heizölverbuchung, gelesen am 06.10.2026); ebenso [M] Minol, Restbewertung: „Der zuerst gelieferte
// Brennstoff wird als erstes verbraucht“. Der Endbestand besteht also aus den jüngsten Teilen und wird zu deren Preisen, kg und
// CO₂-Kosten bewertet. Jeder Teil wird für sich gerundet, Beträge auf den Cent, kg auf das Hundertstel
// (Abweichung 1 des Plans: Die Zahlen des Entwurfs haben zwei Nachkommastellen). Minol beruft sich auf
// BGH, 23.11.1981, VIII ZR 298/80 (NJW 1982, 573); gelesen am 06.10.2026: Die Entscheidung betrifft die
// Mindestangaben einer Betriebskostenabrechnung und sagt zur Bewertung eines Vorrats nichts. Die Regel
// stützt sich deshalb auf die Kommentarliteratur und die Praxis der Messdienste.
//
// **Die Kette** (Entwurf 8.2 „Der Anfangsbestand ist vorbelegt aus dem bewerteten Endbestand von
// H−1. Ist H−1 abgeschlossen, gilt der eingefrorene Wert.“): Eingetragen wird ein Anfangsbestand nur
// in der ersten Heizperiode mit Vorrat. Jede weitere übernimmt den Endbestand ihrer Vorperiode, und
// zwar ganz, mit seinen Teilen; ist die Vorperiode abgeschlossen, den eingefrorenen.
//
// **Und umgekehrt** (G-A4): Ist die Folgeperiode abgeschlossen und hat sie den Endbestand dieser
// Heizperiode als Anfangsbestand übernommen, gilt hier dieser eingefrorene Wert als Endbestand. Sonst
// änderte sich nach dem Wiederöffnen dieser Heizperiode, was sie an die abgeschlossene weitergibt, und
// der Unterschied wäre zweimal oder gar nicht verteilt.
//
// **Kein Datum, keine Rechtszahl hier** (law-literals.test.ts). Ob die CO₂-Kosten einer Rechnung
// zählen (§ 11 Abs. 2 Satz 2 CO2KostAufG), fragt der Aufrufer das Register und reicht es herein.
import { germanDate } from '../../shared/law/register.ts'
import { STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import type { HeatingStockStatement, PeriodKey, StockLayer, StockUnit, StockValue } from '../../shared/types.ts'
import { compareText } from './calc.ts'

// Eine Lieferung in der Bestandsrechnung. `costCents`: Σ der verknüpften Kostenpositionen, sonst der
// Betrag an der Lieferung, sonst null. `date` ordnet sie der Heizperiode zu (Lieferdatum, Entwurf
// 5.4), `invoiceDate` entscheidet über § 11 Abs. 2 Satz 2.
export type StockDeliveryInput = {
  id: string
  label: string
  date: string
  invoiceDate: string
  quantity: number | null
  quantityUnit: string | null
  costCents: number | null
  emissionsKg: number | null
  co2Cents: number | null
}

// Der eingetragene Anfangsbestand (Spalten `opening_*`). `alreadySettled`: schon mit einer früheren
// Abrechnung umgelegt (nach Lieferung); dann zählt er mit 0 € und ohne CO₂-Kosten, die kg zählen.
export type StockOpeningInput = { quantity: number; costCents: number | null; emissionsKg: number | null; co2Cents: number | null; invoicedBefore2023: boolean | null; alreadySettled?: boolean; settledSource?: 'entered' | 'default' }

// Eine Heizperiode der Kette; snapshot.ts baut sie (`stockChainsOf`).
export type StockPeriodInput = {
  key: PeriodKey
  label: string
  from: string
  to: string
  unit: StockUnit | null
  ownOpening: StockOpeningInput | null
  closingQuantity: number | null
  closingMeasuredOn: string | null
  deliveries: StockDeliveryInput[]
  // Lieferungen der Folgeperiode bis zur Peilung, wenn erst nach dem Ende gepeilt wurde; nur für
  // den Hinweis, gerechnet wird mit ihnen hier nicht.
  laterDeliveries: { label: string; date: string }[]
  // Der eingefrorene Endbestand, wenn diese Heizperiode abgeschlossen ist und ihr Stand ihn kennt.
  frozenClosing: StockValue | null
  // Der eingefrorene Anfangsbestand der abgeschlossenen Folgeperiode, wenn sie ihn von hier übernommen
  // hat. Dann ist er der Endbestand dieser Heizperiode (G-A4). Fehlt das Feld, gibt es keinen.
  nextFrozenOpening?: StockValue | null
  // Gibt es bei freien Schlüsseln eine Position, mit deren Schlüssel die Überträge verteilt werden
  // (`stockTemplateOf`)? Ohne sie bucht die Heizperiode keinen Übertrag, und ihr Endbestand geht mit
  // 0 € weiter (Befund I1). Fehlt das Feld, gibt es eine.
  hasKey?: boolean
  // Die Folgeperiode ist abgeschlossen, ohne einen Anfangsbestand von hier übernommen zu haben (I2).
  nextClosedWithoutStock?: boolean
  // Die Vorperiode hat Heizkosten der Anlage abgerechnet (C1, Nachprüfung N2): Bezeichnung und Summe der
  // Positionen. Die Karte fragt dann, ob der Anfangsbestand schon umgelegt wurde.
  previousFuel?: { label: string; cents: number } | null
  // Abgeschlossen, ohne dass der Stand einen Vorrat eingefroren hat (Nachprüfung N1): Die Mieter haben
  // den Brennstoff mit den Rechnungen bezahlt; der Endbestand geht mit 0 € weiter.
  closedWithoutStock?: boolean
}

export type StockProblem =
  | { kind: 'missing'; period: string; what: string[] }
  | { kind: 'invalid'; period: string; reasons: string[] }
export type StockResult = { ok: true; statement: HeatingStockStatement } | { ok: false; problem: StockProblem }

// Was die Rechnung verlangt: Beträge nur, wenn nach Verbrauch verteilt wird (freie Schlüssel); kg
// und CO₂-Kosten nur bei Brennstoffen, deren CO₂-Kosten aufzuteilen sind (Heizöl, Flüssiggas, Kohle).
// `countedAt(Rechnungsdatum)` ist `!law(co2CostsBefore, …)`; die beiden Tage stammen aus denselben
// Fassungen (`co2CostsExcludedUntil`, `co2CostsCountedFrom`).
export type StockOptions = {
  needCost: boolean
  needCo2: boolean
  countedAt: (invoiceDate: string) => boolean
  excludedUntil: string
  countedFrom: string
}

const EPS = 1e-9
const KG_PER_STEP = 100
const DAY_MS = 86400000

// Derselbe Bestand mit 0 € und ohne CO₂-Kosten: Er ist schon bezahlt, seine kg zählen weiter.
export function zeroValued(v: StockValue): StockValue {
  return valueOf(v.layers.map((l) => ({ ...l, costCents: 0, co2Cents: 0 })))
}

export const roundKg = (kg: number): number => Math.round(kg * KG_PER_STEP + EPS) / KG_PER_STEP
const roundCents = (cents: number): number => Math.round(cents + EPS)

export const fmtQuantity = (q: number, unit: StockUnit): string =>
  `${q.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${STOCK_UNIT_TEXT[unit]}`
const unitWord = (u: string | null): string => (u === 'l' || u === 'kg' || u === 'srm' ? STOCK_UNIT_TEXT[u] : u === null || u === '' ? 'keiner Einheit' : u)

const sumCost = (layers: readonly StockLayer[]): number | null =>
  layers.every((l) => l.costCents !== null) ? layers.reduce((a, l) => a + (l.costCents ?? 0), 0) : null
const sumKg = (layers: readonly StockLayer[]): number => layers.reduce((a, l) => a + l.emissionsKg, 0)
const countedCo2 = (layers: readonly StockLayer[]): number => layers.reduce((a, l) => a + (l.co2Counted ? l.co2Cents : 0), 0)

export function valueOf(layers: readonly StockLayer[]): StockValue {
  return {
    quantity: layers.reduce((a, l) => a + l.quantity, 0),
    costCents: sumCost(layers),
    emissionsKg: roundKg(sumKg(layers)),
    co2Cents: countedCo2(layers),
    layers: [...layers],
  }
}

// Der Endbestand aus den jüngsten Teilen, je Teil gerundet. Ein ganzer Teil bleibt, wie er ist.
export function closingOf(layers: readonly StockLayer[], quantity: number): StockLayer[] {
  const out: StockLayer[] = []
  let rest = quantity
  for (let i = layers.length - 1; i >= 0 && rest > EPS; i--) {
    const l = layers[i]
    if (!l || l.quantity <= 0) continue
    const take = Math.min(rest, l.quantity)
    const f = take / l.quantity
    out.unshift(f >= 1 - EPS
      ? { ...l }
      : {
        ...l,
        quantity: take,
        costCents: l.costCents === null ? null : roundCents(l.costCents * f),
        emissionsKg: roundKg(l.emissionsKg * f),
        co2Cents: roundCents(l.co2Cents * f),
      })
    rest -= take
  }
  return out
}

// Der eingetragene Anfangsbestand als bewerteter Bestand, oder was dafür fehlt.
function openingValue(o: StockOpeningInput, opts: StockOptions): StockValue | string[] {
  // Schon umgelegt (C1): Wert und CO₂-Kosten sind bezahlt, gefragt wird nur nach den kg.
  if (o.alreadySettled) {
    if (opts.needCo2 && o.emissionsKg === null) return ['der CO₂-Ausstoß des Anfangsbestands in kg']
    return valueOf([{ label: 'Anfangsbestand (schon umgelegt)', date: null, quantity: o.quantity, costCents: 0, emissionsKg: o.emissionsKg ?? 0, co2Cents: 0, co2Counted: false }])
  }
  const missing: string[] = []
  if (opts.needCost && o.costCents === null) missing.push('der Wert des Anfangsbestands')
  if (opts.needCo2 && o.emissionsKg === null) missing.push('der CO₂-Ausstoß des Anfangsbestands in kg')
  if (opts.needCo2 && o.invoicedBefore2023 === null) missing.push(`ob der Anfangsbestand vor dem ${germanDate(opts.countedFrom)} in Rechnung gestellt wurde`)
  if (opts.needCo2 && o.invoicedBefore2023 === false && o.co2Cents === null) missing.push('die CO₂-Kosten des Anfangsbestands')
  if (missing.length > 0) return missing
  const counted = opts.needCo2 ? opts.countedAt(o.invoicedBefore2023 ? opts.excludedUntil : opts.countedFrom) : true
  return valueOf([{ label: 'Anfangsbestand', date: null, quantity: o.quantity, costCents: o.costCents, emissionsKg: o.emissionsKg ?? 0, co2Cents: o.co2Cents ?? 0, co2Counted: counted }])
}

type Balance = Omit<HeatingStockStatement, 'openingSource'>

function balance(p: StockPeriodInput, unit: StockUnit, closingQuantity: number, opening: StockValue, opts: StockOptions): { ok: true; balance: Balance } | { ok: false; reasons: string[] } {
  const reasons: string[] = []
  const sorted = [...p.deliveries].sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id))
  for (const d of sorted) {
    const name = `„${d.label}“`
    if (d.quantityUnit !== unit) reasons.push(`die Lieferung ${name} ist in ${unitWord(d.quantityUnit)} erfasst, der Vorrat in ${STOCK_UNIT_TEXT[unit]}`)
    if (d.quantity === null || !(d.quantity > 0)) reasons.push(`die Lieferung ${name} hat keine Menge`)
    if (opts.needCost && d.costCents === null) reasons.push(`die Lieferung ${name} hat keinen Betrag; verknüpfen Sie die Kostenposition ihrer Rechnung mit der Lieferung`)
    if (opts.needCo2 && (d.emissionsKg === null || d.co2Cents === null)) reasons.push(`bei der Lieferung ${name} fehlen der CO₂-Ausstoß in kg oder die CO₂-Kosten laut Rechnung`)
  }
  const total = opening.quantity + sorted.reduce((a, d) => a + (d.quantity ?? 0), 0)
  // Die Summen rechnet `valueOf` aus den Teilen neu, wie beim Lesen eines eingefrorenen Stands.
  const frozenNext = p.nextFrozenOpening ? valueOf(p.nextFrozenOpening.layers) : null
  const closingQ = frozenNext ? frozenNext.quantity : closingQuantity
  if (closingQ > total + EPS) {
    reasons.push(`der Endbestand von ${fmtQuantity(closingQ, unit)}${frozenNext ? ', den die abgeschlossene Folgeperiode übernommen hat,' : ''} ist größer als Anfangsbestand und Lieferungen zusammen (${fmtQuantity(total, unit)})`)
  }
  if (reasons.length > 0) return { ok: false, reasons }
  const deliveries: StockLayer[] = sorted.map((d) => ({
    label: d.label,
    date: d.date,
    quantity: d.quantity ?? 0,
    costCents: d.costCents,
    emissionsKg: d.emissionsKg ?? 0,
    co2Cents: d.co2Cents ?? 0,
    co2Counted: opts.needCo2 ? opts.countedAt(d.invoiceDate) : true,
  }))
  const all = [...opening.layers, ...deliveries]
  // Hat die abgeschlossene Folgeperiode diesen Endbestand übernommen, gilt er, wie sie ihn eingefroren hat.
  const closing = frozenNext ?? valueOf(closingOf(all, closingQuantity))
  const inCost = sumCost(all)
  // Was als Altbestand ohne CO₂-Kosten zählt: Brennstoff mit Rechnung vor 2023 (§ 11 Abs. 2 Satz 2).
  // Ein schon umgelegter Anfangsbestand trägt ebenfalls keine CO₂-Kosten, ist aber kein Altbestand.
  const old = (l: StockLayer) => !l.co2Counted && l.label !== 'Anfangsbestand (schon umgelegt)'
  const oldIn = sumKg(all.filter(old))
  const oldOut = sumKg(closing.layers.filter(old))
  // Bucht diese Heizperiode keinen Übertrag (freie Schlüssel ohne Schlüssel), haben ihre Mieter den
  // Endbestand schon bezahlt; er geht mit 0 € und ohne CO₂-Kosten weiter (I1). Hat die abgeschlossene
  // Folgeperiode ihn übernommen, gilt dagegen, was sie eingefroren hat.
  const handover = !frozenNext && opts.needCost && (p.hasKey === false || p.closedWithoutStock === true) ? zeroValued(closing) : closing
  return {
    ok: true,
    balance: {
      unit,
      opening,
      deliveries,
      closing,
      ...(frozenNext ? { closingFrozen: true } : {}),
      handover,
      closingMeasuredOn: p.closingMeasuredOn,
      consumed: {
        quantity: total - closing.quantity,
        costCents: inCost === null || closing.costCents === null ? null : inCost - closing.costCents,
        emissionsKg: roundKg(sumKg(all) - closing.emissionsKg),
        co2Cents: countedCo2(all) - closing.co2Cents,
      },
      paidCents: sumCost(deliveries),
      oldStockKg: Math.max(0, roundKg(oldIn - oldOut)),
    },
  }
}

// Die Bestandsrechnung der letzten Heizperiode der Kette (älteste zuerst). Jede Periode davor ist
// entweder eingefroren (ihr Endbestand gilt, wie er beim Abschluss war) oder wird gerechnet.
export function stockOf(chain: readonly StockPeriodInput[], opts: StockOptions): StockResult {
  const last = chain.length - 1
  let opening: StockValue | null = null
  let source: HeatingStockStatement['openingSource'] = 'own'
  let previousUnit: StockUnit | null = null
  for (let i = 0; i <= last; i++) {
    const p = chain[i]
    if (!p) break
    if (i < last && p.frozenClosing) {
      opening = p.frozenClosing
      source = 'frozen'
      previousUnit = p.unit
      continue
    }
    const missing: string[] = []
    if (p.unit === null) missing.push('die Einheit des Vorrats')
    let open: StockValue | null = opening
    if (open === null) {
      if (!p.ownOpening) missing.push('der Anfangsbestand')
      else {
        const v = openingValue(p.ownOpening, opts)
        if (Array.isArray(v)) missing.push(...v)
        else open = v
      }
    }
    if (p.closingQuantity === null && !p.nextFrozenOpening) missing.push('der Endbestand')
    if (missing.length > 0 || open === null || p.unit === null) {
      return { ok: false, problem: { kind: 'missing', period: p.label, what: missing } }
    }
    if (opening !== null && previousUnit !== null && previousUnit !== p.unit) {
      return { ok: false, problem: { kind: 'invalid', period: p.label, reasons: [`der Vorrat der Vorperiode ist in ${STOCK_UNIT_TEXT[previousUnit]} geführt, dieser in ${STOCK_UNIT_TEXT[p.unit]}`] } }
    }
    const r = balance(p, p.unit, p.closingQuantity ?? 0, open, opts)
    if (!r.ok) return { ok: false, problem: { kind: 'invalid', period: p.label, reasons: r.reasons } }
    const settled = p.ownOpening?.alreadySettled && opening === null ? { openingSettledCents: p.ownOpening.costCents, openingSettledSource: p.ownOpening.settledSource ?? 'entered' } : {}
    if (i === last) return { ok: true, statement: { ...r.balance, ...settled, openingSource: i === 0 || source === 'own' ? 'own' : source } }
    opening = r.balance.handover ?? r.balance.closing
    source = 'previous'
    previousUnit = p.unit
  }
  return { ok: false, problem: { kind: 'missing', period: '', what: ['der Anfangsbestand'] } }
}

// Was fehlt oder nicht passt, als ein Satz.
export function problemText(problem: StockProblem): string {
  const where = problem.period ? ` (Heizperiode ${problem.period})` : ''
  const list = problem.kind === 'missing' ? problem.what : problem.reasons
  const joined = list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} und ${list.at(-1) ?? ''}`
  return problem.kind === 'missing'
    ? `Für die Bestandsrechnung${where} fehlt: ${joined}.`
    : `Die Bestandsrechnung${where} geht nicht auf: ${joined}.`
}

const nextDay = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
const daysFromTo = (from: string, to: string): number => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1

// Wurde nicht am letzten Tag der Heizperiode gepeilt, gilt der Wert wie gepeilt (Entwurf 8.2, wie
// 3.5). Für den Hinweis: die Tage dazwischen und die Lieferungen, die die Peilung nicht enthält
// (gepeilt vor dem Ende) bzw. schon enthält (gepeilt danach). `null`: am Ende oder ohne Tag gepeilt.
export function measuredOffset(p: StockPeriodInput): { days: number; range: { from: string; to: string }; after: boolean; deliveries: { label: string; date: string }[] } | null {
  const d = p.closingMeasuredOn
  if (d === null || d === p.to) return null
  const after = d > p.to
  const range = after ? { from: nextDay(p.to), to: d } : { from: nextDay(d), to: p.to }
  const deliveries = after ? p.laterDeliveries : p.deliveries.filter((x) => x.date > d).map((x) => ({ label: x.label, date: x.date }))
  return { days: daysFromTo(range.from, range.to), range, after, deliveries }
}

// ---------- Eingefrorener Bestand (G-A4) ----------

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function layerOf(v: unknown): StockLayer | null {
  if (v === null || typeof v !== 'object') return null
  const label: unknown = Reflect.get(v, 'label')
  const date: unknown = Reflect.get(v, 'date')
  const quantity: unknown = Reflect.get(v, 'quantity')
  const costCents: unknown = Reflect.get(v, 'costCents')
  const emissionsKg: unknown = Reflect.get(v, 'emissionsKg')
  const co2Cents: unknown = Reflect.get(v, 'co2Cents')
  const co2Counted: unknown = Reflect.get(v, 'co2Counted')
  if (typeof label !== 'string' || !(date === null || typeof date === 'string') || !isNumber(quantity) || !(costCents === null || isNumber(costCents))) return null
  if (!isNumber(emissionsKg) || !isNumber(co2Cents) || typeof co2Counted !== 'boolean') return null
  return { label, date, quantity, costCents, emissionsKg, co2Cents, co2Counted }
}

// Ein Bestand aus einem abgeschlossenen Stand. Gelesen werden die Teile; die Summen rechnet
// `valueOf` daraus neu, damit ein von Hand bearbeitetes Archivstück nicht in sich widersprüchlich
// gelesen wird. Ist ein Teil krumm, gibt es keinen eingefrorenen Bestand.
export function readFrozenStock(value: unknown): StockValue | null {
  if (value === null || typeof value !== 'object') return null
  const layers: unknown = Reflect.get(value, 'layers')
  if (!Array.isArray(layers)) return null
  const read = layers.flatMap((x: unknown) => {
    const l = layerOf(x)
    return l ? [l] : []
  })
  return read.length === layers.length ? valueOf(read) : null
}

// ---------- Für die CO₂-Aufteilung (Naht N1 zu PR 7) ----------

// E, C und der Betrag des verbrauchten Brennstoffs. Der Vorrat deckt die ganze Heizperiode ab.
export type FuelFigures = { emissionsKg: number; co2Cents: number; grossCents: number | null; missing: string[] }

export const fuelFromStock = (s: HeatingStockStatement): FuelFigures => ({
  emissionsKg: s.consumed.emissionsKg,
  co2Cents: s.consumed.co2Cents,
  grossCents: s.consumed.costCents,
  missing: [],
})

// Ohne Bestand bei freien Schlüsseln: wie geliefert (Entwurf 8.2: „Verteilt wird nach Lieferung wie
// heute“). Der Hinweis `fuel.manual-by-delivery` sagt, dass die Einstufung dann auf gelieferten statt
// verbrauchten kg beruht. `null` ohne Lieferung.
export function fuelFromDeliveries(p: StockPeriodInput, countedAt: (invoiceDate: string) => boolean): FuelFigures | null {
  if (p.deliveries.length === 0) return null
  const known = p.deliveries.every((d) => d.costCents !== null)
  return {
    emissionsKg: roundKg(p.deliveries.reduce((a, d) => a + (d.emissionsKg ?? 0), 0)),
    co2Cents: p.deliveries.reduce((a, d) => a + (d.co2Cents !== null && countedAt(d.invoiceDate) ? d.co2Cents : 0), 0),
    grossCents: known ? p.deliveries.reduce((a, d) => a + (d.costCents ?? 0), 0) : null,
    missing: p.deliveries.filter((d) => d.emissionsKg === null || d.co2Cents === null).map((d) => d.label),
  }
}

// Hat der Vermieter zum Vorrat dieser Heizperiode etwas erfasst? Sonst rechnet die Abrechnung wie ohne
// Vorrat (Entwurf 1.2 Nr. 1).
export function stockTouched(chain: readonly StockPeriodInput[]): boolean {
  const last = chain.at(-1)
  if (!last) return false
  return chain.length > 1 || last.unit !== null || last.ownOpening !== null || last.closingQuantity !== null || last.deliveries.length > 0
}

// ---------- Der Schlüssel der Überträge (Festlegung 5 des Plans) ----------

// Was als Brennstoffposition einer Anlage zählt: Kostenart Heizung, an der Anlage, als Brennstoff
// gekennzeichnet oder mit einer Lieferung verknüpft, und verteilt nach einem Schlüssel; Einzelbeträge
// und „laut Gemeinschaftsabrechnung“ nennen feste Beträge und taugen nicht.
export type StockKeyItem = { category: string; heatingPlantId?: string | null; heatingPart?: string | null; fuelDeliveryId?: string | null; key: string; amountCents: number; period: string }
const KEYED: readonly string[] = ['area', 'persons', 'units', 'meter', 'direct', 'custom']
export const isStockFuelItem = (c: StockKeyItem, plantId: string, heatingCategory: string): boolean =>
  c.category === heatingCategory && c.heatingPlantId === plantId && (c.heatingPart === 'fuel' || (c.fuelDeliveryId ?? null) !== null)

// Die Position, deren Schlüssel die Überträge folgen: die Brennstoffposition dieser Heizperiode mit dem
// größten Betrag, sonst die jüngste der Vorperiode. Schnappschuss und Abrechnung fragen dieselbe Regel.
export function stockTemplateOf<T extends StockKeyItem>(current: readonly T[], previous: readonly T[], plantId: string, heatingCategory: string): T | null {
  const ok = (c: T) => isStockFuelItem(c, plantId, heatingCategory) && KEYED.includes(c.key)
  const largest = current.filter(ok).reduce<T | null>((a, c) => (a === null || c.amountCents > a.amountCents ? c : a), null)
  return largest ?? previous.filter(ok).at(-1) ?? null
}

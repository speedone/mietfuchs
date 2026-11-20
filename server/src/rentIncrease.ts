// Rechnung einer Mieterhöhung (#191, PR 2): Vergleichsmiete (§ 558 BGB), Indexmiete (§ 557b BGB), Übersicht einer
// Staffelmiete (§ 557a BGB) und die nächsten Ereignisse für das Cockpit. Entwurf
// docs/superpowers/specs/2026-11-20-mieterhoehung-design.md, Regeln R1 bis R14 mit den Befunden der Gegenprüfung (M1 bis
// M5, S1, S3, G1 bis G5, K1); die Abschnitte „Umsetzung PR 1“ und „Umsetzung PR 2“ halten die Abweichungen fest.
//
// Rein und ohne Datenbank, wie prepaymentSteps.ts: Die Route (index.ts) liest den Bestand und reicht Mietverhältnis,
// Wohnung, Objekt, den Tag und die Eingaben herein. Geschrieben wird nichts; das Schreiben und die Übernahme in die
// Staffel kommen mit PR 3.
//
// - **Jede Rechtszahl aus dem Register**, abgefragt mit `law()` und Protokoll (`legalValues`, für PR 3 zum Einfrieren).
//   Wächter: law-literals.test.ts führt die Datei unter den Dateien der Berechnung.
// - **Geld in Cent, exakt gerechnet** (BigInt), die neue Miete auf den Cent abgerundet (`practice.rent-increase-rounding`,
//   Entwurf R11). Keine Fließkomma-Zwischenrundung: Fläche und Indexwerte gehen als Dezimalbruch hinein.
// - **Daten in UTC, Grenzen eingeschlossen**, als Zeichenketten 'JJJJ-MM-TT' bzw. 'JJJJ-MM'.
// - **Bezugstag** (Gegenprüfung M1): der Tag, an dem die letzte für die Fristen zählende Änderung wirksam wurde, bei einer
//   Stufe der Erste ihres Monats, frühestens der Mietbeginn (tagesgenau). Stufen der Art `modernization` zählen nicht
//   (§ 558 Abs. 1 Satz 3, § 557b Abs. 2 Satz 1 BGB), die erste Stufe der Staffel zählt immer: Beginnt die Staffel nach dem
//   Mietbeginn, ist unbekannt, was davor galt, und der spätere Tag ist die sichere Seite. Fehlt die Art, gilt
//   `agreement` (zählt).
import type {
  FederalState, Property, RentCapAnswer, RentCapDerivation, RentChangeReason, RentComparisonDerivation, RentEntry,
  RentEvents, RentIncrease, RentIncreaseConsent, RentIncreaseNeed, RentIncreasePlan, RentIncreaseRequest, RentIndexValue,
  RentStaggeredOverview, Tenancy, Unit,
} from '../../shared/types.ts'
import { createLawLog, dayAfter, eventPeriodEnd, germanDate, law, shiftMonths, valueAt, type LawLog } from '../../shared/law/register.ts'
import { bgbIndexRent, bgbRentCap, bgbRentIncreaseConsent, bgbRentIncreaseLockMonths, bgbRentIncreaseWaitMonths, bgbStaggeredRent } from '../../shared/law/bgb-betrkv.ts'
import { practiceRentIncreaseRounding, practiceVpiSeries } from '../../shared/law/practice.ts'
import { deadlineOnWorkday } from '../../shared/deadlines.ts'
import { addMonths, monthBounds, monthName } from '../../shared/monthlyInfo.ts'
import { compareText } from './calc.ts'

export type RentIncreaseTenancy = Pick<Tenancy, 'id' | 'start' | 'end' | 'baseRents' | 'rentKind' | 'rentIncreaseExcluded' | 'costModel' | 'heatingModel'>
export type RentIncreaseInput = {
  today: string
  tenancy: RentIncreaseTenancy
  unit: Pick<Unit, 'areaM2'>
  property: Pick<Property, 'rentCapReduced' | 'state' | 'tightMarket'> | null
  request: RentIncreaseRequest
}

// ---------- Datum ----------

const monthOf = (day: string): string => day.slice(0, 7)
const firstOf = (month: string): string => `${month}-01`
const later = (a: string, b: string): string => (compareText(a, b) >= 0 ? a : b)

// Der erste Tag nach einem Zeitraum von `months` Monaten, der mit dem Beginn von `day` anfängt (§§ 187 Abs. 2, 188 Abs. 2
// BGB): der Tag gleicher Zahl; fehlt er im Zielmonat, endet der Zeitraum mit dem Monatsletzten (§ 188 Abs. 3 BGB), und der
// erste Tag danach ist der Erste des Folgemonats.
function dayAfterMonths(day: string, months: number): string {
  const shifted = shiftMonths(day, months)
  return shifted.slice(8) === day.slice(8) ? shifted : firstOf(addMonths(monthOf(shifted), 1))
}
// Der erste Monatserste an oder nach einem Tag, als Monat.
const monthStartingOnOrAfter = (day: string): string => (day.endsWith('-01') ? monthOf(day) : addMonths(monthOf(day), 1))
// Nie ein Zugang am Monatsersten (Entwurf G3, Gegenprüfung K1): Ob die Sperrfrist nach § 187 Abs. 1 oder Abs. 2 BGB
// beginnt, ist nicht belegt; der Zweite ändert weder Zustimmungsfrist noch Wirksamwerden.
const notOnFirst = (day: string): string => (day.endsWith('-01') ? `${monthOf(day)}-02` : day)

// ---------- Geld ----------

const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const areaText = (m2: number): string => `${m2.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²`
const indexText = (v: RentIndexValue): string => `${v.value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (${monthName(v.month)}, Basis ${v.base} = 100)`

// Eine Dezimalzahl als genauer Bruch aus ihrer kürzesten Schreibweise: 61.5 → 615/10. So rechnet die Fläche nicht mit dem
// Fehler der Gleitkommazahl.
function fraction(n: number): { num: bigint; den: bigint } {
  const text = /e/i.test(String(n)) ? n.toFixed(6) : String(n)
  const [whole = '0', frac = ''] = text.split('.')
  return { num: BigInt(whole + frac), den: 10n ** BigInt(frac.length) }
}
// Abgerundet auf den Cent (`floor-cent`); andere Regeln kennt das Register nicht.
function rounded(num: bigint, den: bigint, rule: 'floor-cent'): number {
  if (rule !== 'floor-cent') throw new Error(`Unbekannte Rundung „${String(rule)}“`)
  const q = num / den
  return Number(num % den !== 0n && (num < 0n) !== (den < 0n) ? q - 1n : q)
}

// ---------- Staffel ----------

const reasonOf = (r: Pick<RentEntry, 'reason'>): RentChangeReason => r.reason ?? 'agreement'
const sortedRents = (t: RentIncreaseTenancy): RentEntry[] => [...t.baseRents].sort((a, b) => compareText(a.from, b.from))
// Die Stufe, die in einem Monat gilt.
const rentAt = (sorted: readonly RentEntry[], month: string): RentEntry | undefined => sorted.filter((r) => compareText(r.from, month) <= 0).at(-1)

// Der Bezugstag (siehe Kopf): letzte zählende Änderung, frühestens der Mietbeginn.
export function referenceDay(t: Pick<Tenancy, 'start'>, sorted: readonly RentEntry[]): string {
  let ref = t.start
  sorted.forEach((r, i) => {
    if (i === 0 || reasonOf(r) !== 'modernization') ref = later(ref, later(firstOf(r.from), t.start))
  })
  return ref
}

// Frühester Zugang und frühestes Wirksamwerden nach § 558 Abs. 1 BGB (R1, R2), getrennt gerechnet: Wirksamwerden am ersten
// Monatsersten, an dem die Miete seit `wait` Monaten unverändert ist; Zugang frühestens `lock` Monate nach dem Bezugstag
// und so, dass die erhöhte Miete nach § 558b Abs. 1 BGB nicht vor diesem Monat geschuldet ist (Gegenprüfung M1).
function comparisonTiming(ref: string, wait: number, lock: number, effectiveMonth: number): { earliestEffective: string; earliestReceipt: string } {
  const earliestEffective = monthStartingOnOrAfter(dayAfterMonths(ref, wait))
  const receipt = later(dayAfterMonths(ref, lock), firstOf(addMonths(earliestEffective, -effectiveMonth)))
  return { earliestEffective, earliestReceipt: notOnFirst(receipt) }
}
// Indexmiete (R9, Gegenprüfung M4): Zugang frühestens ein Jahr nach dem Bezugstag, die geänderte Miete ab dem übernächsten
// Monat nach Zugang.
function indexTiming(ref: string, v: { minMonths: number; effectiveMonthOffset: number }): { earliestEffective: string; earliestReceipt: string } {
  const earliestReceipt = notOnFirst(dayAfterMonths(ref, v.minMonths))
  return { earliestReceipt, earliestEffective: addMonths(monthOf(earliestReceipt), v.effectiveMonthOffset) }
}

// Fristen nach § 558b BGB (R6) mit der Lösung O2 der Recherche: Zustimmungsfrist bis zum Ablauf des zweiten
// Kalendermonats nach dem Zugangsmonat, nach § 193 BGB auf den nächsten Werktag am Ort verschoben; Klage frühestens am Tag
// danach, Klagefrist aus dem nicht verschobenen Ende (früher ist sicher). Feiertage des Landes des Objekts.
export function consentDates(receivedOn: string, v: { consentMonths: number; suitMonths: number }, state: FederalState | null): RentIncreaseConsent {
  const consentEnd = monthBounds(addMonths(monthOf(receivedOn), v.consentMonths)).to
  const consentEndOnWorkday = deadlineOnWorkday(consentEnd, state)
  return { consentEnd, consentEndOnWorkday, suitFrom: dayAfter(consentEndOnWorkday), suitEnd: eventPeriodEnd(consentEnd, v.suitMonths) }
}

// Die Übersicht einer Staffelmiete (R10): Stufen, nächste und letzte (ohne Modernisierung), Abstand unter einem Jahr,
// Mietpreisbremse nur bei angespanntem Wohnungsmarkt (Gegenprüfung K5).
export function staggeredOverview(t: RentIncreaseTenancy, today: string, tightMarket: boolean | null | undefined): RentStaggeredOverview {
  const sorted = sortedRents(t)
  const counting = sorted.filter((r, i) => i === 0 || reasonOf(r) !== 'modernization')
  const notes: string[] = []
  for (let i = 1; i < counting.length; i++) {
    const before = counting[i - 1]
    const step = counting[i]
    if (!before || !step) continue
    const min = valueAt(bgbStaggeredRent, firstOf(step.from)).minMonths
    if (compareText(step.from, addMonths(before.from, min)) < 0) {
      notes.push(`Zwischen der Stufe ab ${monthName(before.from)} und der ab ${monthName(step.from)} liegen weniger als ${min} Monate. Die Miete muss jeweils mindestens ein Jahr unverändert bleiben (${bgbStaggeredRent.norm}); prüfen Sie die Vereinbarung.`)
    }
  }
  if (tightMarket === true) notes.push('Das Objekt liegt in einem Gebiet mit Mietpreisbremse. Jede Stufe muss bei ihrer Fälligkeit die zulässige Miete einhalten (§ 557a Abs. 4 BGB); Mietfuchs prüft das nicht.')
  return {
    steps: sorted.map((r) => ({ from: r.from, cents: r.monthlyCents, reason: reasonOf(r) })),
    nextFrom: sorted.find((r) => compareText(r.from, monthOf(today)) > 0)?.from ?? null,
    lastFrom: counting.at(-1)?.from ?? null,
    notes,
  }
}

// ---------- Plan ----------

type Draft = {
  plan: RentIncreasePlan
  needs: Set<RentIncreaseNeed>
  blocked: boolean
  notYet: boolean
}
const need = (d: Draft, what: RentIncreaseNeed, sentence: string): void => {
  d.needs.add(what)
  d.plan.reasons.push(sentence)
}
const block = (d: Draft, sentence: string): void => {
  d.blocked = true
  d.plan.reasons.push(sentence)
}
const wait = (d: Draft, sentence: string): void => {
  d.notYet = true
  d.plan.reasons.push(sentence)
}

// Was für beide Arten gilt: Angaben zum Vertrag (R14, M2), Bestätigungen (R13, R14), Wohnraum (S6), Staffel vorhanden.
function commonChecks(d: Draft, input: RentIncreaseInput): void {
  const { tenancy: t, request: q, unit } = input
  if (t.rentKind == null) need(d, 'rentKind', 'Bitte geben Sie beim Mietverhältnis die Art der Miete an (nach Vertrag, Staffelmiete oder Indexmiete). Ohne die Angabe rechnet Mietfuchs nicht, denn eine Staffel- oder Indexmiete schließt eine Erhöhung nach § 558 BGB aus.')
  if (t.rentIncreaseExcluded == null) need(d, 'exclusion', 'Bitte geben Sie beim Mietverhältnis an, ob der Vertrag Mieterhöhungen ausschließt (§ 557 Abs. 3 BGB), etwa ein Zeitmietvertrag mit fester Miete.')
  else if (t.rentIncreaseExcluded) block(d, 'Der Vertrag schließt Mieterhöhungen aus (§ 557 Abs. 3 BGB). Eine Erhöhung ist nicht möglich.')
  if (q.allStepsEntered !== true) need(d, 'allStepsEntered', 'Bitte bestätigen Sie, dass alle Änderungen der Kaltmiete seit Mietbeginn mit ihrer Art in der Staffel eingetragen sind, bei einer Staffelmiete auch die künftigen Stufen. Fristen und Kappungsgrenze hängen daran.')
  if (q.residential !== true) need(d, 'residential', 'Bitte bestätigen Sie, dass die Wohnung Wohnraum ist, nicht preisgebunden und nicht nach § 549 Abs. 2 oder 3 BGB ausgenommen (etwa zum vorübergehenden Gebrauch vermietet). Nur dafür gelten die §§ 557 bis 561 BGB.')
  if (!(unit.areaM2 > 0)) block(d, 'Die Wohnung hat keine Wohnfläche. Eine Garage, ein Stellplatz oder eine gewerbliche Einheit ist kein Wohnraum; die Vorschriften über die Mieterhöhung gelten dafür nicht.')
  if (t.baseRents.length === 0) need(d, 'baseRents', 'Bitte tragen Sie beim Mietverhältnis die Kaltmiete-Staffel ein, mindestens die Miete bei Mietbeginn. Ohne sie lässt sich nichts rechnen.')
}

function emptyPlan(input: RentIncreaseInput, receivedOn: string): RentIncreasePlan {
  return {
    kind: input.request.kind, state: 'blocked', reasons: [], warnings: [], needs: [], currentCents: null, currentSince: null, receivedOn,
    earliestReceivedOn: null, effectiveFrom: null, earliestEffectiveFrom: null, consent: null, cap: null, comparison: null, index: null,
    maxCents: null, newCents: null, steps: [], staggered: null, legalValues: [],
  }
}

function finish(d: Draft, log: LawLog): RentIncreasePlan {
  return { ...d.plan, needs: [...d.needs], state: d.blocked || d.needs.size > 0 ? 'blocked' : d.notYet ? 'notYet' : 'possible', legalValues: [...log.values] }
}

// Eine Stufe ab dem Monat des Wirksamwerdens oder danach: Die Erhöhung läge vor einer schon vereinbarten Änderung.
function laterStep(d: Draft, sorted: readonly RentEntry[], effective: string): void {
  const step = sorted.find((r) => compareText(r.from, effective) >= 0)
  if (step) block(d, `In der Kaltmiete-Staffel steht schon eine Stufe ab ${monthName(step.from)}. Eine Erhöhung ab ${monthName(effective)} ist so nicht möglich; wählen Sie einen späteren Monat oder prüfen Sie die Staffel.`)
}
function endsBefore(d: Draft, t: RentIncreaseTenancy, effective: string): void {
  if (t.end !== null && compareText(t.end, firstOf(effective)) < 0) block(d, `Das Mietverhältnis endet am ${germanDate(t.end)}, vor dem Wirksamwerden am ${germanDate(firstOf(effective))}.`)
}

export function planRentIncrease(input: RentIncreaseInput): RentIncreasePlan {
  const receivedOn = input.request.receivedOn ?? notOnFirst(input.today)
  const d: Draft = { plan: emptyPlan(input, receivedOn), needs: new Set(), blocked: false, notYet: false }
  const log = createLawLog()
  if (input.request.receivedOn && input.request.receivedOn.endsWith('-01')) {
    d.plan.warnings.push('Der Zugang ist an einem Monatsersten geplant. Ob die Jahressperrfrist an diesem Tag schon abgelaufen ist, ist nicht geklärt; Mietfuchs schlägt deshalb immer den Zweiten vor.')
  }
  commonChecks(d, input)
  if (input.request.kind === 'index') planIndex(d, input, log)
  else planComparison(d, input, log)
  return finish(d, log)
}

// ---------- Vergleichsmiete (§ 558 BGB) ----------

function planComparison(d: Draft, input: RentIncreaseInput, log: LawLog): void {
  const { tenancy: t, request: q, property } = input
  const p = d.plan
  if (t.rentKind === 'index') block(d, 'Für das Mietverhältnis ist eine Indexmiete vereinbart. Solange sie gilt, ist eine Erhöhung bis zur Vergleichsmiete ausgeschlossen (§ 557b Abs. 2 Satz 3 BGB).')
  if (q.noThirdPartyFunds !== true) need(d, 'thirdPartyFunds', 'Bitte bestätigen Sie, dass für die Wohnung keine Fördermittel oder Zuschüsse Dritter geflossen sind (§ 558 Abs. 5, § 559a BGB). Einen Abzug dafür rechnet Mietfuchs nicht.')
  const sorted = sortedRents(t)
  if (sorted.length === 0) return

  const receipt = p.receivedOn
  const consent = law(bgbRentIncreaseConsent, { date: receipt }, log)
  const natural = addMonths(monthOf(receipt), consent.effectiveMonth)
  const waitMonths = law(bgbRentIncreaseWaitMonths, { date: firstOf(natural) }, log)
  const lockMonths = law(bgbRentIncreaseLockMonths, { date: receipt }, log)
  const ref = referenceDay(t, sorted)
  const timing = comparisonTiming(ref, waitMonths, lockMonths, consent.effectiveMonth)
  const effective = q.effectiveFrom ?? (compareText(natural, timing.earliestEffective) >= 0 ? natural : timing.earliestEffective)
  p.currentSince = ref
  p.earliestReceivedOn = timing.earliestReceipt
  p.earliestEffectiveFrom = timing.earliestEffective
  p.effectiveFrom = effective
  p.consent = consentDates(receipt, consent, property?.state ?? null)

  p.reasons.push(`Die Miete muss am Tag des Wirksamwerdens seit ${waitMonths} Monaten unverändert sein (${bgbRentIncreaseWaitMonths.norm}), und das Verlangen darf frühestens ${lockMonths} Monate nach der letzten Erhöhung zugehen (${bgbRentIncreaseLockMonths.norm}). Zuletzt geändert hat sie sich am ${germanDate(ref)}; frühestens wirksam wird eine Erhöhung deshalb am ${germanDate(firstOf(timing.earliestEffective))}, das Verlangen sollte frühestens am ${germanDate(timing.earliestReceipt)} zugehen.`)
  if (sorted.some((r, i) => i > 0 && reasonOf(r) === 'modernization')) p.reasons.push('Erhöhungen wegen Modernisierung bleiben bei diesen Fristen außer Betracht (§ 558 Abs. 1 Satz 3 BGB).')
  if (t.rentKind === 'staggered') {
    p.staggered = staggeredOverview(t, input.today, property?.tightMarket)
    const last = p.staggered.lastFrom
    if (last !== null && compareText(monthOf(receipt), last) <= 0) p.reasons.push(`Während der Laufzeit der Staffelmiete ist eine Erhöhung bis zur Vergleichsmiete ausgeschlossen (§ 557a Abs. 2 Satz 2 BGB). Die letzte Stufe gilt ab ${monthName(last)}; die Fristen oben rechnen ab ihr.`)
  }
  p.reasons.push(`Geht das Verlangen am ${germanDate(receipt)} zu, kann der Mieter bis zum ${germanDate(p.consent.consentEnd)} zustimmen und schuldet die erhöhte Miete ab ${monthName(natural)}. Stimmt er nicht zu, können Sie ab dem ${germanDate(p.consent.suitFrom)} und bis zum ${germanDate(p.consent.suitEnd)} auf Zustimmung klagen (${bgbRentIncreaseConsent.norm}).${p.consent.consentEndOnWorkday !== p.consent.consentEnd ? ` Das Fristende fällt auf einen Sonnabend, Sonntag oder Feiertag; ob sich die Zustimmungsfrist deshalb nach § 193 BGB bis zum ${germanDate(p.consent.consentEndOnWorkday)} verlängert, ist nicht geklärt. Mietfuchs rechnet die Klage erst danach und das Ende der Klagefrist vom Monatsende.` : ''}`)

  if (compareText(receipt, timing.earliestReceipt) < 0) wait(d, `Am ${germanDate(receipt)} ist es noch zu früh: Das Verlangen darf frühestens am ${germanDate(timing.earliestReceipt)} zugehen.`)
  if (compareText(effective, natural) < 0) wait(d, `Bei Zugang am ${germanDate(receipt)} ist die erhöhte Miete frühestens ab ${monthName(natural)} geschuldet (§ 558b Abs. 1 BGB). Ein späterer Monat ist möglich, ein früherer nicht.`)
  else if (compareText(effective, timing.earliestEffective) < 0) wait(d, `Ab ${monthName(effective)} ist die Miete noch keine ${waitMonths} Monate unverändert; frühestens wirksam wird eine Erhöhung ab ${monthName(timing.earliestEffective)}.`)
  laterStep(d, sorted, effective)
  endsBefore(d, t, effective)

  const current = rentAt(sorted, addMonths(effective, -1)) ?? sorted[0]
  if (!current) return
  p.currentCents = current.monthlyCents
  p.steps.push({ label: 'Bisherige Miete', value: `${euro(current.monthlyCents)} (ab ${monthName(current.from)})` })

  const rounding = law(practiceRentIncreaseRounding, { date: firstOf(effective) }, log)
  const cap = capOf(d, input, sorted, effective, log, rounding)
  const cmp = comparisonOf(d, input, rounding)
  if (!cap || !cmp) return
  p.cap = cap
  p.comparison = cmp
  const max = Math.min(cap.limitCents, cmp.limitCents)
  p.maxCents = max
  p.steps.push({ label: 'Höchstbetrag', value: `${euro(max)}, das Kleinere aus Kappungsgrenze und Vergleichsmiete` })
  if (max <= current.monthlyCents) {
    block(d, `Der Höchstbetrag von ${euro(max)} liegt nicht über der bisherigen Miete von ${euro(current.monthlyCents)}. Eine Erhöhung bis zur Vergleichsmiete ist nicht möglich.`)
    return
  }
  const requested = q.requestedCents ?? max
  if (requested > max) {
    block(d, `Die gewünschte Miete von ${euro(requested)} liegt über dem Höchstbetrag. Verlangen können Sie höchstens ${euro(max)}.`)
    return
  }
  if (requested <= current.monthlyCents) {
    block(d, `Die gewünschte Miete von ${euro(requested)} liegt nicht über der bisherigen Miete von ${euro(current.monthlyCents)}.`)
    return
  }
  p.newCents = requested
  p.steps.push({ label: 'Verlangte Miete', value: `${euro(requested)}, ${euro(requested - current.monthlyCents)} mehr als bisher` })
  // Über dem Oberwert der Spanne (R7, Gegenprüfung K6): gerechnet ohne den enthaltenen Betriebskostenanteil.
  if (q.rangeHighCentsPerM2 != null) {
    const area = fraction(cmp.areaM2)
    const net = BigInt(requested - (cmp.operatingCostsCents ?? 0))
    if (net * area.den > BigInt(q.rangeHighCentsPerM2) * area.num) {
      p.warnings.push(`Die verlangte Miete liegt über dem Oberwert der Spanne von ${euro(q.rangeHighCentsPerM2)} je m². Der Oberwert trägt nur bei Merkmalen, die über dem Durchschnitt liegen; begründen Sie das im Schreiben (§ 558a Abs. 4 Satz 1 BGB).`)
    }
  }
}

// Kappungsgrenze (R4, R12, Gegenprüfung M3, S1, S3, G1).
function capOf(d: Draft, input: RentIncreaseInput, sorted: readonly RentEntry[], effective: string, log: LawLog, rounding: 'floor-cent'): RentCapDerivation | null {
  const { tenancy: t, request: q, property } = input
  const v = law(bgbRentCap, { date: firstOf(effective) }, log)
  const capDate = shiftMonths(firstOf(effective), -v.years * 12)
  // Begann das Mietverhältnis nach dem Stichtag, ist die Anfangsmiete die Ausgangsmiete (G1).
  const baseDay = later(t.start, capDate)
  const baseMonth = monthOf(baseDay)
  const first = sorted[0]
  let baseCents: number
  let baseSource: RentCapDerivation['baseSource'] = 'schedule'
  if (first && compareText(first.from, baseMonth) <= 0) baseCents = (rentAt(sorted, baseMonth) ?? first).monthlyCents
  else if (q.rentAtCapDateCents != null) {
    baseCents = q.rentAtCapDateCents
    baseSource = 'entered'
  } else {
    need(d, 'rentAtCapDate', baseDay === capDate
      ? `Die Kaltmiete-Staffel beginnt erst nach dem Stichtag der Kappungsgrenze, dem ${germanDate(capDate)} (drei Jahre vor dem Wirksamwerden, § 558 Abs. 3 BGB). Bitte geben Sie die Miete ein, die an diesem Tag vereinbart war; Mietfuchs nimmt sie nicht aus einer späteren Stufe an.`
      : `Die Kaltmiete-Staffel beginnt erst nach dem Mietbeginn am ${germanDate(t.start)}. Für die Kappungsgrenze zählt die Miete bei Mietbeginn (§ 558 Abs. 3 BGB); bitte geben Sie sie ein.`)
    return null
  }
  const answer: RentCapAnswer = q.rentCap ?? (property?.rentCapReduced === true ? 'yes' : property?.rentCapReduced === false ? 'no' : 'unknown')
  const reduced = answer !== 'no'
  const percent = reduced ? v.reducedPercent : v.percent
  // Erhöhungen wegen Modernisierung nach dem Tag der Ausgangsmiete kommen hinzu (S3: eine Stufe im Stichtagsmonat steckt
  // schon in der Ausgangsmiete), je ihr Betrag gegenüber der Stufe davor.
  let modernizationCents = 0
  sorted.forEach((r, i) => {
    const before = sorted[i - 1]
    if (i > 0 && before && reasonOf(r) === 'modernization' && compareText(r.from, baseMonth) > 0 && compareText(r.from, effective) < 0) modernizationCents += Math.max(0, r.monthlyCents - before.monthlyCents)
  })
  const limitCents = rounded(BigInt(baseCents) * BigInt(100 + percent), 100n, rounding) + modernizationCents
  const p = d.plan
  p.reasons.push(`Kappungsgrenze (${bgbRentCap.norm}): Innerhalb von ${v.years} Jahren darf die Miete höchstens ${percent} % steigen, Erhöhungen wegen Modernisierung ausgenommen. Ausgangsmiete ist die am ${germanDate(baseDay)} vereinbarte Miete von ${euro(baseCents)}${baseDay === capDate ? ', drei Jahre vor dem Wirksamwerden' : ', die Miete bei Mietbeginn'}${baseSource === 'entered' ? ' (von Ihnen eingegeben)' : ''}.`)
  if (!reduced) p.reasons.push(`Sie haben angegeben, dass in der Gemeinde keine Verordnung die Kappungsgrenze senkt; gerechnet wird mit ${percent} %. Prüfen Sie das vor jedem Verlangen, denn Verordnungen kommen hinzu und laufen aus.`)
  else if (answer === 'unknown') p.reasons.push(`Ob in der Gemeinde eine Verordnung die Kappungsgrenze senkt, ist nicht angegeben; Mietfuchs rechnet sicher mit ${percent} %.`)
  p.steps.push({ label: `Ausgangsmiete am ${germanDate(baseDay)}`, value: `${euro(baseCents)}${baseSource === 'entered' ? ' (eingegeben)' : ''}` })
  p.steps.push({ label: `Zuzüglich ${percent} %`, value: euro(rounded(BigInt(baseCents) * BigInt(100 + percent), 100n, rounding)) })
  if (modernizationCents > 0) p.steps.push({ label: 'Modernisierung danach', value: `+ ${euro(modernizationCents)}` })
  p.steps.push({ label: 'Kappungsgrenze', value: euro(limitCents) })
  return { capDate, baseDay, baseCents, baseSource, percent, reduced, modernizationCents, limitCents }
}

// Vergleichsmiete × tatsächliche Fläche (R5), bei Inklusivmiete zuzüglich des enthaltenen Betriebskostenanteils (S1, R8).
function comparisonOf(d: Draft, input: RentIncreaseInput, rounding: 'floor-cent'): RentComparisonDerivation | null {
  const { tenancy: t, request: q, unit } = input
  const p = d.plan
  const inclusive = t.costModel === 'inclusive' || t.heatingModel === 'inclusive'
  const areaM2 = q.areaM2 ?? unit.areaM2
  if (q.areaM2 != null && q.areaM2 !== unit.areaM2) {
    p.warnings.push(`Die eingegebene Fläche von ${areaText(q.areaM2)} weicht von der Wohnfläche der Wohnung (${areaText(unit.areaM2)}) ab. Maßgeblich ist allein die tatsächliche Größe (BGH, Urteil vom 18.11.2015, VIII ZR 266/14); prüfen Sie auch die Angabe an der Wohnung.`)
  }
  let missing = false
  if (q.comparisonCentsPerM2 == null) {
    need(d, 'comparisonRent', 'Bitte geben Sie die ortsübliche Vergleichsmiete je m² ein, wie sie Ihr Begründungsmittel nennt (Mietspiegel, Gutachten oder Vergleichswohnungen).')
    missing = true
  }
  if (inclusive && q.operatingCostsCents == null) {
    need(d, 'operatingCosts', 'Die Miete enthält Betriebskosten (Inklusivmiete). Bitte geben Sie den Betrag ein, der tatsächlich auf die Wohnung entfällt; das Schreiben muss ihn nennen und die Miete mit der Vergleichsmiete vergleichbar machen (BGH, Urteil vom 16.12.2020, VIII ZR 108/20, Rn. 16 f.). Mietfuchs schlägt ihn noch nicht aus einer Abrechnung vor.')
    missing = true
  }
  if (missing || q.comparisonCentsPerM2 == null || !(areaM2 > 0)) return null
  const area = fraction(areaM2)
  const rentCents = rounded(BigInt(q.comparisonCentsPerM2) * area.num, area.den, rounding)
  const operatingCostsCents = inclusive ? (q.operatingCostsCents ?? 0) : null
  const limitCents = rentCents + (operatingCostsCents ?? 0)
  p.steps.push({ label: 'Vergleichsmiete × Fläche', value: `${euro(q.comparisonCentsPerM2)} je m² × ${areaText(areaM2)} = ${euro(rentCents)}` })
  if (operatingCostsCents !== null) {
    p.steps.push({ label: 'Enthaltene Betriebskosten', value: `+ ${euro(operatingCostsCents)}` })
    p.warnings.push('Bei einer Inklusivmiete muss das Schreiben den enthaltenen Betriebskostenanteil nennen und die Miete der um ihn erhöhten Vergleichsmiete gegenüberstellen (BGH, Urteil vom 16.12.2020, VIII ZR 108/20, Rn. 16 f.).')
  }
  p.reasons.push(`Höchstens verlangen können Sie die ortsübliche Vergleichsmiete für die tatsächliche Fläche (§ 558 Abs. 1 BGB): ${euro(q.comparisonCentsPerM2)} je m² × ${areaText(areaM2)} = ${euro(rentCents)}${operatingCostsCents !== null ? `, bei Inklusivmiete zuzüglich ${euro(operatingCostsCents)} Betriebskosten` : ''}, und nicht mehr als die Kappungsgrenze.`)
  return { centsPerM2: q.comparisonCentsPerM2, areaM2, rentCents, operatingCostsCents, limitCents }
}

// ---------- Indexmiete (§ 557b BGB) ----------

function planIndex(d: Draft, input: RentIncreaseInput, log: LawLog): void {
  const { tenancy: t, request: q } = input
  const p = d.plan
  if (t.rentKind != null && t.rentKind !== 'index') block(d, 'Für das Mietverhältnis ist keine Indexmiete angegeben. Eine Anpassung an den Verbraucherpreisindex setzt eine Vereinbarung nach § 557b Abs. 1 BGB voraus.')
  const sorted = sortedRents(t)
  if (sorted.length === 0) return

  const receipt = p.receivedOn
  const v = law(bgbIndexRent, { date: receipt }, log)
  const ref = referenceDay(t, sorted)
  const timing = indexTiming(ref, v)
  const natural = addMonths(monthOf(receipt), v.effectiveMonthOffset)
  const effective = q.effectiveFrom ?? (compareText(natural, timing.earliestEffective) >= 0 ? natural : timing.earliestEffective)
  p.currentSince = ref
  p.earliestReceivedOn = timing.earliestReceipt
  p.earliestEffectiveFrom = timing.earliestEffective
  p.effectiveFrom = effective
  p.reasons.push(`Bei einer Indexmiete muss die Miete jeweils mindestens ${v.minMonths} Monate unverändert bleiben, Erhöhungen wegen Modernisierung ausgenommen (${bgbIndexRent.norm}). Zuletzt geändert hat sie sich am ${germanDate(ref)}; Mietfuchs lässt die Erklärung deshalb frühestens am ${germanDate(timing.earliestReceipt)} zugehen. Die geänderte Miete ist ab Beginn des übernächsten Monats nach dem Zugang zu zahlen, bei Zugang am ${germanDate(receipt)} ab ${monthName(natural)}.`)
  if (compareText(receipt, timing.earliestReceipt) < 0) wait(d, `Am ${germanDate(receipt)} ist es noch zu früh: Die Erklärung darf frühestens am ${germanDate(timing.earliestReceipt)} zugehen.`)
  if (compareText(effective, natural) < 0) wait(d, `Bei Zugang am ${germanDate(receipt)} ist die geänderte Miete frühestens ab ${monthName(natural)} zu zahlen (§ 557b Abs. 3 Satz 3 BGB).`)
  laterStep(d, sorted, effective)
  endsBefore(d, t, effective)

  const current = rentAt(sorted, addMonths(effective, -1)) ?? sorted[0]
  if (!current) return
  p.currentCents = current.monthlyCents
  if (reasonOf(current) === 'modernization') {
    block(d, 'Die bisherige Miete beruht auf einer Erhöhung wegen Modernisierung. Wie eine Indexanpassung danach zu rechnen ist, prüft Mietfuchs nicht; bitte lassen Sie das prüfen.')
    return
  }
  const from = q.fromIndex ?? current.index ?? null
  const to = q.toIndex ?? null
  if (q.fromIndex && current.index && q.fromIndex.month !== current.index.month) {
    p.warnings.push(`Der eingegebene Ausgangsindex gilt für ${monthName(q.fromIndex.month)}, die Stufe ab ${monthName(current.from)} nennt ${monthName(current.index.month)}. Prüfen Sie, welcher Monat laut Vertrag bzw. letzter Anpassung maßgeblich ist.`)
  }
  if (!from) need(d, 'fromIndex', `Die Stufe ab ${monthName(current.from)} trägt keinen Indexwert. Bitte geben Sie den Ausgangsindex ein: den Wert des Monats, mit dem die bisherige Miete berechnet ist (bei Vertragsbeginn der Monat laut Vertrag).`)
  if (!to) need(d, 'toIndex', 'Bitte geben Sie den neuen Indexwert ein: Monat und Wert des Verbraucherpreisindex aus der beim Zugang aktuellen Reihe.')
  if (!from || !to) return
  // Beide Werte aus derselben, beim Zugang aktuellen Reihe (Gegenprüfung M5, BGH VIII ZR 42/20 Rn. 28, 34).
  const series = law(practiceVpiSeries, { date: receipt }, log)
  let stop = false
  for (const value of [from, to]) {
    if (value.base !== series.base) {
      need(d, value === from ? 'fromIndex' : 'toIndex', `Der Wert für ${monthName(value.month)} hat die Basis ${value.base}. Bitte lesen Sie den Wert für ${monthName(value.month)} in der aktuellen Reihe (Basis ${series.base}, Tabelle ${series.table}) nach; Werte verschiedener Basisjahre lassen sich nicht ins Verhältnis setzen (BGH, Urteil vom 26.05.2021, VIII ZR 42/20, Rn. 28, 34).`)
      stop = true
    }
  }
  if (compareText(to.month, from.month) <= 0) {
    block(d, `Der neue Indexwert (${monthName(to.month)}) muss nach dem Ausgangsindex (${monthName(from.month)}) liegen.`)
    stop = true
  }
  if (compareText(to.month, monthOf(receipt)) >= 0) {
    block(d, `Der Indexwert für ${monthName(to.month)} ist beim Zugang am ${germanDate(receipt)} noch nicht veröffentlicht. Nehmen Sie den jüngsten Monat, der beim Zugang veröffentlicht ist.`)
    stop = true
  }
  if (stop) return
  const tenths = (x: RentIndexValue): bigint => BigInt(Math.round(x.value * 10))
  const rounding = law(practiceRentIncreaseRounding, { date: firstOf(effective) }, log)
  const newCents = rounded(BigInt(current.monthlyCents) * tenths(to), tenths(from), rounding)
  p.index = { from, to }
  p.steps.push({ label: 'Bisherige Miete', value: `${euro(current.monthlyCents)} (ab ${monthName(current.from)})` })
  p.steps.push({ label: 'Ausgangsindex', value: indexText(from) })
  p.steps.push({ label: 'Neuer Index', value: indexText(to) })
  p.steps.push({ label: 'Neue Miete', value: `${euro(current.monthlyCents)} × ${indexText(to).split(' ')[0]} / ${indexText(from).split(' ')[0]} = ${euro(newCents)} (abgerundet auf den Cent)` })
  p.reasons.push(`Die Miete ändert sich im selben Verhältnis wie der Index (§ 557b Abs. 1 BGB; BGH, Urteil vom 22.11.2017, VIII ZR 291/16, Rn. 11), gerechnet ohne gerundeten Prozentsatz und auf den Cent abgerundet.`)
  if (newCents === current.monthlyCents) {
    block(d, 'Der Index hat sich nicht so geändert, dass sich die Miete ändert.')
    return
  }
  p.maxCents = newCents
  p.newCents = newCents
  if (newCents < current.monthlyCents) {
    p.warnings.push(`Der Index ist gesunken: Die Miete sinkt auf ${euro(newCents)}, ${euro(current.monthlyCents - newCents)} weniger. Eine Senkung gilt wie eine Erhöhung erst, wenn sie in Textform geltend gemacht wird (§ 557b Abs. 3 BGB), in der Regel vom Mieter; ein Schreiben von Ihnen ist möglich, aber nicht Pflicht.`)
  } else {
    p.steps.push({ label: 'Erhöhung', value: `${euro(newCents - current.monthlyCents)} je Monat` })
  }
}

// ---------- Cockpit (PR 4) ----------

// Die nächsten Ereignisse eines Mietverhältnisses: nächste Stufe der Staffel, frühester Zugang einer Erhöhung (nur mit
// beantworteter Art der Miete und ohne Ausschluss) und die Fristen versandter Verlangen nach § 558 BGB. Werte aus dem
// Register zum Tag (Texte außerhalb einer Abrechnung, `valueAt`).
export function nextRentEvents(input: { today: string; tenancy: RentIncreaseTenancy; state: FederalState | null; increases: readonly RentIncrease[] }): RentEvents {
  const { today, tenancy: t } = input
  const sorted = sortedRents(t)
  const next = sorted.find((r) => compareText(r.from, monthOf(today)) > 0)
  let earliest: RentEvents['earliest'] = null
  if (t.rentKind != null && t.rentIncreaseExcluded === false && sorted.length > 0) {
    const ref = referenceDay(t, sorted)
    if (t.rentKind === 'index') {
      const timing = indexTiming(ref, valueAt(bgbIndexRent, today))
      earliest = { kind: 'index', receivedOn: timing.earliestReceipt, effectiveFrom: timing.earliestEffective }
    } else {
      const consent = valueAt(bgbRentIncreaseConsent, today)
      const timing = comparisonTiming(ref, valueAt(bgbRentIncreaseWaitMonths, today), valueAt(bgbRentIncreaseLockMonths, today), consent.effectiveMonth)
      const natural = addMonths(monthOf(timing.earliestReceipt), consent.effectiveMonth)
      earliest = { kind: 'comparison', receivedOn: timing.earliestReceipt, effectiveFrom: compareText(natural, timing.earliestEffective) >= 0 ? natural : timing.earliestEffective }
    }
  }
  const open = input.increases
    .filter((r) => r.kind === 'comparison' && r.status === 'sent' && r.receivedOn !== null)
    .map((r) => {
      const received = r.receivedOn ?? ''
      return { id: r.id, ...consentDates(received, valueAt(bgbRentIncreaseConsent, received), input.state) }
    })
  return { nextStep: next ? { from: next.from, cents: next.monthlyCents } : null, earliest, open }
}

// ---------- Eingaben der Route ----------

const isDay = (x: unknown): x is string => {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false
  const t = Date.parse(`${x}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === x
}
const isMonth = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x)
const isCents = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
const AREA_MAX = 10000
const BASE_YEARS = { min: 1950, max: 2100 }

// Der Rumpf von POST /api/tenancies/:id/rent-increase/plan, geprüft: entweder die Eingaben oder ein Satz für die 400.
// Fehlende Angaben sind erlaubt (die Rechnung sagt, was fehlt); falsche Arten nicht.
export function rentIncreaseRequestOf(body: Record<string, unknown>): RentIncreaseRequest | { error: string } {
  const kind = body.kind
  if (kind !== 'comparison' && kind !== 'index') return { error: 'Die Art der Erhöhung ist unbekannt (Vergleichsmiete oder Indexmiete).' }
  const out: RentIncreaseRequest = { kind }
  const optional = (key: string): unknown => (body[key] === undefined ? null : body[key])
  const receivedOn = optional('receivedOn')
  if (receivedOn !== null && !isDay(receivedOn)) return { error: 'Der Zugang ist kein gültiges Datum.' }
  if (receivedOn !== null) out.receivedOn = receivedOn
  const effectiveFrom = optional('effectiveFrom')
  if (effectiveFrom !== null && !isMonth(effectiveFrom)) return { error: 'Der Monat des Wirksamwerdens ist ungültig (erwartet JJJJ-MM).' }
  if (effectiveFrom !== null) out.effectiveFrom = effectiveFrom
  for (const key of ['allStepsEntered', 'residential', 'noThirdPartyFunds'] as const) {
    const v = optional(key)
    if (v !== null && typeof v !== 'boolean') return { error: 'Eine Bestätigung ist ja oder nein.' }
    if (v !== null) out[key] = v
  }
  const rentCap = optional('rentCap')
  if (rentCap !== null && rentCap !== 'yes' && rentCap !== 'no' && rentCap !== 'unknown') return { error: 'Ob eine Kappungsgrenzen-Verordnung gilt, ist ja, nein oder „weiß nicht“.' }
  if (rentCap !== null) out.rentCap = rentCap
  for (const key of ['rentAtCapDateCents', 'comparisonCentsPerM2', 'rangeLowCentsPerM2', 'rangeHighCentsPerM2', 'operatingCostsCents', 'requestedCents'] as const) {
    const v = optional(key)
    if (v !== null && !isCents(v)) return { error: 'Ein Betrag ist eine ganze Zahl von Cent, nicht negativ.' }
    if (v !== null) out[key] = v
  }
  if (out.rangeLowCentsPerM2 != null && out.rangeHighCentsPerM2 != null && out.rangeLowCentsPerM2 > out.rangeHighCentsPerM2) return { error: 'Der Unterwert der Spanne liegt über dem Oberwert.' }
  const area = optional('areaM2')
  if (area !== null && !(typeof area === 'number' && Number.isFinite(area) && area > 0 && area <= AREA_MAX)) return { error: 'Die Fläche ist eine Zahl über 0.' }
  if (area !== null) out.areaM2 = area
  for (const key of ['fromIndex', 'toIndex'] as const) {
    const v = optional(key)
    if (v === null) continue
    const x = v as Partial<RentIndexValue>
    if (typeof v !== 'object' || !isMonth(x.month)) return { error: 'Ein Indexwert braucht einen Monat (JJJJ-MM).' }
    // Wie rentIndexOf in db/repository.ts: höchstens eine Nachkommastelle, nicht gerundet (Entwurf, Umsetzung PR 1).
    const tenths = typeof x.value === 'number' && Number.isFinite(x.value) ? Math.round(x.value * 10) : 0
    if (typeof x.value !== 'number' || tenths <= 0 || Math.abs(x.value * 10 - tenths) > 1e-6) return { error: 'Ein Indexwert ist eine Zahl über 0 mit höchstens einer Nachkommastelle.' }
    if (typeof x.base !== 'number' || !Number.isInteger(x.base) || x.base < BASE_YEARS.min || x.base > BASE_YEARS.max) return { error: `Das Basisjahr eines Indexwerts ist eine Jahreszahl von ${BASE_YEARS.min} bis ${BASE_YEARS.max}.` }
    out[key] = { month: x.month, value: tenths / 10, base: x.base }
  }
  return out
}

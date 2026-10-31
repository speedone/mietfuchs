// Tilgung der Mietzahlungen nach § 366 BGB (#312, Entwurf docs/superpowers/specs/2026-10-30-steuer-zufluss-design.md,
// E2/E3): eine reine Funktion, die jede Mietzahlung eines Mietverhältnisses auf die Bestandteile des Monats-Solls
// verteilt. **Eine Rechnung für Mietkonto und Steuer**: Das Mietkonto (#281) liest Status und Salden nur über
// `monthCoverage` und `openingBalance`, die Steuer (#312 PR 2) ordnet die Teile den Zeilen der Anlage V zu. Die
// Funktion fragt nie nach „heute“, nie nach dem Bundesland und nie nach Frist oder Versand einer Abrechnung; sie
// folgt reproduzierbar aus Zahlungen und Soll.
//
// **Kein Import aus calc.ts** (Wächter in rentAllocation.test.ts): calc.ts importiert diese Datei, ein Import zurück
// ergäbe einen ESM-Zyklus. Das Monats-Soll kommt deshalb aus shared/monthRate.ts, Rest-Cent und Reihenfolge aus
// apportion.ts.
//
// **Rechtsgrundlage.** Bestimmt der Mieter bei der Zahlung, welche Schuld getilgt wird, gilt das (§ 366 Abs. 1 BGB).
// Sonst zuerst die fällige Schuld, unter mehreren fälligen die mit geringerer Sicherheit, dann die ältere, bei
// gleichem Alter verhältnismäßig (§ 366 Abs. 2 BGB). Für die Bestandteile der Bruttomiete: BGH, Urteil vom 21.03.2018,
// VIII ZR 68/17, BGHZ 218, 139, und die Parallelentscheidung VIII ZR 84/17 vom selben Tag, dort
// - Rn. 53: § 366 Abs. 2 BGB analog; die Vorauszahlung ist die unsicherere Forderung, weil sie „nach Eintritt der
//   Abrechnungsreife oder erfolgter Abrechnung grundsätzlich nicht mehr geltend gemacht werden kann“;
// - Rn. 54: Anrechnung stets auf die ältesten Rückstände;
// - Rn. 56: Ist eine Zahlung einem Zeitraum zugeordnet, zuerst dessen Vorauszahlung, dann dessen Nettomiete, ein
//   Überschuss auf die ältesten Vorauszahlungen, dann die ältesten Nettomieten;
// - Rn. 57: Ohne Zuordnung in absteigendem Alter zuerst alle Vorauszahlungen, dann die Nettomieten.
// Volltext über gesetze.co gelesen am 30.10.2026.
//
// **Auslegungen von Mietfuchs** (Entwurf E2):
// - Klasse A (geringere Sicherheit) sind Vorauszahlung und Heizvorauszahlung, Klasse B Kaltmiete und Pauschale. Die
//   Pauschale wird nie abgerechnet und ist wie die Kaltmiete fester Teil der Miete.
// - Innerhalb einer Klasse und eines Monats verhältnismäßig nach dem Offenen (§ 366 Abs. 2 letzter Halbsatz), über
//   `largestRemainder` mit dem Namen des Bestandteils als Schlüssel.
// - Fällig ist ein Monat bei einer Zahlung am Tag d, wenn d ≥ der Erste des Monats: § 556b Abs. 1 BGB nennt den
//   Beginn als Leistungszeit, der dritte Werktag ist die Grenze der Pünktlichkeit; so hängt die Tilgung weder am
//   Bundesland noch an Feiertagen.
// - Noch nicht fällige Monate deckt ein Rest Monat für Monat in die Zukunft, je Monat A vor B (§ 366 Abs. 2 ordnet nur
//   fällige Schulden untereinander), bis zum Ende des Mietverhältnisses, nur bei offenem Ende höchstens
//   `FUTURE_MONTHS` Monate nach dem Monat der Zahlung. Was dann bleibt, ist ohne Forderung (`unallocated`).
// - Eine negative Mietzahlung (Rücklastschrift, Rückzahlung einer Überzahlung) nimmt die zuletzt vorgenommenen
//   Zuordnungen zurück (Stapel, zuletzt zuerst; ein Teil ohne Forderung liegt oben). Ein Eintrag des Stapels ist, was
//   eine Zahlung einer Klasse in einem Monat getilgt hat; eine Teilrücknahme nimmt daraus im Verhältnis der Teile
//   zurück (`largestRemainder`), denn verhältnismäßig wurde auch getilgt. Rechtlich wäre die Zuordnung genau der
//   zurückgebuchten Zahlung zurückzunehmen; den Bezug kennt Mietfuchs nicht. Die zurückgenommenen Teile behalten
//   Monat und Bestandteil und stehen mit negativem Betrag am Tag der negativen Zahlung. Bleibt nichts zurückzunehmen,
//   ist es ein negativer Teil ohne Forderung. Am selben Tag kommt eine negative Zahlung vor den positiven: Sie gehört
//   zu einer früheren Zahlung und soll nicht die desselben Tages zurücknehmen.
// - Keine stillschweigende Bestimmung: Ein Dauerauftrag über genau die Monatsmiete gilt nicht als Bestimmung des
//   laufenden Monats; wer das will, trägt den Monat an der Zahlung ein (`designatedMonth`, #281).
// - Nach Abrechnungsreife bleiben offene Vorauszahlungen offene Forderungen der Tilgung (keine Abhängigkeit von
//   Frist oder Versand); wie das Mietkonto sie zeigt, entscheidet #281 (E5).
// - Ein negatives Monats-Soll (eine Staffel unter 0) ist keine Forderung; es zählt als 0, in Tilgung, Deckung und
//   Saldo gleich (`claimOf`).
import type { Payment } from '../../shared/types.ts'
import { monthShare, monthSoll, type MonthlySchedule, type MonthSoll, type SollComponent } from '../../shared/monthRate.ts'
import { compareText, largestRemainder } from './apportion.ts'

export type { SollComponent }
export type RentComponent = SollComponent | 'unallocated'

// Ein Teil einer Zahlung: welcher Forderung (Monat und Bestandteil) sie wie viel getilgt hat.
export type AllocationSlice = {
  paymentId: string
  paidOn: string // Datum der Zahlung: Jahr des Zuflusses
  month: string | null // 'JJJJ-MM' der getilgten Forderung, null bei unallocated
  component: RentComponent
  cents: number // mit Vorzeichen (Rücknahme negativ)
}

// Eingabe: Zahlungen nur dieses Mietverhältnisses; die Art filtert die Funktion selbst (fehlend heißt Miete, wie
// `isRentPayment` in calc.ts). `designatedMonth` ist die Bestimmung des Mieters (Verwendungszweck); gespeichert
// wird sie erst mit #281, bis dahin fehlt sie.
export type AllocationPayment = Pick<Payment, 'id' | 'date' | 'amountCents'> & Partial<Pick<Payment, 'kind'>> & { designatedMonth?: string | null }

// Was die Tilgung vom Mietverhältnis liest: Zeitraum und Staffeln (SnapshotTenancy erfüllt das).
export type AllocationTenancy = {
  start: string
  end: string | null
  baseRents?: readonly MonthlySchedule[]
  prepayments?: readonly MonthlySchedule[]
  flatRates?: readonly MonthlySchedule[]
  heatingPrepayments?: readonly MonthlySchedule[]
}

// Nur bei offenem Ende reicht eine Vorauszahlung höchstens so viele Monate über den Monat der Zahlung hinaus (Entwurf E2,
// Schritt 3). Keine Rechtszahl, nur die Grenze einer Schleife; mehr als 60 Monate im Voraus nennt § 11 Abs. 1 Satz 3
// EStG eigens, das prüft der Rechenweg der Steuer.
export const FUTURE_MONTHS = 120

const CLASS_A: readonly SollComponent[] = ['prepayment', 'heatingPrepayment']
const CLASS_B: readonly SollComponent[] = ['baseRent', 'flatRate']
const COMPONENTS: readonly SollComponent[] = [...CLASS_A, ...CLASS_B]

const monthIndex = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1
const monthAt = (k: number): string => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`
const isRent = (p: Pick<AllocationPayment, 'kind'>): boolean => (p.kind ?? 'rent') === 'rent'
const zero = (): MonthSoll => ({ prepayment: 0, heatingPrepayment: 0, baseRent: 0, flatRate: 0 })
const total = (r: MonthSoll): number => COMPONENTS.reduce((a, c) => a + r[c], 0)
// Die Forderung eines Monats je Bestandteil: das Monats-Soll, ein negatives als 0. Eine Stelle für Tilgung, Deckung
// und Saldo, damit sie nie zweierlei Soll sehen.
const claimOf = (t: AllocationTenancy, month: string): MonthSoll => {
  const soll = monthSoll(t, month)
  return { prepayment: Math.max(0, soll.prepayment), heatingPrepayment: Math.max(0, soll.heatingPrepayment), baseRent: Math.max(0, soll.baseRent), flatRate: Math.max(0, soll.flatRate) }
}

export function allocateRentPayments(t: AllocationTenancy, payments: readonly AllocationPayment[]): AllocationSlice[] {
  const first = monthIndex(t.start)
  const last = t.end === null ? null : monthIndex(t.end)
  const sollCache = new Map<number, MonthSoll>()
  const sollOf = (k: number): MonthSoll => {
    let s = sollCache.get(k)
    if (!s) { s = claimOf(t, monthAt(k)); sollCache.set(k, s) }
    return s
  }
  const allocated = new Map<number, MonthSoll>()
  const allocatedOf = (k: number): MonthSoll => {
    let a = allocated.get(k)
    if (!a) { a = zero(); allocated.set(k, a) }
    return a
  }
  const openOf = (k: number, c: SollComponent): number => sollOf(k)[c] - allocatedOf(k)[c]

  const out: AllocationSlice[] = []
  // Der Stapel der Zuordnungen für Rücknahmen (zuletzt zuerst): je Zahlung, Monat und Klasse ein Eintrag mit seinen
  // noch nicht zurückgenommenen Teilen.
  const stack: { month: number | null, components: RentComponent[], parts: number[] }[] = []
  const emit = (p: AllocationPayment, k: number | null, component: RentComponent, cents: number): void => {
    if (cents === 0) return
    if (k !== null && component !== 'unallocated') allocatedOf(k)[component] += cents
    const month = k === null ? null : monthAt(k)
    // Folgen in einer Zahlung zwei Teile derselben Forderung aufeinander (Rücknahme über zwei Einträge), ein Teil.
    const prev = out.at(-1)
    if (prev && prev.paymentId === p.id && prev.month === month && prev.component === component && Math.sign(prev.cents) === Math.sign(cents)) prev.cents += cents
    else out.push({ paymentId: p.id, paidOn: p.date, month, component, cents })
  }

  // Tilgt aus `rest` die offenen Teile einer Klasse in einem Monat, verhältnismäßig; gibt den Rest zurück.
  const payClass = (p: AllocationPayment, k: number, comps: readonly SollComponent[], rest: number): number => {
    if (rest <= 0) return rest
    const opens = comps.map((c) => openOf(k, c))
    const open = opens.reduce((a, b) => a + b, 0)
    if (open <= 0) return rest
    const take = Math.min(rest, open)
    const parts = take === open ? opens : largestRemainder(take, opens.map((o) => (take * o) / open), [...comps])
    for (const [i, c] of comps.entries()) emit(p, k, c, parts[i] ?? 0)
    stack.push({ month: k, components: [...comps], parts: comps.map((_, i) => parts[i] ?? 0) })
    return rest - take
  }

  const allocate = (p: AllocationPayment): void => {
    let rest = p.amountCents
    const paidMonth = monthIndex(p.date)
    // 1. Bestimmung des Mieters (§ 366 Abs. 1 BGB; VIII ZR 84/17 Rn. 56). Ein Monat außerhalb des Mietverhältnisses
    //    wirkt wie keine Bestimmung (krumm, nicht kaputt; #281 nennt ihn).
    const designated = p.designatedMonth
    if (designated && /^\d{4}-(0[1-9]|1[0-2])$/.test(designated) && monthShare(t, designated).days > 0) {
      const k = monthIndex(designated)
      rest = payClass(p, k, CLASS_A, rest)
      rest = payClass(p, k, CLASS_B, rest)
    }
    // 2. Fällige Monate: zuerst alle offenen A-Teile, ältester zuerst, dann alle B-Teile (Rn. 57).
    const dueLast = last === null ? paidMonth : Math.min(paidMonth, last)
    for (const comps of [CLASS_A, CLASS_B]) {
      for (let k = first; k <= dueLast && rest > 0; k++) rest = payClass(p, k, comps, rest)
    }
    // 3. Noch nicht fällige Monate, je Monat A vor B; die Grenze nur bei offenem Ende.
    const futureLast = last ?? paidMonth + FUTURE_MONTHS
    for (let k = Math.max(first, paidMonth + 1); k <= futureLast && rest > 0; k++) {
      rest = payClass(p, k, CLASS_A, rest)
      rest = payClass(p, k, CLASS_B, rest)
    }
    // 4. Ohne Forderung.
    if (rest > 0) {
      emit(p, null, 'unallocated', rest)
      stack.push({ month: null, components: ['unallocated'], parts: [rest] })
    }
  }

  // 5. Rücknahme: die zuletzt vorgenommenen Zuordnungen, zuletzt zuerst.
  const reverse = (p: AllocationPayment): void => {
    let rest = -p.amountCents
    while (rest > 0) {
      const top = stack.at(-1)
      if (!top) break
      const held = top.parts.reduce((a, b) => a + b, 0)
      const take = Math.min(rest, held)
      const back = take === held ? top.parts : largestRemainder(take, top.parts.map((x) => (take * x) / held), top.components)
      for (const [i, c] of top.components.entries()) {
        const cents = back[i] ?? 0
        emit(p, top.month, c, -cents)
        top.parts[i] = (top.parts[i] ?? 0) - cents
      }
      if (take === held) stack.pop()
      rest -= take
    }
    if (rest > 0) emit(p, null, 'unallocated', -rest)
  }

  // Nach Datum, am selben Tag die negativen zuerst (sie gehören zu einer früheren Zahlung), dann nach Kennung (Zeichen
  // für Zeichen, #70): unabhängig von der Eingabereihenfolge.
  const negativeFirst = (a: AllocationPayment, b: AllocationPayment): number => Number(b.amountCents < 0) - Number(a.amountCents < 0)
  const ordered = payments.filter(isRent).slice().sort((a, b) => compareText(a.date, b.date) || negativeFirst(a, b) || compareText(a.id, b.id))
  for (const p of ordered) {
    if (p.amountCents > 0) allocate(p)
    else if (p.amountCents < 0) reverse(p)
  }
  return out
}

export type MonthCoverage = {
  month: string
  soll: MonthSoll // die Forderung: das Monats-Soll, ein negatives als 0
  paid: MonthSoll // bis `until` getilgt (einschließlich, nach `paidOn`)
  covered: boolean // die Regel „bezahlt = Σ Teile ≥ Soll“, an dieser einen Stelle; ohne Soll gedeckt
  paidLaterOn: string | null // zum Stichtag nicht gedeckt, später gedeckt worden: der Tag, ab dem er gedeckt ist
}

// Je Monat und Bestandteil: Soll und das bis `until` (einschließlich, nach `paidOn`) Getilgte. Gedeckt ist ein Monat,
// wenn die Summe seiner Teile das Soll erreicht, wie im Mietkonto; ein Monat ohne Soll ist gedeckt. `paidLaterOn`
// nennt für einen zum Stichtag nicht gedeckten Monat den Tag, an dem ihn spätere Zahlungen gedeckt haben (und seither
// gedeckt lassen); „noch nicht fällig“ (#133) entscheidet weiter das Mietkonto mit seinem Stichtag.
export function monthCoverage(t: AllocationTenancy, slices: readonly AllocationSlice[], months: readonly string[], until: string): MonthCoverage[] {
  const byMonth = new Map<string, AllocationSlice[]>()
  for (const s of slices) {
    if (s.month === null || s.component === 'unallocated') continue
    const list = byMonth.get(s.month)
    if (list) list.push(s)
    else byMonth.set(s.month, [s])
  }
  return months.map((month) => {
    const soll = claimOf(t, month)
    const own = byMonth.get(month) ?? []
    const paid = zero()
    for (const s of own) if (s.paidOn <= until && s.component !== 'unallocated') paid[s.component] += s.cents
    const sollTotal = total(soll)
    let sum = total(paid)
    const covered = sum >= sollTotal
    let paidLaterOn: string | null = null
    if (!covered) {
      const later = own.filter((s) => s.paidOn > until).sort((a, b) => compareText(a.paidOn, b.paidOn))
      for (let i = 0; i < later.length;) {
        const day = later[i]?.paidOn ?? ''
        for (; i < later.length && later[i]?.paidOn === day; i++) sum += later[i]?.cents ?? 0
        if (sum >= sollTotal) paidLaterOn ??= day
        else paidLaterOn = null
      }
    }
    return { month, soll, paid, covered, paidLaterOn }
  })
}

// Saldo zu Beginn des Tages `on`: Σ Mietzahlungen mit Datum < on − Σ Forderungen (Soll, negatives als 0) aller Monate des Mietverhältnisses vor dem
// Monat von `on`. Positiv = Guthaben (vorausbezahlt), negativ = Rückstand. Gleich der Summe der vorausbezahlten Teile
// (Monat ab dem von `on`) und der Teile ohne Forderung, abzüglich der offenen Teile früherer Monate (Invariante in
// invariant-tilgung.test.ts). Zahlungen aus der Abrechnung zählen nicht.
export function openingBalance(t: AllocationTenancy, payments: readonly AllocationPayment[], on: string): number {
  const paid = payments.filter((p) => isRent(p) && p.date < on).reduce((a, p) => a + p.amountCents, 0)
  const first = monthIndex(t.start)
  const before = monthIndex(on) - 1
  const lastMonth = t.end === null ? before : Math.min(before, monthIndex(t.end))
  let soll = 0
  for (let k = first; k <= lastMonth; k++) soll += total(claimOf(t, monthAt(k)))
  return paid - soll
}

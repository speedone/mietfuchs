// „Demnächst fällig“ im Cockpit (#190, Entwurf docs/superpowers/specs/2026-11-12-fristen-design.md): Fristen und
// Erinnerungen eines Objekts, nur aus vorhandenen Daten gerechnet. Rein, ohne Uhr und Datenzugriff; die Route
// GET /api/upcoming stellt den Eingang zusammen und reicht `today()` herein.
//
// Was in der Liste steht, und warum (Zeitfenster):
// - **Abrechnungsfrist** (§ 556 Abs. 3 Satz 2 BGB, `settlementDeadline` wie in der Abrechnung) je Zeitraum, der zu Ende
//   ist, in dem jemand abgerechnet wird und dessen Abrechnung nicht (abgeschlossen **und** als versendet markiert) ist.
//   Kommend: Fristende in den nächsten `UPCOMING_HORIZON_DAYS` Tagen. Abgelaufen: nur, wenn für den Zeitraum etwas
//   erfasst ist (Kosten oder ein Abschluss) und er vor höchstens drei Jahren endete; ältere Zeiträume ohne Daten
//   stammen meist aus der Zeit vor Mietfuchs und wären Lärm. Ohne Verschiebung nach § 193 BGB (früher ist sicher).
// - **Einwendungsfrist** des Mieters (§ 556 Abs. 3 Satz 5 BGB, `objectionDeadline`) je versendeter Abrechnung, nur
//   solange sie läuft und wenn sie im Fenster endet; eine Information, keine Aufgabe.
// - **Kaution nach Auszug** (`depositsAfterMoveOut`, #228) ohne Fenster, solange laut den Buchungen Geld beim Vermieter
//   liegt. Eine feste Frist gibt es nicht (§ 551 BGB); `date` ist das Mietende.
// - **Eichfrist** (§ 34 Abs. 2 MessEV) je Zähler mit Eichjahr: Ende am 31.12. dieses Jahres. Kommend schon
//   `CALIBRATION_LEAD_MONTHS` Monate vorher, denn ein Zählertausch braucht Vorlauf (Messdienst, Termin mit den Mietern),
//   und mit 90 Tagen erschiene jede Frist erst im Oktober. Abgelaufen im ersten Jahr danach oder solange der Zähler
//   nach dem Ende weiter abgelesen wird; einen ausgebauten Zähler erkennt Mietfuchs sonst nicht.
//
// - **Mieterhöhung** (#191, PR 4; Entwurf docs/superpowers/specs/2026-11-20-mieterhoehung-design.md, „Umsetzung PR 4“),
//   je Mietverhältnis über `nextRentEvents` (rentIncrease.ts), nichts nach dem Auszug:
//   - `rentStep`: Stufe einer Staffelmiete (Art der Miete oder der Stufe `staggered`), die im Fenster beginnt. Bei der
//     letzten Stufe der früheste Zugang eines Verlangens nach § 558 BGB, nur wenn eines möglich ist (Vertrag schließt
//     Erhöhungen ausdrücklich nicht aus, Wohnfläche vorhanden, Mietverhältnis läuft bis zum Wirksamwerden).
//   - `rentIncrease`: frühester Zugang eines Verlangens bzw. einer Indexerklärung im Fenster oder schon erreicht. Nicht bei
//     Sperren, die keine Eingabe löst (Ausschluss, keine Wohnfläche, Auszug vor dem Wirksamwerden, Indexmiete nach einer
//     Modernisierungsstufe), und **nicht ohne Art der Miete**: Die Angabe ist freiwillig und neu; wer sie nicht macht,
//     erhöht nicht über Mietfuchs und soll im Cockpit keine Erinnerung an jedes Mietverhältnis bekommen. Eine offene
//     Frage zum Ausschluss sperrt nicht, sie lässt sich nachtragen. Unterdrückt, solange ein Verlangen offen ist
//     (Entwurf, versandtes nach § 558) oder eine Erhöhung erst nach heute wirkt.
//   - `rentConsent`: versandtes Verlangen nach § 558 ohne Antwort, ohne Fenster: Zustimmungsfrist läuft (bis zum nach
//     § 193 BGB verschobenen Werktag), Klagefrist läuft, oder beide sind verstrichen. Gerechnet aus dem tatsächlichen
//     Zugang (`receivedOn`), nicht aus dem Plan des Schreibens. Schweigen ist keine Zustimmung (S8); nichts erledigt sich
//     von selbst, der Eintrag geht erst mit der eingetragenen Antwort oder der Rücknahme.
//
// Das Fenster von 90 Tagen: ein Quartal, lang genug, um eine Abrechnung fertigzustellen und zuzustellen, kurz genug,
// dass die Liste nicht jede laufende Frist eines Jahres zeigt. Die Checkliste nennt die Frist des gewählten Zeitraums
// ohnehin mit ihren Tagen.
import { depositsAfterMoveOut } from '../../shared/deposit.ts'
import { dayAfter, shiftMonths } from '../../shared/law/register.ts'
import { objectionDeadline, periodLabel, periodOfKey, periodsBetween, settlementDeadline } from '../../shared/period.ts'
import type { DepositEntry, FederalState, Meter, PeriodKey, PeriodRules, Reading, RentIncrease, Tenancy, Unit, UpcomingDeadline, UpcomingDeadlines } from '../../shared/types.ts'
import { compareText } from './apportion.ts'
import { nextRentEvents } from './rentIncrease.ts'
import { isOpen } from './rentIncreaseSave.ts'

export const UPCOMING_HORIZON_DAYS = 90
export const CALIBRATION_LEAD_MONTHS = 12
// Wie weit eine abgelaufene Abrechnungsfrist zurückreicht (Ende des Zeitraums), und wie lange eine abgelaufene Eichfrist
// ohne Ablesung danach stehen bleibt.
const SETTLEMENT_LOOKBACK_MONTHS = 36
const CALIBRATION_GRACE_MONTHS = 12

export type UpcomingTenancy = Pick<Tenancy, 'id' | 'unitId' | 'tenantName' | 'start' | 'end' | 'costModel' | 'heatingModel' | 'depositCents' | 'depositStatus' | 'baseRents' | 'rentKind' | 'rentIncreaseExcluded'>
export type UpcomingUnit = Pick<Unit, 'id' | 'name' | 'areaM2'>
export type UpcomingRentIncrease = Pick<RentIncrease, 'id' | 'tenancyId' | 'kind' | 'status' | 'receivedOn' | 'effectiveFrom'>
export type UpcomingMeter = Pick<Meter, 'id' | 'name' | 'type' | 'calibratedUntil'>

export type UpcomingInput = {
  rules: PeriodRules
  // die Mietverhältnisse des Objekts
  tenancies: readonly UpcomingTenancy[]
  // Zeiträume, für die Kosten erfasst sind
  costPeriods: ReadonlySet<PeriodKey>
  closed: readonly { period: PeriodKey; sentAt: string | null }[]
  meters: readonly UpcomingMeter[]
  readings: readonly Pick<Reading, 'meterId' | 'date'>[]
  deposits: readonly DepositEntry[]
  // Wohnungen des Objekts (Name für den Titel, Fläche), Land für die Feiertage, Verlangen der Mietverhältnisse
  units: readonly UpcomingUnit[]
  state: FederalState | null
  rentIncreases: readonly UpcomingRentIncrease[]
}

// Bekommt das Mietverhältnis eine Abrechnung? Wie in der Aufstellung zum Auszug (db/deposits.ts): ohne Angabe gilt
// Abrechnung; Pauschale und Inklusivmiete für beides heißt keine, Heizung auch „heizt selbst“.
const settles = (t: UpcomingTenancy): boolean =>
  (t.costModel ?? 'settlement') === 'settlement' || (t.heatingModel ?? 'settlement') === 'settlement'

const addDays = (date: string, days: number): string => {
  let d = date
  for (let i = 0; i < days; i++) d = dayAfter(d)
  return d
}

export function upcomingDeadlines(input: UpcomingInput, today: string): UpcomingDeadlines {
  const until = addDays(today, UPCOMING_HORIZON_DAYS)
  const items: UpcomingDeadline[] = []

  // Abrechnungsfrist
  const first = input.tenancies.map((t) => t.start).reduce<string | null>((a, b) => (a === null || compareText(b, a) < 0 ? b : a), null)
  const lookback = shiftMonths(today, -SETTLEMENT_LOOKBACK_MONTHS)
  if (first !== null && compareText(first, today) < 0) {
    for (const p of periodsBetween(input.rules, first, today)) {
      if (compareText(p.to, today) >= 0) continue
      const needed = input.tenancies.some((t) => settles(t) && compareText(t.start, p.to) <= 0 && (t.end === null || compareText(t.end, p.from) >= 0))
      if (!needed) continue
      const closed = input.closed.find((c) => c.period === p.key)
      if (closed?.sentAt) continue
      const deadline = settlementDeadline(p)
      if (compareText(deadline, until) > 0) continue
      const upcoming = compareText(deadline, today) >= 0
      const recorded = closed !== undefined || input.costPeriods.has(p.key)
      if (!upcoming && !(recorded && compareText(p.to, lookback) >= 0)) continue
      items.push({ kind: 'settlement', id: `settlement:${p.key}`, date: deadline, period: p.key, label: periodLabel(p), closed: closed !== undefined })
    }
  }

  // Einwendungsfrist
  for (const c of input.closed) {
    if (!c.sentAt || compareText(c.sentAt, today) > 0) continue
    const p = periodOfKey(input.rules, c.period)
    if (!p) continue
    const end = objectionDeadline(c.sentAt)
    if (compareText(end, today) < 0 || compareText(end, until) > 0) continue
    items.push({ kind: 'objection', id: `objection:${c.period}`, date: end, period: c.period, label: periodLabel(p), sentAt: c.sentAt })
  }

  // Kaution nach Auszug
  for (const d of depositsAfterMoveOut(input.tenancies, input.deposits, today)) {
    items.push({ kind: 'deposit', id: `deposit:${d.tenancyId}`, date: d.end, tenancyId: d.tenancyId, tenantName: d.tenantName, balanceCents: d.balanceCents })
  }

  // Eichfrist
  const calibrationUntil = shiftMonths(today, CALIBRATION_LEAD_MONTHS)
  const graceFrom = shiftMonths(today, -CALIBRATION_GRACE_MONTHS)
  for (const m of input.meters) {
    if (m.calibratedUntil === null || m.calibratedUntil === undefined) continue
    const end = `${m.calibratedUntil}-12-31`
    if (compareText(end, calibrationUntil) > 0) continue
    if (compareText(end, today) < 0) {
      const readAfter = input.readings.some((r) => r.meterId === m.id && compareText(r.date, end) > 0)
      if (!readAfter && compareText(end, graceFrom) < 0) continue
    }
    items.push({ kind: 'calibration', id: `calibration:${m.id}`, date: end, meterId: m.id, meterName: m.name })
  }

  rentItems(input, today, until, items)

  items.sort((a, b) => compareText(a.date, b.date) || compareText(a.kind, b.kind) || compareText(a.id, b.id))
  return { today, until, items }
}

const monthOf = (day: string): string => day.slice(0, 7)

// Mieterhöhung (siehe Kopf).
function rentItems(input: UpcomingInput, today: string, until: string, items: UpcomingDeadline[]): void {
  for (const t of input.tenancies) {
    if (t.end !== null && compareText(t.end, today) < 0) continue
    const unit = input.units.find((u) => u.id === t.unitId)
    if (!unit) continue
    const increases = input.rentIncreases.filter((x) => x.tenancyId === t.id)
    const events = nextRentEvents({ today, tenancy: t, state: input.state, increases })
    const who = { tenancyId: t.id, unitName: unit.name, tenantName: t.tenantName }
    // Möglich ist eine Erhöhung nur mit Wohnfläche und solange das Mietverhältnis bis zum Wirksamwerden läuft.
    const runsUntil = (month: string): boolean => unit.areaM2 > 0 && (t.end === null || compareText(t.end, `${month}-01`) >= 0)

    const step = events.nextStep
    if (step && (t.rentKind === 'staggered' || step.reason === 'staggered')) {
      const date = `${step.from}-01`
      const after = events.earliest
      const comparisonFrom = step.last && t.rentIncreaseExcluded === false && after?.kind === 'comparison' && runsUntil(after.effectiveFrom) ? after.receivedOn : null
      if (compareText(date, until) <= 0 && (t.end === null || compareText(t.end, date) >= 0)) {
        items.push({ kind: 'rentStep', id: `rentStep:${t.id}:${step.from}`, date, ...who, fromCents: step.previousCents, cents: step.cents, last: step.last, comparisonFrom })
      }
    }

    const e = events.earliest
    const pending = increases.some((x) => isOpen(x) || (x.status !== 'draft' && x.status !== 'refused' && x.status !== 'withdrawn' && compareText(x.effectiveFrom, monthOf(today)) > 0))
    const afterModernization = e?.kind === 'index' && [...t.baseRents].sort((a, b) => compareText(a.from, b.from)).at(-1)?.reason === 'modernization'
    if (e && !pending && !afterModernization && compareText(e.receivedOn, until) <= 0 && runsUntil(e.effectiveFrom)) {
      items.push({ kind: 'rentIncrease', id: `rentIncrease:${t.id}`, date: e.receivedOn, ...who, increaseKind: e.kind, effectiveFrom: e.effectiveFrom, exclusionOpen: t.rentIncreaseExcluded == null })
    }

    for (const o of events.open) {
      const x = increases.find((i) => i.id === o.id)
      if (!x?.receivedOn) continue
      const stage = compareText(today, o.consentEndOnWorkday) <= 0 ? 'running' : compareText(today, o.suitEnd) <= 0 ? 'suit' : 'lapsed'
      items.push({
        kind: 'rentConsent', id: `rentConsent:${o.id}`, date: stage === 'running' ? o.consentEnd : o.suitEnd, ...who, increaseId: o.id, stage,
        receivedOn: x.receivedOn, consentEnd: o.consentEnd, suitEnd: o.suitEnd,
      })
    }
  }
}

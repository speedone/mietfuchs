// Invariante der Mieterhöhung (#191, Integrationsdurchsicht): zufällige Folgen von Verlangen je Mietverhältnis mit
// festem Startwert, rein über die Funktionen, die auch die Routen in index.ts zusammensetzen (planRentIncrease,
// buildBasis/draftOf, sendRequest/sendProblem/sentOf, decisionProblem/decided, stepOf/withStep/withoutStep). Je
// Mietverhältnis Vergleichs- oder Indexmiete; Antwort zugestimmt, teilweise, abgelehnt oder zurückgenommen, dazu
// Rücknahmen früherer Verlangen und gelegentlich ein Auszug vor dem Wirksamwerden. Der Tag rückt je Runde um 12 bis 15
// Monate vor. Nach jedem Schritt:
//
// 1. Staffel = Anfangsmiete plus die Stufen aller Verlangen mit geschriebener Stufe, keine anderen.
// 2. Für jedes solche Verlangen ist `fromCents` die Stufe des Vormonats von `effectiveFrom`.
// 3. Das Soll der Kaltmiete im Mietkonto ist je Monat die Stufe der Staffel (anteilig im Ein- und Auszugsmonat), die
//    Jahressumme im Mietkonto passt.
// 4. Ein möglicher Plan nach § 558: verlangte Miete ≤ Kappungsgrenze, und deren Ausgangsmiete ist die Stufe am Stichtag.
// 5. Erscheint im Cockpit („Demnächst fällig“, upcomingDeadlines) der früheste Zugang (`rentIncrease`), nennt er dasselbe
//    Datum wie `plan.earliestReceivedOn` der Rechnung bei Zugang an diesem Tag (#190).
//
// Mehr Startwerte mit INV_FROM und INV_TO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Property, RentEntry, RentIncrease, RentIncreaseDecision, RentIncreaseLetterInput, RentIncreasePlan, RentIncreaseRequest, Settings, Tenancy, Unit } from '../../shared/types.ts'
import { planRentIncrease } from '../src/rentIncrease.ts'
import {
  buildBasis, decided, decisionProblem, draftOf, draftProblem, RentIncreaseError, sendProblem, sendRequest, sentOf, stepOf, stepWritten, withoutStep, withStep, writesStep,
} from '../src/rentIncreaseSave.ts'
import { monthSoll } from '../../shared/monthRate.ts'
import { rentLedger } from '../src/calc.ts'
import { snapshotOf, type SnapshotSource } from '../src/snapshot.ts'
import { makeRng } from '../testing/rentStock.ts'
import { upcomingDeadlines, type UpcomingInput } from '../src/upcomingDeadlines.ts'
import { CALENDAR_RULES } from '../../shared/period.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 80)

const pad = (n: number): string => String(n).padStart(2, '0')
const addMonths = (month: string, n: number): string => {
  const k = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n
  return `${Math.floor(k / 12)}-${pad((k % 12) + 1)}`
}
const lastDay = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
const dayIn = (month: string, day: number): string => `${month}-${pad(Math.min(day, lastDay(month)))}`
const later = (a: string, b: string): string => (a > b ? a : b)

const unit: Pick<Unit, 'name' | 'areaM2'> = { name: 'EG', areaM2: 62.5 }
const property: Property = { id: 'objekt-1', name: 'Haus', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', landlordName: null, iban: null, paymentDeadlineDays: null, rentCapReduced: false, state: 'BY', tightMarket: null }
const settings: Pick<Settings, 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'landlordAddress' | 'landlordContact'> = { landlordName: 'Vera Vermieterin', iban: '', paymentDeadlineDays: 14, landlordAddress: 'Lindenweg 1, 12345 Musterstadt', landlordContact: '' }
const COMPARABLES: RentIncreaseLetterInput = {
  justification: 'comparables', survey: null, expert: null, database: null,
  comparables: [
    { address: 'Ahornweg 3, 12345 Musterstadt', location: '1. OG links', areaM2: 58, centsPerM2: 1020 },
    { address: 'Ahornweg 5, 12345 Musterstadt', location: 'EG rechts', areaM2: 62, centsPerM2: 1010 },
    { address: 'Birkenstraße 8, 12345 Musterstadt', location: '2. OG Mitte', areaM2: 60, centsPerM2: 1050 },
  ],
  qualifiedSurvey: 'no', qualified: null, recipientName: 'Anna Becker', severalLandlords: false, allLandlordsNamed: true, allTenantsNamed: true, extraParagraph: '',
}
const INDEX_LETTER: RentIncreaseLetterInput = { ...COMPARABLES, justification: null, comparables: [], qualifiedSurvey: null }
const confirmed = { allStepsEntered: true, residential: true, noThirdPartyFunds: true } as const

const byFrom = (rents: readonly RentEntry[]): RentEntry[] => [...rents].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
const stepAt = (rents: readonly RentEntry[], month: string): RentEntry | undefined => byFrom(rents).filter((r) => r.from <= month).at(-1)

type Case = { tenancy: Tenancy; increases: RentIncrease[]; initial: RentEntry; log: string[] }

// Die Antwort wie die Route POST /api/rent-increases/:id/status: Rücknahme nimmt die Stufe heraus, Zustimmung schreibt sie.
function answer(c: Case, x: RentIncrease, decision: RentIncreaseDecision, agreedCents: number | null, decidedOn: string): string | null {
  const problem = decisionProblem(x, decision, agreedCents, decidedOn, decidedOn, c.tenancy.end)
  if (problem) return problem
  const next = decided(x, decision, agreedCents, decidedOn)
  let rents: readonly RentEntry[] = c.tenancy.baseRents
  if (decision === 'withdrawn' && stepWritten(x)) rents = withoutStep(rents, stepOf(x)) ?? rents
  else if (writesStep(x.status, next.status, next.kind)) rents = withStep(rents, stepOf(next))
  c.tenancy = { ...c.tenancy, baseRents: [...rents] }
  c.increases = c.increases.map((y) => (y.id === x.id ? next : y))
  return null
}

function check(c: Case, today: string, at: string): void {
  const t = c.tenancy
  const where = `${at}\n${c.log.join('\n')}`
  // (1) Staffel = Anfangsmiete + Stufen der Verlangen mit geschriebener Stufe.
  const expected = byFrom([c.initial, ...c.increases.filter(stepWritten).map(stepOf)])
  assert.deepEqual(byFrom(t.baseRents), expected, `(1) Staffel ${where}`)
  // (2) fromCents = Stufe des Vormonats.
  for (const x of c.increases.filter(stepWritten)) {
    assert.equal(x.fromCents, stepAt(t.baseRents, addMonths(x.effectiveFrom, -1))?.monthlyCents, `(2) bisherige Miete von ${x.id} ${where}`)
  }
  // (3) Soll der Kaltmiete je Monat und im Jahr.
  const startMonth = t.start.slice(0, 7)
  const lastMonth = t.end ? t.end.slice(0, 7) : `${Number(today.slice(0, 4)) + 1}-12`
  const perYear = new Map<number, number>()
  for (let m = startMonth; m <= lastMonth; m = addMonths(m, 1)) {
    const step = stepAt(t.baseRents, m)?.monthlyCents ?? 0
    const first = m === startMonth ? Number(t.start.slice(8)) : 1
    const last = t.end && m === t.end.slice(0, 7) ? Number(t.end.slice(8)) : lastDay(m)
    const days = last - first + 1
    const want = days >= lastDay(m) ? step : Math.round(step * days / lastDay(m))
    assert.equal(monthSoll(t, m).baseRent, want, `(3) Soll ${m} ${where}`)
    const y = Number(m.slice(0, 4))
    perYear.set(y, (perYear.get(y) ?? 0) + want)
  }
  const source: SnapshotSource = { units: [{ id: t.unitId, name: unit.name, areaM2: unit.areaM2, participates: true }], tenancies: [t], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [] }
  for (const [year, sum] of perYear) {
    const row = rentLedger(snapshotOf(source, year)).rows.find((r) => r.tenancyId === t.id)
    assert.equal(row?.baseRentYearCents ?? 0, sum, `(3) Jahressumme ${year} ${where}`)
  }
}

// (4) Kappungsgrenze eines möglichen Plans nach § 558.
function checkCap(c: Case, p: RentIncreasePlan, at: string): void {
  if (p.kind !== 'comparison' || p.state !== 'possible') return
  const cap = p.cap ?? assert.fail(`(4) Plan ohne Kappungsgrenze ${at}`)
  assert.ok(p.newCents !== null && p.newCents <= cap.limitCents, `(4) ${p.newCents} > Kappungsgrenze ${cap.limitCents} ${at}`)
  if (cap.baseSource === 'schedule') assert.equal(cap.baseCents, stepAt(c.tenancy.baseRents, cap.baseDay.slice(0, 7))?.monthlyCents, `(4) Ausgangsmiete am ${cap.baseDay} ${at}`)
}

// (5) Cockpit und Rechnung nennen denselben frühesten Zugang.
function checkCockpit(c: Case, today: string, at: string): boolean {
  const input: UpcomingInput = {
    rules: CALENDAR_RULES, tenancies: [c.tenancy], costPeriods: new Set(), closed: [], meters: [], readings: [], deposits: [],
    units: [{ id: c.tenancy.unitId, name: unit.name, areaM2: unit.areaM2 }], state: property.state ?? null, rentIncreases: c.increases,
  }
  const entry = upcomingDeadlines(input, today).items.find((i) => i.kind === 'rentIncrease' && i.tenancyId === c.tenancy.id)
  if (!entry || entry.kind !== 'rentIncrease') return false
  const kind = entry.increaseKind
  const p = planRentIncrease({ today, tenancy: c.tenancy, unit, property, request: { kind, ...confirmed, receivedOn: entry.date } })
  assert.equal(p.earliestReceivedOn, entry.date, `(5) Cockpit ${entry.date}, Rechnung ${p.earliestReceivedOn} ${at}\n${c.log.join('\n')}`)
  return true
}

function runCase(seed: number): { written: number; refusedWithdrawals: number; endedRefusals: number; cockpit: number } {
  const rnd = makeRng(seed * 31 + 7)
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
  const kind: 'comparison' | 'index' = rnd() < 0.5 ? 'comparison' : 'index'
  const startMonth = `${int(2015, 2021)}-${pad(int(1, 12))}`
  const start = dayIn(startMonth, rnd() < 0.5 ? 1 : int(2, 28))
  const initial: RentEntry = kind === 'index'
    ? { from: startMonth, monthlyCents: int(40000, 90000), index: { month: addMonths(startMonth, -2), value: int(950, 1050) / 10, base: 2020 } }
    : { from: startMonth, monthlyCents: int(40000, 90000) }
  const c: Case = {
    initial,
    increases: [],
    log: [`Startwert ${seed}, ${kind}, Beginn ${start}, ${initial.monthlyCents}`],
    tenancy: {
      id: `t${seed}`, unitId: 'w', tenantName: 'Becker', persons: 1, personHistory: [], start, end: null,
      prepayments: [], prepaymentOverrides: {}, baseRents: [initial],
      rentKind: kind === 'index' ? 'index' : 'free', rentIncreaseExcluded: false, costModel: 'settlement', heatingModel: 'settlement',
    },
  }
  let today = dayIn(addMonths(startMonth, int(12, 15)), int(2, 28))
  const stats = { written: 0, refusedWithdrawals: 0, endedRefusals: 0, cockpit: 0 }
  for (let round = 0; round < 6 && today < '2036-01-01' && (c.tenancy.end === null || today < c.tenancy.end); round++) {
    if (checkCockpit(c, today, `Runde ${round} am ${today}, Cockpit`)) stats.cockpit++
    const current = stepAt(c.tenancy.baseRents, today.slice(0, 7)) ?? c.initial
    const request = (receivedOn: string): RentIncreaseRequest => {
      if (kind === 'index') {
        const from = current.index?.value ?? 100
        return { kind, ...confirmed, receivedOn, toIndex: { month: addMonths(receivedOn.slice(0, 7), -1), value: Math.round(from * 10 * (1 + int(1, 120) / 1000)) / 10, base: 2020 } }
      }
      return { kind, ...confirmed, receivedOn, rentCap: rnd() < 0.5 ? 'no' : 'yes', comparisonCentsPerM2: Math.ceil(current.monthlyCents * (1 + int(-5, 40) / 100) / unit.areaM2) }
    }
    let req = request(today)
    let plan = planRentIncrease({ today, tenancy: c.tenancy, unit, property, request: req })
    if (plan.state === 'notYet' && plan.earliestReceivedOn !== null && plan.earliestReceivedOn > today) {
      today = plan.earliestReceivedOn
      req = request(today)
      plan = planRentIncrease({ today, tenancy: c.tenancy, unit, property, request: req })
    }
    const at = `Runde ${round} am ${today}`
    checkCap(c, plan, at)
    if (plan.state !== 'possible') {
      c.log.push(`${at}: ${plan.state}`)
      today = dayIn(addMonths(today.slice(0, 7), int(12, 15)), int(2, 28))
      continue
    }
    // Teilweise verlangt (§ 558) oder der Höchstbetrag.
    if (kind === 'comparison' && plan.maxCents !== null && plan.currentCents !== null && rnd() < 0.3) {
      req = { ...req, requestedCents: int(plan.currentCents + 1, plan.maxCents) }
      plan = planRentIncrease({ today, tenancy: c.tenancy, unit, property, request: req })
      checkCap(c, plan, `${at}, verlangt ${req.requestedCents}`)
    }
    assert.equal(draftProblem(plan), null, `${at}: ${plan.reasons.join(' ')}`)
    const basis = buildBasis({ today, request: req, plan, letter: kind === 'index' ? INDEX_LETTER : COMPARABLES, tenancy: c.tenancy, unit, property, settings })
    const draft = draftOf({ id: `${seed}-${round}`, tenancyId: c.tenancy.id, today, basis })
    c.increases.push(draft)
    c.log.push(`${at}: Entwurf ${draft.id} ab ${draft.effectiveFrom}, ${draft.fromCents} → ${draft.toCents}`)
    check(c, today, `${at}, Entwurf`)

    // Versand am selben Tag, wie die Route.
    const sentPlan = planRentIncrease({ today, tenancy: c.tenancy, unit, property, request: sendRequest(draft, today) })
    const problem = sendProblem(draft, sentPlan, today, today)
    assert.equal(problem, null, `${at}: Versand ${problem?.message ?? ''}`)
    const sent = sentOf(draft, sentPlan, today)
    if (writesStep(draft.status, sent.status, sent.kind)) c.tenancy = { ...c.tenancy, baseRents: withStep(c.tenancy.baseRents, stepOf(sent)) }
    c.increases = c.increases.map((y) => (y.id === sent.id ? sent : y))
    check(c, today, `${at}, versandt`)

    // Gelegentlich kündigt der Mieter, und das Mietverhältnis endet vor dem Wirksamwerden.
    if (kind === 'comparison' && rnd() < 0.08) {
      c.tenancy = { ...c.tenancy, end: dayIn(addMonths(sent.effectiveFrom, -1), 28) }
      c.log.push(`${at}: Auszug ${c.tenancy.end}`)
      const p = decisionProblem(sent, 'agreed', null, today, today, c.tenancy.end)
      assert.ok(p !== null && /endet am/.test(p), `${at}: Zustimmung trotz Auszug vor dem Wirksamwerden`)
      stats.endedRefusals++
      assert.equal(answer(c, sent, 'refused', null, today), null)
      check(c, today, `${at}, Auszug`)
      break
    }

    const decidedOn = today
    if (kind === 'comparison') {
      const r = rnd()
      const decision: RentIncreaseDecision = r < 0.45 ? 'agreed' : r < 0.65 ? 'partial' : r < 0.85 ? 'refused' : 'withdrawn'
      const agreedCents = decision === 'partial' ? (sent.toCents - sent.fromCents > 1 ? int(sent.fromCents + 1, sent.toCents - 1) : sent.toCents) : null
      assert.equal(answer(c, sent, decision, agreedCents, decidedOn), null, `${at}: ${decision}`)
      c.log.push(`${at}: ${decision}${agreedCents !== null ? ` ${agreedCents}` : ''}`)
    } else if (rnd() < 0.15) {
      assert.equal(answer(c, sent, 'withdrawn', null, decidedOn), null, `${at}: Rücknahme der Indexanpassung`)
      c.log.push(`${at}: Indexanpassung zurückgenommen`)
    }
    if (stepWritten(c.increases.at(-1) ?? sent)) stats.written++
    check(c, today, `${at}, Antwort`)

    // Rücknahme eines früheren Verlangens: abgelehnt, wenn eine spätere Stufe darauf aufbaut, sonst wie jede Rücknahme.
    const earlier = c.increases.filter((x) => x.id !== sent.id && stepWritten(x))
    const pick = earlier[int(0, earlier.length - 1)]
    if (pick && rnd() < 0.3) {
      const before = c.tenancy.baseRents
      const hasLater = c.tenancy.baseRents.some((r) => r.from > pick.effectiveFrom)
      try {
        assert.equal(answer(c, pick, 'withdrawn', null, decidedOn), null)
        assert.ok(!hasLater, `${at}: Rücknahme von ${pick.id} trotz späterer Stufe`)
        c.log.push(`${at}: ${pick.id} zurückgenommen`)
      } catch (err) {
        if (!(err instanceof RentIncreaseError)) throw err
        assert.equal(err.status, 409)
        assert.ok(hasLater, `${at}: Rücknahme von ${pick.id} ohne spätere Stufe abgelehnt: ${err.message}`)
        assert.equal(c.tenancy.baseRents, before, `${at}: Staffel unverändert`)
        stats.refusedWithdrawals++
        c.log.push(`${at}: Rücknahme von ${pick.id} abgelehnt`)
      }
      check(c, today, `${at}, frühere Rücknahme`)
    }
    today = dayIn(addMonths(later(today, `${sent.effectiveFrom}-01`).slice(0, 7), int(12, 15)), int(2, 28))
  }
  return stats
}

test('Invariante Mieterhöhung: Staffel, bisherige Miete, Soll im Mietkonto, Kappungsgrenze und Cockpit nach jeder Antwort', () => {
  const total = { written: 0, refusedWithdrawals: 0, endedRefusals: 0, cockpit: 0 }
  for (let seed = FROM; seed <= TO; seed++) {
    const s = runCase(seed)
    total.written += s.written
    total.refusedWithdrawals += s.refusedWithdrawals
    total.endedRefusals += s.endedRefusals
    total.cockpit += s.cockpit
  }
  // Die Folgen erreichen die schiefen Fälle wirklich.
  if (FROM === 1 && TO >= 80) {
    assert.ok(total.written >= 150, `nur ${total.written} geschriebene Stufen`)
    assert.ok(total.refusedWithdrawals >= 20, `nur ${total.refusedWithdrawals} abgelehnte Rücknahmen`)
    assert.ok(total.endedRefusals >= 3, `nur ${total.endedRefusals} Auszüge vor dem Wirksamwerden`)
    assert.ok(total.cockpit >= 100, `nur ${total.cockpit} Einträge im Cockpit`)
  }
})

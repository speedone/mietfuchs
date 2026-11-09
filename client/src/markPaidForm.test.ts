import { describe, expect, it } from 'vitest'
import type { MarkPaidPlan, RentLedgerRow } from './types'
import { fmtEuro } from './api'
import { ALL_TENANCIES, affectedText, createdText, emptyPlanText, markPaidBlocked, markPaidRequest, markPaidStart, markPaidTenancyOptions, unresolvedText } from './markPaidForm'

const row = (tenancyId: string, tenantName: string, unitName: string): RentLedgerRow => ({
  tenancyId, tenantName, unitName, months: [],
  sollYearCents: 0, baseRentYearCents: 0, prepaymentYearCents: 0, flatRateYearCents: 0, paidYearCents: 0, settlementYearCents: 0,
  balanceCents: 0, dueSollCents: 0, arrearsCents: 0, notDemandableCents: 0, notDemandable: [], openMonths: 0, openingBalanceCents: 0, closingBalanceCents: 0,
})
const ROWS = [row('t1', 'Albers', 'EG'), row('t2', 'Brandt', 'OG')]
const plan = (over: Partial<MarkPaidPlan> = {}): MarkPaidPlan => ({ payments: [], totalCents: 0, unresolved: [], othersAffected: [], token: 'x', ...over })
const heute = new Date(2026, 10, 8)

describe('Monate als bezahlt erfassen (#608): Formularlogik', () => {
  it('Auswahl: alle Mietverhältnisse und jede Zeile des Mietkontos', () => {
    expect(markPaidTenancyOptions(ROWS)).toEqual([
      { value: ALL_TENANCIES, label: 'Alle Mietverhältnisse' },
      { value: 't1', label: 'Albers · EG' },
      { value: 't2', label: 'Brandt · OG' },
    ])
  })
  it('Vorgabe: alle, im laufenden Jahr bis zum aktuellen Monat, in früheren bis Dezember', () => {
    expect(markPaidStart(2026, heute, ROWS)).toEqual({ tenancyId: ALL_TENANCIES, through: '2026-11' })
    expect(markPaidStart(2025, heute, ROWS)).toEqual({ tenancyId: ALL_TENANCIES, through: '2025-12' })
  })
  it('Vorgabe (Durchsicht S2): ist der laufende Monat noch nicht fällig, der Vormonat', () => {
    const notDue = { ...row('t3', 'Celik', 'DG'), months: [
      ...Array.from({ length: 10 }, (_, i) => ({ month: i + 1, baseRentCents: 80000, prepaymentCents: 0, flatRateCents: 0, sollCents: 80000, paidCents: 80000, status: 'paid' as const, openPrepaymentCents: 0, openRentCents: 0 })),
      { month: 11, baseRentCents: 80000, prepaymentCents: 0, flatRateCents: 0, sollCents: 80000, paidCents: 0, status: 'notDue' as const, openPrepaymentCents: 0, openRentCents: 80000, dueOn: '2026-11-04' },
    ] }
    expect(markPaidStart(2026, new Date(2026, 10, 2), [...ROWS, notDue]).through).toBe('2026-10')
  })
  it('gesperrt ohne Mietverhältnis im Jahr und in einem künftigen Jahr, mit Grund', () => {
    expect(markPaidBlocked(ROWS, 2026, heute)).toBeNull()
    expect(markPaidBlocked([], 2026, heute)).toBe('Für 2026 gibt es keine Mietverhältnisse.')
    expect(markPaidBlocked(ROWS, 2027, heute)).toBe('Im Jahr 2027 ist noch kein Monat vergangen.')
  })
  it('Anfrage: alle oder eines, Monat aus dem Monatsfeld; Meldung am Feld, wenn er nicht passt', () => {
    expect(markPaidRequest({ tenancyId: ALL_TENANCIES, through: '2026-03' }, ROWS, 2026, heute)).toEqual({ body: { tenancyIds: ['t1', 't2'], through: '2026-03' } })
    expect(markPaidRequest({ tenancyId: 't2', through: 'März 2026' }, ROWS, 2026, heute)).toEqual({ body: { tenancyIds: ['t2'], through: '2026-03' } })
    const field = (through: string) => {
      const r = markPaidRequest({ tenancyId: ALL_TENANCIES, through }, ROWS, 2026, heute)
      return 'problems' in r ? r.problems.map((p) => [p.field, p.text]) : []
    }
    expect(field('')).toEqual([['through', 'Bis Monat: Geben Sie den Monat ein, bis zu dem die Mieten eingegangen sind, etwa „3.2026“.']])
    expect(field('2025-12')).toEqual([['through', 'Bis Monat: Wählen Sie einen Monat im Jahr 2026.']])
    expect(field('2026-12')).toEqual([['through', 'Bis Monat: Künftige Monate lassen sich nicht als bezahlt erfassen; wählen Sie höchstens November 2026.']])
    expect(field('1.10')[0]?.[0]).toBe('through')
    // Ein Mietverhältnis, das nicht in der Auswahl steht: Der Browser zeigte sonst den ersten Eintrag.
    const gone = markPaidRequest({ tenancyId: 'weg', through: '2026-03' }, ROWS, 2026, heute)
    expect('problems' in gone && gone.problems[0]?.field).toBe('tenancyId')
  })
  it('Sätze: leerer Plan, betroffene Mietverhältnisse, nicht gedeckte Monate, Mitteilung', () => {
    expect(emptyPlanText('2026-03')).toBe('Bis März 2026 ist nichts offen.')
    expect(affectedText(plan())).toBeNull()
    expect(affectedText(plan({ othersAffected: [
      { tenancyId: 't2', tenantName: 'Brandt', unitName: 'OG', year: 2026, reason: 'recordingStart', beforeCents: 0, afterCents: 160000 },
      { tenancyId: 't1', tenantName: 'Albers', unitName: 'EG', year: 2026, reason: 'shifted', beforeCents: 80000, afterCents: 20000 },
    ] }))).toBe(
      'Danach ändert sich das Mietkonto auch außerhalb der geplanten Monate: '
      + `Brandt (OG), ${'2026'}: Bisher nicht erfasste Monate zählen mit, weil das Mietkonto des Objekts mit der frühesten erfassten Mietzahlung beginnt; Rückstand bisher ${fmtEuro(0)}, danach ${fmtEuro(160000)}. `
      + `Albers (EG), 2026: Vorhandene Zahlungen tilgen andere Monate als bisher (§ 366 BGB); Rückstand bisher ${fmtEuro(80000)}, danach ${fmtEuro(20000)}. `
      + 'Prüfen Sie diese Mietverhältnisse, oder erfassen Sie ihre Monate mit.')
    expect(unresolvedText(plan())).toBeNull()
    expect(unresolvedText(plan({ unresolved: [{ tenancyId: 't1', tenantName: 'Albers', unitName: 'EG', month: '2026-02', status: 'partial', openCents: 20000 }] }))).toBe(
      `Nicht ganz gedeckt bleibt danach: Albers, Februar 2026 (noch ${fmtEuro(20000)} offen). Eine Zahlung ohne Monat im Verwendungszweck tilgt dann eine ältere Forderung (§ 366 BGB); prüfen Sie die Zahlungen dieses Mietverhältnisses.`)
    expect(createdText(1)).toBe('Eine Zahlung angelegt.')
    expect(createdText(12)).toBe('12 Zahlungen angelegt.')
  })
})

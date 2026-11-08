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
    expect(markPaidStart(2026, heute)).toEqual({ tenancyId: ALL_TENANCIES, through: '2026-11' })
    expect(markPaidStart(2025, heute)).toEqual({ tenancyId: ALL_TENANCIES, through: '2025-12' })
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
    expect(affectedText(plan({ othersAffected: [{ tenancyId: 't2', tenantName: 'Brandt', unitName: 'OG', beforeCents: 0, afterCents: 160000 }] }))).toBe(
      'Das Mietkonto des Objekts beginnt mit der frühesten erfassten Mietzahlung. Mit diesen Zahlungen beginnt es früher, und Monate, die bisher nicht erfasst waren, zählen dann mit: '
      + `Brandt (OG): Rückstand bisher ${fmtEuro(0)}, danach ${fmtEuro(160000)}. Erfassen Sie die Zahlungen dieser Monate, oder wählen Sie die Mietverhältnisse mit.`)
    expect(unresolvedText(plan())).toBeNull()
    expect(unresolvedText(plan({ unresolved: [{ tenancyId: 't1', tenantName: 'Albers', unitName: 'EG', month: '2026-02', status: 'partial', openCents: 20000 }] }))).toBe(
      `Nicht ganz gedeckt bleibt danach: Albers, Februar 2026 (noch ${fmtEuro(20000)} offen). Eine Zahlung ohne Monat im Verwendungszweck tilgt dann eine ältere Forderung (§ 366 BGB); prüfen Sie die Zahlungen dieses Mietverhältnisses.`)
    expect(createdText(1)).toBe('Eine Zahlung angelegt.')
    expect(createdText(12)).toBe('12 Zahlungen angelegt.')
  })
})

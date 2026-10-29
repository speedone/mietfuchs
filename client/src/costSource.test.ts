import { describe, expect, it } from 'vitest'
import { calendarPeriod } from '../../shared/period.ts'
import type { CostItem } from './types'
import { sourceLabel, sourceLabels, sourceSummary } from './costSource'

const item = (id: string, extra: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'p1', period: calendarPeriod(2025), category: 'Grundsteuer', description: `Position ${id}`, amountCents: 10000, key: 'area', ...extra,
})

describe('Teil einer aufgeteilten Rechnung (#455)', () => {
  const t1 = item('t1', { amountCents: 12000, sourceId: 'q1' })
  const t2 = item('t2', { period: calendarPeriod(2026), amountCents: 24500, sourceId: 'q1' })
  const fremd = item('x', { amountCents: 5000, sourceId: 'q2' })
  const ohne = item('o')

  it('Teil von 2, Rechnung gesamt 365,00 €, über die Zeiträume hinweg', () => {
    expect(sourceSummary(t1, [t1, t2, fremd, ohne])).toEqual({ parts: 2, totalCents: 36500 })
    expect(sourceSummary(t2, [t1, t2, fremd, ohne])).toEqual({ parts: 2, totalCents: 36500 })
    expect(sourceLabel(t1, [t1, t2, fremd, ohne])?.replace(/ /g, ' ')).toBe('Teil von 2 · Rechnung gesamt 365,00 €')
  })

  it('ohne Quelle oder mit nur einem verbliebenen Teil steht nichts', () => {
    expect(sourceSummary(ohne, [t1, t2, ohne])).toBeNull()
    expect(sourceSummary(fremd, [t1, t2, fremd])).toBeNull()
    expect(sourceLabel(fremd, [fremd])).toBeNull()
  })

  // Durchsicht von Task 8 (M2): Die Kostenliste rechnet die Sätze einmal für alle Zeilen, nicht je Zeile über alle.
  it('sourceLabels: je Teil derselbe Satz wie sourceLabel, Positionen ohne Satz fehlen', () => {
    const all = [t1, t2, fremd, ohne]
    const labels = sourceLabels(all)
    expect([...labels.keys()]).toEqual(['t1', 't2'])
    for (const c of all) expect(labels.get(c.id) ?? null).toBe(sourceLabel(c, all))
  })
})

import { describe, expect, test } from 'vitest'
import type { BillingPeriod, CostItem, Tenancy, Unit } from './types'
import { EMPTY_ITEM_FORM, buildCostItemBody, itemToForm, type ItemForm } from './costForm'
import { allowsContractAnswer, answerWhy, asksWhy, chooseWhy, untickedChoices, contractTenancies, notAgreedText, openWhy, unitTenancies, withNamed, withNotAgreed, withParticipant } from './contractAgreement'

const unit = (id: string, name: string, extra: Partial<Unit> = {}): Unit => ({ propertyId: 'objekt-1', id, name, areaM2: 50, participates: true, ...extra })
const UNITS = [unit('u1', 'EG links'), unit('u2', 'OG')]
const tenancy = (id: string, unitId: string, tenantName: string, start: string, end: string | null): Tenancy => ({
  id, unitId, tenantName, persons: 1, personHistory: [], start, end, prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const PERIOD = { key: '2025-01', from: '2025-01-01', to: '2025-12-31' } as unknown as BillingPeriod
const TENANCIES = [
  tenancy('t1', 'u1', 'Anna Becker', '2024-01-01', null),
  tenancy('t2', 'u2', 'Jonas Hartmann', '2020-01-01', null),
  tenancy('t3', 'u2', 'Früher Mieter', '2010-01-01', '2019-12-31'),
]
const form = (patch: Partial<ItemForm> = {}): ItemForm => ({ ...EMPTY_ITEM_FORM, category: 'Aufzug', description: 'Aufzug', amount: '100,00', ...patch })

describe('Formularzustand', () => {
  test('neue Felder sind leer und itemToForm liest sie', () => {
    expect(EMPTY_ITEM_FORM.notAgreed).toEqual([])
    expect(EMPTY_ITEM_FORM.named).toEqual([])
    expect(EMPTY_ITEM_FORM.pendingWhy).toEqual([])
    const f = itemToForm({ propertyId: 'objekt-1', id: 'c1', period: '2025-01' as CostItem['period'], category: 'Aufzug', description: 'x', amountCents: 100, key: 'area', notAgreedTenancyIds: ['t1'], namedTenancyIds: ['t2'] })
    expect(f.notAgreed).toEqual(['t1'])
    expect(f.named).toEqual(['t2'])
    expect(f.pendingWhy).toEqual([])
  })
})

describe('contractTenancies', () => {
  test('ein Mietverhältnis außerhalb des Zeitraums fällt heraus', () => {
    const rows = contractTenancies(form(), UNITS, TENANCIES, PERIOD)
    expect(rows.map((r) => r.tenancyId)).toEqual(['t1', 't2'])
    expect(rows[0]).toEqual({ tenancyId: 't1', tenantName: 'Anna Becker', unitId: 'u1', unitName: 'EG links' })
  })
  test('nur Teilnehmer', () => {
    expect(contractTenancies(form({ participants: ['u2'] }), UNITS, TENANCIES, PERIOD).map((r) => r.tenancyId)).toEqual(['t2'])
  })
  test('Direktzuordnung: nur die Wohnung', () => {
    expect(contractTenancies(form({ key: 'direct', directUnitId: 'u1' }), UNITS, TENANCIES, PERIOD).map((r) => r.tenancyId)).toEqual(['t1'])
  })
  test('vereinbarte Anteile: nur Wohnungen mit Anteil', () => {
    expect(contractTenancies(form({ key: 'custom', customShares: { u2: '50' } }), UNITS, TENANCIES, PERIOD).map((r) => r.tenancyId)).toEqual(['t2'])
  })
})

describe('contractTenancies, Sonderfälle', () => {
  test('veraltete Teilnehmer bei einem Schlüssel ohne Teilnehmer zählen nicht', () => {
    expect(contractTenancies(form({ key: 'heatingSystem', participants: ['u2'] }), UNITS, TENANCIES, PERIOD).map((r) => r.tenancyId)).toEqual(['t1', 't2'])
  })
  test('Grenzen sind inklusive', () => {
    const edge = [tenancy('e1', 'u1', 'A', '2024-01-01', '2025-01-01'), tenancy('e2', 'u2', 'B', '2025-12-31', null), tenancy('e3', 'u2', 'C', '2026-01-01', null)]
    expect(contractTenancies(form(), UNITS, edge, PERIOD).map((r) => r.tenancyId)).toEqual(['e1', 'e2'])
  })
})

describe('allowsContractAnswer', () => {
  test('nicht bei Heizung, nicht umlagefähig, Rücklage', () => {
    expect(allowsContractAnswer('Heizung und Warmwasser')).toBe(false)
    expect(allowsContractAnswer('Nicht umlagefähig')).toBe(false)
    expect(allowsContractAnswer('Zuführung Erhaltungsrücklage')).toBe(false)
    expect(allowsContractAnswer('Aufzug')).toBe(true)
    expect(allowsContractAnswer('Sonstige Betriebskosten')).toBe(true)
  })
})

describe('answerWhy', () => {
  const pending = form({ participants: ['u2'], pendingWhy: ['u1'] })
  test('contract: Wohnung wieder Teilnehmer, Kennung in notAgreed, nicht mehr offen', () => {
    const f = answerWhy(pending, 'u1', 'contract', ['t1'])
    expect(f.participants).toEqual(['u2', 'u1'])
    expect(f.notAgreed).toEqual(['t1'])
    expect(f.pendingWhy).toEqual([])
  })
  test('contract nimmt die Kennung aus named', () => {
    expect(answerWhy({ ...pending, named: ['t1'] }, 'u1', 'contract', ['t1']).named).toEqual([])
  })
  test('notConcerned: nur aus pendingWhy', () => {
    const f = answerWhy(pending, 'u1', 'notConcerned', [])
    expect(f.participants).toEqual(['u2'])
    expect(f.notAgreed).toEqual([])
    expect(f.pendingWhy).toEqual([])
  })
})

describe('buildCostItemBody', () => {
  test('Abwählen ohne Antwort ergibt das Problem', () => {
    const r = buildCostItemBody(form({ participants: ['u2'], pendingWhy: ['u1'] }), UNITS, PERIOD, TENANCIES)
    expect('error' in r).toBe(true)
    if (!('problems' in r)) throw new Error('keine Probleme')
    expect(r.problems).toEqual([{ field: 'participants', short: 'Bitte wählen Sie, warum', text: 'Teilnehmer: Bitte wählen Sie bei EG links, warum sie diese Kosten nicht trägt.' }])
  })
  test('nach der Antwort contract ist u1 wieder Teilnehmer und die Kennung geht mit', () => {
    const f = answerWhy(form({ participants: ['u2'], pendingWhy: ['u1'] }), 'u1', 'contract', ['t1'])
    const r = buildCostItemBody(f, UNITS, PERIOD, TENANCIES)
    if (!('body' in r)) throw new Error('kein Rumpf')
    expect(r.body).toMatchObject({ notAgreedTenancyIds: ['t1'], namedTenancyIds: null, participantUnitIds: null })
  })
  test('leer wird null', () => {
    const r = buildCostItemBody(form(), UNITS, PERIOD, TENANCIES)
    if (!('body' in r)) throw new Error('kein Rumpf')
    expect(r.body).toMatchObject({ notAgreedTenancyIds: null, namedTenancyIds: null })
  })
  test('filtert auf Mietverhältnisse, die teilnehmen und im Zeitraum bestehen', () => {
    const r = buildCostItemBody(form({ participants: ['u1'], notAgreed: ['t1', 't2', 't3', 'fremd'], named: ['t2'] }), UNITS, PERIOD, TENANCIES)
    if (!('body' in r)) throw new Error('kein Rumpf')
    expect(r.body).toMatchObject({ notAgreedTenancyIds: ['t1'], namedTenancyIds: null })
  })
  test('Wechsel auf Heizung blockiert nicht mit einer offenen Frage', () => {
    const r = buildCostItemBody(form({ category: 'Heizung und Warmwasser', participants: ['u2'], pendingWhy: ['u1'] }), UNITS, PERIOD, TENANCIES)
    expect('body' in r).toBe(true)
  })
  test('Wechsel auf Heizung und Warmwasser sendet null für beide', () => {
    const r = buildCostItemBody(form({ category: 'Heizung und Warmwasser', key: 'area', notAgreed: ['t1'], named: ['t2'] }), UNITS, PERIOD, TENANCIES)
    if (!('body' in r)) throw new Error('kein Rumpf')
    expect(r.body).toMatchObject({ notAgreedTenancyIds: null, namedTenancyIds: null })
  })
  test('ohne Mietverhältnisse (Aufruf ohne Liste) keine Kennungen', () => {
    const r = buildCostItemBody(form({ notAgreed: ['t1'] }), UNITS, PERIOD)
    if (!('body' in r)) throw new Error('kein Rumpf')
    expect(r.body).toMatchObject({ notAgreedTenancyIds: null })
  })
})

describe('Seitenfenster (#258, Task 4)', () => {
  const BASIS = ['u1', 'u2']
  test('Abwählen einer vermieteten Wohnung fragt, Anhaken nimmt die Frage zurück', () => {
    const off = withParticipant(form(), 'u1', false, BASIS, UNITS, TENANCIES, PERIOD)
    expect(off.participants).toEqual(['u2'])
    expect(off.pendingWhy).toEqual(['u1'])
    const on = withParticipant(off, 'u1', true, BASIS, UNITS, TENANCIES, PERIOD)
    expect(on.participants).toEqual(['u2', 'u1'])
    expect(on.pendingWhy).toEqual([])
  })
  test('leerstehende Wohnung ohne Mietverhältnis im Zeitraum: keine Frage', () => {
    const units = [...UNITS, unit('u3', 'DG')]
    const off = withParticipant(form(), 'u3', false, ['u1', 'u2', 'u3'], units, TENANCIES, PERIOD)
    expect(off.pendingWhy).toEqual([])
  })
  test('Heizung fragt (nur mit der ersten Antwort), nicht umlagefähig und Rücklage nicht', () => {
    expect(withParticipant(form({ category: 'Heizung und Warmwasser' }), 'u1', false, BASIS, UNITS, TENANCIES, PERIOD).pendingWhy).toEqual(['u1'])
    expect(asksWhy('Nicht umlagefähig')).toBe(false)
    expect(asksWhy('Zuführung Erhaltungsrücklage')).toBe(false)
  })
  test('openWhy: nur Wohnungen, die noch abgewählt sind, und nur bei Teilnehmerschlüsseln', () => {
    expect(openWhy(form({ participants: ['u2'], pendingWhy: ['u1'] }))).toEqual(['u1'])
    expect(openWhy(form({ participants: ['u1', 'u2'], pendingWhy: ['u1'] }))).toEqual([])
    expect(openWhy(form({ key: 'direct', participants: ['u2'], pendingWhy: ['u1'] }))).toEqual([])
  })
  test('buildCostItemBody meldet keine Frage, die das Formular nicht mehr zeigt', () => {
    const built = buildCostItemBody(form({ key: 'direct', directUnitId: 'u2', participants: ['u2'], pendingWhy: ['u1'] }), UNITS, PERIOD, TENANCIES)
    expect('body' in built).toBe(true)
  })
  test('unitTenancies: die Mietverhältnisse der Wohnung im Zeitraum, auch wenn sie abgewählt ist', () => {
    expect(unitTenancies('u2', UNITS, TENANCIES, PERIOD).map((t) => t.tenancyId)).toEqual(['t2'])
  })
  test('withNotAgreed setzt und nimmt, und nimmt aus „genannt“', () => {
    const on = withNotAgreed(form({ named: ['t1'] }), 't1', true)
    expect(on.notAgreed).toEqual(['t1'])
    expect(on.named).toEqual([])
    expect(withNotAgreed(on, 't1', false).notAgreed).toEqual([])
  })
  test('withNamed: „Ja“ nach named, „Nein“ nach notAgreed, jeweils aus der anderen Liste', () => {
    const yes = withNamed(form({ notAgreed: ['t1'] }), 't1', true)
    expect(yes).toMatchObject({ named: ['t1'], notAgreed: [] })
    expect(withNamed(yes, 't1', false)).toMatchObject({ named: [], notAgreed: ['t1'] })
  })
  test('notAgreedText für die Liste der Positionen', () => {
    expect(notAgreedText(['t1', 't2'], TENANCIES)).toBe('trägt nicht: Anna Becker, Jonas Hartmann (Vertrag)')
    expect(notAgreedText([], TENANCIES)).toBeNull()
    expect(notAgreedText(null, TENANCIES)).toBeNull()
  })
})

describe('Fix-Runde 1: mehrere Mietverhältnisse einer Wohnung', () => {
  const TWO = [tenancy('t1', 'u1', 'Anna Becker', '2020-01-01', '2025-06-30'), tenancy('t4', 'u1', 'Lea Schneider', '2025-07-01', null), TENANCIES[1]]
  test('chooseWhy contract nimmt die Wohnung zurück, ohne Mieter vorzubelegen; notConcerned macht das rückgängig', () => {
    const c = chooseWhy(form({ participants: ['u2'], pendingWhy: ['u1'] }), 'u1', 'contract', UNITS, TWO, PERIOD)
    expect(c).toMatchObject({ participants: ['u2', 'u1'], notAgreed: [], pendingWhy: [] })
    const n = chooseWhy({ ...c, notAgreed: ['t1', 't2'] }, 'u1', 'notConcerned', UNITS, TWO, PERIOD)
    expect(n).toMatchObject({ participants: ['u2'], notAgreed: ['t2'], pendingWhy: [] })
  })
  test('untickedChoices: gewählt, aber niemand angehakt', () => {
    const f = form({ participants: ['u2', 'u1'] })
    expect(untickedChoices(f, ['u1'], UNITS, TWO, PERIOD)).toEqual([{ field: 'participants', short: 'Bitte haken Sie an, wer nicht trägt', text: 'Teilnehmer: Bitte haken Sie bei EG links an, in wessen Mietvertrag die Kosten nicht stehen.' }])
    expect(untickedChoices({ ...f, notAgreed: ['t4'] }, ['u1'], UNITS, TWO, PERIOD)).toEqual([])
    expect(untickedChoices(form({ participants: ['u2'] }), ['u1'], UNITS, TWO, PERIOD)).toEqual([])
  })
})

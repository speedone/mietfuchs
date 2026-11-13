// Formularlogik der Kautionsbuchungen (#228): der Rumpf einer Buchung, der Satz zum Stand, der Betrag mit Vorzeichen.
import { describe, expect, test } from 'vitest'
import { depositState } from '../../shared/deposit.ts'
import type { DepositEntry } from './types'
import { DEPOSIT_KIND_OPTIONS, DEPOSIT_PURPOSE_OPTIONS, depositEntryBody, depositPurposeHint, depositStateText, depositStatusLabel, emptyDepositForm, signedCents } from './depositForm'

// fmtEuro setzt ein geschütztes Leerzeichen vor das Eurozeichen; die Erwartungen stehen mit gewöhnlichem da.
const text = (...args: Parameters<typeof depositStateText>): string => depositStateText(...args).replace(/\u00a0/g, ' ')
let seq = 0
const entry = (kind: DepositEntry['kind'], amountCents: number): DepositEntry => ({
  id: `d${++seq}`, tenancyId: 't', date: '2025-03-01', kind, amountCents, ...(kind === 'applied' ? { purpose: 'damage' as const } : {}),
})

describe('Rumpf einer Buchung', () => {
  const form = { ...emptyDepositForm('2025-03-01'), amount: '2.400,00' }

  test('ein Eingang in deutscher und technischer Schreibweise', () => {
    expect(depositEntryBody(form, 't')).toEqual({ body: { tenancyId: 't', date: '2025-03-01', kind: 'received', amountCents: 240000, purpose: null, note: '' } })
    expect(depositEntryBody({ ...form, amount: '2400.5' }, 't')).toMatchObject({ body: { amountCents: 240050 } })
  })

  test('ohne Betrag, mit null oder negativ: Meldung am Feld Betrag', () => {
    for (const amount of ['', '0', '-5', 'viel']) {
      const result = depositEntryBody({ ...form, amount }, 't')
      if (!('problems' in result)) throw new Error(`„${amount}“ wurde angenommen`)
      expect(result.problems.map((p) => p.field)).toEqual(['amount'])
    }
    const empty = depositEntryBody({ ...form, amount: '' }, 't')
    expect('problems' in empty && empty.problems[0]?.short).toBe('Kein Betrag')
  })

  test('ohne Datum und ohne Betrag kommen beide Meldungen auf einmal', () => {
    const result = depositEntryBody({ ...form, date: '', amount: '' }, 't')
    expect('problems' in result && result.problems.map((p) => p.field)).toEqual(['date', 'amount'])
  })

  test('eine Verrechnung braucht den Zweck; bei anderer Art wird keiner gesendet', () => {
    const noPurpose = depositEntryBody({ ...form, kind: 'applied' }, 't')
    expect('problems' in noPurpose && noPurpose.problems.map((p) => p.field)).toEqual(['purpose'])
    expect(depositEntryBody({ ...form, kind: 'applied', purpose: 'damage', note: ' Tür ' }, 't')).toMatchObject({ body: { kind: 'applied', purpose: 'damage', note: 'Tür' } })
    expect(depositEntryBody({ ...form, kind: 'refunded', purpose: 'damage' }, 't')).toMatchObject({ body: { kind: 'refunded', purpose: null } })
  })

  test('die Optionen: vier Arten, vier Zwecke, Mietrückstand zuerst', () => {
    expect(DEPOSIT_KIND_OPTIONS.map((o) => o.label)).toEqual(['Eingang', 'Ertrag (Zinsen)', 'Verrechnung', 'Rückzahlung an den Mieter'])
    expect(DEPOSIT_PURPOSE_OPTIONS.map((o) => o.value)).toEqual(['rent', 'settlement', 'damage', 'other'])
  })

  test('der Satz unter dem Zweck sagt, was eine Verrechnung mit Miete oder Abrechnung anlegt', () => {
    expect(depositPurposeHint('rent')).toBe('Mietfuchs legt dazu im Mietkonto eine Mietzahlung an diesem Tag an; sie wird wie jede Mietzahlung auf die offenen Monate verteilt. Den Monat können Sie im Mietkonto bestimmen.')
    expect(depositPurposeHint('settlement')).toBe('Mietfuchs legt dazu im Mietkonto eine Zahlung aus der Abrechnung an diesem Tag an.')
    expect(depositPurposeHint('damage')).toBe('Nach dem Bundesfinanzhof ist eine einbehaltene Kaution eine Einnahme aus Vermietung (Urteil vom 11.07.2000, IX R 48/96). Die Steuerübersicht zählt sie nicht mit; tragen Sie sie selbst ein. Was Sie davon reparieren lassen, sind Werbungskosten.')
    expect(depositPurposeHint('')).toBeNull()
  })
})

describe('Satz zum Stand', () => {
  test('ohne Buchung gilt der Stand aus den Stammdaten', () => {
    expect(text(depositState({ depositCents: 240000, depositStatus: 'erhalten' }, []), { depositCents: 240000 }))
      .toBe('Noch keine Kautionsbuchung. Es gilt der Stand aus den Stammdaten: erhalten.')
  })

  test('teilweise eingegangen', () => {
    const t = { depositCents: 240000 }
    expect(text(depositState(t, [entry('received', 160000)]), t)).toBe('Vereinbart 2.400,00 €, eingegangen 1.600,00 €, bei Ihnen liegen 1.600,00 €.')
  })

  test('ohne vereinbarte Kaution und mit Ertrag', () => {
    expect(text(depositState({}, [entry('received', 100000), entry('interest', 1234)]), {})).toBe('Eingegangen 1.000,00 €, Erträge 12,34 €, bei Ihnen liegen 1.012,34 €.')
  })

  test('am Ende zurückgezahlt oder, mit Verrechnung, abgerechnet', () => {
    const t = { depositCents: 100000 }
    const refunded = depositState(t, [entry('received', 100000), entry('refunded', 100000)])
    expect(text(refunded, t)).toBe('Die Kaution ist zurückgezahlt: eingegangen 1.000,00 €, ausgezahlt 1.000,00 €.')
    expect(depositStatusLabel(refunded)).toBe('zurückgezahlt')
    const settled = depositState(t, [entry('received', 100000), entry('applied', 30000), entry('refunded', 70000)])
    expect(text(settled, t)).toBe('Die Kaution ist abgerechnet: eingegangen 1.000,00 €, verrechnet 300,00 €, ausgezahlt 700,00 €.')
    expect(depositStatusLabel(settled)).toBe('abgerechnet')
    expect(depositStatusLabel(depositState(t, [entry('received', 50000)]))).toBe('teilweise erhalten')
  })
})

test('Betrag mit Vorzeichen: Verrechnung und Rückzahlung mindern', () => {
  expect([entry('received', 100), entry('interest', 5), entry('applied', 30), entry('refunded', 70)].map(signedCents)).toEqual([100, 5, -30, -70])
})

test('Verrechnung vor dem Mietende: Hinweis nach BGH VIII ZR 234/13, nur für eine neue oder neu zur Verrechnung gewordene Buchung', async () => {
  const { appliedDuringTenancy } = await import('./depositForm')
  const body = { tenancyId: 't', date: '2026-03-01', kind: 'applied' as const, amountCents: 5000, purpose: 'damage' as const }
  expect(appliedDuringTenancy(body, null, null)).toBe(true)
  expect(appliedDuringTenancy(body, '2026-06-30', null)).toBe(true)
  expect(appliedDuringTenancy(body, '2026-02-28', null)).toBe(false)
  expect(appliedDuringTenancy({ kind: 'received', date: body.date }, null, null)).toBe(false)
  expect(appliedDuringTenancy(body, null, { kind: 'applied' })).toBe(false)
  expect(appliedDuringTenancy(body, null, { kind: 'received' })).toBe(true)
})

// ---------- Befunde des Praxistests vor 0.18.0 ----------

test('Praxistest 3: der Kopf nennt Verrechnetes und Ausgezahltes, damit er aufgeht', () => {
  const entries = [entry('received', 180000), entry('interest', 320), entry('applied', 20000)]
  const t = text(depositState({ depositCents: 168000 }, entries), { depositCents: 168000 })
  expect(t).toContain('verrechnet 200,00 €')
  expect(t).toContain('bei Ihnen liegen 1.603,20 €')
})

test('Praxistest 4: mehr eingegangen als vereinbart wird genannt', () => {
  expect(text(depositState({ depositCents: 168000 }, [entry('received', 180000)]), { depositCents: 168000 })).toContain('Eingegangen ist mehr als vereinbart')
  expect(text(depositState({ depositCents: 168000 }, [entry('received', 168000)]), { depositCents: 168000 })).not.toContain('mehr als vereinbart')
})

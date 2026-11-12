// Formularlogik der Kautionsbuchungen (#228): der Rumpf einer Buchung, der Satz zum Stand, der Betrag mit Vorzeichen.
import { describe, expect, test } from 'vitest'
import { depositState } from '../../shared/deposit.ts'
import type { DepositEntry } from './types'
import { DEPOSIT_KIND_OPTIONS, DEPOSIT_PURPOSE_OPTIONS, depositEntryBody, depositStateText, depositStatusLabel, emptyDepositForm, signedCents } from './depositForm'

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

  test('die Optionen: vier Arten, in Teil 1 nur Schaden und Sonstiges als Zweck', () => {
    expect(DEPOSIT_KIND_OPTIONS.map((o) => o.label)).toEqual(['Eingang', 'Ertrag (Zinsen)', 'Verrechnung', 'Rückzahlung an den Mieter'])
    expect(DEPOSIT_PURPOSE_OPTIONS.map((o) => o.value)).toEqual(['damage', 'other'])
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

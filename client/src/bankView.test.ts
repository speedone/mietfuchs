// Logik der Seite „Kontoauszug“ (#188, Teil 3): Vorauswahl aus dem Vorschlag, Entscheidungen, grüne Zeilen, Sätze.
import { describe, expect, test } from 'vitest'
import {
  BANK_TARGET_OPTIONS, coverageText, decisionsOf, greenRows, initialRow, questionProblems, rowProblem, SET_ASIDE_OPTIONS, targetOptionsFor,
  type BankRow,
} from './bankView'
import type { BankAccountInfo, BankSuggestion, BankTransactionView } from './types'

const tx = (id: string, amountCents: number, suggestion: BankSuggestion | null = null): BankTransactionView => ({
  id, bookingDate: '2025-06-02', valueDate: null, amountCents, counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE02120300000000202051',
  ultimatePartyName: null, purpose: 'Miete Juni', reversal: false, setAside: null, openCents: amountCents, links: [], suggestion,
})
const green: BankSuggestion = { tenancyId: 't1', target: { type: 'newPayment', kind: 'rent' }, light: 'green', reason: 'IBAN bekannt, Betrag wie Monatsmiete' }

describe('Vorauswahl', () => {
  test('Vorschlag wird zur Vorauswahl', () => {
    expect(initialRow(tx('x', 85000, green)).parts).toEqual([{ tenancyId: 't1', target: 'rent', amountCents: 85000 }])
    const existing = initialRow(tx('x', 85000, { ...green, target: { type: 'existingPayment', paymentId: 'p1' } }))
    expect(existing.parts).toEqual([{ tenancyId: 't1', target: 'existingPayment', refId: 'p1', amountCents: 85000 }])
    const deposit = initialRow(tx('x', 85000, { ...green, target: { type: 'existingDeposit', depositEntryId: 'd1' } }))
    expect(deposit.parts[0]).toEqual({ tenancyId: 't1', target: 'existingDeposit', refId: 'd1', amountCents: 85000 })
  })
  test('ohne Vorschlag ist nichts gewählt und die Zeile nicht buchbar', () => {
    const row = initialRow(tx('x', 85000))
    expect(row.parts).toEqual([{ tenancyId: null, target: null, amountCents: 85000 }])
    expect(rowProblem(row)).toBe('Bitte wählen Sie Mietverhältnis und Art.')
  })
})

describe('Entscheidungen', () => {
  test('nur ausgewählte, vollständige Zeilen werden Entscheidungen', () => {
    const a: BankRow = { ...initialRow(tx('a', 85000, green)), selected: true }
    const b: BankRow = { ...initialRow(tx('b', 85000, green)), selected: false }
    const c: BankRow = { ...initialRow(tx('c', 85000)), selected: true }
    expect(decisionsOf([a, b, c])).toEqual([{ transactionId: 'a', parts: [{ tenancyId: 't1', amountCents: 85000, target: { type: 'newPayment', kind: 'rent' } }] }])
  })
  test('Ziel erfasste Zahlung trägt die Kennung, Kaution die Art', () => {
    const row: BankRow = { tx: tx('a', 85000), selected: true, setAside: null, parts: [{ tenancyId: 't1', target: 'existingPayment', refId: 'p1', amountCents: 85000 }] }
    expect(decisionsOf([row])[0]).toEqual({ transactionId: 'a', parts: [{ tenancyId: 't1', amountCents: 85000, target: { type: 'existingPayment', paymentId: 'p1' } }] })
    const refund: BankRow = { tx: tx('b', -85000), selected: true, setAside: null, parts: [{ tenancyId: 't1', target: 'depositRefunded', amountCents: -85000 }] }
    expect(decisionsOf([refund])[0]).toEqual({ transactionId: 'b', parts: [{ tenancyId: 't1', amountCents: -85000, target: { type: 'deposit', kind: 'refunded' } }] })
  })
  test('aufgeteilt: zwei Teile; beiseitegelegt: der Grund', () => {
    const split: BankRow = { tx: tx('a', 150000), selected: true, setAside: null, parts: [
      { tenancyId: 't1', target: 'rent', amountCents: 80000 }, { tenancyId: 't2', target: 'rent', amountCents: 70000 },
    ] }
    expect(decisionsOf([split])[0]).toEqual({ transactionId: 'a', parts: [
      { tenancyId: 't1', amountCents: 80000, target: { type: 'newPayment', kind: 'rent' } },
      { tenancyId: 't2', amountCents: 70000, target: { type: 'newPayment', kind: 'rent' } },
    ] })
    const aside: BankRow = { ...initialRow(tx('b', 100)), selected: true, setAside: 'transfer' }
    expect(decisionsOf([aside])).toEqual([{ transactionId: 'b', setAside: 'transfer' }])
  })
  test('grüne Zeilen', () => {
    expect(greenRows([tx('a', 1, green), tx('b', 1, { ...green, light: 'yellow' }), tx('c', 1)]).map((t) => t.id)).toEqual(['a'])
  })
})

describe('Auswahllisten', () => {
  test('Beschriftungen', () => {
    expect(Object.fromEntries(BANK_TARGET_OPTIONS.map((o) => [o.value, o.label]))).toEqual({
      rent: 'Miete', settlement: 'Nachzahlung oder Guthaben', depositReceived: 'Kaution erhalten', depositRefunded: 'Kaution zurückgezahlt',
      existingPayment: 'mit erfasster Zahlung verknüpfen', existingDeposit: 'mit erfasster Kautionsbuchung verknüpfen',
    })
    expect(SET_ASIDE_OPTIONS.map((o) => o.label)).toEqual(['Umbuchung zwischen eigenen Konten', 'gehört nicht zur Vermietung', 'Sonstiges'])
  })
  test('je Richtung nur die passenden Arten; verknüpfen nur mit Vorschlag, und der gewählte Wert steht immer darin', () => {
    expect(targetOptionsFor(tx('a', 85000)).map((o) => o.value)).toEqual(['rent', 'settlement', 'depositReceived'])
    expect(targetOptionsFor(tx('a', -85000)).map((o) => o.value)).toEqual(['rent', 'settlement', 'depositRefunded'])
    expect(targetOptionsFor(tx('a', 85000, { ...green, target: { type: 'existingPayment', paymentId: 'p1' } })).map((o) => o.value)).toContain('existingPayment')
  })
})

describe('Sätze', () => {
  const account = (coverage: BankAccountInfo['coverage']): BankAccountInfo => ({ id: 'a', iban: 'DE89', otherId: null, label: 'Giro', kind: 'mixed', rentalConfirmedAt: null, coverage, imports: [] })
  test('Satz zur Lückenlosigkeit', () => {
    expect(coverageText(account({ from: '2025-01-01', to: '2025-03-31' }))).toBe('Konto lückenlos eingelesen vom 01.01.2025 bis 31.03.2025.')
    expect(coverageText(account({ gapAfter: '2025-01-31', gapBefore: '2025-02-02' }))).toBe('Zwischen 31.01.2025 und 02.02.2025 fehlt ein Auszug oder die Salden schließen nicht an.')
    expect(coverageText(account(null))).toBe('Ob das Konto lückenlos eingelesen ist, lässt sich erst mit Auszügen sagen, die Anfangs- und Endsaldo nennen.')
    for (const c of [null, { from: '2025-01-01', to: '2025-03-31' }]) expect(coverageText(account(c))).not.toMatch(/vollständig|GoBD|revisionssicher/)
  })
  test('Rückfragen brauchen Antworten, ein Mieteingang ein Mietverhältnis', () => {
    const questions = [
      { type: 'account' as const, iban: 'DE89', otherId: null },
      { type: 'entry' as const, key: 'k1', bookingDate: '2025-06-02', amountCents: 50000, counterpartyName: 'Neu', counterpartyIban: null, purpose: 'Miete' },
    ]
    expect(questionProblems(questions, {}).map((p) => p.field)).toEqual(['account:DE89', 'entry:k1'])
    expect(questionProblems(questions, { 'account:DE89': { accept: true }, 'entry:k1': { as: 'rent' } }).map((p) => p.text)).toEqual(['Bitte wählen Sie das Mietverhältnis zum Eingang vom 02.06.2025.'])
    expect(questionProblems(questions, { 'account:DE89': { accept: true }, 'entry:k1': { as: 'rent', tenancyId: 't1' } })).toEqual([])
  })
})

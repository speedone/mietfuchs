// Vorschlag zu einer Rückfrage beim Einlesen (#188, Nachtrag 13.11.): Name und Betrag passen zu genau einem
// Mietverhältnis.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameTokens, suggestForQuestion, type SuggestTenancy } from '../src/bank/importSuggest.ts'
import type { BankImportQuestion } from '../../shared/types.ts'

type EntryQuestion = Extract<BankImportQuestion, { type: 'entry' }>

const question = (o: Partial<EntryQuestion> = {}): EntryQuestion => ({
  type: 'entry', key: 'k', bookingDate: '2026-01-02', amountCents: 128000, counterpartyName: 'Familie Yilmaz', counterpartyIban: 'DE00', purpose: 'Miete', ...o,
})
const TENANCIES: SuggestTenancy[] = [
  { id: 'y', tenantName: 'Familie Yilmaz', start: '2016-02-01', end: null },
  { id: 'a', tenantName: 'Anna Becker', start: '2019-04-01', end: null },
  { id: 'j', tenantName: 'Jonas Hartmann', start: '2021-09-01', end: '2025-06-30' },
]
const SOLL: Record<string, number> = { 'y|2026-01': 128000, 'a|2025-12': 93000, 'a|2026-01': 93000, 'j|2026-01': 74000 }
const soll = (id: string, month: string) => SOLL[`${id}|${month}`] ?? null

test('Vorschlag: Name und Betrag passen zu genau einem Mietverhältnis', () => {
  assert.deepEqual(suggestForQuestion(question(), TENANCIES, soll), { tenancyId: 'y', reason: 'Name und Betrag passen zu Familie Yilmaz.' })
})

test('Vorschlag: Reihenfolge der Namen, Komma, Umlaute in Umschrift und Anrede ändern nichts', () => {
  assert.deepEqual(nameTokens('Familie Yılmaz'), nameTokens('YILMAZ'))
  assert.equal(suggestForQuestion(question({ counterpartyName: 'BECKER, ANNA', amountCents: 93000 }), TENANCIES, soll)?.tenancyId, 'a')
  assert.deepEqual(nameTokens('Jürgen Müller-Weiß'), nameTokens('Juergen Mueller Weiss'))
  assert.equal(suggestForQuestion(question({ counterpartyName: 'Herrn Dr. Anna Becker', amountCents: 93000 }), TENANCIES, soll)?.tenancyId, 'a')
})

test('Vorschlag: kein Vorschlag bei anderem Betrag, fremdem Namen, nur Vornamen oder ohne Namen', () => {
  assert.equal(suggestForQuestion(question({ amountCents: 100000 }), TENANCIES, soll), null)
  assert.equal(suggestForQuestion(question({ counterpartyName: 'Arbeitgeber AG' }), TENANCIES, soll), null)
  assert.equal(suggestForQuestion(question({ counterpartyName: 'Anna Schmidt', amountCents: 93000 }), TENANCIES, soll), null)
  assert.equal(suggestForQuestion(question({ counterpartyName: null }), TENANCIES, soll), null)
})

test('Vorschlag: zwei Mietverhältnisse mit passendem Namen und Betrag ergeben keinen', () => {
  const twice: SuggestTenancy[] = [...TENANCIES, { id: 'y2', tenantName: 'Yilmaz', start: '2020-01-01', end: null }]
  const sollTwice = (id: string, month: string) => (id === 'y2' ? 128000 : soll(id, month))
  assert.equal(suggestForQuestion(question(), twice, sollTwice), null)
})

test('Vorschlag: ein beendetes Mietverhältnis zählt nur bis drei Monate nach dem Ende', () => {
  const late = question({ counterpartyName: 'Jonas Hartmann', amountCents: 74000 })
  assert.equal(suggestForQuestion(late, TENANCIES, soll), null)
  assert.equal(suggestForQuestion({ ...late, bookingDate: '2025-07-15' }, TENANCIES, (id, m) => (id === 'j' && m === '2025-06' ? 74000 : null))?.tenancyId, 'j')
})

test('Vorschlag: die Miete des Vormonats oder des Folgemonats passt auch', () => {
  // Am 30.12. für Januar, am 5.1. für Dezember
  const nextOnly = (id: string, m: string) => (id === 'y' && m === '2026-01' ? 128000 : null)
  assert.equal(suggestForQuestion(question({ bookingDate: '2025-12-30' }), TENANCIES, nextOnly)?.tenancyId, 'y')
  const prevOnly = (id: string, m: string) => (id === 'y' && m === '2025-12' ? 128000 : null)
  assert.equal(suggestForQuestion(question({ bookingDate: '2026-01-05' }), TENANCIES, prevOnly)?.tenancyId, 'y')
})

test('Vorschlag: ein Ausgang bekommt keinen', () => {
  assert.equal(suggestForQuestion(question({ amountCents: -128000 }), TENANCIES, soll), null)
})

// Die Ordnung der Seite Abrechnung: „Zu prüfen“, die Tabelle je Mieter und das Blättern in der Vorschau, ohne DOM.
import { expect, test } from 'vitest'
import type { NotSettled, Notice, Statement } from './types'
import { checkList, hintSummary, neighbors, noticeAmount, noticeHeadline, resultText, tenantRows } from './settlementOverview'

const n = (level: Notice['level'], title: string, text = `${title}.`): Notice => ({ code: `c.${title}`, level, title, text })

test('Zu prüfen: Fehler, Warnungen und Hinweise getrennt, Info zählt zu den Hinweisen, Reihenfolge bleibt', () => {
  const list = checkList([n('warning', 'W1'), n('error', 'F1'), n('hint', 'H1'), n('info', 'I1'), n('warning', 'W2'), n('error', 'F2')])
  expect(list.errors.map((x) => x.title)).toEqual(['F1', 'F2'])
  expect(list.warnings.map((x) => x.title)).toEqual(['W1', 'W2'])
  expect(list.hints.map((x) => x.title)).toEqual(['H1', 'I1'])
  expect(checkList([])).toEqual({ errors: [], warnings: [], hints: [] })
})

test('Hinweise zusammengefasst: Zahl und Titel, gleiche Titel einmal, nach drei Titeln „…“', () => {
  expect(hintSummary([n('hint', 'Leerstand')])).toBe('1 Hinweis (Leerstand)')
  expect(hintSummary([n('hint', 'A'), n('hint', 'B'), n('hint', 'A')])).toBe('3 Hinweise (A, B)')
  expect(hintSummary([n('hint', 'A'), n('hint', 'B'), n('hint', 'C'), n('hint', 'D')])).toBe('4 Hinweise (A, B, C, …)')
  // Ohne Titel (abgeschlossen vor #112) steht der Anfang des Textes.
  expect(hintSummary([{ code: 'legacy', level: 'hint', title: '', text: 'Erster Satz. Zweiter Satz.' }])).toBe('1 Hinweis (Erster Satz.)')
})

test('Kopf eines Hinweises: der Titel, sonst der erste Satz, gekürzt', () => {
  expect(noticeHeadline(n('warning', 'Titel', 'Text.'))).toBe('Titel')
  expect(noticeHeadline({ code: 'legacy', level: 'warning', title: '', text: 'Kurz. Danach mehr.' })).toBe('Kurz.')
  const long = noticeHeadline({ code: 'legacy', level: 'warning', title: '', text: 'x'.repeat(200) })
  expect(long.length).toBeLessThanOrEqual(121)
  expect(long.endsWith('…')).toBe(true)
  // Abkürzungen beenden keinen Satz.
  expect(noticeHeadline({ code: 'legacy', level: 'warning', title: '', text: 'Nach § 556 Abs. 3 BGB gilt das. Weiter.' })).toBe('Nach § 556 Abs. 3 BGB gilt das.')
})

test('der bezifferte Betrag eines Hinweises: der erste Euro-Betrag im Text', () => {
  expect(noticeAmount('Die Mieter tragen 1.234,56 € zu viel, dazu 3,00 €.')).toBe('1.234,56 €')
  expect(noticeAmount('Kürzung um 3 % (12,40 €).')).toBe('12,40 €')
  expect(noticeAmount('Ohne Betrag, nur 3 %.')).toBeNull()
  expect(noticeAmount('minus −50,00 € Gutschrift')).toBe('−50,00 €')
})

const st = (over: Partial<Statement>): Statement => ({
  tenancyId: 't', unitId: 'u', tenantName: 'Anna', unitName: 'EG', persons: 1, days: 365, personDays: 365,
  periodStart: '2025-01-01', periodEnd: '2025-12-31', rows: [], totalShareCents: 100000, total35aCents: 0,
  prepaymentCents: 90000, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: -10000, ...over,
})

test('Ergebnis in Worten: Nachzahlung, Guthaben, ausgeglichen', () => {
  expect(resultText(-14054)).toMatch(/^Nachzahlung 140,54\s€$/)
  expect(resultText(2500)).toMatch(/^Guthaben 25,00\s€$/)
  expect(resultText(0)).toBe('ausgeglichen')
})

test('Tabelle je Mieter: erst die Abrechnungen, dann die ohne, mit Grund', () => {
  const notSettled: NotSettled[] = [
    { tenancyId: 'p', tenantName: 'Paul', unitName: 'Garage', costModel: 'flatRate', heatingModel: 'settlement' },
    { tenancyId: 'k', tenantName: 'Kai', unitName: 'DG', costModel: 'settlement', heatingModel: 'settlement', usageConflict: { prepaymentCents: 0 } },
  ]
  const rows = tenantRows({ statements: [st({ tenancyId: 'a' }), st({ tenancyId: 'b', tenantName: 'Ben', unitName: 'OG', balanceCents: 500, days: 184, periodStart: '2025-07-01' })], notSettled })
  expect(rows.map((r) => r.tenancyId)).toEqual(['a', 'b', 'p', 'k'])
  const [a, b, p, k] = rows
  expect(a).toMatchObject({ settled: true, tenantName: 'Anna', unitName: 'EG', period: '01.01.2025 – 31.12.2025', days: 365, costsCents: 100000, prepaymentCents: 90000, balanceCents: -10000 })
  expect(b).toMatchObject({ settled: true, period: '01.07.2025 – 31.12.2025', days: 184 })
  expect(p).toMatchObject({ settled: false, tenantName: 'Paul', unitName: 'Garage', reason: 'Nebenkosten als Pauschale' })
  expect(k?.settled).toBe(false)
  expect(k && !k.settled ? k.reason : '').toMatch(/nicht vermietet/)
  // Ohne Liste der Mietverhältnisse ohne Abrechnung (älterer Stand)
  expect(tenantRows({ statements: [] })).toEqual([])
})

test('Blättern in der Vorschau: voriger und nächster, an den Enden keiner', () => {
  const ids = ['a', 'b', 'c']
  expect(neighbors(ids, 'a')).toEqual({ prev: null, next: 'b', index: 0, count: 3 })
  expect(neighbors(ids, 'b')).toEqual({ prev: 'a', next: 'c', index: 1, count: 3 })
  expect(neighbors(ids, 'c')).toEqual({ prev: 'b', next: null, index: 2, count: 3 })
  expect(neighbors(ids, 'x')).toEqual({ prev: null, next: null, index: -1, count: 3 })
})

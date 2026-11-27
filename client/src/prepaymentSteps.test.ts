import { expect, test } from 'vitest'
import type { PrepaymentStepItem, PrepaymentStepPlan } from './types'
import { overdueText, sentMonthLines, stepQuestion, stepRows, stepStatus } from './prepaymentSteps'
import type { Statement, StatementLetter } from './types'

const plain = (s: string | null): string => (s ?? '').replace(/ /g, ' ')
const item = (over: Partial<PrepaymentStepItem> = {}): PrepaymentStepItem => ({
  tenancyId: 't1', tenantName: 'Erika', unitName: 'EG', schedule: 'prepayments', cents: 5000, from: '2026-05', announcedFrom: '2026-05',
  currentCents: 4000, state: 'pending', existing: [], earlier: [], notes: [], overdue: false, ...over,
})
const plan = (items: PrepaymentStepItem[], errors: string[] = []): PrepaymentStepPlan => ({ items, errors, sentAt: '2026-03-03', token: 'x' })

test('#317: Stand je Mieter', () => {
  expect(plain(stepStatus(item()))).toBe('Vorauszahlung 50,00 € ab Mai 2026: noch nicht in der Staffel (dort 40,00 €).')
  expect(plain(stepStatus(item({ state: 'taken' })))).toBe('Vorauszahlung 50,00 € ab Mai 2026: steht in der Staffel.')
  expect(plain(stepStatus(item({ schedule: 'heatingPrepayments', state: 'taken' })))).toMatch(/^Heizvorauszahlung/)
})

test('#317: „angekündigt, aber nicht übernommen“ nennt Mieter, Betrag und Monat', () => {
  expect(overdueText([])).toBeNull()
  expect(plain(overdueText([item({ overdue: true })]))).toBe('Angekündigt, aber noch nicht in der Staffel: Erika (50,00 € ab Mai 2026). Das Mietkonto führt bis dahin die bisherige Vorauszahlung im Soll.')
})

test('#317: Rückfrage bei Fehlern, vorhandener Stufe und zum Monat; ohne Anlass keine', () => {
  expect(stepQuestion(plan([item()]), ['t1'])).toBeNull()
  const errors = stepQuestion(plan([item()], ['Mietverhältnisse überschneiden sich']), ['t1'])
  expect(errors?.[0]).toMatch(/Fehler \(Mietverhältnisse überschneiden sich\).*VIII ZR 246\/11/)
  const existing = stepQuestion(plan([item({ existing: [{ from: '2026-05', monthlyCents: 4500 }, { from: '2027-01', monthlyCents: 4800 }] })]), ['t1'])
  expect(plain(existing?.[0] ?? null)).toMatch(/Ab Mai 2026 steht in der Staffel schon 45,00 € ab Mai 2026, 48,00 € ab Januar 2027\. Die Stufe ab Mai 2026 wird ersetzt, spätere bleiben\..*203 C 73\/23, Rn\. 27/)
  expect(stepQuestion(plan([item({ notes: ['Prüfen.'] })]), ['t1'])).toEqual(['Erika: Prüfen.'])
  // Nur, wer übernommen wird.
  expect(stepQuestion(plan([item({ notes: ['Prüfen.'] })]), [])).toBeNull()
})

// Durchsicht zu PR #435
test('S2: eine Stufe zwischen Zeitraumende und Monat fragt nach', () => {
  const lines = stepQuestion(plan([item({ earlier: [{ from: '2026-02', monthlyCents: 4400 }] })]), ['t1'])
  expect(plain(lines?.[0] ?? null)).toMatch(/Erika: Nach dem abgerechneten Zeitraum steht schon 44,00 € ab Februar 2026\..*203 C 73\/23, Rn\. 27/)
})

test('S1: Versanddatum gegen den Monat des Schreibens', () => {
  const letter = (from: string | null, newCents: number | null = 5000) => ({ adjustment: { mode: 'suggestion', newCents, from } }) as unknown as StatementLetter
  const st = [{ tenancyId: 't1', tenantName: 'Erika' }] as unknown as Statement[]
  expect(sentMonthLines({ t1: letter('2026-05') }, st, '2026-03-03')).toEqual([])
  expect(plain(sentMonthLines({ t1: letter('2026-05') }, st, '2026-04-02')[0] ?? '')).toMatch(/Erika: Das Schreiben nennt Mai 2026.*später als die Vorgabe.*Wieder öffnen/)
  expect(plain(sentMonthLines({ t1: letter('2026-05') }, st, '2026-05-04')[0] ?? '')).toMatch(/schon begonnen.*VIII ZR 271\/10.*Wieder öffnen/)
  expect(sentMonthLines({ t1: letter(null) }, st, '2026-05-04')).toEqual([])
  expect(sentMonthLines({ t1: letter('2026-05', null) }, st, '2026-05-04')).toEqual([])
})

// #704 Teil 2: Nennt das Schreiben zwei Teile, zeigt die Karte beide mit ihrem Stand, und die Rückfrage nennt Stufen beider
// Staffeln. `cents` ist der Teil der übrigen Nebenkosten, `heating` der für Heizung und Warmwasser.
test('#704: zwei Staffeln: Stand, Erinnerung und Rückfrage nennen beide Teile', () => {
  const two = item({ cents: 17000, currentCents: 18000, heating: { cents: 14000, currentCents: 12000, existing: [{ from: '2026-09', monthlyCents: 13000 }], earlier: [{ from: '2026-02', monthlyCents: 12500 }] } })
  expect(stepRows(two)).toEqual([
    { label: 'Übrige Vorauszahlung', cents: 17000, currentCents: 18000, existing: [], earlier: [] },
    { label: 'Heizvorauszahlung', cents: 14000, currentCents: 12000, existing: [{ from: '2026-09', monthlyCents: 13000 }], earlier: [{ from: '2026-02', monthlyCents: 12500 }] },
  ])
  expect(stepRows(item())).toEqual([{ label: 'Vorauszahlung', cents: 5000, currentCents: 4000, existing: [], earlier: [] }])
  expect(plain(stepStatus(two))).toBe('Vorauszahlung 310,00 € ab Mai 2026 (übrige Nebenkosten 170,00 €, Heizung 140,00 €): noch nicht in der Staffel (dort 180,00 € und 120,00 €).')
  expect(plain(stepStatus({ ...two, state: 'taken' }))).toBe('Vorauszahlung 310,00 € ab Mai 2026 (übrige Nebenkosten 170,00 €, Heizung 140,00 €): steht in beiden Staffeln.')
  expect(plain(overdueText([{ ...two, overdue: true }]))).toMatch(/Erika \(310,00 € ab Mai 2026\)/)
  const lines = (stepQuestion(plan([two]), ['t1']) ?? []).map(plain)
  expect(lines.some((l) => /Erika: Ab Mai 2026 steht in der Staffel der Heizvorauszahlung schon 130,00 € ab September 2026\./.test(l))).toBe(true)
  expect(lines.some((l) => /Erika: Nach dem abgerechneten Zeitraum steht schon 125,00 € ab Februar 2026/.test(l))).toBe(true)
})

// Durchsicht von Teil 2, K6: Die Rückfrage nennt bei zwei Staffeln jede beim Namen und fragt nur zu der, die geschrieben wird.
test('#704: Rückfrage bei zwei Staffeln: jede Staffel beim Namen, und nichts zu einer Staffel, die schon stimmt', () => {
  const both = item({ cents: 17000, currentCents: 18000, existing: [{ from: '2026-05', monthlyCents: 18500 }], earlier: [{ from: '2026-03', monthlyCents: 18000 }],
    heating: { cents: 14000, currentCents: 12000, existing: [], earlier: [{ from: '2026-02', monthlyCents: 12500 }] } })
  const lines = (stepQuestion(plan([both]), ['t1']) ?? []).map(plain)
  expect(lines.some((l) => l.startsWith('Erika: Ab Mai 2026 steht in der Staffel der übrigen Vorauszahlung schon 185,00 € ab Mai 2026.'))).toBe(true)
  expect(lines.some((l) => l.startsWith('Erika: Nach dem abgerechneten Zeitraum steht schon 180,00 € ab März 2026 (übrige Vorauszahlung) und 125,00 € ab Februar 2026 (Heizvorauszahlung).'))).toBe(true)
  // Halb übernommen: Die übrige Vorauszahlung steht schon, gefragt wird nur zur Heizstaffel.
  const half = item({ cents: 17000, currentCents: 17000, existing: [{ from: '2026-05', monthlyCents: 17000 }],
    heating: { cents: 14000, currentCents: 12000, existing: [{ from: '2026-09', monthlyCents: 13000 }], earlier: [] } })
  const halfLines = (stepQuestion(plan([half]), ['t1']) ?? []).map(plain)
  expect(halfLines).toHaveLength(1)
  expect(halfLines[0]).toMatch(/in der Staffel der Heizvorauszahlung schon 130,00 € ab September 2026/)
})

// #712: Deckt die zweite Vorauszahlung laut dem abgeschlossenen Schreiben auch Wasser/Abwasser, nennen Karte, Stand und
// Rückfrage sie so; ohne die Angabe bleibt jeder Wortlaut wie zuvor (die Tests darüber).
test('#712: zwei Staffeln, die zweite auch für Wasser/Abwasser: Zeilen, Stand und Rückfrage nennen sie so', () => {
  const two = item({ cents: 12000, currentCents: 13000, heating: { cents: 19000, currentCents: 17000, existing: [{ from: '2026-09', monthlyCents: 18000 }], earlier: [{ from: '2026-02', monthlyCents: 17500 }], coversWater: true } })
  expect(stepRows(two).map((r) => r.label)).toEqual(['Übrige Vorauszahlung', 'Vorauszahlung für Heizung, Warmwasser und Wasser/Abwasser'])
  expect(plain(stepStatus(two))).toBe('Vorauszahlung 310,00 € ab Mai 2026 (übrige Nebenkosten 120,00 €, Heizung, Warmwasser und Wasser/Abwasser 190,00 €): noch nicht in der Staffel (dort 130,00 € und 170,00 €).')
  const lines = (stepQuestion(plan([two]), ['t1']) ?? []).map(plain)
  expect(lines.some((l) => l.startsWith('Erika: Ab Mai 2026 steht in der Staffel der Vorauszahlung für Heizung, Warmwasser und Wasser/Abwasser schon 180,00 € ab September 2026.'))).toBe(true)
  expect(lines.some((l) => l.startsWith('Erika: Nach dem abgerechneten Zeitraum steht schon 175,00 € ab Februar 2026 (Vorauszahlung für Heizung, Warmwasser und Wasser/Abwasser).'))).toBe(true)
})

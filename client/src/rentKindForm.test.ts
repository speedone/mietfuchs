// Art der Miete und Art je Stufe (#191): Auswahllisten, Vorgaben, Prüfung, Hinweis zum Staffelabstand, Rumpf.
import { describe, expect, it } from 'vitest'
import {
  defaultRentReason, EMPTY_RENT_EXTRA, exclusionOf, exclusionOptions, exclusionValue, rentKindBody, rentKindOptions,
  rentReasonOptions, rentRowExtraOf, staggeredGapNote, withRentDetails, type RentRow,
} from './rentKindForm'
import { buildSchedule } from './tenancyModel'

const row = (from: string, amount: string, extra: Partial<RentRow> = {}): RentRow => ({ from, amount, ...EMPTY_RENT_EXTRA, ...extra })
const details = (rows: RentRow[], kind: Parameters<typeof withRentDetails>[3], start = '2024-01-01') => {
  const built = buildSchedule(rows, start, 'baseRent')
  if ('problems' in built) throw new Error(built.problems.map((p) => p.text).join(' '))
  return withRentDetails(rows, start, built.schedule, kind)
}

describe('Art der Miete und Ausschluss', () => {
  it('jede Auswahl enthält „nicht angegeben“ und jeden Wert', () => {
    expect(rentKindOptions().map((o) => o.value)).toEqual(['', 'free', 'staggered', 'index'])
    expect(exclusionOptions().map((o) => o.value)).toEqual(['', 'no', 'yes'])
  })
  it('Ausschluss: ja, nein und nicht angegeben hin und zurück', () => {
    for (const v of [true, false, null] as const) expect(exclusionValue(exclusionOf(v))).toBe(v)
    expect(exclusionOf(undefined)).toBe('')
  })
  it('Rumpf: nicht angegeben wird null', () => {
    expect(rentKindBody({ rentKind: '', rentIncreaseExcluded: '' })).toEqual({ rentKind: null, rentIncreaseExcluded: null })
    expect(rentKindBody({ rentKind: 'index', rentIncreaseExcluded: 'no' })).toEqual({ rentKind: 'index', rentIncreaseExcluded: false })
  })
})

describe('Art je Stufe', () => {
  it('Vorgabe: erste Stufe Vertragsbeginn, weitere passend zur Art der Miete', () => {
    expect(defaultRentReason('staggered', true)).toBe('agreement')
    expect(defaultRentReason('staggered', false)).toBe('staggered')
    expect(defaultRentReason('index', false)).toBe('index')
    expect(defaultRentReason('free', false)).toBe('agreement')
    expect(defaultRentReason('', false)).toBe('agreement')
  })
  it('Staffel- und Indexstufe nur bei passender Art der Miete, der gespeicherte Wert immer', () => {
    expect(rentReasonOptions('free', 'agreement').map((o) => o.value)).toEqual(['agreement', 'comparison', 'modernization'])
    expect(rentReasonOptions('staggered', 'agreement').map((o) => o.value)).toContain('staggered')
    expect(rentReasonOptions('index', 'agreement').map((o) => o.value)).toContain('index')
    // Gespeichert „Staffel“, die Art der Miete inzwischen „nach Vertrag“: Der Wert bleibt sichtbar (und wird gemeldet).
    expect(rentReasonOptions('free', 'staggered').map((o) => o.value)).toContain('staggered')
    // Eine alte Stufe ohne Art zeigt „nicht angegeben“.
    expect(rentReasonOptions('free', '')[0]).toEqual({ value: '', label: 'Nicht angegeben (zählt wie Vereinbarung)' })
    expect(rentReasonOptions('free', 'agreement').some((o) => o.value === '')).toBe(false)
  })
  it('Zeile aus der gespeicherten Stufe: Indexwert mit einer Nachkommastelle, Monat als MM.JJJJ', () => {
    expect(rentRowExtraOf({ reason: 'index', index: { month: '2023-12', value: 106.1, base: 2020 } })).toEqual({ reason: 'index', indexMonth: '12.2023', indexValue: '106,1', indexBase: '2020' })
    expect(rentRowExtraOf({ index: { month: '2023-12', value: 117, base: 2020 } }).indexValue).toBe('117,0')
    expect(rentRowExtraOf({})).toEqual(EMPTY_RENT_EXTRA)
  })
})

describe('withRentDetails', () => {
  it('Indexmiete: Art und Indexwert je Stufe, leeres Basisjahr ist die aktuelle Reihe', () => {
    const r = details([
      row('', '685,00', { reason: 'agreement', indexMonth: '10.2023', indexValue: '94,2', indexBase: '' }),
      row('03.2025', '771,53', { reason: 'index', indexMonth: '12.2024', indexValue: '106.1', indexBase: '2020' }),
    ], 'index')
    expect(r).toEqual({ entries: [
      { from: '2024-01', monthlyCents: 68500, reason: 'agreement', index: { month: '2023-10', value: 94.2, base: 2020 } },
      { from: '2025-03', monthlyCents: 77153, reason: 'index', index: { month: '2024-12', value: 106.1, base: 2020 } },
    ] })
  })
  it('ohne Angaben wie vorher: nur Monat und Betrag', () => {
    expect(details([row('', '700,00'), row('', ''), row('01.2025', '720,00')], '')).toEqual({ entries: [
      { from: '2024-01', monthlyCents: 70000 }, { from: '2025-01', monthlyCents: 72000 },
    ] })
  })
  it('meldet Indexwert und Art, die nicht zur Art der Miete passen, je an ihrem Feld', () => {
    const r = details([
      row('', '700,00', { indexMonth: '10.2023', indexValue: '117,8' }),
      row('01.2025', '720,00', { reason: 'staggered' }),
      row('01.2026', '740,00', { reason: 'index' }),
    ], 'free')
    expect('problems' in r && r.problems.map((p) => p.field)).toEqual(['baseRent.0.indexValue', 'baseRent.1.reason', 'baseRent.2.reason'])
  })
  it('meldet ein Basisjahr ohne Monat und Wert, statt es still zu verwerfen', () => {
    const r = details([row('', '700,00', { indexBase: '2020' })], 'index')
    expect('problems' in r && r.problems.map((p) => p.field)).toContain('baseRent.0.indexMonth')
    expect('problems' in r && r.problems.find((p) => p.field === 'baseRent.0.indexMonth')?.text).toMatch(/Monat des Indexwerts/)
  })
  it('meldet einen unvollständigen oder ungültigen Indexwert', () => {
    const r = details([
      row('', '700,00', { indexMonth: '10.2023', indexValue: '' }),
      row('01.2025', '720,00', { indexMonth: '', indexValue: '117,85' }),
      row('01.2026', '740,00', { indexMonth: '10.2025', indexValue: '0', indexBase: '20' }),
    ], 'index')
    expect('problems' in r && r.problems.map((p) => p.field)).toEqual([
      'baseRent.0.indexValue', 'baseRent.1.indexMonth', 'baseRent.1.indexValue', 'baseRent.2.indexValue', 'baseRent.2.indexBase',
    ])
  })
})

describe('Staffelabstand', () => {
  it('Hinweis nur bei Staffelmiete und Abstand unter einem Jahr; Modernisierung zählt nicht', () => {
    const steps = [{ from: '2025-01' }, { from: '2025-10', reason: 'staggered' as const }, { from: '2026-10', reason: 'staggered' as const }]
    expect(staggeredGapNote(steps, 'staggered')).toMatch(/mindestens 12 Monate gelten \(§ 557a Abs\. 2 BGB\); hier liegen zwischen Januar 2025 und Oktober 2025 nur 9 Monate\./)
    expect(staggeredGapNote(steps, 'free')).toBeNull()
    expect(staggeredGapNote([{ from: '2025-01' }, { from: '2026-01', reason: 'staggered' }], 'staggered')).toBeNull()
    expect(staggeredGapNote([{ from: '2025-01' }, { from: '2025-06', reason: 'modernization' }, { from: '2026-01', reason: 'staggered' }], 'staggered')).toBeNull()
  })
})

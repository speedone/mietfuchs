// Die eine Tabelle der Zeilen der Anlage V (#96 PR 1, Entwurf A5, Durchsicht X5): je Jahr mit Fundstelle, nur Jahre,
// die im Vordruck oder in der Anleitung nachgesehen sind. Eine erfundene Zeile wäre schlimmer als keine.
import { describe, expect, test } from 'vitest'
import { ANLAGE_V_YEARS, anlageVLines } from './anlageV'
import { settlementLine } from './taxView'

describe('anlageVLines', () => {
  test('2025: alle Blöcke laut Vordruck 2025AnlV101', () => {
    const l = anlageVLines(2025) ?? expect.unreachable('2025 fehlt')
    expect(l.source).toMatch(/2025AnlV101/)
    expect(l.header).toEqual({ groundTaxFile: 6, acquisition: 7, use: 10, totalArea: 11, selfUsedArea: 12 })
    expect(l.income).toEqual({
      perUnit: [13, 14],
      homes: { line: 15, code: 1 }, otherRooms: { line: 18, code: 2 }, relatives: { line: 19, code: 3 }, allocations: { line: 20, code: 4 },
      settlement: { line: 21, code: 11 }, relativesAllocations: { line: 22, code: 5 }, relativesSettlement: { line: 23, code: 12 },
      notAgreed: { line: 24, code: 13 }, formerYears: { line: 25, code: 6 }, garages: { line: 26, code: 7 }, total: 32,
    })
    expect(l.maintenance).toEqual({
      direct: { line: 55, code: 36 }, proportional: { line: 56, code: 37 },
      spread: { total: 57, direct: 58, proportional: 59, sum: { line: 60, code: 38 } },
      spreadFromPriorYears: [
        { fromYear: 2021, direct: 61, proportional: 62, sum: { line: 63, code: 39 } },
        { fromYear: 2022, direct: 64, proportional: 65, sum: { line: 66, code: 40 } },
        { fromYear: 2023, direct: 67, proportional: 68, sum: { line: 69, code: 41 } },
        { fromYear: 2024, direct: 70, proportional: 71, sum: { line: 72, code: 42 } },
      ],
    })
    expect(l.notAllocated).toEqual([76, 78])
  })

  test('2024: Zeile 6, Werbungskosten aus der Anleitung 2024 (Ursprungsjahre 2020 bis 2023), Einnahmen aus dem Vordruck; kein Kopf 7, 10 bis 12', () => {
    const l = anlageVLines(2024) ?? expect.unreachable('2024 fehlt')
    expect(l.source).toMatch(/Anleitung zur Anlage V 2024/)
    expect(l.header).toEqual({ groundTaxFile: 6 })
    expect(l.maintenance?.direct.line).toBe(55)
    expect(l.maintenance?.proportional.line).toBe(56)
    expect(l.maintenance?.spread).toEqual({ total: 57, direct: 58, proportional: 59, sum: { line: 60, code: 38 } })
    expect(l.maintenance?.spreadFromPriorYears?.map((x) => [x.fromYear, x.direct, x.proportional, x.sum.line])).toEqual([[2020, 61, 62, 63], [2021, 64, 65, 66], [2022, 67, 68, 69], [2023, 70, 71, 72]])
    expect(l.notAllocated).toEqual([76, 78])
    expect(l.income.settlement).toEqual({ line: 21, code: 11 })
  })

  // Durchsicht von #262 PR 3, K7: Seiten 4 und 5 des Vordrucks 2024AnlV101NET gelesen, Kennzahlen wie 2025.
  test('2024: Kennzahlen des Erhaltungsaufwands laut Vordruck 2024AnlV101NET (36, 37; 38 bis 42)', () => {
    const m = anlageVLines(2024)?.maintenance ?? expect.unreachable('2024 ohne Erhaltungsaufwand')
    expect([m.direct, m.proportional]).toEqual([{ line: 55, code: 36 }, { line: 56, code: 37 }])
    expect(m.spread?.sum).toEqual({ line: 60, code: 38 })
    expect(m.spreadFromPriorYears?.map((x) => x.sum)).toEqual([{ line: 63, code: 39 }, { line: 66, code: 40 }, { line: 69, code: 41 }, { line: 72, code: 42 }])
    expect(anlageVLines(2024)?.source).toMatch(/Seiten 1 bis 5|Seiten 4 und 5/)
  })

  // #312 PR 3: Seite 1 und 2 des Vordrucks 2024AnlV101NET gelesen (Zeilen 13/14, 24, 25, 26, 32), wie 2025.
  test('2024: Einnahmen samt Zeilen 13/14, 24, 25, 26 und 32 laut Vordruck 2024AnlV101NET', () => {
    const l = anlageVLines(2024) ?? expect.unreachable('2024 fehlt')
    expect(l.source).toMatch(/2024AnlV101NET \(September 2024\), Seiten 1 und 2/)
    expect(l.income).toEqual(anlageVLines(2025)?.income)
  })

  test('2023: nur die Einnahmen, die bisher an `settlementLine` belegt waren', () => {
    const l = anlageVLines(2023) ?? expect.unreachable('2023 fehlt')
    expect(l.header).toBeUndefined()
    expect(l.maintenance).toBeUndefined()
    expect(l.income.settlement).toEqual({ line: 21, code: 11 })
    // Seite 2 (Zeile 25 bis 32) ist für 2023 nicht gelesen: keine Nummer.
    expect(l.income.formerYears).toBeUndefined()
    expect(l.income.total).toBeUndefined()
    expect(l.income.perUnit).toBeUndefined()
  })

  test('2026 und andere Jahre ohne gelesenen Vordruck: null', () => {
    expect(anlageVLines(2026)).toBeNull()
    expect(anlageVLines(2022)).toBeNull()
  })

  test('jedes eingetragene Jahr trägt eine Fundstelle', () => {
    expect(ANLAGE_V_YEARS).toEqual([2023, 2024, 2025])
    for (const y of ANLAGE_V_YEARS) expect(anlageVLines(y)?.source.trim().length ?? 0).toBeGreaterThan(20)
  })
})

describe('settlementLine liest aus anlageVLines', () => {
  // Vor dem Umzug stand dieselbe Antwort für 2023 bis 2025 als eigene Tabelle in taxView.ts (#280).
  const BEFORE = { line: 21, code: 11, relativesLine: 23, relativesCode: 12, rentLines: [15, 18], prepaymentLine: 20, relativesRentLine: 19, relativesPrepaymentLine: 22 }
  test.each([2023, 2024, 2025])('%i wie vor dem Umzug', (year) => {
    expect(settlementLine(year)).toEqual(BEFORE)
  })
  test.each([2022, 2026])('%i ohne Zeile', (year) => {
    expect(settlementLine(year)).toBeNull()
  })
})

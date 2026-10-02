import { describe, expect, test } from 'vitest'
import { costBasisText, personsText } from './statementView'
import type { Statement, Tenancy } from './types'

const st = (over: Partial<Statement>): Statement => ({
  tenancyId: 't1', unitId: 'u1', tenantName: 'Meier', unitName: 'EG', persons: 2, days: 365, personDays: 730,
  periodStart: '2025-01-01', periodEnd: '2025-12-31', rows: [], totalShareCents: 0, total35aCents: 0,
  prepaymentCents: 0, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 0, ...over,
})
const ten = (over: Partial<Tenancy>): Tenancy => ({
  id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 2, personHistory: [{ from: '2020-01-01', persons: 2 }],
  start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})

describe('Kopfzeile der Abrechnung: Personen (#142)', () => {
  test('gleichbleibende Personenzahl: wie bisher', () => {
    expect(personsText(st({}), ten({}))).toBe('2 Personen')
  })

  test('Einzahl und Mehrzahl statt „Person(en)“ (Endprüfung rc.4)', () => {
    const fest = (persons: number) => personsText(st({ persons, personDays: persons * 365 }), ten({ persons, personHistory: [{ from: '2020-01-01', persons }] }))
    expect(fest(1)).toBe('1 Person')
    expect(fest(0)).toBe('0 Personen')
    expect(fest(3)).toBe('3 Personen')
    expect(fest(1.5)).toBe('1.5 Personen')
  })

  test('wechselnde Personenzahl im Jahr: der Bereich und die Personentage, nicht nur der letzte Stand', () => {
    // bis 30.09. eine Person, ab 01.10. zwei: 273 + 2 × 92 = 457 Personentage
    const t = ten({ personHistory: [{ from: '2020-01-01', persons: 1 }, { from: '2025-10-01', persons: 2 }] })
    expect(personsText(st({ persons: 2, personDays: 457 }), t)).toBe('1 bis 2 Personen (457 Personentage)')
  })

  test('ein Wechsel vor dem Jahr zählt nicht als Bereich', () => {
    const t = ten({ personHistory: [{ from: '2020-01-01', persons: 1 }, { from: '2024-03-01', persons: 2 }] })
    expect(personsText(st({}), t)).toBe('2 Personen')
  })

  test('ohne passendes Mietverhältnis (etwa eine eingefrorene Abrechnung, deren Staffel sich seither geändert hat): die Personentage aus der Abrechnung selbst', () => {
    expect(personsText(st({ persons: 2, personDays: 457 }), undefined)).toBe('457 Personentage, zuletzt 2 Personen')
    const geaendert = ten({ personHistory: [{ from: '2020-01-01', persons: 3 }] })
    expect(personsText(st({ persons: 2, personDays: 457 }), geaendert)).toBe('457 Personentage, zuletzt 2 Personen')
  })

  test('eine Abrechnung ohne Personentage (älterer Stand): wie bisher', () => {
    const alt: Statement = JSON.parse(JSON.stringify(st({})))
    Reflect.deleteProperty(alt, 'personDays')
    expect(personsText(alt, undefined)).toBe('2 Personen')
  })
})

describe('Grundlage der Kosten (#142)', () => {
  test('kein Abflussprinzip mehr, sondern die Kosten des Abrechnungsjahres', () => {
    expect(costBasisText(2025)).toBe('Abgerechnet werden die Kosten des Abrechnungsjahres 2025.')
    expect(costBasisText(2025)).not.toMatch(/Abfluss/)
  })
})

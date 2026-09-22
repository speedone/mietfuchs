import { describe, expect, it } from 'vitest'
import type { TaxReport } from './types'
import { DEFAULT_BASIS, taxHints } from './taxView'

// Ein Bericht, in dem nur das steht, was die Hinweise lesen. Die übrigen Felder füllt der Typ
// ab, damit der Übersetzer mitprüft, dass die Hinweise wirklich einen TaxReport lesen.
const report = (income: Partial<TaxReport['income']>): TaxReport => ({
  year: 2025,
  income: {
    baseRentSollCents: 960000,
    prepaymentSollCents: 240000,
    prepaymentSettlementCents: 240000,
    prepaymentOverridden: false,
    sollCents: 1200000,
    paidCents: 1200000,
    ...income,
  },
  expenses: { groups: [], totalCents: 0, labor35aCents: 0 },
  rentedAreaShare: 1,
  selfOccupiedExists: false,
  selfUsedShareCents: 0,
  surplusSollCents: 1200000,
  surplusPaidCents: 1200000,
})

describe('Steuerübersicht: Grundlage und Hinweise (#70)', () => {
  it('rechnet von sich aus auf das tatsächlich Zugeflossene', () => {
    // **Der eigentliche Befund.** Nach § 11 Abs. 1 Satz 1 EStG sind Einnahmen in dem Jahr
    // anzusetzen, in dem sie zugeflossen sind; ein vereinbartes, nicht gezahltes Soll ist keine
    // Einnahme. Die Vorgabe war trotzdem das Soll, weil es auch ohne erfasste Zahlungen eine
    // Zahl liefert. Das ist der schlechtere der beiden Ausgänge: 0 € sind sichtbar falsch und
    // führen ins Mietkonto, eine Soll-Summe ist unsichtbar falsch und wandert in die Anlage V.
    expect(DEFAULT_BASIS).toBe('ist')
  })

  it('sagt es, wenn jemand auf das Soll umschaltet', () => {
    expect(taxHints(report({}), 'soll')).toContain('sollIsNotTaxBasis')
    expect(taxHints(report({}), 'ist')).not.toContain('sollIsNotTaxBasis')
  })

  it('erklärt die 0 €, wenn noch keine Zahlung erfasst ist', () => {
    // Ohne diesen Hinweis stünde dort eine 0 ohne Grund, und der nächste Griff wäre das
    // Umschalten auf das Soll — also genau zurück in den Fehler.
    expect(taxHints(report({ paidCents: 0 }), 'ist')).toContain('noPaymentsRecorded')
    // Beim Soll ist die 0 nicht die angesetzte Zahl, der Hinweis ginge dort ins Leere.
    expect(taxHints(report({ paidCents: 0 }), 'soll')).not.toContain('noPaymentsRecorded')
  })

  it('schweigt über fehlende Zahlungen, wenn es auch kein Soll gibt', () => {
    // Ein Jahr ohne Mietverhältnis ist kein Versäumnis. Ohne diese Bedingung bekäme jeder, der
    // ein künftiges Jahr aufschlägt, eine Ermahnung für etwas, das es nicht gibt.
    expect(taxHints(report({ paidCents: 0, sollCents: 0 }), 'ist')).not.toContain('noPaymentsRecorded')
  })

  it('erklärt die Jahreskorrektur, sobald es eine gibt', () => {
    // Der Unterschied, um den es in #70 geht: Die Abrechnung setzt die tatsächlich geleisteten
    // Vorauszahlungen an, diese Übersicht führt daneben das vereinbarte Soll. Beide Zahlen sind
    // richtig, und solange keine von beiden es sagt, hält jeder Leser eine für falsch.
    const mitKorrektur = report({ prepaymentOverridden: true, prepaymentSettlementCents: 180000 })
    expect(taxHints(mitKorrektur, 'ist')).toContain('prepaymentOverridden')
    expect(taxHints(mitKorrektur, 'soll')).toContain('prepaymentOverridden')
    expect(taxHints(report({}), 'ist')).not.toContain('prepaymentOverridden')
  })
})

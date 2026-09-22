import { describe, expect, it } from 'vitest'
import type { TaxReport } from './types'
import { DEFAULT_BASIS, incomeCentsFor, prepaymentNote, surplusCentsFor, taxHints } from './taxView'

// Ein Bericht, in dem nur das steht, was die Hinweise lesen. Die übrigen Felder füllt der Typ
// ab, damit der Übersetzer mitprüft, dass die Hinweise wirklich einen TaxReport lesen.
const report = (income: Partial<TaxReport['income']>, rest: Partial<TaxReport> = {}): TaxReport => ({
  year: 2025,
  income: {
    baseRentSollCents: 960000,
    prepaymentSollCents: 240000,
    prepaymentSettlementCents: 240000,
    prepaymentOverridden: false,
    sollCents: 1200000,
    paidCents: 1200000,
    tenanciesWithSoll: 1,
    tenanciesWithoutPayment: 0,
    ...income,
  },
  expenses: { groups: [], totalCents: 0, labor35aCents: 0 },
  rentedAreaShare: 1,
  selfOccupiedExists: false,
  selfUsedShareCents: 0,
  surplusSollCents: 1100000,
  surplusPaidCents: 900000,
  ...rest,
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

  it('setzt auf der Ist-Grundlage wirklich das Zugeflossene an', () => {
    // **Ohne diesen Test war die Kernaussage des Umbaus ungeprüft.** Die Durchsicht hat gemessen:
    // Vertauscht man in den beiden Funktionen Soll und Ist, bleibt die ganze Client-Suite grün.
    // Das Auswahlfeld sagte dann weiter „tatsächlich gezahlt", angesetzt würde das Soll, und die
    // Anlage V bekäme wieder die unsichtbar falsche Zahl. Geprüft war nur der Name der Vorgabe,
    // nicht die Zahl, die daraus folgt.
    const r = report({})
    expect(incomeCentsFor(r, 'ist')).toBe(1200000)
    expect(surplusCentsFor(r, 'ist')).toBe(900000)
    expect(incomeCentsFor(r, 'soll')).toBe(1200000)
    expect(surplusCentsFor(r, 'soll')).toBe(1100000)
    // Und die beiden Grundlagen dürfen sich nicht dieselbe Zahl teilen, sonst prüfte der Test
    // oben nichts: Bei gleichen Werten fiele ein Vertauschen nicht auf.
    const verschieden = report({ paidCents: 900000 })
    expect(incomeCentsFor(verschieden, 'ist')).toBe(900000)
    expect(incomeCentsFor(verschieden, 'soll')).toBe(1200000)
  })

  it('sagt es, wenn jemand auf das Soll umschaltet', () => {
    expect(taxHints(report({}), 'soll')).toContain('sollIsNotTaxBasis')
    expect(taxHints(report({}), 'ist')).not.toContain('sollIsNotTaxBasis')
  })

  it('bringt auf der Soll-Grundlage keine Hinweise, die nur das Ist betreffen', () => {
    // Auf der Soll-Grundlage ist weder die fehlende Zahlung noch der Jahreswechsel eine Frage:
    // Beide betreffen den Zufluss, und der ist dort nicht die angesetzte Zahl.
    expect(taxHints(report({ tenanciesWithoutPayment: 1 }), 'soll')).toEqual(['sollIsNotTaxBasis'])
  })

  it('erklärt die 0 €, wenn für kein Mietverhältnis eine Zahlung erfasst ist', () => {
    // Ohne diesen Hinweis stünde dort eine 0 ohne Grund, und der nächste Griff wäre das
    // Umschalten auf das Soll — also genau zurück in den Fehler.
    const hints = taxHints(report({ paidCents: 0, tenanciesWithSoll: 2, tenanciesWithoutPayment: 2 }), 'ist')
    expect(hints).toContain('noPaymentsRecorded')
    expect(hints).not.toContain('paymentsIncomplete')
  })

  it('warnt auch, wenn nur ein Teil der Mietverhältnisse ohne Zahlung dasteht', () => {
    // **Der gefährlichere der beiden Fälle, und bisher fiel er durch.** Der Hinweis hing an
    // „Summe ist null". Sind für einen Mieter Zahlungen erfasst und für einen zweiten nicht, ist
    // die Summe größer als null, es erschien kein Hinweis, und eine zu niedrige Einnahme ginge
    // ohne Vorbehalt in die Anlage V. Der einzige Anhalt war die Klammer „(Rückstand offen)",
    // und die klingt nach säumigem Mieter und nicht nach unvollständiger Erfassung.
    const hints = taxHints(report({ tenanciesWithSoll: 2, tenanciesWithoutPayment: 1 }), 'ist')
    expect(hints).toContain('paymentsIncomplete')
    expect(hints).not.toContain('noPaymentsRecorded')
  })

  it('schweigt über fehlende Zahlungen, wenn es auch kein Soll gibt', () => {
    // Ein Jahr ohne Mietverhältnis ist kein Versäumnis. Ohne diese Bedingung bekäme jeder, der
    // ein künftiges Jahr aufschlägt, eine Ermahnung für etwas, das es nicht gibt.
    const hints = taxHints(report({ paidCents: 0, sollCents: 0, tenanciesWithSoll: 0, tenanciesWithoutPayment: 0 }), 'ist')
    expect(hints).not.toContain('noPaymentsRecorded')
    expect(hints).not.toContain('paymentsIncomplete')
  })

  it('nennt den Vorbehalt zum Jahreswechsel auf der Ist-Grundlage', () => {
    // Er stand als Bedingung in der Seite und war damit ungeprüft, obwohl der CHANGELOG ihn als
    // eigenes Verhalten führt.
    expect(taxHints(report({}), 'ist')).toContain('turnOfYear')
    expect(taxHints(report({}), 'soll')).not.toContain('turnOfYear')
  })
})

describe('Steuerübersicht: der Unterschied zur Abrechnung (#70)', () => {
  it('schweigt, solange beide Zahlen dieselbe sind', () => {
    expect(prepaymentNote(report({}))).toBeNull()
  })

  it('meldet den Unterschied auch ohne Jahreskorrektur', () => {
    // **Der Befund der Durchsicht, und es ist #70 eine Ecke weiter.** Der erste Entwurf löste den
    // Hinweis an der Jahreskorrektur aus. Den Unterschied gibt es aber auch ohne sie: Das
    // Mietkonto führt jedes Mietverhältnis mit Überlappung im Jahr, die Abrechnung nur die auf
    // beteiligten Wohnungen. Eine vermietete Wohnung außerhalb der Abrechnungseinheit ergibt
    // damit zwei verschiedene Zahlen und bisher kein Wort dazu.
    const note = prepaymentNote(report({ prepaymentSollCents: 480000, prepaymentSettlementCents: 240000 }))
    expect(note).toEqual({ settlementCents: 240000, sollCents: 480000, jahreskorrektur: false })
  })

  it('schweigt, wenn eine Jahreskorrektur zufällig dem Soll entspricht', () => {
    // Die Gegenrichtung desselben Fehlers: Ein Hinweis, der einen Unterschied erklärt, den es
    // nicht gibt, ist schlimmer als keiner.
    expect(prepaymentNote(report({ prepaymentOverridden: true }))).toBeNull()
  })

  it('nennt die Jahreskorrektur, wenn die Abrechnung eine ansetzt', () => {
    const note = prepaymentNote(report({ prepaymentSettlementCents: 180000, prepaymentOverridden: true }))
    expect(note?.jahreskorrektur).toBe(true)
    expect(note?.settlementCents).toBe(180000)
  })
})

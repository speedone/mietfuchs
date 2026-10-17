// Eine vom Code unabhängige Referenz für die Steuerübersicht (#255, Durchsicht von PR 1, K3): je Startwert des
// Generators (taxStock.ts) eine Prüfsumme über die Zahlen der Steuerübersicht und die Auswahl des Steuer-ZIP, für jedes
// Objekt, jedes Steuerjahr und offen wie abgeschlossen. Die Prüfsummen stehen in test/fixtures/tax-golden.json und
// entstanden mit dem Code von origin/main (e1630b5, nach #325). Die Invariante in outflow.test.ts vergleicht damit;
// die eingefrorene Auswahl daneben ruft den heutigen `taxReport` und prüft deshalb nur die Auswahl.
//
// **Mit einer bewussten Abweichung vom Bestand**: Erzeugt wurde auf den Beständen mit dem Abzug des Betriebsstroms im
// Jahr seiner Stromrechnung (`withDeductionsInBillYear`), denn das ist seit #267 die Regel. Für jeden Bestand, in dem
// kein Abzug ein anderes Jahr trägt als seine Stromrechnung, ist das der Bestand selbst; und nur dort, wo eines
// abweicht, darf sich seit #267 eine Zahl ändern, und zwar genau so, als stünde der Abzug im Jahr seiner Rechnung.
//
// **Und mit einer zweiten (Durchsicht von PR 2, M1)**: Zeigt in einem Steuerjahr ein Abzug beim Betriebsstrom auf eine
// Heizposition, die nicht im selben Teil steht (`pairAcrossParts`), nimmt der Ausgleich seit M1 den Heizanteil aus dem
// Teil der Heizposition und nicht mehr aus dem des Abzugs. Für solche Jahre gehen nur die Beträge in die Prüfsumme
// (`taxAmounts`), der private Teil nicht; ihn prüft die Invariante S1 in invariant-betriebsstrom-steuer.test.ts über alle
// Jahre zusammen.
//
// Neu erzeugen nur, wenn sich eine Zahl gewollt ändert (`TAX_GOLDEN_WRITE=1 node --test test/outflow.test.ts`), und
// dann im Commit sagen, welche und warum. Ändert sich der Generator, ändern sich alle Prüfsummen.
import crypto from 'node:crypto'
import { taxPartsFor } from '../src/calc.ts'
import type { TaxReport } from '../../shared/types.ts'
import type { TaxSource } from './taxStock.ts'

// Der Abzug im Jahr seiner Stromrechnung: das angegebene Jahr der Rechnung, sonst keines (dann gilt bei beiden der
// Beginn des gemeinsamen Zeitraums).
export function withDeductionsInBillYear(source: TaxSource): TaxSource {
  const byId = new Map(source.costItems.map((c) => [c.id, c]))
  const costItems = source.costItems.map((c) => {
    if (c.operatingPower !== 'deduction' || c.operatingPowerGeneralId === undefined) return c
    const g = byId.get(c.operatingPowerGeneralId)
    if (g === undefined) return c
    const { taxYear: _, ...rest } = c
    return g.taxYear === undefined ? rest : { ...rest, taxYear: g.taxYear }
  })
  return { ...source, costItems } as TaxSource
}

// Wie viele Abzüge ein anderes Jahr tragen als ihre Stromrechnung (die Lage von #267).
export function deductionsOffBillYear(source: TaxSource): number {
  const byId = new Map(source.costItems.map((c) => [c.id, c]))
  return source.costItems.filter((c) => {
    if (c.operatingPower !== 'deduction' || c.operatingPowerGeneralId === undefined) return false
    const g = byId.get(c.operatingPowerGeneralId)
    return g !== undefined && (g.taxYear ?? null) !== (c.taxYear ?? null)
  }).length
}

// Die Einnahmen ohne die Felder, die nach dem Erzeugen der Prüfsummen hinzukamen, solange sie 0 sind: Nachzahlungen
// und Erstattungen aus der Abrechnung (#280). Der Generator kennt keine Art der Zahlung, jede ist Miete, beide sind dort
// immer 0; stünde eine Zahl darin, ginge sie wie jede andere in die Prüfsumme ein.
function incomeFingerprint(income: TaxReport['income']): unknown {
  const { settlementBackPaymentsCents, settlementRefundsCents, ...rest } = income
  return settlementBackPaymentsCents === 0 && settlementRefundsCents === 0 ? rest : income
}

// Die Zahlen der Steuerübersicht, ohne Texte, Rechenwege und Felder, die nur Auskunft sind: Ein neues Feld oder ein
// anderer Wortlaut soll die Prüfsumme nicht ändern, eine andere Zahl schon.
export function taxFingerprint(r: TaxReport): unknown {
  const e = r.expenses
  return {
    income: incomeFingerprint(r.income),
    expenses: [e.totalCents, e.privateCents, e.deductibleCents, e.labor35aCents, e.stockCarrySelfCents ?? null],
    groups: e.groups.map((g) => [g.group, g.amountCents, g.labor35aCents, g.privateCents, g.deductibleCents,
      g.categories.map((c) => [c.category, c.amountCents, c.labor35aCents, c.privateCents, c.deductibleCents])]),
    items: e.items.map((i) => [i.costItemId, i.category, i.group, i.amountCents, i.privateCents, i.deductibleCents, i.labor35aCents, i.allocation]),
    other: [r.selfUsedShareCents, r.reserveContributionCents, r.surplusSollCents, r.surplusPaidCents, r.closedItemsChanged,
      r.operatingPowerBalanceCents ?? null, r.operatingPowerKeptCents ?? null],
  }
}

export const sha256 = (value: unknown): string => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

// Ein Abzug beim Betriebsstrom, dessen Heizposition nicht im selben Teil der Steuerübersicht dieses Jahres steht (anderes
// Steuerjahr oder anderer Zeitraum). Gefragt wird an den Teilen, wie `taxPartsFor` sie bildet.
export function pairAcrossParts(source: TaxSource, propertyId: string, year: number): boolean {
  try {
    return taxPartsFor(source, propertyId, year).filter((p) => !p.carryOnly).some((p) => p.items.some((d) =>
      d.operatingPower === 'deduction' && d.operatingPowerItemId !== undefined && !p.items.some((c) => c.id === d.operatingPowerItemId)))
  } catch {
    return false
  }
}

// Die Beträge der Steuerübersicht ohne den privaten und den abziehbaren Teil.
export function taxAmounts(r: TaxReport): unknown {
  const e = r.expenses
  return {
    income: incomeFingerprint(r.income),
    expenses: [e.totalCents, e.labor35aCents],
    groups: e.groups.map((g) => [g.group, g.amountCents, g.labor35aCents, g.categories.map((c) => [c.category, c.amountCents, c.labor35aCents])]),
    items: e.items.map((i) => [i.costItemId, i.category, i.group, i.amountCents, i.labor35aCents]),
    // Ohne den Überschuss: Er rechnet mit dem abziehbaren Teil.
    other: [r.selfUsedShareCents, r.reserveContributionCents, r.closedItemsChanged, r.operatingPowerBalanceCents ?? null, r.operatingPowerKeptCents ?? null],
  }
}

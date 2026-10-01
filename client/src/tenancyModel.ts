import type { CostModel, NotSettled } from './types'

// Das Nebenkostenmodell am Mietverhältnis (#93) in der Oberfläche: Beschriftungen und der Rumpf.
// Die Regeln der Berechnung stehen in calc.ts; hier steht nur, wie sie heißen.

export const COST_MODEL_LABELS: Record<CostModel, string> = {
  settlement: 'Vorauszahlung mit Abrechnung',
  flatRate: 'Pauschale (keine Abrechnung)',
  inclusive: 'in der Miete enthalten (Inklusiv-/Warmmiete)',
}

// Die Staffel der Pauschale erscheint nur, wenn eine der beiden Arten pauschal ist. Sie ist eine
// eigene Staffel und nicht die der Vorauszahlung: Das Mietkonto führt sie im Soll, die
// Abrechnung rechnet sie nie an.
export function showsFlatRates(costModel: CostModel | undefined, heatingModel: CostModel | undefined): boolean {
  return costModel === 'flatRate' || heatingModel === 'flatRate'
}

// „Abrechnung“ ist die Voreinstellung und wird als null gespeichert.
export function costModelBody(costModel: CostModel, heatingModel: CostModel): { costModel: CostModel | null, heatingModel: CostModel | null } {
  return {
    costModel: costModel === 'settlement' ? null : costModel,
    heatingModel: heatingModel === 'settlement' ? null : heatingModel,
  }
}

const WORDS: Record<CostModel, string> = { settlement: 'abgerechnet', flatRate: 'als Pauschale', inclusive: 'in der Miete enthalten' }

// Eine Zeile im Kasten „Ohne Abrechnung“ auf der Seite Abrechnung.
export function notSettledText(n: NotSettled): string {
  const teile = [`Nebenkosten ${WORDS[n.costModel]}`]
  if (n.heatingModel !== 'settlement') teile.push(`Heizung ${WORDS[n.heatingModel]}`)
  return `${n.tenantName} (${n.unitName}): ${teile.join(', ')}`
}

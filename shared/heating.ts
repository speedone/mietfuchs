// Heizung und Warmwasser nach der Heizkostenverordnung (#93, #140), für Server und Oberfläche
// gemeinsam: Die Berechnung meldet daraus ihre Hinweise, das Cockpit seine Ampel. Stünde die Regel
// zweimal da, könnte das Cockpit „Ablesungen nicht erforderlich“ sagen, während die Abrechnung
// den Kürzungsbetrag nennt.
import type { CostKey } from './types.ts'

// Die Kostenart, an der Mietfuchs Heizung und Warmwasser erkennt. Dieselbe Zeichenkette steht in
// CATEGORIES (client/src/types.ts) und im Kategorie-Schema der KI-Auswertung.
export const HEATING_CATEGORY = 'Heizung und Warmwasser'

// § 2 HeizkostenV: Die Verordnung geht einer Vereinbarung vor, außer bei Gebäuden mit nicht mehr
// als zwei Wohnungen, von denen eine der Vermieter selbst bewohnt. Das Gesetz zählt die
// Wohnungen im Gebäude, also alle des Objekts und nicht nur die beteiligten. Eine vermietete
// Eigentumswohnung in einer großen Anlage erkennt Mietfuchs daran nicht (nur die Zahl der
// angelegten Wohnungen, nicht die der Anlage).
export function heatingOrdinanceExempt(units: readonly { participates: boolean; selfUsed?: boolean }[]): boolean {
  return units.length <= 2 && units.some((u) => u.selfUsed === true && !u.participates)
}

// Gilt eine Position als nach Verbrauch verteilt? Nach Zählern (`meter`), als Einzelbeträge aus
// der fertigen Abrechnung eines Messdienstes (`amounts`) oder laut Gemeinschaftsabrechnung
// (`external`), die bei einer Eigentumswohnung die Heizkostenabrechnung der Gemeinschaft enthält.
// Alle übrigen Schlüssel verteilen ohne jeden Verbrauchsanteil (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV).
export function heatingByConsumption(key: CostKey): boolean {
  return key === 'meter' || key === 'amounts' || key === 'external'
}

// Positionen der Heizkostenart, die gegen die Verordnung nicht nach Verbrauch verteilt werden.
// Leer im Fall der Ausnahme des § 2.
export function heatingNotByConsumption<T extends { category: string; key: CostKey }>(
  items: readonly T[],
  units: readonly { participates: boolean; selfUsed?: boolean }[],
): T[] {
  if (heatingOrdinanceExempt(units)) return []
  return items.filter((c) => c.category === HEATING_CATEGORY && !heatingByConsumption(c.key))
}

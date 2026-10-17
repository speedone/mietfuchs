// Heizung und Warmwasser nach der Heizkostenverordnung (#93, #140). Die Berechnung leitet daraus
// ihre Hinweise ab, und das Cockpit liest diese Hinweise (client/src/meterCheck.ts); so sagen
// beide dasselbe, und das Cockpit kann nicht „Ablesungen nicht erforderlich“ melden, während die
// Abrechnung einen Kürzungsbetrag nennt.
import type { CostKey, EstimatePart, SelfPot } from './types.ts'

// Die Kostenart, an der Mietfuchs Heizung und Warmwasser erkennt. Dieselbe Zeichenkette steht in
// CATEGORIES (client/src/types.ts) und im Kategorie-Schema der KI-Auswertung.
export const HEATING_CATEGORY = 'Heizung und Warmwasser'

type HeatingUnit = { id: string; participates: boolean; selfUsed?: boolean }
type HeatingItem = { id: string; category: string; key: CostKey; amountCents: number; participantUnitIds?: string[] | null }

// § 2 HeizkostenV: Außer bei Gebäuden mit nicht mehr als zwei Wohnungen, von denen eine der
// Vermieter selbst bewohnt, geht die Verordnung einer Vereinbarung vor. Dort darf also anderes
// vereinbart werden; ohne eine solche Vereinbarung gilt sie auch dort.
// Gezählt werden die Wohnungen des Objekts, nicht nur die beteiligten. Was eine Wohnung ist, sagt
// `isDwelling` (calc.ts): Fläche oder Bewohner. Eine Einheit ohne beides (Garage, Stellplatz, Lager,
// auch leer oder außerhalb der Abrechnungseinheit) zählt nicht; eine bewohnte mit vergessener
// Fläche zählt, sonst würde aus einem Dreifamilienhaus ein Zweifamilienhaus.
// Eine vermietete Eigentumswohnung in einer großen Anlage erkennt Mietfuchs daran nicht (nur die
// Zahl der angelegten Wohnungen, nicht die der Anlage).
export function mayAgreeOtherwise<U extends HeatingUnit>(units: readonly U[], isDwelling: (u: U) => boolean): boolean {
  const dwellings = units.filter(isDwelling)
  return dwellings.length <= 2 && dwellings.some((u) => u.selfUsed === true && !u.participates)
}

// Gilt eine Position als nach Verbrauch verteilt? Nach Zählern (`meter`), als Einzelbeträge aus
// der fertigen Abrechnung eines Messdienstes (`amounts`) oder laut Gemeinschaftsabrechnung
// (`external`), die bei einer Eigentumswohnung die Heizkostenabrechnung der Gemeinschaft enthält.
export function heatingByConsumption(key: CostKey): boolean {
  // Heizung PR 10: auch nach der eigenen Heizkostenabrechnung (`heatingSystem`), deren Grund- und
  // Verbrauchsanteil die Verordnung selbst festlegt.
  return key === 'meter' || key === 'amounts' || key === 'external' || key === 'heatingSystem'
}

// Die Befunde eines Jahres. Eine Direktzuordnung (`direct`, etwa die Wartung der Gastherme einer
// Wohnung) verteilt nichts und bleibt außen vor.
//
// - `withoutConsumption`: je Position ohne Verbrauchsanteil die Wohnungen, die im Jahr **nicht**
//   nach Verbrauch gedeckt sind. Nur sie dürfen nach § 12 Abs. 1 kürzen; eine Grundkostenposition
//   nach Fläche neben einer Verbrauchsposition ist der Normalfall der Verordnung (§ 7 Abs. 1, § 8
//   Abs. 1: der Rest nach Fläche). **Gedeckt** (`covered`) ist eine Wohnung erst, wenn sie aus
//   einer Verbrauchsposition mit positivem Betrag einen positiven Anteil bekommen hat; das weiß
//   erst die Verteilung, deshalb bestimmt es calc.ts. Eine Gutschrift nach Wärmezähler oder eine
//   Verbrauchsposition ohne Ablesungen deckt nichts (Integrationsdurchsicht).
// - `shareOutside`: Wohnungsgruppen mit beidem, bei denen der Anteil nach Zählern außerhalb von 50
//   bis 70 % der Heizkosten liegt. Gerechnet wird **netto**, also mit verrechneten Gutschriften:
//   Die Verordnung meint die tatsächlich verteilten Kosten (letzte Durchsicht). Ist eine der beiden
//   Nettosummen nicht positiv, gibt es keinen sinnvollen Prozentsatz und keinen Hinweis. Nur für
//   Positionen nach Zählern, denn Einzelbeträge und die Gemeinschaftsabrechnung enthalten ihre
//   Grundkosten schon.
export type HeatingFindings = {
  withoutConsumption: Map<string, Set<string>>
  shareOutside: { unitIds: string[]; itemIds: string[]; consumptionCents: number; totalCents: number }[]
}

// `consumptionShare` liefert die Grenzen aus dem Rechtsregister (`hkv.consumption-share`) und wird
// nur aufgerufen, wenn es eine Gruppe zu prüfen gibt; so trägt die Abrechnung den Wert nur ein,
// wenn sie ihn benutzt hat.
export function heatingFindings(
  items: readonly HeatingItem[],
  units: readonly HeatingUnit[],
  covered: ReadonlySet<string>,
  consumptionShare: () => { readonly min: number; readonly max: number },
): HeatingFindings {
  const heating = items.filter((c) => c.category === HEATING_CATEGORY && c.key !== 'direct')
  const takesPart = (c: HeatingItem, unitId: string) => !c.participantUnitIds || c.participantUnitIds.includes(unitId)
  const withoutConsumption = new Map<string, Set<string>>()
  for (const c of heating.filter((x) => !heatingByConsumption(x.key))) {
    const affected = new Set(units.filter((u) => takesPart(c, u.id) && !covered.has(u.id)).map((u) => u.id))
    if (affected.size > 0) withoutConsumption.set(c.id, affected)
  }
  // Gruppen: Wohnungen mit derselben Menge an Positionen haben denselben Anteil.
  const groups = new Map<string, { unitIds: string[]; itemIds: string[]; consumptionCents: number; totalCents: number }>()
  for (const u of units) {
    const own = heating.filter((c) => takesPart(c, u.id))
    const metered = own.filter((c) => c.key === 'meter')
    const other = own.filter((c) => !heatingByConsumption(c.key))
    if (metered.length === 0 || other.length === 0 || own.some((c) => c.key === 'amounts' || c.key === 'external' || c.key === 'heatingSystem')) continue
    const key = own.map((c) => c.id).join('\u0000')
    const g = groups.get(key) ?? {
      unitIds: [],
      itemIds: own.map((c) => c.id),
      consumptionCents: metered.reduce((a, c) => a + c.amountCents, 0),
      totalCents: own.reduce((a, c) => a + c.amountCents, 0),
    }
    g.unitIds.push(u.id)
    groups.set(key, g)
  }
  const candidates = [...groups.values()].filter((g) => g.totalCents > 0 && g.consumptionCents > 0)
  if (candidates.length === 0) return { withoutConsumption, shareOutside: [] }
  const { min, max } = consumptionShare()
  const shareOutside = candidates.filter((g) => g.consumptionCents * 100 < g.totalCents * min || g.consumptionCents * 100 > g.totalCents * max)
  return { withoutConsumption, shareOutside }
}

// Die Töpfe der Schätzung (Heizung PR 13): `heat`/`water` in der Tabelle (Entwurf 5.6),
// `heating`/`water` in der Rechnung (server/src/heating.ts).
export const POT_OF_PART: Record<EstimatePart, SelfPot> = { heat: 'heating', water: 'water' }
export const PART_OF_POT: Record<SelfPot, EstimatePart> = { heating: 'heat', water: 'water' }

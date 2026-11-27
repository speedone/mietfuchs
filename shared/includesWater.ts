// Sammelbetrag des Messdienstes (#704): Manche Messdienste rechnen Heizung, Warmwasser, Kaltwasser und Abwasser in einem
// Betrag je Nutzer ab. Der Vermieter übernimmt ihn als Position „Heizung und Warmwasser“ mit Einzelbeträgen und sagt mit
// einem Haken, dass Wasser darin steckt (`CostItem.includesWater`). Die Kostenart bleibt der Datenwert; wie die Zeile
// heißt, steht nur hier, für die Abrechnung des Mieters, die Aufstellung des Vermieters und den Export.
import { HEATING_CATEGORY } from './heating.ts'

export const WATER_CATEGORY = 'Wasser/Abwasser'

// Der Zusatz hinter der Kostenart in der gedruckten Abrechnung.
export const INCLUDES_WATER_SUFFIX = 'einschließlich Kaltwasser und Abwasser (laut Abrechnung des Messdienstes)'

// Die Beschriftung des Hakens im Kostenformular; Lexikon, Anleitung und Hinweise nennen sie wörtlich.
export const INCLUDES_WATER_LABEL = 'Der Betrag enthält auch Kaltwasser und Abwasser (der Messdienst rechnet sie in einem Betrag je Nutzer ab)'

// Wo die Angabe gilt: nur an einer Position „Heizung und Warmwasser“ mit Einzelbeträgen. Formular und Server fragen
// dieselbe Regel; an jeder anderen Position fällt die Angabe beim Speichern weg.
export const allowsIncludesWater = (item: { category: string; key: string }): boolean =>
  item.category === HEATING_CATEGORY && item.key === 'amounts'

// Die Kostenart, wie sie in der Abrechnung steht. Ohne die Angabe wortgleich die Kostenart.
export const categoryLabelOf = (row: { category: string; includesWater?: boolean | undefined }): string =>
  row.includesWater === true ? `${row.category} ${INCLUDES_WATER_SUFFIX}` : row.category

// Der Satz zur Doppelerfassung (#704): im Hinweis der Abrechnung und im Kostenformular derselbe. `combined` ist die
// Position mit dem Sammelbetrag, `water` die Position „Wasser/Abwasser“ daneben; die Beträge schon als Text.
export const waterTwiceText = (combined: { description: string; amount: string }, water: { description: string; amount: string }): string =>
  `„${combined.description}“ (${combined.amount}) enthält nach Ihrer Angabe auch Kaltwasser und Abwasser, und daneben wird „${water.description}“ (${water.amount}) mit der Kostenart „${WATER_CATEGORY}“ auf dieselben Mieter umgelegt. ` +
  'Prüfen Sie, ob das dieselben Kosten sind: Hat der Messdienst die Rechnung des Wasserversorgers schon in seinen Beträgen je Nutzer verteilt, tragen die Mieter sie so zweimal. ' +
  'Dann erfassen Sie die Rechnung des Versorgers nicht als eigene umlagefähige Position. Betrifft die zweite Position anderes Wasser, das der Messdienst nicht abgerechnet hat, etwa Gartenwasser, ist nichts zu tun.'

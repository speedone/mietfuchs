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

// Der Satz zur Doppelerfassung (#704): im Hinweis der Abrechnung und im Kostenformular derselbe. Der Rat heißt „gar nicht
// erfassen“ und nicht „nicht umlagefähig“ (Durchsicht S3): Als „Nicht umlagefähig“ stünde das Wasser, das schon im Betrag
// des Messdienstes steckt, ein zweites Mal in den Werbungskosten. `combined` ist die
// Position mit dem Sammelbetrag, `water` die Position „Wasser/Abwasser“ daneben; die Beträge schon als Text.
export const waterTwiceText = (combined: { description: string; amount: string }, water: { description: string; amount: string }): string =>
  `„${combined.description}“ (${combined.amount}) enthält nach Ihrer Angabe auch Kaltwasser und Abwasser, und daneben wird „${water.description}“ (${water.amount}) mit der Kostenart „${WATER_CATEGORY}“ auf dieselben Mieter umgelegt. ` +
  'Prüfen Sie, ob das dieselben Kosten sind: Hat der Messdienst die Rechnung des Wasserversorgers schon in seinen Beträgen je Nutzer verteilt, tragen die Mieter sie so zweimal. ' +
  'Dann erfassen Sie die Rechnung des Versorgers gar nicht als eigene Position; ihre Kosten stecken schon im Betrag des Messdienstes. ' +
  'Betrifft die zweite Position anderes Wasser, etwa Wasser einer Wohnung, die der Messdienst nicht abrechnet, oder Gartenwasser, ist nichts zu tun.'

// ---------- Rechtslage der Sammelzeile (gelesen am 27.11.2026, Volltexte auf bundesgerichtshof.de) ----------
// Belegt ist nur, was hier steht, mit genau diesen Fundstellen; die beiden Entscheidungen zur Anlage sind Beschlüsse.
// Getrennt nach Kostenarten, zusammenfassen nur bei engem sachlichem Zusammenhang (so Frisch- und Abwasser bei
// einheitlicher Umlage): VIII ZR 340/08, Rn. 19. Unzulässige Zusammenfassung ist ein formeller Mangel der Position:
// VIII ZR 285/09, Rn. 40 bis 42; nach Ablauf der Abrechnungsfrist nicht mehr heilbar: VIII ZR 1/06, Rn. 11, 12. Einzeln
// ausgewiesenes Kaltwasser und Entwässerung dürfen in der Heizkostenabrechnung stehen: VIII ZR 268/10, Rn. 11. Ob die
// Aufschlüsselung in einer beigelegten Abrechnung genügt, ist für diesen Fall nicht entschieden: VIII ZR 371/19, Rn. 14
// („gegebenenfalls auch in einer Anlage“) gegen VIII ZR 285/15, Rn. 5 bis 7 (ein mitgeschickter Bescheid half nicht).
// Mietfuchs sperrt deshalb nicht (Zielbild: angreifbar heißt unterstützt, mit Warnung und Betrag), sondern warnt.
export const COMBINED_LINE_SEPARATE = 'BGH, Urteil vom 15.07.2009, VIII ZR 340/08, Rn. 19'
export const COMBINED_LINE_FORMAL = 'BGH, Urteil vom 22.09.2010, VIII ZR 285/09, Rn. 40 bis 42; Urteil vom 14.02.2007, VIII ZR 1/06, Rn. 11, 12'
export const COMBINED_LINE_ENCLOSURE = 'BGH, Beschluss vom 06.07.2021, VIII ZR 371/19, Rn. 14; Beschluss vom 24.01.2017, VIII ZR 285/15, Rn. 5 bis 7'
export const COMBINED_LINE_HEATING_BILL = 'BGH, Urteil vom 26.10.2011, VIII ZR 268/10, Rn. 11'
// Für das Feld `norm` in Lexikon und Anleitung.
export const COMBINED_LINE_NORM = `${COMBINED_LINE_SEPARATE}; ${COMBINED_LINE_FORMAL}; ${COMBINED_LINE_HEATING_BILL}; zur Aufschlüsselung in einer Anlage ${COMBINED_LINE_ENCLOSURE}`
// Der Satz zur Rechtslage am Haken, in Lexikon und Anleitung derselbe.
export const COMBINED_LINE_RISK = 'Eine solche Sammelzeile ist formell angreifbar: Ob die beiliegende Abrechnung des Messdienstes als Aufschlüsselung genügt, hat der Bundesgerichtshof nicht entschieden. Sicher sind getrennte Positionen für Heizung und Warmwasser sowie für Kaltwasser und Abwasser.'
// Der Hinweis `amounts.combined-line` der Abrechnung. `affected`: die Mieter mit dem Betrag ihrer Zeile, schon verbunden.
// „Bis zu“: Verloren wäre nur eine Nachforderung aus dieser Position, nicht eine gezahlte Vorauszahlung.
export const combinedLineText = (description: string, affected: string): string =>
  `„${description}“ fasst Heizung, Warmwasser, Kaltwasser und Abwasser in einer Zeile zusammen. ` +
  `Eine Betriebskostenabrechnung muss die Kosten nach Kostenarten trennen; zusammenfassen darf sie nur Kostenarten, die sachlich eng zusammenhängen (${COMBINED_LINE_SEPARATE}). ` +
  `Ob es genügt, dass die beiliegende Abrechnung des Messdienstes sie aufschlüsselt, hat der Bundesgerichtshof nicht entschieden (${COMBINED_LINE_ENCLOSURE}). ` +
  `Hält ein Gericht die Zeile für einen Formfehler, können Sie nach Ablauf der Abrechnungsfrist aus dieser Position nichts nachfordern (${COMBINED_LINE_FORMAL}); gezahlte Vorauszahlungen sind davon nicht berührt. ` +
  `Betroffen wäre hier eine Nachforderung von bis zu: ${affected}. ` +
  'Sicher ist es, Heizung und Warmwasser sowie Kaltwasser und Abwasser als getrennte Positionen mit den Beträgen aus der Einzelabrechnung zu erfassen. Legen Sie die Einzelabrechnung des Messdienstes in jedem Fall bei.'

// Die Kostenarten und was an ihnen hängt (Belegbuchung, #170). Bis hierher standen sie in
// client/src/types.ts; seit der Server die KI-Zeilen selbst den Kostenarten zuordnet und ihren
// Schlüssel vorschlägt, braucht er dieselbe Liste und dieselbe Zuordnung. Die Oberfläche reicht
// sie weiter, ihre Importe bleiben unverändert. Dieselbe Menge wie NOT_ALLOCABLE_CATEGORIES in
// server/src/calc.ts; categories.test.ts hält beide zusammen.
import type { CostKey } from './types.ts'

export const CATEGORIES = [
  'Grundsteuer',
  'Wasser/Abwasser',
  'Niederschlagswasser',
  'Müllabfuhr',
  'Straßenreinigung',
  'Gebäudereinigung',
  'Gartenpflege',
  'Beleuchtung/Allgemeinstrom',
  'Schornsteinfeger',
  'Sach- und Haftpflichtversicherung',
  'Hauswart',
  'Aufzug',
  'Kabel/Antenne',
  'Heizung und Warmwasser',
  'Sonstige Betriebskosten',
  'Nicht umlagefähig',
  // #143: nicht umlagefähig und steuerlich erst bei Verwendung abziehbar
  'Zuführung Erhaltungsrücklage',
]

// Kostenarten, die nie auf Mieter verteilt werden.
export const NOT_ALLOCABLE: readonly string[] = ['Nicht umlagefähig', 'Zuführung Erhaltungsrücklage']
export const isNotAllocable = (category: string): boolean => NOT_ALLOCABLE.includes(category)

// Ordnet eine frei formulierte Kategorie (z. B. aus der KI-Auswertung) der
// nächstliegenden Betriebskostenart zu, statt hart auf „Sonstige" zu fallen.
export function matchCategory(raw: string): string {
  if (CATEGORIES.includes(raw)) return raw
  const s = raw.toLowerCase()
  if (/müll|abfall|restabfall|biotonne|wertstoff/.test(s)) return 'Müllabfuhr'
  // Vor „Instandhaltung“: Die Instandhaltungsrücklage ist die Zuführung zur Erhaltungsrücklage (#143).
  // Eine Entnahme oder eine Zahlung „aus der Rücklage“ ist keine Zuführung; dieselbe Regel wie
  // `looksLikeReserveContribution` in server/src/calc.ts.
  if (/r(ü|ue|u)cklage/.test(s) && (/zuf(ü|ue|u)hrung/.test(s) || !/entnahme|\baus\s+(der|dem)\b/.test(s))) return 'Zuführung Erhaltungsrücklage'
  // Eine Entnahme oder Zahlung aus der Rücklage ist eine bezahlte Erhaltungsmaßnahme: nicht
  // umlagefähig, aber Werbungskosten (zweite Browserabnahme).
  if (/r(ü|ue|u)cklage/.test(s)) return 'Nicht umlagefähig'
  // Reparaturen, Instandhaltung und Dämmung zuerst: „Heizungsreparatur“ ist nicht umlagefähig und
  // darf nicht über „heiz“ zur Heizkostenart werden.
  if (/instandhalt|reparatur|dämmung|verwaltung|nicht umlage/.test(s)) return 'Nicht umlagefähig'
  // Vor „Wasser“, sonst fiele „Warmwasser“ unter Wasser/Abwasser (#93). Die Messdienste mit
  // Wortgrenze, sonst träfe „ista“ auch „Distanz“.
  if (/heiz|warmwasser|wärme|pellet|\b(techem|ista|brunata|minol)\b/.test(s)) return 'Heizung und Warmwasser'
  if (/niederschlag|regenwasser|oberflächenwasser/.test(s)) return 'Niederschlagswasser'
  if (/wasser|abwasser|kanal/.test(s)) return 'Wasser/Abwasser'
  if (/grundsteuer|grundbesitz/.test(s)) return 'Grundsteuer'
  if (/versicherung|haftpflicht/.test(s)) return 'Sach- und Haftpflichtversicherung'
  if (/straßenreinigung|strassenreinigung|winterdienst/.test(s)) return 'Straßenreinigung'
  if (/schornstein|kamin|feuerstätte/.test(s)) return 'Schornsteinfeger'
  if (/garten|außenanlage|grünpflege/.test(s)) return 'Gartenpflege'
  if (/strom|beleuchtung/.test(s)) return 'Beleuchtung/Allgemeinstrom'
  if (/gebäudereinigung|hausreinigung|treppenhausreinigung/.test(s)) return 'Gebäudereinigung'
  if (/hauswart|hausmeister/.test(s)) return 'Hauswart'
  if (/aufzug|lift/.test(s)) return 'Aufzug'
  if (/kabel|antenne|breitband/.test(s)) return 'Kabel/Antenne'
  return 'Sonstige Betriebskosten'
}

// Sinnvolle Vorbelegung des Umlageschlüssels je Kostenart
export function defaultKeyFor(category: string): CostKey {
  if (category === 'Wasser/Abwasser' || category === 'Müllabfuhr') return 'persons'
  return 'area'
}

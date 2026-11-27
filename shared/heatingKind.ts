// Welche Art von Heizkosten eine Beschreibung erkennbar nennt (Durchsicht von #721 und #720). Gebraucht, wo der Teil der
// Heizkosten (`heatingPart`) fehlt: von der Regel für doppelte Positionen (shared/duplicates.ts, `distinctHeating`) und
// von der Berechnung, die eine Brennstoffrechnung bei Mietern erkennt, die selbst heizen (`heating.fuel-for-self-supply`
// in server/src/calc.ts). Die Arten sind die Rechnungen, die unter „Heizung und Warmwasser“ regelmäßig nebeneinander
// stehen: Brennstoff oder Energie, Betriebsstrom, Wartung, Schornsteinfeger und Messdienst.
//
// Die Liste ist bewusst klein und erkennt nur eindeutige Wörter; was sie nicht kennt, ist `null` und gilt als unbekannt.
// Eine Art, die kein Brennstoff ist, geht vor: „Wartung Ölheizung“ ist Wartung, „Gasthermenwartung“ ebenso, „Abgasmessung“
// ist Schornstein. Strom allein ist keine Art, denn bei Wärmepumpe und Stromheizung ist er die Energie, sonst
// Betriebsstrom; erkannt werden nur „Betriebsstrom“, „Pumpenstrom“ und „Heizstrom“/„Wärmepumpenstrom“.
export type HeatingKind = 'fuel' | 'maintenance' | 'chimney' | 'metering' | 'power'

// Ein Wort, das hier beginnt: am Anfang oder nach einem Zeichen, das kein Buchstabe ist (JavaScripts `\b` kennt keine
// Umlaute, „Öllieferung“ begänne sonst nicht mit einem Wort).
const START = '(?:^|[^\\p{L}])'
const KINDS: readonly [HeatingKind, RegExp][] = [
  ['chimney', /schornstein|kaminkehr|kehrgebühr|abgasmess|emissionsmess|immissionsmess|feuerstättenschau/u],
  ['metering', /messdienst|ablesung|ablesedienst|heizkostenverteiler|zählermiete|gerätemiete|eichaustausch/u],
  ['power', /betriebsstrom|pumpenstrom/u],
  ['maintenance', /wartung|inspektion|reinigung der heizung|kesselreinigung|brennerreinigung/u],
  ['fuel', new RegExp(`heizöl|${START}öl|erdgas|flüssiggas|${START}gas|propan|pellet|hackschnitzel|scheitholz|brennholz|kohle|${START}koks|fernwärme|nahwärme|wärmeliefer|brennstoff|heizstrom|wärmepumpenstrom`, 'u')],
]

export function heatingKindOf(description: string | null | undefined): HeatingKind | null {
  const text = (description ?? '').normalize('NFC').toLowerCase()
  if (text.trim() === '') return null
  return KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null
}

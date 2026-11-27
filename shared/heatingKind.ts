// Welche Art von Heizkosten eine Beschreibung erkennbar nennt (Durchsicht von #721 und #720). Gebraucht, wo der Teil der
// Heizkosten (`heatingPart`) fehlt: von der Regel für doppelte Positionen (shared/duplicates.ts, `distinctHeating`), von
// der Berechnung, die eine Brennstoffrechnung bei Mietern erkennt, die selbst heizen (`heating.fuel-for-self-supply` in
// server/src/calc.ts), und von der Betriebsstromfrage im Kostenformular (client/src/costForm.ts). Die Arten sind die
// Rechnungen, die unter „Heizung und Warmwasser“ regelmäßig nebeneinander stehen: Brennstoff oder Energie, Betriebsstrom,
// Wartung, Schornsteinfeger und Messdienst.
//
// Die Liste erkennt nur eindeutige Wörter; was sie nicht kennt, ist `null` und gilt als unbekannt. Das ist die sichere
// Seite (keine Warnung, die Rückfrage „Dieselbe Rechnung?“ bleibt); eine falsche bekannte Art ist gefährlich, denn die
// Warnung rät, eine Brennstoffrechnung zu löschen. Deshalb (Nachprüfung von #721):
// - Eine Art, die kein Brennstoff ist, geht vor: „Wartung Ölheizung“, „Kundendienst Gastherme“, „Öltankreinigung“ und
//   „Gasleitung Dichtheitsprüfung“ sind Wartung, „Abgasmessung“ ist Schornstein.
// - Brennstoff ist nur, was den Brennstoff oder die Energie selbst nennt und kein Bauteil (Therme, Kessel, Brenner, Tank,
//   Leitung, Zähler, Pumpe): „Gastherme“ oder „Gaszähler Miete“ allein sind unbekannt. Eine Füllung oder Lieferung
//   („Flüssiggas Tankfüllung“) bleibt Brennstoff.
// - Strom allein ist keine Art, denn bei Wärmepumpe und Stromheizung ist er die Energie, sonst Betriebsstrom. Energie
//   ist „Heizstrom“, „Wärmepumpenstrom“, „Nachtspeicherstrom“ und Strom zusammen mit Wärmepumpe oder Nachtspeicher;
//   Betriebsstrom ist „Betriebsstrom“, „Pumpenstrom“ und Strom zusammen mit Pumpe oder Brenner („Umwälzpumpe Strom“).
//   Die Wärmepumpe ist dabei keine Pumpe.
export type HeatingKind = 'fuel' | 'maintenance' | 'chimney' | 'metering' | 'power'

// Ein Wort, das hier beginnt oder endet: am Anfang oder Ende oder neben einem Zeichen, das kein Buchstabe ist
// (JavaScripts `\b` kennt keine Umlaute, „Öllieferung“ begänne sonst nicht mit einem Wort).
const START = '(?:^|[^\\p{L}])'
const END = '(?:$|[^\\p{L}])'

// Auch das Kehren selbst („Kehren 2025“, „Kehrbezirk“), nur am Wortanfang („Rückkehr“ nicht). Dieselbe Liste erkennt
// in server/src/operatingPower.ts (`chimneySweepLike`) eine Rechnung, die keinen Betriebsstrom enthält.
const CHIMNEY = new RegExp(`schornstein|kaminkehr|${START}kehr|abgasmess|emissionsmess|immissionsmess|immissionsschutz|feuerstättenschau`, 'u')
const METERING = /messdienst|ablesung|ablesedienst|heizkostenverteiler|zählermiete|gerätemiete|eichaustausch|eichung|wärmezähler|wärmemengenzähler|verbrauchserfassung|abrechnungsservice|abrechnungsdienst/u
const EXPLICIT_POWER = /betriebsstrom|pumpenstrom/u
// Tätigkeiten an der Anlage: Wartung, Kundendienst, Reparatur, Prüfung, Reinigung, Tausch, Aufbereitung des Heizungswassers.
const MAINTENANCE = /wartung|inspektion|kundendienst|service|reparatur|instandsetz|instandhalt|prüfung|dichtheit|reinigung|tüv|tausch|elektriker|notdienst|störung|ersatzteil|aufbereitung|enthärtung/u
const COMPONENT = /therme|kessel|brenner|tank|leitung|zähler|pumpe/u
const DELIVERY = /füllung|liefer/u
const POWER_WITH = /pumpe|brenner/u
const GENERATION_POWER = /heizstrom|wärmepumpenstrom|wärmepumpentarif|nachtspeicherstrom/u
const GENERATION_WITH = /wärmepumpe|nachtspeicher|speicherheizung/u
const FUEL = new RegExp(`heizöl|${START}öl|erdgas|biogas|flüssiggas|${START}gas|propan|pellet|hackschnitzel|scheitholz|brennholz|${START}holz${END}|kohle|${START}koks|fernwärme|nahwärme|wärmeliefer|${START}wärme${END}|contracting|brennstoff`, 'u')

export function heatingKindOf(description: string | null | undefined): HeatingKind | null {
  const text = (description ?? '').normalize('NFC').toLowerCase()
  if (text.trim() === '') return null
  // Ohne die Wärmepumpe, deren Strom die Energie ist: „Wärmepumpenstrom“ enthält sonst „Pumpenstrom“.
  const withoutHeatPump = text.replaceAll('wärmepumpe', '·')
  const power = /strom/u.test(text)
  if (CHIMNEY.test(text)) return 'chimney'
  if (METERING.test(text)) return 'metering'
  if (EXPLICIT_POWER.test(withoutHeatPump)) return 'power'
  if (MAINTENANCE.test(text)) return 'maintenance'
  if (power && POWER_WITH.test(withoutHeatPump)) return 'power'
  if (GENERATION_POWER.test(text) || (power && GENERATION_WITH.test(text))) return 'fuel'
  if (COMPONENT.test(withoutHeatPump) && !DELIVERY.test(text)) return null
  return FUEL.test(text) ? 'fuel' : null
}

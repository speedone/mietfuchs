// Wärmelieferung (Heizung PR 16, #213): die Naht, über die Contracting wie Fernwärme rechnet. Liegt in
// shared/, weil Server und Formular dieselbe Entscheidung brauchen.
//
// **Eine Naht statt eines Merkmals in jeder Regel.** Bei Contracting bekommt die Berechnung die Anlage mit
// `energy = 'districtHeating'` (`asBilledPlant` in `snapshotFor`), und die Schreibwege fragen
// `billingEnergy`. Daraus folgen nach dem Wortlaut: kein Pflichtanteil nach § 7 Abs. 1 Satz 2 (§ 7 Abs. 3
// HeizkostenV verweist nur auf Abs. 1 Satz 1 und 3 bis 5), ÷ 1,15 für Formelwerte (§ 9 Abs. 2 Satz 6 Nr. 2:
// „bei eigenständiger gewerblicher Wärmelieferung“), kein Vorrat beim Vermieter (er bezahlt Wärme, den
// Brennstoff führt der Lieferant), Lieferungen sind Wärmerechnungen, und CO₂ kommt aus den Angaben des
// Lieferanten (§ 3 Abs. 4 CO2KostAufG).
//
// **Ausnahmen der Naht**, an denen der Brennstoff des Lieferanten (`fuelEnergy`) oder die gespeicherte Energie
// zählt:
// - § 2 Abs. 4 Satz 2 CO2KostAufG (Emissionshandel) hängt an der gespeicherten Energie: Ein Kessel im Haus ist
//   keine Anlage des Emissionshandels (`districtEtsNew` nur bei Fernwärme).
// - Ob CO₂ aufzuteilen ist, entscheidet der eingesetzte Brennstoff (§ 2 Abs. 1 Satz 2 CO2KostAufG,
//   `co2Required` in server/src/co2.ts).
// - Die Informationen nach § 6a HeizkostenV nennen den eingesetzten Energieträger, und Treibhausgasemissionen
//   und Primärenergiefaktor eines Wärmenetzes nur „bei Nutzern, die mit Fernwärme aus Fernwärmesystemen
//   versorgt werden“ (§ 6a Abs. 3 Satz 1 Nr. 1 Buchst. a), also nicht bei Contracting (Prüfung C-M2).
// - Die Regeln der Wärmepumpe (§ 9 Abs. 2 Satz 6 Nr. 3, § 11 Abs. 1 Nr. 3 a. F., § 12 Abs. 3 HeizkostenV)
//   hängen am Erzeuger, nicht daran, wer ihn betreibt; bei Contracting mit einer Wärmepumpe sperrt Mietfuchs
//   die Formeln für den Warmwasseranteil, weil offen ist, ob Nr. 2 oder Nr. 3 gilt (Prüfung R-M4).
import type { HeatingEnergy, HeatingPlant } from './types.ts'

// Contracting gibt es bei jeder zentralen Anlage (§ 1 Abs. 1 Nr. 2 HeizkostenV: „auch aus Anlagen nach
// Nummer 1“), auch bei der Wärmepumpe: § 556c Abs. 1 BGB und § 1 WärmeLV schränken nicht nach dem Erzeuger
// ein, und § 9 Abs. 1 Satz 2 HeizkostenV teilt bei Wärmelieferung nach dem Wärmeverbrauch (Prüfung R-M4,
// Entwurf „Contracting mit Wärmepumpe“). Nicht dabei ist nur die Fernwärme, die ohne Merkmal Wärmelieferung ist.
export const CONTRACTING_ENERGIES: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'coal', 'pellets', 'wood', 'heatPump', 'electric', 'other']

// Wärmelieferung im Sinne von § 1 Abs. 1 Nr. 2 HeizkostenV: Fernwärme oder Contracting.
export const isHeatDelivery = (plant: Pick<HeatingPlant, 'energy'> & { contracting?: boolean }): boolean =>
  plant.energy === 'districtHeating' || plant.contracting === true

// Die Energie, nach der abgerechnet wird: Bei Contracting ist es Wärme laut Rechnung des Lieferanten, also
// dasselbe wie Fernwärme. Fehlt `contracting` (ein von Hand gebauter Schnappschuss), ist es die Energie selbst.
export const billingEnergy = (plant: Pick<HeatingPlant, 'energy'> & { contracting?: boolean }): HeatingEnergy =>
  plant.contracting === true ? 'districtHeating' : plant.energy

// Die Anlage, wie die Berechnung sie sieht: mit der Energie der Abrechnung und dem Brennstoff des Lieferanten
// (`fuelEnergy`) für die Ausnahmen oben und die Beschriftung.
export function asBilledPlant<P extends Pick<HeatingPlant, 'energy'> & { contracting?: boolean }>(plant: P): P & { fuelEnergy?: HeatingEnergy } {
  return plant.contracting === true ? { ...plant, energy: 'districtHeating', fuelEnergy: plant.energy } : plant
}

// Der Erzeuger der Wärme: bei Contracting der Brennstoff des Lieferanten, sonst die Energie der Anlage. Für die
// Regeln, die am Erzeuger hängen (Wärmepumpe, Energieträger nach § 6a).
export const generatorEnergy = (plant: { energy: HeatingEnergy; fuelEnergy?: HeatingEnergy }): HeatingEnergy =>
  plant.fuelEnergy ?? plant.energy

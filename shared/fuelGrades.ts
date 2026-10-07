// Die Zeilen der Heizwerttabelle des § 9 Abs. 3 HeizkostenV (Heizung PR 11), für Server und
// Oberfläche. Die Heizwerte selbst stehen nur im Rechtsregister (`hkvHeatingValues` in
// shared/law/heizkostenv.ts); hier stehen nur Namen und Zuordnungen.
import type { FuelGrade, HeatingEnergy, HeatingValueUnit } from './types.ts'

export const FUEL_GRADES: readonly FuelGrade[] = [
  'heatingOilEL', 'heavyFuelOil', 'naturalGasH', 'naturalGasL', 'lpg', 'coke', 'lignite', 'hardCoal', 'firewood', 'woodPellets', 'woodChips',
]

// Die Zeilen im Wortlaut der Fassung seit 01.12.2021 (BGBl. 2021 I S. 4966).
export const FUEL_GRADE_LABELS: Record<FuelGrade, string> = {
  heatingOilEL: 'Leichtes Heizöl extra leichtflüssig',
  heavyFuelOil: 'Schweres Heizöl',
  naturalGasH: 'Erdgas H',
  naturalGasL: 'Erdgas L',
  lpg: 'Flüssiggas',
  coke: 'Koks',
  lignite: 'Braunkohle',
  hardCoal: 'Steinkohle',
  firewood: 'Brennholz (lufttrocken)',
  woodPellets: 'Holzpellets',
  woodChips: 'Holzhackschnitzel (lufttrocken)',
}

// Anlagen mit Heizkesseln im Sinne des § 9 Abs. 1 Satz 2 und Abs. 3 HeizkostenV. Nur für sie gilt die
// Tabelle hilfsweise (Entwurf R-A13). Fernwärme, Wärmepumpe und Strom rechnen in Kilowattstunden;
// „Sonstiges“ ist unbekannt (Abweichung 7 des Plans PR 11).
export const BOILER_ENERGIES: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'pellets', 'wood', 'coal']
export const isBoiler = (energy: HeatingEnergy): boolean => BOILER_ENERGIES.includes(energy)

// Welche Zeilen zu welchem Energieträger der Anlage passen.
export const GRADES_BY_ENERGY: Readonly<Record<HeatingEnergy, readonly FuelGrade[]>> = {
  gas: ['naturalGasH', 'naturalGasL'],
  oil: ['heatingOilEL', 'heavyFuelOil'],
  lpg: ['lpg'],
  pellets: ['woodPellets'],
  wood: ['firewood', 'woodChips'],
  coal: ['coke', 'lignite', 'hardCoal'],
  districtHeating: [],
  heatPump: [],
  electric: [],
  other: [],
}

export const HEATING_VALUE_UNIT_TEXT: Record<HeatingValueUnit, string> = { l: 'Liter', m3: 'Kubikmeter', kg: 'Kilogramm', srm: 'Schüttraummeter' }

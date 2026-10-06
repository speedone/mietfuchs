// Vorratsenergien (Heizung PR 8, Entwurf 8.2, 14.1): Brennstoffe, die im Tank oder Lager liegen und
// nicht im selben Zeitraum verbraucht werden müssen, in dem sie geliefert werden. Der Server
// (Bestandsrechnung, Sperren) und die Oberfläche (Karte „Vorrat“) lesen dieselbe Liste.
import type { HeatingEnergy, StockUnit } from './types.ts'

export const STOCK_ENERGIES: readonly HeatingEnergy[] = ['oil', 'lpg', 'pellets', 'wood', 'coal']
export const isStockEnergy = (energy: HeatingEnergy): boolean => STOCK_ENERGIES.includes(energy)

// Die Einheit im Satz („2.000 l“) und als Wort in der Auswahl.
export const STOCK_UNIT_TEXT: Record<StockUnit, string> = { l: 'l', kg: 'kg', srm: 'SRm' }
export const STOCK_UNIT_LABELS: Record<StockUnit, string> = { l: 'Liter', kg: 'Kilogramm', srm: 'Schüttraummeter' }

// Der Name des Brennstoffs in den Zeilen „… aus dem Vorrat“ und „… im Vorrat“.
export const STOCK_FUEL_NAMES: Partial<Record<HeatingEnergy, string>> = { oil: 'Heizöl', lpg: 'Flüssiggas', pellets: 'Pellets', wood: 'Holz', coal: 'Kohle' }

// Karte „Betriebsstrom der Heizung“ (#266) ohne DOM: wann sie erscheint, ihre Auswahl und der Rumpf des PUT. Die Frage
// steht an der Anlage, nicht je Heizperiode, und genau dort, wohin der Hinweis „Betriebsstrom fehlt“ führt.
import type { HeatingPlant, OperatingPowerHandling } from './types'
import { asksOperatingPowerHandling, OPERATING_POWER_HANDLING_LABELS } from '../../shared/operatingPower.ts'

export const showsHandlingCard = (plant: Pick<HeatingPlant, 'energy' | 'method' | 'source' | 'supply'> & Partial<Pick<HeatingPlant, 'contracting'>>): boolean => asksOperatingPowerHandling(plant)

// „Keine Angabe“ zuerst; sie ist zugleich der Eintrag für eine Anlage ohne Angabe (angezeigter = gespeicherter Wert).
const ORDER: ('' | OperatingPowerHandling)[] = ['', 'ownMeter', 'deducted', 'landlordPays']
export const handlingOptions = (): { value: '' | OperatingPowerHandling; label: string }[] =>
  ORDER.map((value) => ({ value, label: OPERATING_POWER_HANDLING_LABELS[value] }))

// Ein Tab von vor dem Update kennt das Feld nicht; dann gilt keine Angabe.
export const handlingValue = (plant: Partial<Pick<HeatingPlant, 'operatingPowerHandling'>>): '' | OperatingPowerHandling => plant.operatingPowerHandling ?? ''

export const handlingBody = (value: '' | OperatingPowerHandling): { operatingPowerHandling: OperatingPowerHandling | null } =>
  ({ operatingPowerHandling: value === '' ? null : value })

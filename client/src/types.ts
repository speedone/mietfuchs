export type Unit = {
  id: string
  name: string
  areaM2: number
  participates: boolean
}

export type PrepaymentEntry = {
  from: string // 'YYYY-MM' — ab diesem Monat gilt der Betrag
  monthlyCents: number
}

export type PersonEntry = {
  from: string // 'YYYY-MM-DD' — ab diesem Tag gilt die Personenzahl
  persons: number
}

export type Tenancy = {
  id: string
  unitId: string
  tenantName: string
  persons: number // aktuelle Personenzahl (abgeleitet aus personHistory)
  personHistory: PersonEntry[]
  start: string
  end: string | null
  prepayments: PrepaymentEntry[]
  prepaymentOverrides: Record<string, number> // Jahr → tatsächlich gezahlter Betrag
}

export type MeterType = 'kaltwasser' | 'strom' | 'waerme' | 'sonstig'

export type Meter = {
  id: string
  name: string
  unitId: string | null // null = Hauptzähler (ganzes Haus)
  type: MeterType
  meterNumber?: string
  unit: string // Maßeinheit, z. B. m³
}

export type Reading = {
  id: string
  meterId: string
  date: string
  value: number
  replacement?: boolean // Zählerwechsel: value = Startstand des neuen Geräts
  oldEndValue?: number // Endstand des alten Geräts
  note?: string
}

export const METER_TYPE_LABELS: Record<MeterType, string> = {
  kaltwasser: 'Kaltwasser',
  strom: 'Strom (Allgemein)',
  waerme: 'Wärme',
  sonstig: 'Sonstig',
}

export type CostKey = 'area' | 'persons' | 'units' | 'direct' | 'meter'

export type CostItem = {
  id: string
  year: number
  category: string
  description: string
  vendor?: string
  amountCents: number
  key: CostKey
  directUnitId?: string
  meterType?: MeterType
  labor35aCents?: number // Lohnanteil nach §35a EStG
  invoiceFile?: string
}

export type Settings = {
  houseName: string
  address: string
  landlordName: string
  iban: string
  paymentDeadlineDays: number
  ollamaUrl: string
  ollamaModel: string
}

export type SettlementRow = {
  costItemId: string
  category: string
  description: string
  totalCents: number
  keyLabel: string
  basisText?: string
  shareCents: number
  labor35aCents?: number
}

export type Statement = {
  tenancyId: string
  tenantName: string
  unitName: string
  persons: number
  days: number
  periodStart: string
  periodEnd: string
  rows: SettlementRow[]
  totalShareCents: number
  total35aCents: number
  prepaymentCents: number
  prepaymentOverridden: boolean
  suggestedMonthlyCents: number
  balanceCents: number
}

export type Settlement = {
  year: number
  daysInYear: number
  statements: Statement[]
  landlord: { rows: SettlementRow[]; totalCents: number }
  totalCostsCents: number
  warnings: string[]
}

export type Extraction = {
  vendor?: string
  invoiceDate?: string
  periodStart?: string | null
  periodEnd?: string | null
  totalGrossEur?: number
  positions?: { description: string; category: string; amountEur: number; labor35aEur?: number | null }[]
}

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
  'Sonstige Betriebskosten',
  'Nicht umlagefähig',
]

export const KEY_LABELS: Record<CostKey, string> = {
  area: 'nach Wohnfläche',
  persons: 'nach Personenzahl',
  units: 'nach Wohneinheiten',
  direct: 'Direktzuordnung',
  meter: 'nach Verbrauch (Zähler)',
}

// Sinnvolle Vorbelegung des Umlageschlüssels je Kostenart
export function defaultKeyFor(category: string): CostKey {
  if (category === 'Wasser/Abwasser' || category === 'Müllabfuhr') return 'persons'
  return 'area'
}

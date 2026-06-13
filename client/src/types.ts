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

// Kaltmiete-Staffel — gleiche „ab Monat gilt Betrag"-Mechanik wie die Vorauszahlung.
// Bruttomiete = Kaltmiete + NK-Vorauszahlung des jeweiligen Monats.
export type RentEntry = {
  from: string // 'YYYY-MM'
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
  baseRents: RentEntry[] // Kaltmiete-Staffel (leer = nicht erfasst)
}

// Eine gebuchte Mietzahlung (Geldeingang). Pro Mietverhältnis, datiert.
export type Payment = {
  id: string
  tenancyId: string
  date: string // 'YYYY-MM-DD'
  amountCents: number
  note?: string
}

// ---------- Mietkonto / Zahlungs-Tracking ----------

export type RentMonthStatus = 'paid' | 'partial' | 'open'

export type RentMonth = {
  month: number // 1..12
  baseRentCents: number
  prepaymentCents: number
  sollCents: number // Bruttomiete = Kaltmiete + Vorauszahlung
  paidCents: number // dem Monat zugeordneter Zahlungseingang
  status: RentMonthStatus
}

export type RentLedgerRow = {
  tenancyId: string
  tenantName: string
  unitName: string
  months: RentMonth[]
  sollYearCents: number // Brutto-Soll des Jahres
  baseRentYearCents: number // davon Kaltmiete (Netto)
  prepaymentYearCents: number // davon NK-Vorauszahlung
  paidYearCents: number
  balanceCents: number // paid − soll: >0 Guthaben/Überzahlung, <0 offener Rückstand
  openMonths: number
}

export type RentLedger = {
  year: number
  rows: RentLedgerRow[]
  totals: {
    sollYearCents: number
    paidYearCents: number
    openCents: number // Summe der offenen Rückstände (nur negative Salden)
  }
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
  printAdjustSuggestion?: boolean // §560-Vorschlag zur Vorauszahlungsanpassung andrucken (Standard: ja)
  printAttachments?: boolean // Belegkopien als Anlage mit andrucken (Standard: nein)
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
  // gesetzt, wenn die Abrechnung abgeschlossen (eingefroren) ist
  closed: { closedAt: string; sentAt: string | null } | null
}

export type UploadInfo = {
  file: string
  size: number
  mtime: string
}

export type Extraction = {
  vendor?: string
  invoiceDate?: string
  periodStart?: string | null
  periodEnd?: string | null
  totalGrossEur?: number
  positions?: { description: string; category: string; amountEur: number; labor35aEur?: number | null }[]
}

// KI-Auswertung eines Zählerfotos (universeller Eingang)
export type MeterReadingExtraction = {
  meterNumber?: string | null
  value?: number | null
  dateOnImage?: string | null
}

// Antwort von /api/intake: erkennt automatisch Rechnung vs. Zählerfoto
export type IntakeResult = { file: string } & (
  | { kind: 'rechnung'; extraction: Extraction }
  | { kind: 'zaehler'; reading: MeterReadingExtraction }
)

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

// Ordnet eine frei formulierte Kategorie (z. B. aus der KI-Auswertung) der
// nächstliegenden Betriebskostenart zu, statt hart auf „Sonstige" zu fallen.
export function matchCategory(raw: string): string {
  if (CATEGORIES.includes(raw)) return raw
  const s = raw.toLowerCase()
  if (/müll|abfall|restabfall|biotonne|wertstoff/.test(s)) return 'Müllabfuhr'
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
  if (/instandhalt|reparatur|verwaltung|nicht umlage/.test(s)) return 'Nicht umlagefähig'
  return 'Sonstige Betriebskosten'
}

// Sinnvolle Vorbelegung des Umlageschlüssels je Kostenart
export function defaultKeyFor(category: string): CostKey {
  if (category === 'Wasser/Abwasser' || category === 'Müllabfuhr') return 'persons'
  return 'area'
}

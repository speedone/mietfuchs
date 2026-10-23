// Der Verlauf (#318, Schritt 3): was der Server über eine Gruppe des Änderungsjournals liefert, und wie es
// lesbar wird. Die Spalten der Datenbank bekommen die Feldnamen der Oberfläche, wo es sie gibt; sonst steht der
// Spaltenname da. Logik ohne DOM, geprüft in journalView.test.ts.

import { fmtDate, fmtEuro } from './api'

export type JournalGroup = {
  id: number
  at: string
  method: string
  route: string
  description: string
  title: string
  propertyId: string | null
  rows: number
}

export type JournalChange = {
  id: number
  table: string
  key: Record<string, unknown>
  op: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  changed: string[]
}

export type JournalDetail = JournalGroup & { changes: JournalChange[] }

// Was eine Tabelle für den Vermieter ist.
const TABLE_LABELS: Record<string, string> = {
  properties: 'Objekt',
  units: 'Wohnung',
  tenancies: 'Mietverhältnis',
  cost_items: 'Kostenposition',
  meters: 'Zähler',
  readings: 'Ablesung',
  payments: 'Zahlung',
  person_history: 'Personenzahl',
  prepayments: 'Vorauszahlung',
  base_rents: 'Kaltmiete',
  flat_rates: 'Pauschale',
  heating_prepayments: 'Vorauszahlung Heizung',
  prepayment_overrides: 'Jahreskorrektur der Vorauszahlung',
  cost_item_shares: 'Vereinbarter Anteil',
  cost_item_participants: 'Beteiligte Wohnung',
  cost_item_amounts: 'Einzelbetrag',
  cost_item_self_amounts: 'Eigenbetrag',
  cost_item_contract: 'Umlagevereinbarung',
  unit_no_connection: 'Ohne Anschluss',
  unit_usage_changes: 'Nutzungswechsel',
  unit_local_rents: 'Ortsübliche Miete',
  tenancy_direct_charges: 'Direkt an Dritte gezahlt',
  settings: 'Einstellungen',
  ai_slots: 'KI-Anbieter',
  closed_settlements: 'Abgeschlossene Abrechnung',
  closed_settlement_history: 'Früherer Abschluss',
  closed_heating_settlements: 'Abgeschlossene Heizkostenabrechnung',
  closed_heating_settlement_history: 'Früherer Abschluss der Heizkostenabrechnung',
  heating_plants: 'Heizanlage',
  heating_plant_units: 'Angeschlossene Wohnung',
  heating_periods: 'Heizperiode',
  fuel_deliveries: 'Lieferung',
  fuel_delivery_parts: 'Teilmenge',
  co2_statements: 'CO₂-Angaben',
  co2_tenant_reliefs: 'CO₂-Betrag je Mieter',
  co2_refunds: 'CO₂-Erstattung',
  uploads: 'Beleg',
  assessments: 'Auswertung eines Belegs',
  assessment_lines: 'Zeile einer Auswertung',
  law_overrides: 'Rechtswert',
  letter_texts: 'Text des Anschreibens',
  property_letter_texts: 'Text des Anschreibens (Objekt)',
  tenancy_letter_texts: 'Text des Anschreibens (Mieter)',
  tenancy_letter_adjustments: 'Anpassung im Anschreiben',
  period_changes: 'Wechsel des Abrechnungszeitraums',
  degree_day_values: 'Gradtagzahl',
}

// Die Beschriftungen der Felder, wie sie in den Formularen stehen.
const FIELD_LABELS: Record<string, string> = {
  name: 'Bezeichnung',
  address: 'Adresse',
  kind: 'Art',
  area_m2: 'Wohnfläche (m²)',
  participates: 'Vermietet',
  self_used: 'Selbst genutzt',
  self_persons: 'Personen (selbst genutzt)',
  mea: 'Miteigentumsanteil',
  rooms: 'Zimmer',
  floor: 'Lage',
  notes: 'Notizen',
  note: 'Notiz',
  tenant_name: 'Mieter',
  persons: 'Personen',
  start: 'Einzug',
  end: 'Auszug',
  email: 'E-Mail',
  phone: 'Telefon',
  correspondence_address: 'Anschrift für den Schriftverkehr',
  iban: 'IBAN',
  contract_date: 'Mietvertrag vom',
  deposit_cents: 'Kaution',
  deposit_status: 'Stand der Kaution',
  cost_model: 'Nebenkosten',
  heating_model: 'Heizkosten',
  category: 'Kostenart',
  description: 'Beschreibung',
  vendor: 'Rechnungssteller',
  amount_cents: 'Betrag',
  key: 'Umlageschlüssel',
  labor_35a_cents: 'Lohnanteil (§ 35a EStG)',
  invoice_file: 'Beleg',
  period: 'Abrechnungszeitraum',
  service_from: 'Leistung von',
  service_to: 'Leistung bis',
  tax_year: 'Jahr der Zahlung',
  paid_on: 'Bezahlt am',
  type: 'Zählertyp',
  meter_number: 'Zählernummer',
  unit: 'Einheit',
  unit_id: 'Wohnung',
  meter_id: 'Zähler',
  tenancy_id: 'Mietverhältnis',
  date: 'Datum',
  value: 'Wert',
  replacement: 'Zählerwechsel',
  old_end_value: 'Endstand des alten Zählers',
  monthly_cents: 'Monatsbetrag',
  from: 'Ab',
  percent: 'Anteil (%)',
  landlord_name: 'Vermieter',
  payment_deadline_days: 'Zahlungsfrist (Tage)',
  closed_at: 'Abgeschlossen am',
  sent_at: 'Versandt am',
  reopened_at: 'Wieder geöffnet am',
  original_name: 'Dateiname',
  year: 'Jahr',
  invoice_date: 'Rechnungsdatum',
  label: 'Bezeichnung',
  calibrated_until: 'Geeicht bis',
  state: 'Bundesland',
}

export const tableLabel = (table: string): string => TABLE_LABELS[table] ?? table
export const fieldLabel = (column: string): string => FIELD_LABELS[column] ?? column

const OP_LABELS: Record<JournalChange['op'], string> = { insert: 'angelegt', update: 'geändert', delete: 'gelöscht' }
export const opLabel = (op: JournalChange['op']): string => OP_LABELS[op]

// Spalten, die nur Verweise oder Buchführung sind und in den Einzelheiten nicht stehen müssen.
const HIDDEN = new Set(['id', 'property_id'])

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isOmitted = (value: unknown): boolean => value !== null && typeof value === 'object' && '$omitted' in value

export function formatValue(column: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'leer'
  if (isOmitted(value)) return 'eingefrorener Stand (nicht im Verlauf)'
  if (typeof value === 'number' && column.endsWith('_cents')) return fmtEuro(value)
  if (typeof value === 'number' && (column === 'participates' || column === 'self_used' || column === 'replacement')) return value ? 'ja' : 'nein'
  if (typeof value === 'string' && ISO_DAY.test(value)) return fmtDate(value)
  if (typeof value === 'number') return value.toLocaleString('de-DE')
  return String(value)
}

export type FieldLine = { column: string, label: string, before: string | null, after: string | null }

// Die Felder einer Änderung: bei einer Änderung nur die geänderten mit alt und neu, beim Anlegen und Löschen die
// ausgefüllten.
export function fieldLines(change: JournalChange): FieldLine[] {
  const columns = change.changed.filter((c) => !HIDDEN.has(c))
  const lines: FieldLine[] = []
  for (const column of columns) {
    const before = change.before?.[column] ?? null
    const after = change.after?.[column] ?? null
    if (change.op !== 'update' && (before ?? after) === null) continue
    lines.push({
      column,
      label: fieldLabel(column),
      before: change.op === 'insert' ? null : formatValue(column, before),
      after: change.op === 'delete' ? null : formatValue(column, after),
    })
  }
  return lines
}

// Die Überschrift einer Änderung in den Einzelheiten: „Mietverhältnis gelöscht: Müller“.
const NAME_COLUMNS = ['name', 'tenant_name', 'description', 'label', 'original_name']
export function changeTitle(change: JournalChange): string {
  const image = change.after ?? change.before ?? {}
  const column = NAME_COLUMNS.find((c) => typeof image[c] === 'string' && String(image[c]).trim() !== '')
  const base = `${tableLabel(change.table)} ${opLabel(change.op)}`
  return column ? `${base}: ${String(image[column])}` : base
}

// Zeitpunkt in der Zeit des Rechners, auf dem die Oberfläche läuft.
export function journalWhen(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return `${date}, ${time} Uhr`
}

export const changesText = (n: number): string => (n === 1 ? '1 Änderung' : `${n} Änderungen`)

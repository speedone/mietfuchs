// Der Mieterwechsel-Assistent in den Stammdaten: Eingaben prüfen und den Rumpf für
// POST /api/tenancies/:id/change bauen (#150). Eigene Datei, damit die Regeln ohne DOM prüfbar sind.
//
// Gespeichert wird in **einer** Anfrage, die der Server in einer Transaktion ausführt. Vorher
// schickte der Assistent drei Anfragen nacheinander, und lehnte der Server die letzte ab, standen
// das Ende des alten Mietverhältnisses und die Zwischenablesungen schon da; ein zweiter Versuch
// legte die Ablesungen doppelt an.
import { parseQuantity } from './costForm'
import { parseEuro } from './api'
import { PERSONS_HINT, parsePersons } from './tenancyModel'
import type { Meter, Tenancy } from './types'

export type NewTenantForm = { name: string; start: string; persons: string; baseRent: string; prepayment: string }

export const EMPTY_NEW_TENANT: NewTenantForm = { name: '', start: '', persons: '2', baseRent: '', prepayment: '' }

export type TenantChangeBody = {
  end: string
  readings: { meterId: string; value: number }[]
  newTenancy: {
    tenantName: string
    persons: number
    personHistory: { from: string; persons: number }[]
    start: string
    baseRents: { from: string; monthlyCents: number }[]
    prepayments: { from: string; monthlyCents: number }[]
    prepaymentOverrides: Record<string, number>
  } | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Ein Zählerstand im Assistenten, gelesen wie auf der Zähler-Seite (#149, #105): „1.234“ ist
// 1234. Leer heißt „nicht abgelesen“ und wird übersprungen.
export function parseMeterValue(text: string): number | null {
  if (!text.trim()) return null
  const value = parseQuantity(text)
  return value === null || value < 0 ? null : value
}

// Einzug des Nachmieters: standardmäßig der Tag nach dem Auszug.
export function defaultStart(end: string): string {
  const d = new Date(`${end}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Schritt 1: das Auszugsdatum. `null` heißt in Ordnung.
export function endProblem(endDate: string, tenancy: Pick<Tenancy, 'start'>): string | null {
  if (!ISO_DATE.test(endDate) || endDate < tenancy.start) return 'Bitte ein gültiges Auszugsdatum nach dem Einzug angeben.'
  return null
}

// Schritt 2: die Zählerstände. Ein leeres Feld ist erlaubt, ein unlesbares nicht.
export function meterProblem(meters: Pick<Meter, 'id' | 'name'>[], values: Record<string, string>): string | null {
  for (const m of meters) {
    const v = values[m.id]
    if (v?.trim() && parseMeterValue(v) === null) return `Zählerstand für „${m.name}“ ist keine gültige Zahl.`
  }
  return null
}

// Schritt 3: der ganze Wechsel als ein Rumpf, oder die Meldung, warum nicht.
export function buildTenantChange(input: {
  tenancy: Pick<Tenancy, 'start'>
  endDate: string
  meters: Pick<Meter, 'id' | 'name'>[]
  meterValues: Record<string, string>
  vacancy: boolean
  newTenant: NewTenantForm
}): { error: string } | { body: TenantChangeBody } {
  const { tenancy, endDate, meters, meterValues, vacancy, newTenant } = input
  const ende = endProblem(endDate, tenancy)
  if (ende) return { error: ende }
  const zaehler = meterProblem(meters, meterValues)
  if (zaehler) return { error: zaehler }
  const readings: TenantChangeBody['readings'] = []
  for (const m of meters) {
    const value = parseMeterValue(meterValues[m.id] ?? '')
    if (value !== null) readings.push({ meterId: m.id, value })
  }
  if (vacancy) return { body: { end: endDate, readings, newTenancy: null } }

  const persons = parsePersons(newTenant.persons)
  if (!newTenant.name.trim() || !ISO_DATE.test(newTenant.start) || persons === null) {
    return { error: `Bitte Name, Einzugsdatum und Personenzahl des neuen Mieters prüfen. ${PERSONS_HINT}` }
  }
  if (newTenant.start <= endDate) return { error: 'Der Einzug des neuen Mieters muss nach dem Auszug liegen.' }
  // Ein leeres Feld heißt „keine Staffel“; Unlesbares wird gemeldet statt still weggelassen.
  const baseRent = newTenant.baseRent.trim() ? parseEuro(newTenant.baseRent) : null
  const prepayment = newTenant.prepayment.trim() ? parseEuro(newTenant.prepayment) : null
  if (newTenant.baseRent.trim() && baseRent === null) return { error: 'Die Kaltmiete bitte als Betrag angeben, z. B. 800,00.' }
  if (newTenant.prepayment.trim() && prepayment === null) return { error: 'Die Vorauszahlung bitte als Betrag angeben, z. B. 150,00.' }
  const month = newTenant.start.slice(0, 7)
  return {
    body: {
      end: endDate,
      readings,
      newTenancy: {
        tenantName: newTenant.name.trim(),
        persons,
        personHistory: [{ from: newTenant.start, persons }],
        start: newTenant.start,
        baseRents: baseRent !== null ? [{ from: month, monthlyCents: baseRent }] : [],
        prepayments: prepayment !== null ? [{ from: month, monthlyCents: prepayment }] : [],
        prepaymentOverrides: {},
      },
    },
  }
}

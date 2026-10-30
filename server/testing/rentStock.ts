// Mietverhältnisse und Mietzahlungen für die Tests der Tilgung (#312 PR 1, rentAllocation.ts), über die Typen des
// Modells gebaut. Zufällige Bestände mit festem Startwert für invariant-tilgung.test.ts: Staffeln mit Stufen (auch
// auf 0), angebrochene Ein- und Auszugsmonate, Heizstaffel und Pauschale, dazu Zahlungen jeder schiefen Art
// (Rückstand, Teilzahlung, Überzahlung, Rücklastschrift, Zahlung vor Beginn und nach Auszug, Monat laut
// Verwendungszweck, Zahlungen aus der Abrechnung).
//
// Liegt in testing/ und nicht in test/, weil `node --test` jede Datei unter test/ ausführt.
import type { SnapshotTenancy } from '../src/snapshot.ts'
import type { AllocationPayment } from '../src/rentAllocation.ts'
import type { MonthlySchedule } from '../../shared/monthRate.ts'
import { makeRng } from './taxStock.ts'

export { makeRng }

// Ein Mietverhältnis mit den Pflichtfeldern des Schnappschusses; `over` setzt Staffeln und Zeitraum.
export const rentTenancy = (over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id: 't', unitId: 'w', tenantName: 'Mieter', persons: 1, personHistory: [], start: '2025-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})

// Eine Mietzahlung; Kennung, Art und Monat laut Verwendungszweck nur, wo der Test sie braucht.
export const rentPayment = (id: string, date: string, amountCents: number, over: Partial<AllocationPayment> = {}): AllocationPayment => ({
  id, date, amountCents, kind: 'rent', ...over,
})

const pad = (n: number): string => String(n).padStart(2, '0')
export const addMonths = (month: string, n: number): string => {
  const k = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n
  return `${Math.floor(k / 12)}-${pad((k % 12) + 1)}`
}
const lastDay = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
// Alle Monate von `from` bis `to` einschließlich.
export const monthsBetween = (from: string, to: string): string[] => {
  const out: string[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m)
  return out
}

export type RentStock = { tenancy: SnapshotTenancy, payments: AllocationPayment[] }

// Ein zufälliges Mietverhältnis samt Zahlungen. `exact`: je Monat genau eine Zahlung über das Soll, mit Datum im
// Monat (der Fall „wer jeden Monat genau zahlt“); `sollOf` liefert dafür das Monats-Soll.
export function randomRentStock(rnd: () => number, options: { exact?: (month: string) => number } = {}): RentStock {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
  const chance = (p: number): boolean => rnd() < p
  const startMonth = `${int(2019, 2024)}-${pad(int(1, 12))}`
  const start = `${startMonth}-${pad(chance(0.6) ? 1 : int(2, lastDay(startMonth)))}`
  const endMonth = chance(0.35) ? null : addMonths(startMonth, int(0, 48))
  // Das Ende liegt nie vor dem Beginn (die Datenbank nähme es nicht an).
  const startDay = Number(start.slice(8, 10))
  const end = endMonth === null ? null : `${endMonth}-${pad(chance(0.6) ? lastDay(endMonth) : int(endMonth === startMonth ? startDay : 1, lastDay(endMonth)))}`
  const lastMonth = endMonth ?? addMonths(startMonth, int(6, 48))
  const schedule = (lo: number, hi: number, zeroChance: number): MonthlySchedule[] => {
    const steps: MonthlySchedule[] = [{ from: startMonth, monthlyCents: int(lo, hi) }]
    for (let k = int(0, 2); k > 0; k--) steps.push({ from: addMonths(startMonth, int(1, 40)), monthlyCents: chance(zeroChance) ? 0 : int(lo, hi) })
    return steps
  }
  const tenancy = rentTenancy({
    id: `t${int(1, 99)}`,
    start, end,
    baseRents: chance(0.9) ? schedule(20000, 120000, 0.1) : [],
    prepayments: chance(0.85) ? schedule(0, 30000, 0.1) : [],
    ...(chance(0.25) ? { flatRates: schedule(1000, 9000, 0.2) } : {}),
    ...(chance(0.25) ? { heatingPrepayments: schedule(2000, 15000, 0.1) } : {}),
  })
  const payments: AllocationPayment[] = []
  let seq = 0
  const id = (): string => `p${pad(int(0, 99))}${seq++}`
  const months = monthsBetween(startMonth, lastMonth)
  if (options.exact) {
    for (const m of months) {
      const cents = options.exact(m)
      if (cents !== 0) payments.push(rentPayment(id(), `${m}-${pad(int(1, lastDay(m)))}`, cents))
    }
    return { tenancy, payments }
  }
  const dateIn = (m: string): string => `${m}-${pad(int(1, lastDay(m)))}`
  const usual = int(30000, 140000)
  for (const m of months) {
    const roll = rnd()
    if (roll < 0.12) continue // Monat nicht gezahlt
    const amount = roll < 0.25 ? int(1, usual) : roll < 0.32 ? usual * 2 : roll < 0.36 ? int(usual, usual * 3) : usual
    const extra: Partial<AllocationPayment> = chance(0.08) ? { designatedMonth: chance(0.8) ? addMonths(m, int(-3, 3)) : addMonths(startMonth, -int(1, 5)) } : {}
    // Der Dauerauftrag am 28. des Vormonats deckt manchmal den Monat im Voraus.
    payments.push(rentPayment(id(), chance(0.1) ? `${addMonths(m, -1)}-28` : dateIn(m), amount, extra))
    if (chance(0.06)) payments.push(rentPayment(id(), dateIn(addMonths(m, int(0, 2))), -int(1, amount))) // Rücklastschrift
    if (chance(0.05)) payments.push(rentPayment(id(), dateIn(addMonths(m, int(1, 4))), int(-80000, 80000), { kind: 'settlement' }))
  }
  if (chance(0.3)) payments.push(rentPayment(id(), dateIn(addMonths(startMonth, -int(1, 2))), usual)) // vor Beginn
  if (chance(0.3)) payments.push(rentPayment(id(), dateIn(addMonths(lastMonth, int(1, 6))), int(1, usual * 2))) // nach Auszug
  if (chance(0.15)) payments.push(rentPayment(id(), dateIn(addMonths(lastMonth, int(1, 3))), -int(1, usual))) // Rückzahlung
  if (chance(0.2)) payments.push(rentPayment(id(), payments[int(0, payments.length - 1)]?.date ?? start, int(1, usual))) // gleicher Tag
  return { tenancy, payments }
}

// Was eine Abrechnung nach einer Änderung ergäbe, ohne die Änderung zu speichern (Laienprobe B3,
// B3a): Die Änderung wird in einer Transaktion geschrieben, gemessen und zurückgerollt.
//
// Gerechnet wird mit genau dem Code, der danach wirklich schreibt; eine zweite Fassung der
// Schreibregeln im Arbeitsspeicher liefe früher oder später auseinander, und die Vorschau nennte
// dann eine andere Zahl als die Abrechnung danach. Gelesen wird über die Verbindung selbst: Alle
// Anfragen teilen sich eine Verbindung, und die sieht innerhalb der Transaktion ihren eigenen,
// noch nicht festgeschriebenen Stand. Die Schlange in open.ts lässt währenddessen niemanden herein.

import { computeSettlement } from '../calc.ts'
import { heatingSnapshotFor, snapshotFor } from '../snapshot.ts'
import { periodLabel } from '../../../shared/period.ts'
import type { BillingPeriod } from '../../../shared/types.ts'
import type { Database, Transaction } from './client.ts'
import { readStock, type Stock } from './read.ts'

class Rollback extends Error {
  readonly value: unknown
  constructor(value: unknown) {
    super('Probelauf')
    this.value = value
  }
}

export async function dryRun<T>(db: Database, write: (tx: Transaction) => Promise<void>, measure: (stock: Stock) => T): Promise<T | null> {
  try {
    await db.transaction(async (tx) => {
      await write(tx)
      throw new Rollback(measure(await readStock(db)))
    })
  } catch (err) {
    if (err instanceof Rollback) return err.value as T
    // Scheitert der Probelauf (eine Schreibprüfung lehnt ab), gibt es keine Zahl; die Vorschau sagt
    // dann nur die Frist, und das eigentliche Speichern meldet den Grund.
    return null
  }
  return null
}

// Was eine Abrechnung den Mietern sagt, in Cent: je Mieter das Ergebnis (> 0 Guthaben, < 0
// Nachzahlung) und die Summe der Nachzahlungen.
export type Outcome = { label: string; claimsCents: number; tenants: { tenancyId: string; tenantName: string; balanceCents: number }[] }

// Was nach Ablauf der Frist nicht mehr verlangt werden darf (§ 556 Abs. 3 S. 3 BGB), je Mieter.
// War die Frist des Vergleichszeitraums vorher selbst schon abgelaufen (`beforeBarred`), war dessen
// Nachzahlung ohnehin verloren, und es zählt nur das Mehr (Review der Laienprobe, Runde 1). War sie
// noch offen oder gab es ihn nicht, ist die ganze Nachzahlung nachher verloren (Runde 2): Vorher
// hätte der Vermieter sie verlangen können.
export function lostClaims(tenants: readonly { beforeCents: number | null; afterCents: number }[], beforeBarred: boolean): number {
  return tenants.reduce((sum, t) => {
    const after = Math.max(0, -t.afterCents)
    const before = t.beforeCents === null || !beforeBarred ? 0 : Math.max(0, -t.beforeCents)
    return sum + Math.max(0, after - before)
  }, 0)
}

export function outcomeOf(stock: Stock, propertyId: string, period: BillingPeriod, heatingPlantId: string | null = null): Outcome | null {
  const snapshot = heatingPlantId === null ? snapshotFor(stock, propertyId, period) : heatingSnapshotFor(stock, propertyId, heatingPlantId, period)
  if (snapshot === null) return null
  const s = computeSettlement(snapshot)
  const tenants = s.statements.map((st) => ({ tenancyId: st.tenancyId, tenantName: st.tenantName, balanceCents: st.balanceCents }))
  return { label: periodLabel(period), claimsCents: tenants.reduce((sum, t) => sum + Math.max(0, -t.balanceCents), 0), tenants }
}

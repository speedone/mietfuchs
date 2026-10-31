// Invarianten zu #478 über Zufallsbestände mit festem Startwert (Generator `runRoundTrip` in
// server/testing/periodChangeFlows.ts; mehr Startwerte mit INV_FROM und INV_TO):
//
// - **Ein angegebenes Jahr wandert nie**: Trägt jede Rechnung ein Zahlungsdatum oder ein Jahr der Zahlung, hat jede
//   Rechnung nach jedem Wechsel dieselbe Summe je wirksamem Steuerjahr wie vorher, auch über die Teile, die eine
//   Quelle neu ergibt.
// - **Hin und zurück**: A → B → A mit den Vorgaben der Vorschau ergibt je Steuerjahr dieselben Werbungskosten der
//   Steuerübersicht.
//
// „Ohne Angabe wie bisher“ hält der Golden-Vergleich in db-wechsel-quelle.test.ts (Abläufe von vor #455).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runRoundTrip } from '../testing/periodChangeFlows.ts'

const from = Number(process.env.INV_FROM ?? 1)
const to = Number(process.env.INV_TO ?? 40)

test('#478: Hin und zurück mit den Vorgaben behält jedes angegebene Jahr und je Jahr die Werbungskosten', { timeout: 600000 }, async () => {
  let checked = 0
  for (let i = from; i <= to; i++) {
    const trip = await runRoundTrip(i)
    const where = `Ablauf ${i} (${JSON.stringify(trip.rules)})`
    const [first, ...later] = trip.years
    for (const [k, years] of later.entries()) assert.deepEqual(years, first, `${where}, nach Wechsel ${k + 1}: je Rechnung und Steuerjahr`)
    if (trip.refused !== null) continue
    assert.deepEqual(trip.expenses.after, trip.expenses.before, `${where}: Werbungskosten je Steuerjahr nach hin und zurück`)
    checked++
  }
  assert.ok(checked >= Math.ceil((to - from + 1) * 0.6), `genug Abläufe ohne Ablehnung (${checked})`)
})

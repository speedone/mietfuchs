// Invarianten zu #478 über Zufallsbestände mit festem Startwert (Generator `runRoundTrip` in
// server/testing/periodChangeFlows.ts; mehr Startwerte mit INV_FROM und INV_TO):
//
// - **Ein angegebenes Jahr wandert nie**: Trägt jede Rechnung ein Zahlungsdatum oder ein Jahr der Zahlung, hat jede
//   Rechnung nach jedem Wechsel dieselbe Summe je wirksamem Steuerjahr wie vorher, auch über die Teile, die eine
//   Quelle neu ergibt.
// - **Hin und zurück**: A → B → A mit den Vorgaben der Vorschau ergibt je Steuerjahr dieselben Werbungskosten der
//   Steuerübersicht.
//
// - **Mit Verteilung** (#262 PR 2, X9 e): Dasselbe mit einer Verteilung nach § 82b EStDV an jeder Rechnung ergibt je
//   Steuerjahr dieselben Werbungskosten und über alle Jahre centgenau dieselben abziehbaren Beträge. Je Jahr weicht die
//   Summe der Raten höchstens um (Teile − 1) Cent ab, wenn der Wechsel eine Rechnung anders in Teile legt: Jeder Teil
//   wird für sich verteilt, sein Rest-Cent fällt in seine ersten Jahre (Entwurf E-4, „Je Position“).
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

test('#262 (X9 e): Hin und zurück mit verteilten Rechnungen ergibt je Steuerjahr dieselben Raten, bis auf den Rest-Cent der Teile', { timeout: 600000 }, async () => {
  let checked = 0
  let spreadYears = 0
  let exact = 0
  for (let i = from; i <= to; i++) {
    const trip = await runRoundTrip(i, { spread: true })
    if (trip.refused !== null) continue
    const where = `Ablauf ${i} (${JSON.stringify(trip.rules)})`
    assert.deepEqual(trip.expenses.after, trip.expenses.before, `${where}: Werbungskosten je Steuerjahr`)
    const before = trip.deductions?.before ?? assert.fail('keine Raten')
    const after = trip.deductions?.after ?? assert.fail('keine Raten danach')
    const total = (d: Record<string, [number, number, number]>) => Object.values(d).reduce((a, [x]) => a + x, 0)
    assert.equal(total(after), total(before), `${where}: abziehbar über alle Jahre`)
    for (const [y, [ded, deferred, lines]] of Object.entries(before)) {
      const [dedAfter, deferredAfter, linesAfter] = after[y] ?? assert.fail(`${where}: ${y} fehlt`)
      const slack = Math.max(lines, linesAfter, 1) - 1
      assert.ok(Math.abs(dedAfter - ded) <= slack, `${where}, ${y}: abziehbar ${ded} → ${dedAfter} bei ${lines}/${linesAfter} Zeilen`)
      assert.ok(Math.abs(deferredAfter - deferred) <= slack, `${where}, ${y}: verschoben ${deferred} → ${deferredAfter}`)
      if (deferred !== 0) spreadYears++
    }
    if (JSON.stringify(after) === JSON.stringify(before)) exact++
    checked++
  }
  assert.ok(checked >= Math.ceil((to - from + 1) * 0.5), `genug Abläufe ohne Ablehnung (${checked})`)
  assert.ok(spreadYears > checked, `zu wenige Jahre mit verschobenem Teil (${spreadYears})`)
  // Die Abweichung um einen Rest-Cent bleibt die Ausnahme.
  assert.ok(exact * 2 > checked, `nur ${exact} von ${checked} Abläufen centgenau`)
})

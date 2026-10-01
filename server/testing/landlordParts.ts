// Zusicherung über die Zerlegung des Vermieteranteils (#142), für die Invarianten über zufällige
// Bestände. Bewusst außerhalb von test/: `node --test` führt jede Quelldatei unter test/ als Test aus.
//
// Die Gründe einer Zeile ergeben zusammen genau ihren Anteil, keiner ist null, jeder hat das
// Vorzeichen der Zeile, und keiner steht zweimal da. Der Rundungsrest ist klein: Jeder Anteil
// eines Mieters, der Eigenanteil und der Leerstand werden höchstens um einen halben Cent gerundet.
// Wird er größer, hat die Zerlegung einen Grund übersehen und nennt ihn „Rundung“; das wäre genau
// die pauschale Auskunft, die sie ersetzen soll.

import assert from 'node:assert/strict'
import type { ComputedSettlement } from '../src/calc.ts'

export function assertLandlordParts(s: ComputedSettlement, tenancyCount: number, context: string): void {
  for (const row of s.landlord.rows) {
    const parts = row.landlordParts ?? assert.fail(`${context}: Zeile ${row.costItemId} ohne Zerlegung`)
    assert.equal(parts.reduce((a, p) => a + p.cents, 0), row.shareCents, `${context}: Zerlegung von ${row.costItemId} geht nicht auf\n${JSON.stringify(parts)}`)
    assert.equal(new Set(parts.map((p) => p.reason)).size, parts.length, `${context}: ein Grund steht zweimal da`)
    for (const p of parts) {
      assert.ok(p.cents !== 0 && Math.sign(p.cents) === Math.sign(row.shareCents), `${context}: Teil ${p.reason} ${p.cents} gegen das Vorzeichen der Zeile ${row.shareCents}`)
      if (p.reason === 'rounding') assert.ok(Math.abs(p.cents) <= tenancyCount + 2, `${context}: Rundungsrest ${p.cents} Cent bei ${row.costItemId}\n${JSON.stringify(parts)}`)
    }
  }
}

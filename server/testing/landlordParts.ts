// Zusicherung über die Zerlegung des Vermieteranteils (#142), für die Invarianten über zufällige
// Bestände. Bewusst außerhalb von test/: `node --test` führt jede Quelldatei unter test/ als Test aus.
//
// Die Gründe einer Zeile ergeben zusammen genau ihren Anteil, keiner ist null, jeder hat das
// Vorzeichen der Zeile, und keiner steht zweimal da. Einen Rundungsrest gibt es seit #202 nicht
// mehr: Mieter und Gründe des Vermieters werden gemeinsam verteilt, und die Summe stimmt ohne ihn.
// Taucht „Rundung“ wieder auf, hat jemand die eine Verteilung umgangen. (`tenancyCount` begrenzte
// früher den Rundungsrest und bleibt, damit die Aufrufer unverändert bleiben.)

import assert from 'node:assert/strict'
import type { ComputedSettlement } from '../src/calc.ts'

export function assertLandlordParts(s: ComputedSettlement, tenancyCount: number, context: string): void {
  for (const row of s.landlord.rows) {
    const parts = row.landlordParts ?? assert.fail(`${context}: Zeile ${row.costItemId} ohne Zerlegung`)
    assert.equal(parts.reduce((a, p) => a + p.cents, 0), row.shareCents, `${context}: Zerlegung von ${row.costItemId} geht nicht auf\n${JSON.stringify(parts)}`)
    assert.equal(new Set(parts.map((p) => p.reason)).size, parts.length, `${context}: ein Grund steht zweimal da`)
    for (const p of parts) {
      assert.ok(p.cents !== 0 && Math.sign(p.cents) === Math.sign(row.shareCents), `${context}: Teil ${p.reason} ${p.cents} gegen das Vorzeichen der Zeile ${row.shareCents}`)
      assert.notEqual(p.reason, 'rounding', `${context}: Rundungsrest ${p.cents} Cent bei ${row.costItemId} (${tenancyCount} Mietverhältnisse)\n${JSON.stringify(parts)}`)
    }
  }
}

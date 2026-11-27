// #704 Teil 2: Der Teil des Vorschlags nach § 560 Abs. 4 BGB für Heizung und Warmwasser, über zufällige Bestände mit festem
// Startwert (Kalenderjahr, Mai bis April, Wechsel mit Rumpf; mit und ohne Pauschale und Inklusivmiete). Eine Heizstaffel
// ändert keine Zeile und nicht die Summe des Vorschlags; der Teil ist ein voller Eurobetrag über 0 und unter der
// Summe (beide Teile sind also über 0); ohne Heizstaffel gibt es das Feld nicht. Aus dem Probelauf der Durchsicht von Teil 2 übernommen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { integrationStock, INTEGRATION_PROPERTY } from '../testing/integration013.ts'
import { CALENDAR_RULES } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

const RULES: [string, PeriodRules][] = [['Kalenderjahr', CALENDAR_RULES], ['Mai bis April', { startMonth: 5, changes: [] }], ['Wechsel mit Rumpf', { startMonth: 1, changes: ['2025-07'] }]]
const MODELS = ['settlement', 'flatRate', 'inclusive'] as const

test('#704: Heizteil des Vorschlags über Zufallsbestände: Summe und Zeilen unverändert, Teil in vollen Euro zwischen 0 und Summe', () => {
  let parts = 0
  let statements = 0
  for (const [name, rules] of RULES) {
    for (let seed = 1; seed <= 40; seed++) {
      const { source, periods } = integrationStock(seed, rules)
      for (const mixed of [false, true]) {
        const plain = mixed ? { ...source, tenancies: source.tenancies.map((t, i) => ({ ...t, heatingModel: MODELS[(seed + i) % 3] ?? 'settlement' })) } : source
        const split = { ...plain, tenancies: plain.tenancies.map((t, i) => ({ ...t, heatingPrepayments: [{ from: '2020-01', monthlyCents: (seed + i) % 4 === 0 ? 0 : 4000 }] })) }
        for (const p of periods) {
          const where = `${name}, Startwert ${seed}, ${p.key}${mixed ? ', gemischte Heizmodelle' : ''}`
          const a = computeSettlement(snapshotFor(plain, INTEGRATION_PROPERTY, p))
          const b = computeSettlement(snapshotFor(split, INTEGRATION_PROPERTY, p))
          assert.ok(a.statements.every((st) => st.suggestedHeatingMonthlyCents === undefined), `${where}: Teil ohne Heizstaffel`)
          for (const sa of a.statements) {
            const sb = b.statements.find((x) => x.tenancyId === sa.tenancyId) ?? assert.fail(`${where}: ${sa.tenancyId} fehlt`)
            statements++
            assert.equal(sb.suggestedMonthlyCents, sa.suggestedMonthlyCents, `${where}, ${sa.tenancyId}: Summe`)
            assert.deepEqual(sb.rows, sa.rows, `${where}, ${sa.tenancyId}: Zeilen`)
            const part = sb.suggestedHeatingMonthlyCents
            if (part === undefined) continue
            parts++
            assert.ok(Number.isInteger(part) && part % 100 === 0 && part > 0 && part < sb.suggestedMonthlyCents, `${where}, ${sa.tenancyId}: Teil ${part} bei Summe ${sb.suggestedMonthlyCents}`)
          }
        }
      }
    }
  }
  // Der Test prüft etwas: Es gab Aufstellungen, und viele davon mit Teil.
  assert.ok(statements > 300 && parts > 100, `zu wenige Fälle: ${statements} Aufstellungen, ${parts} mit Teil`)
})

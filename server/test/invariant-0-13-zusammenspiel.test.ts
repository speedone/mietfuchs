// Invariante über das Zusammenspiel der Funktionen von 0.13.0 (Integrationsdurchsicht, Blickwinkel Geld):
// Nutzungswechsel (#259), verbilligte Vermietung (#257) und Betriebsstrom mit gemeldetem, selbst getragenem und
// verknüpftem Abzug (#268, #270), je Kalenderjahr und bei Mai bis April. Bestände in server/testing/integration013.ts.
//
// Je Abrechnung: Mieter und Vermieter tragen zusammen jede Position, kein Mieteranteil mit falschem Vorzeichen, die
// Zeilen des Vermieters stimmen, der Eigenanteil ist die Summe der Zeilen `selfUse`.
// Je Steuerjahr: privat + unentgeltlich + abziehbar = Betrag; die verbilligte Vermietung ändert den privaten Teil
// nicht und kürzt nie mehr als abziehbar. Über alle Steuerjahre: Der Strom ist genau einmal die bezahlte Rechnung,
// ein dem Messdienst gemeldeter Abzug steht als eigene Position da, ein Abzug in der Ausgleichszeile nicht. Und ein
// gemeldeter Abzug wird bei verbilligter Vermietung im selben Verhältnis gekürzt wie seine Stromrechnung (M1); ein
// Abzug in der Ausgleichszeile wird nie gekürzt.
//
// Mehr Startwerte mit INV_FROM und INV_TO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReportFor } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES } from '../../shared/period.ts'
import { deductionReported } from '../../shared/operatingPower.ts'
import type { PeriodRules } from '../../shared/types.ts'
import { assertLandlordParts } from '../testing/landlordParts.ts'
import { INTEGRATION_PROPERTY as P, integrationStock, withoutLocalRents } from '../testing/integration013.ts'

const MAY: PeriodRules = { startMonth: 5, changes: [] }

for (const [name, rules] of [['Kalenderjahr', CALENDAR_RULES], ['Mai bis April', MAY]] as const) {
  test(`Invariante 0.13.0: Nutzungswechsel, verbilligte Vermietung und Betriebsstrom zugleich (${name})`, () => {
    const from = Number(process.env.INV_FROM ?? 1)
    const to = Number(process.env.INV_TO ?? 120)
    const fails: string[] = []
    let cuts = 0
    let phased = 0
    let reportedCuts = 0
    for (let seed = from; seed <= to; seed++) {
      const { source, service, periods } = integrationStock(seed, rules)
      const at = `${name} ${seed}`
      for (const p of periods) {
        const s = computeSettlement(snapshotFor(source, P, p))
        for (const c of source.costItems.filter((x) => x.period === p.key)) {
          const tenants = s.statements.flatMap((st) => st.rows).filter((x) => x.costItemId === c.id)
          const ten = tenants.reduce((a, x) => a + x.shareCents, 0)
          const ll = s.landlord.rows.filter((x) => x.costItemId === c.id).reduce((a, x) => a + x.shareCents, 0)
          if (ten + ll !== c.amountCents) fails.push(`${at} ${p.key} ${c.id}: ${ten} + ${ll} ≠ ${c.amountCents}`)
          if (tenants.some((x) => x.shareCents !== 0 && Math.sign(x.shareCents) === -Math.sign(c.amountCents))) fails.push(`${at} ${c.id}: Vorzeichen eines Mieters`)
        }
        try {
          assertLandlordParts(s, 0, at)
        } catch (e) {
          fails.push(String((e as Error).message).slice(0, 200))
        }
        const selfParts = s.landlord.rows.reduce((a, r) => a + (r.landlordParts ?? []).filter((x) => x.reason === 'selfUse').reduce((b, x) => b + x.cents, 0), 0)
        if (selfParts !== s.selfUsedShareCents) fails.push(`${at}: Eigenanteil ${s.selfUsedShareCents} ≠ Σ selfUse ${selfParts}`)
        if (s.notices.some((x) => x.code === 'usage.changed')) phased++
      }
      let total = 0
      const byItem = new Map<string, number>()
      for (const y of [2024, 2025, 2026, 2027]) {
        const t = taxReportFor(source, P, y)
        const before = new Map(taxReportFor(withoutLocalRents(source), P, y).expenses.items.map((i) => [i.costItemId, i]))
        const itemOf = new Map(t.expenses.items.map((i) => [i.costItemId, i]))
        for (const i of t.expenses.items) {
          const g = i.gratuitousCents ?? 0
          if (i.privateCents + g + i.deductibleCents !== i.amountCents) fails.push(`${at} ${y} ${i.costItemId}: privat + unentgeltlich + abziehbar ≠ Betrag`)
          const b = before.get(i.costItemId)
          if (!b) {
            fails.push(`${at} ${y} ${i.costItemId}: fehlt ohne ortsübliche Miete`)
            continue
          }
          if (b.privateCents !== i.privateCents) fails.push(`${at} ${y} ${i.costItemId}: privat ${i.privateCents} statt ${b.privateCents}`)
          if (Math.abs(g) > Math.abs(b.deductibleCents)) fails.push(`${at} ${y} ${i.costItemId}: Kürzung über abziehbar`)
          if (g !== 0) cuts++
          total += i.amountCents
          if (!i.costItemId.startsWith('operating-power-balance')) byItem.set(i.costItemId, (byItem.get(i.costItemId) ?? 0) + i.amountCents)
          // M1: Ein gemeldeter Abzug des Betriebsstroms wird im selben Verhältnis gekürzt wie seine Stromrechnung; beide
          // verteilen nach Einheiten im selben Zeitraum, es bleiben die Rundungen der Mieterzeilen. Ein Abzug, den die
          // Ausgleichszeile aufhebt (selbst getragen oder verknüpft), wird nie gekürzt, die Ausgleichszeile auch nicht.
          const c = source.costItems.find((x) => x.id === i.costItemId)
          if (i.costItemId.startsWith('operating-power-balance') && g !== 0) fails.push(`${at} ${y}: Ausgleichszeile gekürzt`)
          if (c?.operatingPower === 'deduction' && !deductionReported(c, service) && g !== 0) fails.push(`${at} ${y} ${c.id}: Abzug in der Ausgleichszeile gekürzt`)
          if (c?.operatingPower === 'deduction' && deductionReported(c, service)) {
            const bill = itemOf.get(c.operatingPowerGeneralId ?? '')
            if (bill && bill.amountCents !== 0) {
              const expected = (i.amountCents * (bill.gratuitousCents ?? 0)) / bill.amountCents
              if (Math.abs(g - expected) > 2) fails.push(`${at} ${y} ${c.id}: Abzug gekürzt um ${g} statt etwa ${Math.round(expected)}`)
              if (g !== 0) reportedCuts++
            }
          }
        }
        const e = t.expenses
        if (e.deductibleCents !== e.totalCents - e.privateCents - (e.gratuitousCents ?? 0)) fails.push(`${at} ${y}: Summen`)
      }
      // Der Strom genau einmal: Über alle Steuerjahre steht jede Position mit ihrem Betrag da, außer den Ausschnitten
      // der Stromrechnung (Heizposition `included`, Abzug in der Ausgleichszeile); ein gemeldeter Abzug zählt.
      const expected = source.costItems.reduce((a, c) => {
        if (c.operatingPower === 'included') return a
        if (c.operatingPower === 'deduction') return deductionReported(c, service) ? a + c.amountCents : a
        return a + c.amountCents
      }, 0)
      if (total !== expected) fails.push(`${at}: Steuer über alle Jahre ${total} statt ${expected}`)
      for (const [id, sum] of byItem) {
        const c = source.costItems.find((x) => x.id === id)
        if (c && sum !== c.amountCents) fails.push(`${at} ${id}: über alle Jahre ${sum} statt ${c.amountCents}`)
      }
    }
    if (fails.length > 0) assert.fail(`${fails.length} Befunde:\n${fails.slice(0, 25).join('\n')}`)
    // Die Bestände treffen, was sie prüfen sollen.
    assert.ok(cuts > 0 && phased > 0 && reportedCuts > 0, `zu wenig getroffen: ${cuts} Kürzungen, ${phased} Wechsel, ${reportedCuts} gekürzte Abzüge`)
  })
}

// Der Block „Heizkostenabrechnung“ nennt je Nutzer und Topf den Betrag seiner Kostenzeilen (Systemprüfung 20.11.2026):
// Jede Position wird einmal gerundet verteilt (#202); der Block rechnete dagegen Topf mal Gewicht und rundete einmal,
// was ab zwei Positionen in einem Topf um einen Cent von der Kostentabelle desselben Blatts abweichen konnte.
// Grundlage ist Beispiel A (server/testing/selfHeating.ts) mit krummen Beträgen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { selfSnapshot } from '../testing/selfHeating.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem, HeatingPart, HeatingTarget } from '../../shared/types.ts'

const selfOf = (s: ComputedSettlement) => s.heating?.find((h) => h.plantId === 'hp')?.self ?? assert.fail('kein Ausweis der Anlage hp')
const item = (id: string, amountCents: number, heatingPart: HeatingPart, heatingTarget: HeatingTarget, extra: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: id, amountCents, key: 'heatingSystem',
  heatingPlantId: 'hp', heatingPart, heatingTarget, ...extra,
})
const rowsOf = (s: ComputedSettlement, tenancyId: string, ids: readonly string[]): number =>
  (s.statements.find((x) => x.tenancyId === tenancyId) ?? assert.fail(`keine Abrechnung für ${tenancyId}`)).rows
    .filter((r) => ids.includes(r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
const users = (s: ComputedSettlement) => selfOf(s).units.flatMap((u) => u.users)

// Viele krumme Beträge, damit die Einzelrundung sicher von der Topfrundung abweicht.
const AMOUNTS = [100001, 33337, 77773, 12347, 55559, 9973, 41011]

test('Je Topf getrennte Positionen: Blockbetrag je Mieter = Summe seiner Kostenzeilen, alle Nutzer zusammen = Topf', () => {
  const heat = AMOUNTS.map((a, i) => item(`h${i}`, a, 'operating', 'heating'))
  const water = AMOUNTS.map((a, i) => item(`w${i}`, a + 2, 'operating', 'water'))
  const s = computeSettlement(selfSnapshot({ costItems: [...heat, ...water] }))
  const self = selfOf(s)
  assert.equal(self.ok, true)
  for (const u of users(s)) {
    if (!u.tenancyId) continue
    assert.equal(u.heatingCents, rowsOf(s, u.tenancyId, heat.map((c) => c.id)), `Heizung ${u.label}`)
    assert.equal(u.waterCents, rowsOf(s, u.tenancyId, water.map((c) => c.id)), `Warmwasser ${u.label}`)
  }
  assert.equal(users(s).reduce((a, u) => a + u.heatingCents, 0), heat.reduce((a, c) => a + c.amountCents, 0))
  assert.equal(users(s).reduce((a, u) => a + u.waterCents, 0), water.reduce((a, c) => a + c.amountCents, 0))
  assert.equal(self.pots.find((p) => p.pot === 'heating')?.costCents, heat.reduce((a, c) => a + c.amountCents, 0))
})

test('Positionen für Heizung und Warmwasser: beide Blockbeträge zusammen = Summe der Kostenzeilen des Mieters, alle Nutzer = alle Positionen', () => {
  const both = AMOUNTS.map((a, i) => item(`b${i}`, a, i === 0 ? 'fuel' : 'operating', 'both', i === 0 ? { fuelDeliveryId: 'd1' } : {}))
  const extra = [item('wz', 12001, 'metering', 'heating'), item('wwz', 6001, 'metering', 'water')]
  const all = [...both, ...extra]
  const s = computeSettlement(selfSnapshot({ costItems: all }))
  for (const u of users(s)) {
    if (!u.tenancyId) continue
    assert.equal(u.heatingCents + u.waterCents, rowsOf(s, u.tenancyId, all.map((c) => c.id)), u.label)
  }
  assert.equal(users(s).reduce((a, u) => a + u.heatingCents + u.waterCents, 0), all.reduce((a, c) => a + c.amountCents, 0))
})

test('Mit Leerstand: die Blockbeträge der Zeilen des Vermieters ergeben mit denen der Mieter den Topf', () => {
  const heat = AMOUNTS.map((a, i) => item(`h${i}`, a, 'operating', 'heating'))
  const base = selfSnapshot({ costItems: heat })
  // Wohnung C steht ab Oktober leer: C2 entfällt.
  const s = computeSettlement(selfSnapshot({ costItems: heat, tenancies: base.tenancies.filter((t) => t.id !== 'C2') }))
  assert.equal(selfOf(s).ok, true)
  const total = heat.reduce((a, c) => a + c.amountCents, 0)
  assert.equal(users(s).reduce((a, u) => a + u.heatingCents, 0), total)
  const tenants = users(s).filter((u) => u.tenancyId)
  for (const u of tenants) assert.equal(u.heatingCents, rowsOf(s, u.tenancyId ?? '', heat.map((c) => c.id)), u.label)
  const landlord = s.landlord.rows.filter((r) => heat.some((c) => c.id === r.costItemId)).reduce((a, r) => a + r.shareCents, 0)
  assert.equal(users(s).filter((u) => !u.tenancyId).reduce((a, u) => a + u.heatingCents, 0), landlord)
})

test('Der CO₂-Abzug im Block teilt den gedruckten Abzug des Mieters ganz auf beide Töpfe', () => {
  const s = computeSettlement(selfSnapshot())
  let seen = 0
  for (const u of users(s)) {
    if (!u.tenancyId) continue
    const st = s.statements.find((x) => x.tenancyId === u.tenancyId) ?? assert.fail('keine Abrechnung')
    const relief = -st.rows.filter((r) => r.costItemId.startsWith('co2:') || r.costItemId.startsWith('gmodg:')).reduce((a, r) => a + r.shareCents, 0)
    assert.equal(u.heatingCo2Cents + u.waterCo2Cents, relief, u.label)
    if (relief > 0) seen++
  }
  assert.ok(seen > 0, 'Beispiel A hat einen CO₂-Abzug')
})

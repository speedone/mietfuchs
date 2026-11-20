// Der Block „Heizkostenabrechnung“ nennt je Nutzer und Topf den Betrag seiner Kostenzeilen (Systemprüfung 20.11.2026):
// Jede Position wird einmal gerundet verteilt (#202); der Block rechnete dagegen Topf mal Gewicht und rundete einmal,
// was ab zwei Positionen in einem Topf um einen Cent von der Kostentabelle desselben Blatts abweichen konnte.
// Grundlage ist Beispiel A (server/testing/selfHeating.ts) mit krummen Beträgen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { selfDelivery, selfSnapshot } from '../testing/selfHeating.ts'
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

// ---------- Durchsicht vom 20.11.2026 ----------

const BOTH = AMOUNTS.map((a, i) => item(`b${i}`, a, i === 0 ? 'fuel' : 'operating', 'both', i === 0 ? { fuelDeliveryId: 'd1' } : {}))
const potOf = (s: ComputedSettlement, p: 'heating' | 'water') => selfOf(s).pots.find((x) => x.pot === p) ?? assert.fail(`kein Topf ${p}`)

// Die Grenze je Topf: Positionen für Heizung und Warmwasser werden je Nutzer einmal geteilt, und zwar so, dass alle
// Nutzer zusammen den gedruckten Topf Heizung ergeben; der Rest ist Warmwasser. Der Topf Heizung stimmt damit genau,
// der Topf Warmwasser bis auf den einen Cent, um den zwei gerundete Topfbeträge zusammen von der Summe abweichen können.
test('Durchsicht: je Topf ergeben die Nutzer den gedruckten Topf, Heizung genau, Warmwasser auf einen Cent', () => {
  for (const extra of [[], [item('wz', 12001, 'metering', 'heating'), item('wwz', 6001, 'metering', 'water')]]) {
    for (const tenancies of [undefined, selfSnapshot().tenancies.filter((t) => t.id !== 'C2')]) {
      const s = computeSettlement(selfSnapshot({ costItems: [...BOTH, ...extra], ...(tenancies ? { tenancies } : {}) }))
      assert.equal(selfOf(s).ok, true)
      assert.equal(users(s).reduce((a, u) => a + u.heatingCents, 0), potOf(s, 'heating').costCents, 'Heizung')
      assert.ok(Math.abs(users(s).reduce((a, u) => a + u.waterCents, 0) - potOf(s, 'water').costCents) <= 1, 'Warmwasser')
      for (const u of users(s)) assert.ok(u.heatingCents >= 0 && u.waterCents >= 0, `${u.label}: kein negativer Topfbetrag`)
    }
  }
})

test('Durchsicht: der Ausweis nennt je Nutzer und Topf die Zahl der verteilten Zeilen', () => {
  const s = computeSettlement(selfSnapshot({ costItems: [...BOTH, item('wz', 12001, 'metering', 'heating'), item('wz2', 501, 'metering', 'heating'), item('wwz', 6001, 'metering', 'water')] }))
  for (const u of users(s)) assert.deepEqual([u.heatingRows, u.waterRows], [BOTH.length + 2, BOTH.length + 1], u.label)
})

test('Durchsicht: die Kürzung auf den Anteil Warmwasser im Hinweis rechnet mit dem Betrag des Ausweises', () => {
  const formel = { dhwMethod: 'volumeFormula' as const, dhwVolumeM3: 120, dhwTempC: 60, dhwUnmeasurable: null, exemption: 'lowDemand' as const, exemptionScope: 'heat' as const }
  const euro = (cents: number) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  const unitOf = (tenancyId: string) => (tenancyId.startsWith('C') ? 'C' : tenancyId)
  let seen = 0
  for (let add = 0; add < 60; add++) {
    const costItems = [...BOTH.map((c, i) => ({ ...c, amountCents: c.amountCents + add * (i + 1) })), item('wwz', 6001 + add, 'metering', 'water')]
    const s = computeSettlement(selfSnapshot({ plant: { heatGeneration: 'single' }, row: formel, deliveries: [selfDelivery({ gasBasis: 'hs' })], costItems }))
    const text = (s.notices.find((n) => n.code === 'heating.dhw-not-metered') ?? assert.fail('kein Hinweis')).text
    const part = /des Anteils am Warmwasser, hier: ([^:]*?): Gekürzt/.exec(text)?.[1] ?? assert.fail(text)
    for (const u of users(s)) {
      if (!u.tenancyId) continue
      const want = `${u.label} (${unitOf(u.tenancyId)}) ${euro(Math.round((u.waterCents - u.waterCo2Cents) * 0.15))}`
      assert.ok(part.includes(want), `„${want}“ fehlt in „${part}“`)
      seen++
    }
  }
  assert.ok(seen >= 240)
})

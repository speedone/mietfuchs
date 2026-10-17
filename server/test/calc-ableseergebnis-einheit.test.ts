// UI-Durchsicht H5 (#341), Durchsicht S3: Das Ableseergebnis für den Mieter nennt die Einheit des Zählers.
// Geprüft über computeSettlement, damit auch der Weg über calc.ts (Abbildung der Zähler auf SelfMeter)
// gesichert ist; ein Test über planSelf allein bliebe grün, wenn calc.ts die Einheit nicht weiterreicht.
// Die Verteilung rechnet weiter mit den rohen Ständen; die Umrechnung der Einheiten ist #342.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { selfMeters, selfSnapshot } from '../testing/selfHeating.ts'

test('Ableseergebnis: die Einheit des Zählers kommt über computeSettlement beim Mieter an', () => {
  const meters = selfMeters().map((m) => (m.id === 'wz-a' ? { ...m, unit: 'MWh' } : m))
  const s = computeSettlement(selfSnapshot({ meters }))
  const units = s.heating?.[0]?.self?.units ?? assert.fail('kein Ausweis der eigenen Abrechnung')
  const a = units.find((u) => u.unitId === 'a') ?? assert.fail('keine Wohnung a')
  const heat = a.readings.find((r) => r.meterId === 'wz-a') ?? assert.fail('kein Stand des Wärmezählers A')
  assert.equal(heat.meterUnit, 'MWh')
  const water = a.readings.find((r) => r.meterId === 'xw-a') ?? assert.fail('kein Stand des Warmwasserzählers A')
  assert.equal(water.meterUnit, 'm³')
})

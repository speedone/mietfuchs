// Plausibilität der CO₂-Angaben in der Abrechnung (Heizung PR 17, #97): ein Hinweis je Befund an der
// Heizanlage, keine Zahl ändert sich.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { co2Source, settleWithDelivery } from '../testing/co2Snapshot.ts'
import { computeSettlement } from '../src/calc.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'

const hints = (s: ReturnType<typeof settleWithDelivery>) => (s.notices ?? []).filter((n) => n.code === 'co2.cost-implausible')

test('Gas 2025, 10 t, 654,50 € plausibel; 550,00 € nicht: ein hint an der Anlage, keine Zahl ändert sich', () => {
  const gut = settleWithDelivery(2025, { co2CostCents: 65450 })
  assert.equal(hints(gut).length, 0)
  const schlecht = settleWithDelivery(2025, { co2CostCents: 55000 })
  const [n, ...rest] = hints(schlecht)
  if (!n) return assert.fail('kein Hinweis')
  assert.equal(rest.length, 0)
  assert.equal(n.level, 'hint')
  assert.equal(n.title, 'CO₂-Angaben der Rechnung prüfen')
  assert.deepEqual(n.subject, { kind: 'heatingCosts', id: 'hp' })
  assert.match(n.text, /„Gasrechnung“: Die CO₂-Kosten von 550,00 €/)
  assert.ok(schlecht.warnings.includes(n.text), 'auch unter den Texten der Warnungen')
})

test('Heizöl (Vorratsenergie): die Lieferungen der Heizperiode werden ebenso geprüft', () => {
  const oel = { deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', invoiceFrom: null, invoiceTo: null, quantity: 3000, quantityUnit: 'l' as const, emissionsKg: 8028.9, label: 'Heizöl März' }
  assert.equal(hints(settleWithDelivery(2025, { ...oel, co2CostCents: 52549 }, [], { energy: 'oil' })).length, 0)
  const [n] = hints(settleWithDelivery(2025, { ...oel, co2CostCents: 44159 }, [], { energy: 'oil' }))
  assert.match(n?.text ?? '', /„Heizöl März“: Die CO₂-Kosten von 441,59 €/)
  assert.equal(hints(settleWithDelivery(2025, { ...oel, emissionsKg: 9500 }, [], { energy: 'oil' })).length, 1, 'kg über dem Standardwert')
})

test('Wer nichts einträgt, merkt nichts: ohne CO₂-Kosten und kWh kein Hinweis und kein Wert der Prüfung im Rechtsstand', () => {
  const s = settleWithDelivery(2025, {})
  assert.equal(hints(s).length, 0)
  const ids = s.legalBasis.values.map((v) => v.id)
  assert.ok(!ids.includes('co2.price') && !ids.includes('co2.ebev-factors') && !ids.includes('ustg.standard-rate'), ids.join(', '))
})

test('Die benutzten Werte stehen im Rechtsstand, als Plausibilität benannt', () => {
  const s = settleWithDelivery(2025, { co2CostCents: 65450, energyKwh: 55129, gasBasis: 'hs' })
  const ids = s.legalBasis.values.map((v) => v.id)
  assert.ok(ids.includes('co2.price'))
  assert.ok(ids.includes('co2.ebev-factors'))
  assert.ok(ids.includes('ustg.standard-rate'))
  assert.match(s.legalBasis.values.find((v) => v.id === 'co2.price')?.title ?? '', /Plausibilität/)
  assert.equal(hints(s).length, 0, '55.129 kWh × 0,0558 × 3,2508 = 10.000 kg')
})

test('kg und € zugleich unplausibel: zwei Hinweise unter einem Code', () => {
  const s = settleWithDelivery(2025, { co2CostCents: 55000, energyKwh: 100000, gasBasis: 'hs' })
  assert.deepEqual(hints(s).map((n) => /kg CO₂ passen nicht zu 100\.000 kWh/.test(n.text) ? 'kg' : 'euro').sort(), ['euro', 'kg'])
})

test('Fernwärme aus dem Emissionshandel mit Anschluss nach dem Stichtag: keine Prüfung (§ 2 Abs. 4 Satz 2)', () => {
  const s = settleWithDelivery(2025, { co2CostCents: 1 }, [], { energy: 'districtHeating', districtEtsNew: true })
  assert.equal(hints(s).length, 0)
  assert.equal(hints(settleWithDelivery(2025, { co2CostCents: 1 }, [], { energy: 'districtHeating' })).length, 1, 'ohne die Angabe wird geprüft')
})

test('Eine Rechnung, die die Heizperiode nicht berührt, wird hier nicht geprüft', () => {
  const s = settleWithDelivery(2025, { co2CostCents: 1, invoiceFrom: '2024-01-01', invoiceTo: '2024-12-31', invoiceDate: '2025-01-20' })
  assert.equal(hints(s).length, 0)
})

// ---------- Durchsicht Runde 1 (#246) ----------

const P = (key: string, rules = CALENDAR_RULES) => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

test('G-K1: eine stornierte Rechnung (Positionen ergeben 0 €) löst keinen Hinweis aus', () => {
  const src = co2Source(2025, { co2CostCents: 1000 })
  const storno = { ...src, costItems: [...src.costItems, { id: 'gut', propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: 'Gutschrift', amountCents: -300000, key: 'area' as const, heatingPlantId: 'hp', fuelDeliveryId: 'd' }] }
  assert.equal(hints(computeSettlement(snapshotFor(src, 'objekt-1', P('2025-01')))).length, 1, 'ohne Storno: Hinweis')
  assert.equal(hints(computeSettlement(snapshotFor(storno, 'objekt-1', P('2025-01')))).length, 0)
})

const eintrag2027 = [{ paramId: 'co2.price', validFrom: '2027-01-01', value: 64.2, source: 'UBA', enteredAt: '2026-12-20' }]
// Eine Anlage mit eigener Heizperiode Mai bis April im Kalenderobjekt (Weg b): Die Heizperiode 2026/2027 endet
// in der Abrechnung 2027 und wird als Teil gerechnet.
const wegB = () => {
  const src = co2Source(2027, { co2CostCents: 76398, invoiceFrom: '2026-05-01', invoiceTo: '2027-04-30', invoiceDate: '2027-05-20' }, eintrag2027, { periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false })
  return { ...src, costItems: src.costItems.map((c) => ({ ...c, period: periodKey('2026-05') })) }
}

test('K5 b: Ein eingetragener Wert aus einer Heizperiode nach Weg b steht genau einmal in den Hinweisen', () => {
  const s = computeSettlement(snapshotFor(wegB(), 'objekt-1', P('2027-01')))
  assert.equal((s.notices ?? []).filter((n) => n.code === 'law.value-overridden').length, 1)
})

test('K5 c: Die Heizkostenabrechnung nach Weg d bekommt die Einträge des Vermieters', () => {
  const snap = heatingSnapshotFor(wegB(), 'objekt-1', 'hp', P('2026-05', { startMonth: 5, changes: [] })) ?? assert.fail('kein Schnappschuss')
  assert.deepEqual(snap.lawOverrides, eintrag2027)
})

// Beim Einreihen hinter Heizung PR 14 (#243): Unter einer Ausnahme nach § 11 für Wärme und Warmwasser ohne
// vereinbarte Abrechnung gilt das CO2KostAufG nicht (§ 2 Abs. 7); dann prüft Mietfuchs auch nicht, dieselbe
// Bedingung wie die Aufteilung. Mit vereinbarter Abrechnung wird wieder geprüft.
test('Ausnahme nach § 11 für Wärme und Warmwasser: keine Prüfung, außer die Abrechnung ist vereinbart', () => {
  const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
  const mit = (rules: Record<string, unknown>) => {
    const src = co2Source(2025, { co2CostCents: 55000 })
    return computeSettlement(snapshotFor({ ...src, heatingPeriodRows: [{ plantId: 'hp', period: P.key, dhwMethod: null, dhwUnmeasurable: null, ...rules }] }, 'objekt-1', P))
  }
  assert.equal(hints(mit({})).length, 1, 'ohne Ausnahme geprüft')
  assert.equal(hints(mit({ exemption: 'authority', exemptionScope: 'both' })).length, 0)
  assert.equal(hints(mit({ exemption: 'authority', exemptionScope: 'both', exemptionBillingAgreed: true })).length, 1)
  assert.equal(hints(mit({ exemption: 'authority', exemptionScope: 'heat' })).length, 1, 'nur die Wärme ausgenommen: weiter aufgeteilt, weiter geprüft')
})

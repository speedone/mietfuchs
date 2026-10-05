// Abgeschlossene Jahre gegen die heutige Berechnung (#56, Teil 1). Der eingefrorene Stand bleibt,
// wie er ist; Mietfuchs sagt nur, wenn die heutige Rechnung für einen Mieter etwas anderes ergibt,
// und in welche Richtung.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareWithFrozen } from '../src/settlementDiff.ts'

const statement = (tenancyId: string, balanceCents: number) => ({ tenancyId, tenantName: tenancyId, unitName: 'EG', balanceCents })

test('Gleiche Salden: keine Abweichung', () => {
  const r = compareWithFrozen({ statements: [statement('t', 6667)] }, { statements: [statement('t', 6667)] }, 2025, '2026-10-01')
  assert.deepEqual(r, { comparable: true, deviations: [], valueChanges: [], deadline: '2026-12-31', deadlinePassed: false })
})

test('Mehr Guthaben heute: zugunsten des Mieters; weniger: zugunsten des Vermieters', () => {
  const r = compareWithFrozen(
    { statements: [statement('a', 6667), statement('b', -1000)] },
    { statements: [statement('a', 8000), statement('b', -2500)] },
    2025, '2027-01-02',
  )
  assert.deepEqual(r.deviations.map((d) => [d.tenancyId, d.differenceCents, d.direction]), [['a', 1333, 'tenant'], ['b', -1500, 'landlord']])
  assert.equal(r.deadlinePassed, true)
})

test('Ein Mietverhältnis, das nur auf einer Seite steht, bekommt keine Richtung, sondern „hinzugekommen“ oder „entfallen“', () => {
  // Befund der Durchsicht: Wechselt eine Wohnung das Objekt oder wird ein Mietverhältnis gelöscht,
  // ist nichts nachgerechnet worden, und ein Urteil über die Richtung wäre sinnlos.
  const r = compareWithFrozen(
    { statements: [statement('a', 0), statement('weg', -300)] },
    { statements: [statement('a', 0), statement('neu', -500)] },
    2025, '2026-01-01',
  )
  assert.deepEqual(r.deviations.map((d) => [d.tenancyId, d.frozenBalanceCents, d.currentBalanceCents, d.direction]), [
    ['weg', -300, null, 'removed'],
    ['neu', null, -500, 'added'],
  ])
})

test('Die heutige Berechnung darf die Ansicht nicht verhindern: scheitert sie, ist der Stand nicht vergleichbar', () => {
  const r = compareWithFrozen({ statements: [statement('a', 0)] }, () => { throw new Error('kaputt') }, 2025, '2026-01-01')
  assert.equal(r.comparable, false)
})

test('Ein eingefrorener Stand, der sich nicht lesen lässt, ist nicht vergleichbar statt „keine Abweichung“', () => {
  for (const kaputt of [null, 'Text', {}, { statements: 'nein' }, { statements: [{ tenancyId: 1 }] }]) {
    const r = compareWithFrozen(kaputt, { statements: [statement('a', 0)] }, 2025, '2026-01-01')
    assert.equal(r.comparable, false, JSON.stringify(kaputt))
    assert.deepEqual(r.deviations, [])
  }
})

// ---------- Rechtswerte (Heizung PR 1, Entwurf 4.4) ----------

const applied = (id: string, value: number, text: string) => ({ id, title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung', norm: '§ 12 Abs. 1 Satz 1 HeizkostenV', cite: '§ 12 Abs. 1 Satz 1 HeizkostenV', value, text })

test('Rechtswerte: ein heute anderer Wert steht mit beiden Texten da, die Salden bleiben davon getrennt', () => {
  const r = compareWithFrozen(
    { statements: [statement('t', 0)], legalBasis: { asOf: '2026-10-05', rules: [], values: [applied('hkv.cut.not-by-consumption', 15, '15 %')] } },
    { statements: [statement('t', 0)], legalBasis: { values: [applied('hkv.cut.not-by-consumption', 12, '12 %')] } },
    2025, '2026-10-01',
  )
  assert.deepEqual(r.deviations, [])
  assert.deepEqual(r.valueChanges, [{ id: 'hkv.cut.not-by-consumption', title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung', frozenText: '15 %', currentText: '12 %' }])
})

test('Rechtswerte: gleiche Werte, Werte auf nur einer Seite und Abschlüsse vor 0.11.0 ergeben keine Änderung', () => {
  const now = { statements: [statement('t', 0)], legalBasis: { values: [applied('hkv.cut.not-by-consumption', 15, '15 %')] } }
  const same = compareWithFrozen({ statements: [statement('t', 0)], legalBasis: { values: [applied('hkv.cut.not-by-consumption', 15, '15 %')] } }, now, 2025, '2026-10-01')
  assert.deepEqual(same.valueChanges, [])
  const onlyThen = compareWithFrozen({ statements: [statement('t', 0)], legalBasis: { values: [applied('practice.vacancy-persons', 1, '1 Person je Leerstandstag')] } }, now, 2025, '2026-10-01')
  assert.deepEqual(onlyThen.valueChanges, [])
  const old = compareWithFrozen({ statements: [statement('t', 0)], legalBasis: { asOf: '2026-10-02', rules: [] } }, now, 2025, '2026-10-01')
  assert.deepEqual(old.valueChanges, [])
  assert.equal(old.comparable, true)
})

test('Rechtswerte: ein unlesbarer eingefrorener Eintrag fällt weg, statt eine Änderung zu behaupten', () => {
  const r = compareWithFrozen(
    { statements: [statement('t', 0)], legalBasis: { values: [null, { id: 'hkv.cut.not-by-consumption', value: 15 }, 'kaputt'] } },
    { statements: [statement('t', 0)], legalBasis: { values: [applied('hkv.cut.not-by-consumption', 12, '12 %')] } },
    2025, '2026-10-01',
  )
  assert.deepEqual(r.valueChanges, [])
})

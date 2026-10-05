// Der gemerkte Umlageschlüssel (#141): Was als „derselbe Schlüssel wie im Vorjahr“ gilt, und
// welcher Schlüssel aus dem Vorjahr vorgeschlagen wird. Dieselbe Regel nutzen Oberfläche und
// Berechnung (shared/allocation.ts), damit der Vorschlag nie selbst den Hinweis auslöst.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocationOf, previousAllocation, sameAllocation, type AllocatedItem } from '../../shared/allocation.ts'
import { calendarContext, calendarPeriod, periodContext, periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

const item = (over: Partial<AllocatedItem> & Pick<AllocatedItem, 'period' | 'category'>): AllocatedItem => ({ key: 'area', description: over.category, ...over })

test('Schlüssel: nur die Angaben, die zum Schlüssel gehören, zählen', () => {
  // Ein stehengebliebener Zählertyp an einer Flächenposition ist kein anderer Schlüssel.
  const a = allocationOf(item({ period: calendarPeriod(2025), category: 'Müllabfuhr', key: 'area', meterType: 'kaltwasser' }))
  const b = allocationOf(item({ period: calendarPeriod(2026), category: 'Müllabfuhr', key: 'area' }))
  assert.equal(sameAllocation(a, b), true)
  assert.equal(a.meterType, null)
})

test('Schlüssel: Teilnehmer in anderer Reihenfolge sind dieselben, andere Teilnehmer nicht', () => {
  const a = allocationOf(item({ period: calendarPeriod(2025), category: 'Aufzug', participantUnitIds: ['u1', 'u2'] }))
  const b = allocationOf(item({ period: calendarPeriod(2026), category: 'Aufzug', participantUnitIds: ['u2', 'u1'] }))
  const c = allocationOf(item({ period: calendarPeriod(2026), category: 'Aufzug', participantUnitIds: ['u1'] }))
  const alle = allocationOf(item({ period: calendarPeriod(2026), category: 'Aufzug', participantUnitIds: null }))
  assert.equal(sameAllocation(a, b), true)
  assert.equal(sameAllocation(a, c), false)
  assert.equal(sameAllocation(a, alle), false)
})

test('Schlüssel: Zählertyp, Wohnung, Anteile und Maßstab unterscheiden; die Summe der Anlage nicht', () => {
  const meter = (t: 'kaltwasser' | 'waerme') => allocationOf(item({ period: calendarPeriod(2025), category: 'Wasser/Abwasser', key: 'meter', meterType: t }))
  assert.equal(sameAllocation(meter('kaltwasser'), meter('waerme')), false)
  const direct = (u: string) => allocationOf(item({ period: calendarPeriod(2025), category: 'Sonstige Betriebskosten', key: 'direct', directUnitId: u }))
  assert.equal(sameAllocation(direct('u1'), direct('u2')), false)
  const custom = (p: number) => allocationOf(item({ period: calendarPeriod(2025), category: 'Gartenpflege', key: 'custom', customShares: { u1: p, u2: 100 - p } }))
  assert.equal(sameAllocation(custom(40), custom(40)), true)
  assert.equal(sameAllocation(custom(40), custom(50)), false)
  const ext = (measure: 'mea' | 'area', total: number) =>
    allocationOf(item({ period: calendarPeriod(2025), category: 'Hauswart', key: 'external', externalBasis: { measure, total, totalCents: 100000 } }))
  // Die Summe der Anteile ist eine Angabe über die Anlage, kein Schlüssel.
  assert.equal(sameAllocation(ext('mea', 1000), ext('mea', 1010)), true)
  assert.equal(sameAllocation(ext('mea', 1000), ext('area', 1000)), false)
  // Der Maßstab samt Summe kommt mit; die Kosten der Gemeinschaft sind eine Zahl des Jahres.
  assert.deepEqual(ext('mea', 1000).externalBasis, { measure: 'mea', total: 1000 })
})

test('Vorjahr: der Schlüssel der Kostenart im Vorjahr, nicht aus anderen Jahren oder Kostenarten', () => {
  const items = [
    item({ period: calendarPeriod(2024), category: 'Müllabfuhr', key: 'units' }),
    item({ period: calendarPeriod(2025), category: 'Müllabfuhr', key: 'persons' }),
    item({ period: calendarPeriod(2025), category: 'Grundsteuer', key: 'area' }),
  ]
  assert.equal(previousAllocation(items, 'Müllabfuhr', calendarContext(2026))?.key, 'persons')
  assert.equal(previousAllocation(items, 'Müllabfuhr', calendarContext(2025))?.key, 'units')
  assert.equal(previousAllocation(items, 'Aufzug', calendarContext(2026)), null)
  // Zwei Jahre zurück gilt nicht als Vorjahr.
  assert.equal(previousAllocation(items, 'Müllabfuhr', calendarContext(2027)), null)
})

test('Vorjahr: widersprechen sich die Positionen, gibt es keinen Vorschlag', () => {
  const items = [
    item({ period: calendarPeriod(2025), category: 'Wasser/Abwasser', key: 'persons' }),
    item({ period: calendarPeriod(2025), category: 'Wasser/Abwasser', key: 'meter', meterType: 'kaltwasser' }),
  ]
  assert.equal(previousAllocation(items, 'Wasser/Abwasser', calendarContext(2026)), null)
  // Gleiche Schlüssel mehrfach: ein Vorschlag, mit der Summe der zuletzt angelegten Position.
  const ext = [
    item({ period: calendarPeriod(2025), category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } }),
    item({ period: calendarPeriod(2025), category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1010, totalCents: 2 } }),
  ]
  assert.deepEqual(previousAllocation(ext, 'Hauswart', calendarContext(2026))?.externalBasis, { measure: 'mea', total: 1010 })
})

test('Durchsicht: breite Kostenart nur über die Beschreibung, mit ersetzter Jahreszahl', () => {
  const items = [item({ period: calendarPeriod(2025), category: 'Sonstige Betriebskosten', key: 'direct', directUnitId: 'u1', description: 'Wartung Hebeanlage 2025' })]
  assert.equal(previousAllocation(items, 'Sonstige Betriebskosten', calendarContext(2026)), null)
  assert.equal(previousAllocation(items, 'Sonstige Betriebskosten', calendarContext(2026), 'Reinigung Dachrinne'), null)
  assert.equal(previousAllocation(items, 'Sonstige Betriebskosten', calendarContext(2026), ' wartung hebeanlage 2026 ')?.directUnitId, 'u1')
  // Eine gewöhnliche Kostenart mit einer Position braucht keine passende Beschreibung.
  const muell = [item({ period: calendarPeriod(2025), category: 'Müllabfuhr', key: 'units', description: 'Abfall' })]
  assert.equal(previousAllocation(muell, 'Müllabfuhr', calendarContext(2026), 'Müll 2026')?.key, 'units')
})

test('Vorzeitraum: gesucht wird nach Zeitraum und nicht nach Jahreszahl (#208)', () => {
  const mai: PeriodRules = { startMonth: 5, changes: [] }
  const at = periodContext(mai, periodOfKey(mai, periodKey('2025-05')) ?? assert.fail('kein Zeitraum'))
  const items: AllocatedItem[] = [
    { period: periodKey('2024-05'), category: 'Müllabfuhr', key: 'persons', description: 'Müll' },
    // Beginnt im selben Kalenderjahr wie der Vorzeitraum, ist aber ein anderer Zeitraum.
    { period: periodKey('2024-01'), category: 'Müllabfuhr', key: 'area', description: 'Müll' },
  ]
  assert.equal(previousAllocation(items, 'Müllabfuhr', at)?.key, 'persons')
})

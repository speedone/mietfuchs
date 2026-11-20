// Rechtswerte der Mieterhöhung (#191, Entwurf docs/superpowers/specs/2026-11-20-mieterhoehung-design.md, Abschnitt
// Rechtsregister): Werte, Fundstellen und Prüfstand. Gerechnet wird mit ihnen erst ab PR 2.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { bgbIndexRent, bgbRentCap, bgbRentIncreaseConsent, bgbRentIncreaseLockMonths, bgbRentIncreaseWaitMonths, bgbStaggeredRent } from '../../shared/law/bgb-betrkv.ts'
import { practiceRentIncreaseRounding, practiceVpiSeries } from '../../shared/law/practice.ts'

test('Mieterhöhung: die Werte des Registers nach dem Wortlaut (§§ 557a, 557b, 558, 558b BGB)', () => {
  assert.equal(valueAt(bgbRentIncreaseWaitMonths, LAW_AS_OF), 15)
  assert.equal(valueAt(bgbRentIncreaseLockMonths, LAW_AS_OF), 12)
  assert.deepEqual(valueAt(bgbRentCap, LAW_AS_OF), { years: 3, percent: 20, reducedPercent: 15 })
  assert.deepEqual(valueAt(bgbRentIncreaseConsent, LAW_AS_OF), { consentMonths: 2, effectiveMonth: 3, suitMonths: 3 })
  assert.deepEqual(valueAt(bgbIndexRent, LAW_AS_OF), { minMonths: 12, effectiveMonthOffset: 2 })
  assert.deepEqual(valueAt(bgbStaggeredRent, LAW_AS_OF), { minMonths: 12 })
  assert.equal(valueAt(practiceRentIncreaseRounding, LAW_AS_OF), 'floor-cent')
  assert.deepEqual(valueAt(practiceVpiSeries, LAW_AS_OF), { table: '61111-0002', base: 2020 })
})

test('Mieterhöhung: Gesetzeswerte am Wortlaut geprüft, Festlegungen als übernommen gekennzeichnet', () => {
  for (const p of [bgbRentIncreaseWaitMonths, bgbRentIncreaseLockMonths, bgbRentCap, bgbRentIncreaseConsent, bgbIndexRent, bgbStaggeredRent]) {
    for (const v of p.versions) {
      assert.equal(v.source.rank, 'law', p.id)
      assert.equal(v.source.checked, 'checked', p.id)
      assert.match(v.source.url, /^https:\/\/www\.gesetze-im-internet\.de\/bgb\/__55[78][ab]?\.html$/, p.id)
      assert.equal(v.source.retrieved, '2026-11-20', p.id)
    }
  }
  assert.equal(practiceRentIncreaseRounding.versions[0]?.source.rank, 'interpretation')
  assert.equal(practiceRentIncreaseRounding.versions[0]?.source.checked, 'adopted')
  assert.equal(practiceVpiSeries.versions[0]?.source.checked, 'adopted')
})

test('Mieterhöhung: alle Werte stehen in LAW_PARAMS, ein Postlauf nicht (kein belastbarer Beleg, Entwurf S7)', () => {
  const ids = new Set(LAW_PARAMS.map((p) => p.id))
  for (const id of ['bgb.rent-increase-wait-months', 'bgb.rent-increase-lock-months', 'bgb.rent-cap', 'bgb.rent-increase-consent', 'bgb.index-rent', 'bgb.staggered-rent', 'practice.rent-increase-rounding', 'practice.vpi-series']) {
    assert.ok(ids.has(id), id)
  }
  assert.ok(!ids.has('practice.letter-delivery-days'))
})

test('Mieterhöhung: die Beschreibungen nennen die Zahlen in Worten des Gesetzes', () => {
  assert.equal(bgbRentCap.describe({ years: 3, percent: 20, reducedPercent: 15 }), 'innerhalb von 3 Jahren höchstens 20 % mehr, in Gebieten mit Verordnung 15 %')
  assert.equal(bgbRentIncreaseConsent.describe({ consentMonths: 2, effectiveMonth: 3, suitMonths: 3 }), 'Zustimmung bis zum Ablauf des 2. Kalendermonats nach Zugang, erhöhte Miete ab Beginn des 3., Klage binnen 3 weiterer Monate')
  assert.equal(bgbIndexRent.describe({ minMonths: 12, effectiveMonthOffset: 2 }), 'Miete mindestens 12 Monate unverändert, geänderte Miete ab Beginn des 2. Monats nach Zugang')
})

// Laufende, künftige und beendete Mietverhältnisse in den Stammdaten, bezogen auf heute.
import { expect, test } from 'vitest'
import { splitTenancies, tenancyPhase } from './tenancyList'

const t = (id: string, start: string, end: string | null = null) => ({ id, start, end })
const TODAY = '2026-10-24'

test('Phase: beendet erst nach dem Auszugstag, künftig ab dem Tag nach heute', () => {
  expect(tenancyPhase(t('a', '2020-01-01'), TODAY)).toBe('current')
  expect(tenancyPhase(t('a', '2020-01-01', '2026-10-24'), TODAY)).toBe('current')
  expect(tenancyPhase(t('a', '2020-01-01', '2026-10-23'), TODAY)).toBe('former')
  expect(tenancyPhase(t('a', '2026-10-24'), TODAY)).toBe('current')
  expect(tenancyPhase(t('a', '2026-10-25'), TODAY)).toBe('future')
  expect(tenancyPhase(t('a', '2026-11-01', '2027-12-31'), TODAY)).toBe('future')
  // Ein leeres Ende ist kein Auszug
  expect(tenancyPhase({ id: 'a', start: '2020-01-01', end: '' }, TODAY)).toBe('current')
})

test('laufende und künftige in der Reihenfolge der Liste, beendete neueste zuerst', () => {
  const list = [
    t('alt1', '2010-01-01', '2015-06-30'),
    t('lauf1', '2015-07-01'),
    t('alt2', '2012-01-01', '2019-12-31'),
    t('kuenftig', '2026-12-01'),
    t('alt3', '2016-01-01', '2019-12-31'),
    t('lauf2', '2020-01-01', '2027-03-31'),
  ]
  const { current, former } = splitTenancies(list, TODAY)
  expect(current.map((x) => x.id)).toEqual(['lauf1', 'kuenftig', 'lauf2'])
  // Gleicher Auszug: der spätere Einzug zuerst
  expect(former.map((x) => x.id)).toEqual(['alt3', 'alt2', 'alt1'])
  expect(splitTenancies([], TODAY)).toEqual({ current: [], former: [] })
})

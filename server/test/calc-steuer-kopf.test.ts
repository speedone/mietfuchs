// Kopf der Anlage V (#96 PR 2, Entwurf docs/superpowers/specs/2026-10-30-steuer-objekt-ruecklage-design.md, B3):
// `costModels.relativeTenancies` zählt die Mietverhältnisse des Jahres, die an Angehörige zu Wohnzwecken vermietet
// sind (Zeile 10, Kennzahl 62 des Vordrucks 2025). Eine **Anzahl**, nicht Cent (Durchsicht X11). Ohne Kennzeichen fehlt
// das Feld, und keine Zahl ändert sich (Leitsatz des Entwurfs; Prüfsummen tax-golden.json in outflow.test.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReportFor } from '../src/calc.ts'
import { snapshotFor, type SnapshotTenancy } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarPeriod, periodOfKey } from '../../shared/period.ts'

let paymentSeq = 0
const pid = (): string => `p${String(++paymentSeq).padStart(4, '0')}`

const tenancy = (id: string, unitId: string, start: string, end: string | null, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
  prepayments: [{ from: start.slice(0, 7), monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [{ from: start.slice(0, 7), monthlyCents: 50000 }],
  ...over,
})

const source = (tenancies: SnapshotTenancy[]) => ({
  properties: [{ id: 'objekt-1', kind: 'mfh' as const, cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [
    { id: 'eg', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true },
    { id: 'og', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: true },
  ],
  tenancies,
  costItems: [{ id: 'vers', propertyId: 'objekt-1', period: calendarPeriod(2025), category: 'Gebäudeversicherung', description: 'Versicherung', amountCents: 100000, key: 'area' as const }],
  meters: [], readings: [],
  payments: [{ id: pid(), tenancyId: 'tochter', date: '2025-03-01', amountCents: 60000 }],
  closedSettlements: [],
})

test('Angehörige: gezählt werden nur Mietverhältnisse des Jahres mit Kennzeichen', () => {
  const stock = source([
    tenancy('tochter', 'eg', '2025-03-01', null, { relative: true }),
    tenancy('frueher', 'og', '2023-01-01', '2024-12-31', { relative: true }),
    tenancy('fremd', 'og', '2025-01-01', null),
  ])
  assert.equal(taxReportFor(stock, 'objekt-1', 2025).costModels.relativeTenancies, 1)
  assert.equal(taxReportFor(stock, 'objekt-1', 2024).costModels.relativeTenancies, 1, 'die frühere Angehörige zählt in ihrem Jahr')
  assert.equal(taxReportFor(stock, 'objekt-1', 2026).costModels.relativeTenancies, 1)
})

test('Angehörige: ohne Kennzeichen fehlt das Feld, und Steuer und Abrechnung sind dieselben wie mit (X9 g)', () => {
  const ohne = source([tenancy('tochter', 'eg', '2025-03-01', null), tenancy('fremd', 'og', '2025-01-01', null)])
  const mit = source([tenancy('tochter', 'eg', '2025-03-01', null, { relative: true }), tenancy('fremd', 'og', '2025-01-01', null, { relative: false })])
  const r = taxReportFor(ohne, 'objekt-1', 2025)
  assert.equal('relativeTenancies' in r.costModels, false)
  const { costModels: { relativeTenancies, ...restMit }, ...mitRest } = taxReportFor(mit, 'objekt-1', 2025)
  assert.equal(relativeTenancies, 1)
  const { costModels: restOhne, ...ohneRest } = r
  assert.deepEqual(restMit, restOhne)
  assert.deepEqual(mitRest, ohneRest)
  // Die Abrechnung liest das Kennzeichen nicht.
  const p = periodOfKey(CALENDAR_RULES, calendarPeriod(2025)) ?? assert.fail('kein Zeitraum 2025')
  const settle = (s: ReturnType<typeof source>) => computeSettlement(snapshotFor(s, 'objekt-1', p))
  assert.deepEqual(settle(mit), settle(ohne))
})

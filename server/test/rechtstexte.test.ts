// Rechtsaussagen nach der Recherche vom 30.09.2026 (#109). Jede Zusicherung hier steht für eine
// belegte Korrektur; die Quellen stehen im Kommentar zu #109. Wer einen Text ändert, prüft ihn
// gegen diese Quellen, nicht gegen den Test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { RULES } from '../src/rules.ts'
import { snapshotOf, type SnapshotSource } from '../src/snapshot.ts'
import { GLOSSARY } from '../../shared/glossary.ts'

const rule = (code: string) => RULES.find((r) => r.code === code)

test('Kabelfernsehen: nur Anlagen vor dem 01.12.2021, und bei der Verteilanlage bleibt nur der Betriebsstrom (§ 2 Satz 2 BetrKV)', () => {
  const r = rule('tv-signal')
  assert.match(r?.norm ?? '', /Satz 2 BetrKV/)
  assert.match(r?.summary ?? '', /01\.12\.2021/)
  assert.match(r?.summary ?? '', /Verteilanlage nur (den|der) Betriebsstrom/)
  assert.match(GLOSSARY.cableTv.short, /01\.12\.2021/)
  const source: SnapshotSource = {
    units: [{ id: 'u', name: 'EG', areaM2: 50, participates: true }],
    tenancies: [{ id: 't', unitId: 'u', tenantName: 'M', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
    costItems: [{ id: 'k', year: 2025, category: 'Kabel/Antenne', description: 'Kabel', amountCents: 12000, key: 'units' }],
    meters: [], readings: [], payments: [], closedSettlements: [],
  }
  const w = computeSettlement(snapshotOf(source, 2025)).warnings.join(' ')
  assert.doesNotMatch(w, /Betriebsstrom und Wartung einer Antennenanlage/)
  assert.match(w, /nur noch den Betriebsstrom/)
})

test('Warmmiete: keine automatische Ausnahme, und der Heizanteil wird zur Vorauszahlung (BGH VIII ZR 212/05)', () => {
  const r = rule('heating-flat-rate')
  assert.match(r?.norm ?? '', /VIII ZR 212\/05/)
  assert.match(r?.summary ?? '', /Vorauszahlung/)
  assert.match(GLOSSARY.heatingCostOrdinance.needed, /vereinbaren/)
  assert.match(GLOSSARY.heatingCostOrdinance.needed, /Wärmepumpen/)
})

test('Lexikon: die belegten Berichtigungen stehen da', () => {
  assert.match(GLOSSARY.labor35a.short, /ohne Material/)
  assert.match(GLOSSARY.labor35a.short, /je Haushalt/)
  assert.match(GLOSSARY.ownShare.short, /Leerstand/)
  assert.match(GLOSSARY.consumptionKey.needed, /alle vermieteten Wohnungen/)
  assert.doesNotMatch(GLOSSARY.mainMeter.short, /trägt den Rest der Vermieter/)
  assert.match(GLOSSARY.mainMeter.short, /nach Fläche/)
})

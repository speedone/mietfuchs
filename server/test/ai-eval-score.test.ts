// Die Bewertung des KI-Prüflaufs (scripts/ai-eval/score.mjs) für die Belege der Heizung (Heizung PR 20, #103).
// Läuft ohne Modell: Geprüft wird, dass eine richtige Auswertung alle Punkte bekommt und typische Fehler
// (Nachzahlung statt Rechnungsbetrag, Brennwert als Heizwert, Abzugszeile vergessen, eine Nutzerzeile
// zu viel) Punkte kosten. Die Belege sind erfunden; ihre Zahlen stehen nachgerechnet im Kommentar je Datei.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { score, scoreFuel, scoreService } from '../../scripts/ai-eval/score.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
type Case = { name: string; kind?: string; file: string; expected: Record<string, unknown> }
const { cases }: { cases: Case[] } = JSON.parse(fs.readFileSync(path.join(root, 'scripts/ai-eval/cases.json'), 'utf8'))
const byName = (name: string): Case => cases.find((c) => c.name === name) ?? assert.fail(`Fall ${name} fehlt`)
type Block = { category: string; total: number; lines: number[]; vacancyLines?: number }
const blocksOf = (e: Record<string, unknown>): Block[] => (Array.isArray(e.blocks) ? e.blocks : assert.fail('Blöcke fehlen'))
const partsOf = (e: Record<string, unknown>): Record<string, unknown>[] => (Array.isArray(e.parts) ? e.parts : assert.fail('Teilmengen fehlen'))

test('Jeder neue Fall hat seinen Beleg und seine Art', () => {
  for (const [name, kind] of [['metering-service', 'service'], ['gas-supplier', 'fuel'], ['heating-oil', 'fuel']]) {
    const c = byName(name)
    assert.equal(c.kind, kind, name)
    assert.ok(fs.existsSync(path.join(root, 'scripts/ai-eval', c.file)), name)
  }
})

test('Die Belege sind erfunden: Muster-IBAN, keine echten Namen (server/src/ai/CLAUDE.md, KI-Prüflauf)', () => {
  for (const name of ['metering-service', 'gas-supplier', 'heating-oil']) {
    const html = fs.readFileSync(path.join(root, 'scripts/ai-eval', byName(name).file), 'utf8')
    assert.match(html, /Erfundener Beispielbeleg/, name)
    for (const iban of html.match(/IBAN [A-Z]{2}\d{2}[\d ]+/g) ?? []) assert.match(iban, /^IBAN DE00/, `${name}: ${iban}`)
  }
})

test('Messdienst: die Sollwerte selbst ergeben volle Punkte, eine vergessene Abzugszeile und eine Zeile zu viel nicht', () => {
  const e = byName('metering-service').expected
  const perfect = {
    vendor: 'Wärmedienst Beispiel GmbH', periodStart: e.periodStart, periodEnd: e.periodEnd, unitsCount: e.unitsCount, usersTotalEur: e.usersTotal,
    deductionEur: e.deduction, fuelGrossEur: e.fuelGross, fuelNetEur: e.fuelNet, co2: e.co2, dhwMethod: e.dhwMethod,
    blocks: blocksOf(e).map((b) => ({
      category: b.category, totalEur: b.total, lines: b.lines.map((amountEur, i) => ({ amountEur, vacancy: i === 1 && (b.vacancyLines ?? 0) > 0 })),
    })),
  }
  assert.equal(scoreService(e, perfect).points, 1)
  assert.ok(scoreService(e, { ...perfect, deductionEur: null }).failed.includes('Abzugszeile'))
  const [heizung, ...rest] = perfect.blocks
  if (!heizung) assert.fail('Heizblock fehlt')
  const zuViel = scoreService(e, { ...perfect, blocks: [{ ...heizung, lines: [...heizung.lines, { amountEur: 12, vacancy: false }] }, ...rest] })
  assert.ok(zuViel.failed.some((f) => /zusätzliche Zeile/.test(f)))
  assert.ok(scoreService(e, null).points < 0.1)
})

test('Gasrechnung: Nachzahlung statt Rechnungsbetrag und Brennwert als Heizwert kosten Punkte', () => {
  const e = byName('gas-supplier').expected
  const perfect = {
    vendor: 'Stadtwerke Beispielstadt', totalGrossEur: e.total, periodStart: e.periodStart, periodEnd: e.periodEnd, fixedEur: e.fixed, quantity: e.quantity,
    quantityUnit: e.quantityUnit, energyKwh: e.energyKwh, gasBasis: e.gasBasis, heatingValue: e.heatingValue, emissionsKg: e.emissionsKg, co2CostEur: e.co2Cost,
    emissionFactor: e.emissionFactor, bioCostEur: e.bioCost,
    parts: partsOf(e).map((p) => ({ from: p.from, to: p.to, energyKwh: p.energyKwh, amountEur: p.amount, fixedEur: p.fixed, emissionsKg: p.emissionsKg, co2CostEur: p.co2Cost })),
  }
  assert.equal(scoreFuel(e, perfect).points, 1)
  assert.ok(scoreFuel(e, { ...perfect, totalGrossEur: 107.8 }).failed.includes('Rechnungsbetrag'))
  assert.ok(scoreFuel(e, { ...perfect, heatingValue: 11.32 }).failed.includes('Heizwert'))
  assert.ok(scoreFuel(e, { ...perfect, parts: [] }).failed.includes('Zahl der Teilmengen'))
})

test('Heizöl: Liefertag und Heizwert zählen', () => {
  const e = byName('heating-oil').expected
  const perfect = {
    vendor: 'Heizöl Beispiel GmbH', totalGrossEur: e.total, deliveredAt: e.deliveredAt, quantity: e.quantity, quantityUnit: e.quantityUnit, energyKwh: e.energyKwh,
    heatingValue: e.heatingValue, emissionsKg: e.emissionsKg, co2CostEur: e.co2Cost, emissionFactor: e.emissionFactor, bioCostEur: e.bioCost, parts: [],
  }
  assert.equal(scoreFuel(e, perfect).points, 1)
  assert.ok(scoreFuel(e, { ...perfect, deliveredAt: '2025-10-14' }).failed.includes('Liefertag'))
  assert.ok(scoreFuel(e, { ...perfect, heatingValue: null }).failed.includes('Heizwert'))
})

test('Die Bewertung der Rechnungen bleibt, wie sie war (aus ai-eval.mjs ausgelagert)', () => {
  const e = byName('water').expected
  const positions = (Array.isArray(e.positions) ? e.positions : []).map((p: { amount: number; category: string }) => ({ amountEur: p.amount, category: p.category }))
  assert.equal(score(e, { vendor: 'Stadtwerke Musterstadt', totalGrossEur: e.total, positions }).points, 1)
  assert.deepEqual(score(e, { vendor: 'Stadtwerke Musterstadt', totalGrossEur: e.total, positions: [...positions, { amountEur: 5, category: 'Grundsteuer' }] }).failed, ['zusätzliche Position 5'])
})

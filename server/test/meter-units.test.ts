// Zähler mit verschiedenen Einheiten (#342): MWh neben kWh, l neben m³. Die Messfälle aus der Prüfung
// (heizung-notizen/mwh-pruefung.md) als Tests: Erwartet werden die Beträge wie bei gleicher Einheit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEntity, HeatingError, updateEntity } from '../src/db/repository.ts'
import { meters as meterTable } from '../src/db/schema.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { computeSettlement } from '../src/calc.ts'
import { selfMeter, selfMeters, selfReading, selfReadings, selfSnapshot } from '../testing/selfHeating.ts'
import { knownUnit, metersByUnitText, meterUnitOptions, unitKey, unitProblem, unitScale } from '../../shared/meterUnits.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem, HeatingPlant, Meter, Reading } from '../../shared/types.ts'

type Settlement = ReturnType<typeof computeSettlement>

// Je Mietverhältnis und Position der Anteil in Cent.
function shares(s: Settlement): Record<string, number> {
  const out: Record<string, number> = {}
  for (const st of s.statements) for (const r of st.rows) out[`${st.tenancyId}:${r.costItemId}`] = r.shareCents
  return out
}

// Wert und Einheit eines Zählers gemeinsam umstellen: dieselbe Menge, in anderer Einheit.
function rescale(meters: Meter[], readings: Reading[], id: string, unit: string, factor: number): { meters: Meter[]; readings: Reading[] } {
  return {
    meters: meters.map((m) => (m.id === id ? { ...m, unit } : m)),
    readings: readings.map((r) => (r.meterId === id ? { ...r, value: r.value * factor, ...(r.oldEndValue !== undefined ? { oldEndValue: r.oldEndValue * factor } : {}) } : r)),
  }
}

test('Einheiten: Schreibweisen werden erkannt, je Sparte', () => {
  for (const t of ['m3', 'M³', ' m³ ', 'cbm', 'Kubikmeter', 'm^3']) assert.equal(knownUnit('kaltwasser', t)?.label, 'm³', t)
  for (const t of ['l', 'L', 'Liter', 'ltr']) assert.equal(knownUnit('warmwasser', t)?.label, 'l', t)
  for (const t of ['kWh', 'KWh', 'kwh', ' KWH ']) assert.equal(knownUnit('waerme', t)?.label, 'kWh', t)
  assert.equal(knownUnit('waerme', 'MWh')?.label, 'MWh')
  assert.equal(knownUnit('waerme', 'GJ')?.label, 'GJ')
  assert.equal(knownUnit('strom', 'mwh')?.label, 'MWh')
  // Nicht in der Sparte: kWh beim Wasser, m³ bei der Wärme, GJ beim Strom.
  assert.equal(knownUnit('kaltwasser', 'kWh'), null)
  assert.equal(knownUnit('waerme', 'm³'), null)
  assert.equal(knownUnit('strom', 'GJ'), null)
  // Sonstiges (auch der Gaszähler) und Heizkostenverteiler kennen keine Einheit.
  assert.equal(knownUnit('sonstig', 'kWh'), null)
  assert.equal(knownUnit('hkv', 'Einheiten'), null)
  assert.equal(unitKey('sonstig', ' M³ '), 'm³')
})

test('Einheiten: die Faktoren sind exakt (1 MWh = 1.000 kWh, 1 l = 1/1.000 m³, 9 GJ = 2.500 kWh)', () => {
  const heat = unitScale([{ id: 'a', type: 'waerme', unit: 'kWh' }, { id: 'b', type: 'waerme', unit: 'MWh' }, { id: 'c', type: 'waerme', unit: 'GJ' }], 'relative')
  assert.equal(heat.problem, null)
  assert.equal(heat.unit, 'kWh')
  assert.equal(heat.factorOf('a'), 1)
  assert.equal(heat.factorOf('b'), 1000)
  assert.equal(9 * heat.factorOf('c'), 2500)
  const water = unitScale([{ id: 'a', type: 'kaltwasser', unit: 'm³' }, { id: 'b', type: 'warmwasser', unit: 'l' }], 'relative')
  assert.equal(water.problem, null)
  assert.equal(water.unit, 'm³')
  assert.equal(2500 * water.factorOf('b'), 2.5)
})

test('Einheiten: gleiche Einheit heißt keine Umrechnung (relative), auch bei MWh und einer unbekannten', () => {
  const mwh = unitScale([{ id: 'a', type: 'waerme', unit: 'MWh' }, { id: 'b', type: 'waerme', unit: 'mwh' }], 'relative')
  assert.ok(mwh.problem === null && !mwh.converted && mwh.factorOf('a') === 1 && mwh.unit === 'MWh')
  const odd = unitScale([{ id: 'a', type: 'waerme', unit: 'm³' }, { id: 'b', type: 'waerme', unit: 'm³' }], 'base')
  assert.ok(odd.problem === null && !odd.converted && odd.factorOf('b') === 1)
  // Gegen eine absolute Größe (base): MWh wird kWh, auch der Zähler ohne Einheit daneben (wie die übrigen).
  const base = unitScale([{ id: 'a', type: 'waerme', unit: 'MWh' }, { id: 'b', type: 'waerme', unit: '' }], 'base')
  assert.ok(base.problem === null && base.converted && base.unit === 'kWh' && base.factorOf('a') === 1000 && base.factorOf('b') === 1000)
})

test('Einheiten: ein Zähler ohne Einheit gilt wie die übrigen; neben verschiedenen ist er unbekannt', () => {
  // Aus einer alten db.json oder vom Validator geradegerückt (validate.test.ts): keine Zahl darf sich ändern.
  const same = unitScale([{ id: 'a', type: 'kaltwasser', unit: '' }, { id: 'b', type: 'kaltwasser', unit: 'm³' }], 'relative')
  assert.ok(same.problem === null && !same.converted && same.factorOf('a') === 1 && same.factorOf('b') === 1)
  // Durchsicht M4: alle MWh, einer ohne Einheit, relative: Faktor 1.
  const m4 = unitScale([{ id: 'a', type: 'waerme', unit: 'MWh' }, { id: 'b', type: 'waerme', unit: '' }], 'relative')
  assert.ok(m4.problem === null && m4.factorOf('a') === 1 && m4.factorOf('b') === 1)
  assert.equal(unitScale([{ id: 'a', type: 'waerme' }, { id: 'b', type: 'waerme' }], 'base').problem, null)
  const mixed = unitScale([{ id: 'a', type: 'waerme', unit: ' ', name: 'A' }, { id: 'b', type: 'waerme', unit: 'kWh', name: 'B' }, { id: 'c', type: 'waerme', unit: 'MWh', name: 'C' }], 'relative')
  assert.equal(mixed.problem?.kind, 'unknown')
  // Umgerechnet wird nur, wo alle Einheiten bekannt sind: hier Faktor 1.
  assert.equal(mixed.factorOf('c'), 1)
  assert.equal(metersByUnitText(mixed.problem?.meters ?? []), '„A“ ohne Einheit, „B“ in kWh, „C“ in MWh')
})

test('Einheiten: eine für die Sparte unbekannte Einheit sperrt nicht, sie rechnet mit Faktor 1 (Durchsicht M1)', () => {
  const r = unitScale([{ id: 'a', type: 'waerme', unit: 'kWh', name: 'Wärme C' }, { id: 'b', type: 'waerme', unit: 'm³', name: 'Wärme A' }], 'relative')
  assert.equal(r.problem?.kind, 'unknown')
  assert.equal(r.factorOf('a'), 1)
  assert.equal(r.factorOf('b'), 1)
  // Gas über „Sonstiges“: m³ und kWh sind verschiedene Größen; das rechnete schon vorher falsch.
  assert.equal(unitScale([{ id: 'a', type: 'sonstig', unit: 'm³' }, { id: 'b', type: 'sonstig', unit: 'kWh' }], 'relative').problem?.kind, 'mixed')
  // Freitext bei Sonstiges: nicht zuzuordnen, also Warnung statt Sperre.
  assert.equal(unitScale([{ id: 'a', type: 'sonstig', unit: 'm³' }, { id: 'b', type: 'sonstig', unit: 'Stück' }], 'relative').problem?.kind, 'unknown')
  // S1: Schreibweisen gelten auch bei Sonstiges als gleich.
  const gas = unitScale([{ id: 'a', type: 'sonstig', unit: 'm³' }, { id: 'b', type: 'sonstig', unit: 'cbm' }, { id: 'c', type: 'sonstig', unit: 'Kubikmeter' }], 'relative')
  assert.ok(gas.problem === null && !gas.converted && gas.factorOf('b') === 1)
})

test('Einheiten: Auswahl im Formular und Prüfung beim Speichern', () => {
  assert.deepEqual(meterUnitOptions('waerme', 'kWh'), ['kWh', 'MWh', 'GJ'])
  assert.deepEqual(meterUnitOptions('kaltwasser', 'm3'), ['m³', 'l'])
  assert.deepEqual(meterUnitOptions('strom', ''), ['kWh', 'MWh'])
  // Eine gespeicherte unbekannte Einheit steht in der Auswahl, damit sie angezeigt wird, wie sie ist.
  assert.deepEqual(meterUnitOptions('waerme', 'm³'), ['kWh', 'MWh', 'GJ', 'm³'])
  assert.deepEqual(meterUnitOptions('sonstig', 'm³'), [])
  assert.equal(unitProblem('waerme', 'MWh'), null)
  assert.equal(unitProblem('sonstig', 'Stück'), null)
  assert.match(unitProblem('waerme', 'm³') ?? '', /Wählen Sie kWh, MWh oder GJ/)
})

// ---------- Messfall 1: eigene Heizkostenabrechnung, ein Wärmezähler in MWh ----------

test('Eigene Heizkostenabrechnung: ein Wärmezähler in MWh verteilt wie in kWh (#342)', () => {
  const kwh = shares(computeSettlement(selfSnapshot()))
  const { meters, readings } = rescale(selfMeters(), selfReadings(), 'wz-b', 'MWh', 1 / 1000)
  const s = computeSettlement(selfSnapshot({ meters, readings }))
  assert.deepEqual(shares(s), kwh)
  // Vorher (gemessen): B 932,38 € statt 2.358,00 € beim Gas.
  assert.equal(kwh['B:gas'], 235800)
  assert.equal(s.notices.some((n) => n.code === 'meter.units-mixed'), false)
})

test('Eigene Heizkostenabrechnung: alle Wärmezähler in MWh verteilen wie in kWh, Verbrauch und Ausweis in MWh (Durchsicht M2)', () => {
  const kwh = computeSettlement(selfSnapshot())
  let meters = selfMeters()
  let readings = selfReadings()
  for (const id of ['wz-a', 'wz-b', 'wz-c']) ({ meters, readings } = rescale(meters, readings, id, 'MWh', 1 / 1000))
  const s = computeSettlement(selfSnapshot({ meters, readings }))
  assert.deepEqual(shares(s), shares(kwh))
  // Einheitlich heißt Faktor 1: Der Verbrauch je Nutzer steht in MWh, und der Ausweis sagt MWh.
  const users = (x: Settlement) => (x.heating ?? []).flatMap((h) => h.self?.units.flatMap((u) => u.users.map((v) => v.heatingConsumption)) ?? [])
  assert.ok(users(kwh).length > 0)
  assert.deepEqual(users(s).map((v) => (v === null ? null : Math.round(v * 1e6) / 1e3)), users(kwh).map((v) => (v === null ? null : Math.round(v * 1e3) / 1e3)))
  const unitOf = (x: Settlement) => x.heating?.[0]?.self?.pots.find((p) => p.pot === 'heating')?.consumptionUnit
  assert.equal(unitOf(kwh), 'kWh')
  assert.equal(unitOf(s), 'MWh')
})

test('Eigene Heizkostenabrechnung: Warmwasserzähler in Litern und Speicherzähler in MWh verteilen wie in m³ und kWh', () => {
  const base = shares(computeSettlement(selfSnapshot()))
  let { meters, readings } = rescale(selfMeters(), selfReadings(), 'xw-c', 'l', 1000)
  ;({ meters, readings } = rescale(meters, readings, 'ww', 'MWh', 1 / 1000))
  assert.deepEqual(shares(computeSettlement(selfSnapshot({ meters, readings }))), base)
})

test('Eigene Heizkostenabrechnung: eine unbekannte Einheit neben kWh verteilt wie bisher und warnt (Durchsicht M1)', () => {
  const base = shares(computeSettlement(selfSnapshot()))
  const meters = selfMeters().map((m) => (m.id === 'wz-b' ? { ...m, unit: 'Grad' } : m))
  const s = computeSettlement(selfSnapshot({ meters }))
  assert.deepEqual(shares(s), base)
  assert.equal(s.notices.some((x) => x.code === 'meter.units-mixed'), false)
  const n = s.notices.find((x) => x.code === 'meter.unit-unknown')
  assert.ok(n, 'Hinweis fehlt')
  assert.equal(n.level, 'warning')
  assert.equal(n.subject?.kind, 'meter')
  assert.match(n.text, /„Wärme B“ in Grad/)
  assert.match(n.text, /„Wärme A“ und „Wärme C“ in kWh/)
})

// ---------- Messfall 2: Verbrauchsschlüssel, ein Zähler in Litern ----------

const P = 'objekt-1'
const waterItem = (amountCents = 100000): CostItem => ({
  id: 'wasser', propertyId: P, period: periodKey('2025-01'), category: 'Wasserversorgung', description: 'Warmwasser', amountCents, key: 'meter', meterType: 'warmwasser',
})
const manual = { method: 'manual' } as Partial<HeatingPlant>

test('Verbrauchsschlüssel: ein Warmwasserzähler in Litern verteilt wie in m³ (#342)', () => {
  const m3 = shares(computeSettlement(selfSnapshot({ costItems: [waterItem()], plant: manual })))
  assert.equal(m3['B:wasser'], 33333)
  const { meters, readings } = rescale(selfMeters(), selfReadings(), 'xw-b', 'l', 1000)
  const s = computeSettlement(selfSnapshot({ meters, readings, costItems: [waterItem()], plant: manual }))
  // Vorher (gemessen): B 998,00 € statt 333,33 €.
  assert.deepEqual(shares(s), m3)
})

test('Verbrauchsschlüssel: gleiche, aber unbekannte Einheit verteilt wie bisher', () => {
  const m3 = shares(computeSettlement(selfSnapshot({ costItems: [waterItem()], plant: manual })))
  const meters = selfMeters().map((m) => (m.type === 'warmwasser' ? { ...m, unit: 'Eimer' } : m))
  const s = computeSettlement(selfSnapshot({ meters, costItems: [waterItem()], plant: manual }))
  assert.deepEqual(shares(s), m3)
  assert.equal(s.notices.some((n) => n.code === 'meter.units-mixed'), false)
})

test('Verbrauchsschlüssel: eine unbekannte Einheit neben m³ verteilt wie bisher und warnt (Durchsicht M1)', () => {
  const m3 = shares(computeSettlement(selfSnapshot({ costItems: [waterItem()], plant: manual })))
  const meters = selfMeters().map((m) => (m.id === 'xw-b' ? { ...m, unit: 'kWh' } : m))
  const s = computeSettlement(selfSnapshot({ meters, costItems: [waterItem()], plant: manual }))
  assert.deepEqual(shares(s), m3)
  const n = s.notices.find((x) => x.code === 'meter.unit-unknown')
  assert.ok(n, 'Hinweis fehlt')
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'meter', id: 'xw-b' })
  assert.match(n.text, /„Warmwasser B“ in kWh/)
  assert.match(n.text, /Seite Zähler/)
})

test('Verbrauchsschlüssel: Gas in m³ neben kWh (Sonstiges) verteilt nicht und nennt die Zähler', () => {
  const item: CostItem = { ...waterItem(), id: 'gas2', meterType: 'sonstig', description: 'Gas' }
  const gm = [selfMeter('g-a', 'a', 'Gas A', 'sonstig', { unit: 'm³' }), selfMeter('g-b', 'b', 'Gas B', 'sonstig', { unit: 'kWh' })]
  const gr = [selfReading('g-a', '2024-12-31', 0), selfReading('g-a', '2025-12-31', 100), selfReading('g-b', '2024-12-31', 0), selfReading('g-b', '2025-12-31', 1000)]
  const s = computeSettlement(selfSnapshot({ meters: [...selfMeters(), ...gm], readings: [...selfReadings(), ...gr], costItems: [item], plant: manual }))
  const n = s.notices.find((x) => x.code === 'meter.units-mixed')
  assert.ok(n, 'Hinweis fehlt')
  assert.equal(n.level, 'error')
  assert.equal(n.subject?.kind, 'meter')
  assert.match(n.text, /„Gas A“ in m³, „Gas B“ in kWh/)
  assert.equal(s.statements.flatMap((st) => st.rows).filter((r) => r.costItemId === 'gas2').reduce((a, r) => a + r.shareCents, 0), 0)
})

// ---------- Messfall 3: Hauptzähler mit gemischten Einheiten ----------

test('Verbrauchsschlüssel mit Hauptzähler: Hauptzähler in Litern, Wohnungszähler in m³, wie alle in m³ (#342)', () => {
  // Wohnung C ohne Warmwasserzähler: Ihr Verbrauch ist der Rest des Hauptzählers (#116).
  const baseMeters = [...selfMeters().filter((m) => m.id !== 'xw-c'), selfMeter('haupt', null, 'Hauptzähler Warmwasser', 'warmwasser')]
  const baseReadings = [...selfReadings().filter((r) => r.meterId !== 'xw-c'), selfReading('haupt', '2024-12-31', 100), selfReading('haupt', '2025-12-31', 200)]
  const m3 = computeSettlement(selfSnapshot({ meters: baseMeters, readings: baseReadings, costItems: [waterItem()], plant: manual }))
  const { meters, readings } = rescale(baseMeters, baseReadings, 'haupt', 'l', 1000)
  const l = computeSettlement(selfSnapshot({ meters, readings, costItems: [waterItem()], plant: manual }))
  assert.deepEqual(shares(l), shares(m3))
  // A und B zahlen je 30 von 100 m³, der Rest bleibt beim Vermieter.
  assert.equal(shares(m3)['A:wasser'], 30000)
})

// ---------- Annahme beim Server ----------

test('Server: eine neue oder geänderte Einheit muss die Sparte kennen; eine gespeicherte unveränderte hindert nichts (#342)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-einheiten-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    const unitOf = (e: unknown): unknown => (e !== null && typeof e === 'object' ? Reflect.get(e, 'unit') : undefined)
    const z = { propertyId: 'objekt-1', name: 'Wärme Haus', unitId: null, type: 'waerme' }
    // Eine andere Schreibweise einer bekannten Einheit wird die bekannte.
    assert.equal(unitOf(await opened.write((db) => createEntity(db, 'meters', 'm1', { ...z, unit: 'mwh' }))), 'MWh')
    await assert.rejects(opened.write((db) => createEntity(db, 'meters', 'm2', { ...z, unit: 'm³' })), (err: unknown) => err instanceof HeatingError && err.status === 400 && /Die Einheit „m³“ kennt Mietfuchs für diese Sparte nicht/.test(err.message))
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'm1', { unit: 'Grad' })), HeatingError)
    // Sonstiges: jeder Text.
    assert.equal(unitOf(await opened.write((db) => createEntity(db, 'meters', 'm3', { ...z, type: 'sonstig', unit: 'Stück' }))), 'Stück')
    // Vor #342 gespeichert (am Server vorbei): unverändert mitgeschickt, auch anders geschrieben, bleibt sie, wie sie ist.
    await opened.write((db) => db.insert(meterTable).values({ id: 'alt', propertyId: 'objekt-1', name: 'Alt', type: 'waerme', unit: 'm³' }))
    assert.equal(unitOf(await opened.write((db) => updateEntity(db, 'meters', 'alt', { name: 'Wärme alt', unit: 'm³' }))), 'm³')
    assert.equal(unitOf(await opened.write((db) => updateEntity(db, 'meters', 'alt', { unit: ' m³ ' }))), 'm³')
    assert.equal(unitOf(await opened.write((db) => updateEntity(db, 'meters', 'alt', { unit: 'kWh' }))), 'kWh')
    // K1: Bei Sparten mit Auswahl keine neue leere Einheit; eine gespeicherte leere darf unverändert mitkommen.
    await assert.rejects(opened.write((db) => createEntity(db, 'meters', 'm4', { ...z, unit: '' })), (err: unknown) => err instanceof HeatingError && err.status === 400 && /Bitte wählen Sie die Einheit/.test(err.message))
    await assert.rejects(opened.write((db) => updateEntity(db, 'meters', 'm1', { unit: ' ' })), HeatingError)
    await opened.write((db) => db.insert(meterTable).values({ id: 'leer', propertyId: 'objekt-1', name: 'Leer', type: 'waerme', unit: '' }))
    assert.equal(unitOf(await opened.write((db) => updateEntity(db, 'meters', 'leer', { name: 'Wärme leer', unit: '' }))), '')
    assert.equal(unitOf(await opened.write((db) => createEntity(db, 'meters', 'm5', { ...z, type: 'sonstig', unit: '' }))), '')
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

// N4 aus #341: Die Verteilbasis nach Verbrauch nennt die Einheit, wie die nach Fläche ihre m²; umgerechnet die
// Grundeinheit. Vorher stand „12,5 von 80 (gemessen)“.
test('Verbrauchsschlüssel: die Verteilbasis nennt die Einheit der Zähler', () => {
  const basisOf = (s: Settlement) => s.statements.flatMap((st) => st.rows).find((r) => r.costItemId === 'wasser')?.basisText ?? ''
  assert.match(basisOf(computeSettlement(selfSnapshot({ costItems: [waterItem()], plant: manual }))), / m³ \(gemessen\)$/)
  const { meters, readings } = rescale(selfMeters(), selfReadings(), 'xw-b', 'l', 1000)
  assert.match(basisOf(computeSettlement(selfSnapshot({ meters, readings, costItems: [waterItem()], plant: manual }))), / m³ \(gemessen\)$/)
})

// Durchsicht des Zweigs, Befund 1: Bei einer unbekannten Einheit rechnet Mietfuchs mit Faktor 1 über verschiedene
// Größen; die Verteilbasis darf dann keine Einheit nennen (vorher die des ersten Zählers, je nach Reihenfolge).
test('Verbrauchsschlüssel: bei unbekannter Einheit nennt die Verteilbasis keine Einheit', () => {
  const meters = selfMeters().map((m) => (m.id === 'xw-b' ? { ...m, unit: 'kWh' } : m))
  const s = computeSettlement(selfSnapshot({ meters, costItems: [waterItem()], plant: manual }))
  const basis = s.statements.flatMap((st) => st.rows).find((r) => r.costItemId === 'wasser')?.basisText ?? ''
  assert.match(basis, /\d \(gemessen\)$/)
})

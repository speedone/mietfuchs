// Die Kostenarten stehen an drei Stellen: in der Oberfläche (CATEGORIES, client/src/types.ts), im
// Schema der KI-Auswertung (extract.ts) und in der Zuordnung zur Anlage V (calc.ts). Liefen sie
// auseinander, schlüge die KI eine Kostenart vor, die die Oberfläche nicht kennt, oder eine
// Kostenart landete in der Steuerübersicht unter „Sonstige Werbungskosten“, ohne dass es jemand
// bemerkt. Dieser Test hält sie zusammen; aufgefallen ist die Lücke beim Hinzufügen von
// „Heizung und Warmwasser“ (#93).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, NOT_ALLOCABLE as CLIENT_NOT_ALLOCABLE, matchCategory } from '../../client/src/types.ts'
import { ANLAGE_V_GROUP, ANLAGE_V_GROUP_ORDER, HEATING_CATEGORY, NOT_ALLOCABLE_CATEGORIES, RESERVE_CATEGORY, RESERVE_WITHDRAWAL_CATEGORY, isNotAllocable, looksLikeReserveContribution } from '../src/calc.ts'
import { EXTRACT_CATEGORIES } from '../src/extract.ts'
import { GENERAL_POWER_CATEGORY } from '../../shared/operatingPower.ts'

const sorted = (list: Iterable<string>) => [...list].sort()

test('die Kostenarten sind in Oberfläche, KI-Schema und Anlage V dieselben', () => {
  assert.deepEqual(sorted(EXTRACT_CATEGORIES), sorted(CATEGORIES), 'KI-Schema')
  assert.deepEqual(sorted(Object.keys(ANLAGE_V_GROUP)), sorted(CATEGORIES), 'Anlage V')
})

test('die Heizkostenart gibt es überall (#93)', () => {
  assert.ok(CATEGORIES.includes(HEATING_CATEGORY))
})

test('die Erhaltungsrücklage ist eine eigene Kostenart und nicht umlagefähig, überall (#143)', () => {
  assert.ok(CATEGORIES.includes(RESERVE_CATEGORY))
  // Dieselbe Menge der nicht umlagefähigen Kostenarten in Oberfläche und Berechnung: Sonst
  // zeigte die Oberfläche „Vermieter“, während die Berechnung umlegt, oder umgekehrt.
  assert.deepEqual(sorted(CLIENT_NOT_ALLOCABLE), sorted(NOT_ALLOCABLE_CATEGORIES))
  assert.ok(isNotAllocable(RESERVE_CATEGORY) && isNotAllocable('Nicht umlagefähig'))
  assert.equal(isNotAllocable('Grundsteuer'), false)
  // Keine Gruppe der Werbungskosten (BFH IX R 19/24): erst bei Verwendung abziehbar.
  assert.equal(ANLAGE_V_GROUP[RESERVE_CATEGORY], null)
  // Die KI ordnet die Rücklage der eigenen Kostenart zu und nicht über „Instandhaltung“ der
  // allgemeinen nicht umlagefähigen.
  assert.equal(matchCategory('Instandhaltungsrücklage'), RESERVE_CATEGORY)
  assert.equal(matchCategory('Zuführung Erhaltungsrücklage'), RESERVE_CATEGORY)
  assert.equal(matchCategory('Instandhaltung Treppenhaus'), 'Nicht umlagefähig')
  // Durchsicht: Eine Entnahme ist keine Zuführung.
  assert.notEqual(matchCategory('Entnahme aus der Instandhaltungsrücklage'), RESERVE_CATEGORY)
  assert.notEqual(matchCategory('Dachreparatur aus der Rücklage'), RESERVE_CATEGORY)
  assert.equal(matchCategory('Zuführung zur Rücklage'), RESERVE_CATEGORY)
  assert.equal(matchCategory('Zuführung zur Rücklage aus dem Hausgeld'), RESERVE_CATEGORY)
  // Zweite Browserabnahme, seit #96 mit eigener Kostenart: Eine Entnahme aus der Rücklage ist eine bezahlte
  // Erhaltungsmaßnahme, also nicht umlagefähig (und Werbungskosten), nicht „Sonstige Betriebskosten“.
  assert.equal(matchCategory('Entnahme aus der Erhaltungsrücklage'), RESERVE_WITHDRAWAL_CATEGORY)
  assert.equal(matchCategory('Dachreparatur aus der Rücklage'), RESERVE_WITHDRAWAL_CATEGORY)
  for (const text of ['Entnahme aus der Instandhaltungsrücklage', 'Dachreparatur aus der Rücklage', 'Zuführung zur Rücklage', 'Instandhaltungsrücklage', 'Zuführung zur Rücklage aus dem Hausgeld']) {
    assert.equal(matchCategory(text) === RESERVE_CATEGORY, looksLikeReserveContribution(text), text)
  }
})

// #96 PR 1 (A1, A2): Die Entnahme aus der Erhaltungsrücklage ist eine eigene Kostenart, nicht umlagefähig und steuerlich
// Erhaltungsaufwand (Anlage V 2025, Zeilen 55/56 „einschließlich Entnahmen aus der Erhaltungsrücklage“).
test('die Entnahme aus der Erhaltungsrücklage ist eine eigene Kostenart, in allen drei Listen (#96)', () => {
  assert.equal(RESERVE_WITHDRAWAL_CATEGORY, 'Entnahme Erhaltungsrücklage')
  assert.ok(CATEGORIES.includes(RESERVE_WITHDRAWAL_CATEGORY), 'Oberfläche')
  assert.ok(EXTRACT_CATEGORIES.includes(RESERVE_WITHDRAWAL_CATEGORY), 'KI-Schema')
  assert.equal(ANLAGE_V_GROUP[RESERVE_WITHDRAWAL_CATEGORY], 'Erhaltungsaufwand', 'Anlage V')
  assert.ok(isNotAllocable(RESERVE_WITHDRAWAL_CATEGORY))
  assert.ok(CLIENT_NOT_ALLOCABLE.includes(RESERVE_WITHDRAWAL_CATEGORY))
  // Eine neue Gruppe vor „Verwaltung & Instandhaltung“; diese bleibt, wie sie ist (ihr Name steht in den Prüfsummen).
  assert.deepEqual(ANLAGE_V_GROUP_ORDER, ['Grundsteuer & öffentliche Abgaben', 'Laufende Betriebskosten', 'Versicherungen', 'Erhaltungsaufwand', 'Verwaltung & Instandhaltung', 'Sonstige Werbungskosten'])
  assert.equal(ANLAGE_V_GROUP['Nicht umlagefähig'], 'Verwaltung & Instandhaltung')
  assert.equal(matchCategory('Entnahme aus Erhaltungsrücklage Dachreparatur'), RESERVE_WITHDRAWAL_CATEGORY)
  assert.equal(matchCategory('Fassadenanstrich, aus der Rücklage bezahlt'), RESERVE_WITHDRAWAL_CATEGORY)
  assert.equal(matchCategory('Entnahme Erhaltungsrücklage'), RESERVE_WITHDRAWAL_CATEGORY)
  // Die Regel der Zuführung bleibt wortgleich.
  assert.equal(matchCategory('Instandhaltungsrücklage'), RESERVE_CATEGORY)
  assert.equal(matchCategory('Zuführung zur Rücklage aus dem Hausgeld'), RESERVE_CATEGORY)
  assert.equal(matchCategory('Reparatur Dachrinne'), 'Nicht umlagefähig')
})

test('Betriebsstrom: die Kostenart des Abzugs steht in der Liste der Kostenarten (Heizung PR 15)', () => {
  assert.ok(CATEGORIES.some((c) => c === GENERAL_POWER_CATEGORY))
})

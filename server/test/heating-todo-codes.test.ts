// Wächter zur Liste „Was fehlt noch“ der Seite Heizkosten (#690 Punkt 6): Jeder Hinweis der Berechnung zur Heizung
// und zu den Zählern ist einer Zeile der Liste zugeordnet, zählt als weiterer Hinweis oder ist mit Grund ausgenommen.
// Sonst sagte die Liste „erledigt“, während die Abrechnung warnt, sobald jemand einen neuen Hinweis anlegt.
import test from 'node:test'
import assert from 'node:assert/strict'
import { NOTICE_KINDS } from '../src/calc.ts'
import { HEATING_TODO_CODES, todoRuleOf } from '../../shared/heatingTodo.ts'

const PREFIXES = ['heating.', 'meter.', 'co2.', 'fuel.']
const catalog = Object.keys(NOTICE_KINDS).filter((code) => PREFIXES.some((p) => code.startsWith(p)))

test('jeder Hinweis-Code der Heizung und der Zähler steht in der Tabelle der Liste', () => {
  assert.ok(catalog.length > 100, 'der Katalog der Berechnung ist lesbar')
  const missing = catalog.filter((code) => HEATING_TODO_CODES[code] === undefined)
  assert.deepEqual(missing, [], 'Ordnen Sie den Code in shared/heatingTodo.ts einer Zeile zu, als „other“ oder mit Grund als „skip“.')
})

test('die Tabelle nennt keinen Code, den die Berechnung nicht (mehr) kennt', () => {
  assert.deepEqual(Object.keys(HEATING_TODO_CODES).filter((code) => NOTICE_KINDS[code] === undefined), [])
})

test('eine Ausnahme nennt ihren Grund; Fehler und Warnungen der Heizanlage sind nie ausgenommen, ohne dass es dasteht', () => {
  for (const [code, rule] of Object.entries(HEATING_TODO_CODES)) {
    if ('skip' in rule) assert.ok(rule.skip.trim().length > 20, `${code}: Grund der Ausnahme fehlt`)
  }
  // Die beiden Fälle der Durchsicht: Die Zeile zu § 6a folgt beiden Hinweisen (auch der Stufe „Hinweis“), der
  // Warmwasseranteil dem Fehler der Berechnung.
  assert.deepEqual(todoRuleOf('heating.info-open'), { step: 'info', hints: true })
  assert.deepEqual(todoRuleOf('heating.info-incomplete'), { step: 'info' })
  assert.deepEqual(todoRuleOf('heating.dhw-share-invalid'), { step: 'hotWater' })
  assert.deepEqual(todoRuleOf('co2.missing'), { step: 'co2' })
})

test('ein unbekannter Code zählt als weiterer Hinweis, nie als erledigt', () => {
  assert.deepEqual(todoRuleOf('heating.kommt-erst-noch'), { step: 'other' })
})

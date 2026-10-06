// Rechtsregister für die eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 4.3, 10.2): drei
// Parameter, vier Regeln. Die Zahlen stehen nur hier im Register; die Berechnung fragt sie mit law().
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hkvConsumptionShareForced, hkvHeatPumpCapture } from '../../shared/law/heizkostenv.ts'
import { practiceReadingOffWarning } from '../../shared/law/practice.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { createLawLog, law, onlyVersion } from '../../shared/law/register.ts'
import { RULES, ruleCoverage } from '../../shared/law/rules.ts'

test('§ 7 Abs. 1 Satz 2 HeizkostenV: 70 % nach Verbrauch, nach dem Beginn des Zeitraums', () => {
  const log = createLawLog()
  assert.equal(law(hkvConsumptionShareForced, { period: { from: '2025-01-01', to: '2025-12-31' } }, log), 70)
  assert.deepEqual(log.values.map((v) => [v.id, v.text]), [['hkv.consumption-share-forced', '70 %']])
  assert.equal(hkvConsumptionShareForced.norm, '§ 7 Abs. 1 Satz 2 HeizkostenV')
})

test('§ 12 Abs. 3 HeizkostenV: Erfassung am 01.10.2024, sonst Einbau bis 30.09.2025, Zeitregel nach Ereignis', () => {
  assert.equal(hkvHeatPumpCapture.timing, 'eventDate')
  const v = onlyVersion(hkvHeatPumpCapture)
  assert.deepEqual(v.value, { capturedBy: '2024-10-01', installBy: '2025-09-30' })
  assert.equal(v.source.checked, 'checked')
  assert.match(hkvHeatPumpCapture.describe(v.value), /01\.10\.2024.*30\.09\.2025/)
})

test('Warngrenze der Ablesung: ein Monat, Oktober bis April, als Praxis gekennzeichnet', () => {
  const v = onlyVersion(practiceReadingOffWarning)
  assert.deepEqual(v.value, { months: 1, winterMonths: ['10', '11', '12', '01', '02', '03', '04'] })
  assert.equal(v.source.rank, 'interpretation')
  assert.match(v.enacted, /Norm offen: VDI 2077/)
})

test('Register: die drei Parameter stehen in LAW_PARAMS', () => {
  const ids = LAW_PARAMS.map((p) => p.id)
  for (const id of ['hkv.consumption-share-forced', 'hkv.heat-pump.capture', 'practice.reading-off-warning']) assert.ok(ids.includes(id), id)
})

test('Regeln der eigenen Heizkostenabrechnung: unbefristet, mit Norm, die Zahlen aus dem Register', () => {
  for (const code of ['heating-own-settlement', 'heating-tenant-change', 'heating-reading-date', 'heating-key-change']) {
    const rule = RULES.find((r) => r.code === code) ?? assert.fail(`Regel ${code} fehlt`)
    assert.ok(rule.norm.trim() && rule.summary.trim(), code)
    assert.equal(ruleCoverage(code, '2025-01-01', '2025-12-31'), 'full', code)
  }
  const own = RULES.find((r) => r.code === 'heating-own-settlement')?.summary ?? ''
  assert.match(own, /mindestens 50 und höchstens 70 %/)
  assert.match(own, /bei der Heizung 70 %/)
  assert.match(RULES.find((r) => r.code === 'heating-tenant-change')?.norm ?? '', /VIII ZR 19\/07/)
  assert.match(RULES.find((r) => r.code === 'heating-reading-date')?.norm ?? '', /4 RE-Miet 1\/88/)
  assert.match(RULES.find((r) => r.code === 'heating-key-change')?.norm ?? '', /§ 6 Abs\. 4 HeizkostenV/)
})

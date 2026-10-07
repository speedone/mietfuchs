// Rechtsregister für die Schätzung nach § 9a HeizkostenV (Heizung PR 13, Entwurf 4.3, 8.7, 10.2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hkvEstimateThreshold } from '../../shared/law/heizkostenv.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { createLawLog, law, onlyVersion } from '../../shared/law/register.ts'
import { RULES, ruleCoverage } from '../../shared/law/rules.ts'

test('§ 9a Abs. 2 HeizkostenV: Grenze 25 % der Fläche, „überschreitet“, nach dem Beginn des Zeitraums', () => {
  const log = createLawLog()
  assert.equal(law(hkvEstimateThreshold, { period: { from: '2025-01-01', to: '2025-12-31' } }, log), 25)
  assert.deepEqual(log.values.map((v) => [v.id, v.text]), [['hkv.estimate-threshold', 'überschreitet 25 %']])
  assert.equal(hkvEstimateThreshold.norm, '§ 9a Abs. 2 HeizkostenV')
  const v = onlyVersion(hkvEstimateThreshold)
  assert.equal(v.source.checked, 'checked')
  assert.equal(v.source.url, 'https://www.gesetze-im-internet.de/heizkostenv/__9a.html')
  assert.ok(LAW_PARAMS.some((p) => p.id === 'hkv.estimate-threshold'))
})

test('Regel heating-estimate: § 9a, die drei Wege und die Grenze aus dem Register', () => {
  const rule = RULES.find((r) => r.code === 'heating-estimate') ?? assert.fail('Regel fehlt')
  assert.match(rule.norm, /§ 9a HeizkostenV/)
  assert.match(rule.norm, /VIII ZR 373\/04/)
  assert.match(rule.summary, /Geräteausfalls oder aus einem anderen zwingenden Grund/)
  assert.match(rule.summary, /vergleichbaren Zeiträumen.*vergleichbarer anderer Räume.*Durchschnittsverbrauch des Gebäudes/s)
  assert.match(rule.summary, /mehr als 25 %/)
  assert.equal(ruleCoverage('heating-estimate', '2025-01-01', '2025-12-31'), 'full')
})

// Durchsicht von #242: R-I6 (was der BGH entschieden hat), R-I5/G-M8 (Auslegung als solche), R-I1, R-M6, R-M11.
test('Durchsicht von #242: Regel, Lexikon und Anleitung zur Schätzung', async () => {
  const rule = RULES.find((r) => r.code === 'heating-estimate') ?? assert.fail('Regel fehlt')
  assert.doesNotMatch(rule.summary, /Zwingend ist ein Grund erst/)
  assert.match(rule.summary, /Auch ein Ablesefehler ist ein zwingender Grund, wenn sich der Wert nicht mehr ermitteln lässt/)
  assert.match(rule.summary, /Kürzung.*verneint/)
  assert.match(rule.summary, /ganze Fläche.*Heizung und Warmwasser getrennt.*Auslegung von Mietfuchs/s)
  const { GLOSSARY } = await import('../../shared/glossary.ts')
  const g = GLOSSARY.heatingEstimate
  assert.match(`${g.short} ${g.needed}`, /nicht ordnungsgemäß erfasst/)
  assert.doesNotMatch(`${g.short} ${g.needed}`, /nicht mehr ablesen/)
  assert.match(g.needed, /muss der Verbrauch so ermittelt werden; ohne Schätzung verteilt Mietfuchs die Anlage nicht/)
  assert.match(g.needed, /Auslegung von Mietfuchs/)
  const { GUIDES } = await import('../../shared/guides.ts')
  const text = JSON.stringify(GUIDES)
  assert.match(text, /§ 9a Abs\. 1 HeizkostenV; BGH, Urteil vom 16\.11\.2005, VIII ZR 373\/04/)
  assert.doesNotMatch(text, /zwingend ist ein Grund erst|ließ sich nicht mehr ablesen|nicht mehr ablesen lässt/)
})

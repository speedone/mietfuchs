// Rechtsregister für Pflichtangaben und Ausnahmen (Heizung PR 14, Entwurf 4.3, 8.8, 8.9, 10.2). Wortlaut
// gelesen am 07.10.2026 auf gesetze-im-internet.de (§§ 2, 6a, 7, 10, 11, 12 HeizkostenV, § 2 CO2KostAufG).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hkvCutInformation, hkvExemptions, hkvInfoDistrict, hkvMonthlyInfo, hkvSettlementInfo } from '../../shared/law/heizkostenv.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { createLawLog, law, onlyVersion } from '../../shared/law/register.ts'
import { RULES, ruleCoverage } from '../../shared/law/rules.ts'
import { INFO_CONTACTS, INFO_CONTACTS_CHECKED } from '../../shared/heatingInfo.ts'

const year = (from: string, to: string) => ({ period: { from, to } })

test('§ 12 Abs. 1 Satz 3: 3 %, nach dem Beginn des Zeitraums, eigene Fassung neben Satz 2', () => {
  const log = createLawLog()
  assert.equal(law(hkvCutInformation, year('2025-01-01', '2025-12-31'), log), 3)
  assert.equal(hkvCutInformation.norm, '§ 12 Abs. 1 Satz 3 HeizkostenV')
  assert.deepEqual(log.values.map((v) => v.text), ['3 %'])
})

test('§ 6a Abs. 3: der Stichtag 01.12.2021 bleibt im vorhandenen Parameter hkv.settlement-info (keine zweite Fassung desselben Werts)', () => {
  const log = createLawLog()
  assert.equal(law(hkvSettlementInfo, year('2021-11-01', '2022-10-31'), log), false)
  assert.equal(law(hkvSettlementInfo, year('2021-12-01', '2022-11-30'), log), true)
  assert.ok(!LAW_PARAMS.some((p) => p.id === 'hkv.info.applicable-from'))
})

test('Fernwärme unter 20 MW erst ab 01.01.2022 (Auslegung nach Beginn des Zeitraums)', () => {
  const log = createLawLog()
  assert.deepEqual(law(hkvInfoDistrict, year('2021-12-01', '2022-11-30'), log), { scope: 'largeOnly', thresholdMw: 20 })
  assert.deepEqual(law(hkvInfoDistrict, year('2022-01-01', '2022-12-31'), log), { scope: 'all', thresholdMw: 20 })
  assert.ok(hkvInfoDistrict.versions.every((v) => v.source.rank === 'interpretation'))
})

test('§ 6a Abs. 1 Nr. 2: monatlich ab 01.01.2022, Zeitregel overlap', () => {
  const log = createLawLog()
  assert.equal(law(hkvMonthlyInfo, year('2021-01-01', '2021-12-31'), log).coverage, 'none')
  assert.equal(log.values.length, 0, 'ein Wert, der nicht gilt, steht nicht im Rechtsstand')
  assert.equal(law(hkvMonthlyInfo, year('2021-05-01', '2022-04-30'), log).coverage, 'partial')
  assert.equal(law(hkvMonthlyInfo, year('2025-01-01', '2025-12-31'), log).coverage, 'full')
})

test('§ 11: 15 kWh/(m²·a), 01.07.1981, zehn Jahre', () => {
  assert.deepEqual(onlyVersion(hkvExemptions).value, { lowDemandKwhPerM2Year: 15, readyBefore: '1981-07-01', paybackYears: 10 })
})

test('Register: die vier neuen Parameter in LAW_PARAMS, gelesen am 07.10.2026', () => {
  const ids = LAW_PARAMS.map((p) => p.id)
  for (const p of [hkvCutInformation, hkvInfoDistrict, hkvMonthlyInfo, hkvExemptions]) {
    assert.ok(ids.includes(p.id), p.id)
    assert.ok(p.versions.every((v) => v.source.retrieved === '2026-10-07' && v.source.checked === 'checked'), p.id)
  }
})

test('Regeln heating-info und heating-exemption, Zahlen aus dem Register', () => {
  const info = RULES.find((r) => r.code === 'heating-info') ?? assert.fail('heating-info fehlt')
  assert.match(info.norm, /§ 6a Abs\. 1, 3, 5 HeizkostenV; § 12 Abs\. 1 Satz 3 HeizkostenV/)
  assert.match(info.summary, /um 3 % kürzen/)
  assert.match(info.summary, /mindestens die Kontaktinformationen und die Information zur Streitbeilegung/)
  // Ein Kürzungsrecht, nicht eines je fehlender Angabe (Wortlaut „nicht oder nicht vollständig“).
  assert.doesNotMatch(info.summary, /je fehlende/)
  const ex = RULES.find((r) => r.code === 'heating-exemption') ?? assert.fail('heating-exemption fehlt')
  assert.match(ex.norm, /§ 11 HeizkostenV; § 2 Abs\. 7 CO2KostAufG; BT-Drs\. 20\/3172, S\. 28; § 556a Abs\. 1 BGB/)
  assert.match(ex.summary, /15 kWh je m² und Jahr.*10 Jahren.*01\.07\.1981/s)
  for (const code of ['heating-info', 'heating-exemption']) assert.equal(ruleCoverage(code, '2025-01-01', '2025-12-31'), 'full')
})

test('Kontaktinformationen (§ 6a Abs. 3 Nr. 2): Verbraucherorganisation, Energieagentur, https, mit Prüfdatum', () => {
  assert.ok(INFO_CONTACTS.length >= 3)
  assert.ok(INFO_CONTACTS.every((c) => c.url.startsWith('https://') && c.name.trim() !== '' && c.what.trim() !== ''))
  assert.ok(INFO_CONTACTS.some((c) => /Verbraucherzentrale/.test(c.name)))
  assert.ok(INFO_CONTACTS.some((c) => /Energie-Agentur/.test(c.name)))
  assert.equal(INFO_CONTACTS_CHECKED, '2026-10-07')
})

// Durchsicht von #243, Runde 1: R-K8 (Regel zur Ablesung neben dem Stichtag), R-W4 (ein Kürzungsrecht nach Satz 3),
// R-W8 (CO₂ unter einer Ausnahme nur der Wärme), R-K10 (Wortlaut „vorhergehender Abrechnungszeitraum“).
test('Durchsicht von #243: Regeln und Lexikon zu Ablesung, Kürzungsrecht, CO₂ unter § 11 und Wortlaut', async () => {
  const reading = RULES.find((r) => r.code === 'heating-reading-date') ?? assert.fail('Regel fehlt')
  assert.doesNotMatch(reading.summary, /zwingend ist ein Grund erst/i)
  assert.match(reading.summary, /Auch ein Ablesefehler ist ein solcher Grund, wenn sich der Wert nicht mehr ermitteln lässt/)
  const info = RULES.find((r) => r.code === 'heating-info') ?? assert.fail('Regel fehlt')
  assert.match(info.summary, /ein Kürzungsrecht, auch wenn mehrere Informationen fehlen; es summieren sich nur Kürzungsrechte aus verschiedenen Sätzen.*BR-Drs\. 643\/21, S\. 23 f\./s)
  const ex = RULES.find((r) => r.code === 'heating-exemption') ?? assert.fail('Regel fehlt')
  assert.match(ex.summary, /„in denen keine Heizkostenabrechnung durchgeführt wird“.*nur die Wärme ausgenommen.*teilt Mietfuchs die CO₂-Kosten deshalb weiter auf \(Auslegung von Mietfuchs\)/s)
  assert.match(ex.summary, /Solaranlagen versorgt werden; für Räume in Gebäuden, die überwiegend mit Wärme aus Kraft-Wärme-Kopplung oder Abwärme versorgt werden, sofern/)
  assert.match(ex.summary, /das Anbringen der Ausstattung zur Verbrauchserfassung.*nicht oder nur mit unverhältnismäßig hohen Kosten/s)
  const { GLOSSARY } = await import('../../shared/glossary.ts')
  assert.doesNotMatch(`${GLOSSARY.billingInfo.short} ${GLOSSARY.climateFactor.needed}`, /Vorjahr/)
  assert.match(GLOSSARY.billingInfo.example, /BR-Drs\. 643\/21, S\. 23 f\./)
})

test('Durchsicht Runde 2: Lexikon und Anleitung zu § 9a (R2-N-W2) und zum Verbrauchervertrag (R2-N-K3)', async () => {
  const { GLOSSARY } = await import('../../shared/glossary.ts')
  assert.match(GLOSSARY.billingInfo.needed, /geschätzt \(§ 9a\), gelten nach der Begründung der Verordnung nur die Mindestangaben.*Auslegung/s)
  assert.doesNotMatch(GLOSSARY.billingInfo.needed, /gehören die Vergleiche nach der Begründung nicht dazu/)
  const { GUIDES } = await import('../../shared/guides.ts')
  const text = JSON.stringify(GUIDES)
  assert.doesNotMatch(text, /und ob Sie als Unternehmer vermieten/)
  assert.match(text, /ob Ihr Mietvertrag ein Verbrauchervertrag ist/)
})

test('Durchsicht Runde 3, N2-H2: Lexikon erklärt die Gradtagzahlen beim Wechsel unter einer Vereinbarung nach § 2', async () => {
  const { GLOSSARY } = await import('../../shared/glossary.ts')
  assert.match(GLOSSARY.degreeDays.needed, /nach § 2 HeizkostenV eine Verteilung nach Wohnfläche vereinbart.*sinngemäß \(Festlegung von Mietfuchs\)/s)
  // Runde 4 (N3-K1): § 6a und die Fernablesbarkeit gelten weiter; nur die Verteilungsregeln treten zurück.
  assert.match(GLOSSARY.degreeDays.needed, /Die Verteilungsregeln treten dann hinter die Vereinbarung zurück \(§ 2 HeizkostenV\)/)
  assert.doesNotMatch(GLOSSARY.degreeDays.needed, /Die Verordnung gilt dann nicht/)
})

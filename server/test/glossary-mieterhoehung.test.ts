// Lexikon zur Mieterhöhung (#191): sechs Begriffe, Rechtszahlen aus dem Register, Beispiele nachgerechnet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GLOSSARY } from '../../shared/glossary.ts'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { bgbIndexRent, bgbRentCap, bgbRentIncreaseConsent, bgbRentIncreaseLockMonths, bgbRentIncreaseWaitMonths, bgbStaggeredRent } from '../../shared/law/bgb-betrkv.ts'
import { practiceVpiSeries } from '../../shared/law/practice.ts'

const euro = (text: string): number => Math.round(Number(text.replace(/\./g, '').replace(',', '.')) * 100)
const floorCents = (exact: number): number => Math.floor(exact * 100 + 1e-9)

test('Lexikon Mieterhöhung: sechs Begriffe, je mit Norm, gesiezt', () => {
  for (const id of ['comparisonRent', 'rentCap', 'indexRent', 'staggeredRent', 'rentIncreaseRequest', 'consentPeriod'] as const) {
    const t = GLOSSARY[id]
    assert.ok(t, id)
    assert.equal(t.topic, 'tenants', id)
    assert.ok('norm' in t && String(t.norm).trim(), `${id}: Norm fehlt`)
    for (const text of [t.short, t.example, t.needed]) {
      assert.doesNotMatch(text, /\b(du|dein|deine|dir|dich)\b/i, `${id}: geduzt`)
      assert.doesNotMatch(text, /\u2014/, `${id}: Geviertstrich`)
    }
  }
})

test('Lexikon Vergleichsmiete: Beispiel nachgerechnet, Wartefrist und Sperrfrist aus dem Register', () => {
  const t = GLOSSARY.comparisonRent
  assert.match(t.norm, /§ 558 Abs\. 1, 2/)
  assert.match(t.norm, /VIII ZR 266\/14/)
  assert.match(t.short, new RegExp(`seit ${valueAt(bgbRentIncreaseWaitMonths, LAW_AS_OF)} Monaten unverändert`))
  assert.match(t.short, new RegExp(`frühestens ${valueAt(bgbRentIncreaseLockMonths, LAW_AS_OF)} Monate nach`))
  const m = /(\d+) m², Mietspiegel ([\d,]+) € je m²: Vergleichsmiete \1 × \2 € = ([\d.,]+) €/.exec(t.example) ?? assert.fail(t.example)
  assert.equal(Number(m[1]) * euro(m[2] ?? ''), euro(m[3] ?? ''))
  const cap = /(\d+) € × ([\d,]+) = ([\d.,]+) €/.exec(t.example) ?? assert.fail(t.example)
  assert.equal(Number(cap[2]?.replace(',', '.')), 1 + valueAt(bgbRentCap, LAW_AS_OF).percent / 100)
  assert.equal(floorCents(Number(cap[1]) * Number(cap[2]?.replace(',', '.'))), euro(cap[3] ?? ''))
})

test('Lexikon Kappungsgrenze: Prozente und Jahre aus dem Register, BGH-Beispiel nachgerechnet, Verordnungen der Länder ohne Gemeindeliste', () => {
  const t = GLOSSARY.rentCap
  const cap = valueAt(bgbRentCap, LAW_AS_OF)
  assert.match(t.short, new RegExp(`${cap.years} Jahren um höchstens ${cap.percent} %`))
  assert.match(t.short, new RegExp(`höchstens ${cap.reducedPercent} %`))
  assert.match(t.norm, /VIII ZR 177\/03/)
  const lines = [...t.example.matchAll(/([\d,]+) € × ([\d,]+) = ([\d,]+) €/g)]
  assert.equal(lines.length, 2)
  for (const [, from, factor, to] of lines) {
    assert.equal(floorCents((euro(from ?? '') / 100) * Number(factor?.replace(',', '.'))), euro(to ?? ''), `${from} × ${factor}`)
  }
  // 272,31 € × 1,2 = 326,772 €: die höchstzulässige Miete 326,77 € (BGH VIII ZR 177/03).
  assert.match(t.example, /326,77 €/)
  assert.match(t.needed, /weiß nicht/)
  assert.match(t.needed, /Landesrecht|Verordnungsblatt/)
  assert.doesNotMatch(t.needed, /München|Berlin|Hamburg|Köln|Frankfurt/, 'keine Gemeindeliste')
})

test('Lexikon Indexmiete: Verhältnis statt Punkte, abgerundet, Basis und Tabelle aus dem Register (BGH VIII ZR 291/16)', () => {
  const t = GLOSSARY.indexRent
  const vpi = valueAt(practiceVpiSeries, LAW_AS_OF)
  assert.match(t.needed, new RegExp(`Basis ${vpi.base} = 100`))
  assert.match(t.needed, new RegExp(vpi.table))
  assert.match(t.short, new RegExp(`mindestens ${valueAt(bgbIndexRent, LAW_AS_OF).minMonths} Monate`))
  assert.match(t.short, /übernächsten Monat/)
  assert.equal(valueAt(bgbIndexRent, LAW_AS_OF).effectiveMonthOffset, 2)
  const m = /([\d,]+) € × ([\d,]+) \/ ([\d,]+) = ([\d,]+) €/.exec(t.example) ?? assert.fail(t.example)
  const exact = (euro(m[1] ?? '') / 100) * Number(m[2]?.replace(',', '.')) / Number(m[3]?.replace(',', '.'))
  assert.equal(floorCents(exact), euro(m[4] ?? ''))
  assert.equal(euro(m[4] ?? ''), 77153, 'Testwert des Entwurfs: 771,53 €')
  assert.match(t.example, /86,53 € mehr/)
})

test('Lexikon Staffelmiete: Mindestabstand aus dem Register, Beispiel mit Abstand darunter', () => {
  const t = GLOSSARY.staggeredRent
  const min = valueAt(bgbStaggeredRent, LAW_AS_OF).minMonths
  assert.match(t.short, new RegExp(`mindestens ${min} Monate`))
  assert.match(t.example, new RegExp(`Abstand von ${min} Monaten`))
  assert.match(t.example, /nur 9 Monate/)
  assert.match(t.norm, /§ 557a/)
})

test('Lexikon Mieterhöhungsverlangen und Zustimmungsfrist: Fristbeispiel 20.11.2026 nach § 558b nachgerechnet', () => {
  const c = valueAt(bgbRentIncreaseConsent, LAW_AS_OF)
  assert.deepEqual(c, { consentMonths: 2, effectiveMonth: 3, suitMonths: 3 })
  const t = GLOSSARY.consentPeriod
  assert.match(t.example, /20\.11\.2026/)
  assert.match(t.example, /31\.01\.2027/)
  assert.match(t.example, /01\.02\.2027/)
  assert.match(t.example, /30\.04\.2027/)
  assert.equal(new Date('2027-01-31T00:00:00Z').getUTCDay(), 0, '31.01.2027 ist ein Sonntag')
  assert.match(t.short, /zweiten Kalendermonats/)
  assert.match(t.short, /dritten Kalendermonats/)
  assert.match(t.short, /drei weiteren Monaten/)
  const r = GLOSSARY.rentIncreaseRequest
  assert.match(r.short, /Textform/)
  assert.match(r.short, /alle Mieter/)
  assert.match(r.short, /Schweigt der Mieter, hat er nicht zugestimmt/)
  assert.match(r.example, /spätestens seit 01\.11\.2025/)
  assert.match(r.example, new RegExp(`seit ${valueAt(bgbRentIncreaseWaitMonths, LAW_AS_OF)} Monaten`))
})

test('Lexikon Mieterhöhung, Schreiben (PR 3): Begründungsmittel und qualifizierter Mietspiegel, Abstand aus dem Register', async () => {
  const { bgbRentSurveyUpdateYears } = await import('../../shared/law/bgb-betrkv.ts')
  for (const id of ['rentJustification', 'qualifiedRentSurvey'] as const) {
    const t = GLOSSARY[id]
    assert.equal(t.topic, 'tenants', id)
    assert.match(t.norm, /§ 558a/, id)
    for (const text of [t.short, t.example, t.needed]) {
      assert.doesNotMatch(text, /\b(du|dein|deine|dir|dich)\b/i, `${id}: geduzt`)
      assert.doesNotMatch(text, /\u2014/, `${id}: Geviertstrich`)
    }
  }
  assert.equal(valueAt(bgbRentSurveyUpdateYears, LAW_AS_OF), 2)
  assert.match(GLOSSARY.qualifiedRentSurvey.short, /im Abstand von zwei Jahren/)
  assert.match(GLOSSARY.qualifiedRentSurvey.short, /auch wenn Sie es mit Vergleichswohnungen oder einem Gutachten begründen/)
  // Das Beispiel der Vergleichswohnungen: verlangt wird höchstens die niedrigste Miete je m².
  const rates = [...GLOSSARY.rentJustification.example.matchAll(/(\d+,\d{2}) € je m²/g)].map((m) => euro(m[1] ?? ''))
  assert.equal(rates.at(-1), Math.min(...rates.slice(0, 3)))
})

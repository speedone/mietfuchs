// Begriffslexikon (#113): Jeder Fachbegriff hat eine Erklärung, ein Beispiel mit Zahlen und die
// Antwort auf „Brauche ich das?“. Jeder Hinweis der Berechnung verweist auf mindestens einen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GLOSSARY } from '../../shared/glossary.ts'
import { NOTICE_KINDS } from '../src/calc.ts'

test('Lexikon: jeder Eintrag ist vollständig, und jedes Beispiel rechnet mit Zahlen', () => {
  const entries = Object.entries(GLOSSARY)
  assert.ok(entries.length >= 20, `nur ${entries.length} Begriffe`)
  for (const [id, t] of entries) {
    assert.ok(t.title.trim() && t.short.trim() && t.example.trim() && t.needed.trim(), id)
    assert.match(t.example, /\d/, `${id}: Beispiel ohne Zahl`)
    if ('norm' in t) assert.ok(String(t.norm).trim(), `${id}: leere Rechtsgrundlage`)
  }
  const titles = entries.map(([, t]) => t.title)
  assert.equal(new Set(titles).size, titles.length, 'doppelter Titel')
})

test('Hinweise: jeder Code verweist auf mindestens einen Begriff des Lexikons', () => {
  for (const [code, kind] of Object.entries(NOTICE_KINDS)) {
    const terms = kind?.terms ?? []
    assert.ok(terms.length > 0, `${code} ohne Begriff`)
    for (const t of terms) assert.ok(Object.hasOwn(GLOSSARY, t), `${code}: unbekannter Begriff ${t}`)
  }
})

test('Erhaltungsrücklage: eigener Begriff, und die Hilfetexte führen nicht mehr in die Werbungskosten (#143)', () => {
  const t = GLOSSARY.reserveFund
  assert.match(t.norm, /IX R 19\/24/)
  assert.match(t.short, /erst/)
  // Beispiel nachgerechnet: 3.600 € Hausgeld − 900 € Rücklage = 2.700 € sofort abziehbar.
  assert.match(t.example, /3\.600 €.*900 €.*2\.700 €/s)
  assert.equal(3600 - 900, 2700)
  // Die Hausgeldabrechnung nannte die Rücklage ohne steuerlichen Zusatz neben den abziehbaren
  // Posten; das Beispiel muss sie jetzt ausdrücklich als erst bei Verwendung abziehbar nennen.
  assert.match(GLOSSARY.homeownersStatement.example, /Rücklage[^.]*erst/)
  assert.equal(1900 + 360 + 900 + 440, 3600, 'Summe des Hausgeld-Beispiels')
  assert.match(GLOSSARY.notAllocable.needed, /Zuführung Erhaltungsrücklage/)
})

test('Gemeinschaftsabrechnung mit mehreren eigenen Wohnungen: das Lexikon empfiehlt für Heizkosten Einzelbeträge (#140, Durchsicht)', () => {
  // Laut Gemeinschaftsabrechnung verteilt Mietfuchs innerhalb der eigenen Wohnungen nach MEA oder
  // Fläche, nicht nach deren Verbrauch.
  assert.match(GLOSSARY.mea.needed, /mehrere Wohnungen/)
  assert.match(GLOSSARY.mea.needed, /Einzelbeträge/)
})

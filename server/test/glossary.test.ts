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

test('Hausgeld (Vorschuss): eigener Begriff, abgegrenzt von Abrechnung und Rücklage, Abfluss für die Steuer (#142)', () => {
  const t = GLOSSARY.homeownersFee
  assert.equal(t.title, 'Hausgeld (Vorschuss)')
  assert.match(t.norm, /§ 28 WEG/)
  assert.match(t.norm, /§ 11 Abs\. 2 EStG/)
  // Abgrenzung: nicht die Hausgeldabrechnung und nicht die Erhaltungsrücklage.
  assert.match(t.short + t.needed, /Hausgeldabrechnung/)
  assert.match(t.short + t.example + t.needed, /Erhaltungsrücklage/)
  // Steuerlich zählt der Abfluss.
  assert.match(t.needed, /abfließt|Abfluss/)
  // Beispiel nachgerechnet: 300 € im Monat sind 3.600 € im Jahr; davon 900 € Rücklage, 2.700 € sofort.
  assert.match(t.example, /300 €.*3\.600 €.*900 €.*2\.700 €/s)
  assert.equal(300 * 12, 3600)
  assert.equal(3600 - 900, 2700)
})

test('Einheit ohne Anschluss: eigener Begriff mit nachgerechnetem Beispiel (#142)', () => {
  const t = GLOSSARY.noConnection
  assert.equal(t.title, 'Einheit ohne Anschluss')
  assert.match(t.short, /Garage/)
  // 600 € Wasser nach Verbrauch, zwei Wohnungen mit 40 und 20 m³, die Garage ohne Wasser: 400 € und 200 €.
  assert.match(t.example, /600 €.*40.*20 m³.*400 €.*200 €/s)
  assert.equal(600 * 40 / 60, 400)
  assert.equal(600 * 20 / 60, 200)
})

test('Einliegerwohnung: Anlage in Mietfuchs, Folgen und ein nachgerechnetes Beispiel (#142)', () => {
  const t = GLOSSARY.granny
  assert.equal(t.title, 'Einliegerwohnung')
  assert.match(t.norm, /§ 2 HeizkostenV/)
  assert.match(t.needed, /selbstgenutzt/)
  assert.match(t.needed, /Hauptzähler/)
  assert.match(t.needed, /Eigenanteil/)
  // 120 m² eigen + 45 m² vermietet = 165 m², Grundsteuer 600 €: 45/165 = 163,64 €, der Rest 436,36 €.
  assert.match(t.example, /120 m².*45 m².*165 m².*600 €.*163,64 €.*436,36 €/s)
  assert.equal(120 + 45, 165)
  assert.equal(Math.round((60000 * 45) / 165), 16364)
  assert.equal(60000 - 16364, 43636)
})

test('Teilweise selbstgenutztes Gebäude: Rechtsgrundlage, gesonderte Aufstellung und ein nachgerechnetes Beispiel (#163)', () => {
  const t = GLOSSARY.mixedUse
  assert.equal(t.title, 'Teilweise selbstgenutztes Gebäude')
  assert.match(t.norm, /§ 12 Nr\. 1 EStG/)
  assert.match(t.norm, /IX R 26\/06/)
  assert.match(t.needed, /gesonderte[nr]? Aufstellung/)
  assert.match(t.needed, /Betrifft \(für die Steuer\)/)
  // 120 + 60 = 180 m²; Dachreparatur 1.800 € × 60/180 = 600 € abziehbar, 1.200 € privat.
  assert.match(t.example, /120 m².*60 m².*180 m².*1\.800 €.*600 €.*1\.200 €/s)
  assert.equal(120 + 60, 180)
  assert.equal(1800 * 60 / 180, 600)
  assert.equal(1800 - 600, 1200)
})

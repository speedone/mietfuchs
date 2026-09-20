// Was die KI-Auswertung aus der Antwort eines Modells übernimmt. Geprüft wird hier nur das
// Einengen der Werte, nicht der Weg zum Anbieter — den decken api.test.ts und der Smoke-Test ab.
//
// Grundsatz des Werkzeugs: Die KI füllt vor, ein Mensch prüft. Verworfen wird deshalb nur, was
// niemand gebrauchen kann. Das Schema verlangt für den Zählerstand eine Zahl, erzwungen wird das
// aber nicht immer: Lehnt ein Dienst das Schema ab, fällt ai/openai.ts stufenweise bis auf „nur
// Prompt" zurück, und ein kleines Modell auf dem eigenen Rechner antwortet dann, wie es mag.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readingNumber } from '../src/extract.ts'

test('Zählerstand: Zahlen kommen unverändert an', () => {
  assert.equal(readingNumber(12345), 12345)
  assert.equal(readingNumber(0), 0)
  assert.equal(readingNumber(1234.5), 1234.5)
})

test('Zählerstand: eine Zahl als Text wird übernommen, deutsch wie technisch geschrieben', () => {
  const cases: [string, number][] = [
    ['12345', 12345],
    ['012345', 12345], // führende Nullen stehen auf dem Zählwerk
    [' 4711 ', 4711],
    ['12 345', 12345], // manche Modelle gruppieren mit Leerzeichen
    ['1234,5', 1234.5], // deutsch: Komma trennt die Nachkommastellen
    ['1.234,56', 1234.56], // deutsch: Punkt gruppiert, Komma trennt
    ['1234.5', 1234.5], // technisch
    ['1,234.5', 1234.5], // englisch: Komma gruppiert, Punkt trennt
    ['12.34', 12.34], // drei Stellen wären eine Gruppe, zwei sind es nicht
    ['1.234.567', 1234567], // zwei Trennzeichen können nur gruppieren
    ['-5', -5],
  ]
  for (const [text, expected] of cases) assert.equal(readingNumber(text), expected, text)
})

test('Zählerstand: was mehrdeutig oder keine Zahl ist, gilt als nicht gelesen', () => {
  // „1.234" ist entweder tausendzweihundertvierunddreißig oder eins Komma zwei drei vier.
  // Raten hieße hier, einen Faktor 1000 zu raten, deshalb bleibt das Feld leer.
  const ambiguous = ['1.234', '1,234', '123.456', '12,345']
  for (const text of ambiguous) assert.equal(readingNumber(text), null, text)

  const notANumber: unknown[] = [
    null, undefined, true, {}, [], NaN, Infinity,
    '', '   ', 'abc', 'ca. 1234', '1234 m³', '12 oder 13', '-', '1234,', ',5', '1,2,3',
  ]
  for (const value of notANumber) assert.equal(readingNumber(value), null, JSON.stringify(value) ?? String(value))
})

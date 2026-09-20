// Was die KI-Auswertung aus der Antwort eines Modells übernimmt. Geprüft wird hier nur das
// Einengen der Werte, nicht der Weg zum Anbieter — den decken api.test.ts und der Smoke-Test ab.
//
// Grundsatz des Werkzeugs: Die KI füllt vor, ein Mensch prüft. Verworfen wird deshalb nur, was
// niemand gebrauchen kann. Die Schemas verlangen für Beträge und Zählerstände eine Zahl,
// erzwungen wird das aber nicht immer: Lehnt ein Dienst das Schema ab, fällt ai/openai.ts
// stufenweise bis auf „nur Prompt“ zurück, und ein kleines Modell auf dem eigenen Rechner
// antwortet dann, wie es mag.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numberFromModel, rawFromAnswer, toExtraction } from '../src/extract.ts'

test('Zahlen aus der Antwort: Zahlen kommen unverändert an', () => {
  assert.equal(numberFromModel(12345), 12345)
  assert.equal(numberFromModel(0), 0)
  assert.equal(numberFromModel(1234.5), 1234.5)
})

test('Zahlen aus der Antwort: eine Zahl als Text wird übernommen, deutsch wie technisch geschrieben', () => {
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
  for (const [text, expected] of cases) assert.equal(numberFromModel(text), expected, text)
})

test('Zahlen aus der Antwort: was mehrdeutig oder keine Zahl ist, gilt als nicht gelesen', () => {
  // „1.234" ist entweder tausendzweihundertvierunddreißig oder eins Komma zwei drei vier.
  // Raten hieße hier, einen Faktor 1000 zu raten, deshalb bleibt das Feld leer.
  const ambiguous = ['1.234', '1,234', '123.456', '12,345']
  for (const text of ambiguous) assert.equal(numberFromModel(text), null, text)

  const notANumber: unknown[] = [
    null, undefined, true, {}, [], NaN, Infinity,
    '', '   ', 'abc', 'ca. 1234', '1234 m³', '12 oder 13', '-', '1234,', ',5', '1,2,3',
  ]
  for (const value of notANumber) assert.equal(numberFromModel(value), null, JSON.stringify(value) ?? String(value))
})

// ---------- Die Naht zwischen roher Antwort und Zusage ----------

test('Eingang: Beträge als Text werden gelesen, bevor gerechnet wird', () => {
  const raw = rawFromAnswer({
    totalGrossEur: '1.234,56',
    positions: [{ description: 'Frischwasser', amountEur: '12,50', labor35aEur: '4,20' }],
  })
  assert.equal(raw.totalGrossEur, 1234.56)
  assert.deepEqual(raw.positions, [{ description: 'Frischwasser', amountEur: 12.5, labor35aEur: 4.2 }])
})

test('Eingang: was Mietfuchs selbst rechnet, kann das Modell nicht behaupten', () => {
  // Sonst stünde in der Oberfläche der Hinweis auf eine Hochrechnung, die nie stattfand (#34).
  const raw = rawFromAnswer({ amountsAdjusted: 'netto', laborFromTotal: true, vendor: 'Stadtwerke' })
  assert.equal(raw.amountsAdjusted, undefined)
  assert.equal(raw.laborFromTotal, undefined)
  assert.equal(raw.vendor, 'Stadtwerke')
})

test('Eingang: was keine Liste von Positionen ist, wird eine leere', () => {
  assert.deepEqual(rawFromAnswer({}).positions, [])
  assert.deepEqual(rawFromAnswer({ positions: 'keine' }).positions, [])
  // Einträge, die keine Objekte sind, kann niemand gebrauchen
  assert.deepEqual(rawFromAnswer({ positions: [null, 'Frischwasser'] }).positions, [])
})

test('Ausgang: eine Position ohne brauchbaren Betrag bleibt erhalten, der Betrag fehlt', () => {
  // Die Oberfläche zeigt dann ein leeres Feld; ausfüllen kann es der Mensch, der ohnehin prüft.
  const { positions = [] } = toExtraction({
    positions: [
      { description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 12.5 },
      { description: 'Grundgebühr', category: 'Wasser/Abwasser' },
      { description: 'Schmutzwasser', category: 'Wasser/Abwasser', amountEur: 'siehe Anlage' },
      { description: 'Zählermiete', category: 'Wasser/Abwasser', amountEur: Number.NaN },
    ],
  })
  assert.deepEqual(positions.map((p) => p.description), ['Frischwasser', 'Grundgebühr', 'Schmutzwasser', 'Zählermiete'])
  assert.deepEqual(positions.map((p) => p.amountEur), [12.5, undefined, undefined, undefined])
})

test('Ausgang: fehlende Texte werden leer, unbrauchbare Zahlen fallen weg', () => {
  const extraction = toExtraction({
    vendor: 42,
    invoiceDate: '2026-03-15',
    totalGrossEur: 'etwa zwanzig',
    positions: [{ description: null, category: ['Wasser/Abwasser'], amountEur: 12.5, labor35aEur: 'kein' }],
  })
  assert.equal(extraction.vendor, undefined)
  assert.equal(extraction.invoiceDate, '2026-03-15')
  assert.equal(extraction.totalGrossEur, undefined)
  assert.deepEqual(extraction.positions, [{ description: '', category: '', amountEur: 12.5, labor35aEur: null }])
})

test('Ausgang: nur zugesagte Felder erreichen den Browser', () => {
  const extraction = toExtraction({ vendor: 'Stadtwerke', invoiceNumber: 'R-4711', positions: [] })
  assert.deepEqual(Object.keys(extraction).filter((k) => k === 'invoiceNumber'), [])
  assert.equal(extraction.vendor, 'Stadtwerke')
})

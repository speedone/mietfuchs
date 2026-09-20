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

test('Zahlen aus der Antwort: eine Einheit vor oder hinter der Zahl stört nicht', () => {
  // Eine Einheit macht die Zahl nicht mehrdeutig, und ein Modell ohne erzwungenes Schema
  // schreibt sie naheliegenderweise dazu. Angenommen wird nur, was in den kurzen Listen in
  // extract.ts steht: die Währung vor oder hinter der Zahl, die Einheiten der Zähler dahinter.
  const cases: [string, number][] = [
    ['12,50 €', 12.5],
    ['12,50€', 12.5],
    ['1.234,56 EUR', 1234.56],
    ['99 eur', 99],
    ['12,50 EURO', 12.5],
    ['€ 12,50', 12.5],
    ['EUR 12,50', 12.5],
    ['euro 1.234,56', 1234.56],
    ['1234 m³', 1234],
    ['1234 m3', 1234],
    ['1234 cbm', 1234],
    ['4711,5 kWh', 4711.5],
    ['-5 €', -5],
    ['€ -5', -5],
    ['-€ 5', -5],
    ['€ 12,50 €', 12.5], // vorn und hinten je einmal, das ist ungewöhnlich, aber eindeutig
  ]
  for (const [text, expected] of cases) assert.equal(numberFromModel(text), expected, text)
})

test('Zahlen aus der Antwort: was mehrdeutig oder keine Zahl ist, gilt als nicht gelesen', () => {
  // „1.234“ ist entweder tausendzweihundertvierunddreißig oder eins Komma zwei drei vier.
  // Raten hieße hier, einen Faktor 1000 zu raten, deshalb bleibt das Feld leer.
  const ambiguous = ['1.234', '1,234', '123.456', '12,345']
  for (const text of ambiguous) assert.equal(numberFromModel(text), null, text)

  const notANumber: unknown[] = [
    null, undefined, true, {}, [], NaN, Infinity,
    '', '   ', 'abc', '-', '1234,', ',5', '1,2,3',
    // Eine Unsicherheit des Modells ist keine Einheit, und sie soll der Mensch sehen.
    'ca. 1234', 'rund 12,50 €', 'ca. EUR 12,50', '12 oder 13', '12,50 pro Monat',
    // Abgetrennt wird nur, was in den Listen steht, kein allgemeines Abschneiden.
    '1234 Liter', '12,50 Dollar', '12,50 $', '$ 12,50', '1234 m²', 'm³ 1234',
    // Und auf jeder Seite nur einmal, nicht so lange, bis eine Zahl übrig bleibt.
    '€ € 12,50', '12,50 € €', '€', 'EUR', 'kWh',
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
    vendor: '  Stadtwerke  ',
    invoiceDate: '2026-03-15',
    periodStart: 2026,
    totalGrossEur: 'etwa zwanzig',
    positions: [{ description: null, category: ['Wasser/Abwasser'], amountEur: 12.5, labor35aEur: 'kein' }],
  })
  assert.equal(extraction.vendor, 'Stadtwerke')
  assert.equal(extraction.periodStart, undefined) // ein Zeitraum wird als Datum gelesen, eine Zahl ist keines
  assert.equal(extraction.invoiceDate, '2026-03-15')
  assert.equal(extraction.totalGrossEur, undefined)
  assert.deepEqual(extraction.positions, [{ description: '', category: '', amountEur: 12.5, labor35aEur: null }])
})

test('Ausgang: eine Zahl gilt als Beschreibung, aber nicht als Rechnungssteller', () => {
  // In der Beschreibung gilt dieselbe Regel wie beim Zählerstand (textOrNull): Eine Zahl wird
  // zum Text statt verworfen, denn sie landet in einem Feld, das ein Mensch liest und bei Bedarf
  // überschreibt. Der Rechnungssteller wird dagegen gespeichert und steht als Überschrift über
  // den Positionen eines Belegs. Dort ist „2026“ keine Auskunft, und ohne ihn nimmt die
  // Oberfläche den Dateinamen des Belegs, der weiterhilft.
  const extraction = toExtraction({ vendor: 2026, positions: [{ description: 4711, category: {} }] })
  assert.equal(extraction.vendor, undefined)
  assert.deepEqual(extraction.positions, [{ description: '4711', category: '', labor35aEur: null }])
})

test('Ausgang: unbrauchbare Positionen werfen nicht', () => {
  // Die Funktion soll für sich stehen und nicht davon abhängen, was der Eingang vorher
  // abgeräumt hat. Beides kam aus einem Modell so schon an.
  const notAList: Record<string, unknown> = { positions: 'abc' }
  assert.deepEqual(toExtraction(notAList).positions, [])
  const notObjects: Record<string, unknown> = { positions: [null, 'Frischwasser'] }
  assert.deepEqual(toExtraction(notObjects).positions, [])
})

test('Ausgang: nur Mietfuchs selbst kann sagen, dass es gerechnet hat', () => {
  // Die Zusage wird dort eingelöst, wo sie gegeben wird, und hängt nicht daran, was der Eingang
  // vorher abgeräumt hat.
  assert.equal(toExtraction({ amountsAdjusted: 'netto' }).amountsAdjusted, 'netto')
  assert.equal(toExtraction({ laborFromTotal: true }).laborFromTotal, true)
  const raw: Record<string, unknown> = { amountsAdjusted: 'brutto', laborFromTotal: 'ja' }
  assert.equal(toExtraction(raw).amountsAdjusted, undefined)
  assert.equal(toExtraction(raw).laborFromTotal, undefined)
})

test('Ausgang: nur zugesagte Felder erreichen den Browser', () => {
  const extraction = toExtraction({ vendor: 'Stadtwerke', invoiceNumber: 'R-4711', positions: [] })
  assert.deepEqual(Object.keys(extraction).filter((k) => k === 'invoiceNumber'), [])
  assert.equal(extraction.vendor, 'Stadtwerke')
})

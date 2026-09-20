// Beträge einer ausgewerteten Rechnung geradeziehen (#34). Zwei Fälle, die Modelle nicht
// zuverlässig selbst rechnen und die deshalb hier deterministisch passieren:
//
// 1. Positionen netto, Umsatzsteuer nur in der Summe (üblich bei Handwerkern und
//    Schornsteinfegern). Die Positionen müssen brutto werden und zusammen den Rechnungsbetrag
//    ergeben, sonst stimmt die Umlage nicht.
// 2. Der Arbeitskostenanteil nach §35a steht nur als ein Betrag unter der Rechnung. Er wird auf
//    die Positionen verteilt, damit die Bescheinigung ihn ausweisen kann.
//
// Gerechnet wird in Cent mit dem Restverfahren, wie in calc.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAmounts, type RawPosition } from '../src/invoiceAmounts.ts'

const chimney = () => ({
  vendor: 'Schornsteinfegerei Muster',
  totalGrossEur: 101.86,
  positionsAreNet: true,
  vatRatePercent: 19,
  labor35aTotalEur: 90.56,
  positions: [
    { description: 'Feuerstättenschau', category: 'Schornsteinfeger', amountEur: 28.7 },
    { description: 'Kehren der Abgasleitung', category: 'Schornsteinfeger', amountEur: 24.8 },
    { description: 'Abgaswegeüberprüfung', category: 'Schornsteinfeger', amountEur: 22.6 },
    { description: 'Fahrtkostenpauschale', category: 'Schornsteinfeger', amountEur: 9.5 },
  ],
})

const cents = (eur: number) => Math.round(eur * 100)

// Summe eines Betragsfelds in Cent. Die Felder stehen im Typ als `unknown`, weil sie ungeprüft
// aus dem Modell kommen. Ein fehlender Wert zählt als Null: `labor35aEur` darf laut Schema
// null sein, und eine Position ohne Lohnanteil ist der Normalfall. Steht dort aber etwas
// anderes als eine Zahl, ist genau das der Befund, und der Test benennt ihn.
const sum = (positions: RawPosition[], key: 'amountEur' | 'labor35aEur' = 'amountEur') =>
  positions.reduce((a, p) => {
    const value = p[key]
    if (value != null && typeof value !== 'number') assert.fail(`${key} ist keine Zahl: ${JSON.stringify(value)}`)
    return a + cents(value ?? 0)
  }, 0)

// normalizeAmounts legt `positions` immer an, auch wenn die KI keine geliefert hat. Im Typ
// steht das nicht, weil er die rohe Antwort beschreibt, in der das Feld fehlen darf. Statt die
// Zusage zu behaupten, wird sie hier geprüft: Bleibt sie aus, scheitert der Test mit Ansage.
function positionsOf(result: ReturnType<typeof normalizeAmounts>): RawPosition[] {
  const { positions } = result
  if (!positions) assert.fail('normalizeAmounts liefert immer Positionen')
  return positions
}

test('Nettopositionen werden brutto und ergeben genau den Rechnungsbetrag', () => {
  const result = normalizeAmounts(chimney())
  assert.equal(sum(positionsOf(result)), cents(101.86))
  // Mit 19 % aufgeschlagen, der Rest-Cent geht an den größten Rest
  assert.deepEqual(positionsOf(result).map((p) => p.amountEur), [34.15, 29.51, 26.89, 11.31])
  assert.equal(result.amountsAdjusted, 'netto')
})

test('Ohne brauchbaren Steuersatz wird der Rechnungsbetrag anteilig verteilt', () => {
  for (const rate of [null, 300, 'neunzehn']) {
    const result = normalizeAmounts({ ...chimney(), vatRatePercent: rate })
    assert.equal(sum(positionsOf(result)), cents(101.86), String(rate))
    assert.equal(result.amountsAdjusted, 'netto', String(rate))
  }
  const result = normalizeAmounts({ ...chimney(), vatRatePercent: null })
  assert.equal(sum(positionsOf(result)), cents(101.86))
  const vorher = chimney().positions
  assert.ok(positionsOf(result).every((p, i) => typeof p.amountEur === 'number' && p.amountEur > vorher[i].amountEur))
})

test('Passt die Summe schon, bleibt alles, wie es ist', () => {
  const brutto = {
    totalGrossEur: 42.5,
    positions: [{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 42.5 }],
  }
  const result = normalizeAmounts(brutto)
  assert.deepEqual(result.positions, brutto.positions)
  assert.equal(result.amountsAdjusted, undefined)
})

test('Ohne Kennzeichen „netto“ wird nicht gerechnet, auch wenn die Summe abweicht', () => {
  // Fehlt eine Position, wäre Hochrechnen falsch: Dann stimmt die Position, nicht die Summe.
  const result = normalizeAmounts({ ...chimney(), positionsAreNet: false })
  assert.deepEqual(positionsOf(result).map((p) => p.amountEur), [28.7, 24.8, 22.6, 9.5])
  assert.equal(result.amountsAdjusted, undefined)
})

// Fehlt der Wert einer Position, verteilt die Hochrechnung den ganzen Rechnungsbetrag auf die
// übrigen. Das Ergebnis ist das gefährlichste, das hier entstehen kann: Die Summe passt zum
// Beleg, und wer die Vorschläge prüft, sieht nichts Auffälliges — dabei ist jede einzelne
// Position rund zwanzig Prozent zu hoch, und das landet in einer Nebenkostenabrechnung.
//
// Auf drei Wegen kann der Wert fehlen, und das Modell wählt eher die beiden letzten: Es schreibt
// etwas, das keine Zahl ist, es schreibt die im Schema verlangte Zahl als 0, oder es lässt die
// Position ganz weg. Alle drei enden gleich, nämlich damit, dass die Positionssumme viel weiter
// unter dem Rechnungsbetrag liegt, als eine Umsatzsteuer erklären kann.
for (const [name, broken] of [
  ['unlesbar', { ...chimney(), positions: chimney().positions.map((p, i) => (i === 2 ? { ...p, amountEur: 'siehe Anlage' } : p)) }],
  ['als 0 geliefert', { ...chimney(), positions: chimney().positions.map((p, i) => (i === 2 ? { ...p, amountEur: 0 } : p)) }],
  ['ganz weggelassen', { ...chimney(), positions: chimney().positions.filter((_, i) => i !== 2) }],
] as const) {
  test(`Fehlt der Betrag einer Position (${name}), wird nicht hochgerechnet`, () => {
    const vorher = broken.positions.map((p) => p.amountEur)
    const result = normalizeAmounts(broken)
    assert.deepEqual(positionsOf(result).map((p) => p.amountEur), vorher)
    assert.equal(result.amountsAdjusted, undefined)
    // Und ebenso wenig wird der Lohnanteil verteilt: Er gehört zur ganzen Rechnung, und was von
    // der fehlenden Position darauf entfiele, bekämen sonst die übrigen dazu. Übernommen wird
    // die Position ohne Betrag nicht, also stünde am Ende zu viel §35a in der Steuererklärung.
    assert.ok(positionsOf(result).every((p) => p.labor35aEur == null), name)
    assert.equal(result.laborFromTotal, undefined)
  })
}

test('Eine Position, die laut Rechnung nichts kostet, verhindert das Hochrechnen nicht', () => {
  // Null ist etwas anderes als „nicht gelesen“: Eine Position mit 0,00 € steht so auf der
  // Rechnung (mitversicherte Leistung, Gutschriftszeile), und der Abstand zum Rechnungsbetrag
  // bleibt eine glaubhafte Umsatzsteuer. Der Rechnungsbetrag geht hier bewusst nicht glatt auf:
  // Es bleiben Cent zu verteilen, und die Null-Position darf trotzdem keinen davon bekommen.
  const free = {
    ...chimney(),
    vatRatePercent: null,
    totalGrossEur: 101.87,
    positions: [...chimney().positions, { description: 'Anfahrt inklusive', category: 'Schornsteinfeger', amountEur: 0 }],
  }
  const result = normalizeAmounts(free)
  assert.equal(sum(positionsOf(result)), cents(101.87))
  // Zwei Cent bleiben zu verteilen, und sie gehen an die Positionen mit den größten Resten
  assert.deepEqual(positionsOf(result).map((p) => p.amountEur), [34.15, 29.51, 26.9, 11.31, 0])
  assert.equal(result.amountsAdjusted, 'netto')
})

test('Ist ein Betrag unlesbar, wird auch der Lohnanteil nicht verteilt', () => {
  // Der Lohnanteil nach §35a gehört zur ganzen Rechnung. Wird er auf die Positionen verteilt,
  // die einen Betrag haben, bekommen sie den Anteil der übrigen mit dazu. Die Position ohne
  // Betrag übernimmt der Nutzer nicht (sie ist nicht einmal vorgehakt), also stünde am Ende zu
  // viel §35a in der Steuererklärung: hier 500 € Lohn auf 600 € Kosten, richtig wären 333 €.
  const handwerker = {
    vendor: 'Handwerk Muster',
    totalGrossEur: 900,
    labor35aTotalEur: 500,
    positions: [
      { description: 'Arbeit A', category: 'Nicht umlagefähig', amountEur: 300 },
      { description: 'Arbeit B', category: 'Nicht umlagefähig', amountEur: 300 },
      { description: 'Arbeit C', category: 'Nicht umlagefähig', amountEur: 'siehe Anlage' },
    ],
  }
  const result = normalizeAmounts(handwerker)
  assert.ok(positionsOf(result).every((p) => p.labor35aEur == null))
  assert.equal(result.laborFromTotal, undefined)
})

test('Fehlt eine Position, wird der Lohnanteil nicht verteilt', () => {
  // Dasselbe von der anderen Seite: Decken die Positionen den Rechnungsbetrag nicht ab, fehlt
  // etwas, und der Lohnanteil der fehlenden Position ginge an die vorhandenen.
  const result = normalizeAmounts({ ...chimney(), positionsAreNet: false, labor35aTotalEur: 20, positions: chimney().positions.slice(0, 2) })
  assert.ok(positionsOf(result).every((p) => p.labor35aEur == null))
  assert.equal(result.laborFromTotal, undefined)
})

test('Unsinnige Angaben ändern nichts', () => {
  for (const patch of [
    { totalGrossEur: 0 },
    { totalGrossEur: 20 }, // Summe größer als der Rechnungsbetrag
    { positions: [] },
  ]) {
    const result = normalizeAmounts({ ...chimney(), ...patch })
    assert.equal(result.amountsAdjusted, undefined, JSON.stringify(patch))
  }
})

test('Der Lohnanteil als Gesamtbetrag wird nach Beträgen verteilt und bleibt in der Summe gleich', () => {
  const result = normalizeAmounts(chimney())
  assert.equal(sum(positionsOf(result), 'labor35aEur'), cents(90.56))
  assert.ok(positionsOf(result).every((p) =>
    typeof p.labor35aEur === 'number' && typeof p.amountEur === 'number'
    && p.labor35aEur > 0 && p.labor35aEur <= p.amountEur))
  assert.equal(result.laborFromTotal, true)
})

test('Ein je Position ausgewiesener Lohnanteil bleibt unangetastet', () => {
  const withLabor = {
    ...chimney(),
    labor35aTotalEur: 90.56,
    positions: chimney().positions.map((p, i) => ({ ...p, labor35aEur: i === 0 ? 10 : null })),
  }
  const result = normalizeAmounts(withLabor)
  assert.equal(positionsOf(result)[0].labor35aEur, 10)
  assert.equal(result.laborFromTotal, undefined)
})

test('Ein Lohnanteil über dem Rechnungsbetrag wird nicht verteilt', () => {
  const result = normalizeAmounts({ ...chimney(), labor35aTotalEur: 500 })
  assert.ok(positionsOf(result).every((p) => p.labor35aEur == null))
  assert.equal(result.laborFromTotal, undefined)
})

test('Die Hilfsfelder verlassen die Auswertung nicht', () => {
  const result = normalizeAmounts(chimney())
  for (const key of ['positionsAreNet', 'vatRatePercent', 'labor35aTotalEur']) {
    assert.equal(key in result, false, key)
  }
})

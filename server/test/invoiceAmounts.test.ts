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

// normalizeAmounts legt `positions` immer als Liste an, auch wenn die KI keine geliefert hat. Im
// Typ steht das nicht, weil er die rohe Antwort beschreibt, in der das Feld alles sein darf.
// Statt die Zusage zu behaupten, wird sie hier geprüft: Bleibt sie aus, scheitert der Test mit
// Ansage.
function positionsOf(result: ReturnType<typeof normalizeAmounts>): RawPosition[] {
  const { positions } = result
  if (!Array.isArray(positions)) assert.fail('normalizeAmounts liefert immer eine Liste von Positionen')
  return positions
}

test('Nettopositionen werden brutto und ergeben genau den Rechnungsbetrag', () => {
  const result = normalizeAmounts(chimney())
  assert.equal(sum(positionsOf(result)), cents(101.86))
  // Mit 19 % aufgeschlagen, der Rest-Cent geht an den größten Rest
  assert.deepEqual(positionsOf(result).map((p) => p.amountEur), [34.15, 29.51, 26.89, 11.31])
  assert.equal(result.amountsAdjusted, 'netto')
})

test('Hochgerechnet wird anteilig, ein genannter Steuersatz ändert daran nichts', () => {
  // Der Rechnungsbetrag ist die härtere Angabe als ein Satz, den das Modell gelesen haben will.
  // Mit dem Satz zu rechnen brachte nichts, weil das Restverfahren ohnehin auf den
  // Rechnungsbetrag normiert, und konnte schaden: Bei Satz 30 und Rechnungsbetrag 11,00 wurden
  // aus 9,90 und 0,10 die Beträge 11,87 und -0,87, und das mit der Markierung „netto“.
  const steep = { totalGrossEur: 11, positionsAreNet: true, vatRatePercent: 30, positions: [{ amountEur: 9.9 }, { amountEur: 0.1 }] }
  const result = normalizeAmounts(steep)
  assert.deepEqual(positionsOf(result).map((p) => p.amountEur), [10.89, 0.11])
  assert.equal(sum(positionsOf(result)), cents(11))
  // Und mit richtigem Satz kommt in jeder Position dasselbe heraus wie ohne ihn
  for (const rate of [19, null, 300, 'neunzehn']) {
    const withRate = normalizeAmounts({ ...chimney(), vatRatePercent: rate })
    assert.deepEqual(positionsOf(withRate).map((p) => p.amountEur), [34.15, 29.51, 26.89, 11.31], String(rate))
  }
})

test('Ein Beleg mit sieben Prozent wird ebenso hochgerechnet', () => {
  // Der ermäßigte Satz ist der blinde Fleck jeder Obergrenze: Je kleiner der erwartete Abstand,
  // desto mehr kann eine fehlende Position darunter verschwinden.
  const result = normalizeAmounts({ totalGrossEur: 214, positionsAreNet: true, positions: [{ amountEur: 100 }, { amountEur: 100 }] })
  assert.deepEqual(positionsOf(result).map((p) => p.amountEur), [107, 107])
  assert.equal(result.amountsAdjusted, 'netto')
})

test('Der Abstand muss zu einem Steuersatz passen, nicht nur unter einer Obergrenze liegen', () => {
  // Genau an der Schranke (19 Prozent plus eine halbe für Rundung) wird noch gerechnet,
  // einen Cent darüber nicht mehr. Dazwischen liegt der Unterschied zwischen einer
  // Nettorechnung und einer, bei der etwas fehlt.
  const atLimit = normalizeAmounts({ totalGrossEur: 119.5, positionsAreNet: true, positions: [{ amountEur: 50 }, { amountEur: 50 }] })
  assert.equal(atLimit.amountsAdjusted, 'netto')
  const beyond = normalizeAmounts({ totalGrossEur: 119.51, positionsAreNet: true, positions: [{ amountEur: 50 }, { amountEur: 50 }] })
  assert.deepEqual(positionsOf(beyond).map((p) => p.amountEur), [50, 50])
  assert.equal(beyond.amountsAdjusted, undefined)
})

test('Passt die Summe schon, bleibt alles, wie es ist, auch mit Kennzeichen „netto“', () => {
  // Das Kennzeichen allein ist kein Anlass: Stimmt die Positionssumme bereits mit dem
  // Rechnungsbetrag überein, gibt es nichts hochzurechnen, und die Oberfläche soll auch keine
  // Hochrechnung melden, die nicht stattgefunden hat.
  const brutto = {
    totalGrossEur: 42.5,
    positionsAreNet: true,
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
// Beleg, und wer die Vorschläge prüft, sieht nichts Auffälliges, dabei ist jede einzelne
// Position zu hoch, und das landet in einer Nebenkostenabrechnung.
//
// Auf drei Wegen kann der Wert fehlen, und das Modell wählt eher die beiden letzten: Es schreibt
// etwas, das keine Zahl ist, es schreibt die im Schema verlangte Zahl als 0, oder es lässt die
// Position ganz weg. Alle drei enden gleich, nämlich damit, dass die Positionssumme weiter unter
// dem Rechnungsbetrag liegt, als eine Umsatzsteuer erklären kann. Der Lohnanteil steht hier
// niedrig genug, dass ihn die Bruttosumme nicht ohnehin verhindert. Geprüft werden soll, dass
// die fehlende Position ihn verhindert.
for (const [name, broken] of [
  ['unlesbar', { ...chimney(), labor35aTotalEur: 20, positions: chimney().positions.map((p, i) => (i === 2 ? { ...p, amountEur: 'siehe Anlage' } : p)) }],
  ['als 0 geliefert', { ...chimney(), labor35aTotalEur: 20, positions: chimney().positions.map((p, i) => (i === 2 ? { ...p, amountEur: 0 } : p)) }],
  ['ganz weggelassen', { ...chimney(), labor35aTotalEur: 20, positions: chimney().positions.filter((_, i) => i !== 2) }],
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

test('Ein unlesbarer Betrag blockt auch dann, wenn der Abstand nach Umsatzsteuer aussieht', () => {
  // Hier trägt allein die Prüfung, ob jeder Betrag gelesen wurde: Die beiden gelesenen Positionen
  // stehen zum Rechnungsbetrag wie 19 Prozent. Ohne sie käme für die unlesbare Position ein NaN
  // heraus, weil die Hochrechnung nur so viele Werte liefert, wie sie gelesen hat.
  const result = normalizeAmounts({
    totalGrossEur: 238,
    positionsAreNet: true,
    positions: [{ amountEur: 100 }, { amountEur: 100 }, { amountEur: 'siehe Anlage' }],
  })
  assert.deepEqual(positionsOf(result).map((p) => p.amountEur), [100, 100, 'siehe Anlage'])
  assert.equal(result.amountsAdjusted, undefined)
})

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
  // Der Lohnanteil nach §35a gehört zur ganzen Rechnung. Wird er nur auf die Positionen mit
  // Betrag verteilt, bekommen sie den Anteil der übrigen mit dazu. Die Position ohne Betrag
  // übernimmt der Nutzer nicht (sie ist nicht einmal vorgehakt), also stünde am Ende zu viel
  // §35a in der Steuererklärung. Hier trägt allein die Prüfung, ob jeder Betrag gelesen wurde:
  // Die gelesenen Positionen ergeben zusammen genau den Rechnungsbetrag. Ohne sie käme
  // [150, 150, NaN] heraus, und ein NaN landet beim Nutzer im Feld.
  const handwerker = {
    vendor: 'Handwerk Muster',
    totalGrossEur: 600,
    labor35aTotalEur: 300,
    positions: [
      { description: 'Arbeit A', category: 'Nicht umlagefähig', amountEur: 300 },
      { description: 'Arbeit B', category: 'Nicht umlagefähig', amountEur: 'siehe Anlage' },
      { description: 'Arbeit C', category: 'Nicht umlagefähig', amountEur: 300 },
    ],
  }
  const result = normalizeAmounts(handwerker)
  assert.ok(positionsOf(result).every((p) => p.labor35aEur == null))
  assert.equal(result.laborFromTotal, undefined)
})

test('Fehlt eine Position, wird der Lohnanteil nicht verteilt', () => {
  // Dasselbe von der anderen Seite, und hier trägt allein der Abstand: Alle Beträge sind
  // gelesen, aber zusammen decken sie nur zwei Drittel des Rechnungsbetrags ab. So weit reicht
  // keine Umsatzsteuer, also fehlt eine Position, und ihr Lohnanteil ginge an die übrigen.
  const result = normalizeAmounts({
    totalGrossEur: 900,
    labor35aTotalEur: 500,
    positions: [{ amountEur: 300 }, { amountEur: 300 }],
  })
  assert.ok(positionsOf(result).every((p) => p.labor35aEur == null))
  assert.equal(result.laborFromTotal, undefined)
})

test('Der Lohnanteil wird verteilt, wenn der Abstand erklärbar ist', () => {
  // Die Gegenprobe zu den beiden Tests davor, denn ein ausbleibender Lohnanteil kostet den
  // Nutzer bare Steuer. Zwei Fälle, in denen die Positionen vollständig sind, obwohl ihre Summe
  // nicht dem Rechnungsbetrag entspricht.
  //
  // Erstens eine Nettorechnung, bei der das Modell `positionsAreNet` nicht gesetzt hat: Die
  // Positionen bleiben netto, der Abstand ist die Umsatzsteuer.
  const netto = normalizeAmounts({ ...chimney(), positionsAreNet: null, labor35aTotalEur: 20 })
  assert.equal(sum(positionsOf(netto), 'labor35aEur'), cents(20))
  assert.equal(netto.laborFromTotal, true)
  assert.equal(netto.amountsAdjusted, undefined)

  // Zweitens eine Abschlagszahlung: Der Rechnungsbetrag liegt unter der Positionssumme, und das
  // ist kein Zeichen für eine fehlende Position.
  const abschlag = normalizeAmounts({ totalGrossEur: 200, labor35aTotalEur: 100, positions: [{ amountEur: 300 }, { amountEur: 300 }] })
  assert.deepEqual(positionsOf(abschlag).map((p) => p.labor35aEur), [50, 50])
  assert.equal(abschlag.laborFromTotal, true)
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

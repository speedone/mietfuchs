// Rest-Cent und Reihenfolge mit Bedeutung: `compareText` und `largestRemainder`, bis #312 in calc.ts. Hier ohne
// jeden Import, damit die Tilgung (rentAllocation.ts) sie nutzen kann, ohne calc.ts zu importieren: calc.ts importiert
// die Tilgung, und ein Import zurück ergäbe einen ESM-Zyklus. calc.ts reicht beide weiter; wer sie bisher von dort
// nimmt, bleibt dabei.
//
// **Nichts hier darf von der Locale der Laufzeit abhängen** (#70, Begründung bei „Sortieren“ in calc.ts; Wächter in
// calc.test.ts).

// **Trägt die Reihenfolge eine Bedeutung**, wird Zeichen für Zeichen verglichen: der Rest-Cent
// in `largestRemainder`, die Ablesungen und die Staffeln, bei denen sie entscheidet, welcher
// von zwei Einträgen zum selben Stichtag der spätere ist (siehe schedule.ts). Hier wäre eine
// Sprache die falsche Frage: Verglichen werden Kennungen und ISO-Daten, keine Wörter.
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Verteilt totalCents exakt auf die gegebenen (float) Rohanteile (Hare/largest remainder).
// `keys` enthält je Rohanteil eine stabile Kennung (die ID des Mietverhältnisses). Sie
// entscheidet, wer bei gleichem Nachkommaanteil den Rest-Cent bekommt — sonst hinge das an
// der Reihenfolge in der Datei, und dieselben Daten könnten anders abgerechnet werden.
export function largestRemainder(totalCents: number, raws: number[], keys: string[]): number[] {
  if (raws.length === 0) return []
  const floors = raws.map((r) => Math.floor(r))
  let rest = totalCents - floors.reduce((a, b) => a + b, 0)
  const byKey = (i: number, j: number) => compareText(keys[i], keys[j])
  const order = raws
    .map((r, i): [number, number] => [r - Math.floor(r), i])
    .sort((a, b) => b[0] - a[0] || byKey(a[1], b[1]))
  for (let k = 0; rest > 0; k++, rest--) floors[order[k % order.length][1]]++
  for (let k = 0; rest < 0; k++, rest++) floors[order[order.length - 1 - (k % order.length)][1]]--
  return floors
}

// Deutsche Sortierung, fest eingestellt, für Listen, die ein Mensch liest (#70). Zeichenweise verglichen landete „Älter“
// hinter „Zaun“, weil das Ä einen höheren Zeichenwert hat als das Z. Die Sprache steht hier und kommt nicht aus der
// Umgebung. Bis #490 PR 3 nur in server/src/calc.ts; die Oberfläche braucht dieselbe Reihenfolge (Rechnungssteller des
// Vorjahres im Kostenformular), calc.ts reicht sie weiter.
const NAME_COLLATOR = new Intl.Collator('de-DE')

export function compareName(a: string, b: string): number {
  return NAME_COLLATOR.compare(a, b)
}

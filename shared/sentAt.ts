// Ist ein Versanddatum plausibel (#337)? An ihm hängt die Frist nach § 556 Abs. 3 BGB: Ein Datum nach
// heute meldete die Frist als „gewahrt“, obwohl noch nichts versendet ist, und vor dem Ende des
// Abrechnungszeitraums kann keine Abrechnung über ihn hinausgegangen sein. Beide Grenzen gehören
// dazu (inklusiv): der letzte Tag des Zeitraums und heute. Verglichen werden Tage als JJJJ-MM-TT,
// Zeichen für Zeichen, ohne Uhrzeit und Zeitzone. Server und Oberfläche prüfen dieselbe Regel; welcher
// Tag „heute“ ist, reicht der Aufrufer hinein.
export type SentAtProblem = 'future' | 'before-end'

export function sentAtProblem(sentAt: string, periodTo: string, today: string): SentAtProblem | null {
  if (sentAt > today) return 'future'
  if (sentAt < periodTo) return 'before-end'
  return null
}

const germanDate = (date: string): string => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`

export function sentAtProblemText(problem: SentAtProblem, periodTo: string): string {
  return problem === 'future'
    ? 'Das Versanddatum liegt nach heute. Tragen Sie den Tag ein, an dem die Abrechnung an die Mieter ging.'
    : `Das Versanddatum liegt vor dem Ende des Abrechnungszeitraums am ${germanDate(periodTo)}. Tragen Sie den Tag ein, an dem die Abrechnung an die Mieter ging.`
}

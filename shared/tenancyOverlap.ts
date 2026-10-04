// Überschneidende Mietverhältnisse einer Wohnung (#204). Ein Tippfehler beim Datum (Auszug am
// 30.09. eingetragen, Nachmieter ab 01.09.) lässt zwei Mietverhältnisse derselben Wohnung zugleich
// bestehen, und dann trägt für diese Zeit jeder der beiden seinen vollen Anteil. Die Regel, wann
// sich zwei Mietverhältnisse überschneiden, steht hier einmal: Der Server meldet es in der
// Abrechnung (calc.ts), die Oberfläche fragt beim Speichern nach (client/src/tenancyModel.ts).
//
// Zeiträume sind ISO-Daten (JJJJ-MM-TT) mit inklusiven Grenzen, `end: null` heißt offen, wie
// überall in der Berechnung. Verglichen wird Zeichen für Zeichen (ein ISO-Datum sortiert so
// richtig), nie mit der Locale oder der Zeitzone der Laufzeit; dieselben Daten ergeben auf jedem
// Rechner dasselbe.

export type Period = { start: string, end: string | null }
export type CommonPeriod = { from: string, to: string | null }

// Der gemeinsame Zeitraum zweier Zeiträume, oder null, wenn sie keinen Tag gemeinsam haben. Ein
// Auszug am 30.09. und ein Einzug am 01.10. sind lückenlos und überschneiden sich nicht; ein Einzug
// am 30.09. teilt mit dem Auszug am selben Tag einen Tag.
export function commonPeriod(a: Period, b: Period): CommonPeriod | null {
  const from = a.start > b.start ? a.start : b.start
  const to = a.end === null ? b.end : b.end === null ? a.end : a.end < b.end ? a.end : b.end
  if (to !== null && to < from) return null
  return { from, to }
}

type Tenancyish = Period & { id: string, unitId: string }
export type TenancyOverlap<T> = CommonPeriod & { first: T, second: T }

// Früher eingezogen zuerst, bei gleichem Einzug nach Kennung: eine feste Reihenfolge, damit die
// Meldung auf jedem Rechner dieselbe ist.
const byStart = (a: Tenancyish, b: Tenancyish): number =>
  a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

// Alle Paare von Mietverhältnissen derselben Wohnung, die sich überschneiden, jedes Paar einmal,
// das früher eingezogene als `first`.
export function tenancyOverlaps<T extends Tenancyish>(tenancies: readonly T[]): TenancyOverlap<T>[] {
  const sorted = tenancies.slice().sort(byStart)
  const found: TenancyOverlap<T>[] = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const first = sorted[i]
      const second = sorted[j]
      if (!first || !second || first.unitId !== second.unitId) continue
      const common = commonPeriod(first, second)
      if (common) found.push({ ...common, first, second })
    }
  }
  return found
}

// Die Mietverhältnisse, mit denen ein Kandidat aus dem Formular sich überschneiden würde. Beim
// Bearbeiten trägt er seine Kennung und zählt nicht gegen sich selbst.
export function overlapsOf<T extends Tenancyish>(
  candidate: Period & { id?: string | null, unitId: string }, tenancies: readonly T[],
): (CommonPeriod & { other: T })[] {
  return tenancies
    .filter((t) => t.unitId === candidate.unitId && t.id !== candidate.id)
    .slice()
    .sort(byStart)
    .flatMap((other) => {
      const common = commonPeriod(candidate, other)
      return common ? [{ ...common, other }] : []
    })
}

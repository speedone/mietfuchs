// Kopf und Fuß der Abrechnung eines Mieters (#142), ohne DOM prüfbar. Gerechnet wird hier nichts:
// Die Zahlen stammen aus der Abrechnung, die Staffel des Mietverhältnisses liefert nur die Worte.

import type { Statement, Tenancy } from './types'

const DAY = 86400000
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const overlapDays = (from: string, to: string | null, pFrom: string, pTo: string): number => {
  const a = Math.max(utc(from), utc(pFrom))
  const b = Math.min(to ? utc(to) : Infinity, utc(pTo))
  return b < a ? 0 : Math.round((b - a) / DAY) + 1
}

// Die Stufen der Personen-Staffel im Zeitraum der Abrechnung, wie calc.ts sie liest: Die erste
// gilt ab Einzug, jede weitere ab ihrem Stichtag bis zum Tag vor der nächsten.
function levelsInPeriod(t: Tenancy, from: string, to: string): { persons: number, days: number }[] {
  const h = (t.personHistory?.length ? t.personHistory : [{ from: t.start, persons: t.persons }])
    .slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const levels: { persons: number, days: number }[] = []
  for (let i = 0; i < h.length; i++) {
    const entry = h[i]
    if (!entry) continue
    const next = h[i + 1]
    const segStart = i === 0 ? t.start : entry.from
    let segEnd: string | null = next ? new Date(utc(next.from) - DAY).toISOString().slice(0, 10) : null
    if (t.end && (!segEnd || segEnd > t.end)) segEnd = t.end
    const days = overlapDays(segStart, segEnd, from, to)
    if (days > 0) levels.push({ persons: entry.persons, days })
  }
  return levels
}

// Die Personen in der Kopfzeile. Wechselt die Zahl im Jahr, nannte die Zeile bisher nur den
// letzten Stand („2 Personen“, obwohl bis 30.09. eine Person); gerechnet wurde mit
// Personentagen. Der Bereich kommt aus der Staffel des Mietverhältnisses, aber nur, wenn sie
// dieselben Personentage ergibt wie die Abrechnung: Eine eingefrorene Abrechnung bleibt, was sie
// war, auch wenn die Staffel seither geändert wurde.
export function personsText(st: Statement, tenancy: Tenancy | undefined): string {
  const simple = `${st.persons} ${st.persons === 1 ? 'Person' : 'Personen'}`
  if (typeof st.personDays !== 'number' || st.personDays === st.persons * st.days) return simple
  if (tenancy) {
    const levels = levelsInPeriod(tenancy, st.periodStart, st.periodEnd)
    const sum = levels.reduce((a, l) => a + l.persons * l.days, 0)
    if (levels.length > 0 && sum === st.personDays) {
      const min = Math.min(...levels.map((l) => l.persons))
      const max = Math.max(...levels.map((l) => l.persons))
      if (min !== max) return `${min} bis ${max} Personen (${st.personDays} Personentage)`
    }
  }
  return `${st.personDays} Personentage, zuletzt ${simple}`
}

// Welche Kosten die Abrechnung enthält. Vorher stand hier „nach dem Abflussprinzip (im
// Abrechnungsjahr gezahlte Rechnungen)“, und das traf nicht zu: Eine Kostenposition trägt das
// Abrechnungsjahr, kein Zahlungsdatum, und die Kosten aus einer Hausgeldabrechnung folgen meist
// dem Leistungsjahr. Der Satz entsteht in der Oberfläche und steckt nicht im eingefrorenen Stand.
// Welche Kosten die Abrechnung enthält (#208): die des Abrechnungsjahres oder -zeitraums.
export function costBasisText(label: string, calendar = true): string {
  return `Abgerechnet werden die Kosten des ${calendar ? 'Abrechnungsjahres' : 'Abrechnungszeitraums'} ${label}.`
}

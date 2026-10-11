// Monate für die monatliche Verbrauchsinformation (Heizung PR 22): Namen, Grenzen, Spannen. Gemeinsam für
// Server (Hinweistexte) und Oberfläche (Karte, Blatt). Gerechnet wird aus der Zeichenkette ('JJJJ-MM') und
// in UTC, wie überall in Mietfuchs, damit keine Zeitzone einen Tag verschiebt.

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

const parts = (month: string): [number, number] => [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
const fmt = (y: number, m: number): string => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`

// „November 2025“.
export function monthName(month: string): string {
  const [y, m] = parts(month)
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`
}

export function addMonths(month: string, n: number): string {
  const [y, m] = parts(month)
  const index = y * 12 + (m - 1) + n
  return fmt(Math.floor(index / 12), (index % 12) + 1)
}

// Erster und letzter Tag eines Monats.
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = parts(month)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

// Alle Monate, die die Tage von `from` bis `to` (einschließlich) berühren.
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) out.push(m)
  return out
}

// „Januar bis März 2025, Mai 2025“: aufeinanderfolgende Monate zu einer Spanne, jeder Monat einmal.
export function monthRanges(months: readonly string[]): string {
  const sorted = [...new Set(months)].sort()
  const runs: [string, string][] = []
  for (const m of sorted) {
    const last = runs.at(-1)
    if (last && addMonths(last[1], 1) === m) last[1] = m
    else runs.push([m, m])
  }
  return runs.map(([a, b]) => {
    if (a === b) return monthName(a)
    const [ya, ma] = parts(a)
    return ya === parts(b)[0] ? `${MONTH_NAMES[ma - 1]} bis ${monthName(b)}` : `${monthName(a)} bis ${monthName(b)}`
  }).join(', ')
}

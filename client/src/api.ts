import { parseNumberDe } from './numbers'
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers =
    init?.body && !(init.body instanceof FormData)
      ? { 'Content-Type': 'application/json', ...init?.headers }
      : init?.headers
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// Der Satz zu einem gescheiterten Abruf, für die Oberfläche (#146). api() wirft die Meldung des
// Servers als Error; alles andere (Netz weg) kommt ebenfalls lesbar heraus.
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const fmtEuro = (cents: number) =>
  (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

// Eine Wohnfläche mit ihrer Einheit. Zwei Nachkommastellen, wie Wohnflächen üblicherweise
// angegeben werden; eine Vorschrift über die Genauigkeit gibt es nicht.
export const fmtArea = (m2: number) =>
  `${m2.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²`

// Akzeptiert deutsche ("1.234,56") und technische ("1234.56") Schreibweise
// Geld liest derselbe Leser wie Mengen (numbers.ts): „1.240“ sind 1.240 € und nicht 1,24 €, und
// ein Tippfehler wie „78.43,5“ wird abgelehnt statt still falsch gelesen. Vorher galt für Geld eine
// eigene, lockerere Regel, und bei Einzelbeträgen landete ein falsch gelesener Betrag unbemerkt
// beim Vermieter (zweite Integrationsdurchsicht zu #105).
export function parseEuro(s: string): number | null {
  const n = parseNumberDe(s.replace(/€/g, ''))
  return n === null ? null : Math.round(n * 100)
}

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

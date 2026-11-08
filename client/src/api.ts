import { parseNumberDe } from './numbers'
import { appFetch } from './access'
// Eine Ablehnung des Servers mit Status und Rumpf (#170): Die Buchung braucht bei 409 den Stand
// oder die neue Vorschau aus der Antwort, nicht nur die Meldung. Für alle anderen Aufrufer bleibt
// es ein `Error` mit derselben Meldung wie bisher.
export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message)
    this.status = status
    this.data = data
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers =
    init?.body && !(init.body instanceof FormData)
      ? { 'Content-Type': 'application/json', ...init?.headers }
      : init?.headers
  // Über appFetch: Verlangt der Server eine Anmeldung, meldet es das Ereignis für den Anmeldedialog (#528)
  const res = await appFetch(path, { ...init, headers })
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}))
    const data: Record<string, unknown> = raw !== null && typeof raw === 'object' ? { ...raw } : {}
    const message = typeof data.error === 'string' && data.error ? data.error : `${res.status} ${res.statusText}`
    throw new ApiError(message, res.status, data)
  }
  return res.json() as Promise<T>
}

// Der Satz zu einem gescheiterten Abruf, für die Oberfläche (#146). api() wirft die Meldung des
// Servers als Error; alles andere (Netz weg) kommt ebenfalls lesbar heraus.
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// Der Satz zu einem gescheiterten Laden einer Seite: Verlangt der Server eine Anmeldung (#528), ist der Server erreichbar,
// und es gilt sein Satz; der Anmeldedialog steht dann schon da, und nach der Anmeldung lädt die Seite neu. Sonst `offline`.
export const loadErrorText = (e: unknown, offline: string): string =>
  e instanceof ApiError && e.status === 401 ? e.message : offline

// Seit der Belegbuchung (#170) in shared/costItem.ts, weil der Server denselben Betrag ausschreibt.
export { euro as fmtEuro } from '../../shared/costItem.ts'

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

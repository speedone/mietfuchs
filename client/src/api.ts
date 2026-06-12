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

export const fmtEuro = (cents: number) =>
  (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

// Akzeptiert deutsche ("1.234,56") und technische ("1234.56") Schreibweise
export function parseEuro(s: string): number | null {
  const t = s.trim().replace(/€|\s/g, '')
  if (!t) return null
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(norm)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

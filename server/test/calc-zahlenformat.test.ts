// Zahlenformat des Rechenwegs (Leistungsprüfung, Befund 3): Die Formate werden einmal als Intl.NumberFormat
// angelegt statt je Zahl über `toLocaleString`, das jedes Mal ein neues Intl-Objekt baut. Die Ausgabe muss
// Zeichen für Zeichen gleich bleiben; verglichen wird hier mit dem früheren Aufruf, über feste Grenzfälle und
// zufällige Werte mit festem Startwert. Ebenso das Zerlegen der Datumstexte mit Zwischenspeicher (`toUTC`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STEP_FORMATS, toUTC } from '../src/calc.ts'
import { rngOf } from '../testing/revertFlows.ts'

// Die früheren Fassungen, wörtlich
const OLD: Record<keyof typeof STEP_FORMATS, (n: number) => string> = {
  fmtNum: (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 }),
  fmtPercent: (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 6 }),
  fmtExactEuro: (cents) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`,
  fmtCents: (cents) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`,
  fmtMeter: (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 }),
  fmtKg: (kg) => kg.toLocaleString('de-DE', { maximumFractionDigits: 2 }),
  fmtPermille: (pm) => (Math.round(pm * 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  // Menge des Vorrats und Heizwert (Durchsicht von PR #449, K4)
  fmtQuantity: (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 }),
  fmtPlain: (n) => n.toLocaleString('de-DE'),
}

const EDGES = [
  0, -0, 1, -1, 0.5, 0.005, 0.0049999, 0.015, 0.125, 0.1 + 0.2, 1 / 3, 2 / 3, -1 / 3, 12.345, 12.3449999, 999.995, 1000, 1234.5,
  -1234.5, 99999.995, 1234567.891, 33.333333333, 100, 16.666666667, 1e-7, 123456789012, -0.004, 2.5, 3.5, -2.5, 0.0000005, 0.0000015,
  Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, Infinity, -Infinity, NaN,
]

test('Zahlenformat des Rechenwegs: zeichengleich mit toLocaleString, für Grenzfälle und Zufallswerte', () => {
  const rng = rngOf(20261024)
  const values = [...EDGES]
  for (let i = 0; i < 1500; i++) {
    const magnitude = 10 ** Math.floor(rng() * 9 - 3)
    const sign = rng() < 0.2 ? -1 : 1
    values.push(sign * rng() * magnitude)
    // Cent-Beträge und Anteile, wie sie in der Rechnung entstehen
    values.push(Math.round(sign * rng() * 5_000_000))
    values.push((Math.round(rng() * 1_000_000) / 7) * sign)
  }
  for (const [name, format] of Object.entries(STEP_FORMATS) as [keyof typeof STEP_FORMATS, (n: number) => string][]) {
    for (const v of values) assert.equal(format(v), OLD[name](v), `${name}(${v})`)
  }
})

test('toUTC mit Zwischenspeicher: gleiche Zahl wie Date.UTC, auch wiederholt und für Ungültiges', () => {
  const old = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y as number, (m as number) - 1, d as number)
  }
  const rng = rngOf(7)
  const dates = ['2024-02-29', '2025-02-29', '2025-12-31', '2026-01-01', '1970-01-01', '0099-05-05', '2025-1-5', '', 'kein Datum', '2025-07-01T00:00:00.000Z', '2025-13-01']
  for (let i = 0; i < 3000; i++) {
    const y = 2000 + Math.floor(rng() * 40)
    const m = 1 + Math.floor(rng() * 12)
    const d = 1 + Math.floor(rng() * 31)
    dates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  for (let round = 0; round < 3; round++) {
    for (const iso of dates) assert.ok(Object.is(toUTC(iso), old(iso)), `toUTC(${JSON.stringify(iso)})`)
  }
})

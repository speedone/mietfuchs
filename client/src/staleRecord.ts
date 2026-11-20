import { useEffect, useRef } from 'react'
import { ApiError } from './api'

// Zwei Fenster bearbeiten denselben Datensatz (zwei Tabs, Handy und Rechner im Heimnetz): Das Formular schickt beim
// Speichern den Datensatz mit, wie es ihn beim Öffnen geladen hat (`ifUnchanged`), und der Server lehnt mit 409 und
// `stale` ab, wenn er dem gespeicherten nicht mehr gleicht (server/src/db/repository.ts, `requireUnchanged`). Ohne die
// Angabe gälte der letzte, und das zweite Fenster schriebe still den Stand von vorher zurück.
//
// **Mitgeschickt wird der Stand vom Öffnen des Formulars**, nicht der aus der Liste beim Speichern: Lädt die Seite die
// Liste neu, während das Formular offen ist, kennt das Formular den neuen Stand trotzdem nicht.

/**
 * Der Datensatz, wie er beim Öffnen des Formulars in der Liste stand: gemerkt, sobald das Formular einen anderen Datensatz
 * zeigt (`id`), nicht bei jeder neu geladenen Liste. Ohne `id` (neu anlegen) keiner.
 */
export function useSeenRecord<T extends { id: string }>(id: string | undefined, list: readonly T[]): { readonly current: T | undefined } {
  const seen = useRef<T | undefined>(undefined)
  const listRef = useRef(list)
  listRef.current = list
  useEffect(() => {
    seen.current = id ? listRef.current.find((x) => x.id === id) : undefined
  }, [id])
  return seen
}

/** Der Zusatz für den Rumpf; ohne gemerkten Stand (neu angelegt, Liste noch nicht da) nichts, dann gilt das Bisherige. */
export const ifUnchanged = (seen: object | null | undefined): { ifUnchanged?: object } => (seen ? { ifUnchanged: seen } : {})

export const isStale = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 409 && e.data.stale === true

/** Beschriftung je Feld, wahlweise mit dem Wert von jetzt in Klammern (`now`). */
export type StaleFields = Record<string, string | { label: string; now: (value: unknown) => string | null }>

// Was die Listen dazusetzen, ohne dass es gespeichert ist (wie `VIEW_ONLY` im Server).
const VIEW_ONLY = new Set(['year', 'fromDeposit', 'fromBank'])
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : null)

/** Die geänderten Angaben in der Reihenfolge von `fields`, danach „weitere Angaben“ für alles ohne Beschriftung. */
export function changedFields(seen: object | null | undefined, current: unknown, fields: StaleFields): string[] {
  const before = record(seen)
  const now = record(current)
  if (!before || !now) return []
  const named = Object.entries(fields).flatMap(([key, field]) => {
    if (same(before[key], now[key])) return []
    if (typeof field === 'string') return [field]
    const value = field.now(now[key])
    return [value === null ? field.label : `${field.label} (jetzt ${value})`]
  })
  const others = [...new Set([...Object.keys(before), ...Object.keys(now)])]
    .some((key) => !(key in fields) && !VIEW_ONLY.has(key) && !same(before[key], now[key]))
  return others ? [...named, 'weitere Angaben'] : named
}

/**
 * Der Satz für den Fuß des Seitenfensters: der des Servers, dazu was sich geändert hat und dass die Eingabe stehen bleibt.
 * `null`, wenn die Ablehnung keine solche ist; dann gilt die Meldung wie bisher.
 */
export function staleText(e: unknown, seen: object | null | undefined, fields: StaleFields): string | null {
  if (!isStale(e)) return null
  const changed = changedFields(seen, e.data.current, fields)
  return `${e.message}${changed.length > 0 ? ` Inzwischen geändert: ${changed.join(', ')}.` : ''} Ihre Eingabe bleibt stehen, bis Sie das Formular schließen.`
}

import { useEffect, useRef } from 'react'
import { api } from './api'
import { changedFields, isStale, sameRecord, type StaleFields } from './staleRecord'
import { formatIban, sameIban } from '../../shared/iban.ts'
import { asBrowserId, BROWSER_LABELS } from '../../shared/browsers.ts'

// Zwei Fenster, dieselben Einstellungen (staleRecord.ts für Datensätze mit Kennung). Die Einstellungen sind eine Zeile,
// in die mehrere Karten je ihren Teil schreiben, und ihre Antwort ist angereichert (`fixedByEnv`, `aiKeys`, wirksame
// KI-Werte). **Eine Karte schickt deshalb als `ifUnchanged` nur die Schlüssel mit, die sie selbst schreibt**, so wie
// der Server sie ausgeliefert hat (nicht wie das Formular sie zeigt: Eine Vorgabe des Formulars wie „30 Tage“ oder
// „aus“ gliche dem gespeicherten „nichts“ nicht, und der Server lehnte im selben Fenster zu Unrecht ab). Der Server
// vergleicht nur diese Schlüssel (`seenPartChanged` in server/src/db/repository.ts); was eine andere Karte schreibt,
// stört nicht. Gemerkt wird der Stand, aus dem das Formular gefüllt wurde, und nach dem eigenen Speichern der aus der
// Antwort.

/** Die genannten Schlüssel, wie geladen; Fehlendes als `null`, damit der Schlüssel im Rumpf steht und verglichen wird. */
export function seenPart<K extends string>(from: object | null | undefined, keys: readonly K[]): Record<K, unknown> {
  const source: Record<string, unknown> = { ...from }
  const part: Record<string, unknown> = {}
  for (const key of keys) part[key] = source[key] ?? null
  return part as Record<K, unknown>
}

// Der Wert von jetzt in der Meldung: Text in Anführungszeichen, Leeres als Wort.
const quoted = (value: unknown): string => (typeof value === 'string' && value.trim() !== '' ? `„${value.trim()}“` : 'leer')
const ibanText = (value: unknown): string => (typeof value === 'string' && value.trim() !== '' ? formatIban(value) : 'leer')
const onOff = (value: unknown): string => (value === true ? 'ein' : 'aus')
const numberOr = (unit: string) => (value: unknown): string => (typeof value === 'number' ? `${value}${unit}` : 'Standard')

export const LANDLORD_KEYS = ['landlordName', 'iban', 'paymentDeadlineDays', 'landlordAddress', 'landlordContact'] as const
export type LandlordKey = typeof LANDLORD_KEYS[number]
export const LANDLORD_LABELS: Record<LandlordKey, string> = {
  landlordName: 'Name des Vermieters', iban: 'IBAN', paymentDeadlineDays: 'Zahlungsfrist', landlordAddress: 'Anschrift', landlordContact: 'Kontakt',
}
export const LANDLORD_STALE_FIELDS: StaleFields = {
  landlordName: { label: LANDLORD_LABELS.landlordName, now: quoted },
  iban: { label: LANDLORD_LABELS.iban, now: ibanText },
  paymentDeadlineDays: { label: LANDLORD_LABELS.paymentDeadlineDays, now: (v) => (typeof v === 'number' ? `${v} Tage` : null) },
  landlordAddress: { label: LANDLORD_LABELS.landlordAddress, now: quoted },
  landlordContact: { label: LANDLORD_LABELS.landlordContact, now: quoted },
}
// Was der Brief zusammen druckt und deshalb nur zusammen stimmt: Kontoinhaber und IBAN in der Zahlungsaufforderung und
// im QR-Code (shared/letter.ts, `Vermieter` und `IBAN`), Name und Anschrift in Absender und Rücksendeangabe. Eine BIC
// gibt es nicht. Hat ein anderes Fenster eine Angabe einer Gruppe geändert und dieses eine andere, gilt die Gruppe als
// von beiden geändert (`mergeStale`), sonst stünde nach dem Speichern ein Inhaber neben einer IBAN, die niemand so
// eingegeben hat.
export const LANDLORD_GROUPS: readonly (readonly LandlordKey[])[] = [['landlordName', 'iban'], ['landlordName', 'landlordAddress']]
/** Die Zahlungsfrist, wie „Speichern“ sie schickt: leer oder unlesbar sind 30 Tage. */
export const deadlineDays = (input: string): number => Math.max(1, Number(input) || 30)
/** Gilt die Eingabe als dieselbe? Vierergruppen der IBAN, Leerraum am Rand und eine leere Zahlungsfrist sind keine Änderung. */
export function sameLandlordInput(key: string, a: string, b: string): boolean {
  if (key === 'iban') return sameIban(a, b)
  if (key === 'paymentDeadlineDays') return deadlineDays(a) === deadlineDays(b)
  return a.trim() === b.trim()
}

export const PRINT_KEYS = ['printFoldMarks', 'printAttachments', 'printFooter', 'printPaymentQr'] as const
export const PRINT_STALE_FIELDS: StaleFields = {
  printFoldMarks: { label: 'Falz- und Lochmarken', now: onOff },
  printAttachments: { label: 'Belegkopien', now: onOff },
  printFooter: { label: 'Fußzeile mit Kontakt und Bank', now: onOff },
  printPaymentQr: { label: 'QR-Code zum Bezahlen', now: onOff },
}

// „Mietfuchs öffnen mit“ (#735, Karte „Beim Start“): die Kennung eines Browsers, ohne Wert der Standardbrowser.
export const BROWSER_KEYS = ['openWith'] as const
export const BROWSER_STALE_FIELDS: StaleFields = {
  openWith: { label: 'Mietfuchs öffnen mit', now: (v) => { const id = asBrowserId(v); return id ? BROWSER_LABELS[id] : 'Standardbrowser' } },
}

// Die KI-Belegauswertung: alles, was die Karte schreibt. `consent` ändert nur die eigene Route, die API-Schlüssel stehen
// gar nicht in den Einstellungen (und kämen nie im Klartext in eine Meldung).
export const AI_KEYS = ['text', 'images', 'timeoutSeconds', 'numCtx', 'maxOutputTokens', 'pageImageEdge', 'jsonMode', 'reasoningEffort', 'extraInstructions'] as const
const slotText = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return 'aus'
  const slot: Record<string, unknown> = { ...value }
  return `Modell ${quoted(slot.model)}, Adresse ${quoted(slot.url)}`
}
export const AI_STALE_FIELDS: StaleFields = {
  text: { label: 'Standard-Anbieter', now: slotText },
  images: { label: 'Anbieter für Fotos und Scans', now: slotText },
  timeoutSeconds: { label: 'Zeitlimit je Schritt', now: numberOr(' Sekunden') },
  numCtx: { label: 'Kontext', now: numberOr(' Token') },
  maxOutputTokens: { label: 'Länge der Antwort', now: numberOr(' Token') },
  pageImageEdge: { label: 'Seitenbilder eines Scans', now: numberOr(' Bildpunkte') },
  jsonMode: { label: 'JSON-Stufe', now: (v) => (typeof v === 'string' ? v : null) },
  reasoningEffort: { label: 'Denkaufwand', now: (v) => (typeof v === 'string' && v !== '' ? v : 'Standard') },
  extraInstructions: { label: 'Zusätzliche Hinweise an das Modell', now: quoted },
}

/** Der Stand von jetzt aus der Ablehnung des Servers (`current`), sonst `null`. */
export function staleCurrent(e: unknown): Record<string, unknown> | null {
  if (!isStale(e)) return null
  const current = e.data.current
  return current !== null && typeof current === 'object' && !Array.isArray(current) ? { ...current } : null
}

/**
 * Der Satz zur Ablehnung: der des Servers, was sich an den Schlüsseln der Karte geändert hat (mit dem Wert von jetzt,
 * wo `fields` ihn nennt), und `then`, wie es weitergeht. `null`, wenn die Ablehnung keine solche ist.
 */
export function settingsStaleText(e: unknown, seen: Record<string, unknown> | null | undefined, fields: StaleFields, then: string, current: Record<string, unknown> | null = staleCurrent(e)): string | null {
  if (!isStale(e)) return null
  const changed = seen ? changedFields(seen, seenPart(current, Object.keys(seen)), fields) : []
  return `${e.message}${changed.length > 0 ? ` Inzwischen geändert: ${changed.join(', ')}.` : ''} ${then}`
}

/**
 * Nach einer Ablehnung führt ein Formular in einer Karte den Stand von jetzt mit der eigenen Eingabe zusammen (eine
 * Karte hat kein „schließen und erneut öffnen“ wie ein Seitenfenster). `shown` ist das Formular, `before` das Formular
 * aus dem gesehenen Stand, `now` das aus dem Stand von jetzt; `same` sagt, was als dieselbe Eingabe gilt.
 *
 * - Ein Feld, das hier nicht geändert wurde, zeigt den Stand von jetzt.
 * - Ein Feld, das nur hier geändert wurde, behält die Eingabe.
 * - **Ein Feld, das beide geändert haben, und jede Gruppe, in der beide etwas geändert haben** (`groups`), steht in
 *   `conflicts`: Darüber entscheidet der Nutzer, bevor wieder gespeichert wird. Die eigene Eingabe bleibt stehen, ein
 *   Feld der Gruppe, das nur dort geändert wurde, zeigt den Wert von dort (nie den alten). Gruppen mit gemeinsamem Feld
 *   bilden eine Einheit. Haben beide dasselbe eingegeben, ist es keine. `theirs` nennt, was dort geändert wurde.
 */
export type StaleMerge<T> = { form: T; conflicts: (keyof T & string)[][]; theirs: (keyof T & string)[] }
export function mergeStale<T extends Record<string, string>>(
  shown: T, before: T, now: T,
  options: { same?: (key: string, a: string, b: string) => boolean; groups?: readonly (readonly (keyof T & string)[])[] } = {},
): StaleMerge<T> {
  type K = keyof T & string
  const same = options.same ?? ((_key: string, a: string, b: string) => a === b)
  const keys = Object.keys(shown) as K[]
  const eq = (key: K, a: T, b: T): boolean => same(key, a[key] ?? '', b[key] ?? '')
  const mine = keys.filter((key) => !eq(key, shown, before))
  const theirs = keys.filter((key) => !eq(key, now, before))
  // Die eigene Änderung zählt nur, wo sie vom Stand von jetzt abweicht.
  const own = mine.filter((key) => !eq(key, shown, now))
  const units: K[][] = []
  const join = (members: readonly K[]): void => {
    const touching = units.filter((unit) => unit.some((key) => members.includes(key)))
    for (const unit of touching) units.splice(units.indexOf(unit), 1)
    const all = new Set<K>([...touching.flat(), ...members])
    units.push(keys.filter((key) => all.has(key)))
  }
  const isHeld = (key: K): boolean => units.some((unit) => unit.includes(key))
  for (const key of own) if (theirs.includes(key)) join([key])
  // Eine Gruppe gilt als von beiden geändert, wenn dort etwas an ihr geändert wurde und hier etwas an ihr geändert ist
  // oder schon zur Entscheidung steht (über ein gemeinsames Feld wie den Namen); so lange, bis nichts mehr dazukommt.
  for (let grew = true; grew;) {
    grew = false
    for (const group of options.groups ?? []) {
      if (group.every(isHeld) && units.some((unit) => group.every((key) => unit.includes(key)))) continue
      if (group.some((key) => theirs.includes(key)) && group.some((key) => own.includes(key) || isHeld(key))) {
        join(group)
        grew = true
      }
    }
  }
  // Was hier nicht geändert wurde, zeigt den Stand von jetzt, **auch in einer Gruppe zur Entscheidung** (Durchsicht S1):
  // Sonst stünde dort der alte Wert eines Felds, das nur anderswo geändert wurde, und „Meine Eingabe behalten“ setzte
  // die Änderung von dort still zurück. Zur Wahl steht also nur die eigene Eingabe gegen den Stand von dort.
  const form: Record<string, string> = { ...shown }
  for (const key of keys) if (!mine.includes(key)) form[key] = now[key] ?? ''
  // Zu entscheiden ist eine Einheit, solange hier etwas anders steht als dort.
  const conflicts = units.filter((unit) => unit.some((key) => !same(key, form[key] ?? '', now[key] ?? '')))
  return { form: form as T, conflicts, theirs }
}

/** Wie `mergeStale` ohne Rückfrage, für beliebige Werte: Was hier nicht geändert wurde, zeigt den Stand von jetzt. */
export function keepOwnValues<T extends Record<string, unknown>>(shown: T, before: Record<string, unknown>, now: Record<string, unknown>, keys: readonly (keyof T & string)[]): T {
  const next: Record<string, unknown> = { ...shown }
  for (const key of keys) if (sameRecord({ v: shown[key] }, { v: before[key] })) next[key] = now[key] ?? null
  return next as T
}

// Eine Antwort von `GET /api/settings` trägt immer `fixedByEnv`; alles andere (ältere Fassung, Attrappe) zählt nicht.
const isSettings = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && 'fixedByEnv' in value && Array.isArray(value.fixedByEnv)

/**
 * Die Einstellungen hält die App und lädt sie nicht bei jedem Seitenwechsel neu: Ein Tab im Hintergrund füllte sein
 * Formular sonst aus einem alten Stand und bekäme beim ersten Speichern eine Ablehnung. Beim Öffnen (`when`) fragt die
 * Seite deshalb den Stand von jetzt; weicht er an ihren Schlüsseln ab, lädt die App neu (`reload`), und das Formular
 * übernimmt ihn, solange darin nichts geändert ist (die Karte selbst, über den neuen Wert von `settings`).
 */
export function useFreshSettings(settings: object | null | undefined, keys: readonly string[], reload: () => Promise<unknown>, when = true): void {
  const latest = useRef({ settings, reload })
  latest.current = { settings, reload }
  const keyList = keys.join(',')
  useEffect(() => {
    if (!when) return
    let alive = true
    // Neu geladen wird nur, wenn der Stand von jetzt weder dem beim Öffnen noch dem gleicht, den die App inzwischen
    // liefert (sie kann während der Anfrage selbst neu geladen haben).
    const opened = latest.current.settings
    api<unknown>('/api/settings').then((fresh) => {
      const known = latest.current.settings
      if (!alive || !known || !isSettings(fresh)) return
      const part = keyList.split(',')
      const differs = (from: object | null | undefined) => !sameRecord(seenPart(fresh, part), seenPart(from, part))
      if (differs(opened) && differs(known)) latest.current.reload().catch(() => { /* dann bleibt der Stand der App */ })
    }, () => { /* ohne Antwort bleibt der Stand der App */ })
    return () => { alive = false }
  }, [when, keyList])
}

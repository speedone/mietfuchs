// Entwurf, Speichern, Verwerfen (#309): die Logik hinter `useDraft` (useDraft.ts), ohne React und
// ohne DOM, damit sie sich für sich prüfen lässt.
//
// Die Regel dahinter: Sofort speichern darf nur, was keine Daten ändert, also der Wechsel von
// Zeitraum, Objekt oder Design und die Antwort auf die Frage nach der Update-Prüfung im Cockpit.
// Alles andere zeigt die Änderung zunächst als Entwurf, und erst „Speichern“ schickt sie an den
// Server; „Verwerfen“ stellt den gespeicherten Wert her. Wer sich verklickt, hat so nichts verändert.

// Gleich im Sinn eines Entwurfs: gleiche Werte, bei Listen und einfachen Objekten Stück für Stück.
// Ein fehlender Schlüssel und einer mit `undefined` gelten als gleich, denn ein Formular setzt ein
// leeres Feld oft so und oft so, und „geändert“ wäre dann eine Behauptung ohne Änderung.
export function sameDraft(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameDraft(x, b[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const k of keys) if (!sameDraft(ra[k], rb[k])) return false
  return true
}

// Der Zustand eines Entwurfs. `prop` ist der zuletzt von außen gereichte gespeicherte Wert, `base`
// der Wert, gegen den verglichen wird (nach einem gelungenen Speichern der eben gespeicherte, bis
// die Seite neu geladen hat), `edit` die Änderung oder `null`, wenn es keine gibt.
export type DraftState<T> = {
  prop: T
  base: T
  edit: { value: T } | null
  scope: unknown
}

export function initialDraft<T>(saved: T, scope?: unknown): DraftState<T> {
  return { prop: saved, base: saved, edit: null, scope }
}

// Was das Feld zeigt.
export function shownValue<T>(s: DraftState<T>): T {
  return s.edit ? s.edit.value : s.base
}

export function isDirty<T>(s: DraftState<T>): boolean {
  return s.edit !== null
}

// Eine Eingabe. Wer zum gespeicherten Wert zurückkehrt, hat keinen Entwurf mehr.
export function withEdit<T>(s: DraftState<T>, value: T): DraftState<T> {
  return { ...s, edit: sameDraft(value, s.base) ? null : { value } }
}

export function discarded<T>(s: DraftState<T>): DraftState<T> {
  return { ...s, edit: null }
}

// Gespeichert ist `value`. `propBefore` ist der gespeicherte Wert von außen beim Beginn des
// Speicherns. Hat die Seite seitdem neu geladen, gilt ihr Stand (der Server kann den Wert
// geradegerückt haben); sonst ist `value` der Vergleichswert, bis sie lädt. Ohne diesen Schritt
// sprünge das Feld zwischen Speichern und Neuladen kurz auf den alten Wert.
export function afterSave<T>(s: DraftState<T>, value: T, propBefore: T): DraftState<T> {
  const base = sameDraft(s.prop, propBefore) ? value : s.prop
  // Wurde während des Speicherns weiter geändert, bleibt diese Änderung ein Entwurf.
  const later = s.edit && !sameDraft(s.edit.value, value) && !sameDraft(s.edit.value, base) ? s.edit : null
  return { ...s, base, edit: later }
}

// Ein neuer gespeicherter Wert von außen (die Seite hat neu geladen). Ohne Entwurf zeigt das Feld
// ihn. Mit Entwurf bleibt der Entwurf stehen, denn er ist das, was der Nutzer gerade eingibt; gleicht
// er dem neuen Wert, ist er erledigt. Ein anderer `scope` (ein anderes Dokument, etwa eine andere
// Abrechnung auf derselben Seite) verwirft den Entwurf: Er gehörte zu etwas anderem.
export function withSaved<T>(s: DraftState<T>, saved: T, scope?: unknown): DraftState<T> {
  if (!Object.is(scope, s.scope)) return initialDraft(saved, scope)
  if (sameDraft(saved, s.prop)) return s
  const edit = s.edit && !sameDraft(s.edit.value, saved) ? s.edit : null
  return { prop: saved, base: saved, edit, scope }
}

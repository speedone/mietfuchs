import { checkIban, formatIban, normalizeIban, sameIban } from '../../shared/iban.ts'

// Ein IBAN-Feld im Formular (#279): Einstellungen, abweichende Bankverbindung eines Objekts und
// IBAN des Mieters. Die Prüfung steht in shared/iban.ts und ist dieselbe wie auf dem Server;
// hier steht, was das Formular daraus macht, ohne DOM prüfbar.
//
// **Eine gespeicherte ungültige IBAN wird nicht still geändert.** Sie stammt aus der Zeit vor der
// Prüfung oder aus einem Backup; das Formular nennt sie als Hinweis und schickt sie unverändert
// mit, sodass das Speichern einer anderen Angabe nicht an ihr scheitert. Der Server sieht es
// genauso (server/src/iban.ts).

export type IbanFieldState = { error: string | null, notice: string | null }

// Wie das Feld beim Öffnen dasteht: eine gültige in Vierergruppen, eine ungültige, wie sie ist.
export const ibanToInput = (stored: string | null | undefined): string => (stored ? formatIban(stored) : '')

// Nach dem Verlassen des Feldes: eine gültige in Vierergruppen, sonst unverändert.
export const ibanOnBlur = (input: string): string => formatIban(input.trim())

// Gilt die Eingabe als unverändert gegenüber dem gespeicherten Wert? Leerzeichen und
// Groß- und Kleinschreibung zählen dabei nicht.
const unchanged = (input: string, stored: string | null | undefined): boolean => !!stored && sameIban(input, stored)

// Was am Feld steht: ein Fehler für eine neue ungültige Eingabe, ein Hinweis für eine
// gespeicherte ungültige, die unverändert dasteht. Leer ist immer in Ordnung.
export function ibanFieldState(input: string, stored: string | null | undefined): IbanFieldState {
  if (input.trim() === '') return { error: null, notice: null }
  if (unchanged(input, stored)) {
    const check = checkIban(stored ?? '')
    return check.ok
      ? { error: null, notice: null }
      : { error: null, notice: `Die gespeicherte IBAN ist vermutlich falsch eingetragen. ${check.problem}` }
  }
  const check = checkIban(input)
  return { error: check.ok ? null : check.problem, notice: null }
}

// Was gespeichert wird: `''` für keine IBAN, eine gültige normiert, eine unveränderte ungültige
// so, wie sie gespeichert ist. Eine neue ungültige ergibt den Satz für die Meldung; `label`
// beginnt ihn („Die IBAN des Mieters“), wie in der Meldung des Servers.
export function ibanForSave(input: string, stored: string | null | undefined, label: string): { value: string } | { error: string } {
  if (input.trim() === '') return { value: '' }
  if (unchanged(input, stored)) {
    const gespeichert = stored ?? ''
    return { value: checkIban(gespeichert).ok ? normalizeIban(gespeichert) : gespeichert }
  }
  const check = checkIban(input)
  return check.ok ? { value: check.iban } : { error: `${label} ist nicht gültig. ${check.problem}` }
}

// Hat sich das Feld gegenüber dem gespeicherten Wert geändert? Für die Frage nach ungespeicherten
// Eingaben: Die Vierergruppen der Anzeige sind keine Änderung.
export const ibanChanged = (input: string, stored: string | null | undefined): boolean => !sameIban(input, stored)

// Steht eine IBAN gespeichert, die nicht gültig ist? Leer zählt nicht.
export const storedIbanInvalid = (stored: string | null | undefined): boolean => !!stored && !checkIban(stored).ok

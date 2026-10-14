// Die IBAN beim Speichern über die Routen (#279). Die Prüfung selbst steht in shared/iban.ts,
// dieselbe wie im Formular; hier steht nur, wann sie greift.
//
// **Abgelehnt wird nur eine IBAN, die neu gesetzt oder geändert wird.** `PUT` verschmilzt
// Teilrümpfe (db/repository.ts), und eine Seite schickt die gespeicherte IBAN unverändert mit,
// auch wenn jemand nur die Telefonnummer ändert. Steht dort aus der Zeit vor der Prüfung eine
// ungültige, oder kam sie über ein Backup oder den Umstieg herein (beide prüfen bewusst nicht:
// eine falsche IBAN ändert keine Zahl), dann darf das Speichern der Telefonnummer nicht an ihr
// scheitern. Verglichen wird normiert: dieselbe IBAN, nur anders geschrieben, gilt als
// unverändert und wird, wenn sie ungültig ist, auch nicht still umgeschrieben.
//
// Ein leeres Feld, `null` oder ein Wert, der kein Text ist, heißt „keine IBAN“ und ist immer
// erlaubt. Die Lesart der Verschmelzung bleibt dabei, wie sie war: `null` (und was kein Text ist)
// ergibt `null`, ein leerer Text bleibt ein leerer Text. Am Objekt ist das ein Unterschied:
// `null` heißt „die Vorgabe gilt“, `''` „bewusst keine“.

import { checkIban, normalizeIban, sameIban } from '../../shared/iban.ts'

export class IbanRefusal extends Error {
  status = 400
}

// Was für das Feld gespeichert wird: `null` oder `''` für „keine IBAN“, sonst die normierte Form
// oder, unverändert, die gespeicherte. `label` beginnt den Satz der Meldung („Die IBAN des Mieters“).
export function acceptIban(value: unknown, stored: string | null | undefined, label: string): string | null {
  if (typeof value !== 'string') return null
  if (value.trim() === '') return ''
  if (stored && sameIban(value, stored)) return checkIban(stored).ok ? normalizeIban(stored) : stored
  const check = checkIban(value)
  if (!check.ok) throw new IbanRefusal(`${label} ist nicht gültig. ${check.problem} Bitte prüfen Sie die Angabe.`)
  return check.iban
}

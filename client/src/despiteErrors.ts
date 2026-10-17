// Fehler der Abrechnung vor Druck und Abschluss (UI-Durchsicht H6, #341). Vorher ging der Druck ohne Hinweis:
// Nach dem Umstellen auf die eigene Heizkostenabrechnung fehlten die Heizkosten in jeder Mieterabrechnung,
// die Seite zeigte den Fehler, der Ausdruck nicht. Es gilt dieselbe Auswahl wie beim Abschließen (#319,
// `blockingErrors` in shared/notices.ts): Stufe `error`, ohne die Auskünfte aus INFORMATIONAL. Verweigert
// wird nichts, Vorgabe ist aber, es zu lassen; der Druck ist Browser-Druck, deshalb fragt die Oberfläche.
//
// - Drucken fragt nur bei einer offenen Abrechnung: Bei einer abgeschlossenen wurde beim Abschluss trotz
//   der Fehler bestätigt, und eine Änderung der Angaben änderte den eingefrorenen Ausdruck ohnehin nicht
//   (Durchsicht S6). Das Versanddatum gibt es nur an einer abgeschlossenen und fragt deshalb nie.
// - Der Vermerk „Entwurf, nicht versenden“ steht im Druck, solange Fehler da sind, offen wie abgeschlossen;
//   er deckt auch Strg+P und das Browsermenü ab, die die Seite nicht abfängt (Durchsicht S2).
// - Die erste Rückfrage zum Abschließen nennt die Fehler; bestätigt der Vermieter dort, wird die Rückfrage des
//   Servers zu denselben Fehlern ohne zweiten Dialog beantwortet (`sameErrors`).
import { blockingErrors } from '../../shared/notices.ts'
import type { Notice } from './types'

export type ErrorsQuestion = { title: string; message: string; cancelLabel: string; confirmLabel: string; errors: Notice[] }

const countText = (n: number) => (n === 1 ? 'einen Fehler' : `${n} Fehler`)
const titleOf = (n: number) => `Die Abrechnung enthält ${countText(n)}`
// Bewusst allgemein (Durchsicht K2): Nicht jeder Fehler verteilt Geld falsch, Überschneidungen rechnet
// Mietfuchs etwa wie erfasst.
const INTRO = 'Mindestens eine Angabe widerspricht sich (siehe unten).'

export const DRAFT_MARK = 'Entwurf, nicht versenden: Diese Abrechnung enthält Angaben, die sich widersprechen.'

export function showsDraftMark(notices: readonly Notice[]): boolean {
  return blockingErrors(notices).length > 0
}

export function printQuestion(notices: readonly Notice[], closed: boolean): ErrorsQuestion | null {
  const errors = blockingErrors(notices)
  if (closed || errors.length === 0) return null
  return {
    title: titleOf(errors.length),
    message: `${INTRO} Der Ausdruck trägt dann den Vermerk „Entwurf, nicht versenden“. Beheben Sie die Angaben besser, bevor Sie die Abrechnung verschicken.`,
    cancelLabel: 'Nicht drucken',
    confirmLabel: 'Trotzdem drucken',
    errors,
  }
}

// Die erste Rückfrage zum Abschließen, wenn die Seite schon Fehler zeigt; `title` ist der Titel der
// gewöhnlichen Rückfrage (mit Objekt, #157).
export function closeErrorsQuestion(title: string, notices: readonly Notice[]): ErrorsQuestion | null {
  const errors = blockingErrors(notices)
  if (errors.length === 0) return null
  return {
    title,
    message: `Die Abrechnung enthält ${countText(errors.length)}. ${INTRO} Abgeschlossen wird dieser Stand so eingefroren, wie er ist; spätere Änderungen an Kosten oder Stammdaten ändern ihn nicht mehr. Sie lässt sich wieder öffnen. Beheben Sie die Angaben besser vorher.`,
    cancelLabel: 'Nicht abschließen',
    confirmLabel: 'Trotzdem abschließen',
    errors,
  }
}

// Sind die Fehler der Rückfrage des Servers genau die, die der Vermieter eben bestätigt hat?
const keyOf = (n: Pick<Notice, 'code' | 'text'>) => `${n.code}\u0000${n.text}`
export function sameErrors(confirmed: readonly Notice[], asked: readonly Notice[]): boolean {
  if (asked.length === 0) return false
  const known = new Set(confirmed.map(keyOf))
  return asked.every((n) => known.has(keyOf(n)))
}

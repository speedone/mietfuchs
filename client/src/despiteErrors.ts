// Rückfrage vor dem Drucken und vor dem Versanddatum, solange die Abrechnung Fehler enthält
// (UI-Durchsicht H6). Vorher ging beides ohne Hinweis: Nach dem Umstellen auf die eigene
// Heizkostenabrechnung fehlten die Heizkosten in jeder Mieterabrechnung, die Seite zeigte den Fehler,
// der Ausdruck nicht. Es gilt dieselbe Auswahl wie beim Abschließen (#319, `blockingErrors` in
// shared/notices.ts): Stufe `error`, ohne die Auskünfte aus INFORMATIONAL. Verweigert wird nichts,
// Vorgabe ist aber, es zu lassen; der Druck ist Browser-Druck, deshalb fragt allein die Oberfläche.
import { blockingErrors } from '../../shared/notices.ts'
import type { Notice } from './types'

export type DespiteErrorsKind = 'print' | 'sent'
export type DespiteErrorsQuestion = { title: string; message: string; cancelLabel: string; confirmLabel: string; errors: Notice[] }

const INTRO = (n: number) => `Die Abrechnung enthält ${n === 1 ? 'einen Fehler' : `${n} Fehler`}: Angaben widersprechen sich, und Geld wird nicht so verteilt, wie es soll.`

export function despiteErrorsQuestion(kind: DespiteErrorsKind, notices: readonly Notice[]): DespiteErrorsQuestion | null {
  const errors = blockingErrors(notices)
  if (errors.length === 0) return null
  const title = errors.length === 1 ? 'Die Abrechnung enthält einen Fehler' : `Die Abrechnung enthält ${errors.length} Fehler`
  return kind === 'print'
    ? {
      title,
      message: `${INTRO(errors.length)} Der Ausdruck zeigt diesen Stand, ohne die Fehler zu nennen. Beheben Sie die Angaben besser, bevor Sie die Abrechnung verschicken.`,
      cancelLabel: 'Nicht drucken',
      confirmLabel: 'Trotzdem drucken',
      errors,
    }
    : {
      title,
      message: `${INTRO(errors.length)} Mit dem Versanddatum halten Sie fest, dass dieser Stand an die Mieter ging. Beheben Sie die Angaben besser vorher.`,
      cancelLabel: 'Nicht festhalten',
      confirmLabel: 'Trotzdem festhalten',
      errors,
    }
}

// Der Grund am Feld des Versanddatums, wenn die Rückfrage abgebrochen wurde; der Entwurf bleibt stehen.
export const SENT_AT_DECLINED = 'Die Abrechnung enthält noch Fehler.'

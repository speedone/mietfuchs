// Der Versand als eigener Schritt nach dem Abschluss (#337). Hier steht, was die Seite Abrechnung vor dem Speichern
// des Versanddatums entscheidet; die Seite fragt und speichert nur.
import { fmtDate } from './api'
import { sentAtProblem, sentAtProblemText } from '../../shared/sentAt.ts'

// Warum ein neues Versanddatum nicht gespeichert wird, sonst `null`. Dieselbe Regel wie am Server (shared/sentAt.ts):
// nicht nach heute, nicht vor dem Ende des Zeitraums. Leer heißt „nicht versendet“ und ist immer erlaubt; ein
// unverändert gespeichertes Datum prüft die Seite nicht, denn „Speichern“ erscheint dann gar nicht.
export function sentAtRefusal(value: string, periodTo: string, today: string): string | null {
  if (value === '') return null
  const problem = sentAtProblem(value, periodTo, today)
  return problem ? sentAtProblemText(problem, periodTo) : null
}

export type SentAtQuestion = { title: string, message: string, confirmLabel: string }

// Die Rückfrage, bevor ein gespeichertes Versanddatum sich ändert. Das erste Datum braucht keine: Es ist der Schritt
// „Als versendet markieren“. Ein Verlauf der Änderungen wird nicht geführt (Entscheidung zu #337).
export function sentAtChangeQuestion(saved: string, next: string): SentAtQuestion | null {
  if (saved === '' || saved === next) return null
  if (next === '') {
    return {
      title: 'Versanddatum entfernen?',
      message: `Gespeichert ist als Versanddatum der ${fmtDate(saved)}. Ohne Versanddatum gilt die Abrechnung als nicht versendet, und die Frist nach § 556 Abs. 3 BGB steht wieder als offen da.`,
      confirmLabel: 'Versanddatum entfernen',
    }
  }
  return {
    title: 'Versanddatum ändern?',
    message: `Gespeichert ist als Versanddatum der ${fmtDate(saved)}, neu wäre es der ${fmtDate(next)}. Nach diesem Tag richtet sich die Frist nach § 556 Abs. 3 BGB. Ändern Sie es nur, wenn die Abrechnung an einem anderen Tag an die Mieter ging.`,
    confirmLabel: 'Versanddatum ändern',
  }
}

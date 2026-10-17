// Die Rückfrage beim Abschließen einer Abrechnung (Heizung PR 7, #319): Lücken in der Brennstoffrechnung
// und Hinweise der Stufe `error` in einer Antwort, damit die Oberfläche einen Dialog zeigt und nicht zwei.
//
// Alles läuft in **einer** Transaktion (Entwurf 8.2, N1): rechnen, auf Wunsch Schätzungen anlegen und
// neu rechnen, prüfen, abschließen. Geprüft wird der Stand, der eingefroren würde, also nach der
// Schätzung; bringt erst sie einen Fehler hervor, wird er vorgelegt und die Schätzung fällt zurück.
// Jede Rückfrage wird geworfen, damit nie etwas ohne Abschluss stehen bleibt.
//
// Die Bestätigung ist an den Stand gebunden: Die Rückfrage trägt eine Prüfmarke über die Fehler (Code
// und Eintrag, sortiert, SHA-256, wie `token` bei der Belegbuchung), und nur dieselbe Marke schließt ab.
// Kommt zwischen Rückfrage und „Trotzdem abschließen“ ein Fehler dazu (zweites Fenster), fragt der
// Server mit der neuen Liste erneut, statt einen Stand einzufrieren, den niemand gesehen hat.
import { createHash } from 'node:crypto'
import { blockingErrors } from '../../shared/notices.ts'
import type { FuelGapQuestion, Notice } from '../../shared/types.ts'

export type FuelAnswer = 'estimate' | 'none'
export type CloseQuestion = { fuelGaps?: FuelGapQuestion[]; errorNotices?: Notice[]; errorToken?: string }

export type CloseSteps<Tx, S> = {
  compute: (tx: Tx) => Promise<S>
  gapsOf: (s: S) => FuelGapQuestion[]
  noticesOf: (s: S) => Notice[]
  estimate: (tx: Tx, s: S) => Promise<void>
  close: (tx: Tx, s: S) => Promise<void>
}

// Die Prüfmarke über eine Liste von Fehlern: Code und Eintrag, nicht der Text, denn der nennt Beträge,
// die sich mit jeder Kostenposition ändern, ohne dass ein anderer Widerspruch dasteht.
export function errorToken(errors: readonly Notice[]): string {
  const keys = errors.map((n) => [n.code, n.subject?.kind ?? '', n.subject?.id ?? ''].join('|'))
  keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256').update(JSON.stringify(keys)).digest('hex')
}

class Question extends Error {
  readonly question: CloseQuestion
  constructor(question: CloseQuestion) {
    super('Rückfrage beim Abschließen')
    this.question = question
  }
}

// `confirmed`: die Marke aus „Trotzdem abschließen“, `null` ohne Bestätigung. Ergibt die Rückfrage oder
// `null`, wenn abgeschlossen ist.
export async function closeWithQuestions<Tx, S>(
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
  answer: FuelAnswer | null,
  confirmed: string | null,
  steps: CloseSteps<Tx, S>,
): Promise<CloseQuestion | null> {
  try {
    return await transaction(async (tx) => {
      let settlement = await steps.compute(tx)
      const gaps = steps.gapsOf(settlement)
      const askGaps = gaps.length > 0 && answer === null
      if (gaps.length > 0 && answer === 'estimate') {
        await steps.estimate(tx, settlement)
        settlement = await steps.compute(tx)
      }
      const errors = blockingErrors(steps.noticesOf(settlement))
      const token = errors.length > 0 ? errorToken(errors) : null
      const askErrors = token !== null && token !== confirmed
      if (askGaps || askErrors) {
        throw new Question({ ...(askGaps ? { fuelGaps: gaps } : {}), ...(askErrors ? { errorNotices: errors, errorToken: token } : {}) })
      }
      await steps.close(tx, settlement)
      return null
    })
  } catch (e) {
    if (e instanceof Question) return e.question
    throw e
  }
}

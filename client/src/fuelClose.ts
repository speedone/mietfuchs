// Die Rückfrage beim Abschließen (Heizung PR 7, Entwurf 8.2, N1): Fehlt für einen Teil der Heizperiode
// eine Rechnung, antwortet der Server mit 409 und den Lücken. Drei Wege, Vorgabe ist das Abwarten
// (Durchsicht von #233): Ob eine noch fehlende Versorgerrechnung geschätzt werden darf, ist
// höchstrichterlich nicht entschieden, und bis zum Ende der Frist kostet Abwarten nichts. „Mit
// Schätzung“ und „Ohne Schätzung abschließen“ bleiben wählbar, keine von beiden ist vorausgewählt.
// Fehler der Abrechnung (Hinweise der Stufe `error`, #319) fragt der Server in derselben Antwort nach,
// in `errorNotices`; beides wird ein Dialog. Ohne DOM prüfbar; die Seite reicht `api` und die Rückfrage herein.
import { ApiError, fmtDate, fmtEuro } from './api'
import { formatDayRange } from '../../shared/period.ts'
import type { FuelGapQuestion, Notice } from './types'

export type FuelQuestion = { title: string; message: string; confirmLabel: string; alternativeLabel: string; cancelLabel: string }
export type FuelAnswer = 'estimate' | 'none' | 'wait'
// Die Rückfrage beim Abschließen (#319): zu fehlenden Rechnungen, zu Fehlern der Abrechnung oder zu
// beidem in einem Dialog. `errors` nennt die Seite mit Titel und „Hier beheben →“; `alternativeLabel`
// gibt es nur mit einer Lücke. Antwort `despite`: trotz Fehlern abschließen, ohne Lücke.
export type CloseQuestion = { title: string; message: string; confirmLabel: string; alternativeLabel?: string; cancelLabel: string; errors: Notice[]; fuel: boolean }
export type CloseAnswer = FuelAnswer | 'despite'

const isGap = (g: unknown): g is FuelGapQuestion =>
  g !== null && typeof g === 'object' &&
  'plantId' in g && typeof g.plantId === 'string' && 'plantName' in g && typeof g.plantName === 'string' &&
  'period' in g && typeof g.period === 'string' && 'from' in g && typeof g.from === 'string' &&
  'to' in g && typeof g.to === 'string' && 'amountCents' in g && typeof g.amountCents === 'number' &&
  'deadline' in g && typeof g.deadline === 'string' &&
  (!('zeroInvoices' in g) || g.zeroInvoices === undefined || (Array.isArray(g.zeroInvoices) && g.zeroInvoices.every((z: unknown) => typeof z === 'string')))

// Die Lücken aus einer Ablehnung, `null` bei jeder anderen.
export function fuelGapsOf(e: unknown): FuelGapQuestion[] | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !Array.isArray(e.data.fuelGaps)) return null
  const list: unknown[] = e.data.fuelGaps
  return list.filter(isGap)
}

const isNotice = (n: unknown): n is Notice =>
  n !== null && typeof n === 'object' &&
  'code' in n && typeof n.code === 'string' && 'level' in n && typeof n.level === 'string' &&
  'title' in n && typeof n.title === 'string' && 'text' in n && typeof n.text === 'string'

// Die Fehler aus einer Ablehnung (#319), `null` bei jeder anderen und wenn nach dem Prüfen keiner
// übrig bleibt; eine Rückfrage zu „0 Fehlern“ gibt es nicht.
export function errorNoticesOf(e: unknown): Notice[] | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !Array.isArray(e.data.errorNotices)) return null
  const list: unknown[] = e.data.errorNotices
  const errors = list.filter(isNotice)
  return errors.length > 0 ? errors : null
}

// Die Prüfmarke der Rückfrage (#319): „Trotzdem abschließen“ bestätigt genau diesen Stand.
const errorTokenOf = (e: unknown): string | null =>
  e instanceof ApiError && typeof e.data.errorToken === 'string' ? e.data.errorToken : null

const listOf = (gaps: readonly FuelGapQuestion[]): string =>
  gaps.map((g) => `${g.plantName || 'Heizanlage'}: ${formatDayRange(g.from, g.to)} (${fmtEuro(g.amountCents)})`).join('; ')

export function fuelQuestion(gaps: readonly FuelGapQuestion[]): FuelQuestion {
  const deadline = gaps.map((g) => g.deadline).filter((d) => d !== '').sort()[0]
  const wait = deadline
    ? `Sicher ist abzuwarten: Die Abrechnung muss den Mietern bis ${fmtDate(deadline)} zugehen; kommt die Rechnung vorher, braucht es keine Schätzung.`
    : 'Sicher ist abzuwarten, bis die Rechnung da ist, solange die Frist der Abrechnung läuft.'
  // Nachprüfung von 5bee89f (M-b): Eine eingetragene Rechnung, deren Positionen 0 € ergeben, gilt als
  // storniert; ist sie eine echte Rechnung über 0 €, wäre eine Schätzung bezahlter Brennstoff.
  const zero = gaps.filter((g) => (g.zeroInvoices ?? []).length > 0).map((g) =>
    `Für ${g.plantName || 'Heizanlage'}: ${formatDayRange(g.from, g.to)} ist ${(g.zeroInvoices ?? []).length === 1 ? 'die Rechnung' : 'sind die Rechnungen'} ${(g.zeroInvoices ?? []).map((z) => `„${z}“`).join(', ')} eingetragen, ihre Positionen ergeben aber zusammen 0 €; Mietfuchs behandelt sie als storniert. ` +
    'Ist es eine echte Rechnung über 0 €, ist dort nichts zu verteilen: Schätzen Sie dann nicht. ')
  return {
    title: 'Rechnung des Versorgers fehlt',
    message:
      `Für einen Teil der Heizperiode fehlt die Rechnung des Versorgers: ${listOf(gaps)}. ${zero.join('')}${wait} ` +
      'Mit Schätzung weist Mietfuchs diese Kosten aus der letzten Rechnung mit Vorbehalt aus und nennt die Grundlage; ob eine solche Schätzung zulässig ist, ist höchstrichterlich nicht entschieden. ' +
      'Ohne Schätzung steht dieser Teil zunächst bei Ihnen. Nachfordern können Sie mit einer berichtigten Abrechnung bis zum Ende der Frist, danach nur, wenn Sie die Verspätung nicht zu vertreten haben (§ 556 Abs. 3 Satz 3 BGB).',
    cancelLabel: 'Abwarten (nicht abschließen)',
    alternativeLabel: 'Ohne Schätzung abschließen',
    confirmLabel: 'Mit Schätzung abschließen',
  }
}

// Fehler der Abrechnung (#319): Abschließen bleibt möglich, Vorgabe ist aber, es zu lassen; eingefroren
// würde ein Stand mit widersprüchlichen Angaben. `estimated`: Die Fehler ergeben sich erst mit der
// Schätzung der fehlenden Rechnung (der Server hat sie dafür angelegt und wieder verworfen).
const ERRORS_INTRO = (n: number, estimated: boolean) =>
  `Die Abrechnung enthält ${estimated ? 'mit der Schätzung der fehlenden Rechnung ' : ''}${n === 1 ? 'einen Fehler' : `${n} Fehler`}: Angaben widersprechen sich, und Geld wird nicht so verteilt, wie es soll. ` +
  'Abgeschlossen wird dieser Stand so eingefroren, wie er ist. Beheben Sie die Angaben besser vorher.'

export function closeQuestion(gaps: readonly FuelGapQuestion[] | null, errors: readonly Notice[], estimated = false): CloseQuestion {
  const fuel = gaps !== null && gaps.length > 0 ? fuelQuestion(gaps) : null
  if (errors.length === 0 && fuel) return { ...fuel, errors: [], fuel: true }
  if (!fuel) {
    return {
      title: errors.length === 1 ? 'Die Abrechnung enthält einen Fehler' : `Die Abrechnung enthält ${errors.length} Fehler`,
      message: ERRORS_INTRO(errors.length, estimated),
      cancelLabel: 'Nicht abschließen',
      confirmLabel: 'Trotzdem abschließen',
      errors: [...errors],
      fuel: false,
    }
  }
  return {
    title: 'Rechnung des Versorgers fehlt, und die Abrechnung enthält Fehler',
    message: `${ERRORS_INTRO(errors.length, false)} ${fuel.message}`,
    cancelLabel: fuel.cancelLabel,
    alternativeLabel: 'Trotzdem ohne Schätzung abschließen',
    confirmLabel: 'Trotzdem mit Schätzung abschließen',
    errors: [...errors],
    fuel: true,
  }
}

// Schließt ab und fragt bei einer Lücke oder bei Fehlern nach (#319), beides in einer Rückfrage.
// `true`, wenn abgeschlossen ist; `false` beim Abwarten. Fragt der Server nach der Antwort erneut, weil
// erst die Schätzung einen Fehler hervorbringt oder inzwischen ein anderer dasteht, wird erneut gefragt;
// die Antwort zur Lücke bleibt dabei stehen. Nach drei Rückfragen, und bei jeder anderen Ablehnung, geht
// sie unverändert an den Aufrufer.
const MAX_QUESTIONS = 3
export async function closeWithQuestions(
  post: (body: Record<string, unknown>) => Promise<unknown>,
  ask: (q: CloseQuestion) => Promise<CloseAnswer>,
): Promise<boolean> {
  let body: Record<string, unknown> = {}
  for (let asked = 0; ; asked++) {
    try {
      await post(body)
      return true
    } catch (e) {
      const gaps = fuelGapsOf(e)
      const errors = errorNoticesOf(e)
      const token = errorTokenOf(e)
      if (gaps === null && (errors === null || token === null)) throw e
      if (asked >= MAX_QUESTIONS) throw e
      const q = closeQuestion(gaps, errors === null || token === null ? [] : errors, gaps === null && body.fuelEstimates === 'estimate')
      const answer = await ask(q)
      if (answer === 'wait') return false
      const next: Record<string, unknown> = { ...body }
      if (q.fuel) next.fuelEstimates = answer === 'none' ? 'none' : 'estimate'
      if (q.errors.length > 0 && token !== null) next.despiteErrors = token
      body = next
    }
  }
}

// Die Rückfrage beim Abschließen (Heizung PR 7, Entwurf 8.2, N1): Fehlt für einen Teil der Heizperiode
// eine Rechnung, antwortet der Server mit 409 und den Lücken. Drei Wege, Vorgabe ist das Abwarten
// (Durchsicht von #233): Ob eine noch fehlende Versorgerrechnung geschätzt werden darf, ist
// höchstrichterlich nicht entschieden, und bis zum Ende der Frist kostet Abwarten nichts. „Mit
// Schätzung“ und „Ohne Schätzung abschließen“ bleiben wählbar, keine von beiden ist vorausgewählt.
// Ohne DOM prüfbar; die Seite reicht `api` und die Rückfrage herein.
import { ApiError, fmtDate, fmtEuro } from './api'
import { formatDayRange } from '../../shared/period.ts'
import type { FuelGapQuestion } from './types'

export type FuelQuestion = { title: string; message: string; confirmLabel: string; alternativeLabel: string; cancelLabel: string }
export type FuelAnswer = 'estimate' | 'none' | 'wait'

const isGap = (g: unknown): g is FuelGapQuestion =>
  g !== null && typeof g === 'object' &&
  'plantId' in g && typeof g.plantId === 'string' && 'plantName' in g && typeof g.plantName === 'string' &&
  'period' in g && typeof g.period === 'string' && 'from' in g && typeof g.from === 'string' &&
  'to' in g && typeof g.to === 'string' && 'amountCents' in g && typeof g.amountCents === 'number' &&
  'deadline' in g && typeof g.deadline === 'string'

// Die Lücken aus einer Ablehnung, `null` bei jeder anderen.
export function fuelGapsOf(e: unknown): FuelGapQuestion[] | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !Array.isArray(e.data.fuelGaps)) return null
  const list: unknown[] = e.data.fuelGaps
  return list.filter(isGap)
}

const listOf = (gaps: readonly FuelGapQuestion[]): string =>
  gaps.map((g) => `${g.plantName || 'Heizanlage'}: ${formatDayRange(g.from, g.to)} (${fmtEuro(g.amountCents)})`).join('; ')

export function fuelQuestion(gaps: readonly FuelGapQuestion[]): FuelQuestion {
  const deadline = gaps.map((g) => g.deadline).filter((d) => d !== '').sort()[0]
  const wait = deadline
    ? `Sicher ist abzuwarten: Die Abrechnung muss den Mietern bis ${fmtDate(deadline)} zugehen; kommt die Rechnung vorher, braucht es keine Schätzung.`
    : 'Sicher ist abzuwarten, bis die Rechnung da ist, solange die Frist der Abrechnung läuft.'
  return {
    title: 'Rechnung des Versorgers fehlt',
    message:
      `Für einen Teil der Heizperiode fehlt die Rechnung des Versorgers: ${listOf(gaps)}. ${wait} ` +
      'Mit Schätzung weist Mietfuchs diese Kosten aus der letzten Rechnung mit Vorbehalt aus und nennt die Grundlage; ob eine solche Schätzung zulässig ist, ist höchstrichterlich nicht entschieden. ' +
      'Ohne Schätzung steht dieser Teil zunächst bei Ihnen. Nachfordern können Sie mit einer berichtigten Abrechnung bis zum Ende der Frist, danach nur, wenn Sie die Verspätung nicht zu vertreten haben (§ 556 Abs. 3 Satz 3 BGB).',
    cancelLabel: 'Abwarten (nicht abschließen)',
    alternativeLabel: 'Ohne Schätzung abschließen',
    confirmLabel: 'Mit Schätzung abschließen',
  }
}

// Schließt ab und fragt bei einer Lücke nach. `true`, wenn abgeschlossen ist; `false` beim Abwarten.
// Jede andere Ablehnung geht unverändert an den Aufrufer.
export async function closeWithFuelQuestion(
  post: (body: Record<string, unknown>) => Promise<unknown>,
  ask: (q: FuelQuestion) => Promise<FuelAnswer>,
): Promise<boolean> {
  try {
    await post({})
    return true
  } catch (e) {
    const gaps = fuelGapsOf(e)
    if (gaps === null) throw e
    const answer = await ask(fuelQuestion(gaps))
    if (answer === 'wait') return false
    await post({ fuelEstimates: answer })
    return true
  }
}

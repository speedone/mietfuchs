// Die Rückfrage beim Abschließen (Heizung PR 7, Entwurf 8.2, N1): Fehlt für einen Teil der Heizperiode
// eine Rechnung, antwortet der Server mit 409 und den Lücken. Vorgabe ist die Schätzung mit Vorbehalt;
// lehnt der Vermieter ab, fragt ein zweiter Dialog, ob er ohne Schätzung abschließt und den Teil selbst
// trägt. Ohne DOM prüfbar; die Seite reicht `api` und `confirm` herein.
import { ApiError, fmtEuro } from './api'
import { formatDayRange } from '../../shared/period.ts'
import type { FuelGapQuestion } from './types'

export type FuelQuestion = { title: string; message: string; confirmLabel: string; cancelLabel: string }

const isGap = (g: unknown): g is FuelGapQuestion =>
  g !== null && typeof g === 'object' &&
  'plantId' in g && typeof g.plantId === 'string' && 'plantName' in g && typeof g.plantName === 'string' &&
  'period' in g && typeof g.period === 'string' && 'from' in g && typeof g.from === 'string' &&
  'to' in g && typeof g.to === 'string' && 'amountCents' in g && typeof g.amountCents === 'number'

// Die Lücken aus einer Ablehnung, `null` bei jeder anderen.
export function fuelGapsOf(e: unknown): FuelGapQuestion[] | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !Array.isArray(e.data.fuelGaps)) return null
  const list: unknown[] = e.data.fuelGaps
  return list.filter(isGap)
}

const listOf = (gaps: readonly FuelGapQuestion[]): string =>
  gaps.map((g) => `${g.plantName || 'Heizanlage'}: ${formatDayRange(g.from, g.to)} (${fmtEuro(g.amountCents)})`).join('; ')
const totalOf = (gaps: readonly FuelGapQuestion[]): number => gaps.reduce((a, g) => a + g.amountCents, 0)

export function estimateQuestion(gaps: readonly FuelGapQuestion[]): FuelQuestion {
  return {
    title: 'Trotzdem abschließen?',
    message:
      `Für einen Teil der Heizperiode fehlt die Rechnung des Versorgers: ${listOf(gaps)}. Mietfuchs schätzt diese Kosten aus der letzten Rechnung ` +
      'und weist sie in der Abrechnung mit Vorbehalt aus. Kommt die Rechnung, zählt die Schätzung nicht mehr; eine Differenz steht bei Ihnen, ' +
      'und solange die Frist läuft, können Sie mit einer berichtigten Abrechnung nachfordern.',
    confirmLabel: 'Mit Schätzung abschließen',
    cancelLabel: 'Nicht schätzen',
  }
}

export function withoutEstimateQuestion(gaps: readonly FuelGapQuestion[]): FuelQuestion {
  return {
    title: 'Ohne Schätzung abschließen?',
    message:
      `Ohne Schätzung tragen Sie ${fmtEuro(totalOf(gaps))} selbst, auch wenn die Rechnung später kommt: Ihr Teil für diese Heizperiode gehört dann ` +
      'in eine abgeschlossene Abrechnung. Solange deren Frist läuft, können Sie sie wieder öffnen.',
    confirmLabel: 'Ohne Schätzung abschließen',
    cancelLabel: 'Abbrechen',
  }
}

// Schließt ab und fragt bei einer Lücke nach. `true`, wenn abgeschlossen ist; `false` nach Abbruch.
// Jede andere Ablehnung geht unverändert an den Aufrufer.
export async function closeWithFuelQuestion(
  post: (body: Record<string, unknown>) => Promise<unknown>,
  ask: (q: FuelQuestion) => Promise<boolean>,
): Promise<boolean> {
  try {
    await post({})
    return true
  } catch (e) {
    const gaps = fuelGapsOf(e)
    if (gaps === null) throw e
    if (await ask(estimateQuestion(gaps))) {
      await post({ fuelEstimates: 'estimate' })
      return true
    }
    if (await ask(withoutEstimateQuestion(gaps))) {
      await post({ fuelEstimates: 'none' })
      return true
    }
    return false
  }
}

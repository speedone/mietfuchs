import { expect, test } from 'vitest'
import { ApiError, fmtEuro } from './api'
import { closeQuestion, closeWithQuestions, errorNoticesOf, fuelGapsOf, fuelQuestion, type CloseAnswer, type CloseQuestion, type FuelAnswer } from './fuelClose'
import { periodKey } from '../../shared/period.ts'
import type { FuelGapQuestion, Notice } from './types'

const luecke: FuelGapQuestion = { plantId: 'hp', plantName: 'Gas', period: periodKey('2025-05'), from: '2026-03-15', to: '2026-04-30', amountCents: 90774, deadline: '2027-04-30' }
const abgelehnt = new ApiError('Für einen Teil der Heizperiode fehlt eine Rechnung.', 409, { fuelGaps: [luecke] })

test('Lücken aus der Antwort 409 lesen; jede andere Ablehnung ist keine Rückfrage', () => {
  expect(fuelGapsOf(abgelehnt)).toEqual([luecke])
  expect(fuelGapsOf(new ApiError('bereits abgeschlossen', 409, {}))).toBeNull()
  expect(fuelGapsOf(new Error('Netz weg'))).toBeNull()
  expect(fuelGapsOf(new ApiError('x', 409, { fuelGaps: [{ plantId: 1 }] }))).toEqual([])
})

test('Dialog (Durchsicht von #233): Vorgabe ist Abwarten mit Frist; Schätzung ungeklärt, ohne Schätzung nach § 556 Abs. 3 Satz 3 BGB', () => {
  const q = fuelQuestion([luecke])
  expect(q).toMatchObject({ cancelLabel: 'Abwarten (nicht abschließen)', alternativeLabel: 'Ohne Schätzung abschließen', confirmLabel: 'Mit Schätzung abschließen' })
  expect(q.message).toContain(`Gas: 15.03.–30.04.2026 (${fmtEuro(90774)})`)
  expect(q.message).toContain('bis 30.04.2027 zugehen')
  expect(q.message).toContain('höchstrichterlich nicht entschieden')
  expect(q.message).toContain('§ 556 Abs. 3 Satz 3 BGB')
  expect(q.message).not.toContain('selbst, auch wenn')
})

test('Ablauf: ohne Lücke einmal; mit Lücke Schätzung, ohne Schätzung oder Abwarten', async () => {
  const lauf = async (antwort: FuelAnswer, ersteAntwort: 'ok' | 'luecke') => {
    const bodies: Record<string, unknown>[] = []
    const post = async (body: Record<string, unknown>) => {
      bodies.push(body)
      if (bodies.length === 1 && ersteAntwort === 'luecke') throw abgelehnt
    }
    const ok = await closeWithQuestions(post, async () => antwort)
    return { ok, bodies }
  }
  expect(await lauf('wait', 'ok')).toEqual({ ok: true, bodies: [{}] })
  expect(await lauf('estimate', 'luecke')).toEqual({ ok: true, bodies: [{}, { fuelEstimates: 'estimate' }] })
  expect(await lauf('none', 'luecke')).toEqual({ ok: true, bodies: [{}, { fuelEstimates: 'none' }] })
  expect(await lauf('wait', 'luecke')).toEqual({ ok: false, bodies: [{}] })
  await expect(closeWithQuestions(async () => { throw new Error('Netz weg') }, async () => 'estimate')).rejects.toThrow('Netz weg')
})

test('Nachprüfung M-b: Eine Rechnung über 0 € im Zeitraum der Lücke nennt der Dialog, mit dem Rat, sie dann nicht zu schätzen', () => {
  const nullRechnung: FuelGapQuestion = { ...luecke, zeroInvoices: ['Gas 2025/2026'] }
  expect(fuelGapsOf(new ApiError('x', 409, { fuelGaps: [nullRechnung] }))).toEqual([nullRechnung])
  const q = fuelQuestion([nullRechnung])
  expect(q.message).toContain('Für Gas: 15.03.–30.04.2026 ist die Rechnung „Gas 2025/2026“ eingetragen, ihre Positionen ergeben aber zusammen 0 €; Mietfuchs behandelt sie als storniert.')
  expect(q.message).toContain('Ist es eine echte Rechnung über 0 €, ist dort nichts zu verteilen: Schätzen Sie dann nicht.')
  expect(q.cancelLabel).toBe('Abwarten (nicht abschließen)')
  expect(fuelQuestion([luecke]).message).not.toContain('0 €')
})

const fehler: Notice = { code: 'tenancy.overlap', level: 'error', title: 'Mietverhältnisse überschneiden sich', text: 'EG: zugleich.', subject: { kind: 'tenancy', id: 't1' } }

test('#319: Fehler aus der Antwort 409 lesen; ohne Liste keine Rückfrage', () => {
  expect(errorNoticesOf(new ApiError('x', 409, { errorNotices: [fehler, { code: 1 }] }))).toEqual([fehler])
  expect(errorNoticesOf(abgelehnt)).toBeNull()
  expect(errorNoticesOf(new ApiError('x', 400, { errorNotices: [fehler] }))).toBeNull()
  // K3: Bleibt nach dem Prüfen nichts übrig, gibt es keine Rückfrage zu „0 Fehlern“.
  expect(errorNoticesOf(new ApiError('x', 409, { errorNotices: [{ code: 1 }], errorToken: 'm' }))).toBeNull()
})

test('#319: Dialog zu Fehlern allein, zur Lücke allein und zu beidem in einem', () => {
  expect(closeQuestion(null, [fehler])).toMatchObject({ confirmLabel: 'Trotzdem abschließen', cancelLabel: 'Nicht abschließen', errors: [fehler], fuel: false })
  expect(closeQuestion(null, [fehler]).alternativeLabel).toBeUndefined()
  expect(closeQuestion([luecke], [])).toMatchObject({ ...fuelQuestion([luecke]), errors: [], fuel: true })
  const beides = closeQuestion([luecke], [fehler])
  expect(beides).toMatchObject({ confirmLabel: 'Trotzdem mit Schätzung abschließen', alternativeLabel: 'Trotzdem ohne Schätzung abschließen', cancelLabel: 'Abwarten (nicht abschließen)', fuel: true })
  expect(beides.message).toContain('einen Fehler')
  expect(beides.message).toContain(fuelQuestion([luecke]).message)
  expect(beides.message).not.toContain('—')
  // K2: allgemein für jeden Code der Stufe `error`, nicht nur für „nicht oder doppelt verteilt“.
  expect(closeQuestion(null, [fehler]).message).toContain('Geld wird nicht so verteilt, wie es soll')
  expect(closeQuestion(null, [fehler]).message).not.toContain('doppelt')
})

test('#319: Ablauf mit Fehlern: „Trotzdem“ sendet die Prüfmarke, mit Lücke samt Antwort', async () => {
  const lauf = async (antwort: CloseAnswer, data: Record<string, unknown>) => {
    const bodies: Record<string, unknown>[] = []
    const post = async (body: Record<string, unknown>) => {
      bodies.push(body)
      if (bodies.length === 1) throw new ApiError('x', 409, data)
    }
    return { ok: await closeWithQuestions(post, async () => antwort), bodies }
  }
  expect(await lauf('despite', { errorNotices: [fehler], errorToken: 'm1' })).toEqual({ ok: true, bodies: [{}, { despiteErrors: 'm1' }] })
  expect(await lauf('wait', { errorNotices: [fehler], errorToken: 'm1' })).toEqual({ ok: false, bodies: [{}] })
  expect(await lauf('none', { errorNotices: [fehler], errorToken: 'm1', fuelGaps: [luecke] })).toEqual({ ok: true, bodies: [{}, { despiteErrors: 'm1', fuelEstimates: 'none' }] })
  expect(await lauf('estimate', { errorNotices: [fehler], errorToken: 'm1', fuelGaps: [luecke] })).toEqual({ ok: true, bodies: [{}, { despiteErrors: 'm1', fuelEstimates: 'estimate' }] })
  // Ohne Marke lässt sich nichts bestätigen: Die Ablehnung geht als Meldung an die Seite.
  await expect(lauf('despite', { errorNotices: [fehler] })).rejects.toThrow('x')
})

test('#319 S2: Entsteht ein Fehler erst mit der Schätzung, fragt der Ablauf noch einmal und schließt mit Schätzung und Marke ab', async () => {
  const bodies: Record<string, unknown>[] = []
  const antworten: ApiError[] = [
    new ApiError('Lücke', 409, { fuelGaps: [luecke] }),
    new ApiError('Fehler', 409, { errorNotices: [fehler], errorToken: 'nach-schaetzung' }),
  ]
  const post = async (body: Record<string, unknown>) => {
    bodies.push(body)
    const a = antworten.shift()
    if (a) throw a
  }
  const fragen: CloseQuestion[] = []
  const ok = await closeWithQuestions(post, async (q) => {
    fragen.push(q)
    return q.fuel ? 'estimate' : 'despite'
  })
  expect(ok).toBe(true)
  expect(bodies).toEqual([{}, { fuelEstimates: 'estimate' }, { fuelEstimates: 'estimate', despiteErrors: 'nach-schaetzung' }])
  expect(fragen.map((q) => [q.fuel, q.errors.length])).toEqual([[true, 0], [false, 1]])
  expect(fragen[1]?.message).toContain('mit der Schätzung')
})

test('#319: Der Ablauf fragt nicht endlos; nach drei Rückfragen geht die Ablehnung an die Seite', async () => {
  let n = 0
  const post = async () => {
    n++
    throw new ApiError('immer neu', 409, { errorNotices: [fehler], errorToken: `m${n}` })
  }
  await expect(closeWithQuestions(post, async () => 'despite')).rejects.toThrow('immer neu')
  expect(n).toBe(4)
})

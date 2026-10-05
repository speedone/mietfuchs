import { expect, test } from 'vitest'
import { ApiError, fmtEuro } from './api'
import { closeWithFuelQuestion, fuelGapsOf, fuelQuestion, type FuelAnswer } from './fuelClose'
import { periodKey } from '../../shared/period.ts'
import type { FuelGapQuestion } from './types'

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
    const ok = await closeWithFuelQuestion(post, async () => antwort)
    return { ok, bodies }
  }
  expect(await lauf('wait', 'ok')).toEqual({ ok: true, bodies: [{}] })
  expect(await lauf('estimate', 'luecke')).toEqual({ ok: true, bodies: [{}, { fuelEstimates: 'estimate' }] })
  expect(await lauf('none', 'luecke')).toEqual({ ok: true, bodies: [{}, { fuelEstimates: 'none' }] })
  expect(await lauf('wait', 'luecke')).toEqual({ ok: false, bodies: [{}] })
  await expect(closeWithFuelQuestion(async () => { throw new Error('Netz weg') }, async () => 'estimate')).rejects.toThrow('Netz weg')
})

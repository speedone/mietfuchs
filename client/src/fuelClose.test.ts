import { expect, test } from 'vitest'
import { ApiError, fmtEuro } from './api'
import { closeWithFuelQuestion, estimateQuestion, fuelGapsOf, withoutEstimateQuestion } from './fuelClose'
import { periodKey } from '../../shared/period.ts'
import type { FuelGapQuestion } from './types'

const luecke: FuelGapQuestion = { plantId: 'hp', plantName: 'Gas', period: periodKey('2025-05'), from: '2026-03-15', to: '2026-04-30', amountCents: 90774 }
const abgelehnt = new ApiError('Für einen Teil der Heizperiode fehlt eine Rechnung.', 409, { fuelGaps: [luecke] })

test('Lücken aus der Antwort 409 lesen; jede andere Ablehnung ist keine Rückfrage', () => {
  expect(fuelGapsOf(abgelehnt)).toEqual([luecke])
  expect(fuelGapsOf(new ApiError('bereits abgeschlossen', 409, {}))).toBeNull()
  expect(fuelGapsOf(new Error('Netz weg'))).toBeNull()
  expect(fuelGapsOf(new ApiError('x', 409, { fuelGaps: [{ plantId: 1 }] }))).toEqual([])
})

test('Dialog: Vorgabe ist die Schätzung; ohne sie nennt er den Betrag, den der Vermieter trägt', () => {
  const q = estimateQuestion([luecke])
  expect(q).toMatchObject({ title: 'Trotzdem abschließen?', confirmLabel: 'Mit Schätzung abschließen', cancelLabel: 'Nicht schätzen' })
  expect(q.message).toContain(`Gas: 15.03.–30.04.2026 (${fmtEuro(90774)})`)
  expect(q.message).toContain('mit Vorbehalt')
  const ohne = withoutEstimateQuestion([luecke])
  expect(ohne).toMatchObject({ title: 'Ohne Schätzung abschließen?', confirmLabel: 'Ohne Schätzung abschließen', cancelLabel: 'Abbrechen' })
  expect(ohne.message).toContain(`tragen Sie ${fmtEuro(90774)} selbst`)
})

test('Ablauf: ohne Lücke einmal; mit Lücke Schätzung, ohne Schätzung oder Abbruch', async () => {
  const lauf = async (antworten: boolean[], ersteAntwort: 'ok' | 'luecke') => {
    const bodies: Record<string, unknown>[] = []
    const post = async (body: Record<string, unknown>) => {
      bodies.push(body)
      if (bodies.length === 1 && ersteAntwort === 'luecke') throw abgelehnt
    }
    const fragen = [...antworten]
    const ok = await closeWithFuelQuestion(post, async () => fragen.shift() ?? false)
    return { ok, bodies }
  }
  expect(await lauf([], 'ok')).toEqual({ ok: true, bodies: [{}] })
  expect(await lauf([true], 'luecke')).toEqual({ ok: true, bodies: [{}, { fuelEstimates: 'estimate' }] })
  expect(await lauf([false, true], 'luecke')).toEqual({ ok: true, bodies: [{}, { fuelEstimates: 'none' }] })
  expect(await lauf([false, false], 'luecke')).toEqual({ ok: false, bodies: [{}] })
  await expect(closeWithFuelQuestion(async () => { throw new Error('Netz weg') }, async () => true)).rejects.toThrow('Netz weg')
})

import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { fuelBlock } from './fuelView'
import { periodKey } from '../../shared/period.ts'
import type { FuelAssessment, HeatingStatement } from './types'

const assert = { fail: (text: string): never => { throw new Error(text) } }
const brennstoff: FuelAssessment = {
  coveragePermille: 848.71, emissionsKg: 5406.17, co2Cents: 50923,
  deliveries: [
    { deliveryId: 'd', label: 'Gas 2025/2026', from: '2025-03-15', to: '2026-03-14', estimated: false, method: 'degreeDays', sharePermille: 848.71, fixedKnown: false, split: true, amountCents: 650000, inPeriodCents: 551661, emissionsKg: 4588.3, co2Cents: 50923, energyKwh: null },
    { deliveryId: 'e', label: 'Schätzung 15.03.–30.04.2026: 151,29 ‰ der Rechnung „Gas 2024/2025“ nach Gradtagen', from: '2026-03-15', to: '2026-04-30', estimated: true, method: 'inside', sharePermille: 1000, fixedKnown: true, split: false, amountCents: 90774, inPeriodCents: 90774, emissionsKg: null, co2Cents: null, energyKwh: null },
  ],
  carries: [{ deliveryId: 'd', period: periodKey('2024-05'), cents: -98339 }],
  gaps: [],
}
const anlage = (fuel?: FuelAssessment): HeatingStatement => ({
  plantId: 'hp', plantName: 'Gas', energy: 'gas', period: periodKey('2025-05'), from: '2025-05-01', to: '2026-04-30', co2: null, ...(fuel ? { fuel } : {}),
})

test('Druckblock Brennstoff: je Rechnung Anteil, Verfahren und Teil der Heizperiode; Ausstoß umgerechnet; Vorbehalt der Schätzung', () => {
  const v = fuelBlock(anlage(brennstoff)) ?? assert.fail('kein Block')
  expect(v.title).toBe('Brennstoff Gas, Heizperiode 01.05.2025 – 30.04.2026')
  expect(v.rows[0]).toEqual({ label: 'Gas 2025/2026 (15.03.2025–14.03.2026)', value: `848,71 ‰ nach der Gradtagszahlentabelle = ${fmtEuro(551661)} von ${fmtEuro(650000)}, 4.588,3 kg CO₂` })
  expect(v.rows[1]).toEqual({ label: 'Schätzung 15.03.–30.04.2026 (15.03.–30.04.2026)', value: `geschätzt, ${fmtEuro(90774)}` })
  expect(v.rows.at(-1)).toEqual({ label: 'CO₂-Ausstoß, umgerechnet auf die Heizperiode', value: '5.406,2 kg (die Rechnungen decken 848,7 ‰ der Gradtage ab)' })
  expect(v.notes).toEqual(['Die Brennstoffkosten vom 15.03.2026 bis 30.04.2026 sind geschätzt, weil die Rechnung des Versorgers noch nicht vorlag (Grundlage: 151,29 ‰ der Rechnung „Gas 2024/2025“ nach Gradtagen). Eine Nachberechnung bleibt vorbehalten.'])
})

test('Kein Block ohne Lieferungen; eine Lücke steht als Hinweis', () => {
  expect(fuelBlock(anlage())).toBeNull()
  expect(fuelBlock(anlage({ ...brennstoff, deliveries: [], carries: [] }))).toBeNull()
  const luecke = fuelBlock(anlage({ ...brennstoff, deliveries: brennstoff.deliveries.slice(0, 1), gaps: [{ from: '2026-03-15', to: '2026-04-30', days: 47, permille: 151.29, estimate: null }] })) ?? assert.fail('kein Block')
  expect(luecke.notes).toEqual(['Für 15.03.–30.04.2026 lag keine Rechnung vor; diese Kosten sind nicht enthalten, eine Nachberechnung bleibt vorbehalten.'])
})

test('Nachprüfung G-b: Nur eine Lücke, keine Rechnung und kein Übertrag: der Block steht trotzdem mit dem Vorbehalt', () => {
  const nurLuecke = fuelBlock(anlage({ ...brennstoff, deliveries: [], carries: [], emissionsKg: null, gaps: [{ from: '2025-05-01', to: '2026-04-30', days: 365, permille: 1000, estimate: null }] })) ?? assert.fail('kein Block')
  expect(nurLuecke.rows).toEqual([])
  expect(nurLuecke.notes).toEqual(['Für 01.05.2025–30.04.2026 lag keine Rechnung vor; diese Kosten sind nicht enthalten, eine Nachberechnung bleibt vorbehalten.'])
})

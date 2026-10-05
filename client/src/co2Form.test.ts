import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { CO2_ANSWER_OPTIONS, CO2_NOT_A_SIGN, CO2_QUESTION, co2Body, co2ToForm, parseDecimal, probeLine, usersTotalOf, type Co2Context } from './co2Form'
import { periodKey } from '../../shared/period.ts'
import type { Co2Statement } from './types'

const ctx: Co2Context = {
  unitsCount: 4,
  items: [
    { id: 'hz', description: 'Messdienst', amountCents: 393301, key: 'amounts', tenancyAmounts: { t1: 110327, t2: 95864, t3: 101485, t4: 76875 } },
    { id: 'gs', description: 'Gutschrift', amountCents: -4000, key: 'area' },
  ],
}
const gespeichert: Co2Statement = {
  heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2025-01'), method: 'serviceDeducted', areaM2: null, serviceEmissionsKg: null,
  serviceAreaM2: null, serviceKgPerM2: 46.4, serviceLandlordPermille: 350, serviceTotalCents: 25000, serviceLandlordCents: 8750,
  serviceUsersTotalCents: 384551, serviceUsersTotalApprox: false, serviceUnitsCount: 4, serviceCostItemId: null, serviceSelfLandlordCents: null,
  serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [{ tenancyId: 't1', cents: 2500 }],
}

test('Eine neue Heizperiode beginnt ohne Antwort und ohne Beträge; die Zahl der Nutzeinheiten ist vorbelegt (Entwurf 7.2, 12.4)', () => {
  const f = co2ToForm(null, ctx)
  expect(f.answer).toBe('')
  expect([f.usersTotal, f.landlordCo2, f.totalCo2, f.kgPerM2, f.landlordPercent]).toEqual(['', '', '', '', ''])
  expect(f.unitsCount).toBe('4')
  expect(CO2_ANSWER_OPTIONS[0]?.value).toBe('')
  expect(co2Body(f, ctx)).toEqual({ error: 'Bitte beantworten Sie zuerst die Frage nach der Abzugszeile.' })
})

test('Gespeicherte Angaben zurück ins Formular und wieder in den Rumpf', () => {
  const f = co2ToForm(gespeichert, ctx)
  expect([f.answer, f.usersTotal, f.landlordCo2, f.kgPerM2, f.landlordPercent, f.reliefs.t1]).toEqual(['deducted', '3.845,51', '87,50', '46,4', '35', '25,00'])
  const r = co2Body(f, ctx)
  if (!('body' in r)) throw new Error(r.error)
  expect(r.body).toMatchObject({
    method: 'serviceDeducted', serviceUsersTotalCents: 384551, serviceLandlordCents: 8750, serviceUnitsCount: 4, serviceKgPerM2: 46.4,
    serviceLandlordPermille: 350, serviceTotalCents: 25000, serviceCostItemId: null, reliefs: [{ tenancyId: 't1', cents: 2500 }],
  })
})

test('Probe live (Entwurf 11.3): „Ihre Positionen: 3.933,01 € · erwartet: 3.933,01 € ✓“, nur über die Messdienstpositionen', () => {
  const f = co2ToForm(gespeichert, ctx)
  expect(probeLine(f, ctx)).toEqual({ text: `Ihre Positionen: ${fmtEuro(393301)} · erwartet: ${fmtEuro(393301)} ✓`, ok: true })
  expect(probeLine({ ...f, answer: 'shown' }, ctx)?.ok).toBe(false)
  expect(probeLine({ ...f, answer: 'unsplit' }, ctx)).toBeNull()
  expect(probeLine({ ...f, landlordCo2: '' }, ctx)).toBeNull()
})

test('„Ich finde diese Zeile nicht“: S = eingetragene Einzelbeträge + Beträge der leeren Einheiten (Entwurf 7.3, R6)', () => {
  const f = { ...co2ToForm(gespeichert, ctx), usersTotal: '', usersTotalApprox: true, vacancyTotal: '500,00' }
  expect(usersTotalOf(f, ctx)).toBe(384551 + 50000)
  const r = co2Body(f, ctx)
  if (!('body' in r)) throw new Error(r.error)
  expect(r.body).toMatchObject({ serviceUsersTotalCents: 434551, serviceUsersTotalApprox: true })
  expect(usersTotalOf({ ...f, vacancyTotal: '' }, ctx)).toBe(384551)
})

test('Pflichtangaben und Zahlen: S, L, Nutzeinheiten; deutsche und technische Schreibweise', () => {
  const f = co2ToForm(gespeichert, ctx)
  expect(co2Body({ ...f, usersTotal: '' }, ctx)).toEqual({ error: 'Bitte tragen Sie die Summe der Kosten aller Nutzer ein, oder kreuzen Sie „Ich finde diese Zeile nicht“ an.' })
  expect(co2Body({ ...f, landlordCo2: '' }, ctx)).toEqual({ error: 'Bitte tragen Sie den CO₂-Anteil des Vermieters in Euro ein.' })
  expect(co2Body({ ...f, unitsCount: '0' }, ctx)).toEqual({ error: 'Bitte tragen Sie die Zahl der Nutzeinheiten ein, mindestens 1.' })
  expect(co2Body({ ...f, kgPerM2: 'viel' }, ctx)).toEqual({ error: 'Bitte prüfen Sie „CO₂-Ausstoß je m² und Jahr (kg)“: keine Zahl ab 0.' })
  expect([parseDecimal('46,4'), parseDecimal('46.4'), parseDecimal('1.046,4'), parseDecimal(''), parseDecimal('x')]).toEqual([46.4, 46.4, 1046.4, null, null])
  // Hat der Messdienst nicht aufgeteilt, genügt die Antwort.
  expect(co2Body({ ...co2ToForm(null, ctx), answer: 'unsplit' }, ctx)).toMatchObject({ body: { method: 'selfAfterService' } })
})

test('Ausstoß und Fläche laut Messdienst (Durchsicht I3): zurück ins Formular und in den Rumpf', () => {
  const f = co2ToForm({ ...gespeichert, serviceEmissionsKg: 5421, serviceAreaM2: 200.6 }, ctx)
  expect([f.emissionsKg, f.serviceArea]).toEqual(['5421', '200,6'])
  const r = co2Body(f, ctx)
  if (!('body' in r)) throw new Error(r.error)
  expect(r.body).toMatchObject({ serviceEmissionsKg: 5421, serviceAreaM2: 200.6 })
  expect(co2Body({ ...f, serviceArea: '0' }, ctx)).toEqual({ error: 'Bitte prüfen Sie „Wohnfläche laut Abrechnung (m²)“: eine Zahl größer als 0.' })
})

test('Probe ✗ nennt beide Lesarten (Durchsicht M3)', () => {
  const f = { ...co2ToForm(gespeichert, ctx), answer: 'shown' as const }
  const p = probeLine(f, ctx)
  expect(p?.ok).toBe(false)
  // Laienprobe B20: in Worten, ohne Formelbuchstaben.
  expect(p?.text).toContain(`mit Abzugszeile erwartet: Summe der Nutzer ${fmtEuro(384551)} + Anteil Vermieter ${fmtEuro(8750)} = ${fmtEuro(393301)}; ohne Abzugszeile: ${fmtEuro(384551)}.`)
  expect(p?.text).not.toMatch(/\bS \+ L\b|\bS = /)
})

test('Die Frage fragt nur nach der Zeile in der Kostenaufstellung; „vom Vermieter übernommen“ ist kein Erkennungszeichen (Durchsicht I1)', () => {
  expect(CO2_QUESTION).not.toContain('vom Vermieter übernommen')
  expect(CO2_QUESTION).toContain('vor der Verteilung')
  expect(CO2_NOT_A_SIGN).toContain('vom Vermieter übernommen')
  expect(CO2_NOT_A_SIGN).toContain('kein Zeichen')
})

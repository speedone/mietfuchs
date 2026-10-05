// Die Karte „CO₂-Kosten“ der Seite Heizkosten (Heizung PR 6, Entwurf 11.3): was der Vermieter aus
// der Abrechnung des Messdienstes oder der Gemeinschaft überträgt, ohne DOM, damit es ohne Browser
// prüfbar ist. Die Probe rechnet shared/co2Probe.ts, dieselbe Funktion wie die Abrechnung.
//
// Die Frage nach der Abzugszeile hat keine Vorgabe (Entwurf 7.2): Ob abgezogen wurde, steht nur auf
// dem Papier, und eine Vorgabe wäre bei einem Teil der Messdienste falsch.
import { fmtEuro, parseEuro } from './api'
import { enteredCentsOf, serviceProbe } from '../../shared/co2Probe.ts'
import type { Co2Method, Co2Statement, HeatingPeriodView } from './types'

export type Co2Answer = '' | 'deducted' | 'shown' | 'unsplit'
const METHOD_OF: Record<Exclude<Co2Answer, ''>, Co2Method> = { deducted: 'serviceDeducted', shown: 'serviceShown', unsplit: 'selfAfterService' }
const answerOf = (m: Co2Method): Co2Answer =>
  m === 'serviceDeducted' ? 'deducted' : m === 'serviceShown' ? 'shown' : m === 'selfAfterService' ? 'unsplit' : ''

export const CO2_QUESTION = 'Steht in der Kostenaufstellung eine Zeile wie „Abzüglich CO₂-Kosten Vermieter“, oder bei Ihren Mietern „vom Vermieter übernommen“?'
// Die Beispielzeile aus dem Techem-Muster (Entwurf 7.2).
export const CO2_EXAMPLE = 'Beispiel aus einer Musterabrechnung: Anlieferung Brennstoff 3.540,00 · Abzüglich CO₂-Kosten Vermieter −87,50 · Verbrauch 3.452,50'
export const CO2_ANSWER_OPTIONS: readonly { value: Co2Answer; label: string }[] = [
  { value: '', label: 'Bitte wählen …' },
  { value: 'deducted', label: 'Ja, es gibt eine Abzugszeile' },
  { value: 'shown', label: 'Nein, die CO₂-Kosten sind nur ausgewiesen' },
  { value: 'unsplit', label: 'Der Messdienst hat die CO₂-Kosten gar nicht aufgeteilt' },
]

export type Co2Form = {
  answer: Co2Answer
  usersTotal: string // S, wie gedruckt
  usersTotalApprox: boolean // „Ich finde diese Zeile nicht“
  vacancyTotal: string // Beträge leerer oder nicht eingetragener Einheiten (nur ohne S)
  kgPerM2: string
  landlordPercent: string
  totalCo2: string // C
  landlordCo2: string // L
  selfLandlord: string // L_self, wenn die Einzelabrechnung der eigenen Wohnung ihn nennt
  unitsCount: string // NE
  fuelGross: string // G
  fuelNet: string // V
  costItemId: string
  reliefs: Record<string, string> // „vom Vermieter übernommen“ je Mietverhältnis
}
export type Co2Context = { items: HeatingPeriodView['items']; unitsCount: number }

const centsText = (c: number | null): string => (c === null ? '' : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 4 }))
const serviceItemsOf = (ctx: Co2Context) => ctx.items.filter((i) => i.key === 'amounts')

// Eine Zahl in deutscher („46,4“, „1.046,4“) oder technischer Schreibweise („46.4“).
export function parseDecimal(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

export function co2ToForm(st: Co2Statement | null, ctx: Co2Context): Co2Form {
  const permille = st?.serviceLandlordPermille ?? null
  const S = st?.serviceUsersTotalCents ?? null
  return {
    answer: st ? answerOf(st.method) : '',
    usersTotal: st?.serviceUsersTotalApprox ? '' : centsText(S),
    usersTotalApprox: st?.serviceUsersTotalApprox ?? false,
    vacancyTotal: st?.serviceUsersTotalApprox && S !== null ? centsText(Math.max(0, S - enteredCentsOf(serviceItemsOf(ctx)))) : '',
    kgPerM2: numberText(st?.serviceKgPerM2 ?? null),
    landlordPercent: permille === null ? '' : numberText(permille / 10),
    totalCo2: centsText(st?.serviceTotalCents ?? null),
    landlordCo2: centsText(st?.serviceLandlordCents ?? null),
    selfLandlord: centsText(st?.serviceSelfLandlordCents ?? null),
    unitsCount: String(st?.serviceUnitsCount ?? ctx.unitsCount),
    fuelGross: centsText(st?.serviceFuelGrossCents ?? null),
    fuelNet: centsText(st?.serviceFuelNetCents ?? null),
    costItemId: st?.serviceCostItemId ?? '',
    reliefs: Object.fromEntries((st?.reliefs ?? []).map((r) => [r.tenancyId, centsText(r.cents)])),
  }
}

// S: die gedruckte Summe, oder ohne sie die Einzelbeträge aller Nutzeinheiten laut Messdienst, also
// die eingetragenen und die der leeren oder nicht eingetragenen Einheiten (Entwurf 7.3, R6).
export function usersTotalOf(form: Co2Form, ctx: Co2Context): number | null {
  if (!form.usersTotalApprox) return form.usersTotal.trim() === '' ? null : parseEuro(form.usersTotal)
  const vacancy = form.vacancyTotal.trim() === '' ? 0 : parseEuro(form.vacancyTotal)
  return vacancy === null || vacancy < 0 ? null : enteredCentsOf(serviceItemsOf(ctx)) + vacancy
}

export function co2Body(form: Co2Form, ctx: Co2Context): { body: Record<string, unknown> } | { error: string } {
  if (form.answer === '') return { error: 'Bitte beantworten Sie zuerst die Frage nach der Abzugszeile.' }
  const method = METHOD_OF[form.answer]
  const errors: string[] = []
  const cents = (text: string, label: string): number | null => {
    if (text.trim() === '') return null
    const c = parseEuro(text)
    if (c === null || c < 0) {
      errors.push(`Bitte prüfen Sie „${label}“: kein Betrag ab 0 €.`)
      return null
    }
    return c
  }
  const decimal = (text: string, label: string): number | null => {
    if (text.trim() === '') return null
    const n = parseDecimal(text)
    if (n === null || n < 0) {
      errors.push(`Bitte prüfen Sie „${label}“: keine Zahl ab 0.`)
      return null
    }
    return n
  }
  const S = usersTotalOf(form, ctx)
  const L = cents(form.landlordCo2, 'davon Vermieter')
  const percent = decimal(form.landlordPercent, 'Anteil des Vermieters (%)')
  const units = Number(form.unitsCount)
  const unitsCount = Number.isInteger(units) && units > 0 ? units : null
  const body = {
    method,
    serviceUsersTotalCents: S,
    serviceUsersTotalApprox: form.usersTotalApprox,
    serviceLandlordCents: L,
    serviceUnitsCount: unitsCount,
    serviceKgPerM2: decimal(form.kgPerM2, 'CO₂-Ausstoß je m² und Jahr (kg)'),
    serviceLandlordPermille: percent === null ? null : Math.round(percent * 10),
    serviceTotalCents: cents(form.totalCo2, 'CO₂-Kosten insgesamt'),
    serviceSelfLandlordCents: cents(form.selfLandlord, 'davon für Ihre Wohnung'),
    serviceFuelGrossCents: cents(form.fuelGross, 'Brennstoffkosten laut Abrechnung (vor Abzug)'),
    serviceFuelNetCents: cents(form.fuelNet, 'davon verteilt'),
    serviceCostItemId: form.costItemId === '' ? null : form.costItemId,
    reliefs: Object.entries(form.reliefs).flatMap(([tenancyId, text]) => {
      const c = cents(text, 'vom Vermieter übernommen')
      return c === null ? [] : [{ tenancyId, cents: c }]
    }),
  }
  const first = errors[0]
  if (first) return { error: first }
  if (method !== 'selfAfterService') {
    if (S === null) {
      return { error: form.usersTotalApprox
        ? 'Bitte tragen Sie die Beträge der leeren oder nicht eingetragenen Einheiten ein, 0, wenn es keine gibt.'
        : 'Bitte tragen Sie die Summe der Kosten aller Nutzer ein, oder kreuzen Sie „Ich finde diese Zeile nicht“ an.' }
    }
    if (L === null) return { error: 'Bitte tragen Sie den CO₂-Anteil des Vermieters in Euro ein.' }
    if (unitsCount === null) return { error: 'Bitte tragen Sie die Zahl der Nutzeinheiten ein, mindestens 1.' }
  }
  return { body }
}

// Die Probe unter der Karte (Entwurf 11.3): „Ihre Positionen: 3.933,01 € · erwartet: 3.933,01 € ✓“.
export function probeLine(form: Co2Form, ctx: Co2Context): { text: string; ok: boolean } | null {
  if (form.answer !== 'deducted' && form.answer !== 'shown') return null
  const S = usersTotalOf(form, ctx)
  const L = form.landlordCo2.trim() === '' ? null : parseEuro(form.landlordCo2)
  const units = Number(form.unitsCount)
  if (S === null || L === null || !Number.isInteger(units) || units < 1) return null
  const p = serviceProbe({ deducted: form.answer === 'deducted', items: serviceItemsOf(ctx), usersTotalCents: S, landlordCents: L, unitsCount: units, approx: form.usersTotalApprox })
  const entered = p.enteredOk ? '' : ` · Einzel- und Eigenbeträge zusammen ${fmtEuro(p.enteredCents)}, mehr als S`
  return { text: `Ihre Positionen: ${fmtEuro(p.itemsCents)} · erwartet: ${fmtEuro(p.expectedCents)} ${p.ok ? '✓' : '✗'}${entered}`, ok: p.ok }
}

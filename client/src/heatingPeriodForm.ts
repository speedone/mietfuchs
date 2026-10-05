// Die Einrichtung „Heizung“, Schritt 3 (Heizung PR 5, Entwurf 11.2): für welchen Zeitraum die Heizung
// abrechnet, ob die Heizkosten getrennt abgerechnet werden, welcher Weg vorgeschlagen wird (3.1), und
// die Antworten zu den beiden Vorschauen (Zeitraum der Heizung, getrennte Abrechnung). Ohne DOM prüfbar.
import { parseEuro } from './api'
import { rhythmText } from './periodForm'
import { hasOwnRhythm, monthSpanText, plantRules } from '../../shared/heatingPeriod.ts'
import { isCalendarRules, parsePeriodKey } from '../../shared/period.ts'
import type { HeatingPeriodChangeAnswers, HeatingPeriodChangePreview, HeatingPlant, PeriodRules, SeparateAnswers, SeparatePreview } from './types'

export type PeriodChoice = 'object' | 'own'
export type SeparateChoice = '' | 'yes' | 'no' | 'unknown'
export type HeatingPeriodForm = { choice: PeriodChoice; mode: 'start' | 'change'; month: number; from: string; separate: SeparateChoice }

export const PERIOD_CHOICE_OPTIONS: { value: PeriodChoice; label: string }[] = [
  { value: 'object', label: 'Wie der Abrechnungszeitraum des Objekts' },
  { value: 'own', label: 'Ein eigener Zeitraum, etwa Mai bis April wie der Messdienst' },
]

export const SEPARATE_OPTIONS: { value: Exclude<SeparateChoice, ''>; label: string }[] = [
  { value: 'no', label: 'Nein, eine gemeinsame Vorauszahlung für alle Nebenkosten' },
  { value: 'yes', label: 'Ja, mit eigener Heizkostenvorauszahlung und eigener Heizkostenabrechnung' },
  { value: 'unknown', label: 'Weiß ich nicht' },
]

export function heatingPeriodForm(plant: HeatingPlant): HeatingPeriodForm {
  return {
    choice: hasOwnRhythm(plant) ? 'own' : 'object',
    mode: 'start',
    month: plant.periodStartMonth ?? 5,
    from: '',
    separate: plant.separateSettlement === true ? 'yes' : plant.separateSettlement === false ? 'no' : '',
  }
}

// Die Regeln für die Vorschau: `null` heißt „wie das Objekt“; „ab einem Monat“ fügt einen Wechsel an
// den bisherigen Rhythmus der Heizung an (oder an den des Objekts, wenn sie ihm bisher folgt).
export function heatingRulesBody(form: HeatingPeriodForm, plant: HeatingPlant, objectRules: PeriodRules): { rules: PeriodRules | null } | { error: string } {
  if (form.choice === 'object') return { rules: null }
  if (form.mode === 'start') return { rules: { startMonth: form.month, changes: [] } }
  const from = parsePeriodKey(form.from)
  if (from === null) return { error: 'Bitte geben Sie den Monat an, ab dem die Heizung im neuen Zeitraum abrechnet.' }
  const current = plantRules(plant, objectRules)
  return { rules: { startMonth: current.startMonth, changes: [...current.changes, from] } }
}

// Der vorgeschlagene Weg (Entwurf 3.1, 11.2): bei getrennter Abrechnung Weg d, sonst die eigene
// Heizperiode in der Gesamtabrechnung (Weg b), wenn schon Daten im Zeitraum des Objekts stehen, sonst
// die Umstellung des ganzen Objekts (Weg a). Jeder Weg nennt den Zustimmungsvorbehalt (A3).
export function suggestedWay(input: { differs: boolean; separate: SeparateChoice; hasCalendarData: boolean }): { way: 'a' | 'b' | 'd'; text: string } | null {
  if (!input.differs) return null
  const contract = ' Legt Ihr Mietvertrag den Abrechnungszeitraum fest, braucht die Änderung die Zustimmung der Mieter.'
  if (input.separate === 'yes') {
    return { way: 'd', text: 'Vorgeschlagen: eine eigene Heizkostenabrechnung je Heizperiode, mit eigener Frist. Mietfuchs teilt dafür die bisherige Vorauszahlung auf; die Vorschau zeigt jeden Betrag. Das ist eine Auslegung des Gesetzes.' + contract }
  }
  if (input.hasCalendarData) {
    return { way: 'b', text: 'Vorgeschlagen: Die Heizkosten einer Heizperiode stehen in der Betriebskostenabrechnung des Zeitraums, in dem sie endet. Das ist bei einer gemeinsamen Vorauszahlung zulässig (BGH, Urteil vom 30.04.2008, VIII ZR 240/07).' + contract }
  }
  return { way: 'a', text: 'Vorgeschlagen: den Abrechnungszeitraum des ganzen Objekts auf den Zeitraum des Messdienstes umstellen (Karte „Abrechnungszeitraum“).' + contract }
}

// Die drei Wege, wenn der Messdienst in einem anderen Zeitraum abrechnet als die Betriebskosten
// (Nutzerwunsch vom 05.10.2026 zu Einrichtung Schritt 3). Vorgabe ist Weg 1, die eigene Heizperiode in
// der Gesamtabrechnung: BGH, Urteil vom 30.04.2008, VIII ZR 240/07, Leitsatz a, lässt sie zu, wenn
// die Heizkosten nicht getrennt abgerechnet werden, also bei einer gemeinsamen Vorauszahlung; nach
// Leitsatz b läuft die Frist dann ab dem Ende des Abrechnungszeitraums der Gesamtabrechnung. Wer die
// Heizkosten getrennt abrechnet, bekommt keine Vorgabe unter den dreien (dafür `suggestedWay`, Weg d).
export type HeatingWay = {
  id: 'own' | 'object' | 'service'
  title: string
  how: string
  pros: string[]
  cons: string[]
  example?: string
  why?: string
  recommended: boolean
}

// Rechnet das Objekt im Kalenderjahr ab? Für die Wege oben.
export const isCalendarObject = (rules: PeriodRules): boolean => isCalendarRules(rules)

export function heatingWays(input: { objectCalendar: boolean; separate: SeparateChoice }): HeatingWay[] {
  const common = input.separate !== 'yes'
  const basis = input.objectCalendar ? 'Ihre Nebenkosten laufen nach Kalenderjahr' : 'Ihre Nebenkosten laufen in einem eigenen Zeitraum'
  const why = input.separate === 'no'
    ? `Vorgabe, weil ${basis.charAt(0).toLowerCase()}${basis.slice(1)} und eine gemeinsame Vorauszahlung gilt: Dann darf die Heizperiode des Messdienstes in der Betriebskostenabrechnung stehen, und die Frist richtet sich nach dem Zeitraum der Betriebskostenabrechnung (BGH, Urteil vom 30.04.2008, VIII ZR 240/07).`
    : `Vorgabe, sofern eine gemeinsame Vorauszahlung für alle Nebenkosten gilt (${basis}): Dann darf die Heizperiode des Messdienstes in der Betriebskostenabrechnung stehen (BGH, Urteil vom 30.04.2008, VIII ZR 240/07). Bitte beantworten Sie dazu die Frage unten.`
  return [
    {
      id: 'own',
      title: input.objectCalendar ? 'Kalenderjahr, Heizung in der Heizperiode des Messdienstes' : 'Zeitraum des Objekts, Heizung in der Heizperiode des Messdienstes',
      how: 'Wählen Sie hier „Ein eigener Zeitraum“ und den Monat, in dem die Heizperiode des Messdienstes beginnt. Die Heizkosten stehen dann in der Abrechnung, in der ihre Heizperiode endet.',
      pros: [
        'Nichts muss umgestellt werden: Messdienst und Betriebskostenabrechnung bleiben, wie sie sind.',
        'Grundsteuer, Versicherung und andere Jahresrechnungen bleiben in ihrem Jahr.',
      ],
      cons: [
        'Heizkosten und übrige Kosten betreffen verschiedene Zeiträume; das erklärt die Abrechnung, Mieter fragen trotzdem nach.',
        'Wer ausgezogen ist, bekommt im Jahr danach noch eine Abrechnung nur mit Heizkosten. Ob dafür die spätere Frist gilt, ist nicht entschieden; Mietfuchs empfiehlt die frühere.',
      ],
      example: 'Beispiel: Der Messdienst rechnet von Mai bis April ab. Die Heizperiode 01.05.2025–30.04.2026 steht in der Betriebskostenabrechnung 2026, dem Jahr, in dem sie endet.',
      why,
      recommended: common,
    },
    {
      id: 'object',
      title: 'Alles auf den Zeitraum des Messdienstes umstellen',
      how: 'Stellen Sie in der Karte „Abrechnungszeitraum“ den Zeitraum des ganzen Objekts um, etwa auf Mai bis April. Die Heizung folgt dann dem Objekt.',
      pros: ['Ein Zeitraum für alle Kosten; die Abrechnung ist am leichtesten zu lesen.'],
      cons: [
        'Beim Umstellen entsteht ein Rumpfzeitraum, und Rechnungen über das Kalenderjahr (Grundsteuer, Versicherung) werden nach Tagen auf zwei Abrechnungen aufgeteilt.',
        'Legt Ihr Mietvertrag das Kalenderjahr fest, braucht die Umstellung die Zustimmung der Mieter.',
      ],
      recommended: false,
    },
    {
      id: 'service',
      title: 'Den Messdienst auf den 31.12. umstellen lassen',
      how: 'Bitten Sie Ihren Messdienst, künftig zum 31.12. abzulesen und abzurechnen. Danach wählen Sie hier „Wie der Abrechnungszeitraum des Objekts“.',
      pros: ['Danach gibt es keinen Unterschied mehr: Alle Kosten gelten für das Kalenderjahr.'],
      cons: [
        'Der Messdienst muss mitmachen; die Umstellung kann eine Zwischenablesung und zusätzliche Kosten bedeuten.',
        'Bis zur Umstellung bleibt eine Heizperiode, die nicht zum Kalenderjahr passt; für sie gilt Weg 1.',
      ],
      recommended: false,
    },
  ]
}

// Die Zeilen der Karte zum Zeitraum der Heizung.
export function heatingPeriodSummary(plant: HeatingPlant, objectRules: PeriodRules): string[] {
  if (!hasOwnRhythm(plant)) {
    return plant.separateSettlement === true
      ? ['Zeitraum der Heizung: wie das Objekt', 'Heizvorauszahlung getrennt ausgewiesen']
      : ['Zeitraum der Heizung: wie das Objekt']
  }
  const lines = [`Zeitraum der Heizung: ${rhythmText(plantRules(plant, objectRules))}`]
  for (const s of plant.separateSpans) {
    lines.push(s.until === null
      ? `Heizkosten getrennt abgerechnet ab ${monthSpanText([s.from])}`
      : `Heizkosten getrennt abgerechnet von ${monthSpanText([s.from])} bis vor der Heizperiode ab ${monthSpanText([s.until])}`)
  }
  return lines
}

const euroText = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const monthText = (month: string): string => `${month.slice(5, 7)}/${month.slice(0, 4)}`

// ---------- Antworten zur Vorschau „Zeitraum der Heizung“ ----------

// Beträge je Frage unter dem Schlüssel `Mietverhältnis|Art|Zeitraum`, „keine Korrektur“ eigens.
export type HeatingPeriodAnswerForm = { groups: Record<string, string>; amounts: Record<string, string>; none: Record<string, boolean> }

export function initialHeatingPeriodAnswers(p: HeatingPeriodChangePreview): HeatingPeriodAnswerForm {
  return { groups: Object.fromEntries(p.groups.map((g) => [g.from, g.suggested])), amounts: {}, none: {} }
}

export function heatingPeriodAnswersOf(p: HeatingPeriodChangePreview, form: HeatingPeriodAnswerForm): HeatingPeriodChangeAnswers | { error: string } {
  const overrides: Record<string, Record<string, number | null>> = {}
  const totals: Record<string, Record<string, number | null>> = {}
  for (const o of p.overrides) {
    for (const a of o.ask) {
      const key = `${o.tenancyId}|${a.kind}|${a.period}`
      const cents = form.none[key] ? null : parseEuro(form.amounts[key] ?? '')
      if (!form.none[key] && (cents === null || cents < 0)) return { error: `Bitte tragen Sie für ${o.tenantName} den Betrag ${a.months} ein oder setzen Sie „keine Korrektur“.` }
      const target = a.kind === 'heating' ? overrides : totals
      target[o.tenancyId] = { ...(target[o.tenancyId] ?? {}), [a.period]: cents }
    }
  }
  return { groups: form.groups, overrides, totals, token: p.token }
}

// ---------- Antworten zur Vorschau „getrennte Heizkostenabrechnung“ ----------

// Heizanteil je Stufe unter `Mietverhältnis|Monat`, Beträge der Korrekturen unter
// `Mietverhältnis|Art|Zeitraum`; beim Ausschalten „keine Korrektur“ eigens und die Frage nach dem
// Zusammenführen (Vorgabe ja).
export type SeparateAnswerForm = { steps: Record<string, string>; amounts: Record<string, string>; none: Record<string, boolean>; merge: boolean }

export function initialSeparateAnswers(p: SeparatePreview): SeparateAnswerForm {
  return {
    steps: Object.fromEntries(p.steps.flatMap((s) => s.rows.map((r) => [`${s.tenancyId}|${r.from}`, euroText(r.heatingCents)]))),
    amounts: {}, none: {}, merge: true,
  }
}

export function separateAnswersOf(p: SeparatePreview, form: SeparateAnswerForm): SeparateAnswers | { error: string } {
  const steps: Record<string, Record<string, number>> = {}
  for (const s of p.steps) {
    for (const r of s.rows) {
      const cents = parseEuro(form.steps[`${s.tenancyId}|${r.from}`] ?? '')
      if (cents === null || cents < 0) return { error: `Bitte tragen Sie den Heizanteil von ${s.tenantName} ab ${monthText(r.from)} ein.` }
      if (cents > r.totalCents) return { error: `Der Heizanteil von ${s.tenantName} ab ${monthText(r.from)} liegt über der Vorauszahlung von ${euroText(r.totalCents)} €.` }
      steps[s.tenancyId] = { ...(steps[s.tenancyId] ?? {}), [r.from]: cents }
    }
  }
  const totals: Record<string, Record<string, number | null>> = {}
  const overrides: Record<string, Record<string, number>> = {}
  for (const o of p.overrides) {
    for (const a of o.asks) {
      const key = `${o.tenancyId}|${a.kind}|${a.period}`
      const allowNone = !p.separate && a.kind === 'total'
      const cents = allowNone && form.none[key] ? null : parseEuro(form.amounts[key] ?? '')
      if (!(allowNone && form.none[key]) && (cents === null || cents < 0)) return { error: `Bitte tragen Sie für ${o.tenantName} „${a.label}“ ein.` }
      if (a.kind === 'total') totals[o.tenancyId] = { ...(totals[o.tenancyId] ?? {}), [a.period]: cents }
      else if (cents !== null) overrides[o.tenancyId] = { ...(overrides[o.tenancyId] ?? {}), [a.period]: cents }
    }
  }
  return { steps, totals, overrides, merge: form.merge, token: p.token }
}

// Die Einrichtung „Heizung“, Schritt 3 (Heizung PR 5, Entwurf 11.2): für welchen Zeitraum die Heizung
// abrechnet, ob die Heizkosten getrennt abgerechnet werden, welcher Weg vorgeschlagen wird (3.1), und
// die Antworten zu den beiden Vorschauen (Zeitraum der Heizung, getrennte Abrechnung). Ohne DOM prüfbar.
import { parseEuro } from './api'
import { monthFieldError, rhythmText, type MonthFieldError } from './periodForm'
import { hasOwnRhythm, monthSpanText, plantRules } from '../../shared/heatingPeriod.ts'
import { isCalendarRules, parsePeriodKey } from '../../shared/period.ts'
import { secondPrepaymentLabel } from '../../shared/heatingModel.ts'
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
export function heatingRulesBody(form: HeatingPeriodForm, plant: HeatingPlant, objectRules: PeriodRules): { rules: PeriodRules | null } | MonthFieldError {
  if (form.choice === 'object') return { rules: null }
  if (form.mode === 'start') return { rules: { startMonth: form.month, changes: [] } }
  const from = parsePeriodKey(form.from)
  if (from === null) return monthFieldError(form.from, 'Bitte geben Sie den Monat an, ab dem die Heizung im neuen Zeitraum abrechnet.', 'Neue Heizperiode')
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
    return { way: 'd', text: 'Vorgeschlagen: eine eigene Heizkostenabrechnung je Heizperiode, mit eigener Frist. Dafür teilt Mietfuchs die bisherige Vorauszahlung auf: Nach „Speichern“ folgt gleich ein zweiter Schritt mit jedem Betrag, und erst wenn Sie auch ihn speichern, ist die getrennte Abrechnung eingeschaltet. Das ist eine Auslegung des Gesetzes.' + contract }
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
    : `Vorgabe, sofern Ihre Mieter eine einzige Vorauszahlung für alle Nebenkosten zahlen, die Heizung eingeschlossen: Dann darf die Heizperiode des Messdienstes in der Betriebskostenabrechnung stehen (BGH, Urteil vom 30.04.2008, VIII ZR 240/07). Bitte beantworten Sie dazu die Frage unten.`
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
        'Legt Ihr Mietvertrag fest, dass auch die Heizkosten nach Kalenderjahr abgerechnet werden, braucht die eigene Heizperiode die Zustimmung der Mieter.',
      ],
      // Laienprobe B14: Das Beispiel passt zum Zeitraum des Objekts.
      example: input.objectCalendar
        ? 'Beispiel: Der Messdienst rechnet von Mai bis April ab. Die Heizperiode 01.05.2025–30.04.2026 steht in der Betriebskostenabrechnung 2026, dem Jahr, in dem sie endet.'
        : 'Beispiel: Der Messdienst rechnet von Mai bis April ab. Die Heizperiode 01.05.2025–30.04.2026 steht in der Betriebskostenabrechnung des Zeitraums, in dem der 30.04.2026 liegt.',
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
export type HeatingPeriodAnswerForm = { groups: Record<string, string>; moves: Record<string, string>; amounts: Record<string, string>; none: Record<string, boolean> }

export function initialHeatingPeriodAnswers(p: HeatingPeriodChangePreview): HeatingPeriodAnswerForm {
  return { groups: Object.fromEntries(p.groups.map((g) => [g.from, g.suggested])), moves: Object.fromEntries(p.moves.map((m) => [m.costItemId, m.to])), amounts: {}, none: {} }
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
  return { groups: form.groups, moves: form.moves, overrides, totals, token: p.token }
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

// Überschrift, Satz und Frage des Bereichs „getrennte Heizkostenabrechnung“ (Sichtprüfung E7). Nach
// „Speichern“ im Zeitraum der Heizung mit „getrennt: Ja“ öffnet er sich als zweiter Schritt; vorher
// stand dort nur „Ab welchem Monat?“, und niemand erfuhr, wozu.
// `span`: Läuft eine getrennte Heizkostenabrechnung (offene Spanne)? Ohne Angabe wie `own`. Ohne Spanne gibt es nur zwei
// Vorauszahlungen, die wieder eine werden; das Fenster heißt dann wie sein Knopf (#704).
export function separatePanelIntro(input: { separateOn: boolean; own: boolean; span?: boolean; afterPeriodChange: boolean }): { title: string; text: string; monthLabel: string } {
  const span = input.span ?? input.own
  if (input.separateOn) {
    return {
      // #704: Ohne eigene Heizperiode gibt es keine getrennte Abrechnung, nur zwei Vorauszahlungen; das Fenster heißt wie sein Knopf.
      title: span ? 'Getrennte Heizkostenabrechnung ausschalten' : 'Vorauszahlung wieder zusammenführen',
      text: span
        ? 'Ab der gewählten Heizperiode stehen die Heizkosten wieder in der Betriebskostenabrechnung, und diese rechnet auch die Heizvorauszahlung an. Frühere Heizperioden bleiben getrennt abgerechnet. Die Vorschau zeigt, was sich ändert.'
        : 'Ab dem gewählten Monat gibt es wieder eine gemeinsame Vorauszahlung: Mietfuchs zählt Heizvorauszahlung und übrige Vorauszahlung je Mietverhältnis zusammen. Die Vorschau zeigt die Beträge.',
      monthLabel: span ? 'Ab welcher Heizperiode wieder gemeinsam? (Monat ihres Beginns)' : 'Ab welchem Monat?',
    }
  }
  if (!input.own) {
    return {
      title: 'Vorauszahlung aufteilen',
      text: 'Ab dem gewählten Monat führt Mietfuchs die Heizvorauszahlung als eigene Staffel, und die Abrechnung weist beide Vorauszahlungen getrennt aus. Es bleibt bei einer Abrechnung, und an der Summe je Monat ändert sich nichts. Die Vorschau zeigt, wie die bisherige Vorauszahlung aufgeteilt wird; lassen Sie das Feld leer, schlägt sie einen Monat vor.',
      monthLabel: 'Ab welchem Monat?',
    }
  }
  return {
    title: `${input.afterPeriodChange ? 'Schritt 2 von 2: ' : ''}Getrennte Heizkostenabrechnung einschalten`,
    text: 'Ab dem gewählten Monat zahlen die Mieter eine eigene Heizkostenvorauszahlung, und jede Heizperiode bekommt eine eigene Heizkostenabrechnung mit eigener Frist. Die Vorschau zeigt, wie die bisherige Vorauszahlung aufgeteilt wird; lassen Sie das Feld leer, schlägt sie einen Monat vor.',
    monthLabel: 'Ab welchem Monat zahlen die Mieter eine eigene Heizkostenvorauszahlung?',
  }
}

// ---------- Wege zur getrennten Vorauszahlung (#704) ----------

// Die Knöpfe einer Anlage, **abgeleitet aus dem, was der Server annimmt** (separateSettlement.ts), nicht aus dem Rhythmus
// allein (Durchsicht M1, M2):
// - Offene Spanne (Weg d läuft, auch wenn der Zeitraum inzwischen „wie das Objekt“ heißt): nur ausschalten, mit der
//   Heizperiode (`until`); einschalten lehnte der Server ab.
// - Sonst einschalten (eigene Heizperiode) bzw. aufteilen (wie das Objekt: keine getrennte Abrechnung, nur zwei
//   Vorauszahlungen in einer Abrechnung), auch erneut, etwa für ein Mietverhältnis ohne Heizstaffel. Nach einem
//   Kesseltausch lehnt der Server das Aufteilen ab (M5); dann gibt es den Knopf nicht.
// - Ist ohne Spanne aufgeteilt (`separateSettlement`), gibt es zusammenführen, mit dem Monat (`month`), gleich welcher
//   Rhythmus heute gilt: sonst bliebe nach einem Wechsel des Zeitraums eine Aufteilung ohne Rückweg.
// Vorher hing der Knopf an der gespeicherten Antwort „getrennt“, die bei gleichem Zeitraum niemand erfragte.
export type SeparateMode = 'on' | 'off'
export type SeparateAction = { mode: SeparateMode; label: string }

const hasOpenSpan = (plant: HeatingPlant): boolean => plant.separateSpans.some((s) => s.until === null)
// Fehlt die Angabe (ältere Antwort, Testattrappe), gab es keinen Tausch.
export const wasSwapped = (plant: Pick<HeatingPlant, 'endsOn' | 'replacesPlantId'>): boolean => (plant.endsOn ?? null) !== null || (plant.replacesPlantId ?? null) !== null

export function separateActions(plant: HeatingPlant): SeparateAction[] {
  if (hasOpenSpan(plant)) return [{ mode: 'off', label: 'Getrennte Heizkostenabrechnung ausschalten' }]
  const own = hasOwnRhythm(plant)
  const actions: SeparateAction[] = []
  // Nach einem Kesseltausch lehnt der Server Einschalten wie Aufteilen ab (planOn), gleich welcher Rhythmus.
  if (!wasSwapped(plant)) actions.push({ mode: 'on', label: own ? 'Getrennte Heizkostenabrechnung einschalten' : 'Vorauszahlung aufteilen' })
  if (plant.separateSettlement === true) actions.push({ mode: 'off', label: 'Vorauszahlung wieder zusammenführen' })
  return actions
}

// Der Rumpf zum Ausschalten bzw. Zusammenführen: Mit offener Spanne liest der Server die Heizperiode (`until`), ohne den
// Monat (`month`, planOff); im jeweils anderen Feld ginge ein gewählter Monat still verloren.
export function separateOffBody(plant: HeatingPlant, month: string): { separate: false; until?: string; month?: string } {
  if (!month) return { separate: false }
  return hasOpenSpan(plant) ? { separate: false, until: month } : { separate: false, month }
}

// Der Satz in der Karte bei einer Anlage, die wie das Objekt abrechnet: wozu der Knopf da ist, und nach dem Aufteilen,
// wozu man ihn noch einmal braucht (Durchsicht K6).
export function splitHint(plant: HeatingPlant): string | null {
  if (hasOwnRhythm(plant) || hasOpenSpan(plant) || wasSwapped(plant)) return null
  return plant.separateSettlement === true
    // #712: Die zweite Vorauszahlung heißt, wie die Auswahl darunter sie führt.
    ? `Die Vorauszahlung ist aufgeteilt in ${secondPrepaymentLabel(plant.secondPrepaymentCoversWater, 'short')} und übrige Nebenkosten. Mit „Vorauszahlung aufteilen“ ändern Sie die Aufteilung, etwa für ein Mietverhältnis, dem die ${plant.secondPrepaymentCoversWater === true ? 'zweite Vorauszahlung' : 'Heizvorauszahlung'} fehlt.`
    : 'Zahlen Ihre Mieter laut Mietvertrag eine eigene Vorauszahlung für Heizung und Warmwasser neben der für die übrigen Nebenkosten? Mit „Vorauszahlung aufteilen“ führt Mietfuchs beide getrennt, und die Abrechnung weist sie getrennt aus.'
}

// Die Meldung nach dem Speichern: Bei gleichem Zeitraum gibt es keine getrennte Abrechnung, die ein- oder ausgeschaltet würde.
export function separateSavedText(preview: Pick<SeparatePreview, 'separate' | 'way'>): string {
  if (preview.way === 'samePeriod') {
    return preview.separate
      ? 'Vorauszahlung aufgeteilt. Neue Mietverhältnisse bekommen ihre Heizvorauszahlung im Formular des Mietverhältnisses.'
      : 'Vorauszahlung wieder zusammengeführt.'
  }
  return preview.separate ? 'Getrennte Heizkostenabrechnung eingeschaltet.' : 'Getrennte Heizkostenabrechnung ausgeschaltet.'
}

// ---------- Was die zweite Vorauszahlung deckt (#712) ----------

// Die Wahl steht dort, wo die Vorauszahlung aufgeteilt wird, und nur, wo sie wirkt: aufgeteilt und gemeinsam abgerechnet
// (Zeitraum wie das Objekt, keine getrennte Heizkostenabrechnung). Bei einer eigenen Heizperiode sagt ein Satz, warum es
// sie nicht gibt; ohne zwei Vorauszahlungen steht nichts da. Die Bezeichnungen kommen aus `secondPrepaymentLabel`, damit
// die Auswahl so heißt wie der zweite Teil in Abrechnung und Anschreiben.
export type SecondPrepaymentChoice = 'heating' | 'water'
export const SECOND_PREPAYMENT_OPTIONS: { value: SecondPrepaymentChoice; label: string }[] = [
  { value: 'heating', label: secondPrepaymentLabel(false) },
  { value: 'water', label: secondPrepaymentLabel(true) },
]
export const SECOND_PREPAYMENT_QUESTION = 'Was deckt die zweite Vorauszahlung?'
export const SECOND_PREPAYMENT_HELP = 'Rechnet Ihr Messdienst neben Heizung und Warmwasser auch Kaltwasser und Abwasser ab und zahlen Ihre Mieter dafür eine gemeinsame Vorauszahlung, wählen Sie den zweiten Eintrag. Das ändert keine Summe der Abrechnung, nur die Bezeichnung der zweiten Vorauszahlung und den Anteil je Teil, wenn die Vorauszahlung angepasst wird. Die Staffel der Heizvorauszahlung enthält dann auch die Vorauszahlung für Wasser/Abwasser: Mietfuchs verschiebt keine Beträge zwischen den Staffeln, prüfen Sie deshalb die beiden Beträge an jedem Mietverhältnis.'
export const SECOND_PREPAYMENT_OWN_PERIOD_NOTE = 'Die Heizvorauszahlung gilt hier nur Heizung und Warmwasser: Die Heizkostenabrechnung je Heizperiode rechnet nur Heizung und Warmwasser ab, Wasser und Abwasser bleiben bei den übrigen Nebenkosten.'

export const secondPrepaymentValue = (plant: Pick<HeatingPlant, 'secondPrepaymentCoversWater'>): SecondPrepaymentChoice => (plant.secondPrepaymentCoversWater === true ? 'water' : 'heating')
export const secondPrepaymentBody = (value: SecondPrepaymentChoice): { secondPrepaymentCoversWater: boolean } => ({ secondPrepaymentCoversWater: value === 'water' })

// `choice`: die Auswahl; `note`: nur der Satz, warum es sie nicht gibt; `null`: nichts (keine zwei Vorauszahlungen, oder
// die Anlage ist stillgelegt und die Angabe steht an ihrer Nachfolgerin).
export function secondPrepaymentState(plant: HeatingPlant): { kind: 'choice' } | { kind: 'note'; text: string } | null {
  if ((plant.endsOn ?? null) !== null) return null
  if (hasOwnRhythm(plant) || hasOpenSpan(plant)) {
    return hasOpenSpan(plant) || plant.separateSettlement === true || plant.secondPrepaymentCoversWater === true ? { kind: 'note', text: SECOND_PREPAYMENT_OWN_PERIOD_NOTE } : null
  }
  return plant.separateSettlement === true ? { kind: 'choice' } : null
}

// Die Karte „CO₂-Kosten“ der Seite Heizkosten (Heizung PR 6, Entwurf 11.3): was der Vermieter aus
// der Abrechnung des Messdienstes oder der Gemeinschaft überträgt, ohne DOM, damit es ohne Browser
// prüfbar ist. Die Probe rechnet shared/co2Probe.ts, dieselbe Funktion wie die Abrechnung.
//
// Die Frage nach der Abzugszeile hat keine Vorgabe (Entwurf 7.2): Ob abgezogen wurde, steht nur auf
// dem Papier, und eine Vorgabe wäre bei einem Teil der Messdienste falsch.
import { fmtEuro, parseEuro } from './api'
import { parseNumberDe } from './numbers'
import { CO2_DEDUCTED_LABEL, CO2_EMISSIONS_FIELD, CO2_ENCLOSED_LABEL, CO2_ENCLOSED_LABEL_HOMEOWNERS, CO2_ENTER_LABEL, CO2_SHOWN_LABEL, ENCLOSED_SELF_USED, enclosedCondition, enteredCentsOf, includesWaterProbeText, serviceProbe } from '../../shared/co2Probe.ts'
import { andList } from '../../shared/wording.ts'
import { plantSpan, sameBuilding, sameLine } from '../../shared/heatingPeriod.ts'
import { asksCo2Facts } from './fuelForm'
import type { Co2Method, Co2Statement, HeatingPeriodView } from './types'
import { KEY_LABELS } from './types'

export type Co2Answer = '' | 'deducted' | 'shown' | 'unsplit'
// Die zweite Wahl, nur nach „Ja, es gibt eine Abzugszeile“ (#704, Durchsicht M1): die Angaben eintragen (`serviceDeducted`,
// Voreinstellung und bisheriges Verhalten) oder nicht eintragen, weil die Abrechnung des Messdienstes beiliegt
// (`serviceEnclosed`). Bei „nur ausgewiesen“ gibt es sie nicht: Dort muss Mietfuchs den Anteil des Vermieters abziehen.
export type Co2Entry = 'enter' | 'enclosed'
const methodOf = (form: Pick<Co2Form, 'answer' | 'entry'>): Co2Method | null =>
  form.answer === '' ? null : form.answer === 'shown' ? 'serviceShown' : form.answer === 'unsplit' ? 'selfAfterService' : form.entry === 'enclosed' ? 'serviceEnclosed' : 'serviceDeducted'
const answerOf = (m: Co2Method): Co2Answer =>
  m === 'serviceDeducted' || m === 'serviceEnclosed' ? 'deducted' : m === 'serviceShown' ? 'shown' : m === 'selfAfterService' ? 'unsplit' : ''
// Ob „liegt bei“ gewählt ist: nur zusammen mit der Antwort „Ja“.
export const isEnclosed = (form: Pick<Co2Form, 'answer' | 'entry'>): boolean => form.answer === 'deducted' && form.entry === 'enclosed'

// Gefragt wird nur nach der Zeile in der Kostenaufstellung, die den Anteil vor der Verteilung abzieht
// (Durchsicht I1). „Vom Vermieter übernommen“ bei den einzelnen Nutzern weisen Messdienste auch ohne
// Abzug aus; wer daran „Ja“ festmacht, antwortet falsch.
export const CO2_QUESTION = 'Steht in der Kostenaufstellung der Heizkosten eine Zeile, die den CO₂-Anteil des Vermieters vor der Verteilung abzieht, etwa „Abzüglich CO₂-Kosten Vermieter“?'
export const CO2_NOT_A_SIGN = 'Ein Betrag „vom Vermieter übernommen“ bei den einzelnen Mietern ist dafür kein Zeichen: Den weisen Messdienste auch aus, wenn sie nichts vorab abziehen.'
// Die Beispielzeile aus dem Techem-Muster (Entwurf 7.2).
export const CO2_EXAMPLE = 'Beispiel aus einer Musterabrechnung: Anlieferung Brennstoff 3.540,00 · Abzüglich CO₂-Kosten Vermieter −87,50 · Verbrauch 3.452,50'
export const CO2_ANSWER_OPTIONS: readonly { value: Co2Answer; label: string }[] = [
  { value: '', label: 'Bitte wählen …' },
  { value: 'deducted', label: CO2_DEDUCTED_LABEL },
  { value: 'shown', label: CO2_SHOWN_LABEL },
  { value: 'unsplit', label: 'Der Messdienst hat die CO₂-Kosten gar nicht aufgeteilt' },
]
// Bei einer Eigentumswohnung rechnet die Gemeinschaft ab (Abdeckung V14); die Karte zeigt dann diese Beschriftungen.
const HOMEOWNERS_LABELS: Partial<Record<Co2Answer, string>> = { unsplit: 'Die Abrechnung der Gemeinschaft teilt die CO₂-Kosten gar nicht auf' }
export const co2AnswerLabel = (option: { value: Co2Answer; label: string }, homeowners: boolean): string => (homeowners ? HOMEOWNERS_LABELS[option.value] : undefined) ?? option.label

// Die zweite Wahl unter der Antwort „Ja“.
export const CO2_ENTRY_QUESTION = 'Tragen Sie die CO₂-Angaben der Abrechnung hier ein?'
export const CO2_ENTRY_OPTIONS: readonly { value: Co2Entry; label: string }[] = [
  { value: 'enter', label: CO2_ENTER_LABEL },
  { value: 'enclosed', label: CO2_ENCLOSED_LABEL },
]
export const co2EntryLabel = (option: { value: Co2Entry; label: string }, homeowners: boolean): string => (homeowners && option.value === 'enclosed' ? CO2_ENCLOSED_LABEL_HOMEOWNERS : option.label)
// Ob die Karte die zweite Wahl zeigt: nach „Ja“, und nur, wo es CO₂-Kosten aufzuteilen gibt (Durchsicht S11; bei
// Pellets, Holz oder Wärmepumpe wäre „liegt bei“ ohne Wirkung). Ein gespeichertes „liegt bei“ bleibt immer sichtbar,
// sonst zeigte die Karte etwas anderes, als gespeichert ist.
export const showsEntry = (form: Pick<Co2Form, 'answer' | 'entry'>, ctx: Pick<Co2Context, 'offersEnclosed'>): boolean =>
  form.answer === 'deducted' && (ctx.offersEnclosed !== false || form.entry === 'enclosed')

// Der Hilfesatz unter „liegt bei“ (#704): zuerst die Voraussetzung (Durchsicht M1), dann was Mietfuchs tut, dann die
// Pflicht des Vermieters mit dem Vorbehalt, dass nicht entschieden ist, ob der Verweis genügt (Durchsicht S6). Den
// Kürzungssatz nennt der Hinweis der Abrechnung (er steht im Rechtsregister), hier steht er nicht.
export const co2EnclosedHelp = (homeowners: boolean): string =>
  `${enclosedCondition(homeowners)} Mietfuchs prüft und bucht dann keine CO₂-Aufteilung; die Abrechnung jedes Mieters verweist auf die beiliegende ${homeowners ? 'Einzelabrechnung der Heizkosten' : 'Heizkostenabrechnung des Messdienstes'}. ` +
  'Nach § 7 Abs. 3 CO2KostAufG weisen Sie in der Heizkostenabrechnung den Anteil des Mieters an den CO₂-Kosten, die Einstufung des Gebäudes und die Berechnungsgrundlagen aus; fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten kürzen (§ 7 Abs. 4 CO2KostAufG). ' +
  `Ob der Verweis auf die beiliegende Abrechnung ${homeowners ? 'der Gemeinschaft' : 'des Messdienstes'} dafür genügt, ist nicht entschieden.`
export const CO2_ENCLOSED_TAX = `Für die Steuer: Den CO₂-Anteil des Vermieters kennt Mietfuchs dann nicht als eigenen Posten. Wer ihn als Werbungskosten ansetzen will, nimmt als Betrag der Position die Summe aller Nutzer plus diesen Anteil. ${ENCLOSED_SELF_USED}`
// Durchsicht S2: Heizt im selben Gebäude oder in derselben Linie eine zweite Anlage, braucht deren Einstufung den Ausstoß
// dieser Anlage; nur dann zeigt die Karte bei „liegt bei“ dieses eine Feld. Die Fläche liest die Berechnung nicht.
export const CO2_ENCLOSED_JOINT = 'Diese Anlage wird gemeinsam mit einer weiteren eingestuft. Tragen Sie deshalb den CO₂-Ausstoß dieser Anlage aus der Abrechnung ein; sonst stuft Mietfuchs die andere Anlage ohne ihn ein, und die Stufe kann falsch liegen.'
// Ob die Anlage in der Heizperiode der Ansicht gemeinsam mit einer anderen eingestuft wird (Nachprüfung 3): eine Anlage
// derselben Linie (Kesseltausch) oder desselben Gebäudes, die in dieser Heizperiode heizt (nach einem Tausch also nur in
// der Heizperiode des Tauschs) und selbst eine CO₂-Einstufung braucht (`asksCo2Facts`, wie `co2Required` am Server).
type JointPlant = Parameters<typeof plantSpan>[0] & Parameters<typeof sameBuilding>[0] & Parameters<typeof asksCo2Facts>[0]
export const classifiedJointly = (plant: JointPlant, plants: readonly JointPlant[], view: { from: string; to: string }): boolean =>
  plants.some((other) => {
    if (!sameLine(plant, other, plants) && !sameBuilding(plant, other, plants)) return false
    const span = plantSpan(other, plants)
    return (span.to === null || span.to >= view.from) && (span.from === null || span.from <= view.to) && asksCo2Facts(other)
  })
export { CO2_EMISSIONS_FIELD }

// Sammelbetrag des Messdienstes (#704): Steckt Wasser im Betrag einer Messdienstposition und ist eine Antwort mit Probe
// gewählt, sagt die Karte, warum die Probe nicht aufgehen kann, nennt den Weg zu „liegt bei“ und sagt, dass der
// Sammelbetrag bei „nur ausgewiesen“ nicht passt. Derselbe Satz wie in der Meldung `co2.sum-check` der Abrechnung.
export function includesWaterNote(form: Pick<Co2Form, 'answer' | 'entry'>, ctx: Co2Context): string | null {
  if ((form.answer !== 'deducted' && form.answer !== 'shown') || isEnclosed(form)) return null
  const combined = serviceItemsOf(ctx).filter((i) => i.includesWater === true)
  if (combined.length === 0) return null
  return includesWaterProbeText(andList(combined.map((i) => `„${i.description}“`)), combined.length > 1, ctx.homeowners === true)
}

export type Co2Form = {
  answer: Co2Answer
  entry: Co2Entry // die zweite Wahl nach „Ja“; ohne Bedeutung bei den anderen Antworten
  usersTotal: string // S, wie gedruckt
  usersTotalApprox: boolean // „Ich finde diese Zeile nicht“
  vacancyTotal: string // Beträge leerer oder nicht eingetragener Einheiten (nur ohne S)
  kgPerM2: string
  emissionsKg: string // CO₂-Ausstoß insgesamt laut Abrechnung
  serviceArea: string // Wohnfläche laut Abrechnung
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
// `homeowners` (Abdeckung V14): Bei einer Eigentumswohnung rechnet die Gemeinschaft ab. Die Einzelabrechnung der
// eigenen Wohnung in der Hausgeldabrechnung nennt deren Heizkosten und den CO₂-Anteil des Vermieters für diese
// Wohnung; gemeint ist dann der eigene Anteil, nicht die Summe des ganzen Hauses, und die Abrechnung betrifft eine
// Nutzeinheit. Die Position trägt ja auch nur den eigenen Anteil.
// `offersEnclosed`: `false`, wo es keine CO₂-Kosten aufzuteilen gibt (die Karte bietet „liegt bei“ dann nicht an).
// `joint`: Im selben Gebäude oder in derselben Linie heizt eine weitere Anlage (gemeinsame Einstufung).
export type Co2Context = { items: HeatingPeriodView['items']; unitsCount: number; homeowners?: boolean; offersEnclosed?: boolean; joint?: boolean }

// Die Beschriftungen der Karte, je nachdem, wer abrechnet.
export function co2Labels(homeowners: boolean): { usersTotal: string; usersTotalHelp: string; landlordCo2: string; unitsCount: string; unitsHelp: string } {
  return homeowners
    ? {
        usersTotal: 'Heizkosten Ihrer Wohnung laut Einzelabrechnung (€)',
        usersTotalHelp: 'Aus der Einzelabrechnung Ihrer Wohnung in der Hausgeldabrechnung: die Kosten für Heizung und Warmwasser Ihrer Wohnung, bei einer Abzugszeile nach dem Abzug. Nicht gemeint ist die Summe des ganzen Hauses.',
        landlordCo2: 'davon Vermieter für Ihre Wohnung (€)',
        unitsCount: 'Nutzeinheiten (Ihre Wohnung)',
        unitsHelp: 'Die Einzelabrechnung der Gemeinschaft betrifft nur Ihre Wohnung, also eine Nutzeinheit. ',
      }
    : {
        usersTotal: 'Summe der Kosten aller Nutzer (€)',
        usersTotalHelp: 'Die gedruckte Summe für Heizung und Warmwasser aller Nutzer, bei einer Abzugszeile nach dem Abzug. Bei Techem heißt die Zeile „Summe der Nutzerkosten Heizungsanlage“, bei ista im Abschnitt „Aufteilung der Gesamtkosten“ der Gesamtbetrag der Zeile „Heiz- und Warmwasserkosten“; bei anderen Messdiensten steht sie in der Kostenaufstellung unter der Verteilung.',
        landlordCo2: 'davon Vermieter (€)',
        unitsCount: 'Nutzeinheiten laut Abrechnung',
        unitsHelp: 'Vorbelegt mit der Zahl der Wohnungen an dieser Heizung; maßgeblich ist die Zahl auf der Abrechnung des Messdienstes. ',
      }
}

const centsText = (c: number | null): string => (c === null ? '' : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
// Ohne Tausenderpunkt, damit das Feld so dasteht, wie man es tippt.
const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 4, useGrouping: false }))
const serviceItemsOf = (ctx: Co2Context) => ctx.items.filter((i) => i.key === 'amounts')

// Eine Zahl in deutscher („46,4“, „1.046,4“, „3.000“) oder technischer Schreibweise („46.4“); dieselbe Regel
// wie bei Beträgen (`parseNumberDe`, Durchsicht von #240, M3): „3.000“ sind dreitausend, nicht drei.
export function parseDecimal(text: string): number | null {
  return parseNumberDe(text)
}

export function co2ToForm(st: Co2Statement | null, ctx: Co2Context): Co2Form {
  const permille = st?.serviceLandlordPermille ?? null
  const S = st?.serviceUsersTotalCents ?? null
  return {
    answer: st ? answerOf(st.method) : '',
    entry: st?.method === 'serviceEnclosed' ? 'enclosed' : 'enter',
    usersTotal: st?.serviceUsersTotalApprox ? '' : centsText(S),
    usersTotalApprox: st?.serviceUsersTotalApprox ?? false,
    vacancyTotal: st?.serviceUsersTotalApprox && S !== null ? centsText(Math.max(0, S - enteredCentsOf(serviceItemsOf(ctx)))) : '',
    kgPerM2: numberText(st?.serviceKgPerM2 ?? null),
    emissionsKg: numberText(st?.serviceEmissionsKg ?? null),
    serviceArea: numberText(st?.serviceAreaM2 ?? null),
    landlordPercent: permille === null ? '' : numberText(permille / 10),
    totalCo2: centsText(st?.serviceTotalCents ?? null),
    landlordCo2: centsText(st?.serviceLandlordCents ?? null),
    selfLandlord: centsText(st?.serviceSelfLandlordCents ?? null),
    unitsCount: String(st?.serviceUnitsCount ?? (ctx.homeowners ? 1 : ctx.unitsCount)),
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
  const method = methodOf(form)
  if (method === null) return { error: 'Bitte beantworten Sie zuerst die Frage nach der Abzugszeile.' }
  // #704: Mit „liegt bei“ ist nichts weiter nötig, und nichts weiter wird geschickt. Der Server ergänzt nach Anwesenheit
  // eines Schlüssels: Was früher eingetragen war, bleibt gespeichert, und ein halb getipptes Feld hält das Speichern
  // nicht auf. Nur bei gemeinsamer Einstufung mit einer zweiten Anlage geht der Ausstoß mit (Durchsicht S2).
  if (method === 'serviceEnclosed') {
    if (!ctx.joint) return { body: { method } }
    const kg = form.emissionsKg.trim() === '' ? null : parseDecimal(form.emissionsKg)
    if (form.emissionsKg.trim() !== '' && (kg === null || kg < 0)) return { error: `Bitte prüfen Sie „${CO2_EMISSIONS_FIELD}“: keine Zahl ab 0.` }
    return { body: { method, serviceEmissionsKg: kg } }
  }
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
  const area = decimal(form.serviceArea, 'Wohnfläche laut Abrechnung (m²)')
  if (area !== null && area <= 0) errors.push('Bitte prüfen Sie „Wohnfläche laut Abrechnung (m²)“: eine Zahl größer als 0.')
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
    serviceEmissionsKg: decimal(form.emissionsKg, CO2_EMISSIONS_FIELD),
    serviceAreaM2: area !== null && area > 0 ? area : null,
    serviceLandlordPermille: percent === null ? null : Math.round(percent * 10),
    serviceTotalCents: cents(form.totalCo2, 'CO₂-Kosten insgesamt'),
    serviceSelfLandlordCents: cents(form.selfLandlord, 'davon für Ihre selbst bewohnte Wohnung'),
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
        : ctx.homeowners
          ? 'Bitte tragen Sie die Heizkosten Ihrer Wohnung laut Einzelabrechnung der Gemeinschaft ein, oder kreuzen Sie „Ich finde diese Zeile nicht“ an.'
          : 'Bitte tragen Sie die Summe der Kosten aller Nutzer ein, oder kreuzen Sie „Ich finde diese Zeile nicht“ an.' }
    }
    if (L === null) return { error: 'Bitte tragen Sie den CO₂-Anteil des Vermieters in Euro ein.' }
    if (unitsCount === null) return { error: 'Bitte tragen Sie die Zahl der Nutzeinheiten ein, mindestens 1.' }
  }
  return { body }
}

// Der Satz der Rückfrage, wenn die Probe nicht aufgeht: Endet die Probe schon mit einem Punkt (sie nennt dann beide
// Lesarten), folgt kein zweiter.
export function probeQuestion(probeText: string, advice: string): string {
  return `${probeText.replace(/\.$/, '')}. Solange die Probe nicht aufgeht, bucht Mietfuchs keine CO₂-Aufteilung, und die Abrechnung meldet einen Fehler. ${advice} Trotzdem speichern?`
}

// Die Probe unter der Karte (Entwurf 11.3): „Ihre Positionen: 3.933,01 € · erwartet: 3.933,01 € ✓“.
export function probeLine(form: Co2Form, ctx: Co2Context): { text: string; ok: boolean } | null {
  if ((form.answer !== 'deducted' && form.answer !== 'shown') || isEnclosed(form)) return null
  const S = usersTotalOf(form, ctx)
  const L = form.landlordCo2.trim() === '' ? null : parseEuro(form.landlordCo2)
  const units = Number(form.unitsCount)
  if (S === null || L === null || !Number.isInteger(units) || units < 1) return null
  const p = serviceProbe({ deducted: form.answer === 'deducted', items: serviceItemsOf(ctx), usersTotalCents: S, landlordCents: L, unitsCount: units, approx: form.usersTotalApprox })
  // Ohne Position mit Einzelbeträgen stand hier „Ihre Positionen: 0,00 €“ (Praxistest): Die Probe vergleicht nur
  // Positionen mit Einzelbeträgen und geht so nicht auf. Dann der Grund statt der Zahl, wie co2.sum-check auf dem Server.
  if (serviceItemsOf(ctx).length === 0 && !p.ok) {
    const others = ctx.items.map((i) => `„${i.description}“ (${KEY_LABELS[i.key]})`).join(', ')
    const advice = ctx.items.length === 0
      ? `Erfassen Sie die Heizkosten auf der Seite Kosten mit dieser Heizanlage und dem Schlüssel „${KEY_LABELS.amounts}“`
      : ctx.homeowners
        ? 'Übernehmen Sie an der Position den Betrag Ihrer Wohnung aus der Einzelabrechnung (Heizung) auf der Seite Kosten'
        : 'Übernehmen Sie die Einzelbeträge je Mieter an der Position auf der Seite Kosten'
    // Ohne Punkt am Ende wie die übrigen Probezeilen: Die Rückfrage beim Speichern hängt selbst „.“ an.
    return {
      text: (ctx.items.length === 0 ? 'Für diese Anlage ist keine Heizposition erfasst ✗ · ' : `Keine Heizposition mit dem Schlüssel „${KEY_LABELS.amounts}“, erfasst: ${others} ✗ · `) +
        `Die Probe vergleicht nur Positionen mit Einzelbeträgen laut Abrechnung und kann so nicht aufgehen. ${advice}`,
      ok: false,
    }
  }
  const entered = p.enteredOk ? '' : ` · Einzel- und Eigenbeträge zusammen ${fmtEuro(p.enteredCents)}, mehr als ${ctx.homeowners ? 'die Heizkosten Ihrer Wohnung' : 'die Summe der Kosten aller Nutzer'}`
  // Geht sie nicht auf, nennt die Zeile beide Lesarten (Durchsicht M3): Oft ist nur die Antwort auf
  // die Frage nach der Abzugszeile falsch. Laienprobe B20: in Worten, ohne S und L.
  const users = ctx.homeowners ? 'Heizkosten Ihrer Wohnung' : 'Summe der Nutzer'
  const whole = ctx.homeowners ? ' Nicht gemeint ist die Summe des ganzen Hauses.' : ''
  const both = p.itemsOk ? '' : ` · mit Abzugszeile erwartet: ${users} ${fmtEuro(S)} + Anteil Vermieter ${fmtEuro(L)} = ${fmtEuro(S + L)}; ohne Abzugszeile: ${fmtEuro(S)}. Den Betrag ändern Sie an der Position auf der Seite Kosten.${whole}`
  return { text: `Ihre Positionen: ${fmtEuro(p.itemsCents)} · erwartet: ${fmtEuro(p.expectedCents)} ${p.ok ? '✓' : '✗'}${both}${entered}`, ok: p.ok }
}

// Leerzustände (#346, Schritt 10; Spezifikation Abschnitt 6, UI-Durchsicht M14, N12): Eine Seite ohne
// Daten benennt die Voraussetzung, die fehlt, und führt mit einem Knopf dorthin. Sie sagt nicht „bitte
// Stammdaten prüfen“ ohne Weg dorthin und schickt nicht in den Eingang der Belege, solange es keine
// Wohnung gibt, auf die ein Beleg verteilt werden könnte. Ohne DOM prüfbar (emptyStock.test.ts).
import type { Tenancy, Unit } from './types'
import type { JumpTarget } from './focus'
import { NEW_COST_ITEM_TARGET, NEW_TENANCY_TARGET, NEW_UNIT_TARGET, TENANCIES_TARGET } from './jumpTargets'

// `focus`: das Formular, das der Knopf auf der Zielseite öffnet (#554); die Belege haben dort keine eigene Stelle.
// `secondary` (#447): der zweite Weg neben dem Hochladen. Wer nur Papier hat, erfasst die Kosten von Hand.
export type StartStep = {
  text: string, label: string, tab: 'stammdaten' | 'belege:eingang', focus: JumpTarget | null
  secondary?: { label: string, tab: 'kosten', focus: JumpTarget }
}

// Der erste Schritt, der für den Zeitraum `label` fehlt. `calendar` wählt „Jahr“ oder „Zeitraum“.
export function startStep(units: readonly Unit[], tenancies: readonly Tenancy[], label: string, calendar: boolean): StartStep {
  if (units.length === 0) {
    return { text: 'Legen Sie zuerst eine Wohnung an. Danach folgen die Mietverhältnisse und die Belege.', label: 'Wohnung anlegen', tab: 'stammdaten', focus: NEW_UNIT_TARGET }
  }
  if (tenancies.length === 0) {
    return { text: 'Legen Sie zuerst ein Mietverhältnis an: Wer wohnt seit wann in welcher Wohnung?', label: 'Mietverhältnis anlegen', tab: 'stammdaten', focus: NEW_TENANCY_TARGET }
  }
  return {
    text: `Für ${calendar ? 'das Jahr' : 'den Zeitraum'} ${label} gibt es noch keine Kosten und kein abzurechnendes Mietverhältnis. Laden Sie die Belege des ${calendar ? 'Jahres' : 'Zeitraums'} hoch, oder erfassen Sie die Kosten von Hand. Fehlt ein Mietverhältnis, prüfen Sie Beginn und Ende der Mietverhältnisse.`,
    label: 'Belege erfassen',
    tab: 'belege:eingang',
    focus: null,
    secondary: { label: 'Kosten von Hand erfassen', tab: 'kosten', focus: NEW_COST_ITEM_TARGET },
  }
}

// Das Mietkonto eines Jahres ohne Mietverhältnis (Systemprüfung): dieselbe Reihenfolge, nur ohne die Belege. Gibt es
// Mietverhältnisse, aber keines in diesem Jahr, führt der Knopf zur Karte „Mietverhältnisse“, wo Beginn und Ende stehen.
export function ledgerStep(units: readonly Unit[], tenancies: readonly Tenancy[], year: number): StartStep {
  const none = `Für ${year} gibt es keine Mietverhältnisse.`
  if (units.length === 0) {
    return { text: `${none} Legen Sie zuerst eine Wohnung an, danach das Mietverhältnis mit der Kaltmiete.`, label: 'Wohnung anlegen', tab: 'stammdaten', focus: NEW_UNIT_TARGET }
  }
  if (tenancies.length === 0) {
    return { text: `${none} Legen Sie eines an und hinterlegen Sie die Kaltmiete.`, label: 'Mietverhältnis anlegen', tab: 'stammdaten', focus: NEW_TENANCY_TARGET }
  }
  return { text: `${none} Prüfen Sie Beginn und Ende der Mietverhältnisse, oder legen Sie ein weiteres an.`, label: 'Mietverhältnisse prüfen', tab: 'stammdaten', focus: TENANCIES_TARGET }
}

// Eine Seite, der nur die Kosten des Jahres fehlen (Steuer): in den Eingang der Belege; ohne Wohnung zuerst die Wohnung,
// denn ohne sie ließe sich kein Beleg verteilen (N12).
export function costsStep(units: readonly Unit[]): Pick<StartStep, 'label' | 'tab' | 'focus'> {
  return units.length === 0
    ? { label: 'Wohnung anlegen', tab: 'stammdaten', focus: NEW_UNIT_TARGET }
    : { label: 'Belege erfassen', tab: 'belege:eingang', focus: null }
}

// Ein Zeitraum ohne alles, was eine Abrechnung ausmacht: keine Abrechnung je Mieter, kein Mietverhältnis
// mit Pauschale und keine Kosten. Dann gibt es weder einen Entwurf noch eine Frist, die zu nennen wäre.
export function emptySettlement(s: { statements: readonly unknown[], notSettled?: readonly unknown[], totalCostsCents: number }): boolean {
  return s.statements.length === 0 && (s.notSettled ?? []).length === 0 && s.totalCostsCents === 0
}

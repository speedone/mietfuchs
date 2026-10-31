// Leerzustände (#346, Schritt 10; Spezifikation Abschnitt 6, UI-Durchsicht M14, N12): Eine Seite ohne
// Daten benennt die Voraussetzung, die fehlt, und führt mit einem Knopf dorthin. Sie sagt nicht „bitte
// Stammdaten prüfen“ ohne Weg dorthin und schickt nicht in den Eingang der Belege, solange es keine
// Wohnung gibt, auf die ein Beleg verteilt werden könnte. Ohne DOM prüfbar (emptyStock.test.ts).
import type { Tenancy, Unit } from './types'

export type StartStep = { text: string, label: string, tab: 'stammdaten' | 'belege:eingang' }

// Der erste Schritt, der für den Zeitraum `label` fehlt. `calendar` wählt „Jahr“ oder „Zeitraum“.
export function startStep(units: readonly Unit[], tenancies: readonly Tenancy[], label: string, calendar: boolean): StartStep {
  if (units.length === 0) {
    return { text: 'Legen Sie zuerst eine Wohnung an. Danach folgen die Mietverhältnisse und die Belege.', label: 'Wohnung anlegen', tab: 'stammdaten' }
  }
  if (tenancies.length === 0) {
    return { text: 'Legen Sie zuerst ein Mietverhältnis an: Wer wohnt seit wann in welcher Wohnung?', label: 'Mietverhältnis anlegen', tab: 'stammdaten' }
  }
  return {
    text: `Für ${calendar ? 'das Jahr' : 'den Zeitraum'} ${label} gibt es noch keine Kosten und kein abzurechnendes Mietverhältnis. Erfassen Sie die Belege des ${calendar ? 'Jahres' : 'Zeitraums'}, oder prüfen Sie Beginn und Ende der Mietverhältnisse.`,
    label: 'Belege erfassen',
    tab: 'belege:eingang',
  }
}

// Ein Zeitraum ohne alles, was eine Abrechnung ausmacht: keine Abrechnung je Mieter, kein Mietverhältnis
// mit Pauschale und keine Kosten. Dann gibt es weder einen Entwurf noch eine Frist, die zu nennen wäre.
export function emptySettlement(s: { statements: readonly unknown[], notSettled?: readonly unknown[], totalCostsCents: number }): boolean {
  return s.statements.length === 0 && (s.notSettled ?? []).length === 0 && s.totalCostsCents === 0
}

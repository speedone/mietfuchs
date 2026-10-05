// Die eigene Heizperiode und die Heizkostenabrechnung auf den Seiten (Heizung PR 5, Entwurf 3.1, 3.8,
// 3.11, 11.4): Überschrift und Druckkopf, die Abrechnung nur mit Heizkosten, die Auswahl der
// Heizkostenabrechnungen, ihre Fristen im Cockpit, die Heizkorrektur, die Heizperioden im
// Kostenformular und die Heizstaffel im Mietverhältnis. Ohne DOM prüfbar.
import { fmtDate, parseEuro } from './api'
import { hasOwnRhythm, heatingPeriodsEndingIn, plantRules, servesUnit } from '../../shared/heatingPeriod.ts'
import { periodLabel } from '../../shared/period.ts'
import type { BillingPeriod, HeatingPlant, HeatingPrepaymentOverride, HeatingSettlementInfo, PeriodKey, PeriodRules, Settlement, Statement, Tenancy, Unit } from './types'

const sameDays = (a: Pick<BillingPeriod, 'from' | 'to'>, b: Pick<BillingPeriod, 'from' | 'to'>): boolean => a.from === b.from && a.to === b.to

// „Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026“ (3.1, Ausdruck).
export function settlementTitle(s: Pick<Settlement, 'period' | 'heatingPeriods' | 'scope'>): string {
  if (s.scope?.kind === 'heating') return `Heizkostenabrechnung ${s.period.label}`
  const other = (s.heatingPeriods ?? []).filter((h) => !sameDays(h.period, s.period))
  if (other.length === 0) return `Nebenkostenabrechnung ${s.period.label}`
  return `Betriebskosten ${s.period.label}, darin Heiz- und Warmwasserkosten ${other.map((h) => `${fmtDate(h.period.from)}–${fmtDate(h.period.to)}`).join(' und ')}`
}

// Für den Mieter auf seiner Abrechnung (3.1, R-A4).
export function heatingOnlyNote(st: Pick<Statement, 'heatingOnly'>): string | null {
  return st.heatingOnly
    ? 'Abrechnung nur der Heizkosten: Sie haben in diesem Abrechnungszeitraum nicht mehr hier gewohnt. Abgerechnet werden Ihre Heiz- und Warmwasserkosten aus der Heizperiode, in der Sie noch hier wohnten; eine Vorauszahlung wird nicht angerechnet, denn sie steht in Ihrer letzten Abrechnung.'
    : null
}

// Für den Vermieter, nicht für den Druck (3.8, 15.1 Nr. 2).
export function recommendedDeadlineText(st: Pick<Statement, 'heatingOnly' | 'recommendedDeadline'>): string | null {
  return st.heatingOnly && st.recommendedDeadline
    ? `Empfohlene Frist für diese Abrechnung: ${fmtDate(st.recommendedDeadline)} (die Frist der Abrechnung selbst ist nicht entschieden).`
    : null
}

export const prepaymentLabel = (st: Pick<Statement, 'scope'>): string =>
  st.scope === 'heating' ? 'abzüglich geleisteter Heizvorauszahlungen' : 'abzüglich geleisteter Vorauszahlungen'

// Bei getrennter Heizvorauszahlung weist die Gesamtabrechnung beide aus (A3); die
// Heizkostenabrechnung hat nur die eine.
export function prepaymentSplit(st: Pick<Statement, 'scope' | 'prepaymentCents' | 'heatingPrepaymentCents'>): { label: string; cents: number }[] {
  if (st.scope === 'heating' || st.heatingPrepaymentCents === undefined) return []
  return [
    { label: 'davon Heizvorauszahlung', cents: st.heatingPrepaymentCents },
    { label: 'davon übrige Vorauszahlungen', cents: st.prepaymentCents - st.heatingPrepaymentCents },
  ]
}

// Die Heizkostenabrechnungen, deren Heizperiode im gewählten Zeitraum endet: Sie gehören zu diesem
// Abrechnungsjahr, auch wenn sie ihre eigene Frist haben.
export function heatingChoices(list: readonly HeatingSettlementInfo[], p: Pick<BillingPeriod, 'from' | 'to'>): HeatingSettlementInfo[] {
  return list.filter((h) => h.period.to >= p.from && h.period.to <= p.to)
}

export function settlementPaths(param: string, target: { plantId: string; period: PeriodKey } | null): { load: string; close: string; history: string } {
  const base = target ? `/api/heating-settlement/${target.plantId}/${target.period}` : `/api/settlement/${param}`
  return { load: base, close: `${base}/close`, history: `${base}/history` }
}

// „✎ anpassen“ in der Heizkostenabrechnung: die endgültige Heizkorrektur der Heizperiode; sie ersetzt
// eine vorläufige (D2). `null` setzt zurück.
export function heatingOverridesWith(tenancy: Pick<Tenancy, 'heatingPrepaymentOverrides'>, plantId: string, period: PeriodKey, cents: number | null): HeatingPrepaymentOverride[] {
  const rest = (tenancy.heatingPrepaymentOverrides ?? []).filter((o) => !(o.plantId === plantId && o.period === period))
  return cents === null ? rest : [...rest, { plantId, period, cents, provisional: false, fromMonth: null, toMonth: null }]
}

export type HeatingDeadlineRow = { key: string; label: string; level: 'gruen' | 'gelb' | 'rot'; text: string }

// Das Cockpit führt jede beendete Heizperiode nach Weg d mit ihrer eigenen Frist (3.1, B3).
export function cockpitHeatingRows(list: readonly HeatingSettlementInfo[], today: string): HeatingDeadlineRow[] {
  return list.filter((h) => h.period.to < today).map((h) => {
    const label = `Heizkostenabrechnung ${h.period.label}${h.plantName ? ` (${h.plantName})` : ''}`
    const key = `${h.plantId}|${h.period.key}`
    const sent = h.closed?.sentAt ?? null
    if (sent !== null) {
      return sent <= h.deadline
        ? { key, label, level: 'gruen', text: `Versendet am ${fmtDate(sent)}, vor Ablauf der Frist.` }
        : { key, label, level: 'rot', text: `Versendet am ${fmtDate(sent)}, nach Ablauf der Frist ${fmtDate(h.deadline)}.` }
    }
    if (today > h.deadline) return { key, label, level: 'rot', text: `Frist ${fmtDate(h.deadline)} abgelaufen; eine Nachforderung ist ausgeschlossen (§ 556 Abs. 3 Satz 3 BGB).` }
    return { key, label, level: 'gelb', text: `Frist ${fmtDate(h.deadline)}, noch nicht versendet.` }
  })
}

// Die Heizperioden, die das Kostenformular bei einer Heizposition anbietet: je Anlage mit eigener
// Heizperiode die, die im gewählten Zeitraum enden (Entwurf 3.0).
export function heatingItemPeriods(plants: readonly HeatingPlant[], objectRules: PeriodRules, p: Pick<BillingPeriod, 'from' | 'to'>): { plantId: string; options: { value: string; label: string }[] }[] {
  return plants.filter((plant) => hasOwnRhythm(plant)).map((plant) => ({
    plantId: plant.id,
    options: heatingPeriodsEndingIn(plantRules(plant, objectRules), p).map((h) => ({ value: h.key, label: `Heizperiode ${periodLabel(h)}` })),
  }))
}

// Die Positionen eines Zeitraums auf der Seite Kosten: seine eigenen und die Heizpositionen der
// Heizperioden, die darin enden.
export function itemsOfPeriod<T extends { period: string; heatingPlantId?: string | null }>(items: readonly T[], key: string, heatingKeys: readonly { plantId: string; key: string }[]): T[] {
  return items.filter((c) => (c.heatingPlantId ? heatingKeys.some((h) => h.plantId === c.heatingPlantId && h.key === c.period) : false) || (c.period === key && !heatingKeys.some((h) => h.plantId === c.heatingPlantId)))
}

// Die Heizstaffel aus den Zeilen des Formulars; leere Zeilen fallen weg.
export function scheduleOf(rows: readonly { from: string; amount: string }[]): { from: string; monthlyCents: number }[] | { error: string } {
  const result: { from: string; monthlyCents: number }[] = []
  for (const row of rows) {
    if (row.from === '' && row.amount.trim() === '') continue
    const cents = parseEuro(row.amount)
    if (!/^\d{4}-\d{2}$/.test(row.from) || cents === null || cents < 0) return { error: 'Bitte die Staffel der Heizvorauszahlung prüfen (Monat und Betrag).' }
    result.push({ from: row.from, monthlyCents: cents })
  }
  return result
}

// Rechnet die Anlage, die die Wohnung versorgt, die Heizkosten getrennt ab (offene Spanne nach Weg d
// oder H = P mit getrennter Vorauszahlung)? Dann fragen Mietverhältnis und Mieterwechsel die
// Heizvorauszahlung mit ab (Durchsicht von #231, Important 2).
export function separateHeatingFor(unit: Pick<Unit, 'id' | 'noConnection'>, plants: readonly HeatingPlant[]): boolean {
  const plant = plants.find((p) => servesUnit(p, unit))
  if (!plant) return false
  return plant.separateSpans.some((s) => s.until === null) || (!hasOwnRhythm(plant) && plant.separateSettlement === true)
}

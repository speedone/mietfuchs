// Die angekündigte Anpassung der Vorauszahlung in die Staffel übernehmen (#317). Das Anschreiben einer abgeschlossenen
// Abrechnung ist schon die Erklärung nach § 560 Abs. 4 BGB („wird … ab Januar 2027 auf … angepasst“); der Knopf erfasst
// nur, was dort steht, als neue Stufe der Staffel. Gerechnet wird hier nichts Neues: Betrag und Monat kommen aus dem
// eingefrorenen Anschreiben, der Monat lässt sich bei der Übernahme ändern.
//
// Rein und ohne Datenbank: Der Plan sagt je Mieter, in welche Staffel die Stufe gehört, ob sie dort schon steht und was
// vorher zu fragen ist; die Route (index.ts) liest den eingefrorenen Stand und schreibt mit der Marke des Plans.
import { createHash } from 'node:crypto'
import type { PrepaymentEntry, PrepaymentStepItem, PrepaymentStepPlan, PrepaymentStepSchedule, Tenancy } from '../../shared/types.ts'
import { rateAtMonth } from '../../shared/monthRate.ts'
import { addMonths, monthName } from '../../shared/monthlyInfo.ts'
import { adjustFromFor, isMonthKey } from '../../shared/letter.ts'
import { compareText } from './calc.ts'

export type StepLetter = { tenancyId: string, tenantName: string, unitName: string, cents: number, from: string | null }
export type StepInput = {
  // `heating`: die Heizkostenabrechnung nach Weg d; ihre Anpassung gilt der Heizstaffel.
  scope: 'all' | 'heating'
  // Betriebskostenabrechnung, deren Vorschlag ohne Heizung gilt (die Heizung wird getrennt abgerechnet).
  separate: boolean
  periodTo: string
  closedAt: string
  sentAt: string | null
  today: string
  errors: string[]
  letters: readonly StepLetter[]
  tenancies: readonly Pick<Tenancy, 'id' | 'end' | 'prepayments' | 'heatingPrepayments'>[]
  // Ein bei der Übernahme geänderter Monat je Mietverhältnis.
  months: Readonly<Record<string, string>>
  // Wird die Heizung im Monat noch getrennt abgerechnet (Weg d)? Ohne Angabe gilt `separate`.
  heatingSeparateAt?: (month: string) => boolean
}

const de = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

// Ein Monat für die neue Stufe: JJJJ-MM und nach dem abgerechneten Zeitraum. Eine Stufe darin änderte die Vorauszahlungen,
// die die abgeschlossene Abrechnung angerechnet hat.
export function stepMonthProblem(month: unknown, periodTo: string): string | null {
  if (!isMonthKey(month)) return 'Der Monat, ab dem die neue Vorauszahlung gilt, ist ungültig (erwartet etwa „Januar 2027“).'
  if (month <= periodTo.slice(0, 7)) return `Der Monat ${monthName(month)} liegt im abgerechneten Zeitraum. Eine Anpassung nach dieser Abrechnung gilt erst danach.`
  return null
}

// Sätze zum Monat: ohne Versanddatum, Versand nach Beginn des Monats, Versand später als zwei Monate davor. Maßgeblich ist
// der Zugang beim Mieter (§ 130 Abs. 1 BGB); Mietfuchs kennt nur das Versanddatum, deshalb „prüfen Sie“.
// Hat der Monat schon begonnen (Integrationsdurchsicht 0.13.0, #435 K1), fordert das Mietkonto nach dem Übernehmen die neue
// Vorauszahlung ab dort als Soll, auch für Monate, die schon bezahlt sind; das gilt mit und ohne Versanddatum.
function monthNotes(from: string, announced: string | null, sentAt: string | null, today: string): string[] {
  const out: string[] = []
  if (announced === null) out.push(`Das Schreiben nennt keinen Monat, sondern „ab dem übernächsten Monat“; vorgeschlagen ist ${monthName(from)}, der übernächste Monat nach ${sentAt ? 'dem Versand' : 'dem Abschluss'}.`)
  else if (announced !== from) out.push(`Das Schreiben nennt ${monthName(announced)}, übernommen wird ab ${monthName(from)}.`)
  if (from <= today.slice(0, 7)) {
    out.push(`${monthName(from)} hat schon begonnen. Übernehmen Sie die Anpassung ab diesem Monat, fordert das Mietkonto die neue Vorauszahlung rückwirkend ab ${monthName(from)} als Soll, auch für Monate, die der Mieter schon mit dem bisherigen Betrag bezahlt hat; prüfen Sie den Monat.`)
  }
  if (sentAt === null) {
    out.push('Ein Versanddatum ist nicht eingetragen. Übernehmen Sie die Anpassung, wenn das Schreiben versandt ist, und prüfen Sie dann den Monat.')
    return out
  }
  const sentMonth = sentAt.slice(0, 7)
  if (from <= sentMonth) {
    out.push(`Das Schreiben ging am ${de(sentAt)} hinaus, als ${monthName(from)} schon begonnen hatte. Eine Anpassung der Vorauszahlungen ist nur für die Zukunft möglich (BGH, VIII ZR 271/10, Leitsatz 2); prüfen Sie den Monat.`)
  } else if (from < addMonths(sentMonth, 2)) {
    out.push(`Das Schreiben ging am ${de(sentAt)} hinaus, später als die Vorgabe von Mietfuchs vorsieht (der übernächste Monat nach dem Versand wäre ${monthName(addMonths(sentMonth, 2))}). Maßgeblich ist, wann es beim Mieter ankam; prüfen Sie den Monat.`)
  }
  return out
}

export function planPrepaymentSteps(i: StepInput): Omit<PrepaymentStepPlan, 'token'> {
  const schedule: PrepaymentStepSchedule = i.scope === 'heating' ? 'heatingPrepayments' : 'prepayments'
  const separateAt = i.heatingSeparateAt ?? (() => i.separate)
  const items = i.letters.map((l): PrepaymentStepItem => {
    // Vor #317 nannte das Schreiben keinen Monat; vorgeschlagen ist dann der übernächste nach Versand bzw. Abschluss.
    const proposed = l.from ?? adjustFromFor(i.sentAt ?? i.closedAt, i.periodTo)
    const from = i.months[l.tenancyId] ?? proposed
    const t = i.tenancies.find((x) => x.id === l.tenancyId)
    const list: readonly PrepaymentEntry[] = (t ? (schedule === 'heatingPrepayments' ? t.heatingPrepayments : t.prepayments) : undefined) ?? []
    const currentCents = rateAtMonth(list, from)
    const base = {
      tenancyId: l.tenancyId, tenantName: l.tenantName, unitName: l.unitName, schedule, cents: l.cents, from, announcedFrom: l.from,
      currentCents, existing: list.filter((e) => e.from >= from).map((e) => ({ ...e })),
      earlier: list.filter((e) => e.from > i.periodTo.slice(0, 7) && e.from < from).map((e) => ({ ...e })),
      notes: [
        ...monthNotes(from, l.from, i.sentAt, i.today),
        // K1: Die Heizung wird getrennt abgerechnet, ab dem Monat steht aber keine Heizstaffel; der Betrag gilt dann nur den übrigen.
        ...(schedule === 'prepayments' && i.separate && separateAt(from) && t && rateAtMonth(t.heatingPrepayments ?? [], from) === 0
          ? [`Die Heizkosten werden getrennt abgerechnet, ab ${monthName(from)} steht aber keine Heizvorauszahlung in der Staffel; der angekündigte Betrag gilt nur den übrigen Nebenkosten. Prüfen Sie die Heizvorauszahlung in den Stammdaten.`]
          : []),
      ],
    }
    const blocked = (text: string): PrepaymentStepItem => ({ ...base, state: 'blocked', blocked: text, overdue: false })
    if (!t) return blocked('Dieses Mietverhältnis gibt es nicht mehr.')
    // M1: Eine Stufe im abgerechneten Zeitraum änderte rückwirkend, was die abgeschlossene Abrechnung angerechnet hat.
    if (from <= i.periodTo.slice(0, 7)) return { ...blocked(`${monthName(from)} liegt im abgerechneten Zeitraum. Wählen Sie unter „Ab Monat“ einen Monat danach.`), fixMonth: true }
    if (t.end !== null && t.end < `${from}-01`) return blocked(`Das Mietverhältnis endet am ${de(t.end)}, vor ${monthName(from)}.`)
    // Der Vorschlag einer Gesamtabrechnung gilt der ganzen Vorauszahlung. Führt das Mietverhältnis die Heizung in einer
    // eigenen Staffel, ließe sich der neue Betrag nur geraten auf beide verteilen.
    if (schedule === 'prepayments' && !i.separate && rateAtMonth(t.heatingPrepayments ?? [], from) > 0) {
      return blocked(`Die Vorauszahlung steht in zwei Staffeln (übrige Nebenkosten und Heizung, zusammen ${euro(currentCents + rateAtMonth(t.heatingPrepayments ?? [], from))}); der angekündigte Betrag gilt beiden zusammen. Tragen Sie die neuen Stufen bitte in den Stammdaten ein.`)
    }
    // Integrationsdurchsicht 0.13.0 (#435): Der Vorschlag ist ohne Heizung, Weg d endet aber vor dem Monat, und eine eigene
    // Heizstaffel gibt es dann nicht. Die Staffel der übrigen Nebenkosten trägt ab dort auch die Heizung (P rechnet sie an);
    // der Betrag ohne Heizung ersetzte sie ganz, und die Heizkosten blieben ohne Vorauszahlung. Wie viel davon auf die Heizung
    // entfällt, sagt die Heizkostenabrechnung, nicht dieses Schreiben; geraten wird nicht.
    if (schedule === 'prepayments' && i.separate && !separateAt(from) && rateAtMonth(t.heatingPrepayments ?? [], from) === 0) {
      return blocked(`Der angekündigte Betrag gilt nur den übrigen Nebenkosten (ohne Heizung). Ab ${monthName(from)} werden die Heizkosten nicht mehr getrennt abgerechnet, und eine eigene Heizvorauszahlung steht dann nicht in der Staffel; die Vorauszahlung dort deckt also auch die Heizung. Übernommen, entfiele die Vorauszahlung für die Heizung. Tragen Sie die neue Vorauszahlung bitte in den Stammdaten ein: diesen Betrag zuzüglich der Vorauszahlung für die Heizung, etwa nach der Heizkostenabrechnung.`)
    }
    const taken = currentCents === l.cents
    return { ...base, state: taken ? 'taken' : 'pending', overdue: !taken && i.today.slice(0, 7) >= from }
  })
  return { items, errors: [...i.errors], sentAt: i.sentAt }
}

export function stepToken(plan: Omit<PrepaymentStepPlan, 'token'>): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 32)
}

// Die neue Staffel je gewähltem Mieter: die Stufe im Monat ersetzt eine vorhandene desselben Monats, spätere bleiben (die
// Rückfrage hat sie genannt). Was schon übernommen oder gesperrt ist, schreibt nichts.
export function stepWrites(
  plan: Omit<PrepaymentStepPlan, 'token'>,
  tenancies: readonly Pick<Tenancy, 'id' | 'prepayments' | 'heatingPrepayments'>[],
  chosen: readonly string[],
): { tenancyId: string, schedule: PrepaymentStepSchedule, entries: PrepaymentEntry[] }[] {
  return plan.items
    .filter((it) => chosen.includes(it.tenancyId) && it.state === 'pending')
    .flatMap((it) => {
      const t = tenancies.find((x) => x.id === it.tenancyId)
      if (!t) return []
      const list = (it.schedule === 'heatingPrepayments' ? t.heatingPrepayments : t.prepayments) ?? []
      const entries = [...list.filter((e) => e.from !== it.from), { from: it.from, monthlyCents: it.cents }].sort((a, b) => compareText(a.from, b.from))
      return [{ tenancyId: it.tenancyId, schedule: it.schedule, entries }]
    })
}

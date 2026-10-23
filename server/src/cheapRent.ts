// Verbilligte Vermietung nach § 21 Abs. 2 EStG (#257). Nur für die Steuerübersicht (`taxReport` in calc.ts); die
// Abrechnung an die Mieter liest nichts davon.
//
// **Die Quote** je Mietverhältnis und Kalenderjahr: Entgelt durch ortsübliche Warmmiete derselben Monate.
// - Ortsüblich ist die Kaltmiete laut Mietspiegel (jeder Wert innerhalb der Spanne) zuzüglich der nach der BetrKV
//   umlagefähigen Kosten, auch der, die der Mieter unmittelbar an Dritte zahlt (BFH, Urteil vom 22.02.2021, IX R 7/20,
//   Rz. 12 bis 14 und 21). Diesen Wert trägt der Vermieter an der Wohnung ein (`Unit.localRents`), mit Quelle und Datum.
// - **Entgelt ist die vereinbarte Kaltmiete** (BFH, IX R 7/20, Rz. 11: „Entgelt ist die vereinbarte Miete“; BFH,
//   Urteil vom 28.01.1997, IX R 88/94), also das Soll der Staffel und nicht das Gezahlte, **zuzüglich der gezahlten
//   Umlagen** (BMF-Schreiben vom 08.10.2004, BStBl I S. 933, Rz. 11: „Kaltmiete und gezahlte Umlagen“; OFD Frankfurt am
//   Main, Rundverfügung vom 17.06.2025, S 2253 A - 00115 - 0357 - St 24, Tz. 3: „Bezogen auf die vereinbarte Miete,
//   sind alle umlagefähigen Kosten in die Vergleichsberechnung einzubeziehen, die tatsächlich gezahlt worden sind“).
//   Die Umlagen nimmt Mietfuchs deshalb aus der Abrechnung des Kalenderjahres (der Anteil des Mieters an den Kosten,
//   also Vorauszahlung plus Nachzahlung oder minus Guthaben); gibt es keine Abrechnung über genau das Kalenderjahr
//   (eigener Rhythmus) oder keine für das Mietverhältnis, das Soll der Vorauszahlungen. Die Pauschale zählt immer mit
//   ihrem Soll. Welche Quelle gilt, steht an der Zeile (`chargesSource`).
// - Zahlt der Mieter umlagefähige Kosten unmittelbar an Dritte, gehören sie nach IX R 7/20, Rz. 21 und der OFD Frankfurt
//   (Tz. 3) auf beide Seiten: in die ortsübliche Warmmiete (Eintrag an der Wohnung) und ins Entgelt
//   (`Tenancy.directCharges`, Staffel je Monat, gerechnet mit derselben Monatsregel). Sie gehen nie in die
//   Werbungskosten oder die Abrechnung. Heizt der Mieter selbst und ist dort nichts eingetragen, ist die Quote nur eine
//   Untergrenze; unter der Grenze von Satz 2 kürzt Mietfuchs dann nicht, sondern sagt es (`lowerBound`).
//
// **Die Folge** (Grenzen aus dem Rechtsregister, `estg.cheap-rent`): unter der Grenze von Satz 1 werden die
// Werbungskosten der Wohnung auf den entgeltlichen Teil gekürzt; zwischen den Grenzen entscheidet nach
// Verwaltungsauffassung eine Totalüberschussprognose, die Mietfuchs nicht rechnet, also nur ein Hinweis; ab der Grenze
// von Satz 2 entgeltlich.
//
// **Welche Werbungskosten zur Wohnung gehören** (Auslegung): eine Position, die ihr direkt zugeordnet ist, ganz;
// Gebäudekosten nach dem Verhältnis der Wohnfläche über die betroffenen Einheiten (Teilnehmer, sonst das ganze Objekt),
// derselbe Maßstab wie bei teilweiser Eigennutzung (BFH, Urteil vom 24.06.2008, IX R 26/06). Gilt die Verbilligung nur
// einen Teil des Jahres (Mieterwechsel, Leerstand), wird nach Tagen gekürzt: entgeltlicher Anteil = 1 − Σ (1 − Quote) ×
// Tage / Tage des Jahres; Leerstand zählt als entgeltlich (Vermietungsabsicht). Abgeleitete Zeilen (Ausgleich beim
// Betriebsstrom, ausgezahlte CO₂-Erstattung) kürzt Mietfuchs nicht, ebenso wenig einen Abzug des Betriebsstroms beim
// Allgemeinstrom und eine Heizposition, die auch in der Stromrechnung steckt: Beide sind Ausschnitte derselben bezahlten
// Stromrechnung (#268), die mit ihrem Gewicht gekürzt wird; sonst wäre sie um den Ausschnitt zu wenig oder doppelt gekürzt
// (Durchsicht).
//
// **Keine Doppelkürzung**: Die Wohnung ist vermietet und nicht selbstgenutzt, ihr Anteil am Betrag ist also nicht im
// privaten Teil. Die Kürzung wird trotzdem auf den abziehbaren Rest geklemmt, damit privat + unentgeltlich + abziehbar
// immer genau den Betrag ergeben (Invariante in invariant-steuer-verbilligt.test.ts).
//
// Rechtszahlen stehen hier nicht (law-literals.test.ts), sie kommen aus shared/law/estg.ts.
import type { CalcStep, CheapRentReport, CheapRentTenancy, CheapRentUnit, CheapRentVerdict, CostKey, LocalRentEntry, RentLedgerRow, Statement } from '../../shared/types.ts'
import { estgCheapRent } from '../../shared/law/estg.ts'
import { coversDate, createLawLog, law, yearStart } from '../../shared/law/register.ts'
import { monthShare, overlapDays, rateInMonth } from '../../shared/monthRate.ts'

type CheapUnit = { id: string; name: string; areaM2: number; participates: boolean; selfUsed?: boolean; localRents?: LocalRentEntry[] }
type CheapTenancy = { id: string; unitId: string; tenantName: string; start: string; end: string | null; heatingModel?: string; directCharges?: readonly { from: string; monthlyCents: number }[] }
type CheapItem = { id: string; description: string; key: CostKey; directUnitId?: string | null; participantUnitIds?: string[] | null; amountCents: number }

export type CheapRentInput = {
  year: number
  units: readonly CheapUnit[]
  tenancies: readonly CheapTenancy[]
  ledgerRows: readonly RentLedgerRow[]
  // Die Mieterzeilen der Abrechnung über genau das Kalenderjahr, sonst `null`.
  statements: readonly Statement[] | null
  items: readonly CheapItem[]
  // Der abziehbare Teil einer Position nach der Aufteilung bei Eigennutzung.
  deductible: (costItemId: string) => number | undefined
  // Der Anteil eines Mietverhältnisses an einer umlagefähigen Position laut Abrechnung des Kalenderjahres, oder `null`,
  // wenn die Abrechnung ihn nicht zubucht (nicht umlagefähig, Pauschale, Inklusivmiete, keine Abrechnung über genau das
  // Kalenderjahr, Position aus einem anderen Teil). Dann gilt die Fläche (Durchsicht von PR #422, S1).
  settledShare?: (tenancyId: string, costItemId: string) => number | null
  // Die Umlagen einer Mieterzeile ohne verrechnete CO₂-Erstattung (`recurringShareCents` in calc.ts, K4).
  chargesOf?: (statement: Statement) => number
}
export type CheapRentCut = { cents: number; steps: CalcStep[] }

const pad = (n: number): string => String(n).padStart(2, '0')
const fmtCents = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const fmtNum = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const fmtPct = (x: number): string => `${(x * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`
const roundHalfAway = (x: number): number => (Math.sign(x) * Math.round(Math.abs(x))) || 0
// Die Quote in Prozent auf zwei Stellen **abgeschnitten** (Durchsicht S3): 49,999 % ist unter 50 % und soll nicht als
// „50 %“ dastehen. Die kleine Zugabe fängt Gleitkommareste wie 0,66 × 10.000 = 6.600,000…1 ab, nach unten wie oben.
const floor2 = (q: number): number => Math.floor(q * 10000 + 1e-9) / 100
const isSelf = (u: CheapUnit): boolean => !!u.selfUsed && !u.participates

export function cheapRentOf(input: CheapRentInput): { report: CheapRentReport; cuts: Map<string, CheapRentCut> } | null {
  const { year } = input
  // Jede Wohnung, die nicht selbst genutzt wird, auch eine vermietete außerhalb der Abrechnungseinheit (Durchsicht K3):
  // Ob sie vermietet ist, sagen ihre Mietverhältnisse im Jahr, nicht das Kennzeichen der Abrechnung.
  const checked = input.units.filter((u) => !isSelf(u) && (u.localRents ?? []).length > 0)
  if (checked.length === 0) return null
  const cuts = new Map<string, CheapRentCut>()
  if (!coversDate(estgCheapRent, yearStart(year))) return { report: { law: null, units: [] }, cuts }
  const from = yearStart(year)
  const to = `${year}-12-31`
  const version = estgCheapRent.versions.find((v) => (v.validFrom ?? '') <= from && (v.validTo ?? '9999') >= from)
  const limits = law(estgCheapRent, { period: { from, to } }, createLawLog())
  const yearDays = overlapDays(from, to, from, to)
  const rowOf = new Map(input.ledgerRows.map((r) => [r.tenancyId, r]))

  // Je Wohnung die Mietverhältnisse des Jahres und daraus der entgeltliche Anteil.
  const units: (CheapRentUnit & { unpaid: number; splits: { tenancyId: string; tenantName: string; rate: number; days: number }[] })[] = checked.map((u) => {
    const schedule = u.localRents ?? []
    const tenancies: CheapRentTenancy[] = []
    const splits: { tenancyId: string; tenantName: string; rate: number; days: number }[] = []
    let unpaid = 0
    for (const t of input.tenancies.filter((x) => x.unitId === u.id)) {
      const row = rowOf.get(t.id)
      if (!row) continue
      const missingMonths: number[] = []
      let comparisonCents = 0
      // Vom Mieter unmittelbar an Dritte gezahlte Kosten (#257): dieselbe Monatsregel wie die Staffeln.
      let directChargesCents = 0
      for (let m = 1; m <= 12; m++) {
        const mm = `${year}-${pad(m)}`
        if (monthShare(t, mm).days === 0) continue
        if (!schedule.some((e) => e.from <= mm)) missingMonths.push(m)
        comparisonCents += rateInMonth(schedule, t, mm)
        directChargesCents += rateInMonth(t.directCharges ?? [], t, mm)
      }
      const statement = input.statements?.find((s) => s.tenancyId === t.id && s.scope !== 'heating')
      const chargesSource = statement ? 'settlement' as const : 'soll' as const
      const chargesCents = (statement ? (input.chargesOf ? input.chargesOf(statement) : statement.totalShareCents) : row.prepaymentYearCents + (row.heatingPrepaymentYearCents ?? 0)) + row.flatRateYearCents
      const entgeltCents = row.baseRentYearCents + chargesCents + directChargesCents
      const days = overlapDays(t.start, t.end, from, to)
      const complete = missingMonths.length === 0 && comparisonCents > 0
      const quote = complete ? entgeltCents / comparisonCents : null
      // In ganzen Cent verglichen, nicht über die Gleitkommaquote: 594 € von 900 € sind genau die Grenze.
      const below = (percent: number): boolean => entgeltCents * 100 < percent * comparisonCents
      let verdict: CheapRentVerdict
      if (quote === null) verdict = 'incomplete'
      // Heizt der Mieter selbst und ist nichts eingetragen, fehlt der Teil, den er dem Versorger zahlt; mit Eintrag wird
      // normal gerechnet (Entscheidung in PR #422).
      else if (t.heatingModel === 'selfSupply' && (t.directCharges ?? []).length === 0 && below(limits.paid)) verdict = 'lowerBound'
      else if (below(limits.split)) verdict = 'split'
      else if (below(limits.paid)) verdict = 'forecast'
      else verdict = 'paid'
      if (verdict === 'split' && quote !== null) {
        const rate = 1 - Math.max(0, quote)
        unpaid += rate * days / yearDays
        splits.push({ tenancyId: t.id, tenantName: t.tenantName, rate, days })
      }
      tenancies.push({
        tenancyId: t.id, tenantName: t.tenantName, days, baseRentCents: row.baseRentYearCents, chargesCents, chargesSource,
        directChargesCents, entgeltCents, comparisonCents, quotePercent: quote === null ? null : floor2(quote), verdict, missingMonths,
      })
    }
    const sources = schedule.filter((e) => e.from <= `${year}-12` && !schedule.some((o) => o.from > e.from && o.from <= `${year}-01`))
    // Überschneiden sich zwei Mietverhältnisse (#204, ein Fehler der Erfassung), könnten die Tage zusammen mehr als das
    // Jahr ergeben; mehr als alles ist nicht unentgeltlich.
    unpaid = Math.min(1, unpaid)
    return { unitId: u.id, unitName: u.name, paidFactor: 1 - unpaid, gratuitousCents: 0, unallocated: [], tenancies, sources, unpaid, splits }
  })

  // Die Kürzung je Position. Umlagefähiges, das die Abrechnung dem Mietverhältnis zubucht: sein Anteil laut Abrechnung ×
  // (1 − Quote); der Anteil deckt schon nur seine Tage (Durchsicht S1: Einzelbeträge, Verbrauch, Personen folgen so ihrem
  // Schlüssel). Sonst: Betrag × Gewicht der Wohnung (direkt 1, sonst Fläche) × (1 − Quote) × Tage / Tage des Jahres.
  const reduced = units.filter((u) => u.unpaid > 0)
  for (const item of input.items) {
    const raws: { unit: (typeof units)[number]; raw: number; why: string; leer: boolean }[] = []
    for (const u of reduced) {
      const unit = input.units.find((x) => x.id === u.unitId)
      if (!unit) continue
      const settled = u.splits.map((t) => ({ t, share: input.settledShare ? input.settledShare(t.tenancyId, item.id) : null }))
      const unsettled = settled.filter((x) => x.share === null)
      for (const { t, share } of settled) {
        if (share !== null && share !== 0) raws.push({ unit: u, raw: share * t.rate, why: `${fmtCents(share)} Anteil ${t.tenantName} laut Abrechnung × ${fmtPct(t.rate)}`, leer: false })
      }
      if (unsettled.length === 0) continue
      const rate = Math.min(1, unsettled.reduce((a, x) => a + x.t.rate * x.t.days / yearDays, 0))
      const leer = unsettled.reduce((a, x) => a + x.t.days, 0) < yearDays
      if (item.key === 'direct' && item.directUnitId) {
        if (item.directUnitId === unit.id) raws.push({ unit: u, raw: item.amountCents * rate, why: `${fmtCents(item.amountCents)} direkt ${unit.name} × ${fmtPct(rate)}`, leer })
        continue
      }
      const affected = item.participantUnitIds ? input.units.filter((x) => item.participantUnitIds?.includes(x.id)) : input.units
      if (!affected.some((x) => x.id === unit.id)) continue
      const area = affected.reduce((a, x) => a + (x.areaM2 || 0), 0)
      if (!(unit.areaM2 > 0) || !(area > 0)) {
        u.unallocated.push({ costItemId: item.id, description: item.description })
        continue
      }
      raws.push({ unit: u, raw: (item.amountCents * unit.areaM2 / area) * rate, why: `${fmtCents(item.amountCents)} × ${fmtNum(unit.areaM2)}/${fmtNum(area)} m² (${unit.name}) × ${fmtPct(rate)}`, leer })
    }
    if (raws.length === 0) continue
    const deductible = input.deductible(item.id) ?? item.amountCents
    let cents = roundHalfAway(raws.reduce((a, r) => a + r.raw, 0))
    cents = deductible >= 0 ? Math.min(Math.max(cents, 0), deductible) : Math.max(Math.min(cents, 0), deductible)
    if (cents === 0) continue
    // Auf die Wohnungen nach ihrem Anteil, der Rest an die letzte; nur für die Summe je Wohnung.
    const total = raws.reduce((a, r) => a + r.raw, 0)
    let left = cents
    raws.forEach((r, i) => {
      const part = i === raws.length - 1 ? left : roundHalfAway(cents * r.raw / total)
      r.unit.gratuitousCents += part
      left -= part
    })
    cuts.set(item.id, {
      cents,
      steps: [
        ...raws.map((r) => ({ label: 'Verbilligte Vermietung', value: `${r.why} = ${fmtCents(roundHalfAway(r.raw))} unentgeltlich (§ 21 Abs. 2 EStG)`, term: 'cheapRent' as const })),
        ...(raws.some((r) => r.leer) ? [{ label: 'Hinweis', value: 'Tage ohne verbilligtes Mietverhältnis, auch Leerstand, zählen als entgeltlich; das ist eine Auslegung von Mietfuchs.', term: 'cheapRent' as const }] : []),
        { label: 'unentgeltlicher Teil, nicht abziehbar', value: fmtCents(cents), term: 'cheapRent' as const },
      ],
    })
  }

  return {
    report: {
      law: { split: limits.split, paid: limits.paid, cite: version?.source.cite ?? estgCheapRent.norm, text: estgCheapRent.describe(limits) },
      units: units.map(({ unpaid: _, splits: __, ...u }) => u),
    },
    cuts,
  }
}

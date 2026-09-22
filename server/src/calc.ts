// Berechnungs-Engine für die Nebenkostenabrechnung.
// Alle Beträge werden in Cent (Integer) gerechnet, um Gleitkomma-Fehler zu vermeiden.
import type {
  CostKey,
  MeterType,
  PersonEntry,
  RentLedger,
  RentLedgerRow,
  RentMonth,
  Settlement,
  SettlementRow,
  Statement,
  TaxExpenseCategory,
  TaxExpenseGroup,
  TaxReport,
} from '../../shared/types.ts'
// Die Berechnung kennt den Speicher nicht mehr, sondern nur noch den Schnappschuss eines
// Abrechnungsjahres (siehe snapshot.ts). Welche Sammlung darin nach Jahr eingegrenzt sein darf,
// entscheidet dort die Ablage und nicht hier.
import type { Snapshot, SnapshotMeter, SnapshotReading, SnapshotTenancy, SnapshotUnit } from './snapshot.ts'

export const KEY_LABELS: Record<CostKey, string> = {
  area: 'Wohnfläche',
  persons: 'Personenzahl',
  units: 'Wohneinheiten',
  direct: 'Direktzuordnung',
  meter: 'Verbrauch (Zähler)',
  custom: 'Vereinbarte Anteile',
}

const MS_DAY = 86400000

function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
}

// Überlappung zweier Zeiträume in Tagen (alle Grenzen inklusiv, ISO-Strings, end=null = offen)
function rangeOverlapDays(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): number {
  const s = Math.max(toUTC(aStart), toUTC(bStart))
  const e = Math.min(aEnd ? toUTC(aEnd) : Infinity, bEnd ? toUTC(bEnd) : Infinity)
  if (e < s) return 0
  return Math.round((e - s) / MS_DAY) + 1
}

// Belegte Tage eines Mietverhältnisses innerhalb des Abrechnungsjahres
export function overlapDays(start: string, end: string | null, year: number): number {
  return rangeOverlapDays(start, end, `${year}-01-01`, `${year}-12-31`)
}

// ---------- Sortieren ----------
//
// **Nichts in dieser Datei darf von der Locale der Laufzeit abhängen** (#70). Sonst ergäben
// dieselben Daten auf zwei Rechnern zwei Reihenfolgen, und bei `largestRemainder` entscheidet
// die Reihenfolge, wer den Rest-Cent bekommt. Ein blankes `localeCompare()` liest die
// Einstellung der Laufzeit und ist deshalb hier nirgends erlaubt; ein Test in calc.test.ts hält
// das fest, weil es sich auf einem einzelnen Rechner nicht messen lässt.
//
// Abgeschafft wird die Locale damit aber nicht, sondern festgenagelt — genau wie beim
// Formatieren von Zahlen weiter unten, das ausdrücklich `'de-DE'` verlangt. Welche der beiden
// Funktionen gilt, entscheidet, wofür die Reihenfolge da ist.

// **Trägt die Reihenfolge eine Bedeutung**, wird Zeichen für Zeichen verglichen: der Rest-Cent
// in `largestRemainder`, die Ablesungen und die Staffeln, bei denen sie entscheidet, welcher
// von zwei Einträgen zum selben Stichtag der spätere ist (siehe schedule.ts). Hier wäre eine
// Sprache die falsche Frage: Verglichen werden Kennungen und ISO-Daten, keine Wörter.
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// **Steht die Reihenfolge in einer Liste, die ein Mensch liest**, gilt deutsche Sortierung, und
// zwar fest eingestellt. Zeichenweise verglichen landete „Älter" hinter „Zaun", weil das Ä einen
// höheren Zeichenwert hat als das Z — richtig wäre das nie, und einem Vermieter mit Umlauten im
// Haus fiele es sofort auf. Die Sprache steht hier und kommt nicht aus der Umgebung.
const NAME_COLLATOR = new Intl.Collator('de-DE')

export function compareName(a: string, b: string): number {
  return NAME_COLLATOR.compare(a, b)
}

// ---------- Personen-Staffel ----------

function personHistoryOf(tenancy: SnapshotTenancy): PersonEntry[] {
  const h = Array.isArray(tenancy.personHistory) && tenancy.personHistory.length
    ? tenancy.personHistory
    : [{ from: tenancy.start, persons: tenancy.persons ?? 1 }]
  return h.slice().sort((a, b) => compareText(a.from, b.from))
}

// Personentage eines Mietverhältnisses im Zeitraum [from, to] (inklusiv)
export function personDaysInPeriod(tenancy: SnapshotTenancy, from: string, to: string): number {
  const h = personHistoryOf(tenancy)
  let sum = 0
  for (let i = 0; i < h.length; i++) {
    const segStart = i === 0 ? tenancy.start : h[i].from // erste Stufe gilt ab Einzug
    const segEnd: string | null = i + 1 < h.length
      ? new Date(toUTC(h[i + 1].from) - MS_DAY).toISOString().slice(0, 10)
      : tenancy.end
    const effEnd = tenancy.end && (!segEnd || segEnd > tenancy.end) ? tenancy.end : segEnd
    sum += h[i].persons * rangeOverlapDays(segStart, effEnd, from, to)
  }
  return sum
}

// Aktuelle Personenzahl zu einem Stichtag
export function personsAt(tenancy: SnapshotTenancy, dateIso: string): number {
  const h = personHistoryOf(tenancy)
  let p = h[0]?.persons ?? 0
  for (const e of h) if (e.from <= dateIso) p = e.persons
  return p
}

// ---------- Zähler & Verbrauch ----------

type MeterSegment = { from: string, to: string, delta: number, days: number }

// Ablesungen eines Zählers → Verbrauchssegmente zwischen aufeinanderfolgenden Ablesungen.
// Konvention: eine Ablesung gilt zum Tagesende ihres Datums. Bei Zählerwechsel trägt die
// Ablesung replacement=true: oldEndValue = Endstand des alten Geräts, value = Startstand des neuen.
export function meterSegments(readings: SnapshotReading[]): { segments: MeterSegment[], warnings: string[] } {
  const sorted = readings.slice().sort((a, b) => compareText(a.date, b.date))
  const segments: MeterSegment[] = []
  const warnings: string[] = []
  for (let i = 1; i < sorted.length; i++) {
    const r0 = sorted[i - 1]
    const r1 = sorted[i]
    const delta = r1.replacement ? (r1.oldEndValue ?? 0) - r0.value : r1.value - r0.value
    const days = Math.round((toUTC(r1.date) - toUTC(r0.date)) / MS_DAY)
    if (delta < 0) {
      warnings.push(`Negativer Verbrauch zwischen ${r0.date} und ${r1.date} (${delta}) — Ablesung prüfen oder Zählerwechsel markieren.`)
    }
    if (days > 0) segments.push({ from: r0.date, to: r1.date, delta, days })
  }
  return { segments, warnings }
}

// Verbrauch im Zeitraum [from, to] (inklusive Tage). Segmente werden tagesanteilig
// interpoliert — liegt eine Ablesung genau auf der Zeitraumgrenze (z. B. Zwischenablesung
// beim Mieterwechsel), ist die Aufteilung exakt.
export function consumptionInPeriod(readings: SnapshotReading[], from: string, to: string): number {
  const { segments } = meterSegments(readings)
  let sum = 0
  const pStart = toUTC(from) - MS_DAY // Zeitraum beginnt nach Tagesende des Vortags
  const pEnd = toUTC(to)
  for (const s of segments) {
    const s0 = toUTC(s.from)
    const s1 = toUTC(s.to)
    const overlap = Math.min(pEnd, s1) - Math.max(pStart, s0)
    if (overlap <= 0) continue
    sum += s.delta * (overlap / MS_DAY / s.days)
  }
  return sum
}

// Ein Eintrag der Jahresübersicht für die Zähler-Seite (Verbrauch je Zähler)
export type ConsumptionOverviewRow = {
  meterId: string
  consumption: number
  readingCount: number
  warnings: string[]
}

// Jahresübersicht für die Zähler-Seite: Verbrauch pro Zähler + Warnungen
export function consumptionOverview(snapshot: Snapshot): ConsumptionOverviewRow[] {
  const from = `${snapshot.year}-01-01`
  const to = `${snapshot.year}-12-31`
  return snapshot.meters.map((m) => {
    const readings = snapshot.readings.filter((r) => r.meterId === m.id)
    const { warnings } = meterSegments(readings)
    return {
      meterId: m.id,
      consumption: Math.round(consumptionInPeriod(readings, from, to) * 100) / 100,
      readingCount: readings.length,
      warnings,
    }
  })
}

// ---------- Vorauszahlungen ----------

// Vorauszahlungen eines Jahres: pro Kalendermonat zählt der Staffelbetrag, der am
// Monatsersten gilt — sofern das Mietverhältnis am Monatsersten besteht. Eine manuelle
// Korrektur pro Jahr (tatsächlich gezahlter Betrag) hat immer Vorrang, denn rechtlich
// sind die tatsächlich geleisteten Vorauszahlungen anzusetzen.
export function computePrepaymentCents(tenancy: SnapshotTenancy, year: number): { cents: number, overridden: boolean } {
  const override = tenancy.prepaymentOverrides?.[String(year)]
  if (override != null) return { cents: override, overridden: true }
  // `prepaymentMonthlyCents` gibt es im heutigen Tenancy-Typ nicht mehr (Altformat, siehe
  // Migration in store.ts). Diese Funktion wird aber auch mit ungewanderten Altbeständen
  // aufgerufen (siehe calc.test.ts), deshalb führt `SnapshotTenancy` das Feld weiterhin.
  const schedule = (
    tenancy.prepayments?.length
      ? tenancy.prepayments
      : tenancy.prepaymentMonthlyCents != null // Altformat: ein fester Monatsbetrag
        ? [{ from: tenancy.start.slice(0, 7), monthlyCents: tenancy.prepaymentMonthlyCents }]
        : []
  )
    .slice()
    .sort((a, b) => compareText(a.from, b.from))
  let cents = 0
  for (let m = 1; m <= 12; m++) {
    const firstDay = `${year}-${String(m).padStart(2, '0')}-01`
    if (tenancy.start > firstDay) continue
    if (tenancy.end && tenancy.end < firstDay) continue
    let rate = 0
    for (const e of schedule) if (e.from <= firstDay.slice(0, 7)) rate = e.monthlyCents
    cents += rate
  }
  return { cents, overridden: false }
}

// ---------- Mietkonto / Zahlungs-Tracking ----------

type MonthlySchedule = { from: string, monthlyCents: number }

// Staffelbetrag, der am Monatsersten gilt (für Kaltmiete oder Vorauszahlung).
// `schedule`: Array aus { from: 'YYYY-MM', monthlyCents }. firstMonth: 'YYYY-MM'.
function rateAtMonth(schedule: MonthlySchedule[], firstMonth: string): number {
  let rate = 0
  for (const e of schedule.slice().sort((a, b) => compareText(a.from, b.from))) {
    if (e.from <= firstMonth) rate = e.monthlyCents
  }
  return rate
}

// Monats-Mietkonto eines Jahres: pro Mietverhältnis Soll (Bruttomiete = Kaltmiete +
// Vorauszahlung) je Monat, sowie die tatsächlich eingegangenen Zahlungen des Jahres.
// Zahlungen werden den Monaten in Reihenfolge (Jan → Dez) zugeteilt: so spiegelt der
// Status („bezahlt / teilweise / offen") wider, bis zu welchem Monat das Konto gedeckt ist.
export function rentLedger(snapshot: Snapshot): RentLedger {
  const year = snapshot.year
  const yFrom = `${year}-01-01`
  const yTo = `${year}-12-31`
  const unitById = new Map(snapshot.units.map((u) => [u.id, u]))
  // Der Schnappschuss führt alle Zahlungen. Welche zum Jahr zählt, entscheidet das Mietkonto
  // hier nach ihrem Datum, und diese Regel bleibt bewusst an dieser Stelle.
  const payments = snapshot.payments

  const rows: RentLedgerRow[] = snapshot.tenancies
    .filter((t) => overlapDays(t.start, t.end, year) > 0)
    .map((t) => {
      const baseSchedule: MonthlySchedule[] = Array.isArray(t.baseRents) ? t.baseRents : []
      const ppSchedule: MonthlySchedule[] = Array.isArray(t.prepayments) ? t.prepayments : []

      const months: RentMonth[] = []
      for (let m = 1; m <= 12; m++) {
        const mm = `${year}-${String(m).padStart(2, '0')}`
        const firstDay = `${mm}-01`
        const active = t.start <= firstDay && !(t.end && t.end < firstDay)
        const baseRentCents = active ? rateAtMonth(baseSchedule, mm) : 0
        const prepaymentCents = active ? rateAtMonth(ppSchedule, mm) : 0
        months.push({
          month: m,
          baseRentCents,
          prepaymentCents,
          sollCents: baseRentCents + prepaymentCents,
          paidCents: 0,
          status: 'open',
        })
      }

      // Zahlungseingänge des Jahres der Reihe nach auf die Monate verteilen
      const paidYearCents = payments
        .filter((p) => p.tenancyId === t.id && p.date >= yFrom && p.date <= yTo)
        .reduce((a, p) => a + p.amountCents, 0)
      let remaining = paidYearCents
      for (const mo of months) {
        if (mo.sollCents <= 0) {
          // kein Soll → als gedeckt behandeln, kein Geld verbrauchen
          mo.status = 'paid'
          continue
        }
        const applied = Math.max(0, Math.min(remaining, mo.sollCents))
        mo.paidCents = applied
        remaining -= applied
        mo.status = applied >= mo.sollCents ? 'paid' : applied > 0 ? 'partial' : 'open'
      }

      const sollYearCents = months.reduce((a, mo) => a + mo.sollCents, 0)
      const baseRentYearCents = months.reduce((a, mo) => a + mo.baseRentCents, 0)
      const prepaymentYearCents = months.reduce((a, mo) => a + mo.prepaymentCents, 0)
      return {
        tenancyId: t.id,
        tenantName: t.tenantName,
        unitName: unitById.get(t.unitId)?.name ?? '—',
        months,
        sollYearCents,
        baseRentYearCents,
        prepaymentYearCents,
        paidYearCents,
        balanceCents: paidYearCents - sollYearCents,
        openMonths: months.filter((mo) => mo.status !== 'paid').length,
      }
    })
    // Eine Liste, die ein Mensch liest: deutsche Sortierung, fest eingestellt (siehe compareName).
    .sort((a, b) => compareName(a.unitName, b.unitName) || compareName(a.tenantName, b.tenantName))

  return {
    year,
    rows,
    totals: {
      sollYearCents: rows.reduce((a, r) => a + r.sollYearCents, 0),
      paidYearCents: rows.reduce((a, r) => a + r.paidYearCents, 0),
      openCents: rows.reduce((a, r) => a + (r.balanceCents < 0 ? -r.balanceCents : 0), 0),
    },
  }
}

// ---------- Steuer-Export (Anlage V) ----------

// Betriebskostenarten den Anlage-V-nahen Positionsgruppen zuordnen. Bewusst beschreibende
// Gruppen statt fester Zeilennummern (die sich jährlich ändern können). Unbekannte Kategorien
// fallen auf „Sonstige Werbungskosten".
const ANLAGE_V_GROUP: Record<string, string> = {
  Grundsteuer: 'Grundsteuer & öffentliche Abgaben',
  'Wasser/Abwasser': 'Laufende Betriebskosten',
  Niederschlagswasser: 'Laufende Betriebskosten',
  Müllabfuhr: 'Laufende Betriebskosten',
  Straßenreinigung: 'Laufende Betriebskosten',
  Gebäudereinigung: 'Laufende Betriebskosten',
  Gartenpflege: 'Laufende Betriebskosten',
  'Beleuchtung/Allgemeinstrom': 'Laufende Betriebskosten',
  Schornsteinfeger: 'Laufende Betriebskosten',
  Hauswart: 'Laufende Betriebskosten',
  Aufzug: 'Laufende Betriebskosten',
  'Kabel/Antenne': 'Laufende Betriebskosten',
  'Sach- und Haftpflichtversicherung': 'Versicherungen',
  'Sonstige Betriebskosten': 'Sonstige Werbungskosten',
  'Nicht umlagefähig': 'Verwaltung & Instandhaltung',
}
// Anzeigereihenfolge der Gruppen in der Auswertung
const ANLAGE_V_GROUP_ORDER = [
  'Grundsteuer & öffentliche Abgaben',
  'Laufende Betriebskosten',
  'Versicherungen',
  'Verwaltung & Instandhaltung',
  'Sonstige Werbungskosten',
]

// Jahres-Steuerübersicht (Hilfe für die Anlage V): Einnahmen aus dem Mietkonto,
// Werbungskosten aus den Kostenpositionen nach Anlage-V-Gruppen, §35a-Lohnanteile sowie
// der Flächenanteil der vermieteten Einheiten (für gemischt genutzte Gebäude). Die
// Werbungskosten folgen dem Abflussprinzip (im Jahr gebuchte Kosten), die Einnahmen
// werden sowohl als Soll (vereinbart) als auch als Ist (tatsächlich gezahlt) geliefert.
export function taxReport(snapshot: Snapshot): TaxReport {
  const year = snapshot.year
  const ledger = rentLedger(snapshot)
  const baseRentSollCents = ledger.rows.reduce((a, r) => a + r.baseRentYearCents, 0)
  const prepaymentSollCents = ledger.rows.reduce((a, r) => a + r.prepaymentYearCents, 0)
  const sollCents = ledger.totals.sollYearCents

  // **Zugeflossen ist, was da ist, und nicht, was eine Zeile hat** (§ 11 Abs. 1 Satz 1 EStG).
  // Deshalb wird hier nach Datum summiert und nicht `ledger.totals.paidYearCents` genommen.
  // Das Mietkonto bildet Zeilen nur für Mietverhältnisse mit Überlappung im Jahr und zählt
  // Zahlungen nur innerhalb dieser Zeilen; zwei gewöhnliche Fälle fielen dadurch aus **beiden**
  // Jahren heraus. Ein Mietverhältnis endet am 31.12. und die Dezembermiete geht am 5. Januar
  // ein: im alten Jahr liegt die Zahlung außerhalb, im neuen gibt es keine Zeile mehr. Oder ein
  // Mietverhältnis beginnt am 1. Januar und der Dauerauftrag bucht am 30. Dezember.
  //
  // Für das Mietkonto ist seine Zeilenbindung richtig: Es beantwortet, bis zu welchem Monat ein
  // laufendes Mietverhältnis gedeckt ist, und dafür ist eine Zahlung ohne Zeile kein Beitrag.
  // Für die Steuerübersicht ist sie falsch, seit das Zugeflossene die maßgebliche Zahl ist.
  const paidCents = snapshot.payments
    .filter((p) => p.date >= `${year}-01-01` && p.date <= `${year}-12-31`)
    .reduce((a, p) => a + p.amountCents, 0)

  // Mietverhältnisse des Jahres mit Soll, und wie viele davon ohne jede Zahlung dastehen. Nicht
  // für eine Rechnung, sondern für den Hinweis: Sind für einen Mieter Zahlungen erfasst und für
  // einen zweiten nicht, ist die Summe größer als null, und eine zu niedrige Einnahme ginge
  // ohne Vorbehalt in die Anlage V.
  //
  // Gezählt wird, für welches Mietverhältnis **überhaupt keine** Zahlung erfasst ist, und nicht,
  // wessen Summe null ergibt. Heben sich im Jahr ein Eingang und eine Rücklastschrift auf, ist
  // die Summe null, erfasst ist aber sehr wohl etwas, und der Satz „keine Zahlung erfasst" wäre
  // dann schlicht falsch.
  const paidTenancies = new Set(
    snapshot.payments.filter((p) => p.date >= `${year}-01-01` && p.date <= `${year}-12-31`).map((p) => p.tenancyId),
  )
  const withSoll = ledger.rows.filter((r) => r.sollYearCents > 0)
  const tenanciesWithSoll = withSoll.length
  const tenanciesWithoutPayment = withSoll.filter((r) => !paidTenancies.has(r.tenancyId)).length

  // Die Abrechnung desselben Jahres, einmal gerechnet. Aus ihr kommen zwei Angaben, und beide
  // werden ihr **entnommen** statt neu hergeleitet: Eine zweite Auslegung der Staffel oder eine
  // zweite Auswahl der Mietverhältnisse liefe irgendwann auseinander, und gemerkt hätte man es
  // erst daran, dass Steuerübersicht und versendete Abrechnung verschiedene Zahlen nennen.
  // Genau das ist der Befund aus #70.
  const settlement = computeSettlement(snapshot)

  // Was die Abrechnung bei den Vorauszahlungen ansetzt, und **bei abgeschlossener Abrechnung
  // ihr eingefrorener Stand**, genau wie beim Eigenanteil weiter unten. Die Zahl steht in der
  // Oberfläche als die, die auf der Abrechnung steht; ist sie abgeschlossen, steht dort der
  // eingefrorene Stand, und zwar beim Mieter im Briefkasten. Der lebende nennte eine Zahl, die
  // auf keinem zugestellten Papier steht — genau der Widerspruch, gegen den #70 antritt.
  //
  // Dass sie von `prepaymentSollCents` abweicht, ist gewollt und hat zwei Gründe. Die Abrechnung
  // muss die tatsächlich geleisteten Vorauszahlungen einstellen, sonst ist sie materiell falsch
  // und trägt nach Ablauf der Frist des § 556 Abs. 3 BGB keinen Nachforderungsanspruch mehr. Und
  // sie verteilt nur über Wohnungen, die zur Abrechnungseinheit gehören, während das Mietkonto
  // jedes Mietverhältnis führt. Das Mietkonto wiederum darf die Jahreskorrektur nicht übernehmen,
  // denn eine Jahreszahl auf zwölf Monate zu verteilen wäre erfunden. Alle drei Zahlen sind
  // richtig, und deshalb stehen sie jetzt nebeneinander statt jede für sich.
  const frozen = snapshot.closedSettlement
  const prepaymentSettlementCents = frozen
    ? frozen.prepaymentCents
    : settlement.statements.reduce((a, st) => a + st.prepaymentCents, 0)
  const prepaymentOverridden = frozen
    ? frozen.prepaymentOverridden
    : settlement.statements.some((st) => st.prepaymentOverridden)

  // Kostenpositionen des Jahres nach Anlage-V-Gruppe und Kostenart aggregieren. Der Filter ist
  // bewusst doppelt: `snapshotFromDb` grenzt bereits ein. Er bleibt, weil er das Einzige ist,
  // was eine falsch eingegrenzte Ablage noch auffängt, und der Schaden wäre eine Steuerübersicht
  // mit den Werbungskosten mehrerer Jahre. Nicht als toten Code entfernen.
  const items = snapshot.costItems.filter((c) => c.year === year)
  const byGroup = new Map<string, Map<string, TaxExpenseCategory>>()
  for (const item of items) {
    const group = ANLAGE_V_GROUP[item.category] ?? 'Sonstige Werbungskosten'
    let cats = byGroup.get(group)
    if (!cats) {
      cats = new Map()
      byGroup.set(group, cats)
    }
    const prev = cats.get(item.category) ?? { category: item.category, amountCents: 0, labor35aCents: 0 }
    prev.amountCents += item.amountCents
    prev.labor35aCents += item.labor35aCents ?? 0
    cats.set(item.category, prev)
  }
  const groups: TaxExpenseGroup[] = [...byGroup.entries()]
    .map(([group, cats]) => {
      const categories = [...cats.values()].sort((a, b) => b.amountCents - a.amountCents)
      return {
        group,
        amountCents: categories.reduce((a, c) => a + c.amountCents, 0),
        labor35aCents: categories.reduce((a, c) => a + c.labor35aCents, 0),
        categories,
      }
    })
    .sort((a, b) => {
      const ia = ANLAGE_V_GROUP_ORDER.indexOf(a.group)
      const ib = ANLAGE_V_GROUP_ORDER.indexOf(b.group)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  const totalCents = groups.reduce((a, g) => a + g.amountCents, 0)
  const labor35aCents = groups.reduce((a, g) => a + g.labor35aCents, 0)

  // Flächenanteil der vermieteten (beteiligten) Einheiten — Hinweis bei gemischter Nutzung
  const allUnits = snapshot.units
  const totalArea = allUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  const rentedArea = allUnits.filter((u) => u.participates).reduce((a, u) => a + (u.areaM2 || 0), 0)
  const rentedAreaShare = totalArea > 0 ? rentedArea / totalArea : 1
  const selfOccupiedExists = allUnits.some((u) => !u.participates)
  // Auf selbstgenutzte Wohnungen entfallender Teil der Kosten, aus der Verteilung des Jahres
  // übernommen: privat veranlasst und damit nicht als Werbungskosten abziehbar. Die
  // Werbungskosten oben bleiben ungekürzt — die Aufteilung nimmt diese Übersicht nicht vor.
  // Ist die Abrechnung abgeschlossen, gilt ihr eingefrorener Stand (wie in
  // GET /api/settlement/:year), sonst widersprächen Übersicht und versendete Abrechnung.
  const selfUsedShareCents = snapshot.closedSettlement
    ? snapshot.closedSettlement.selfUsedShareCents
    : settlement.selfUsedShareCents

  return {
    year,
    income: {
      baseRentSollCents,
      prepaymentSollCents,
      prepaymentSettlementCents,
      prepaymentOverridden,
      sollCents,
      paidCents,
      tenanciesWithSoll,
      tenanciesWithoutPayment,
    },
    expenses: { groups, totalCents, labor35aCents },
    rentedAreaShare,
    selfOccupiedExists,
    selfUsedShareCents,
    surplusSollCents: sollCents - totalCents,
    surplusPaidCents: paidCents - totalCents,
  }
}

// ---------- Hilfen ----------

// Verteilt totalCents exakt auf die gegebenen (float) Rohanteile (Hare/largest remainder).
// `keys` enthält je Rohanteil eine stabile Kennung (die ID des Mietverhältnisses). Sie
// entscheidet, wer bei gleichem Nachkommaanteil den Rest-Cent bekommt — sonst hinge das an
// der Reihenfolge in der Datei, und dieselben Daten könnten anders abgerechnet werden.
export function largestRemainder(totalCents: number, raws: number[], keys: string[]): number[] {
  if (raws.length === 0) return []
  const floors = raws.map((r) => Math.floor(r))
  let rest = totalCents - floors.reduce((a, b) => a + b, 0)
  const byKey = (i: number, j: number) => compareText(keys[i], keys[j])
  const order = raws
    .map((r, i): [number, number] => [r - Math.floor(r), i])
    .sort((a, b) => b[0] - a[0] || byKey(a[1], b[1]))
  for (let k = 0; rest > 0; k++, rest--) floors[order[k % order.length][1]]++
  for (let k = 0; rest < 0; k++, rest++) floors[order[order.length - 1 - (k % order.length)][1]]--
  return floors
}

function fmtNum(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

// ---------- Abrechnung ----------

// Mietverhältnis, ergänzt um die im Jahr belegten Tage und die zugehörige Wohnung: das
// Ergebnis der Vorbereitung unten, sobald Mietverhältnisse ohne (mehr) vorhandene Wohnung
// herausgefiltert sind.
type TenancyWithUnit = SnapshotTenancy & { days: number, unit: SnapshotUnit }

// Ziel einer Kostenverteilung: das Mietverhältnis, sein (float) Rohanteil in Cent und der Text,
// der die Berechnungsgrundlage auf der Abrechnung beschreibt.
type Target = { t: TenancyWithUnit, raw: number, basisText: string }

// Verbrauch und Zähler eines Zählertyps, aufbereitet für die Verteilung. Der Wert ist bewusst
// optional (nicht `Record<string, ConsumptionByTypeEntry>`): zu einer Kostenposition mit einem
// Zählertyp ohne Zähler gibt es keinen Eintrag, und `data` unten ist dann `undefined` statt
// eines für den Übersetzer immer vorhandenen Werts. Nur so bleibt die folgende Prüfung
// `if (!data || data.basis <= 0)` sichtbar nötig statt totem Code.
type ConsumptionByTypeEntry = { meters: (SnapshotMeter & { unitId: string })[], basis: number, perUnit: Map<string, number>, selfConsumption: number }

// Das tatsächliche Ergebnis von computeSettlement: wie Settlement aus shared/types.ts, aber ohne
// `closed` — das ergänzt erst die Route GET /api/settlement/:year.
export type ComputedSettlement = Omit<Settlement, 'closed'>

export function computeSettlement(snapshot: Snapshot): ComputedSettlement {
  const year = snapshot.year
  const diy = daysInYear(year)
  const yFrom = `${year}-01-01`
  const yTo = `${year}-12-31`
  const unitById = new Map(snapshot.units.map((u) => [u.id, u]))
  // Selbstgenutzte Wohnungen (`selfUsed`) haben kein Mietverhältnis, bilden aber die
  // Verteilbasis mit: Kosten einer Rechnung über das ganze Haus dürfen nur anteilig auf die
  // Mieter umgelegt werden, der auf die selbstgenutzte Wohnung entfallende Teil bleibt beim
  // Vermieter (Eigenanteil) — wie bei Leerstand. Wohnungen ohne beide Kennzeichen gehören
  // nicht zur Abrechnungseinheit und bleiben ganz außen vor.
  // `participates` hat Vorrang: eine vermietete Wohnung ist nie Eigennutzung, auch wenn ein
  // von Hand bearbeiteter Datenbestand beide Kennzeichen trägt (siehe usageOf in types.ts).
  const selfUnits = snapshot.units.filter((u) => u.selfUsed && !u.participates)
  const basisUnits = snapshot.units.filter((u) => u.participates || u.selfUsed)
  const basisArea = basisUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  const selfArea = selfUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  // Werte aus der Datei defensiv behandeln: negative oder unsinnige Personenzahlen dürfen die
  // Verteilbasis nicht verkleinern — das würde die Mieteranteile über 100 % treiben.
  const selfPersonsOf = (u: SnapshotUnit) => Math.max(0, Number(u.selfPersons) || 0)

  // Mietverhältnisse mit Überlappung im Jahr, bewusst mit flatMap statt map().filter(): Erst so
  // prüft der Übersetzer mit, dass jedes übriggebliebene Mietverhältnis wirklich eine Wohnung
  // hat. Weder eine Zusicherung `as TenancyWithUnit[]` noch ein Prädikat
  // `(t): t is TenancyWithUnit` täte das — beide sind bloße Behauptungen über die Bedingung.
  // Fiele das `unit` später aus ihr heraus, übersetzte das weiterhin, und die Engine stürzte
  // ab, sobald eine gelöschte Wohnung ein Mietverhältnis hinterlässt (`t.unit` unten).
  const tenancies: TenancyWithUnit[] = snapshot.tenancies.flatMap((t) => {
    const days = overlapDays(t.start, t.end, year)
    const unit = unitById.get(t.unitId)
    return days > 0 && unit ? [{ ...t, days, unit }] : []
  })
  const partTenancies = tenancies.filter((t) => t.unit.participates)
  // Personentage der selbstgenutzten Wohnungen: ganzjährig mit der hinterlegten Personenzahl
  const selfPersonDays = selfUnits.reduce((a, u) => a + selfPersonsOf(u) * diy, 0)
  const basisPersonDays =
    partTenancies.reduce((a, t) => a + personDaysInPeriod(t, yFrom, yTo), 0) + selfPersonDays

  // Verbrauch je Zählertyp vorbereiten (nur Wohnungszähler bilden die Verteilbasis)
  // Alle Ablesungen, nicht nur die des Jahres: Der Anfangsstand steht im Vorjahr (siehe
  // snapshot.ts). `consumptionInPeriod` schneidet den Zeitraum tagesanteilig heraus.
  const allMeters = snapshot.meters
  const allReadings = snapshot.readings
  const meterTypes = [...new Set(allMeters.filter((m) => m.unitId).map((m) => m.type))]
  const consumptionByType: Record<string, ConsumptionByTypeEntry | undefined> = {}
  for (const type of meterTypes) {
    const meters = allMeters.filter((m) => m.unitId && m.type === type) as (SnapshotMeter & { unitId: string })[]
    const perUnit = new Map<string, number>()
    let basis = 0
    for (const m of meters) {
      const readings = allReadings.filter((r) => r.meterId === m.id)
      const c = consumptionInPeriod(readings, yFrom, yTo)
      basis += c
      perUnit.set(m.unitId, (perUnit.get(m.unitId) || 0) + c)
    }
    // Ein Zählerstand belegt Verbrauch innerhalb der abgerechneten Menge und zählt deshalb
    // unabhängig vom Beteiligungs-Kennzeichen in die Basis; der Anteil nicht vermieteter
    // Wohnungen fällt damit ohnehin dem Vermieter zu.
    const selfConsumption = selfUnits.reduce((a, u) => a + (perUnit.get(u.id) || 0), 0)
    consumptionByType[type] = { meters, basis, perUnit, selfConsumption }
  }

  const statements = new Map<string, Statement>()
  for (const t of partTenancies) {
    const from = new Date(Math.max(toUTC(t.start), toUTC(yFrom)))
    const to = t.end ? new Date(Math.min(toUTC(t.end), toUTC(yTo))) : new Date(toUTC(yTo))
    const pp = computePrepaymentCents(t, year)
    statements.set(t.id, {
      tenancyId: t.id,
      tenantName: t.tenantName,
      unitId: t.unitId,
      unitName: t.unit.name,
      persons: personsAt(t, to.toISOString().slice(0, 10)),
      personDays: personDaysInPeriod(t, yFrom, yTo),
      days: t.days,
      periodStart: from.toISOString().slice(0, 10),
      periodEnd: to.toISOString().slice(0, 10),
      rows: [],
      totalShareCents: 0,
      total35aCents: 0,
      prepaymentCents: pp.cents,
      prepaymentOverridden: pp.overridden,
      suggestedMonthlyCents: 0,
      balanceCents: 0,
    })
  }

  const landlordRows: SettlementRow[] = []
  const warnings: string[] = []
  // Der Filter ist bewusst doppelt: `snapshotFromDb` grenzt bereits nach Jahr ein. Er bleibt,
  // weil er das Einzige ist, was eine falsch eingegrenzte Ablage noch auffängt. Ohne ihn
  // rechnete ein Repository, das zu viel liefert, die Kosten mehrerer Jahre in eine Abrechnung,
  // und das fiele niemandem auf, weil jede Zeile für sich stimmig aussieht. Nicht entfernen.
  const items = snapshot.costItems.filter((c) => c.year === year)
  let totalCostsCents = 0
  let selfUsedShareCents = 0

  // Fehlende Angaben an der selbstgenutzten Wohnung heben ihren Eigenanteil beim jeweiligen
  // Schlüssel stillschweigend auf — dann verteilt er allein auf die Mieter. Deshalb warnen,
  // sobald ein betroffener Schlüssel im Jahr überhaupt vorkommt.
  const usesKey = (key: CostKey) => items.some((c) => c.key === key && c.category !== 'Nicht umlagefähig')
  // Fehlt die Basis ganz, geht jede Position des Schlüssels an den Vermieter — das meldet die
  // Position selbst. Die Meldungen je Wohnung wären dann widersprüchlich („verteilt nur auf
  // die Mieter", obwohl nichts verteilt wird) und entfallen. Ohne Mietverhältnis im Jahr
  // fehlen Personentage regulär (Leerstand) — das ist kein Datenmangel.
  const areaBasisMissing = !(basisArea > 0)
  const personsBasisMissing = !(basisPersonDays > 0) && partTenancies.length > 0
  const selfNoPersons = selfUnits.filter((u) => selfPersonsOf(u) === 0)
  if (selfNoPersons.length > 0 && usesKey('persons') && !personsBasisMissing) {
    warnings.push(
      `Für die selbstgenutzte(n) Wohnung(en) ${selfNoPersons.map((u) => u.name).join(', ')} ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt nur auf die Mieter.`,
    )
  }
  const selfNoArea = selfUnits.filter((u) => !(u.areaM2 > 0))
  if (selfNoArea.length > 0 && usesKey('area') && !areaBasisMissing) {
    warnings.push(
      `Für die selbstgenutzte(n) Wohnung(en) ${selfNoArea.map((u) => u.name).join(', ')} ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt nur auf die Mieter.`,
    )
  }
  // Dasselbe bei den übrigen Wohnungen der Abrechnungseinheit, vermietet oder leer: Fehlt ihr
  // Basiswert, verteilt der Schlüssel ihren Anteil still auf die anderen — bei einer
  // vermieteten Wohnung zahlen dann die übrigen Mieter mit. Für Mieter der teuerste Fall.
  const partNoArea = snapshot.units.filter((u) => u.participates && !(u.areaM2 > 0))
  if (partNoArea.length > 0 && usesKey('area') && !areaBasisMissing) {
    warnings.push(
      `Für die Wohnung(en) ${partNoArea.map((u) => u.name).join(', ')} ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.`,
    )
  }
  const partNoPersons = partTenancies.filter((t) => !(personDaysInPeriod(t, yFrom, yTo) > 0))
  if (partNoPersons.length > 0 && usesKey('persons') && !personsBasisMissing) {
    warnings.push(
      `Für ${partNoPersons.map((t) => `${t.tenantName} (${t.unit.name})`).join(', ')} ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt deren Anteil auf die übrigen Wohnungen.`,
    )
  }

  for (const item of items) {
    totalCostsCents += item.amountCents
    // Rohanteile (float, in Cent) pro Mietverhältnis bestimmen.
    // Nicht umlagefähige Kosten gehen immer vollständig an den Vermieter.
    const targets: Target[] = []
    // Anteil, der auf selbstgenutzte Wohnungen entfällt (Teil des Vermieteranteils) — für
    // die Steuerübersicht separat ausgewiesen, weil er privat und damit nicht abziehbar ist.
    let selfRaw = 0
    const noBasis = (reason: string) => warnings.push(`„${item.description}": ${reason} — Betrag geht an den Vermieter.`)
    if (item.category === 'Nicht umlagefähig') {
      // keine Verteilung
    } else if (item.key === 'area' && areaBasisMissing) {
      noBasis('für keine Wohnung ist eine Wohnfläche hinterlegt')
    } else if (item.key === 'units' && basisUnits.length === 0) {
      noBasis('keine Wohnung gehört zur Abrechnungseinheit')
    } else if (item.key === 'persons' && personsBasisMissing) {
      noBasis('für die vermieteten Wohnungen sind keine Personen hinterlegt')
    } else if (item.key === 'area' && basisArea > 0) {
      for (const t of partTenancies) {
        const raw = item.amountCents * ((t.unit.areaM2 || 0) / basisArea) * (t.days / diy)
        targets.push({ t, raw, basisText: `${fmtNum(t.unit.areaM2 || 0)} von ${fmtNum(basisArea)} m²${t.days < diy ? ` · ${t.days}/${diy} Tage` : ''}` })
      }
      selfRaw = item.amountCents * (selfArea / basisArea)
    } else if (item.key === 'units' && basisUnits.length > 0) {
      for (const t of partTenancies) {
        const raw = (item.amountCents / basisUnits.length) * (t.days / diy)
        targets.push({ t, raw, basisText: `1 von ${basisUnits.length} Einheiten${t.days < diy ? ` · ${t.days}/${diy} Tage` : ''}` })
      }
      selfRaw = (item.amountCents / basisUnits.length) * selfUnits.length
    } else if (item.key === 'persons' && basisPersonDays > 0) {
      for (const t of partTenancies) {
        const pd = personDaysInPeriod(t, yFrom, yTo)
        const raw = item.amountCents * (pd / basisPersonDays)
        targets.push({ t, raw, basisText: `${fmtNum(pd)} von ${fmtNum(basisPersonDays)} Personentagen` })
      }
      selfRaw = item.amountCents * (selfPersonDays / basisPersonDays)
    } else if (item.key === 'custom') {
      // Vereinbarter Schlüssel (§556a Abs. 1 Satz 1 BGB): feste Prozentanteile je Wohnung.
      // Die Anteile gelten absolut — summieren sie unter 100 %, bleibt der Rest beim
      // Vermieter. Bei Mieterwechsel wird der Anteil tagesanteilig geteilt.
      const pctOf = (unitId: string) => Number(item.customShares?.[unitId]) || 0
      const pctSum = basisUnits.reduce((a, u) => a + Math.max(0, pctOf(u.id)), 0)
      // Anteile für Wohnungen außerhalb der Abrechnungseinheit verfallen — gelöscht oder
      // auf „nicht beteiligt" gestellt. Sonst würde der Betrag unbemerkt kleiner verteilt,
      // als vereinbart ist.
      const forfeited = Object.keys(item.customShares ?? {})
        .filter((id) => pctOf(id) > 0 && !basisUnits.some((u) => u.id === id))
        .map((id) => unitById.get(id)?.name ?? 'gelöschte Wohnung')
      if (forfeited.length > 0) {
        warnings.push(`„${item.description}": der vereinbarte Anteil für ${forfeited.join(', ')} entfällt — die Wohnung gehört nicht zur Abrechnungseinheit. Dieser Teil geht an den Vermieter.`)
      }
      if (pctSum <= 0) {
        warnings.push(`„${item.description}": keine vereinbarten Anteile hinterlegt — Betrag geht an den Vermieter.`)
      } else if (pctSum > 100.0001) {
        // Nicht verteilen: mehr als die Rechnung hergibt wäre auch beim §35a-Anteil zu hoch.
        warnings.push(`„${item.description}": die vereinbarten Anteile ergeben ${fmtNum(Math.round(pctSum * 100) / 100)} % — über 100 % wird nicht verteilt, der Betrag geht an den Vermieter.`)
      } else {
        for (const t of partTenancies) {
          const pct = pctOf(t.unitId)
          if (pct <= 0) continue
          const raw = item.amountCents * (pct / 100) * (t.days / diy)
          targets.push({ t, raw, basisText: `${fmtNum(pct)} % vereinbart${t.days < diy ? ` · ${t.days}/${diy} Tage` : ''}` })
        }
        selfRaw = selfUnits.reduce((a, u) => a + item.amountCents * (pctOf(u.id) / 100), 0)
      }
    } else if (item.key === 'meter') {
      // `item.meterType` ist optional (string | null | undefined); die Indizierung selbst
      // verhält sich für null/undefined wie für einen unbekannten Zählertyp (kein Treffer,
      // `data` bleibt undefined), deshalb hier nur eine Typ-Zusicherung, keine neue Prüfung.
      const data = consumptionByType[item.meterType as MeterType]
      if (!data || data.basis <= 0) {
        warnings.push(`„${item.description}": kein Verbrauch für Zählertyp „${item.meterType ?? '—'}" erfasst — Betrag geht an den Vermieter.`)
      } else {
        selfRaw = item.amountCents * (data.selfConsumption / data.basis)
        for (const t of partTenancies) {
          const meters = data.meters.filter((m) => m.unitId === t.unitId)
          let c = 0
          for (const m of meters) {
            const readings = allReadings.filter((r) => r.meterId === m.id)
            const pFrom = t.start > yFrom ? t.start : yFrom
            const pTo = t.end && t.end < yTo ? t.end : yTo
            c += consumptionInPeriod(readings, pFrom, pTo)
          }
          const raw = item.amountCents * (c / data.basis)
          targets.push({ t, raw, basisText: `${fmtNum(Math.round(c * 100) / 100)} von ${fmtNum(Math.round(data.basis * 100) / 100)} (gemessen)` })
        }
      }
    } else if (item.key === 'direct') {
      // `item.directUnitId` ist optional (string | null | undefined); Map.get() verhält sich
      // für null/undefined wie für eine unbekannte ID (kein Treffer), deshalb hier nur eine
      // Typ-Zusicherung, keine neue Prüfung.
      const target = unitById.get(item.directUnitId as string)
      if (!target) {
        warnings.push(`„${item.description}": die direkt zugeordnete Wohnung gibt es nicht mehr — Betrag geht an den Vermieter.`)
      } else if (!target.participates && !target.selfUsed) {
        // Leerstand und Eigennutzung sind reguläre Fälle; eine Wohnung außerhalb der
        // Abrechnungseinheit ist dagegen ein Datenfehler.
        noBasis(`die direkt zugeordnete Wohnung ${target.name} gehört nicht zur Abrechnungseinheit`)
      }
      for (const t of tenancies.filter((t) => t.unitId === item.directUnitId)) {
        const raw = item.amountCents * (t.days / diy)
        targets.push({ t, raw, basisText: `Direktzuordnung ${t.unit.name}${t.days < diy ? ` · ${t.days}/${diy} Tage` : ''}` })
      }
      // Eigenanteil nur, soweit die Kosten nicht doch einem Mieter dieser Wohnung zufallen
      // (z. B. Mietverhältnis bis März, Eigennutzung ab April).
      if (selfUnits.some((u) => u.id === item.directUnitId)) selfRaw = item.amountCents
    }
    // Exakte Cent-Verteilung: wenn die Rohanteile die Gesamtsumme (nahezu) voll ausschöpfen,
    // wird centgenau auf die Mieter verteilt; ansonsten trägt der Vermieter die Differenz
    // (Leerstand, Eigenanteil, Rundungsrest).
    const rawSum = targets.reduce((a, x) => a + x.raw, 0)
    let shares: number[]
    if (targets.length > 0 && Math.abs(item.amountCents - rawSum) < 0.5) {
      shares = largestRemainder(item.amountCents, targets.map((x) => x.raw), targets.map((x) => String(x.t.id)))
    } else {
      shares = targets.map((x) => Math.round(x.raw))
    }
    // §35a-Lohnanteil. Die Mieter bekommen zusammen den Lohnanteil, der auf ihre gebuchten
    // Kostenanteile entfällt — kaufmännisch auf den Cent gerundet und nie mehr als der
    // Lohnanteil der Rechnung. Diese Summe wird mit demselben Restverfahren und Tie-Break
    // verteilt wie die Kosten. Je Zeile zu runden könnte mehr bescheinigen, als die Rechnung
    // enthält (3 × 66,67 € = 200,01 € bei 200,00 € Lohnanteil). Tragen die Mieter die Position
    // ganz, stimmt die Summe centgenau; bei Leerstand und Eigennutzung bleibt der
    // entsprechende Teil beim Vermieter. Die kaufmännische Rundung ist eine Festlegung dieser
    // Berechnung, keine Vorgabe des §35a EStG.
    const labor = item.labor35aCents ?? 0
    const laborOf = new Map<number, number>()
    if (labor !== 0 && (labor < 0 || labor > item.amountCents)) {
      warnings.push(`„${item.description}": der §35a-Lohnanteil muss zwischen 0 und dem Rechnungsbetrag liegen — es wird kein Lohnanteil bescheinigt.`)
    } else if (labor > 0) {
      const booked = targets.map((_, i) => i).filter((i) => statements.has(targets[i].t.id))
      const bookedCents = booked.reduce((a, i) => a + shares[i], 0)
      const tenantLabor = Math.min(labor, Math.round((labor * bookedCents) / item.amountCents))
      const parts = largestRemainder(
        tenantLabor,
        booked.map((i) => (labor * shares[i]) / item.amountCents),
        booked.map((i) => String(targets[i].t.id)),
      )
      booked.forEach((i, k) => laborOf.set(i, parts[k]))
    }
    let distributed = 0
    targets.forEach((x, i) => {
      const st = statements.get(x.t.id)
      // Mietverhältnis in einer nicht beteiligten Wohnung (nur bei Direktzuordnung möglich):
      // Der Anteil gilt als nicht verteilt, sonst fehlte er in der Abrechnung ganz — er muss
      // in den Vermieteranteil laufen.
      if (!st) return
      distributed += shares[i]
      const labor35a = laborOf.get(i) ?? 0
      st.rows.push({
        costItemId: item.id,
        category: item.category,
        description: item.description,
        totalCents: item.amountCents,
        key: item.key,
        keyLabel: KEY_LABELS[item.key] || item.key,
        basisText: x.basisText,
        shareCents: shares[i],
        labor35aCents: labor35a,
      })
      st.totalShareCents += shares[i]
      st.total35aCents += labor35a
    })
    const landlordCents = item.amountCents - distributed
    // Der Eigenanteil ist ein Teil des Vermieteranteils dieser Position — deshalb an dem
    // begrenzen, was tatsächlich beim Vermieter gebucht wurde. Sonst könnte der separat
    // ausgewiesene Betrag durch Rundung über dem Vermieteranteil liegen.
    if (selfRaw > 0 && landlordCents > 0) {
      selfUsedShareCents += Math.min(Math.round(selfRaw), landlordCents)
    }
    if (landlordCents !== 0) {
      landlordRows.push({
        costItemId: item.id,
        category: item.category,
        description: item.description,
        totalCents: item.amountCents,
        keyLabel: KEY_LABELS[item.key] || item.key,
        shareCents: landlordCents,
      })
    }
  }

  const result: ComputedSettlement = {
    year,
    daysInYear: diy,
    statements: [...statements.values()],
    landlord: {
      rows: landlordRows,
      totalCents: landlordRows.reduce((a, r) => a + r.shareCents, 0),
    },
    // Im Vermieteranteil enthaltener Teil, der auf selbstgenutzte Wohnungen entfällt
    // (der Rest sind Leerstand, nicht umlagefähige Positionen und Rundungsdifferenzen).
    selfUsedShareCents,
    totalCostsCents,
    warnings,
  }
  for (const st of result.statements) {
    st.balanceCents = st.prepaymentCents - st.totalShareCents // >0 Guthaben, <0 Nachzahlung
    // Vorschlag nach §560 Abs. 4 BGB: ein Zwölftel der Jahreskosten, auf volle Euro gerundet
    st.suggestedMonthlyCents = Math.round(st.totalShareCents / 12 / 100) * 100
  }
  return result
}

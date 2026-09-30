// Berechnungs-Engine für die Nebenkostenabrechnung.
// Alle Beträge werden in Cent (Integer) gerechnet, um Gleitkomma-Fehler zu vermeiden.
import type {
  CalcStep,
  CostKey,
  CostModel,
  LegalBasis,
  NotSettled,
  ExternalMeasure,
  MeterType,
  Notice,
  NoticeLevel,
  NoticeSubject,
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
import { RULES_AS_OF, ruleCoverage, rulesFor } from './rules.ts'
import type { TermId } from '../../shared/glossary.ts'
import type { Snapshot, SnapshotCostItem, SnapshotMeter, SnapshotReading, SnapshotTenancy, SnapshotUnit } from './snapshot.ts'

export const KEY_LABELS: Record<CostKey, string> = {
  area: 'Wohnfläche',
  persons: 'Personenzahl',
  units: 'Wohneinheiten',
  direct: 'Direktzuordnung',
  meter: 'Verbrauch (Zähler)',
  custom: 'Vereinbarte Anteile',
  external: 'Laut Gemeinschaftsabrechnung',
  amounts: 'Einzelbetrag',
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

// ---------- Hinweise (#112) ----------

// Jede Meldung der Berechnung hat einen festen Code, und Stufe, Titel und Regel hängen am Code
// und nicht an der Stelle, die sie ausgibt. So kann derselbe Code nie mit zwei Stufen
// erscheinen, und wer eine Meldung ergänzt, muss sie hier eintragen: `warn` nimmt nur Codes aus
// dieser Tabelle. Der Text bleibt an der Stelle, weil er die Einzelheiten des Falls nennt.
// Die Stufen sind in shared/types.ts (`NoticeLevel`) fachlich bestimmt.
// `terms`: die Begriffe des Lexikons (#113), die den Hinweis erklären, mindestens einer.
type NoticeKind = { level: NoticeLevel, title: string, rule?: string, terms: [TermId, ...TermId[]] }
const noticeKinds = {
  'meter.replacement-without-end': { level: 'warning', title: 'Zählerwechsel ohne Endstand', terms: ['meterReading'] },
  'meter.negative': { level: 'warning', title: 'Negativer Verbrauch', terms: ['meterReading'] },
  'meter.same-day': { level: 'warning', title: 'Mehrere Ablesungen am selben Tag', terms: ['meterReading'] },
  'basis.self-no-persons': { level: 'warning', title: 'Personenzahl der eigenen Wohnung fehlt', terms: ['ownShare', 'personDays'] },
  'basis.self-no-area': { level: 'warning', title: 'Wohnfläche der eigenen Wohnung fehlt', terms: ['ownShare', 'distributionBasis'] },
  'basis.unit-no-area': { level: 'warning', title: 'Wohnfläche fehlt', terms: ['distributionBasis'] },
  'basis.tenancy-no-persons': { level: 'warning', title: 'Personenzahl fehlt', terms: ['personDays'] },
  'tv-signal.partial-year': { level: 'warning', title: 'Kabelfernsehen nur bis 30.06.2024 umlagefähig', rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
  'tv-signal.ended': { level: 'warning', title: 'Kabelfernsehen nicht mehr umlagefähig', rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
  'tv-signal.new-system': { level: 'warning', title: 'Kabelfernsehen bei neuer Anlage nie umlagefähig', rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
  'item.no-basis': { level: 'warning', title: 'Position geht ganz an den Vermieter', terms: ['distributionBasis'] },
  'external.value-missing': { level: 'warning', title: 'Miteigentumsanteil oder Wohnfläche fehlt', terms: ['mea', 'homeownersStatement'] },
  'external.amount-mismatch': { level: 'hint', title: 'Betrag passt nicht zum Anteil', terms: ['homeownersStatement', 'mea'] },
  'amounts.exceed': { level: 'error', title: 'Einzelbeträge über dem Rechnungsbetrag', terms: ['individualAmounts'] },
  'amounts.forfeited': { level: 'warning', title: 'Einzelbetrag ohne Mietverhältnis', terms: ['individualAmounts'] },
  'amounts.missing': { level: 'warning', title: 'Einzelbetrag fehlt', terms: ['individualAmounts'] },
  'amounts.self-hidden': { level: 'hint', title: 'Eigenanteil nicht ausgewiesen', terms: ['individualAmounts', 'ownShare'] },
  'amounts.self-forfeited': { level: 'warning', title: 'Eigenbetrag ohne selbstgenutzte Wohnung', terms: ['individualAmounts', 'ownShare'] },
  'custom.forfeited': { level: 'warning', title: 'Vereinbarter Anteil entfällt', terms: ['agreedShares', 'billingUnit'] },
  'custom.none': { level: 'warning', title: 'Keine vereinbarten Anteile', terms: ['agreedShares'] },
  'custom.over-100': { level: 'error', title: 'Vereinbarte Anteile über 100 %', terms: ['agreedShares'] },
  'meter.no-consumption': { level: 'warning', title: 'Kein Verbrauch erfasst', terms: ['consumptionKey'] },
  'meter.unit-without-meter': { level: 'warning', title: 'Wohnung ohne Zähler', terms: ['mainMeter', 'consumptionKey'] },
  'meter.sub-exceeds-main': { level: 'warning', title: 'Wohnungszähler über dem Hauptzähler', terms: ['mainMeter'] },
  'meter.main-partial': { level: 'warning', title: 'Hauptzähler deckt nicht das ganze Jahr ab', terms: ['mainMeter', 'meterReading'] },
  'meter.main-gap': { level: 'hint', title: 'Wohnungszähler erfassen wenig vom Hauptzähler', terms: ['mainMeter'] },
  'meter.unit-partial': { level: 'warning', title: 'Zähler deckt nicht die ganze Zeit ab', terms: ['mainMeter', 'meterReading'] },
  'direct.unit-gone': { level: 'warning', title: 'Zugeordnete Wohnung gibt es nicht mehr', terms: ['directAssignment'] },
  'labor35a.invalid': { level: 'warning', title: 'Lohnanteil nach § 35a ungültig', terms: ['labor35a'] },
  'heating.flat-rate': { level: 'warning', title: 'Heizkosten pauschal vereinbart', rule: 'heating-flat-rate', terms: ['heatingCostOrdinance', 'inclusiveRent'] },
  'model.prepayment-unsettled': { level: 'warning', title: 'Vorauszahlung ohne Abrechnung', terms: ['prepayment', 'flatRate'] },
} satisfies Record<string, NoticeKind>
export type NoticeCode = keyof typeof noticeKinds
export const NOTICE_KINDS: Readonly<Record<string, NoticeKind | undefined>> = noticeKinds

function makeNotice(code: NoticeCode, text: string, subject: NoticeSubject | undefined): Notice {
  const kind: NoticeKind = noticeKinds[code]
  return { code, level: kind.level, title: kind.title, text, ...(subject ? { subject } : {}), ...(kind.rule ? { rule: kind.rule } : {}), terms: kind.terms }
}
const itemSubject = (item: { id: string }): NoticeSubject => ({ kind: 'costItem', id: item.id })
const meterSubject = (reading: SnapshotReading): NoticeSubject => ({ kind: 'meter', id: reading.meterId })
// Nennt eine Meldung mehrere Wohnungen oder Mietverhältnisse, führt der Knopf zur ersten; die
// Seite ist dieselbe.
const unitSubject = (units: { id: string }[]): NoticeSubject | undefined => (units[0] ? { kind: 'unit', id: units[0].id } : undefined)
const tenancySubject = (tenancies: { id: string }[]): NoticeSubject | undefined =>
  tenancies[0] ? { kind: 'tenancy', id: tenancies[0].id } : undefined

// ---------- Zähler & Verbrauch ----------

type MeterSegment = { from: string, to: string, delta: number, days: number }

// Ablesungen eines Zählers → Verbrauchssegmente zwischen aufeinanderfolgenden Ablesungen.
// Konvention: eine Ablesung gilt zum Tagesende ihres Datums. Bei Zählerwechsel trägt die
// Ablesung replacement=true: oldEndValue = Endstand des alten Geräts, value = Startstand des neuen.
// Zählerstände haben mehr Nachkommastellen als Geld: Ein Wasserzähler zeigt drei. Mit `fmtNum`
// (zwei Stellen) meldete die Warnung unten bei 150,001 gegen 150,004 einen „Unterschied von 0"
// und widerspräche sich damit selbst.
function fmtMeter(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 3 })
}

export function meterSegments(readings: SnapshotReading[]): { segments: MeterSegment[], notices: Notice[], warnings: string[] } {
  const sorted = readings.slice().sort((a, b) => compareText(a.date, b.date))
  const segments: MeterSegment[] = []
  const notices: Notice[] = []
  const warn = (code: NoticeCode, text: string, subject?: NoticeSubject) => notices.push(makeNotice(code, text, subject))
  // Je Tag die Menge, die zwischen Ablesungen desselben Tages herausfällt (#69, unten begründet).
  const lostPerDay = new Map<string, number>()
  for (let i = 1; i < sorted.length; i++) {
    const r0 = sorted[i - 1]
    const r1 = sorted[i]
    // **Ein Zählerwechsel ohne Endstand des alten Geräts ist keine Angabe, sondern eine Lücke**
    // (#83). Er wird mit `replacement` gekennzeichnet, und der letzte Stand des alten Geräts
    // steht in `oldEndValue`. Fehlt das Feld, las ein `?? 0` es als Null, und aus einem
    // Zählerstand von 980 wurde ein Segment von minus 980; gemessen ergab das einen
    // Jahresverbrauch von minus 910. Das ist nicht bloß eine falsche Zahl: Beim
    // Verbrauchsschlüssel geht sie in die Verteilbasis ein und verschiebt die Anteile aller
    // Mieter, ohne dass irgendwo etwas auffällt.
    //
    // **Gefragt wird nach `null` und nicht nach dem Wert**, denn genau dieses Zusammenwerfen war
    // der Fehler. Ein ausdrücklich eingetragener Endstand von 0 ist eine Angabe: Der alte Zähler
    // stand auf null, lief also rückwärts, und dafür gibt es die Meldung weiter unten.
    //
    // Verteilt wird nichts, und erfunden erst recht nichts. Wie viel das alte Gerät bis zum
    // Wechsel verbraucht hat, weiß nur der Vermieter; das neue rechnet ab seinem Startstand
    // normal weiter. Dieselbe Haltung wie bei zwei Ablesungen am selben Tag (#69).
    //
    // **Und dieselbe Folge: Bezahlt wird die Lücke von einem anderen Mieter**, nicht vom
    // Vermieter. Gemessen an zwei Wohnungen mit 2.000 € Wasser sinkt der Anteil des Mieters mit
    // der Lücke von 802,40 € auf 540,15 €, während der andere 1.459,85 € statt 1.197,60 € zahlt.
    // Deshalb ist die Meldung das Einzige, was den Vermieter darauf stößt: Auf der Abrechnung
    // liest sich der Rechenweg völlig plausibel.
    //
    // **Steht ein solcher Wechsel als allererste Ablesung des Zählers da, gibt es keine
    // Meldung**, denn die Schleife beginnt beim zweiten Eintrag. Das ist richtig so: Ohne
    // Vorgänger fehlt nichts, es gibt keinen Zeitraum, über den das alte Gerät gelaufen wäre.
    if (r1.replacement && r1.oldEndValue == null) {
      warn('meter.replacement-without-end',
        `Zählerwechsel am ${r1.date} ohne Endstand des alten Geräts — der Verbrauch bis zum ` +
          'Wechsel lässt sich nicht bestimmen und wird nicht verteilt. Bitte den Endstand nachtragen.',
        meterSubject(r1),
      )
      continue
    }

    const delta = r1.replacement ? (r1.oldEndValue ?? 0) - r0.value : r1.value - r0.value
    const days = Math.round((toUTC(r1.date) - toUTC(r0.date)) / MS_DAY)

    // **Ablesungen am selben Tag: die Differenz verschwindet, und das wird gesagt** (#69).
    //
    // Ein Segment entsteht nur, wenn mindestens ein Tag dazwischenliegt, sonst müsste durch null
    // geteilt werden, um tagesanteilig zu verteilen. Das ist richtig. Bisher fiel die Differenz
    // dabei aber ersatzlos und ohne Meldung unter den Tisch.
    //
    // **Wer das bezahlt, ist nachgemessen, und es ist nicht der Vermieter.** Beim
    // Verbrauchsschlüssel ist die Verteilbasis die Summe des *gemessenen* Verbrauchs: Fehlt bei
    // einem Zähler etwas, schrumpfen Zähler und Nenner gemeinsam, und `largestRemainder` verteilt
    // den Rechnungsbetrag trotzdem vollständig. Gemessen an zwei Wohnungen mit je 100 m³ und
    // 2.000 € Wasser, mit einem Tippfehler von 10 m³ bei Mieter A: A zahlt 947,37 € statt
    // 1.000 €, **B zahlt 1.052,63 €**, der Vermieter trägt in beiden Fällen nichts. Liegt die
    // Doppelablesung am Zähler einer selbstgenutzten Wohnung, dreht es sich um und der Vermieter
    // zahlt zu wenig. Das ist schlimmer als ein Verlust beim Vermieter: Ein Mieter bekommt eine
    // zugestellte Abrechnung mit zu viel darauf, und niemandem fällt es auf.
    //
    // **Verteilt wird trotzdem nicht.** Das Haus hat für zwei Einträge zum selben Stichtag eine
    // ausformulierte Regel, nämlich „es gilt der letzte" (`lastPerFrom` in schedule.ts), und sie
    // käme hier auf das Richtige: Bei einer Korrektur gölte der zweite Stand, beim Zählerwechsel
    // der `oldEndValue`. Sie greift hier aus zwei Gründen trotzdem nicht.
    //
    // Erstens bräuchte sie eine Ausnahme, nämlich dass die Wechsel-Ablesung immer gewinnt. Sonst
    // löschte eine zufällige Eingabereihenfolge — erst der Wechsel, dann eine gewöhnliche
    // Ablesung desselben Tages — den `oldEndValue` und mit ihm den ganzen Zählerwechsel. Das wäre
    // eine neue Regel, und neue Regeln über Geld werden nicht nebenbei eingeführt.
    //
    // Zweitens, und das wiegt schwerer: Eine Doppelablesung liegt am wahrscheinlichsten auf einer
    // Grenze, also am 31. Dezember oder am Auszugstag. Dort gehören die beiden Nachbarsegmente
    // **verschiedenen Mietern**. Die Menge einem davon zuzuschlagen hieße, still einen von beiden
    // auszuwählen, und welcher der richtige ist, weiß nur der Vermieter. Ihn zu fragen ist die
    // einzige Antwort, die nicht rät.
    //
    // **Eine Meldung je Tag, nicht je Paar.** Bei drei Ablesungen am selben Tag stünde sonst
    // zweimal wortgleich dasselbe da, und das Wort „zwei" stimmte nicht mehr. Summiert ergibt
    // sich genau die Menge, die am Ende fehlt: Bei 150, 160, 150 heben sich die beiden Sprünge
    // auf, es fehlt nichts, und es gibt zu Recht keine Meldung.
    //
    // **Hier gilt diese Meldung und nicht die über negativen Verbrauch**, auch wenn die Differenz
    // negativ ist. Jene spricht von einem Zähler, der über die Zeit zurückläuft, und über null
    // Tage gibt es diese Zeit nicht; ihr Wortlaut wäre an dieser Stelle in beiden Hälften falsch
    // („zwischen dem 30.06. und dem 30.06." ist kein Zeitraum, und „Zählerwechsel markieren" ist
    // gerade beim markierten Zählerwechsel der falsche Rat).
    if (days === 0) {
      if (delta !== 0) lostPerDay.set(r0.date, (lostPerDay.get(r0.date) ?? 0) + delta)
      continue
    }

    if (delta < 0) {
      warn('meter.negative', `Negativer Verbrauch zwischen ${r0.date} und ${r1.date} (${delta}) — Ablesung prüfen oder Zählerwechsel markieren.`, meterSubject(r1))
    }
    segments.push({ from: r0.date, to: r1.date, delta, days })
  }
  for (const [date, lost] of lostPerDay) {
    // Heben sich mehrere Sprünge desselben Tages auf, fehlt nichts.
    if (lost === 0) continue
    warn('meter.same-day',
      `Mehrere Ablesungen am ${date}: Die Stände unterscheiden sich um ${fmtMeter(Math.abs(lost))}, ` +
        'und diese Menge wird nicht verteilt, weil zwischen ihnen kein Tag liegt. ' +
        'Bitte eine der Ablesungen prüfen.',
      sorted[0] && meterSubject(sorted[0]),
    )
  }
  return { segments, notices, warnings: notices.map((n) => n.text) }
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
// Tage im Zeitraum [from, to], die Segmente des Zählers abdecken (#116). Eine Ablesung gilt
// zum Tagesende, ein Segment deckt also die Tage nach seiner ersten Ablesung bis einschließlich
// seiner letzten. Eine Lücke, etwa ein Zählerwechsel ohne Endstand, deckt nichts ab.
function coveredDays(readings: SnapshotReading[], from: string, to: string): number {
  return meterSegments(readings).segments.reduce(
    (a, seg) => a + rangeOverlapDays(new Date(toUTC(seg.from) + MS_DAY).toISOString().slice(0, 10), seg.to, from, to),
    0,
  )
}

// Wie viele Tage die Zähler einer Einheit zusammen abdecken. Zähler laufen **nebeneinander**
// (Küche und Bad, jeder muss das ganze Jahr abdecken) oder **nacheinander** (ein Tausch, als neuer
// Zähler angelegt statt als Wechsel; sie decken es gemeinsam ab), und oft beides zugleich. Deshalb
// werden die Zähler zu Ketten sortiert: Ein Zähler hängt sich an eine Kette, deren letzter Zähler
// endete, bevor er begann; sonst beginnt er eine neue. Jede Kette steht für eine Messstelle, und
// jede muss das Jahr abdecken, es zählt also die kürzeste Kette (zweite Integrationsdurchsicht).
// Ein Zähler, der vor dem Jahr endete, ist Geschichte und fällt weg; ein Zähler ohne jede Ablesung
// zählt als Messstelle ohne Abdeckung, sonst gälte ein vergessenes Bad als gemessen.
function unitCoveredDays(readingsPerMeter: SnapshotReading[][], from: string, to: string): number {
  const spans: { from: string, to: string, days: number }[] = []
  for (const readings of readingsPerMeter) {
    const segs = meterSegments(readings).segments
    const first = segs[0]
    const last = segs[segs.length - 1]
    if (!first || !last) return 0
    const days = coveredDays(readings, from, to)
    if (days === 0 && compareText(last.to, from) < 0) continue
    spans.push({ from: first.from, to: last.to, days })
  }
  if (spans.length === 0) return 0
  spans.sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to))
  const chains: { to: string, days: number }[] = []
  for (const sp of spans) {
    const chain = chains.find((c) => compareText(c.to, sp.from) <= 0)
    if (chain) {
      chain.to = sp.to
      chain.days += sp.days
    } else {
      chains.push({ to: sp.to, days: sp.days })
    }
  }
  return Math.min(...chains.map((c) => c.days))
}

export type ConsumptionOverviewRow = {
  meterId: string
  consumption: number
  readingCount: number
  notices: Notice[]
  warnings: string[]
}

// Jahresübersicht für die Zähler-Seite: Verbrauch pro Zähler + Warnungen
export function consumptionOverview(snapshot: Snapshot): ConsumptionOverviewRow[] {
  const from = `${snapshot.year}-01-01`
  const to = `${snapshot.year}-12-31`
  return snapshot.meters.map((m) => {
    const readings = snapshot.readings.filter((r) => r.meterId === m.id)
    const { notices, warnings } = meterSegments(readings)
    return {
      meterId: m.id,
      consumption: Math.round(consumptionInPeriod(readings, from, to) * 100) / 100,
      readingCount: readings.length,
      notices,
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
      const flatSchedule: MonthlySchedule[] = Array.isArray(t.flatRates) ? t.flatRates : []

      const months: RentMonth[] = []
      for (let m = 1; m <= 12; m++) {
        const mm = `${year}-${String(m).padStart(2, '0')}`
        const firstDay = `${mm}-01`
        const active = t.start <= firstDay && !(t.end && t.end < firstDay)
        const baseRentCents = active ? rateAtMonth(baseSchedule, mm) : 0
        const prepaymentCents = active ? rateAtMonth(ppSchedule, mm) : 0
        const flatRateCents = active ? rateAtMonth(flatSchedule, mm) : 0
        months.push({
          month: m,
          baseRentCents,
          prepaymentCents,
          flatRateCents,
          sollCents: baseRentCents + prepaymentCents + flatRateCents,
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
      const flatRateYearCents = months.reduce((a, mo) => a + mo.flatRateCents, 0)
      return {
        tenancyId: t.id,
        tenantName: t.tenantName,
        unitName: unitById.get(t.unitId)?.name ?? '—',
        months,
        sollYearCents,
        baseRentYearCents,
        prepaymentYearCents,
        flatRateYearCents,
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
// Ausgeführt für categories.test.ts, das die drei Listen der Kostenarten zusammenhält.
export const ANLAGE_V_GROUP: Record<string, string> = {
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
  // #93: Heizung und Warmwasser sind laufende Betriebskosten wie Wasser und Strom.
  'Heizung und Warmwasser': 'Laufende Betriebskosten',
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

// Jahres-Steuerübersicht (Hilfe für die Anlage V): das vereinbarte Soll aus dem Mietkonto, das
// tatsächlich Zugeflossene unmittelbar aus den Zahlungen,
// Werbungskosten aus den Kostenpositionen nach Anlage-V-Gruppen, §35a-Lohnanteile sowie
// der Flächenanteil der vermieteten Einheiten (für gemischt genutzte Gebäude). Die
// Werbungskosten folgen dem Abflussprinzip (im Jahr gebuchte Kosten), die Einnahmen
// werden sowohl als Soll (vereinbart) als auch als Ist (tatsächlich gezahlt) geliefert.
export function taxReport(snapshot: Snapshot): TaxReport {
  const year = snapshot.year
  const ledger = rentLedger(snapshot)
  const baseRentSollCents = ledger.rows.reduce((a, r) => a + r.baseRentYearCents, 0)
  const prepaymentSollCents = ledger.rows.reduce((a, r) => a + r.prepaymentYearCents, 0)
  // Die Pauschale (#93) gehört zum Soll wie Kaltmiete und Vorauszahlung und bekommt ihre eigene
  // Zeile; sonst stünde sie in der Summe, ohne dass die Aufstellung sie nennt.
  const flatRateSollCents = ledger.rows.reduce((a, r) => a + r.flatRateYearCents, 0)
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
  // Für die Kopfzeilen der Anlage V (#96): Zeile 24 fragt, ob Nebenkosten nicht gesondert
  // vereinbart sind (Inklusivmiete), und eine Pauschale gehört zu den Umlagen in Zeile 20.
  // Heizung und Warmwasser gehören zu den Nebenkosten: „ganz inklusiv“ heißt deshalb kalt und warm
  // inklusiv, und eine Pauschale zählt bei kalt oder warm (Durchsicht).
  const tenancyById = new Map(snapshot.tenancies.map((t) => [t.id, t]))
  const models = ledger.rows.map((r) => {
    const t = tenancyById.get(r.tenancyId)
    return { cold: t?.costModel ?? 'settlement', heat: t?.heatingModel ?? 'settlement' }
  })
  const costModels = {
    tenancies: models.length,
    inclusive: models.filter((m) => m.cold === 'inclusive' && m.heat === 'inclusive').length,
    partlyInclusive: models.filter((m) => (m.cold === 'inclusive') !== (m.heat === 'inclusive')).length,
    flatRate: models.filter((m) => m.cold === 'flatRate' || m.heat === 'flatRate').length,
  }
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

  // ---------- Gemischte Nutzung: gemessen wird das Private (#68) ----------
  //
  // **Gefragt wird dreiwertig**, wie überall sonst (`UnitUsage` in shared/types.ts): vermietet,
  // selbstgenutzt, außerhalb der Abrechnungseinheit. Vorher stand hier `!u.participates`, und
  // damit schlug eine ausdrücklich ausgenommene Wohnung — etwa eine getrennt abgerechnete
  // Gewerbeeinheit — als Eigennutzung durch. Der Vermieter bekam die Aufforderung, den
  // selbstgenutzten Anteil herauszurechnen, obwohl er gar nichts selbst nutzt. Die Regel ist
  // dieselbe wie bei `selfUnits` in computeSettlement, und sie steht bewusst nicht zweimal
  // ausformuliert da.
  //
  // **Gemessen wird der selbstgenutzte Anteil und nicht der vermietete**, und das ist die
  // Antwort auf die zweite Frage des Issues. Nur das Private ist eindeutig: Ob eine ausgenommene
  // Wohnung vermietet ist, weiß Mietfuchs nicht, ob sie selbstgenutzt ist, sehr wohl. Und die
  // steuerliche Frage ist ohnehin die nach dem privaten Anteil, denn er ist der nicht
  // abziehbare.
  //
  // **Die Grundmenge ist das ganze Gebäude und damit eine andere als die der Abrechnung.** Das
  // ist gewollt: Die Verteilbasis der Abrechnung beantwortet „welche Wohnungen teilen sich diese
  // Rechnung" und lässt ausgenommene Wohnungen deshalb weg; hier lautet die Frage „wie viel
  // meines Gebäudes ist privat", und dafür gehört jeder Quadratmeter in den Nenner. Der
  // Unterschied steht in der Oberfläche, nicht nur hier.
  const allUnits = snapshot.units
  const totalArea = allUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  const selfUsedUnits = allUnits.filter((u) => u.selfUsed && !u.participates)
  // **Ausgegeben werden die Flächen und nicht ihr Verhältnis.** Die Anlage V fragt im Kopf nach
  // der Gesamtwohnfläche und dem davon eigengenutzten Teil; das sind genau diese beiden Zahlen,
  // und sie sind nachprüfbar. Ein bloßer Prozentsatz lädt außerdem dazu ein, den Rest für den
  // abziehbaren Anteil zu halten, und das ist falsch, sobald es Wohnungen außerhalb der
  // Abrechnungseinheit gibt.
  const selfUsedAreaM2 = selfUsedUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)
  const selfOccupiedExists = selfUsedUnits.length > 0
  // **Wohnungen, die Mietfuchs nicht einordnen kann**, und deshalb ein eigener Hinweis statt
  // Schweigen. Zwei verschiedene Bestände fallen hier zusammen: die ausdrücklich ausgenommene
  // Gewerbeeinheit und die eigene Wohnung aus einem Bestand von vor der dreiwertigen
  // Unterscheidung, den die Migration in legacy/migrate.ts bewusst nicht anfasst (ein gesetztes
  // Kennzeichen veränderte die Verteilung bereits abgerechneter Jahre). Ohne diesen Hinweis
  // nähme die Behebung ausgerechnet dem die Hilfe weg, der sie braucht, nämlich dem Vermieter
  // mit altem Bestand und eigener Wohnung im Haus.
  //
  // **Dass beide zusammenfallen, ist eine Wahl und keine Eigenschaft der Daten.** Sie lassen
  // sich sehr wohl unterscheiden: Die Stammdaten schreiben beide Kennzeichen immer gemeinsam
  // (`unitForm.ts`), „ausgenommen" ergibt also ausdrücklich `selfUsed: false`, während ein alter
  // Bestand das Feld gar nicht führt. Darauf eine Steuerauskunft zu stützen wäre aber brüchig:
  // `emptyUnit` in db/repository.ts kennt das Feld nicht, und ein `POST /api/units` ohne das
  // Feld liefert ebenfalls `undefined`. „Nicht gesetzt heißt nie eingeordnet" ist heute nirgends
  // zugesichert, und ohne Zusicherung samt Test ist es keine Grundlage. Wer das ändern will,
  // fängt bei der Zusicherung an, nicht hier.
  const excludedExists = allUnits.some((u) => !u.participates && !u.selfUsed)
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
      flatRateSollCents,
      prepaymentSettlementCents,
      prepaymentOverridden,
      sollCents,
      paidCents,
      tenanciesWithSoll,
      tenanciesWithoutPayment,
    },
    expenses: { groups, totalCents, labor35aCents },
    totalAreaM2: totalArea,
    selfUsedAreaM2,
    selfOccupiedExists,
    excludedExists,
    costModels,
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

// Zwischenwerte des Rechenwegs (#114). Der Prozentsatz mit bis zu sechs Stellen, damit Betrag ×
// Prozent auch bei 30.000 € noch den gezeigten Wert ergibt; der genaue Betrag mit mindestens zwei
// und höchstens vier, damit ein Rundungsschritt sichtbar bleibt und er neben den übrigen
// Beträgen nicht ohne Cent dasteht.
function fmtPercent(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 6 })
}
function fmtExactEuro(cents: number): string {
  return `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`
}

// Ein Betrag für den Rechenweg auf der Abrechnung (#94): mit zwei Stellen und einem gewöhnlichen
// Leerzeichen vor dem Zeichen. `toLocaleString` mit `currency` setzte ein geschütztes, das in
// den Zeilen nicht anders aussieht, beim Vergleichen und Kopieren aber stört.
function fmtCents(cents: number): string {
  return `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

// Die Maßstäbe einer Gemeinschaft, wie sie im Rechenweg heißen (#94).
const MEASURE_LABELS: Record<ExternalMeasure, string> = { mea: 'MEA', area: 'm²', units: 'Einheiten' }

// ---------- Abrechnung ----------

// Mietverhältnis, ergänzt um die im Jahr belegten Tage und die zugehörige Wohnung: das
// Ergebnis der Vorbereitung unten, sobald Mietverhältnisse ohne (mehr) vorhandene Wohnung
// herausgefiltert sind.
type TenancyWithUnit = SnapshotTenancy & { days: number, unit: SnapshotUnit }

// Ziel einer Kostenverteilung: das Mietverhältnis, sein (float) Rohanteil in Cent und der Text,
// der die Berechnungsgrundlage auf der Abrechnung beschreibt.
// `ownShare`: bei der Gemeinschaftsabrechnung der Anteil innerhalb der eigenen Wohnungen, nach
// dem wirklich gerechnet wird (#114); die Verteilbasis nennt dort die Summe der ganzen Anlage.
type Target = { t: TenancyWithUnit, raw: number, basisText: string, ownShare?: string }

// Verbrauch und Zähler eines Zählertyps, aufbereitet für die Verteilung. Der Wert ist bewusst
// optional (nicht `Record<string, ConsumptionByTypeEntry>`): zu einer Kostenposition mit einem
// Zählertyp ohne Zähler gibt es keinen Eintrag, und `data` unten ist dann `undefined` statt
// eines für den Übersetzer immer vorhandenen Werts. Nur so bleibt die folgende Prüfung
// `if (!data || data.basis <= 0)` sichtbar nötig statt totem Code.
// Zum Hauptzähler (#116): `unmetered` sind bewohnte Einheiten ohne abgelesenen Zähler dieses
// Typs. `main` ist sein Verbrauch, wenn er die Basis ist, sonst null. Die übrigen Felder sagen,
// warum er es nicht ist, oder dass er weit mehr zeigt als die Wohnungszähler.
type ConsumptionByTypeEntry = {
  meters: (SnapshotMeter & { unitId: string })[]
  basis: number
  perUnit: Map<string, number>
  selfConsumption: number
  unmetered: SnapshotUnit[]
  limited: boolean
  hasMain: boolean
  main: number | null
  mainPartial: { meterId: string, days: number } | null
  mainBelowUnits: { main: number, units: number } | null
  mainGap: { main: number, units: number } | null
  // Bewohnte Einheiten, deren Zähler nur einen Teil ihrer Zeit abdecken (Befund der Durchsicht).
  partial: { unit: SnapshotUnit, covered: number, needed: number }[]
}

// Das tatsächliche Ergebnis von computeSettlement: wie Settlement aus shared/types.ts, aber ohne
// `closed` — das ergänzt erst die Route GET /api/settlement/:year.
// Frisch gerechnet sind die Felder immer da, die am `Settlement` für alte eingefrorene
// Abrechnungen optional sind.
export type ComputedSettlement = Omit<Settlement, 'closed' | 'notSettled' | 'notices' | 'legalBasis'> & {
  notSettled: NotSettled[]
  notices: Notice[]
  legalBasis: LegalBasis
}

// Die Kostenart, an der Mietfuchs Heizung und Warmwasser erkennt (#93). Dieselbe Zeichenkette
// steht in CATEGORIES (client/src/types.ts) und im Kategorie-Schema der KI-Auswertung.
export const HEATING_CATEGORY = 'Heizung und Warmwasser'

// Welches Modell für eine Kostenposition gilt: das für Heizung bei der Heizkostenart, sonst das
// für die kalten Kosten. Ohne Angabe die Abrechnung.
const modelFor = (t: SnapshotTenancy, item: SnapshotCostItem): CostModel =>
  (item.category === HEATING_CATEGORY ? t.heatingModel : t.costModel) ?? 'settlement'

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
  // Bewohnt im Jahr: selbstgenutzt oder mit einem Mietverhältnis. Nur bei ihnen fehlt ein
  // Zähler wirklich; eine leere Wohnung oder eine unvermietete Garage verbraucht nichts (#116).
  const occupied = new Set([...snapshot.units.filter((u) => u.selfUsed).map((u) => u.id), ...tenancies.map((t) => t.unitId)])
  const readingsOf = (meterId: string) => allReadings.filter((r) => r.meterId === meterId)
  // Wie viele Tage des Jahres ein Zähler der Einheit abdecken muss: das ganze Jahr bei einer
  // selbstgenutzten, sonst die Tage ihrer Mietverhältnisse.
  const neededDays = (u: SnapshotUnit) =>
    u.selfUsed ? diy : Math.min(diy, tenancies.filter((t) => t.unitId === u.id).reduce((a, t) => a + t.days, 0))
  // `only`: die Teilnehmer einer Position (#94); ohne sie alle Wohnungszähler wie bisher.
  // `basisOnes`: die Wohnungen der Verteilbasis.
  const consumptionFor = (selfOnes: SnapshotUnit[], only: Set<string> | null, basisOnes: SnapshotUnit[]) => {
    const byType: Record<string, ConsumptionByTypeEntry | undefined> = {}
    const unitMeters = allMeters.filter((m) => m.unitId && (only === null || only.has(m.unitId)))
    // Hauptzähler: Zähler ohne Wohnung. Er misst das ganze Haus und taugt deshalb nicht als
    // Basis einer Position, die nur für einen Teil der Wohnungen gilt.
    const mainMeters = only === null ? allMeters.filter((m) => !m.unitId) : []
    const selfIds = new Set(selfOnes.map((u) => u.id))
    const meterTypes = [...new Set(unitMeters.map((m) => m.type))]
    for (const type of meterTypes) {
      const meters = unitMeters.filter((m) => m.type === type) as (SnapshotMeter & { unitId: string })[]
      const perUnit = new Map<string, number>()
      let basis = 0
      for (const m of meters) {
        const readings = readingsOf(m.id)
        const c = consumptionInPeriod(readings, yFrom, yTo)
        basis += c
        // Ein angelegter, aber im Jahr nie abgelesener Zähler ist kein Zähler: Sonst gälte die
        // Wohnung als gemessen, und der Fehler aus #116 käme ohne Warnung zurück.
        if (coveredDays(readings, yFrom, yTo) > 0) perUnit.set(m.unitId, (perUnit.get(m.unitId) || 0) + c)
      }
      // Ein Zählerstand belegt Verbrauch innerhalb der abgerechneten Menge und zählt deshalb
      // unabhängig vom Beteiligungs-Kennzeichen in die Basis; der Anteil nicht vermieteter
      // Wohnungen fällt damit ohnehin dem Vermieter zu.
      let selfConsumption = selfOnes.reduce((a, u) => a + (perUnit.get(u.id) || 0), 0)
      // **Vorwegabzug über den Hauptzähler (#116).** Hat jede bewohnte Einheit einen Zähler,
      // bleibt es bei ihrem Verhältnis, und die Messdifferenz zum Hauptzähler geht darin auf,
      // wie bisher. Fehlt einer der Zähler, ist ihr Verbrauch der Rest des Hauptzählers, und die
      // Basis ist der Hauptzähler; sonst zahlten die gemessenen Wohnungen ihren Verbrauch mit.
      // Gefragt wird ohne Teilnehmer jede Einheit des Objekts, auch außerhalb der
      // Abrechnungseinheit, denn der Hauptzähler misst sie alle.
      const candidates = only === null ? snapshot.units : basisOnes
      // Ohne Anschluss für diesen Typ (#117) fehlt auch kein Zähler, etwa bei einer Garage ohne Wasser.
      const unmetered = candidates.filter((u) => occupied.has(u.id) && !perUnit.has(u.id) && !(u.noConnection ?? []).includes(type as MeterType))
      // Gemessen, aber lückenhaft: Der Verbrauch der Lücke steckt dann im Rest des Hauptzählers.
      const partial = candidates.flatMap((u) => {
        if (!occupied.has(u.id) || !perUnit.has(u.id)) return []
        const covered = unitCoveredDays(meters.filter((m) => m.unitId === u.id).map((m) => readingsOf(m.id)), yFrom, yTo)
        const needed = neededDays(u)
        return covered < needed ? [{ unit: u, covered, needed }] : []
      })
      const mainOfType = mainMeters.filter((m) => m.type === type)
      const main = mainOfType.reduce((a, m) => a + consumptionInPeriod(readingsOf(m.id), yFrom, yTo), 0)
      // Nur ein Hauptzähler über das ganze Jahr taugt als Basis. Der Versorger liest selten zum
      // 31.12. ab, und ein Teiljahr gegen ganzjährige Wohnungszähler verschöbe die Anteile.
      const mainShort = mainOfType
        .map((m) => ({ meterId: m.id, days: coveredDays(readingsOf(m.id), yFrom, yTo) }))
        .find((c) => c.days < diy) ?? null
      let mainBasis: number | null = null
      let mainPartial: ConsumptionByTypeEntry['mainPartial'] = null
      let mainBelowUnits: ConsumptionByTypeEntry['mainBelowUnits'] = null
      let mainGap: ConsumptionByTypeEntry['mainGap'] = null
      if (mainOfType.length > 0 && unmetered.length > 0) {
        if (mainShort) {
          mainPartial = mainShort
        } else if (main < basis) {
          mainBelowUnits = { main, units: basis }
        } else if (main > 0) {
          mainBasis = main
          // Der Rest gehört zu den Einheiten ohne Zähler. Sind das nur selbstgenutzte, ist er ihr
          // Eigenanteil. Ist eine andere dabei, lässt er sich nicht aufteilen und bleibt beim
          // Vermieter, ohne Eigenanteil zu sein; das sagt eine Warnung.
          if (unmetered.every((u) => selfIds.has(u.id)) && partial.length === 0) selfConsumption += main - basis
          basis = main
        }
      } else if (mainOfType.length > 0 && !mainShort && basis < main * 0.8) {
        // Alle bewohnten Einheiten haben Zähler und erfassen doch weit weniger als der
        // Hauptzähler. Typisch, wenn eine Wohnung gar nicht angelegt ist; von einer gewöhnlichen
        // Messdifferenz lässt sich das nicht unterscheiden, also bleibt die Zahl, und es gibt
        // einen Hinweis. Die Grenze von 20 Prozent ist eine Schwelle zum Hinsehen, keine Regel.
        mainGap = { main, units: basis }
      }
      byType[type] = {
        meters, basis, perUnit, selfConsumption, unmetered, limited: only !== null,
        hasMain: mainOfType.length > 0, main: mainBasis, mainPartial, mainBelowUnits, mainGap, partial,
      }
    }
    return byType
  }
  const consumptionByType = consumptionFor(selfUnits, null, basisUnits)

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
  const notices: Notice[] = []
  const warn = (code: NoticeCode, text: string, subject?: NoticeSubject) => notices.push(makeNotice(code, text, subject))
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
  // Nimmt die Wohnung an einer Position dieses Schlüssels teil (#105)? Die Warnungen unten nennen
  // nur solche Wohnungen; eine Garage ohne Fläche, die an keiner Flächenposition teilnimmt, fehlt
  // in keiner Verteilung.
  const inKeyBasis = (unitId: string, key: CostKey) =>
    items.some((c) => c.key === key && c.category !== 'Nicht umlagefähig' && (!c.participantUnitIds || c.participantUnitIds.includes(unitId)))
  // Fehlt die Basis ganz, geht jede Position des Schlüssels an den Vermieter — das meldet die
  // Position selbst. Die Meldungen je Wohnung wären dann widersprüchlich („verteilt nur auf
  // die Mieter", obwohl nichts verteilt wird) und entfallen. Ohne Mietverhältnis im Jahr
  // fehlen Personentage regulär (Leerstand) — das ist kein Datenmangel.
  const areaBasisMissing = !(basisArea > 0)
  const personsBasisMissing = !(basisPersonDays > 0) && partTenancies.length > 0
  const selfNoPersons = selfUnits.filter((u) => selfPersonsOf(u) === 0 && inKeyBasis(u.id, 'persons'))
  if (selfNoPersons.length > 0 && usesKey('persons') && !personsBasisMissing) {
    warn('basis.self-no-persons',
      `Für die selbstgenutzte(n) Wohnung(en) ${selfNoPersons.map((u) => u.name).join(', ')} ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt nur auf die Mieter.`,
      unitSubject(selfNoPersons),
    )
  }
  const selfNoArea = selfUnits.filter((u) => !(u.areaM2 > 0) && inKeyBasis(u.id, 'area'))
  if (selfNoArea.length > 0 && usesKey('area') && !areaBasisMissing) {
    warn('basis.self-no-area',
      `Für die selbstgenutzte(n) Wohnung(en) ${selfNoArea.map((u) => u.name).join(', ')} ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt nur auf die Mieter.`,
      unitSubject(selfNoArea),
    )
  }
  // Dasselbe bei den übrigen Wohnungen der Abrechnungseinheit, vermietet oder leer: Fehlt ihr
  // Basiswert, verteilt der Schlüssel ihren Anteil still auf die anderen — bei einer
  // vermieteten Wohnung zahlen dann die übrigen Mieter mit. Für Mieter der teuerste Fall.
  const partNoArea = snapshot.units.filter((u) => u.participates && !(u.areaM2 > 0) && inKeyBasis(u.id, 'area'))
  if (partNoArea.length > 0 && usesKey('area') && !areaBasisMissing) {
    warn('basis.unit-no-area',
      `Für die Wohnung(en) ${partNoArea.map((u) => u.name).join(', ')} ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.`,
      unitSubject(partNoArea),
    )
  }
  const partNoPersons = partTenancies.filter((t) => !(personDaysInPeriod(t, yFrom, yTo) > 0) && inKeyBasis(t.unitId, 'persons'))
  if (partNoPersons.length > 0 && usesKey('persons') && !personsBasisMissing) {
    warn('basis.tenancy-no-persons',
      `Für ${partNoPersons.map((t) => `${t.tenantName} (${t.unit.name})`).join(', ')} ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt deren Anteil auf die übrigen Wohnungen.`,
      tenancySubject(partNoPersons),
    )
  }

  // Die Verteilbasis einer Position (#94). **Ohne Teilnehmer ist sie genau die bisherige**, und
  // zwar dasselbe Objekt, einmal berechnet: So kann die Umstellung keine Zahl verschieben, und
  // die Golden-Tests bleiben der Beweis dafür. Mit Teilnehmern besteht sie nur aus ihnen, bei
  // vermieteten wie bei selbstgenutzten Wohnungen, und beim Verbrauch zählen nur ihre Zähler.
  const fullBasis = { basisUnits, selfUnits, basisArea, selfArea, partTenancies, basisPersonDays, selfPersonDays, consumptionByType }
  const basisOf = (item: SnapshotCostItem): typeof fullBasis => {
    if (!item.participantUnitIds) return fullBasis
    const only = new Set(item.participantUnitIds)
    const bUnits = basisUnits.filter((u) => only.has(u.id))
    const sUnits = selfUnits.filter((u) => only.has(u.id))
    const pTenancies = partTenancies.filter((t) => only.has(t.unitId))
    const sPersonDays = sUnits.reduce((a, u) => a + selfPersonsOf(u) * diy, 0)
    return {
      basisUnits: bUnits,
      selfUnits: sUnits,
      basisArea: bUnits.reduce((a, u) => a + (u.areaM2 || 0), 0),
      selfArea: sUnits.reduce((a, u) => a + (u.areaM2 || 0), 0),
      partTenancies: pTenancies,
      basisPersonDays: pTenancies.reduce((a, t) => a + personDaysInPeriod(t, yFrom, yTo), 0) + sPersonDays,
      selfPersonDays: sPersonDays,
      consumptionByType: consumptionFor(sUnits, only, bUnits),
    }
  }

  // Kabelfernsehen (#107): Seit dem 01.07.2024 sind die Gebühren für das TV-Signal nicht mehr als
  // Betriebskosten umlagefähig (Wegfall des Nebenkostenprivilegs, § 2 Nr. 15 BetrKV a. F.,
  // Übergangsfrist bis 30.06.2024, nur für Anlagen vor dem 01.12.2021, § 2 Satz 2 BetrKV). Danach bleibt
  // bei solchen Anlagen nur der Betriebsstrom, bei einer Gemeinschaftsantenne auch Prüfung und Einstellung.
  // Welcher Teil einer Position was ist, weiß Mietfuchs nicht; es kürzt deshalb nicht selbst,
  // sondern sagt es. Ab wann das gilt, steht im Regelverzeichnis (`tv-signal`, #112): Gilt die
  // Regel nur im Teil des Jahres, ist es das Übergangsjahr; gilt sie gar nicht mehr, die Zeit
  // danach. Einen Beginn hat die Regel nicht, „gar nicht“ heißt deshalb immer „vorbei“.
  const tvSignal = ruleCoverage('tv-signal', yFrom, yTo)
  // Eine Anlage ab dem 01.12.2021 fiel nie unter die Regel (#121, § 2 Satz 2 BetrKV): dann in jedem
  // Jahr ab 2021 dieselbe Warnung, ohne Übergangszeit.
  const newSystem = snapshot.property?.cableBuiltBeforeDec2021 === false && year >= 2021
  for (const item of items.filter((c) => c.category === 'Kabel/Antenne')) {
    if (newSystem) {
      warn('tv-signal.new-system', `„${item.description}": Die Kabel- oder Antennenanlage wurde ab dem 01.12.2021 errichtet; für sie waren die Gebühren für das TV-Signal nie umlagefähig, auch Betriebsstrom und Wartung nicht (§ 2 Satz 2 BetrKV). Umlagefähig sind allenfalls Betriebsstrom und Bereitstellungsentgelt einer reinen Glasfaser-Verteilanlage, bei der der Mieter seinen Anbieter frei wählen kann (§ 2 Nr. 15 Buchst. c BetrKV); buchen Sie den Rest bitte als „Nicht umlagefähig“.${year === 2021 ? ' Für 2021 gilt das für die Kosten ab der Errichtung; was davor auf eine ältere Anlage entfiel, war umlagefähig.' : ''}`, itemSubject(item))
    } else if (tvSignal === 'partial') {
      warn('tv-signal.partial-year', `„${item.description}": Die Gebühren für das Kabelfernsehen (TV-Signal) sind nur bis zum 30.06.2024 umlagefähig, danach nicht mehr (Wegfall des Nebenkostenprivilegs). Umlegen dürfen Sie für 2024 höchstens das erste Halbjahr, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde; danach nur noch den Betriebsstrom (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft). Bitte teilen Sie die Position entsprechend auf und buchen Sie den Rest als „Nicht umlagefähig“.`, itemSubject(item))
    } else if (tvSignal === 'none') {
      warn('tv-signal.ended', `„${item.description}": Die Gebühren für das Kabelfernsehen (TV-Signal) sind seit dem 01.07.2024 nicht mehr umlagefähig (Wegfall des Nebenkostenprivilegs). Umlegen dürfen Sie nur noch den Betriebsstrom, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft); buchen Sie das TV-Signal bitte als „Nicht umlagefähig“.`, itemSubject(item))
    }
  }

  for (const item of items) {
    const b = basisOf(item)
    const bookable = (t: SnapshotTenancy) => statements.has(t.id) && modelFor(t, item) === 'settlement'
    totalCostsCents += item.amountCents
    // Rohanteile (float, in Cent) pro Mietverhältnis bestimmen.
    // Nicht umlagefähige Kosten gehen immer vollständig an den Vermieter.
    const targets: Target[] = []
    // Anteil, der auf selbstgenutzte Wohnungen entfällt (Teil des Vermieteranteils) — für
    // die Steuerübersicht separat ausgewiesen, weil er privat und damit nicht abziehbar ist.
    let selfRaw = 0
    const noBasis = (reason: string) => warn('item.no-basis', `„${item.description}": ${reason} — Betrag geht an den Vermieter.`, itemSubject(item))
    // Tage im Rechenweg, nur bei einem Teiljahr.
    const partOfYear = (t: TenancyWithUnit) => (t.days < diy ? ` · ${t.days}/${diy} Tage` : '')
    // Teilnehmer wirken bei den Schlüsseln, deren Basis aus Wohnungen entsteht (#94).
    const withParticipants = ['area', 'units', 'persons', 'meter', 'external', 'amounts'].includes(item.key)
    if (item.category === 'Nicht umlagefähig') {
      // keine Verteilung
    } else if (withParticipants && item.participantUnitIds && item.participantUnitIds.length === 0) {
      noBasis('keine Wohnung nimmt teil')
    } else if (item.key === 'area' && !(b.basisArea > 0)) {
      noBasis(b === fullBasis ? 'für keine Wohnung ist eine Wohnfläche hinterlegt' : 'für keine teilnehmende Wohnung ist eine Wohnfläche hinterlegt')
    } else if (item.key === 'units' && b.basisUnits.length === 0) {
      noBasis(b === fullBasis ? 'keine Wohnung gehört zur Abrechnungseinheit' : 'keine teilnehmende Wohnung gehört zur Abrechnungseinheit')
    } else if (item.key === 'persons' && !(b.basisPersonDays > 0) && b.partTenancies.length > 0) {
      noBasis('für die vermieteten Wohnungen sind keine Personen hinterlegt')
    } else if (item.key === 'area' && b.basisArea > 0) {
      for (const t of b.partTenancies) {
        const raw = item.amountCents * ((t.unit.areaM2 || 0) / b.basisArea) * (t.days / diy)
        targets.push({ t, raw, basisText: `${fmtNum(t.unit.areaM2 || 0)} von ${fmtNum(b.basisArea)} m²${partOfYear(t)}` })
      }
      selfRaw = item.amountCents * (b.selfArea / b.basisArea)
    } else if (item.key === 'units' && b.basisUnits.length > 0) {
      for (const t of b.partTenancies) {
        const raw = (item.amountCents / b.basisUnits.length) * (t.days / diy)
        targets.push({ t, raw, basisText: `1 von ${b.basisUnits.length} Einheiten${partOfYear(t)}` })
      }
      selfRaw = (item.amountCents / b.basisUnits.length) * b.selfUnits.length
    } else if (item.key === 'persons' && b.basisPersonDays > 0) {
      for (const t of b.partTenancies) {
        const pd = personDaysInPeriod(t, yFrom, yTo)
        const raw = item.amountCents * (pd / b.basisPersonDays)
        targets.push({ t, raw, basisText: `${fmtNum(pd)} von ${fmtNum(b.basisPersonDays)} Personentagen` })
      }
      selfRaw = item.amountCents * (b.selfPersonDays / b.basisPersonDays)
    } else if (item.key === 'external') {
      // Laut Gemeinschaftsabrechnung (#94). Der Betrag ist der eigene Anteil, also das, was der
      // Vermieter laut Hausgeldabrechnung für seine Wohnungen zahlt; die Angaben der Gemeinschaft
      // stehen daneben für den Rechenweg und die Plausibilität. Verteilt wird innerhalb des
      // Objekts nach dem Wert jeder Wohnung im Maßstab der Gemeinschaft.
      const eb = item.externalBasis
      if (!eb || !(eb.total > 0)) {
        noBasis('die Angaben aus der Abrechnung der Gemeinschaft fehlen (Maßstab, Summe in der Anlage, Gesamtkosten)')
      } else {
        const valueOf = (u: SnapshotUnit): number =>
          eb.measure === 'mea' ? Math.max(0, Number(u.mea) || 0) : eb.measure === 'area' ? Math.max(0, u.areaM2 || 0) : 1
        const own = b.basisUnits.reduce((a, u) => a + valueOf(u), 0)
        if (!(own > 0)) {
          noBasis(eb.measure === 'mea' ? 'für die Wohnungen sind keine Miteigentumsanteile hinterlegt' : 'für die Wohnungen ist keine Wohnfläche hinterlegt')
        } else {
          const missing = b.basisUnits.filter((u) => valueOf(u) === 0)
          if (missing.length > 0) {
            warn('external.value-missing', `„${item.description}": für ${missing.map((u) => u.name).join(', ')} ${eb.measure === 'mea' ? 'sind keine Miteigentumsanteile' : 'ist keine Wohnfläche'} hinterlegt — ihr Anteil verteilt sich auf die übrigen Wohnungen.`, unitSubject(missing))
          }
          // Ein Tippfehler in der Gesamtsumme soll auffallen, aber keine Zahl verschieben:
          // Gezahlt ist der eingetragene Betrag, und der wird verteilt.
          const expected = Math.round((eb.totalCents * own) / eb.total)
          if (Math.abs(expected - item.amountCents) > 100) {
            warn('external.amount-mismatch', `„${item.description}": der Betrag ${fmtCents(item.amountCents)} passt nicht zum rechnerischen Anteil ${fmtCents(expected)} (${fmtNum(own)} von ${fmtNum(eb.total)} ${MEASURE_LABELS[eb.measure]} aus ${fmtCents(eb.totalCents)}) — bitte die Angaben aus der Gemeinschaftsabrechnung prüfen. Verteilt wird der eingetragene Betrag.`, itemSubject(item))
          }
          const suffix = ` · Gesamtkosten der Anlage ${fmtCents(eb.totalCents)}`
          for (const t of b.partTenancies) {
            const raw = item.amountCents * (valueOf(t.unit) / own) * (t.days / diy)
            targets.push({
              t, raw,
              basisText: `${fmtNum(valueOf(t.unit))} von ${fmtNum(eb.total)} ${MEASURE_LABELS[eb.measure]}${suffix}${partOfYear(t)}`,
              ownShare: `${fmtNum(valueOf(t.unit))} von ${fmtNum(own)} ${MEASURE_LABELS[eb.measure]}`,
            })
          }
          selfRaw = item.amountCents * (b.selfUnits.reduce((a, u) => a + valueOf(u), 0) / own)
        }
      }
    } else if (item.key === 'amounts') {
      // Einzelbeträge je Mietverhältnis (#94), etwa vom Messdienst. Der teilt beim Nutzerwechsel
      // selbst auf, deshalb hier kein Tagesanteil: Der Anteil ist genau der Betrag. Den Rest
      // (Leerstand, Eigennutzung, Rundung des Messdienstes) trägt der Vermieter.
      const given = item.tenancyAmounts ?? {}
      // Beträge selbstgenutzter Wohnungen (#104): nur für Wohnungen, die im Jahr selbstgenutzt zur
      // Verteilbasis gehören; einer anderen Wohnung ein Eigenanteil wäre privat gebuchtes Geld,
      // das in Wahrheit abziehbar ist.
      const selfGiven = item.selfAmounts ?? {}
      const selfIds = new Set(b.selfUnits.map((u) => u.id))
      const selfSum = Object.entries(selfGiven).filter(([id]) => selfIds.has(id)).reduce((a, [, c]) => a + Math.max(0, c), 0)
      const sum = Object.values(given).reduce((a, c) => a + Math.max(0, c), 0) + selfSum
      if (sum > item.amountCents) {
        warn('amounts.exceed', `„${item.description}": die Einzelbeträge ergeben zusammen ${fmtCents(sum)} und übersteigen den Rechnungsbetrag ${fmtCents(item.amountCents)} — es wird nichts verteilt, der Betrag geht an den Vermieter.`, itemSubject(item))
      } else {
        const inYear = new Map(b.partTenancies.map((t) => [t.id, t]))
        const forfeited = Object.entries(given).filter(([id, c]) => c > 0 && !inYear.has(id))
        if (forfeited.length > 0) {
          const betrag = forfeited.reduce((a, [, c]) => a + c, 0)
          warn('amounts.forfeited', `„${item.description}": ${forfeited.length === 1 ? 'ein Einzelbetrag' : `${forfeited.length} Einzelbeträge`} über ${fmtCents(betrag)} gehör${forfeited.length === 1 ? 't' : 'en'} zu keinem Mietverhältnis dieses Jahres in der Abrechnungseinheit und entfall${forfeited.length === 1 ? 't' : 'en'} — dieser Teil geht an den Vermieter.`, itemSubject(item))
        }
        // Nur wer die Position wirklich trägt; bei Pauschale fehlt nichts (Befund der Durchsicht).
        const without = b.partTenancies.filter((t) => !Object.hasOwn(given, t.id) && bookable(t))
        if (without.length > 0) {
          warn('amounts.missing', `„${item.description}": für ${without.map((t) => `${t.tenantName} (${t.unit.name})`).join(', ')} ist kein Einzelbetrag eingetragen — bitte prüfen, sonst tragen sie diese Position nicht.`, itemSubject(item))
        }
        // Beträge selbstgenutzter Wohnungen (#104) sind ihr Eigenanteil. Fehlt einer, steckt er im
        // Rest beim Vermieter und fehlt im privaten, nicht abziehbaren Teil der Steuerübersicht;
        // das sagt die Meldung unten.
        const selfForfeited = Object.entries(selfGiven).filter(([id, c]) => c > 0 && !selfIds.has(id))
        // Zwei Gründe, und die Meldung nennt den richtigen: Die Wohnung ist nicht selbstgenutzt, oder
        // sie ist es, nimmt aber an dieser Position nicht teil (Befund der Durchsicht).
        const selfOutsideParticipants = selfForfeited.filter(([id]) => selfUnits.some((u) => u.id === id))
        const selfNotSelfUsed = selfForfeited.filter(([id]) => !selfUnits.some((u) => u.id === id))
        const nameOf = (id: string) => unitById.get(id)?.name ?? 'eine gelöschte Wohnung'
        if (selfNotSelfUsed.length > 0) {
          warn('amounts.self-forfeited', `„${item.description}": ein Eigenbetrag ist für ${selfNotSelfUsed.map(([id]) => nameOf(id)).join(', ')} eingetragen, die in diesem Jahr nicht selbstgenutzt ist — er zählt nicht als Eigenanteil und bleibt beim Vermieter.`, itemSubject(item))
        }
        if (selfOutsideParticipants.length > 0) {
          warn('amounts.self-forfeited', `„${item.description}": ein Eigenbetrag ist für ${selfOutsideParticipants.map(([id]) => nameOf(id)).join(', ')} eingetragen, die an dieser Position nicht teilnimmt — er zählt nicht als Eigenanteil und bleibt beim Vermieter. Nehmen Sie die Wohnung als Teilnehmerin auf, wenn die Position sie betrifft.`, itemSubject(item))
        }
        selfRaw = selfSum
        const selfWithout = b.selfUnits.filter((u) => !Object.hasOwn(selfGiven, u.id))
        if (selfWithout.length > 0) {
          warn('amounts.self-hidden', `„${item.description}": der Anteil der selbstgenutzten Wohnung(en) ${selfWithout.map((u) => u.name).join(', ')} ist bei Einzelbeträgen nicht eingetragen — er steckt im Vermieteranteil, und die Steuerübersicht nennt den privaten Anteil entsprechend zu niedrig.`, itemSubject(item))
        }
        for (const t of b.partTenancies) {
          const c = given[t.id]
          if (c === undefined || c <= 0) continue
          targets.push({ t, raw: c, basisText: 'laut Einzelabrechnung' })
        }
      }
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
        warn('custom.forfeited', `„${item.description}": der vereinbarte Anteil für ${forfeited.join(', ')} entfällt — die Wohnung gehört nicht zur Abrechnungseinheit. Dieser Teil geht an den Vermieter.`, itemSubject(item))
      }
      if (pctSum <= 0) {
        warn('custom.none', `„${item.description}": keine vereinbarten Anteile hinterlegt — Betrag geht an den Vermieter.`, itemSubject(item))
      } else if (pctSum > 100.0001) {
        // Nicht verteilen: mehr als die Rechnung hergibt wäre auch beim §35a-Anteil zu hoch.
        warn('custom.over-100', `„${item.description}": die vereinbarten Anteile ergeben ${fmtNum(Math.round(pctSum * 100) / 100)} % — über 100 % wird nicht verteilt, der Betrag geht an den Vermieter.`, itemSubject(item))
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
      const data = b.consumptionByType[item.meterType as MeterType]
      if (!data || data.basis <= 0) {
        warn('meter.no-consumption', `„${item.description}": kein Verbrauch für Zählertyp „${item.meterType ?? '—'}" erfasst — Betrag geht an den Vermieter.`, itemSubject(item))
      } else {
        const type = item.meterType ?? '—'
        if (data.mainPartial) {
          warn('meter.main-partial', `„${item.description}": der Hauptzähler deckt ${year} nur ${data.mainPartial.days} von ${diy} Tagen ab — bitte Ablesungen zum 31.12.${year - 1} und zum Jahresende (31.12.${year}) nachtragen. Bis dahin wird nach den Wohnungszählern verteilt.`, { kind: 'meter', id: data.mainPartial.meterId })
        }
        if (data.mainBelowUnits) {
          warn('meter.sub-exceeds-main', `„${item.description}": die Wohnungszähler zeigen zusammen ${fmtMeter(data.mainBelowUnits.units)}, mehr als der Hauptzähler (${fmtMeter(data.mainBelowUnits.main)}) — bitte die Ablesungen prüfen. Verteilt wird nach den Wohnungszählern.`, itemSubject(item))
        }
        if (data.mainGap) {
          warn('meter.main-gap', `„${item.description}": die Wohnungszähler erfassen zusammen nur ${fmtMeter(data.mainGap.units)} von ${fmtMeter(data.mainGap.main)} des Hauptzählers. Gehört der Rest zu einer Wohnung, die nicht angelegt ist (etwa Ihrer eigenen), legen Sie sie unter Stammdaten an; dann gilt für sie der Rest des Hauptzählers. Verteilt wird nach den Wohnungszählern.`, itemSubject(item))
        }
        if (data.main !== null && data.partial.length > 0) {
          warn('meter.unit-partial', `„${item.description}": der Zähler von ${data.partial.map((p) => `${p.unit.name} (${p.covered} von ${p.needed} Tagen)`).join(', ')} deckt nicht die ganze Zeit ab, in der dort gewohnt wurde — der Verbrauch der Lücke steckt im Rest des Hauptzählers, der deshalb beim Vermieter bleibt und nicht als Eigenanteil gilt. Bitte die fehlenden Ablesungen nachtragen.`, unitSubject(data.partial.map((p) => p.unit)))
        }
        // Fehlt der Zähler nur bei selbstgenutzten Wohnungen, gibt es nichts zu melden; bleibt der
        // Rest wegen einer Lücke trotzdem beim Vermieter, sagt das die Meldung davor.
        const onlySelfUnmetered = data.main !== null && data.unmetered.every((u) => b.selfUnits.includes(u))
        if (data.unmetered.length > 0 && !onlySelfUnmetered) {
          const names = data.unmetered.map((u) => u.name).join(', ')
          // Eine Garage oder ein Stellplatz hat oft keinen Anschluss; dann nennt die Meldung den
          // Ausweg, die Kennzeichnung an der Einheit (#117).
          const noConnection = ' Hat eine dieser Einheiten keinen eigenen Anschluss (etwa eine Garage), kreuzen Sie in den Stammdaten der Einheit „Kein Anschluss für“ an.'
          const text = data.main !== null
            ? `der Rest des Hauptzählers geht an den Vermieter, weil sich nicht bestimmen lässt, wie viel davon auf sie entfällt.${b.selfUnits.length > 0 ? ' Einen Eigenanteil weist Mietfuchs für diesen Rest deshalb nicht aus.' : ''}${noConnection}`
            : data.hasMain
              ? 'ihr Verbrauch lässt sich nicht bestimmen und steckt in den Anteilen der übrigen Wohnungen, bis der Hauptzähler verwendbar ist (siehe den Hinweis zum Hauptzähler).'
              : data.limited
                ? `ihr Verbrauch lässt sich nicht bestimmen und wird von den übrigen teilnehmenden Wohnungen mitgetragen. Bitte die Teilnehmer der Position prüfen.${noConnection}`
                : `ihr Verbrauch lässt sich nicht bestimmen und wird von den übrigen Wohnungen mitgetragen. Mit einem Hauptzähler (Zähler ohne Wohnung) gilt für sie der Rest des Hauptzählers.${noConnection}`
          warn('meter.unit-without-meter', `„${item.description}": für ${names} gibt es keinen abgelesenen Zähler „${type}" — ${text}`, unitSubject(data.unmetered))
        }
        selfRaw = item.amountCents * (data.selfConsumption / data.basis)
        for (const t of b.partTenancies) {
          const meters = data.meters.filter((m) => m.unitId === t.unitId)
          let c = 0
          for (const m of meters) {
            const readings = allReadings.filter((r) => r.meterId === m.id)
            const pFrom = t.start > yFrom ? t.start : yFrom
            const pTo = t.end && t.end < yTo ? t.end : yTo
            c += consumptionInPeriod(readings, pFrom, pTo)
          }
          const raw = item.amountCents * (c / data.basis)
          targets.push({ t, raw, basisText: `${fmtNum(Math.round(c * 100) / 100)} von ${fmtNum(Math.round(data.basis * 100) / 100)} (${data.main !== null ? 'Hauptzähler' : 'gemessen'})` })
        }
      }
    } else if (item.key === 'direct') {
      // `item.directUnitId` ist optional (string | null | undefined); Map.get() verhält sich
      // für null/undefined wie für eine unbekannte ID (kein Treffer), deshalb hier nur eine
      // Typ-Zusicherung, keine neue Prüfung.
      const target = unitById.get(item.directUnitId as string)
      if (!target) {
        warn('direct.unit-gone', `„${item.description}": die direkt zugeordnete Wohnung gibt es nicht mehr — Betrag geht an den Vermieter.`, itemSubject(item))
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
      warn('labor35a.invalid', `„${item.description}": der §35a-Lohnanteil muss zwischen 0 und dem Rechnungsbetrag liegen — es wird kein Lohnanteil bescheinigt.`, itemSubject(item))
    } else if (labor > 0) {
      const booked = targets.map((_, i) => i).filter((i) => bookable(targets[i].t))
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
      // Ein Mietverhältnis mit Pauschale oder Inklusivmiete für diese Kostenart (#93) bleibt in der
      // Verteilbasis, bekommt seinen Anteil aber nicht zugebucht: Er fällt dem Vermieter zu, als
      // abziehbare Kosten und nicht als Eigenanteil.
      if (!bookable(x.t)) return
      const st = statements.get(x.t.id)
      // Mietverhältnis in einer nicht beteiligten Wohnung (nur bei Direktzuordnung möglich):
      // Der Anteil gilt als nicht verteilt, sonst fehlte er in der Abrechnung ganz — er muss
      // in den Vermieteranteil laufen.
      if (!st) return
      distributed += shares[i]
      const labor35a = laborOf.get(i) ?? 0
      // Der Rechenweg (#114): dieselben Zahlen, aus denen die Zeile entstand, als Text. Der
      // Restcent wird bei der Zeile benannt, die von der gewöhnlichen Rundung abweicht; sonst sähe
      // der Mieter einen Cent, den ihm niemand erklärt. Das ist nicht immer die Zeile, die einen
      // Cent dazubekommt: Liegen die Reste über einem halben Cent, ist es die, die einen verliert.
      const steps: CalcStep[] = [
        { label: 'Rechnungsbetrag', value: fmtCents(item.amountCents) },
        { label: 'Umlageschlüssel', value: KEY_LABELS[item.key] || item.key, term: 'allocationKey' },
      ]
      if (item.key === 'amounts') {
        steps.push({ label: 'Einzelbetrag', value: `${fmtCents(Math.round(x.raw))} laut Einzelabrechnung`, term: 'individualAmounts' })
      } else {
        steps.push({ label: 'Anteil an der Verteilbasis', value: x.basisText, term: 'distributionBasis' })
        if (x.ownShare) steps.push({ label: 'Anteil an Ihren Wohnungen', value: x.ownShare, term: 'mea' })
        if (item.amountCents !== 0) {
          steps.push({ label: 'Rechnung', value: `${fmtCents(item.amountCents)} × ${fmtPercent((x.raw / item.amountCents) * 100)} % = ${fmtExactEuro(x.raw)}` })
        }
      }
      steps.push(shares[i] !== Math.round(x.raw)
        ? { label: 'Ergebnis, auf Cent gerundet', value: `${fmtCents(shares[i])} (Restcent-Verfahren: rechnerisch ${fmtExactEuro(x.raw)}; damit die Anteile zusammen genau den Rechnungsbetrag ergeben, weicht dieser Anteil um einen Cent von der gewöhnlichen Rundung ab)`, term: 'largestRemainder' }
        : { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(shares[i]) })
      if (labor35a > 0) steps.push({ label: 'davon Lohnanteil nach § 35a EStG', value: fmtCents(labor35a), term: 'labor35a' })
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
        steps,
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
    } else if (selfRaw < 0 && landlordCents < 0) {
      // Eine Gutschrift senkt den Eigenanteil ebenso (#129), höchstens um den Teil, den der
      // Vermieter von ihr trägt; sonst stünde der private Anteil der Steuer zu hoch da.
      selfUsedShareCents += Math.max(Math.round(selfRaw), landlordCents)
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

  // Ohne Abrechnung (#93): wer für keine der beiden Arten abgerechnet wird, oder wessen Abrechnung
  // leer bliebe, weil die abzurechnende Art im Jahr keine Kosten hatte. Ein Mietverhältnis mit
  // Abrechnung und ohne Kosten behält seine leere Abrechnung wie bisher.
  const notSettled: NotSettled[] = []
  for (const t of partTenancies) {
    const costModel = t.costModel ?? 'settlement'
    const heatingModel = t.heatingModel ?? 'settlement'
    if (costModel === 'settlement' && heatingModel === 'settlement') continue
    const st = statements.get(t.id)
    const neither = costModel !== 'settlement' && heatingModel !== 'settlement'
    // Eine leere Abrechnung entfällt nur ohne Vorauszahlung: Eine echte Vorauszahlung für die
    // abgerechnete Art muss abgerechnet werden, auch wenn im Jahr keine Kosten dieser Art anfielen.
    // Eine Vorauszahlung, gegen die nichts abgerechnet wird, ist meist die frühere Eingabe einer
    // Pauschale (vor #93 gab es kein Feld dafür). Ohne Hinweis würde sie hier still ganz erstattet
    // oder, ohne Abrechnung, im Mietkonto weiter als Soll geführt (Befund der Durchsicht).
    const prepaid = st ? st.prepaymentCents : computePrepaymentCents(t, year).cents
    if (prepaid > 0 && (neither || (st && st.rows.length === 0))) {
      warn('model.prepayment-unsettled', neither
        ? `Für ${t.tenantName} (${t.unit.name}) wird nichts abgerechnet, im Mietkonto stehen für ${year} aber Vorauszahlungen von ${fmtCents(prepaid)}. Ist das in Wahrheit die Pauschale, tragen Sie sie unter „Pauschale“ ein und leeren die Vorauszahlung; sonst stimmt das Mietkonto nicht.`
        : `Für ${t.tenantName} (${t.unit.name}) gibt es ${year} keine Kosten der abgerechneten Art, die Vorauszahlung von ${fmtCents(prepaid)} wird deshalb vollständig erstattet. Ist die eingetragene Vorauszahlung in Wahrheit die Pauschale, tragen Sie sie unter „Pauschale“ ein und leeren die Vorauszahlung.`,
      { kind: 'tenancy', id: t.id })
    }
    if (neither || (st && st.rows.length === 0 && st.prepaymentCents === 0)) {
      statements.delete(t.id)
      notSettled.push({ tenancyId: t.id, tenantName: t.tenantName, unitName: t.unit.name, costModel, heatingModel })
    }
  }

  // § 2 HeizkostenV: Die Verordnung geht einer Vereinbarung vor, ausgenommen ist nur das Gebäude
  // mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt. Gemeldet wird nur,
  // wenn es im Jahr eine Heizposition gibt; einen Kürzungsbetrag nennt die Meldung nicht, solange
  // der Rechenweg nach BGH VIII ZR 212/05 nicht geprüft ist (#93).
  const heatingFlat = partTenancies.filter((t) => (t.heatingModel ?? 'settlement') !== 'settlement')
  // Das Gesetz zählt die Wohnungen im Gebäude, also alle des Objekts und nicht nur die
  // beteiligten. Eine vermietete Eigentumswohnung in einer großen Anlage erkennt Mietfuchs
  // daran nicht (nur die Zahl der Wohnungen, nicht die der Anlage); dort bleibt die Warnung aus.
  const exempt = snapshot.units.length <= 2 && selfUnits.length >= 1
  if (heatingFlat.length > 0 && !exempt && items.some((c) => c.category === HEATING_CATEGORY)) {
    warn('heating.flat-rate',
      `Für ${heatingFlat.map((t) => `${t.tenantName} (${t.unit.name})`).join(', ')} ist für Heizung und Warmwasser eine Pauschale oder Warmmiete vereinbart. ` +
        'Die Heizkostenverordnung geht der Vereinbarung vor (§ 2 HeizkostenV); zulässig ist das nur im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen. ' +
        'Sonst wird der Heizanteil als Vorauszahlung behandelt, über die Sie nach Verbrauch abrechnen müssen (BGH VIII ZR 212/05). ' +
        'Rechnen Sie trotzdem nicht nach Verbrauch ab, darf der Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV).' +
        // Die Einliegerwohnung (#116): Wer nur die vermietete Wohnung anlegt, hat womöglich
        // genau das Zweifamilienhaus der Ausnahme. Mietfuchs erkennt es an der eigenen Wohnung,
        // und die fehlt dann. Bei zwei oder mehr angelegten Wohnungen hülfe sie nicht mehr.
        // Nicht bei einer Eigentumswohnung: In einer Anlage hilft die eigene Wohnung nicht (#121).
        (snapshot.units.length === 1 && selfUnits.length === 0 && snapshot.property?.kind !== 'etw'
          ? ' Wohnen Sie selbst im Haus und hat es nur diese beiden Wohnungen, legen Sie Ihre eigene Wohnung unter Stammdaten als selbstgenutzt an; dann gilt die Ausnahme, und die Warnung entfällt.'
          : ''),
      tenancySubject(heatingFlat),
    )
  }

  const result: ComputedSettlement = {
    year,
    daysInYear: diy,
    statements: [...statements.values()],
    notSettled,
    landlord: {
      rows: landlordRows,
      totalCents: landlordRows.reduce((a, r) => a + r.shareCents, 0),
    },
    // Im Vermieteranteil enthaltener Teil, der auf selbstgenutzte Wohnungen entfällt
    // (der Rest sind Leerstand, nicht umlagefähige Positionen und Rundungsdifferenzen).
    selfUsedShareCents,
    totalCostsCents,
    notices,
    warnings: notices.map((n) => n.text),
    // Der Rechtsstand (#112): Datum des Regelverzeichnisses und die Regeln des Jahres. Die
    // abgeschlossene Abrechnung friert das Ergebnis wortgleich ein und damit auch ihn.
    legalBasis: {
      asOf: RULES_AS_OF,
      rules: rulesFor(yFrom, yTo).map(({ code, title, norm, validFrom, validTo }) => ({
        code, title, norm, ...(validFrom ? { validFrom } : {}), ...(validTo ? { validTo } : {}),
      })),
    },
  }
  for (const st of result.statements) {
    st.balanceCents = st.prepaymentCents - st.totalShareCents // >0 Guthaben, <0 Nachzahlung
    // Vorschlag nach §560 Abs. 4 BGB: ein Zwölftel der Jahreskosten, auf volle Euro gerundet
    st.suggestedMonthlyCents = Math.round(st.totalShareCents / 12 / 100) * 100
  }
  return result
}

// Berechnungs-Engine für die Nebenkostenabrechnung.
// Alle Beträge werden in Cent (Integer) gerechnet, um Gleitkomma-Fehler zu vermeiden.
import type {
  CalcStep,
  CostKey,
  CostModel,
  LegalBasis,
  NotSettled,
  ExternalMeasure,
  LandlordPart,
  LandlordReason,
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
  TaxAllocation,
  TaxExpenseCategory,
  TaxExpenseGroup,
  TaxExpenseItem,
  TaxReport,
} from '../../shared/types.ts'
// Die Berechnung kennt den Speicher nicht mehr, sondern nur noch den Schnappschuss eines
// Abrechnungsjahres (siehe snapshot.ts). Welche Sammlung darin nach Jahr eingegrenzt sein darf,
// entscheidet dort die Ablage und nicht hier.
import { RULES_AS_OF, ruleCoverage, rulesFor } from './rules.ts'
import { HEATING_CATEGORY, heatingByConsumption, heatingFindings, mayAgreeOtherwise } from '../../shared/heating.ts'
import { andList, meterTypeLabel, plural } from '../../shared/wording.ts'
import type { TermId } from '../../shared/glossary.ts'
import { allocationOf, comparablePrevious, sameAllocation, sameUnits } from '../../shared/allocation.ts'
import { possibleDuplicates } from '../../shared/duplicates.ts'
import { commonPeriod, tenancyOverlaps } from '../../shared/tenancyOverlap.ts'
import type { FrozenItemSelfUse, Snapshot, SnapshotCostItem, SnapshotMeter, SnapshotReading, SnapshotTenancy, SnapshotUnit } from './snapshot.ts'

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

// Tage im Zeitraum [from, to], an denen mindestens eines der Mietverhältnisse besteht. Überlappen
// sie sich (ein Auszug nach dem nächsten Einzug), zählt jeder Tag nur einmal; die Lücke dazwischen
// ist der Leerstand (#177).
export function occupiedDays(tenancies: { start: string, end: string | null }[], from: string, to: string): number {
  const lo = toUTC(from)
  const hi = toUTC(to)
  const ranges = tenancies
    .map((t) => [Math.max(toUTC(t.start), lo), Math.min(t.end ? toUTC(t.end) : Infinity, hi)] as const)
    .filter(([s, e]) => e >= s)
    .sort((a, b) => a[0] - b[0])
  let days = 0
  let until = -Infinity // letzter schon gezählter Tag
  for (const [s, e] of ranges) {
    const start = Math.max(s, until + MS_DAY)
    if (e >= start) days += Math.round((e - start) / MS_DAY) + 1
    until = Math.max(until, e)
  }
  return days
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
// zwar fest eingestellt. Zeichenweise verglichen landete „Älter“ hinter „Zaun“, weil das Ä einen
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

// **Personen je Leerstandstag beim Personenschlüssel (#177).** Den Anteil einer leerstehenden
// Wohnung trägt der Vermieter (BGH, Urteil vom 31.05.2006, VIII ZR 159/05, entschieden am
// Flächenschlüssel). Wie die leere Wohnung beim Personenschlüssel anzusetzen ist, regelt kein
// Gesetz, und höchstrichterlich ist es nicht abschließend geklärt: Nach BGH, Beschluss vom
// 08.01.2013, VIII ZR 180/12, entscheidet der Tatrichter im Einzelfall nach Billigkeit, und es
// „kann in Betracht kommen“, für den Leerstand eine fiktive Person anzusetzen, vor allem bei
// Kosten, die nicht von der Personenzahl abhängen.
// Auslegung nach BGH VIII ZR 180/12; LG Krefeld, 17.03.2010, 2 S 56/09 (eine Person statt null);
// abweichend AG Köln WuM 2002, 28 (Durchschnittsbelegung). Mietfuchs setzt jeden Tag ohne
// Mietverhältnis mit dieser Zahl an, bei allen Positionen nach Personen. Wer das ändert (etwa auf
// die durchschnittliche Belegung des Hauses), ändert es hier und in `vacancyPersons` in
// computeSettlement, sonst nirgends.
export const VACANCY_PERSONS = 1

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
  // #204: Stufe `error`, obwohl verteilt wird: Die Angaben widersprechen sich, und die Mieter der
  // Wohnung tragen für dieselben Tage doppelt. Verweigert wird nicht (Zielbild #91), beziffert schon.
  'tenancy.overlap': { level: 'error', title: 'Mietverhältnisse überschneiden sich', terms: ['tenancyOverlap'] },
  // Bewusst eingetragene 0 bei einer Einheit ohne Fläche und Bewohner (Garage, Stellplatz, #135)
  'basis.unit-zero': { level: 'hint', title: 'Einheit ohne Fläche', terms: ['distributionBasis'] },
  'basis.tenancy-zero': { level: 'hint', title: 'Mietverhältnis ohne Personen', terms: ['personDays'] },
  // Ein Hinweis und keine Warnung (#177): Nichts ist falsch erfasst, und das Geld landet, wo es nach
  // dem Grundsatz hingehört. Zu prüfen ist nur, ob der Ansatz für die leere Wohnung, eine Auslegung,
  // zum Mietvertrag passt.
  'basis.vacancy-persons': { level: 'hint', title: 'Leerstand beim Personenschlüssel', terms: ['vacancy', 'personDays'] },
  // Eine leere Einheit ohne Fläche ist beim Personenschlüssel kein Leerstand (#177); wie bei
  // `basis.unit-zero` ist die 0 meist eine Angabe (Garage, Stellplatz).
  'basis.vacancy-no-area': { level: 'hint', title: 'Leere Einheit ohne Fläche', terms: ['vacancy', 'personDays'] },
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
  'heating.not-by-consumption': { level: 'warning', title: 'Heizkosten nicht nach Verbrauch verteilt', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
  'heating.consumption-share': { level: 'hint', title: 'Verbrauchsanteil der Heizkosten außerhalb 50 bis 70 %', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
  'heating.may-agree-otherwise': { level: 'hint', title: 'Heizkosten nicht nach Verbrauch verteilt (Zweifamilienhaus)', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
  'heating.flat-rate': { level: 'warning', title: 'Heizkosten pauschal vereinbart', rule: 'heating-flat-rate', terms: ['heatingCostOrdinance', 'inclusiveRent'] },
  'heating.remote-reading': { level: 'hint', title: 'Zähler der Heizung fernablesbar?', rule: 'heating-remote-reading', terms: ['heatingCostOrdinance'] },
  'model.prepayment-unsettled': { level: 'warning', title: 'Vorauszahlung ohne Abrechnung', terms: ['prepayment', 'flatRate'] },
  'prepayment.arrears': { level: 'warning', title: 'Rückstand im Mietkonto', terms: ['prepayment'] },
  // #141: ein Hinweis und kein Fehler, denn eine vereinbarte Änderung ist zulässig.
  'key.changed-from-previous-year': { level: 'hint', title: 'Umlageschlüssel anders als im Vorjahr', terms: ['keyChange', 'allocationKey'] },
  // Dieselbe Rechnung zweimal erfasst? (Zusammenspiel #141 und #170, shared/duplicates.ts) Ein
  // Hinweis, denn zwei Rechnungen derselben Kostenart gibt es; zu prüfen ist es trotzdem, deshalb
  // zählt er in der Ampel des Cockpits mit.
  'cost.possible-duplicate': { level: 'hint', title: 'Dieselbe Rechnung zweimal erfasst?', terms: ['allocable'] },
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
// (zwei Stellen) meldete die Warnung unten bei 150,001 gegen 150,004 einen „Unterschied von 0“
// und widerspräche sich damit selbst.
function fmtMeter(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 3 })
}

// Ein Datum in den Meldungen der Zähler deutsch, wie überall in der Oberfläche (#142): Der
// Vermieter liest „am 01.07.2025“ und nicht „am 2025-07-01“. Aus der Zeichenkette gebaut und nicht
// über `Date`, damit keine Zeitzone einen Tag verschiebt.
function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
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
        `Zählerwechsel am ${fmtDay(r1.date)} ohne Endstand des alten Geräts — der Verbrauch bis zum ` +
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
    // ausformulierte Regel, nämlich „es gilt der letzte“ (`lastPerFrom` in schedule.ts), und sie
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
    // zweimal wortgleich dasselbe da, und das Wort „zwei“ stimmte nicht mehr. Summiert ergibt
    // sich genau die Menge, die am Ende fehlt: Bei 150, 160, 150 heben sich die beiden Sprünge
    // auf, es fehlt nichts, und es gibt zu Recht keine Meldung.
    //
    // **Hier gilt diese Meldung und nicht die über negativen Verbrauch**, auch wenn die Differenz
    // negativ ist. Jene spricht von einem Zähler, der über die Zeit zurückläuft, und über null
    // Tage gibt es diese Zeit nicht; ihr Wortlaut wäre an dieser Stelle in beiden Hälften falsch
    // („zwischen dem 30.06. und dem 30.06.“ ist kein Zeitraum, und „Zählerwechsel markieren“ ist
    // gerade beim markierten Zählerwechsel der falsche Rat).
    if (days === 0) {
      if (delta !== 0) lostPerDay.set(r0.date, (lostPerDay.get(r0.date) ?? 0) + delta)
      continue
    }

    if (delta < 0) {
      warn('meter.negative', `Negativer Verbrauch zwischen dem ${fmtDay(r0.date)} und dem ${fmtDay(r1.date)} (${fmtMeter(delta)}) — Ablesung prüfen oder Zählerwechsel markieren.`, meterSubject(r1))
    }
    segments.push({ from: r0.date, to: r1.date, delta, days })
  }
  for (const [date, lost] of lostPerDay) {
    // Heben sich mehrere Sprünge desselben Tages auf, fehlt nichts.
    if (lost === 0) continue
    warn('meter.same-day',
      `Mehrere Ablesungen am ${fmtDay(date)}: Die Stände unterscheiden sich um ${fmtMeter(Math.abs(lost))}, ` +
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
// Status („bezahlt / teilweise / offen“) wider, bis zu welchem Monat das Konto gedeckt ist.
// **Fällig ist nur, was vor dem Monat des Stichtags liegt** (#133). Die Miete ist bis zum dritten
// Werktag fällig (§ 556b Abs. 1 BGB), und eine Überweisung braucht ein paar Tage, bis sie gebucht
// ist; den laufenden Monat erst ab einem bestimmten Tag mitzuzählen, hinge an Wochenenden und
// Feiertagen. Liegt der Stichtag nach dem Jahr, ist alles fällig, liegt er davor, nichts. Ohne
// Stichtag (Steuer, Regression, Tests) gilt das ganze Jahr als fällig. Die Berechnung fragt nie
// selbst nach „heute“; die Routen reichen den Tag hinein.
export function dueMonthsOf(year: number, asOf: string | undefined): number {
  if (!asOf || asOf.slice(0, 4) > String(year)) return 12
  return asOf.slice(0, 4) < String(year) ? 0 : Number(asOf.slice(5, 7)) - 1
}

// `asOf` wie bei der Abrechnung: Monate ab dem des Stichtags sind „noch nicht fällig“ und kein
// Rückstand (zweite Browserabnahme). Das Soll bleibt dasselbe, die Steuerübersicht hängt nicht daran.
export function rentLedger(snapshot: Snapshot, options: { asOf?: string } = {}): RentLedger {
  const year = snapshot.year
  const dueMonths = dueMonthsOf(year, options.asOf)
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
        mo.status = applied >= mo.sollCents ? 'paid' : mo.month > dueMonths ? 'notDue' : applied > 0 ? 'partial' : 'open'
      }

      const sollYearCents = months.reduce((a, mo) => a + mo.sollCents, 0)
      const baseRentYearCents = months.reduce((a, mo) => a + mo.baseRentCents, 0)
      const prepaymentYearCents = months.reduce((a, mo) => a + mo.prepaymentCents, 0)
      const flatRateYearCents = months.reduce((a, mo) => a + mo.flatRateCents, 0)
      const dueSollCents = months.filter((mo) => mo.month <= dueMonths).reduce((a, mo) => a + mo.sollCents, 0)
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
        dueSollCents,
        arrearsCents: Math.max(0, dueSollCents - paidYearCents),
        openMonths: months.filter((mo) => mo.status === 'open' || mo.status === 'partial').length,
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
      openCents: rows.reduce((a, r) => a + r.arrearsCents, 0),
    },
  }
}

// ---------- §35a-Lohnanteil ----------

// Gilt der §35a-Lohnanteil einer Position (#148)? Er muss zwischen 0 und dem Rechnungsbetrag
// liegen; an einer Gutschrift gibt es deshalb keinen. Fehlt er, ist er 0. Ein ungültiger ergibt
// `null`: Die Abrechnung warnt dann (`labor35a.invalid`) und bescheinigt nichts, und die
// Steuerübersicht zählt ihn nicht. Einmal formuliert, damit beide nie Verschiedenes nennen.
export function validLabor35aCents(item: { amountCents: number, labor35aCents?: number | null }): number | null {
  const labor = item.labor35aCents ?? 0
  if (labor === 0) return 0
  return !Number.isFinite(labor) || labor < 0 || labor > item.amountCents ? null : labor
}

// ---------- Steuer-Export (Anlage V) ----------

// Betriebskostenarten den Anlage-V-nahen Positionsgruppen zuordnen. Bewusst beschreibende
// Gruppen statt fester Zeilennummern (die sich jährlich ändern können). Unbekannte Kategorien
// fallen auf „Sonstige Werbungskosten“.
// Ausgeführt für categories.test.ts, das die drei Listen der Kostenarten zusammenhält.
// `null` heißt: keine Werbungskosten dieses Jahres, sondern gesondert ausgewiesen (#143).
export const ANLAGE_V_GROUP: Record<string, string | null> = {
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
  // #143: Die Zuführung zur Erhaltungsrücklage ist erst Werbungskosten, wenn und soweit die
  // Gemeinschaft sie für Erhaltungsmaßnahmen verausgabt (BFH, Urteil vom 14.01.2025, IX R 19/24).
  'Zuführung Erhaltungsrücklage': null,
}
// Anzeigereihenfolge der Gruppen in der Auswertung
export const ANLAGE_V_GROUP_ORDER = [
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
  // die Summe null, erfasst ist aber sehr wohl etwas, und der Satz „keine Zahlung erfasst“ wäre
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
  // Steht im Jahr keine Heizposition, rechnen die Mieter die Heizung selbst mit dem Versorger ab,
  // und das Heizmodell sagt nichts über die Nebenkosten des Vermieters (dritte Durchsicht).
  const tenancyById = new Map(snapshot.tenancies.map((t) => [t.id, t]))
  const heatingBilled = snapshot.costItems.some((c) => c.year === year && c.category === HEATING_CATEGORY)
  const models = ledger.rows.map((r) => {
    const t = tenancyById.get(r.tenancyId)
    const cold = t?.costModel ?? 'settlement'
    return { cold, heat: heatingBilled ? t?.heatingModel ?? 'settlement' : cold }
  })
  const costModels = {
    tenancies: models.length,
    inclusive: models.filter((m) => m.cold === 'inclusive' && m.heat === 'inclusive').length,
    partlyInclusive: models.filter((m) => (m.cold === 'inclusive') !== (m.heat === 'inclusive')).length,
    flatRate: models.filter((m) => m.cold === 'flatRate' || m.heat === 'flatRate').length,
  }
  const tenanciesWithoutPayment = withSoll.filter((r) => !paidTenancies.has(r.tenancyId)).length
  // Der Teil der Kaltmiete, der Nebenkosten einschließt (#142): Inklusivmiete kalt oder warm, nach
  // denselben Modellen wie `costModels`. Die Übersicht nennt ihn eigens, denn „ohne Umlagen“ ist er
  // gerade nicht. Eine Auskunft über die Summe darüber, keine neue Zahl.
  const inclusiveRentSollCents = ledger.rows.reduce((a, r, i) => {
    const m = models[i]
    return m && (m.cold === 'inclusive' || m.heat === 'inclusive') ? a + r.baseRentYearCents : a
  }, 0)

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
  // Die Aufteilung bei teilweiser Eigennutzung (#163), je Position. Die Rücklage fehlt darin.
  const split = splitForTax(snapshot, items.filter((c) => groupOf(c.category) !== null), settlement)
  const byGroup = new Map<string, Map<string, TaxExpenseCategory>>()
  // Zuführung zur Erhaltungsrücklage (#143): nicht unter den Werbungskosten, sondern daneben.
  let reserveContributionCents = 0
  for (const item of items) {
    const group = groupOf(item.category)
    if (group === null) {
      reserveContributionCents += item.amountCents
      continue
    }
    let cats = byGroup.get(group)
    if (!cats) {
      cats = new Map()
      byGroup.set(group, cats)
    }
    const prev = cats.get(item.category) ?? { category: item.category, amountCents: 0, labor35aCents: 0, privateCents: 0, deductibleCents: 0 }
    const share = split.items.get(item.id)
    prev.amountCents += item.amountCents
    prev.privateCents += share?.privateCents ?? 0
    prev.deductibleCents += share?.deductibleCents ?? item.amountCents
    // Nur ein gültiger Lohnanteil, dieselbe Regel wie in der Abrechnung (#148).
    prev.labor35aCents += validLabor35aCents(item) ?? 0
    cats.set(item.category, prev)
  }
  const groups: TaxExpenseGroup[] = [...byGroup.entries()]
    .map(([group, cats]) => {
      const categories = [...cats.values()].sort((a, b) => b.amountCents - a.amountCents)
      return {
        group,
        amountCents: categories.reduce((a, c) => a + c.amountCents, 0),
        labor35aCents: categories.reduce((a, c) => a + c.labor35aCents, 0),
        privateCents: categories.reduce((a, c) => a + c.privateCents, 0),
        deductibleCents: categories.reduce((a, c) => a + c.deductibleCents, 0),
        categories,
      }
    })
    .sort((a, b) => {
      const ia = ANLAGE_V_GROUP_ORDER.indexOf(a.group)
      const ib = ANLAGE_V_GROUP_ORDER.indexOf(b.group)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  const totalCents = groups.reduce((a, g) => a + g.amountCents, 0)
  const privateCents = groups.reduce((a, g) => a + g.privateCents, 0)
  // Als Differenz, damit privat und abziehbar zusammen immer die Bruttosumme ergeben.
  const deductibleCents = totalCents - privateCents
  const labor35aCents = groups.reduce((a, g) => a + g.labor35aCents, 0)
  // Positionen „Nicht umlagefähig“, die nach Rücklage aussehen (#143). Gerechnet wird wie
  // erfasst; die Steuerübersicht rät nur, die Kostenart zu ändern. Der Hinweis gehört hierher und
  // nicht unter die Hinweise der Abrechnung: Auf die Abrechnung wirkt die Kostenart nicht, beide
  // sind nicht umlagefähig, und dort bliebe er im Cockpit ein offener Punkt ohne Folge.
  const reserveSuspects = items
    .filter((c) => c.category === 'Nicht umlagefähig' && looksLikeReserveContribution(c.description))
    .map((c) => ({ costItemId: c.id, description: c.description, amountCents: c.amountCents }))

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
  // (`unitForm.ts`), „ausgenommen“ ergibt also ausdrücklich `selfUsed: false`, während ein alter
  // Bestand das Feld gar nicht führt. Darauf eine Steuerauskunft zu stützen wäre aber brüchig:
  // `emptyUnit` in db/repository.ts kennt das Feld nicht, und ein `POST /api/units` ohne das
  // Feld liefert ebenfalls `undefined`. „Nicht gesetzt heißt nie eingeordnet“ ist heute nirgends
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
      inclusiveRentSollCents,
      prepaymentSollCents,
      flatRateSollCents,
      prepaymentSettlementCents,
      prepaymentOverridden,
      sollCents,
      paidCents,
      tenanciesWithSoll,
      tenanciesWithoutPayment,
    },
    expenses: { groups, totalCents, privateCents, deductibleCents, labor35aCents, items: [...split.items.values()] },
    selfUseChangedInYear: split.selfUseChangedInYear,
    closedSelfUseDiffers: split.closedSelfUseDiffers,
    closedItemsChanged: split.closedItemsChanged,
    reserveContributionCents,
    reserveSuspects,
    totalAreaM2: totalArea,
    selfUsedAreaM2,
    selfOccupiedExists,
    excludedExists,
    costModels,
    selfUsedShareCents,
    // Der Überschuss rechnet mit dem abziehbaren Teil (#163). Ohne Eigennutzung ist er die
    // Bruttosumme, und die Zahl bleibt, wie sie war.
    surplusSollCents: sollCents - deductibleCents,
    surplusPaidCents: paidCents - deductibleCents,
  }
}

// Die Anlage-V-Gruppe einer Kostenart, `null` für die Rücklage (#143). Bewusst nach
// `Object.hasOwn` gefragt und nicht mit `??`: `null` ist hier eine Angabe.
const groupOf = (category: string): string | null =>
  Object.hasOwn(ANLAGE_V_GROUP, category) ? ANLAGE_V_GROUP[category] ?? null : 'Sonstige Werbungskosten'

// ---------- Werbungskosten bei teilweiser Eigennutzung (#163) ----------
//
// Die Regeln und ihre Quellen stehen in docs/superpowers/specs/2026-10-02-steuer-eigennutzung-design.md.
// Kurz: Was einer Einheit direkt zugeordnet ist, gehört ganz zu ihr; Gebäudekosten werden nach dem
// Verhältnis der Wohn- und Nutzflächen aufgeteilt (BFH, Urteil vom 24.06.2008, IX R 26/06), mit dem
// ganzen Gebäude als Grundmenge wie in #68; und bei umlagefähigen Kosten gilt der Eigenanteil, den
// die Nebenkostenabrechnung ausweist, damit Abrechnung und Steuer dasselbe sagen (Auslegung, F1).
//
// **Die Abrechnung bleibt unberührt.** Gelesen wird ihr Ergebnis, die Zerlegung des
// Vermieteranteils (#142); `computeSettlement` ändert sich nicht, und die Golden-Tests bleiben der
// Beweis, dass keine Abrechnung wandert.
//
// **Ohne selbstgenutzte Einheit ist nichts privat**: Der Eigenanteil der Abrechnung ist dann 0, und
// die Fläche der eigenen Einheiten ebenso. Eine Invariante in calc.test.ts hält das fest.

// Kaufmännisch gerundet und bei einer Gutschrift spiegelbildlich: −0,5 Cent wird −1 Cent, nicht 0.
// Das `|| 0` macht aus einer negativen Null eine Null; sonst hieße eine Gutschrift ohne privaten
// Teil „privat −0“, und ein Vergleich mit 0 schlüge fehl (gefunden von der Invariante).
const roundHalfAway = (x: number): number => (Math.sign(x) * Math.round(Math.abs(x))) || 0

// Die Schlüssel, bei denen der Eigenanteil der Abrechnung einem anderen Maßstab folgt als Fläche
// oder gemessenem Verbrauch. Für sie rechnet die Übersicht zum Vergleich nach Fläche.
const KEYS_NOT_AREA: readonly CostKey[] = ['persons', 'units', 'custom', 'external']

type TaxSplit = { items: Map<string, TaxExpenseItem>, selfUseChangedInYear: boolean, closedSelfUseDiffers: boolean, closedItemsChanged: number }

function splitForTax(snapshot: Snapshot, items: SnapshotCostItem[], settlement: ComputedSettlement): TaxSplit {
  const units = snapshot.units
  const unitById = new Map(units.map((u) => [u.id, u]))
  const isSelf = (u: SnapshotUnit) => !!u.selfUsed && !u.participates
  const areaOf = (u: SnapshotUnit) => u.areaM2 || 0

  // Der Eigenanteil je Position, wie ihn die Abrechnung dieses Jahres ausweist.
  const live = new Map<string, FrozenItemSelfUse>()
  for (const row of settlement.landlord.rows) {
    const entry = live.get(row.costItemId) ?? { selfCents: 0, noBasis: false }
    for (const part of row.landlordParts ?? []) {
      if (part.reason === 'selfUse') entry.selfCents += part.cents
      if (part.reason === 'noBasis') entry.noBasis = true
    }
    live.set(row.costItemId, entry)
  }
  const liveOf = (id: string): FrozenItemSelfUse => live.get(id) ?? { selfCents: 0, noBasis: false }

  // **Bei abgeschlossener Abrechnung gilt ihr eingefrorener Stand**, wie beim Eigenanteil und den
  // Vorauszahlungen (#70): Die Steuerübersicht soll nennen, was beim Mieter auf dem Papier steht.
  // **Aber nur für Positionen, die genau so auf dem Papier standen** (Durchsicht): Eine nach dem
  // Abschluss erfasste Position hat dort keinen Eigenanteil, und ihn als 0 zu lesen machte sie
  // ganz abziehbar; bei einem danach geänderten Betrag passte der eingefrorene Eigenanteil nicht
  // mehr zum Betrag und ergab einen negativen abziehbaren Teil. Solche Positionen rechnet die
  // Übersicht heute und zählt sie für den Hinweis.
  const frozen = snapshot.closedSettlement
  const totals = frozen?.itemTotals ?? null
  // Eine Position ohne Betrag fehlt in Archivstücken älterer Versionen, die für sie keine Zeile
  // schrieben; geändert ist sie deshalb nicht (Durchsicht), und privat ist an 0 € ohnehin nichts.
  const asClosed = (c: SnapshotCostItem): boolean =>
    !!frozen && (totals === null || (Object.hasOwn(totals, c.id) ? totals[c.id] === c.amountCents : c.amountCents === 0))
  const closedItemsChanged = frozen ? items.filter((c) => !asClosed(c)).length : 0
  let fromSettlement = (c: SnapshotCostItem) => liveOf(c.id)
  let closedSelfUseDiffers = false
  if (frozen && frozen.selfUseByItem) {
    const byItem = frozen.selfUseByItem
    fromSettlement = (c) => (asClosed(c) ? (Object.hasOwn(byItem, c.id) ? byItem[c.id] : undefined) ?? { selfCents: 0, noBasis: false } : liveOf(c.id))
    closedSelfUseDiffers = items.some((c) => asClosed(c) && fromSettlement(c).selfCents !== liveOf(c.id).selfCents)
  } else if (frozen) {
    // Ein Archivstück von vor #142 kennt nur die Summe. Sie wird auf die Positionen, die so auf dem
    // Papier standen, im Verhältnis der heutigen Eigenanteile verteilt, mit dem Restverfahren und
    // der Kennung als Entscheid. Ohne heutigen Eigenanteil lässt sie sich nicht verteilen, und das
    // sagt der Hinweis. Ist seither eine Position entfallen oder geändert, enthält die Summe auch
    // ihren Anteil; das bleibt eine Näherung, und der Hinweis erscheint.
    const allocable = items.filter((c) => !isNotAllocable(c.category) && asClosed(c))
    const today = allocable.map((c) => liveOf(c.id).selfCents)
    const todaySum = today.reduce((a, c) => a + c, 0)
    const parts = todaySum !== 0
      ? largestRemainder(frozen.selfUsedShareCents, today.map((c) => (c * frozen.selfUsedShareCents) / todaySum), allocable.map((c) => c.id))
      : allocable.map(() => 0)
    const distributed = new Map(allocable.map((c, k) => [c.id, parts[k] ?? 0]))
    fromSettlement = (c) => (asClosed(c) ? { selfCents: distributed.get(c.id) ?? 0, noBasis: liveOf(c.id).noBasis } : liveOf(c.id))
    closedSelfUseDiffers = todaySum !== frozen.selfUsedShareCents
  }

  // **Gibt es Einheiten außerhalb der Abrechnungseinheit, zählt das ganze Gebäude** (Durchsicht).
  // Die Abrechnung verteilt nur über die Abrechnungseinheit; ihr Eigenanteil behandelte die
  // Fläche einer getrennt abgerechneten Gewerbeeinheit damit wie privat (100 m² eigen, 100 m²
  // vermietet, 100 m² Gewerbe: 1.500 € statt 1.000 € von 3.000 €). Dann gilt für die Schlüssel,
  // die über Wohnungen verteilen, der BFH-Maßstab über das Gebäude, und der Eigenanteil der
  // Abrechnung steht zum Vergleich daneben. Verbrauch und Einzelbeträge ordnen dagegen eindeutig
  // zu (der Verbrauch einer Einheit außerhalb steckt in der Verteilbasis), dort bleibt es bei der
  // Abrechnung. Gefragt wird nach den betroffenen Einheiten der Position.
  const outside = (u: SnapshotUnit) => !u.participates && !u.selfUsed
  const BUILDING_KEYS: readonly CostKey[] = ['area', 'units', 'persons', 'custom', 'external']
  const outsideAffected = (item: SnapshotCostItem): boolean =>
    BUILDING_KEYS.includes(item.key) && units.some((u) => outside(u) && (!item.participantUnitIds || item.participantUnitIds.includes(u.id)))

  // Nach Fläche über die betroffenen Einheiten: die Teilnehmer der Position, sonst alle Einheiten
  // des Objekts. `null`, wenn eine Fläche fehlt, die es zum Aufteilen bräuchte.
  const byArea = (item: SnapshotCostItem) => {
    const only = item.participantUnitIds ? new Set(item.participantUnitIds) : null
    const affected = only ? units.filter((u) => only.has(u.id)) : units
    const area = affected.reduce((a, u) => a + areaOf(u), 0)
    const selfAffected = affected.filter(isSelf)
    const selfArea = selfAffected.reduce((a, u) => a + areaOf(u), 0)
    const missing = selfAffected.filter((u) => !(areaOf(u) > 0))
    if (selfAffected.length > 0 && (missing.length > 0 || !(area > 0))) {
      return { ok: false as const, missing: missing.length > 0 ? missing : selfAffected, limited: only !== null }
    }
    const raw = area > 0 ? (item.amountCents * selfArea) / area : 0
    return { ok: true as const, area, selfArea, raw, privateCents: roundHalfAway(raw), limited: only !== null }
  }

  const result = new Map<string, TaxExpenseItem>()
  for (const item of items) {
    const amount = item.amountCents
    const allocable = !isNotAllocable(item.category)
    const direct = item.key === 'direct' && item.directUnitId ? unitById.get(item.directUnitId) : undefined
    const fromBill = fromSettlement(item)
    const steps: CalcStep[] = [{ label: 'Rechnungsbetrag', value: fmtCents(amount) }]
    let allocation: TaxAllocation
    let privateCents = 0
    let areaPrivateCents: number | null = null
    let settlementPrivateCents: number | null = null
    // „Betrifft (für die Steuer)“: dieselben Einheiten, die die Zweige unten lesen.
    const taxUnits = allocable ? null
      : direct ? [direct]
        : item.participantUnitIds ? units.filter((u) => item.participantUnitIds?.includes(u.id))
          : null
    // Eine leere Liste nennt keine Einheit; die Seite zeigte sonst eine leere Aufzählung (Durchsicht).

    const directLabel = (u: SnapshotUnit) =>
      `direkt: ${u.name} (${isSelf(u) ? 'selbstgenutzt' : u.participates ? 'vermietete Einheit' : 'außerhalb der Abrechnungseinheit'})`
    // Nach Fläche aufteilen; gibt die Zuordnung zurück, damit jeder Zweig unten sie selbst setzt.
    const applyArea = (why?: string): TaxAllocation => {
      const a = byArea(item)
      if (why) steps.push({ label: 'Hinweis', value: why })
      if (!a.ok) {
        steps.push({ label: 'Zuordnung', value: `nicht aufteilbar: Für ${andList(a.missing.map((u) => u.name))} ist keine Fläche hinterlegt; der Betrag ist ungekürzt angesetzt`, term: 'mixedUse' })
        return 'unsplittable'
      }
      privateCents = a.privateCents
      steps.push({ label: 'Zuordnung', value: 'verhältnismäßig nach Wohn- und Nutzfläche', term: 'mixedUse' })
      steps.push({ label: 'Betroffene Fläche', value: `${fmtNum(a.area)} m² (${a.limited ? 'nur die betroffenen Einheiten' : 'ganzes Gebäude'})` })
      steps.push({ label: 'davon selbstgenutzt', value: `${fmtNum(a.selfArea)} m²` })
      if (a.area > 0 && a.selfArea > 0) {
        steps.push({ label: 'Rechnung', value: `${fmtCents(amount)} × ${fmtNum(a.selfArea)}/${fmtNum(a.area)} = ${fmtExactEuro(a.raw)}` })
      }
      steps.push({ label: 'privat, auf Cent gerundet', value: fmtCents(privateCents), term: 'ownShare' })
      return 'area'
    }

    if (!allocable) {
      if (direct && isSelf(direct)) {
        allocation = 'direct-self'
        privateCents = amount
        steps.push({ label: 'Zuordnung', value: directLabel(direct) })
        steps.push({ label: 'privat', value: fmtCents(privateCents), term: 'ownShare' })
      } else if (direct) {
        allocation = direct.participates ? 'direct-rented' : 'direct-outside'
        steps.push({ label: 'Zuordnung', value: directLabel(direct) })
      } else {
        allocation = applyArea()
      }
    } else if (direct && !fromBill.noBasis) {
      allocation = isSelf(direct) ? 'direct-self' : direct.participates ? 'direct-rented' : 'direct-outside'
      privateCents = fromBill.selfCents
      steps.push({ label: 'Zuordnung', value: directLabel(direct) })
      if (privateCents !== 0) steps.push({ label: 'Eigenanteil laut Abrechnung (privat)', value: fmtCents(privateCents), term: 'ownShare' })
    } else if (fromBill.noBasis) {
      allocation = applyArea('Die Nebenkostenabrechnung hat diese Position nicht verteilt; aufgeteilt wird deshalb nach Fläche.')
    } else if (outsideAffected(item)) {
      settlementPrivateCents = fromBill.selfCents
      allocation = applyArea(`Zum Gebäude gehören Einheiten außerhalb der Abrechnungseinheit. Die Nebenkostenabrechnung verteilt nur über die Abrechnungseinheit und weist ${fmtCents(fromBill.selfCents)} Eigenanteil aus; für die Steuer zählt das Verhältnis der Flächen des ganzen Gebäudes.`)
    } else {
      allocation = 'settlement'
      privateCents = fromBill.selfCents
      steps.push({ label: 'Zuordnung', value: `verhältnismäßig laut Nebenkostenabrechnung ${snapshot.year}, verteilt nach ${KEY_LABELS[item.key] || item.key}${frozen ? ' (abgeschlossene Abrechnung)' : ''}`, term: 'allocationKey' })
      steps.push({ label: 'Eigenanteil laut Abrechnung (privat)', value: fmtCents(privateCents), term: 'ownShare' })
      if (KEYS_NOT_AREA.includes(item.key)) {
        const a = byArea(item)
        if (a.ok) {
          areaPrivateCents = a.privateCents
          steps.push({ label: 'Zum Vergleich nach Wohn- und Nutzfläche', value: `${fmtCents(a.privateCents)} privat (${fmtNum(a.selfArea)} von ${fmtNum(a.area)} m²)`, term: 'mixedUse' })
        }
      }
    }

    const deductibleCents = amount - privateCents
    const kind: TaxAllocation = allocation
    const deductiblePercent = (kind === 'settlement' || kind === 'area') && amount !== 0
      ? Math.round((deductibleCents / amount) * 10000) / 100
      : null
    steps.push({ label: 'abziehbar', value: deductiblePercent !== null ? `${fmtCents(deductibleCents)} (${fmtNum(deductiblePercent)} %)` : fmtCents(deductibleCents) })
    result.set(item.id, {
      costItemId: item.id,
      category: item.category,
      group: groupOf(item.category) ?? 'Sonstige Werbungskosten',
      description: item.description,
      amountCents: amount,
      privateCents,
      deductibleCents,
      labor35aCents: validLabor35aCents(item) ?? 0,
      allocation: kind,
      deductiblePercent,
      areaPrivateCents,
      settlementPrivateCents,
      steps,
      taxUnits: taxUnits && taxUnits.length > 0 ? taxUnits.map((u) => ({ unitId: u.id, unitName: u.name })) : null,
    })
  }

  // Ein Mietverhältnis auf einer selbstgenutzten Einheit im Jahr: Die Nutzung hat keine Zeitachse,
  // die Fläche zählt also das ganze Jahr als privat (F5).
  const selfIds = new Set(units.filter(isSelf).map((u) => u.id))
  const selfUseChangedInYear = snapshot.tenancies.some((t) => selfIds.has(t.unitId) && overlapDays(t.start, t.end, snapshot.year) > 0)
  return { items: result, selfUseChangedInYear, closedSelfUseDiffers, closedItemsChanged }
}

// ---------- Hilfen ----------

// ---------- Die eine Rundungsregel (#202) ----------
//
// Jede Kostenposition wird **genau einmal** nach dem Restverfahren verteilt, und zwar über alle
// Empfänger zugleich: die Zeilen der Mieter und je Grund eine Zeile des Vermieters (Eigennutzung,
// Leerstand, Pauschale, Inklusivmiete, außerhalb der Abrechnungseinheit, Rest der Vereinbarung,
// Rest des Hauptzählers, Rest der Einzelbeträge). Die exakten Werte aller Zeilen ergeben zusammen
// genau den Betrag; der Rest des Vermieters ist dafür definiert als Betrag minus alle übrigen.
// Daraus folgt ohne Fallunterscheidung: Die Summe stimmt immer centgenau, jede Zeile ist ihr
// exakter Wert ab- oder aufgerundet, und keine Zeile des Vermieters kann das Vorzeichen wechseln.
// Vorher wurde bei voller Umlage nach dem Restverfahren verteilt, sonst jeder Mieter für sich
// gerundet und der Vermieter bekam den Rest; der konnte bei −1 Cent landen (1,00 € auf 67/67/65 m²
// vermietet und 1 m² selbstgenutzt: 34/34/33 ct, zusammen 1,01 €).
//
// Ein Empfänger: `key` ist die Kennung des Mietverhältnisses oder der Grund beim Vermieter, `raw`
// sein exakter Anteil in Cent (mit dem Vorzeichen der Position).
export type Recipient = { key: string, landlord: boolean, raw: number }

// Was nur durch Gleitkomma-Rauschen von 0 oder einer ganzen Zahl abweicht, gilt als genau das. Ein
// Rest des Vermieters von 1e-12 Cent ist rechnerisch 0 und darf beim Gleichstand nicht vorn liegen;
// einer von −1e-12 Cent ergäbe abgerundet −1 und holte sich dann einen Cent zurück.
const NOISE = 1e-6
export const cleanRaw = (x: number): number => {
  if (Math.abs(x) < NOISE) return 0
  const r = Math.round(x)
  return Math.abs(x - r) < NOISE ? r : x
}

// Reihenfolge, in der die Restcent vergeben werden: größter Nachkommaanteil zuerst. Gleich heißt
// gleich bis auf Rauschen (0,4999999999 und 0,5); dann geht ein Cent zuerst an eine Zeile des
// Vermieters und nicht an einen Mieter, unter Mietern entscheidet die Kennung wie seit #70, nie die
// Reihenfolge in der Datei. Eine Zeile mit dem exakten Wert 0 kommt nicht vor: Sie bekommt nie
// einen Cent.
const TIE = 1e-9
function remainderOrder(values: number[], recipients: Recipient[]): number[] {
  const frac = (k: number) => values[k] - Math.floor(values[k])
  return values.map((_, k) => k).filter((k) => values[k] !== 0).sort((i, j) => {
    const d = frac(j) - frac(i)
    if (Math.abs(d) > TIE) return d
    if (recipients[i].landlord !== recipients[j].landlord) return recipients[i].landlord ? -1 : 1
    return compareText(recipients[i].key, recipients[j].key)
  })
}

// Verteilt den Betrag über die Empfänger. Gerechnet wird mit dem Betrag ohne Vorzeichen, das
// Vorzeichen kommt danach dazu; eine Gutschrift ist so das Spiegelbild der Rechnung.
export function distributeCents(totalCents: number, recipients: Recipient[]): number[] {
  const sign = totalCents < 0 ? -1 : 1
  const values = recipients.map((r) => cleanRaw(r.raw * sign))
  const cents = values.map((v) => Math.floor(v))
  let rest = Math.abs(totalCents) - cents.reduce((a, b) => a + b, 0)
  const order = remainderOrder(values, recipients)
  if (order.length > 0) {
    for (let k = 0; rest > 0; k++, rest--) cents[order[k % order.length]]++
    for (let k = 0; rest < 0; k++, rest++) cents[order[order.length - 1 - (k % order.length)]]--
  }
  return cents.map((c) => (c * sign) || 0)
}

// **Der §35a-Lohnanteil wird mitverteilt** (#202), und zwar innerhalb der eben verteilten
// Kostenanteile: Jede Zeile bekommt ihren exakten Lohn L × exakt / A ab- oder aufgerundet, nie
// mehr als ihren Kostenanteil, und zusammen genau den Lohn der Rechnung, auch die Zeilen des
// Vermieters. Ist die Rechnung ganz Lohn (L = A), sind die exakten Werte dieselben wie die der
// Kosten, die Reihenfolge der Restcent ebenso, und der Lohnanteil jeder Zeile ist genau ihr
// Kostenanteil.
//
// Warum nicht Lohn und Rest unabhängig verteilen und addieren: Zwei Rundungen zusammen können um
// fast 2 Cent vom exakten Kostenanteil abweichen (0,5 + 0,5 exakt, beide aufgerundet, ergibt 2 statt
// 1). Deshalb erst die Kosten, dann der Lohn darin.
//
// Dass der Lohn dabei immer Platz findet, ist gemessen (über 46 Millionen kleine Fälle erschöpfend
// und 2 Millionen zufällige): Der erste Durchgang bis höchstens zur Aufrundung des Lohns ergab immer
// genau L. Für den Fall, dass es doch einmal nicht reicht, gibt der zweite Durchgang bis zum
// Kostenanteil nach; Platz gibt es dort immer, denn die nicht negativen Kostenanteile ergeben
// zusammen mindestens A ≥ L. Die Zusagen „0 ≤ Lohn ≤ Kostenanteil“ und „Σ Lohn = L“ hängen also
// nicht an der Messung. An ihr hängt, dass jeder Lohnanteil höchstens um einen Cent von seinem
// exakten Wert abweicht, und gemessen ist das nur für widerspruchsfreie Daten, deren exakte Werte
// zusammen genau A ergeben; bei sich überschneidenden Mietverhältnissen gilt es nicht sicher.
export function distributeLaborCents(laborCents: number, totalCents: number, recipients: Recipient[], shares: number[]): { cents: number[], exact: number[] } {
  const exact = recipients.map((r) => {
    const e = cleanRaw(r.raw)
    return laborCents === totalCents ? e : cleanRaw((e * laborCents) / totalCents)
  })
  const caps = shares.map((s) => Math.max(0, s))
  const cents = exact.map((l, k) => (l > 0 ? Math.min(Math.floor(l), caps[k]) : 0))
  let rest = laborCents - cents.reduce((a, b) => a + b, 0)
  const order = remainderOrder(exact.map((l) => Math.max(0, l)), recipients)
  for (const k of order) {
    if (rest <= 0) break
    if (cents[k] < Math.min(Math.ceil(exact[k]), caps[k])) { cents[k]++; rest-- }
  }
  for (const k of order) {
    if (rest <= 0) break
    const give = Math.min(caps[k] - cents[k], rest)
    if (give > 0) { cents[k] += give; rest -= give }
  }
  return { cents, exact }
}

// Die Verteilung einer Position, für Prüfungen von außen (#202): je Empfänger der exakte Wert und
// was er bekommen hat. `forced` heißt, die Position geht aus einem einzigen Grund ganz an den
// Vermieter (nicht umlagefähig, keine Verteilbasis …); dann gilt dieser Grund und kein Eigenanteil.
export type AllocationTrace = {
  costItemId: string
  amountCents: number
  laborCents: number
  forced: boolean
  lines: { recipient: string, landlord: boolean, exact: number, cents: number, laborExact: number, laborCents: number }[]
}

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
// `community`: bei der Gemeinschaftsabrechnung die Schritte davor (#114, #144). Erst der Anteil an
// der Gemeinschaft (Anteil × Kosten der Gemeinschaft), dann, ob der Betrag davon abweicht, dann
// der Anteil der Wohnung innerhalb der Wohnungen des Vermieters, nach dem wirklich verteilt wird;
// `ownShare` fehlt, wenn er nur eine hat.
type CommunitySteps = { costsCents: number, share: string, term: TermId, appliedCents: number | null, ownShare: string | null }
type Target = { t: TenancyWithUnit, raw: number, basisText: string, community?: CommunitySteps }

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
export type ComputedSettlement = Omit<Settlement, 'closed' | 'notSettled' | 'notices' | 'legalBasis' | 'garageLikeUnitIds'> & {
  notSettled: NotSettled[]
  garageLikeUnitIds: string[]
  notices: Notice[]
  legalBasis: LegalBasis
}

// Die Kostenart, an der Mietfuchs Heizung und Warmwasser erkennt (#93), steht mit der Ausnahme
// des § 2 HeizkostenV in shared/heating.ts; hier weitergereicht für die bisherigen Importe.
export { HEATING_CATEGORY }

// Die Zuführung zur Erhaltungsrücklage einer Eigentumswohnung (#143): nicht umlagefähig wie
// „Nicht umlagefähig“, aber steuerlich anders (siehe ANLAGE_V_GROUP).
export const RESERVE_CATEGORY = 'Zuführung Erhaltungsrücklage'
// Woran eine Beschreibung nach Rücklage aussieht: Rücklage, Instandhaltungs- und
// Erhaltungsrücklage, auch ohne Umlaut geschrieben.
// Eine Entnahme oder eine Zahlung „aus der Rücklage“ ist keine Zuführung (Durchsicht): Sie ist in
// dem Jahr Werbungskosten, in dem die Gemeinschaft das Geld ausgibt. Dieselbe Regel steht in
// matchCategory (client/src/types.ts); categories.test.ts prüft beide an denselben Texten.
const RESERVE_PATTERN = /r(ü|ue|u)cklage/i
const RESERVE_WITHDRAWAL = /entnahme|\baus\s+(der|dem)\b/i
// Wer „Zuführung“ schreibt, meint sie, auch „aus dem Hausgeld“.
const RESERVE_CONTRIBUTION = /zuf(ü|ue|u)hrung/i
export const looksLikeReserveContribution = (text: string): boolean =>
  RESERVE_PATTERN.test(text) && (RESERVE_CONTRIBUTION.test(text) || !RESERVE_WITHDRAWAL.test(text))

// Kostenarten, die nie auf Mieter verteilt werden. Dieselbe Menge steht als NOT_ALLOCABLE in
// client/src/types.ts; categories.test.ts hält beide zusammen.
export const NOT_ALLOCABLE_CATEGORIES: readonly string[] = ['Nicht umlagefähig', RESERVE_CATEGORY]
export const isNotAllocable = (category: string): boolean => NOT_ALLOCABLE_CATEGORIES.includes(category)

// Die Zeilen des Vermieters einer verteilten Position (#142, #202), in fester Reihenfolge: Jeder
// Grund ist ein Empfänger der einen Verteilung, und was er dort bekommt, ist zugleich sein Teil in
// der Zerlegung des Vermieteranteils. Nichts wird danach noch einmal gerundet oder begrenzt; einen
// Grund „Rundung“ gibt es deshalb nicht mehr (in eingefrorenen Abrechnungen kann er stehen).
//
// Die Anteile der Mietverhältnisse mit Pauschale, Inklusivmiete oder ohne Abrechnung sind exakte
// Anteile wie die der Mieter, und ebenso der Eigenanteil: Er ist immer sein exakter Wert, auch
// wenn andere Zeilen zusammen mehr als den Betrag ergeben (Durchsicht von #203: sonst fraß der
// Überhang zweier sich überschneidender Mietverhältnisse den Eigenanteil, und der private Teil
// erschien in der Steuerübersicht als abziehbar). Die übrigen Gründe beschreiben, was bleibt, und
// können sich mit dem Eigenanteil überschneiden (der Rest des Hauptzählers ist bei einer
// selbstgenutzten Wohnung ohne Zähler ihr Eigenanteil). Sie bekommen deshalb der Reihe nach
// höchstens, was noch übrig ist, wie vor #202 in der Zerlegung, nur jetzt vor dem Runden. Ein
// negativer Wert eines Grundes (ein rückwärts laufender Zähler außerhalb) bleibt bei seinem Grund
// und erscheint nicht unter fremdem Namen. Der letzte Grund ist der Rest: bei Einzelbeträgen der
// Rest der Einzelabrechnung, sonst Leerstand. So ergeben die exakten Werte zusammen genau den
// Betrag. Liegt er nur durch Rechenrauschen unter 0, ist er 0.
//
// Bei widerspruchsfreien Daten hat keine Zeile des Vermieters das umgekehrte Vorzeichen der
// Position. Zwei Datenfehler durchbrechen das, und dann bleibt der Fehler sichtbar, statt einen
// anderen Grund zu verbiegen: Überschneiden sich zwei Mietverhältnisse derselben Wohnung, tragen
// die Mieter rechnerisch mehr als den Betrag, und der Rest (Leerstand) wird negativ; läuft ein
// Zähler rückwärts, wird sein Grund negativ (dazu gibt es eine Meldung). Die Summe stimmt auch dann.
function landlordRecipients(
  item: SnapshotCostItem,
  p: { selfRaw: number, notBooked: { reason: LandlordReason | CostModel, raw: number }[], outsideRaw: number, customUnassignedRaw: number, mainRestRaw: number, bookedRaw: number },
): Recipient[] {
  const sign = item.amountCents < 0 ? -1 : 1
  const sum = (reason: string) => p.notBooked.filter((x) => x.reason === reason).reduce((a, x) => a + x.raw, 0)
  let left = (item.amountCents - p.bookedRaw - p.notBooked.reduce((a, x) => a + x.raw, 0)) * sign
  const take = (raw: number): number => {
    if (raw * sign <= 0) { left -= raw * sign; return raw }
    const t = Math.max(0, Math.min(raw * sign, left))
    left -= t
    return t * sign
  }
  const self = p.selfRaw
  left -= self * sign
  const outside = take(p.outsideRaw)
  const custom = take(p.customUnassignedRaw)
  const mainRest = take(p.mainRestRaw)
  let rest = cleanRaw(left * sign)
  if (rest * sign < 0 && rest * sign > -0.5) rest = 0
  return [
    { key: 'selfUse', landlord: true, raw: self },
    { key: 'flatRate', landlord: true, raw: sum('flatRate') },
    { key: 'inclusive', landlord: true, raw: sum('inclusive') },
    { key: 'outsideUnit', landlord: true, raw: sum('outsideUnit') + outside },
    { key: 'customRest', landlord: true, raw: custom },
    { key: 'mainMeterRest', landlord: true, raw: mainRest },
    { key: item.key === 'amounts' ? 'amountsRest' : 'vacancy', landlord: true, raw: rest },
  ]
}

// Welches Modell für eine Kostenposition gilt: das für Heizung bei der Heizkostenart, sonst das
// für die kalten Kosten. Ohne Angabe die Abrechnung.
const modelFor = (t: SnapshotTenancy, item: SnapshotCostItem): CostModel =>
  (item.category === HEATING_CATEGORY ? t.heatingModel : t.costModel) ?? 'settlement'

// Optionen der Abrechnung. `asOf` (JJJJ-MM-TT) ist der Stichtag für den Hinweis auf einen
// Rückstand im Mietkonto (#133); die Route setzt ihn auf heute. Die Berechnung selbst fragt nie
// nach dem heutigen Datum, sonst rechneten dieselben Daten an zwei Tagen verschieden. Ohne
// Stichtag (Tests, Regression des Umstiegs) gilt das ganze Jahr als fällig.
// `onAllocation` bekommt je Position ihre Verteilung (#202), für die Invarianten der Tests; die
// Abrechnung selbst hängt nicht davon ab.
export type SettlementOptions = { asOf?: string, onAllocation?: (trace: AllocationTrace) => void }

// Der Schlüssel als Satzteil („2025 nach Personenzahl verteilt“), für den Hinweis unten.
const KEY_PHRASES: Record<CostKey, string> = {
  area: 'nach Wohnfläche',
  persons: 'nach Personenzahl',
  units: 'nach Wohneinheiten',
  direct: 'per Direktzuordnung',
  meter: 'nach Verbrauch',
  custom: 'nach vereinbarten Anteilen',
  external: 'laut Gemeinschaftsabrechnung',
  amounts: 'als Einzelbeträge',
}

// Hat eine Position einen anderen Schlüssel als dieselbe Kostenart im Vorjahr (#141)? Dann der
// Text des Hinweises, sonst `null`. „Derselbe Schlüssel“ heißt dasselbe wie für den Vorschlag der
// Oberfläche (shared/allocation.ts); entspricht die Position einer der Vorjahrespositionen, ist sie
// keine Änderung. Wortlaut des § 556a BGB nachgelesen auf gesetze-im-internet.de.
function keyChangeText(item: SnapshotCostItem, previous: readonly SnapshotCostItem[], year: number, basisUnitIds: readonly string[]): string | null {
  if (isNotAllocable(item.category)) return null
  // Bei einer breiten Kostenart nur die Position mit derselben Beschreibung (Befund der Durchsicht).
  const before = comparablePrevious(previous, item.category, year, item.description).map((i) => allocationOf(i, basisUnitIds))
  const now = allocationOf(item, basisUnitIds)
  const first = before[0]
  if (!first || before.some((a) => sameAllocation(a, now))) return null
  const prevYear = year - 1
  const sameKey = before.find((a) => a.key === now.key)
  const what = !sameKey
    ? `„${item.description}“ wird ${year} ${KEY_PHRASES[now.key]} verteilt, die Kostenart „${item.category}“ ${prevYear} ${KEY_PHRASES[first.key]}.`
    : `„${item.description}“ wird ${year} wieder ${KEY_PHRASES[now.key]} verteilt, aber mit ${
      !sameUnits(sameKey.participantUnitIds, now.participantUnitIds) ? 'anderen beteiligten Wohnungen'
        : sameKey.meterType !== now.meterType ? 'einem anderen Zählertyp'
          : sameKey.directUnitId !== now.directUnitId ? 'einer anderen Wohnung'
            : now.key === 'custom' ? 'anderen vereinbarten Anteilen'
              : 'einem anderen Maßstab der Gemeinschaft'
    } als ${prevYear}.`
  // Wortlaut nachgelesen auf gesetze-im-internet.de: § 556a BGB und § 6 Abs. 4 HeizkostenV. Für
  // Heizung und Warmwasser geht die Verordnung vor und erlaubt die Änderung in weiteren Fällen.
  if (item.category === HEATING_CATEGORY) {
    return `${what} Für Heizung und Warmwasser gilt die Heizkostenverordnung: Den Abrechnungsmaßstab darf der Gebäudeeigentümer durch Erklärung gegenüber den Nutzern für künftige Abrechnungszeiträume ändern, bei Einführung einer Vorerfassung nach Nutzergruppen, nach baulichen Maßnahmen, die nachhaltig Heizenergie einsparen, oder aus anderen sachgerechten Gründen, und nur mit Wirkung zum Beginn eines Abrechnungszeitraums (§ 6 Abs. 4 HeizkostenV). ` +
      'Ist die Änderung so erklärt oder vereinbart, ist nichts zu tun.'
  }
  return `${what} Ein vereinbarter Umlageschlüssel gilt weiter, bis er geändert wird: mit Zustimmung der Mieter, oder durch Ihre Erklärung in Textform, nur vor Beginn eines Abrechnungszeitraums und nur hin zu einer Verteilung nach erfasstem Verbrauch oder erfasster Verursachung (§ 556a Abs. 2 BGB). ` +
    'Bei einer vermieteten Eigentumswohnung gilt, soweit nichts anderes vereinbart ist, der jeweils geltende Maßstab der Gemeinschaft; widerspricht er billigem Ermessen, wird nach Absatz 1 umgelegt, also in der Regel nach Wohnfläche (§ 556a Abs. 3 BGB). Ist die Änderung so vereinbart, ist nichts zu tun.'
}

export function computeSettlement(snapshot: Snapshot, options: SettlementOptions = {}): ComputedSettlement {
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
  // Garage-artig (#135): keine Fläche, und im Jahr ausdrücklich mit 0 Personen genutzt, also
  // mindestens ein Mietverhältnis und keines mit Personen (bei Eigennutzung ausdrücklich 0 eigene
  // Personen). Dann ist eine 0 eine Angabe (Garage, Stellplatz, Lager) und keine vergessene Zahl;
  // siehe die Hinweise zur Verteilbasis unten. **Leerstand zählt nicht dazu**: Ohne Mietverhältnis
  // lässt sich eine Garage von einer Wohnung mit vergessener Fläche nicht unterscheiden, und im
  // zweiten Fall wanderte der Anteil des Leerstands still zu den Mietern. Eine leere Garage warnt
  // dann eben; das ist der billigere Irrtum.
  const isGarageLike = (u: SnapshotUnit): boolean => {
    if (u.areaM2 > 0) return false
    if (u.selfUsed) return u.selfPersons === 0
    const own = tenancies.filter((t) => t.unitId === u.id)
    return own.length > 0 && own.every((t) => !(personDaysInPeriod(t, yFrom, yTo) > 0))
  }
  // Personentage der selbstgenutzten Wohnungen: ganzjährig mit der hinterlegten Personenzahl
  const selfPersonDays = selfUnits.reduce((a, u) => a + selfPersonsOf(u) * diy, 0)
  // Wohnung ist, was Fläche hat oder im Jahr bewohnt ist; eine Einheit ohne Fläche und ohne
  // Bewohner (Garage, Stellplatz) ist keine. Eine Regel für zwei Fragen: ob das Gebäude unter § 2
  // HeizkostenV fällt (unten) und ob eine leere Einheit beim Personenschlüssel Leerstand ist (#177).
  const inhabited = (u: SnapshotUnit) => u.selfUsed && !u.participates
    ? selfPersonsOf(u) > 0
    : tenancies.some((t) => t.unitId === u.id && personDaysInPeriod(t, yFrom, yTo) > 0)
  const isDwelling = (u: SnapshotUnit) => u.areaM2 > 0 || inhabited(u)
  // **Leerstand beim Personenschlüssel (#177).** Eine leere Wohnung hat keine Personentage und fiel
  // deshalb aus der Verteilbasis: Ihr Anteil ging still an die übrigen Mieter, während Fläche und
  // Einheiten ihn beim Vermieter ließen. Den Leerstand trägt der Vermieter (BGH, Urteil vom
  // 31.05.2006, VIII ZR 159/05, dort am Flächenschlüssel entschieden; zum Personenschlüssel die
  // fiktive Person nach BGH VIII ZR 180/12, siehe `VACANCY_PERSONS`). Deshalb zählt jede
  // vermietete Wohnung der Verteilbasis für jeden Tag ohne Mietverhältnis mit
  // `vacancyPersons(u)` Personen; kein Mietverhältnis bekommt diese Tage, ihr Anteil bleibt also
  // als `vacancy` beim Vermieter. Auch der Leerstand zwischen zwei Mietern zählt.
  // Ausgenommen sind die selbstgenutzten Wohnungen (die zählen mit ihren eigenen Personen) und
  // alles, was keine Wohnung ist (`isDwelling`, dieselbe Regel wie bei § 2 HeizkostenV): Eine
  // Einheit ohne Fläche und ohne Bewohner, leer oder mit 0 Personen vermietet (Garage, Stellplatz,
  // #135), bekäme sonst eine fiktive Person, und eine Tiefgarage mit vier leeren Stellplätzen
  // verschöbe dem Vermieter einen großen Teil der Müllabfuhr. Eine ganz leere Einheit mit 0 m² meldet
  // dafür `basis.vacancy-no-area`, denn sie kann auch eine Wohnung mit vergessener Fläche sein. Eine
  // leere Garage **mit** eingetragener Fläche ist nach dieser Regel eine Wohnung und zählt weiter als
  // Leerstand; wer das nicht will, nimmt sie aus der Abrechnungseinheit oder aus den Teilnehmern.
  // Die Zahl je Wohnung kommt aus dieser einen Funktion: Wer später etwa die durchschnittliche
  // Belegung des Hauses ansetzen will, rechnet sie hier aus (ohne die Leerstände selbst).
  const vacancyPersons = (_u: SnapshotUnit): number => VACANCY_PERSONS
  type Vacancy = { unit: SnapshotUnit, days: number, persons: number, personDays: number }
  const vacancies: Vacancy[] = basisUnits.flatMap((u) => {
    if (!u.participates || !isDwelling(u)) return []
    const days = diy - occupiedDays(tenancies.filter((t) => t.unitId === u.id), yFrom, yTo)
    const persons = vacancyPersons(u)
    return days > 0 && persons > 0 ? [{ unit: u, days, persons, personDays: days * persons }] : []
  })
  const vacancyPersonDays = vacancies.reduce((a, v) => a + v.personDays, 0)
  const personsLabel = (n: number) => `${fmtNum(n)} ${n === 1 ? 'Person' : 'Personen'}`
  const daysLabel = (n: number) => `${fmtNum(n)} ${n === 1 ? 'Tag' : 'Tage'}`
  const vacancyText = (vs: Vacancy[]) =>
    vs.map((v) => `${v.unit.name}: ${daysLabel(v.days)} × ${personsLabel(v.persons)} = ${fmtNum(v.personDays)} ${v.personDays === 1 ? 'Personentag' : 'Personentage'}`).join('; ')
  // Personentage der Bewohner, ohne Leerstand: Fehlen sie bei vorhandenen Mietverhältnissen ganz,
  // ist das ein Datenmangel und keine Verteilung an den Leerstand (siehe `item.no-basis`).
  const occupantPersonDays =
    partTenancies.reduce((a, t) => a + personDaysInPeriod(t, yFrom, yTo), 0) + selfPersonDays
  const basisPersonDays = occupantPersonDays + vacancyPersonDays

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

  // **Überschneidende Mietverhältnisse einer Wohnung (#204).** Beide werden wie erfasst gerechnet,
  // jedes mit seinem vollen Tagesanteil; für die gemeinsamen Tage wird die Wohnung also doppelt
  // berechnet. Gemeldet wird jede Überschneidung, die das Abrechnungsjahr berührt, mit dem
  // Mehrbetrag je Lesart (`extra`: ohne die Tage des ersten, ohne die des zweiten; exakt in Cent,
  // gerundet erst für den Text), den die Verteilung unten je Position aufsummiert (`overlapExtra`).
  // Gemeldet und beziffert wird je Paar. Überschneiden sich drei Mietverhältnisse an denselben
  // Tagen, erscheinen drei Paare, und ihre Mehrbeträge können sich teilweise doppelt zählen: Jedes
  // Paar rechnet für sich, als gäbe es das dritte nicht. Der Fall ist selten und jedes Paar für
  // sich ein Fehler; der Betrag je Meldung stimmt für dieses Paar.
  const overlaps = tenancyOverlaps(tenancies).flatMap((o) => {
    const inYear = commonPeriod({ start: o.from, end: o.to }, { start: yFrom, end: yTo })
    // Das Ende ist nie offen, weil das Jahr eines hat; `?? yTo` sagt das nur dem Übersetzer.
    return inYear ? [{ ...o, inYear: { from: inYear.from, to: inYear.to ?? yTo }, extra: { first: 0, second: 0 } }] : []
  })
  // Was eine Position der Wohnung für die doppelt belegten Tage zu viel berechnet. „Zu viel“ heißt:
  // gegenüber derselben Verteilung ohne die Überschneidungstage eines der beiden Mietverhältnisse.
  // Welches Datum falsch ist, weiß nur der Vermieter; beide Lesarten werden gerechnet und beide
  // genannt (Durchsicht V1/V2), denn sie können verschieden sein, und eine kann 0 sein, wenn das
  // Mietverhältnis die Kosten gar nicht trägt (Pauschale). Gerechnet wird mit den exakten Anteilen der
  // Zeilen (`raw`), nur was einem Mieter wirklich zugebucht wird, zählt:
  // - Bei allen Schlüsseln, deren Verteilbasis nicht von den Mietverhältnissen abhängt (Fläche,
  //   Einheiten, Direktzuordnung, vereinbarte Anteile, Gemeinschaft, Verbrauch), wäre ohne die Tage
  //   nur dieser eine Anteil kleiner: um den Teil, der auf die Überschneidung entfällt, nach Tagen
  //   oder beim Verbrauch nach dem in dieser Zeit gemessenen Verbrauch.
  // - Beim Personenschlüssel stecken die Personentage auch in der Verteilbasis; ohne sie würde neu
  //   geteilt. Der Unterschied ist der Anteil der Wohnung vorher (S/P) gegen nachher
  //   ((S − o)/(P − o)), mit S den zugebuchten Personentagen der Wohnung, P der Verteilbasis und o
  //   den Personentagen des einen Mietverhältnisses in der Überschneidung.
  // - Einzelbeträge teilt der Messdienst selbst auf; dort entsteht nichts doppelt.
  // Ein Betrag gegen die Richtung der Position (wenn ohne die Tage die Mieter mehr trügen, etwa beim
  // Personenschlüssel neben einer Pauschale) wird zu null: Zu viel tragen sie dann nicht. Bei einer
  // Gutschrift ist der Betrag negativ, die Mieter bekommen dann zu viel gutgeschrieben.
  type OverlapPeriod = (typeof overlaps)[number]
  const overlapExtra = (
    item: SnapshotCostItem, b: { basisPersonDays: number }, targets: Target[], booked: boolean[], o: OverlapPeriod,
  ): { first: number, second: number } => {
    if (item.key === 'amounts' || targets.length === 0) return { first: 0, second: 0 }
    const { from, to } = o.inYear
    const reading = (t: TenancyWithUnit): number => {
      const i = targets.findIndex((x) => x.t.id === t.id)
      const x = targets[i]
      if (!x) return 0
      if (item.key === 'persons') {
        const p = b.basisPersonDays
        const doubled = personDaysInPeriod(t, from, to)
        if (!(doubled > 0) || !(p - doubled > 0)) return 0
        const s = targets.reduce((a, y, k) => a + (booked[k] && y.t.unitId === t.unitId ? personDaysInPeriod(y.t, yFrom, yTo) : 0), 0)
        return item.amountCents * (s / p - (s - (booked[i] ? doubled : 0)) / (p - doubled))
      }
      if (!booked[i]) return 0
      if (item.key === 'meter') {
        const meters = allMeters.filter((m) => m.unitId === t.unitId && m.type === item.meterType)
        const pFrom = t.start > yFrom ? t.start : yFrom
        const pTo = t.end && t.end < yTo ? t.end : yTo
        const all = meters.reduce((a, m) => a + consumptionInPeriod(readingsOf(m.id), pFrom, pTo), 0)
        const part = meters.reduce((a, m) => a + consumptionInPeriod(readingsOf(m.id), from, to), 0)
        return all > 0 ? x.raw * Math.min(1, Math.max(0, part / all)) : 0
      }
      return t.days > 0 ? x.raw * (rangeOverlapDays(from, to, from, to) / t.days) : 0
    }
    const sign = item.amountCents < 0 ? -1 : 1
    const towards = (v: number) => sign * Math.max(0, v * sign)
    return { first: towards(reading(o.first)), second: towards(reading(o.second)) }
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
  const usesKey = (key: CostKey) => items.some((c) => c.key === key && !isNotAllocable(c.category))
  // Nimmt die Wohnung an einer Position dieses Schlüssels teil (#105)? Die Warnungen unten nennen
  // nur solche Wohnungen; eine Garage ohne Fläche, die an keiner Flächenposition teilnimmt, fehlt
  // in keiner Verteilung.
  const inKeyBasis = (unitId: string, key: CostKey) =>
    items.some((c) => c.key === key && !isNotAllocable(c.category) && (!c.participantUnitIds || c.participantUnitIds.includes(unitId)))
  // Fehlt die Basis ganz, geht jede Position des Schlüssels an den Vermieter — das meldet die
  // Position selbst. Die Meldungen je Wohnung wären dann widersprüchlich („verteilt nur auf
  // die Mieter", obwohl nichts verteilt wird) und entfallen. Ohne Mietverhältnis im Jahr
  // fehlen Personentage regulär (Leerstand) — das ist kein Datenmangel.
  const areaBasisMissing = !(basisArea > 0)
  const personsBasisMissing = !(occupantPersonDays > 0) && partTenancies.length > 0
  const selfNoPersons = selfUnits.filter((u) => selfPersonsOf(u) === 0 && inKeyBasis(u.id, 'persons'))
  if (selfNoPersons.length > 0 && usesKey('persons') && !personsBasisMissing) {
    warn('basis.self-no-persons',
      `Für die ${plural(selfNoPersons.length, 'selbstgenutzte Wohnung', 'selbstgenutzten Wohnungen')} ${andList(selfNoPersons.map((u) => u.name))} ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt nur auf die Mieter.`,
      unitSubject(selfNoPersons),
    )
  }
  const selfNoArea = selfUnits.filter((u) => !(u.areaM2 > 0) && inKeyBasis(u.id, 'area'))
  if (selfNoArea.length > 0 && usesKey('area') && !areaBasisMissing) {
    warn('basis.self-no-area',
      `Für die ${plural(selfNoArea.length, 'selbstgenutzte Wohnung', 'selbstgenutzten Wohnungen')} ${andList(selfNoArea.map((u) => u.name))} ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt nur auf die Mieter.`,
      unitSubject(selfNoArea),
    )
  }
  // Dasselbe bei den übrigen Wohnungen der Abrechnungseinheit, vermietet oder leer: Ohne
  // Basiswert verteilt der Schlüssel ihren Anteil auf die anderen, bei einer vermieteten Wohnung
  // zahlen dann die übrigen Mieter mit.
  // **Seit #135 kann 0 eine Angabe sein**: Das Formular lässt 0 m² und 0 Personen für Garage,
  // Stellplatz oder Lager ausdrücklich zu. In der Datenbank ist eine vergessene Fläche aber
  // ebenfalls 0 (Pflichtfeld, und der Umstieg macht aus einer fehlenden Fläche 0 m²). Unterschieden
  // wird deshalb am Gegenstück (`isGarageLike`): Hat eine Einheit weder Fläche noch Bewohner im
  // Jahr, ist sie Garage-artig, und beide Nullen sind ein Hinweis (`basis.unit-zero`,
  // `basis.tenancy-zero`). Wohnt dort jemand, ist 0 m² eine vergessene Fläche; hat sie Fläche, sind
  // 0 Personen eine vergessene Personenzahl. Beides bleibt eine Warnung wie vor #135.
  const positionsOf = (key: CostKey, unitIds: string[]) => {
    const names = [...new Set(items
      .filter((c) => c.key === key && !isNotAllocable(c.category) && (!c.participantUnitIds || unitIds.some((id) => c.participantUnitIds?.includes(id))))
      .map((c) => `„${c.description}“`))]
    return andList(names)
  }
  const partNoArea = snapshot.units.filter((u) => u.participates && !(u.areaM2 > 0) && inKeyBasis(u.id, 'area'))
  if (partNoArea.length > 0 && usesKey('area') && !areaBasisMissing) {
    const forgotten = partNoArea.filter((u) => !isGarageLike(u))
    const zero = partNoArea.filter((u) => isGarageLike(u))
    if (forgotten.length > 0) {
      warn('basis.unit-no-area',
        `Für die ${plural(forgotten.length, 'Einheit', 'Einheiten')} ${andList(forgotten.map((u) => u.name))} ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.`,
        unitSubject(forgotten),
      )
    }
    if (zero.length > 0) {
      warn('basis.unit-zero',
        `Für ${andList(zero.map((u) => u.name))} sind 0 m² und 0 Personen eingetragen; bei ${positionsOf('area', zero.map((u) => u.id))} ${zero.length === 1 ? 'trägt sie' : 'tragen sie'} nichts, ihr Anteil verteilt sich auf die übrigen Wohnungen. ` +
          'Ist das nicht gewollt (keine Garage, kein Stellplatz, kein Lager), tragen Sie die Wohnfläche ein.',
        unitSubject(zero),
      )
    }
  }
  const partNoPersons = partTenancies.filter((t) => !(personDaysInPeriod(t, yFrom, yTo) > 0) && inKeyBasis(t.unitId, 'persons'))
  if (partNoPersons.length > 0 && usesKey('persons') && !personsBasisMissing) {
    const forgotten = partNoPersons.filter((t) => t.unit.areaM2 > 0)
    const zero = partNoPersons.filter((t) => !(t.unit.areaM2 > 0))
    if (forgotten.length > 0) {
      warn('basis.tenancy-no-persons',
        `Für ${andList(forgotten.map((t) => `${t.tenantName} (${t.unit.name})`))} ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt deren Anteil auf die übrigen Wohnungen.`,
        tenancySubject(forgotten),
      )
    }
    if (zero.length > 0) {
      warn('basis.tenancy-zero',
        `Für ${andList(zero.map((t) => `${t.tenantName} (${t.unit.name})`))} sind 0 Personen und 0 m² eingetragen; bei ${positionsOf('persons', zero.map((t) => t.unitId))} ${zero.length === 1 ? 'trägt das Mietverhältnis nichts, sein' : 'tragen die Mietverhältnisse nichts, ihr'} Anteil verteilt sich auf die übrigen. ` +
          'Ist das nicht gewollt (keine Garage, kein Stellplatz, kein Lager), tragen Sie die Personenzahl ein.',
        tenancySubject(zero),
      )
    }
  }

  // Leerstand beim Personenschlüssel (#177): einmal je Abrechnung, mit den Positionen, in deren
  // Verteilbasis eine leere Wohnung zählt. Positionen ohne Verteilbasis melden sich selbst. Ohne
  // ein Mietverhältnis unter den Teilnehmern geht die Position ohnehin ganz an den Vermieter, wie
  // bei Fläche und Einheiten; dann gibt es nichts zu erklären.
  {
    const takes = (c: SnapshotCostItem, unitId: string) => !c.participantUnitIds || c.participantUnitIds.includes(unitId)
    const affected = items.filter((c) => c.key === 'persons' && !isNotAllocable(c.category) &&
      vacancies.some((v) => takes(c, v.unit.id)) && partTenancies.some((t) => takes(c, t.unitId)))
    const units = vacancies.filter((v) => affected.some((c) => takes(c, v.unit.id)))
    if (affected.length > 0 && !personsBasisMissing) {
      const persons = [...new Set(units.map((v) => v.persons))]
      warn('basis.vacancy-persons',
        `Bei ${andList(affected.map((c) => `„${c.description}“`))} (nach Personen) ${units.length === 1 ? 'stand' : 'standen'} ${andList(units.map((v) => `${v.unit.name} (${daysLabel(v.days)})`))} leer. ` +
          'An den Kosten leerstehender Wohnungen ist der Vermieter zu beteiligen; sie gehen nicht still an die übrigen Mieter (Grundsatz nach BGH, Urteil vom 31.05.2006, VIII ZR 159/05, dort zum Flächenschlüssel). ' +
          'Wie das beim Personenschlüssel geschieht, regelt kein Gesetz, und es ist nicht abschließend geklärt: Nach BGH, Beschluss vom 08.01.2013, VIII ZR 180/12, kommt es auf den Einzelfall an, und es kann in Betracht kommen, für die Zeit des Leerstands eine fiktive Person anzusetzen. ' +
          `Mietfuchs setzt jeden Tag ohne Mietverhältnis mit ${persons.length === 1 ? personsLabel(persons[0] ?? 0) : 'der angegebenen Personenzahl'} an; das ist eine Auslegung von Mietfuchs. Der Anteil steht in Ihrem Vermieteranteil als Leerstand. ` +
          'Bei Kosten, die von der Personenzahl abhängen (etwa Wasser nach Personen), kann eine andere Aufteilung angemessener sein, zum Beispiel in Grund- und Verbrauchskosten.',
        // Bewusst ohne Eintrag: Eine Auskunft, an der Wohnung ist nichts zu beheben, und ein „Hier
        // beheben →“ darunter legte nahe, es sei etwas falsch (Endprüfung rc.4).
      )
    }
    // Ganz leer und ohne Fläche: keine Wohnung, also kein Leerstand (siehe `isDwelling`). Ob das
    // stimmt, weiß nur der Vermieter; eine Wohnung mit vergessener Fläche sähe genauso aus.
    const noArea = basisUnits.filter((u) => u.participates && !isDwelling(u) &&
      !tenancies.some((t) => t.unitId === u.id) &&
      items.some((c) => c.key === 'persons' && !isNotAllocable(c.category) && takes(c, u.id) && partTenancies.some((t) => takes(c, t.unitId))))
    if (noArea.length > 0 && !personsBasisMissing) {
      const names = andList(noArea.map((u) => u.name))
      warn('basis.vacancy-no-area', noArea.length === 1
        ? `${names} hat 0 m² und keine Bewohner und wird beim Personenschlüssel nicht als Leerstand angesetzt. Ist ${names} eine Wohnung, tragen Sie die Wohnfläche ein.`
        : `${names} haben 0 m² und keine Bewohner und werden beim Personenschlüssel nicht als Leerstand angesetzt. Ist eine davon eine Wohnung, tragen Sie dort die Wohnfläche ein.`,
      unitSubject(noArea))
    }
  }

  // Die Verteilbasis einer Position (#94). **Ohne Teilnehmer ist sie genau die bisherige**, und
  // zwar dasselbe Objekt, einmal berechnet: So kann die Umstellung keine Zahl verschieben, und
  // die Golden-Tests bleiben der Beweis dafür. Mit Teilnehmern besteht sie nur aus ihnen, bei
  // vermieteten wie bei selbstgenutzten Wohnungen, und beim Verbrauch zählen nur ihre Zähler.
  // Für den Vergleich mit dem Vorjahr (#141): die Wohnungen der Abrechnungseinheit heute.
  const basisUnitIds = basisUnits.map((u) => u.id)
  const fullBasis = { basisUnits, selfUnits, basisArea, selfArea, partTenancies, basisPersonDays, occupantPersonDays, selfPersonDays, vacancies, vacancyPersonDays, consumptionByType }
  const basisOf = (item: SnapshotCostItem): typeof fullBasis => {
    if (!item.participantUnitIds) return fullBasis
    const only = new Set(item.participantUnitIds)
    const bUnits = basisUnits.filter((u) => only.has(u.id))
    const sUnits = selfUnits.filter((u) => only.has(u.id))
    const pTenancies = partTenancies.filter((t) => only.has(t.unitId))
    const sPersonDays = sUnits.reduce((a, u) => a + selfPersonsOf(u) * diy, 0)
    const vs = vacancies.filter((v) => only.has(v.unit.id))
    const vPersonDays = vs.reduce((a, v) => a + v.personDays, 0)
    const oPersonDays = pTenancies.reduce((a, t) => a + personDaysInPeriod(t, yFrom, yTo), 0) + sPersonDays
    return {
      basisUnits: bUnits,
      selfUnits: sUnits,
      basisArea: bUnits.reduce((a, u) => a + (u.areaM2 || 0), 0),
      selfArea: sUnits.reduce((a, u) => a + (u.areaM2 || 0), 0),
      partTenancies: pTenancies,
      basisPersonDays: oPersonDays + vPersonDays,
      occupantPersonDays: oPersonDays,
      selfPersonDays: sPersonDays,
      vacancies: vs,
      vacancyPersonDays: vPersonDays,
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
  // Die Warnungen nennen den Betrag, der trotzdem bei den Mietern gelandet ist (#142, Zielbild
  // aus #91). Den kennt erst die Verteilung; geschrieben werden sie deshalb danach, aber an dieser
  // Stelle der Hinweise, damit ihre Reihenfolge bleibt.
  const tvAt = notices.length
  const tenantCentsOf = new Map<string, number>()
  const tvNotices = () => items.filter((c) => c.category === 'Kabel/Antenne').flatMap((item): Notice[] => {
    const cents = tenantCentsOf.get(item.id) ?? 0
    // Nur ein wirklich umgelegter Betrag; eine Gutschrift hat den Mietern nichts aufgebürdet.
    const charged = cents > 0 ? ` Auf die Mieter umgelegt sind in dieser Abrechnung ${fmtCents(cents)}.` : ''
    if (newSystem) {
      return [makeNotice('tv-signal.new-system', `„${item.description}“: Die Kabel- oder Antennenanlage wurde ab dem 01.12.2021 errichtet; für sie waren die Gebühren für das TV-Signal nie umlagefähig, auch Betriebsstrom und Wartung nicht (§ 2 Satz 2 BetrKV).${charged} Umlagefähig sind allenfalls Betriebsstrom und Bereitstellungsentgelt einer reinen Glasfaser-Verteilanlage, bei der der Mieter seinen Anbieter frei wählen kann (§ 2 Nr. 15 Buchst. c BetrKV); buchen Sie den Rest bitte als „Nicht umlagefähig“.${year === 2021 ? ' Für 2021 gilt das für die Kosten ab der Errichtung; was davor auf eine ältere Anlage entfiel, war umlagefähig.' : ''}`, itemSubject(item))]
    } else if (tvSignal === 'partial') {
      return [makeNotice('tv-signal.partial-year', `„${item.description}“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind nur bis zum 30.06.2024 umlagefähig, danach nicht mehr (Wegfall des Nebenkostenprivilegs). Umlegen dürfen Sie für 2024 höchstens das erste Halbjahr, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde; danach nur noch den Betriebsstrom (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft). Bitte teilen Sie die Position entsprechend auf und buchen Sie den Rest als „Nicht umlagefähig“.`, itemSubject(item))]
    } else if (tvSignal === 'none') {
      return [makeNotice('tv-signal.ended', `„${item.description}“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind seit dem 01.07.2024 nicht mehr umlagefähig (Wegfall des Nebenkostenprivilegs).${charged} Umlegen dürfen Sie nur noch den Betriebsstrom, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft); buchen Sie das TV-Signal bitte als „Nicht umlagefähig“.`, itemSubject(item))]
    }
    return []
  })

  // § 2 HeizkostenV (#93, #140), siehe shared/heating.ts: Im Gebäude mit höchstens zwei Wohnungen,
  // von denen der Vermieter eine selbst bewohnt, darf anderes vereinbart werden. Eine Garage oder
  // ein Stellplatz ist keine Wohnung.
  // Wohnung im Sinne des § 2 ist, was Fläche hat oder bewohnt ist. Eine Einheit ohne Fläche und
  // ohne Bewohner (Garage, Stellplatz, auch leer oder außerhalb der Abrechnungseinheit) zählt nicht;
  // eine bewohnte mit vergessener Fläche zählt (letzte Durchsicht). Bewusst anders als bei
  // `basis.unit-no-area`: Dort warnt auch ein Leerstand mit 0 m², weil Geld wandern kann; hier geht
  // es nur darum, ob das Gebäude mehr als zwei Wohnungen hat.
  const heatingAgreeable = mayAgreeOtherwise(snapshot.units, isDwelling)
  // Heizpositionen ohne Verbrauchsanteil (#140): Die Kürzungsbeträge entstehen in der Verteilung,
  // gemeldet wird erst danach, denn ob eine Wohnung nach Verbrauch gedeckt ist, steht erst fest,
  // wenn alle Positionen verteilt sind (siehe shared/heating.ts).
  const heatingCuts: { item: SnapshotCostItem, rows: { unitId: string, text: string }[] }[] = []
  const heatingCovered = new Set<string>()
  // Die erste Heizposition, über die ein Mieter abgerechnet wird; an ihr hängt der Hinweis zur
  // Fernablesbarkeit (heating-remote-reading), einmal je Abrechnung.
  let heatingBilledItem: SnapshotCostItem | undefined
  // Eine Einheit ohne Wärmeanschluss (#117) oder eine Garage-artige (0 m², niemand wohnt dort) ist
  // bei Heizung und Warmwasser keine beteiligte Wohnung: keine Warnung zur Warmmiete, kein
  // Kürzungsbetrag (zweite Browserabnahme). Verteilt wird weiter wie erfasst.
  const outsideHeating = (u: SnapshotUnit) => isGarageLike(u) || (u.noConnection ?? []).includes('waerme')

  // Zwei Positionen derselben Kostenart, eine ohne Beleg: oft die Übernahme aus dem Vorjahr und
  // dieselbe Rechnung noch einmal aus dem Beleg. Nur ein Hinweis, verteilt wird wie erfasst. Der Rat
  // lautet „löschen“ und nicht „Beleg zuordnen“: Zugeordnet verstummt der Hinweis (er verlangt eine
  // Position ohne Beleg), die Summe bliebe aber doppelt (Integrationsdurchsicht M1).
  for (const group of possibleDuplicates(items, year, snapshot.previousCostItems ?? [])) {
    const first = group.find((i) => !i.invoiceFile) ?? group[0]
    if (!first) continue
    const list = group.map((i) => `„${i.description}“ (${fmtCents(i.amountCents)}${i.invoiceFile ? '' : ', ohne Beleg'})`)
    const named = andList(list)
    warn('cost.possible-duplicate',
      `${named} stehen ${list.length === 2 ? `beide ${year}` : `${year} alle`} unter „${first.category}“. ${list.length === 2 ? 'Ist das dieselbe Rechnung' : 'Ist darunter dieselbe Rechnung zweimal'}, etwa einmal aus dem Vorjahr übernommen und einmal aus dem Beleg erfasst, wird sie zweimal verteilt. ` +
      (list.length === 2
        ? 'Dann bitte eine der beiden Positionen löschen, in der Regel die ohne Beleg. Soll die ohne Beleg bleiben, setzen Sie ihren Betrag auf den der Rechnung und löschen die andere. '
        : 'Dann bitte die doppelt erfasste Position löschen, in der Regel die ohne Beleg. ') +
      'Nur den Beleg zuzuordnen genügt nicht: Die Rechnung stünde weiter zweimal in der Summe. Sind es verschiedene Rechnungen, ist nichts zu tun.',
      itemSubject(first))
  }

  for (const item of items) {
    const b = basisOf(item)
    const bookable = (t: SnapshotTenancy) => statements.has(t.id) && modelFor(t, item) === 'settlement'
    totalCostsCents += item.amountCents
    // Anders als im Vorjahr (#141)? Nur ein Hinweis, verteilt wird wie erfasst.
    const keyChange = keyChangeText(item, snapshot.previousCostItems ?? [], year, basisUnitIds)
    if (keyChange) warn('key.changed-from-previous-year', keyChange, itemSubject(item))
    // Rohanteile (float, in Cent) pro Mietverhältnis bestimmen.
    // Nicht umlagefähige Kosten gehen immer vollständig an den Vermieter.
    const targets: Target[] = []
    // Anteil, der auf selbstgenutzte Wohnungen entfällt (Teil des Vermieteranteils) — für
    // die Steuerübersicht separat ausgewiesen, weil er privat und damit nicht abziehbar ist.
    let selfRaw = 0
    // Für die Zerlegung des Vermieteranteils (#142): Geht die Position ganz an den Vermieter, steht
    // hier der eine Grund dafür. Sonst ergibt sich die Zerlegung erst aus der Verteilung.
    let forced: LandlordReason | null = isNotAllocable(item.category) ? 'notAllocable' : null
    // Bei vereinbarten Anteilen, was unter 100 % fehlt; was auf Wohnungen außerhalb der
    // Abrechnungseinheit entfällt (verfallene Anteile, Zähler solcher Wohnungen); beim Hauptzähler
    // der Verbrauch, den kein Wohnungszähler misst.
    let customUnassignedRaw = 0
    let outsideRaw = 0
    let mainRestRaw = 0
    const noBasis = (reason: string) => {
      forced = 'noBasis'
      warn('item.no-basis', `„${item.description}“: ${reason} — Betrag geht an den Vermieter.`, itemSubject(item))
    }
    // Tage im Rechenweg, nur bei einem Teiljahr.
    const partOfYear = (t: TenancyWithUnit) => (t.days < diy ? ` · ${t.days}/${diy} Tage` : '')
    // Teilnehmer wirken bei den Schlüsseln, deren Basis aus Wohnungen entsteht (#94).
    const withParticipants = ['area', 'units', 'persons', 'meter', 'external', 'amounts'].includes(item.key)
    if (isNotAllocable(item.category)) {
      // keine Verteilung
    } else if (withParticipants && item.participantUnitIds && item.participantUnitIds.length === 0) {
      noBasis('keine Wohnung nimmt teil')
    } else if (item.key === 'area' && !(b.basisArea > 0)) {
      noBasis(b === fullBasis ? 'für keine Wohnung ist eine Wohnfläche hinterlegt' : 'für keine teilnehmende Wohnung ist eine Wohnfläche hinterlegt')
    } else if (item.key === 'units' && b.basisUnits.length === 0) {
      noBasis(b === fullBasis ? 'keine Wohnung gehört zur Abrechnungseinheit' : 'keine teilnehmende Wohnung gehört zur Abrechnungseinheit')
    } else if (item.key === 'persons' && !(b.occupantPersonDays > 0) && b.partTenancies.length > 0) {
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
        // Der Leerstand steht im gedruckten Text dabei, sonst ginge die Summe der Personentage für
        // den Mieter nicht auf (#177).
        const vacancyNote = b.vacancyPersonDays > 0 ? ` (davon ${fmtNum(b.vacancyPersonDays)} Leerstand)` : ''
        targets.push({ t, raw, basisText: `${fmtNum(pd)} von ${fmtNum(b.basisPersonDays)} Personentagen${vacancyNote}` })
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
          // Eine Garage-artige Einheit ohne Fläche (#135) fehlt beim Maßstab Fläche nicht, sie hat
          // bewusst keine; bei Miteigentumsanteilen bleibt jede fehlende Angabe eine Lücke.
          const missing = b.basisUnits.filter((u) => valueOf(u) === 0 && !(eb.measure === 'area' && isGarageLike(u)))
          if (missing.length > 0) {
            warn('external.value-missing', `„${item.description}“: für ${andList(missing.map((u) => u.name))} ${eb.measure === 'mea' ? 'sind keine Miteigentumsanteile' : 'ist keine Wohnfläche'} hinterlegt — ihr Anteil verteilt sich auf die übrigen Wohnungen.`, unitSubject(missing))
          }
          // Ein Tippfehler in der Gesamtsumme soll auffallen, aber keine Zahl verschieben:
          // Gezahlt ist der eingetragene Betrag, und der wird verteilt.
          const expected = Math.round((eb.totalCents * own) / eb.total)
          if (Math.abs(expected - item.amountCents) > 100) {
            warn('external.amount-mismatch', `„${item.description}“: der Betrag ${fmtCents(item.amountCents)} passt nicht zum rechnerischen Anteil ${fmtCents(expected)} (${fmtNum(own)} von ${fmtNum(eb.total)} ${MEASURE_LABELS[eb.measure]} aus ${fmtCents(eb.totalCents)}) — bitte die Angaben aus der Gemeinschaftsabrechnung prüfen. Verteilt wird der eingetragene Betrag.`, itemSubject(item))
          }
          // „Kosten der Gemeinschaft“ und nicht „Gesamtkosten der Anlage“ (#144): Die Spalte
          // Gesamtkosten zeigt hier den Anteil des Vermieters, und zweimal „Gesamtkosten“ mit zwei
          // Zahlen war doppeldeutig. Weicht der Betrag ab, steht das auch im Druck; der Rechenweg
          // erscheint dort nicht, und der Mieter sähe sonst eine Rechnung, die nicht aufgeht.
          const applied = Math.abs(expected - item.amountCents) > 100 ? ' · angesetzt laut Hausgeldabrechnung' : ''
          const suffix = ` · Kosten der Gemeinschaft ${fmtCents(eb.totalCents)}${applied}`
          const label = MEASURE_LABELS[eb.measure]
          for (const t of b.partTenancies) {
            const raw = item.amountCents * (valueOf(t.unit) / own) * (t.days / diy)
            targets.push({
              t, raw,
              basisText: `${fmtNum(valueOf(t.unit))} von ${fmtNum(eb.total)} ${label}${suffix}${partOfYear(t)}`,
              community: {
                costsCents: eb.totalCents,
                share: `${fmtNum(own)} von ${fmtNum(eb.total)} ${label} × ${fmtCents(eb.totalCents)} = ${fmtCents(expected)}`,
                term: eb.measure === 'mea' ? 'mea' : 'distributionBasis',
                appliedCents: expected !== item.amountCents ? item.amountCents : null,
                ownShare: valueOf(t.unit) !== own ? `${fmtNum(valueOf(t.unit))} von ${fmtNum(own)} ${label}` : null,
              },
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
        forced = 'noBasis'
        warn('amounts.exceed', `„${item.description}“: die Einzelbeträge ergeben zusammen ${fmtCents(sum)} und übersteigen den Rechnungsbetrag ${fmtCents(item.amountCents)} — es wird nichts verteilt, der Betrag geht an den Vermieter.`, itemSubject(item))
      } else {
        const inYear = new Map(b.partTenancies.map((t) => [t.id, t]))
        const forfeited = Object.entries(given).filter(([id, c]) => c > 0 && !inYear.has(id))
        if (forfeited.length > 0) {
          const betrag = forfeited.reduce((a, [, c]) => a + c, 0)
          warn('amounts.forfeited', `„${item.description}“: ${forfeited.length === 1 ? 'ein Einzelbetrag' : `${forfeited.length} Einzelbeträge`} über ${fmtCents(betrag)} gehör${forfeited.length === 1 ? 't' : 'en'} zu keinem Mietverhältnis dieses Jahres in der Abrechnungseinheit und entfall${forfeited.length === 1 ? 't' : 'en'} — dieser Teil geht an den Vermieter.`, itemSubject(item))
        }
        // Nur wer die Position wirklich trägt; bei Pauschale fehlt nichts (Befund der Durchsicht).
        const without = b.partTenancies.filter((t) => !Object.hasOwn(given, t.id) && bookable(t))
        if (without.length > 0) {
          warn('amounts.missing', `„${item.description}“: für ${andList(without.map((t) => `${t.tenantName} (${t.unit.name})`))} ist kein Einzelbetrag eingetragen — bitte prüfen, sonst tragen sie diese Position nicht.`, itemSubject(item))
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
          warn('amounts.self-forfeited', `„${item.description}“: ein Eigenbetrag ist für ${andList(selfNotSelfUsed.map(([id]) => nameOf(id)))} eingetragen, die in diesem Jahr nicht selbstgenutzt ist — er zählt nicht als Eigenanteil und bleibt beim Vermieter.`, itemSubject(item))
        }
        if (selfOutsideParticipants.length > 0) {
          warn('amounts.self-forfeited', `„${item.description}“: ein Eigenbetrag ist für ${andList(selfOutsideParticipants.map(([id]) => nameOf(id)))} eingetragen, die an dieser Position nicht teilnimmt — er zählt nicht als Eigenanteil und bleibt beim Vermieter. Nehmen Sie die Wohnung als Teilnehmerin auf, wenn die Position sie betrifft.`, itemSubject(item))
        }
        selfRaw = selfSum
        const selfWithout = b.selfUnits.filter((u) => !Object.hasOwn(selfGiven, u.id))
        if (selfWithout.length > 0) {
          warn('amounts.self-hidden', `„${item.description}“: der Anteil der ${plural(selfWithout.length, 'selbstgenutzten Wohnung', 'selbstgenutzten Wohnungen')} ${andList(selfWithout.map((u) => u.name))} ist bei Einzelbeträgen nicht eingetragen — er steckt im Vermieteranteil, und die Steuerübersicht nennt den privaten Anteil entsprechend zu niedrig.`, itemSubject(item))
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
      // auf „nicht beteiligt“ gestellt. Sonst würde der Betrag unbemerkt kleiner verteilt,
      // als vereinbart ist.
      const forfeited = Object.keys(item.customShares ?? {})
        .filter((id) => pctOf(id) > 0 && !basisUnits.some((u) => u.id === id))
        .map((id) => unitById.get(id)?.name ?? 'gelöschte Wohnung')
      if (forfeited.length > 0) {
        warn('custom.forfeited', `„${item.description}“: der vereinbarte Anteil für ${andList(forfeited)} entfällt — die Wohnung gehört nicht zur Abrechnungseinheit. Dieser Teil geht an den Vermieter.`, itemSubject(item))
      }
      if (pctSum <= 0) {
        forced = 'noBasis'
        warn('custom.none', `„${item.description}“: keine vereinbarten Anteile hinterlegt — Betrag geht an den Vermieter.`, itemSubject(item))
      } else if (pctSum > 100.0001) {
        // Nicht verteilen: mehr als die Rechnung hergibt wäre auch beim §35a-Anteil zu hoch.
        forced = 'noBasis'
        warn('custom.over-100', `„${item.description}“: die vereinbarten Anteile ergeben ${fmtNum(Math.round(pctSum * 100) / 100)} % — über 100 % wird nicht verteilt, der Betrag geht an den Vermieter.`, itemSubject(item))
      } else {
        for (const t of partTenancies) {
          const pct = pctOf(t.unitId)
          if (pct <= 0) continue
          const raw = item.amountCents * (pct / 100) * (t.days / diy)
          targets.push({ t, raw, basisText: `${fmtNum(pct)} % vereinbart${t.days < diy ? ` · ${t.days}/${diy} Tage` : ''}` })
        }
        selfRaw = selfUnits.reduce((a, u) => a + item.amountCents * (pctOf(u.id) / 100), 0)
        // Ein Anteil für eine Wohnung, die es gibt, die aber außerhalb liegt, ist dort vereinbart
        // und verfällt; einer für eine gelöschte Wohnung zählt zum Nicht-Vereinbarten (so steht er
        // auch nach dem Geraderücken da, das ihn streicht).
        const outsidePct = Object.keys(item.customShares ?? {})
          .filter((id) => pctOf(id) > 0 && unitById.has(id) && !basisUnits.some((u) => u.id === id))
          .reduce((a, id) => a + pctOf(id), 0)
        // Über 100 % zusammen mit den Wohnungen innerhalb verfällt nur, was bis 100 % fehlt; mehr
        // als den Betrag kann der Vermieter nicht tragen (#202, vorher an der Zerlegung begrenzt).
        const outsideCapped = Math.min(outsidePct, Math.max(0, 100 - pctSum))
        outsideRaw = item.amountCents * (outsideCapped / 100)
        customUnassignedRaw = item.amountCents * (Math.max(0, 100 - pctSum - outsideCapped) / 100)
      }
    } else if (item.key === 'meter') {
      // `item.meterType` ist optional (string | null | undefined); die Indizierung selbst
      // verhält sich für null/undefined wie für einen unbekannten Zählertyp (kein Treffer,
      // `data` bleibt undefined), deshalb hier nur eine Typ-Zusicherung, keine neue Prüfung.
      const data = b.consumptionByType[item.meterType as MeterType]
      if (!data || data.basis <= 0) {
        forced = 'noBasis'
        warn('meter.no-consumption', `„${item.description}“: kein Verbrauch für Zählertyp „${meterTypeLabel(item.meterType)}“ erfasst — Betrag geht an den Vermieter.`, itemSubject(item))
      } else {
        const type = item.meterType ?? '—'
        // Für die Zerlegung des Vermieteranteils (#142): Verbrauch der Zähler von Wohnungen
        // außerhalb der Abrechnungseinheit, und beim Hauptzähler, was keine Wohnung misst.
        const inBasis = new Set(b.basisUnits.map((u) => u.id))
        const yearOf = (m: SnapshotMeter) => consumptionInPeriod(readingsOf(m.id), yFrom, yTo)
        const measured = data.meters.reduce((a, m) => a + yearOf(m), 0)
        outsideRaw = item.amountCents * (data.meters.filter((m) => !inBasis.has(m.unitId)).reduce((a, m) => a + yearOf(m), 0) / data.basis)
        if (data.main !== null) mainRestRaw = item.amountCents * ((data.basis - measured) / data.basis)
        if (data.mainPartial) {
          warn('meter.main-partial', `„${item.description}“: der Hauptzähler deckt ${year} nur ${data.mainPartial.days} von ${diy} Tagen ab — bitte Ablesungen zum 31.12.${year - 1} und zum Jahresende (31.12.${year}) nachtragen. Bis dahin wird nach den Wohnungszählern verteilt.`, { kind: 'meter', id: data.mainPartial.meterId })
        }
        if (data.mainBelowUnits) {
          warn('meter.sub-exceeds-main', `„${item.description}“: die Wohnungszähler zeigen zusammen ${fmtMeter(data.mainBelowUnits.units)}, mehr als der Hauptzähler (${fmtMeter(data.mainBelowUnits.main)}) — bitte die Ablesungen prüfen. Verteilt wird nach den Wohnungszählern.`, itemSubject(item))
        }
        if (data.mainGap) {
          warn('meter.main-gap', `„${item.description}“: die Wohnungszähler erfassen zusammen nur ${fmtMeter(data.mainGap.units)} von ${fmtMeter(data.mainGap.main)} des Hauptzählers. Gehört der Rest zu einer Wohnung, die nicht angelegt ist (etwa Ihrer eigenen), legen Sie sie unter Stammdaten an; dann gilt für sie der Rest des Hauptzählers. Verteilt wird nach den Wohnungszählern.`, itemSubject(item))
        }
        if (data.main !== null && data.partial.length > 0) {
          warn('meter.unit-partial', `„${item.description}“: der Zähler von ${andList(data.partial.map((p) => `${p.unit.name} (${p.covered} von ${p.needed} Tagen)`))} deckt nicht die ganze Zeit ab, in der dort gewohnt wurde — der Verbrauch der Lücke steckt im Rest des Hauptzählers, der deshalb beim Vermieter bleibt und nicht als Eigenanteil gilt. Bitte die fehlenden Ablesungen nachtragen.`, unitSubject(data.partial.map((p) => p.unit)))
        }
        // Fehlt der Zähler nur bei selbstgenutzten Wohnungen, gibt es nichts zu melden; bleibt der
        // Rest wegen einer Lücke trotzdem beim Vermieter, sagt das die Meldung davor.
        const onlySelfUnmetered = data.main !== null && data.unmetered.every((u) => b.selfUnits.includes(u))
        if (data.unmetered.length > 0 && !onlySelfUnmetered) {
          const names = andList(data.unmetered.map((u) => u.name))
          // Eine Garage oder ein Stellplatz hat oft keinen Anschluss; dann nennt die Meldung den
          // Ausweg, die Kennzeichnung an der Einheit (#117).
          const noConnection = ' Hat eine dieser Einheiten keinen eigenen Anschluss (etwa eine Garage), entfernen Sie in den Stammdaten der Einheit unter „Weitere Angaben — Anschlüsse“ das Häkchen dieser Zählerart.'
          const text = data.main !== null
            ? `der Rest des Hauptzählers geht an den Vermieter, weil sich nicht bestimmen lässt, wie viel davon auf sie entfällt.${b.selfUnits.length > 0 ? ' Einen Eigenanteil weist Mietfuchs für diesen Rest deshalb nicht aus.' : ''}${noConnection}`
            : data.hasMain
              ? 'ihr Verbrauch lässt sich nicht bestimmen und steckt in den Anteilen der übrigen Wohnungen, bis der Hauptzähler verwendbar ist (siehe den Hinweis zum Hauptzähler).'
              : data.limited
                ? `ihr Verbrauch lässt sich nicht bestimmen und wird von den übrigen teilnehmenden Wohnungen mitgetragen. Bitte die Teilnehmer der Position prüfen.${noConnection}`
                : `ihr Verbrauch lässt sich nicht bestimmen und wird von den übrigen Wohnungen mitgetragen. Mit einem Hauptzähler (Zähler ohne Wohnung) gilt für sie der Rest des Hauptzählers.${noConnection}`
          warn('meter.unit-without-meter', `„${item.description}“: für ${names} gibt es keinen abgelesenen Zähler „${meterTypeLabel(type)}“ — ${text}`, unitSubject(data.unmetered))
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
        forced = 'noBasis'
        warn('direct.unit-gone', `„${item.description}“: die direkt zugeordnete Wohnung gibt es nicht mehr — Betrag geht an den Vermieter.`, itemSubject(item))
      } else if (!target.participates && !target.selfUsed) {
        // Leerstand und Eigennutzung sind reguläre Fälle; eine Wohnung außerhalb der
        // Abrechnungseinheit ist dagegen ein Datenfehler.
        noBasis(`die direkt zugeordnete Wohnung ${target.name} gehört nicht zur Abrechnungseinheit`)
        forced = 'outsideUnit'
      }
      const toSelf = selfUnits.some((u) => u.id === item.directUnitId)
      for (const t of tenancies.filter((t) => t.unitId === item.directUnitId)) {
        // Ein Mietverhältnis ohne Abrechnung in der selbstgenutzten Wohnung zählt zur Eigennutzung,
        // wie vor #202, als der ganze Vermieteranteil dort als Eigenanteil stand.
        if (toSelf && !statements.has(t.id)) continue
        const raw = item.amountCents * (t.days / diy)
        targets.push({ t, raw, basisText: `Direktzuordnung ${t.unit.name}${t.days < diy ? ` · ${t.days}/${diy} Tage` : ''}` })
      }
      // Eigenanteil nur, soweit die Kosten nicht doch einem Mieter dieser Wohnung zufallen
      // (z. B. Mietverhältnis bis März, Eigennutzung ab April).
      // Seit #202 ist das der Betrag abzüglich der Mietverhältnisse dieser Wohnung mit Abrechnung;
      // vorher stand hier der ganze Betrag, und erst die Begrenzung am Vermieteranteil machte daraus
      // dasselbe.
      if (toSelf) {
        selfRaw = item.amountCents - targets.reduce((a, x) => a + x.raw, 0)
        if (selfRaw * item.amountCents < 0) selfRaw = 0
      }
    }
    // Die eine Verteilung (#202): Mieter und Gründe des Vermieters sind Empfänger derselben
    // Restverteilung (siehe `distributeCents`). Ein Mietverhältnis mit Pauschale oder Inklusivmiete
    // für diese Kostenart (#93) bleibt in der Verteilbasis, bekommt seinen Anteil aber nicht
    // zugebucht: Er fällt dem Vermieter zu, als abziehbare Kosten und nicht als Eigenanteil. Ebenso
    // ein Mietverhältnis in einer nicht beteiligten Wohnung (nur bei Direktzuordnung möglich), das
    // keine Abrechnung hat. Solche Anteile werden je Grund zu einer Zeile des Vermieters.
    const booked = targets.map((x) => bookable(x.t))
    const tenantLines: Recipient[] = targets.flatMap((x, i) => (booked[i] ? [{ key: String(x.t.id), landlord: false, raw: x.raw }] : []))
    const recipients: Recipient[] = [
      ...tenantLines,
      ...landlordRecipients(item, {
        selfRaw,
        notBooked: targets.flatMap((x, i) => booked[i] ? [] : [{ reason: statements.has(x.t.id) ? modelFor(x.t, item) : 'outsideUnit', raw: x.raw }]),
        outsideRaw,
        customUnassignedRaw,
        mainRestRaw,
        bookedRaw: tenantLines.reduce((a, l) => a + l.raw, 0),
      }),
    ]
    const cents = distributeCents(item.amountCents, recipients)
    // Die Zeile jedes Ziels; ein nicht zugebuchtes hat keine eigene.
    const lineOf = new Map<number, number>()
    {
      let k = 0
      targets.forEach((_, i) => { if (booked[i]) lineOf.set(i, k++) })
    }
    const shareOf = (i: number): number => { const k = lineOf.get(i); return k === undefined ? 0 : cents[k] }
    // §35a-Lohnanteil, mitverteilt in denselben Zeilen (siehe `distributeLaborCents`): Wer 55/365
    // der Rechnung trägt, trägt 55/365 des Lohnanteils (#180), ab- oder aufgerundet, nie mehr als
    // seinen Kostenanteil, und alle Zeilen zusammen, die des Vermieters eingeschlossen, genau den
    // Lohnanteil der Rechnung. Die kaufmännische Rundung ist eine Festlegung dieser Berechnung,
    // keine Vorgabe des §35a EStG. Die Kostenanteile selbst bleiben, wie sie sind.
    const labor = validLabor35aCents(item)
    let laborCents: number[] = recipients.map(() => 0)
    let laborExact: number[] = recipients.map(() => 0)
    if (labor === null) {
      warn('labor35a.invalid', `„${item.description}“: der §35a-Lohnanteil muss zwischen 0 und dem Rechnungsbetrag liegen — es wird kein Lohnanteil bescheinigt.`, itemSubject(item))
    } else if (labor > 0) {
      const d = distributeLaborCents(labor, item.amountCents, recipients, cents)
      laborCents = d.cents
      laborExact = d.exact
    }
    options.onAllocation?.({
      costItemId: item.id,
      amountCents: item.amountCents,
      laborCents: labor ?? 0,
      forced: forced !== null,
      lines: recipients.map((r, k) => ({ recipient: r.key, landlord: r.landlord, exact: cleanRaw(r.raw), cents: cents[k], laborExact: laborExact[k], laborCents: laborCents[k] })),
    })
    for (const o of overlaps) {
      const e = overlapExtra(item, b, targets, booked, o)
      o.extra.first += e.first
      o.extra.second += e.second
    }
    let distributed = 0
    targets.forEach((x, i) => {
      const k = lineOf.get(i)
      if (k === undefined) return
      const st = statements.get(x.t.id)
      if (!st) return
      const share = cents[k]
      distributed += share
      const labor35a = laborCents[k]
      // Der Rechenweg (#114): dieselben Zahlen, aus denen die Zeile entstand, als Text. Der
      // Restcent wird bei der Zeile benannt, die von der gewöhnlichen Rundung abweicht; sonst sähe
      // der Mieter einen Cent, den ihm niemand erklärt. Das ist nicht immer die Zeile, die einen
      // Cent dazubekommt: Liegen die Reste über einem halben Cent, ist es die, die einen verliert.
      const c = x.community
      const steps: CalcStep[] = [
        c
          ? { label: 'Kosten der Gemeinschaft', value: fmtCents(c.costsCents), term: 'homeownersStatement' }
          : { label: 'Rechnungsbetrag', value: fmtCents(item.amountCents) },
        { label: 'Umlageschlüssel', value: KEY_LABELS[item.key] || item.key, term: 'allocationKey' },
      ]
      if (c) {
        // Laut Gemeinschaftsabrechnung (#144): erst der Schritt der Gemeinschaft, dann die
        // Verteilung im Objekt. Die Verteilbasis der ganzen Anlage steht nicht noch einmal da.
        steps.push({ label: 'Anteil an der Gemeinschaft', value: c.share, term: c.term })
        if (c.appliedCents !== null) steps.push({ label: 'Angesetzt laut Hausgeldabrechnung', value: fmtCents(c.appliedCents), term: 'homeownersStatement' })
        if (c.ownShare) steps.push({ label: 'Anteil Ihrer Wohnung daran', value: c.ownShare, term: c.term })
        if (item.amountCents !== 0) {
          steps.push({ label: 'Rechnung', value: `${fmtCents(item.amountCents)} × ${fmtPercent((x.raw / item.amountCents) * 100)} % = ${fmtExactEuro(x.raw)}` })
        }
      } else if (item.key === 'amounts') {
        steps.push({ label: 'Einzelbetrag', value: `${fmtCents(Math.round(x.raw))} laut Einzelabrechnung`, term: 'individualAmounts' })
      } else {
        steps.push({ label: 'Anteil an der Verteilbasis', value: x.basisText, term: 'distributionBasis' })
        // Der Leerstand steckt in der Verteilbasis (#177); ohne diesen Schritt sähe der Mieter eine
        // Summe der Personentage, die größer ist als die der Bewohner, und niemand erklärte sie.
        if (item.key === 'persons' && b.vacancies.length > 0) {
          steps.push({ label: 'davon Leerstand', value: vacancyText(b.vacancies), term: 'vacancy' })
        }
        if (item.amountCents !== 0) {
          steps.push({ label: 'Rechnung', value: `${fmtCents(item.amountCents)} × ${fmtPercent((x.raw / item.amountCents) * 100)} % = ${fmtExactEuro(x.raw)}` })
        }
      }
      const exact = cleanRaw(x.raw)
      steps.push(share !== roundHalfAway(exact)
        ? { label: 'Ergebnis, auf Cent gerundet', value: `${fmtCents(share)} (Restcent-Verfahren: rechnerisch ${fmtExactEuro(x.raw)}; damit die Anteile zusammen genau den Rechnungsbetrag ergeben, weicht dieser Anteil um einen Cent von der gewöhnlichen Rundung ab)`, term: 'largestRemainder' }
        : { label: 'Ergebnis, auf Cent gerundet', value: fmtCents(share) })
      // Wie beim Kostenanteil: Weicht der Lohnanteil von der Rundung seines rechnerischen Werts ab,
      // steht der Grund dabei, auch wenn er dadurch 0 wird (M3 der Durchsicht von #201); sonst fehlte
      // dem Mieter ein Cent ohne Erklärung. Bei ganzer Lohnrechnung ist der Lohnanteil der
      // Kostenanteil, und dessen Restcent erklärt schon der Schritt davor.
      const laborRounded = roundHalfAway(laborExact[k])
      if (labor !== null && labor > 0 && labor !== item.amountCents && labor35a !== laborRounded) {
        const why = laborRounded > Math.max(0, share)
          ? 'ein Lohnanteil liegt nie über dem Kostenanteil, deshalb ist er auf diesen begrenzt'
          : `Restcent: damit die Lohnanteile zusammen genau den Lohnanteil der Rechnung ergeben, ist dieser einen Cent ${labor35a > laborRounded ? 'höher' : 'geringer'} als gewöhnlich gerundet`
        steps.push({ label: 'davon Lohnanteil nach § 35a EStG', value: `${fmtCents(labor35a)} (rechnerisch ${fmtExactEuro(laborExact[k])}; ${why})`, term: 'labor35a' })
      } else if (labor35a > 0) {
        steps.push({ label: 'davon Lohnanteil nach § 35a EStG', value: fmtCents(labor35a), term: 'labor35a' })
      }
      st.rows.push({
        costItemId: item.id,
        category: item.category,
        description: item.description,
        totalCents: item.amountCents,
        key: item.key,
        keyLabel: KEY_LABELS[item.key] || item.key,
        basisText: x.basisText,
        shareCents: share,
        labor35aCents: labor35a,
        steps,
      })
      st.totalShareCents += share
      st.total35aCents += labor35a
    })
    // Heizung und Warmwasser ohne Verbrauchsanteil (#140): Die Verordnung verlangt 50 bis 70 % nach
    // Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV), sonst darf der Mieter seinen Anteil um 15 %
    // kürzen (§ 12 Abs. 1). Gerechnet wird wie erfasst, unterstützen und warnen statt verweigern
    // (#91); beziffert wird die Kürzung je Mieter, der über die Heizung eine Abrechnung bekommt.
    // Bei Pauschale und Warmmiete gibt es keine Abrechnung, die er kürzen könnte; das meldet
    // `heating.flat-rate`. Auf den Cent gerundet, kaufmännisch wie überall bei einer Einzelzahl.
    // Mieter, die über diese Heizposition abgerechnet werden. Auch eine Direktzuordnung zählt für
    // den Hinweis zur Fernablesbarkeit (#110), etwa ein Ergebnis des Messdienstes, das direkt bei
    // der vermieteten Wohnung eingetragen ist; Kürzungen nach § 12 Abs. 1 Satz 1 rechnet sie nicht.
    const heatingReceived = item.category === HEATING_CATEGORY
      ? targets.flatMap((x, i) => (booked[i] && statements.has(x.t.id) && shareOf(i) > 0 && !outsideHeating(x.t.unit) ? [{ x, share: shareOf(i) }] : []))
      : []
    if (heatingReceived.length > 0) heatingBilledItem ??= item
    if (item.category === HEATING_CATEGORY && item.key !== 'direct') {
      const received = heatingReceived
      if (heatingByConsumption(item.key)) {
        // Gedeckt nur durch eine Position mit positivem Betrag, die wirklich nach Verbrauch verteilt
        // (letzte Durchsicht). Nach Zählern: Die Wohnung nimmt teil und hat einen Zähler des Typs,
        // der im Jahr abgelesen ist; ein Verbrauch von 0 ist dann gemessen und keine Lücke. Ohne
        // Ablesungen geht der Betrag an den Vermieter, das deckt nichts. Als Einzelbeträge: Für ein
        // Mietverhältnis der Wohnung ist ein Betrag eingetragen, auch 0. Sonst (Gemeinschaft): ein
        // positiver Anteil.
        if (item.amountCents > 0 && item.key === 'meter') {
          const readMeters = allMeters.filter((m) => m.unitId && m.type === item.meterType && coveredDays(readingsOf(m.id), yFrom, yTo) > 0)
          if (targets.length > 0) {
            for (const m of readMeters) if (m.unitId && (!item.participantUnitIds || item.participantUnitIds.includes(m.unitId))) heatingCovered.add(m.unitId)
          }
        } else if (item.amountCents > 0 && item.key === 'amounts') {
          const given = item.tenancyAmounts ?? {}
          for (const t of b.partTenancies) if (Object.hasOwn(given, t.id)) heatingCovered.add(t.unitId)
        } else if (item.amountCents > 0) {
          for (const { x } of received) heatingCovered.add(x.t.unitId)
        }
      } else {
        heatingCuts.push({
          item,
          rows: received.map(({ x, share }) => ({ unitId: x.t.unitId, text: `${x.t.tenantName} (${x.t.unit.name}) ${fmtCents(Math.round((share * 15) / 100))}` })),
        })
      }
    }
    tenantCentsOf.set(item.id, distributed)
    const landlordCents = item.amountCents - distributed
    // Die Zeilen des Vermieters aus derselben Verteilung; zusammen ergeben sie genau den
    // Vermieteranteil. Der Eigenanteil ist genau die Zeile der Eigennutzung (#202), ohne eigenes
    // Runden und ohne Begrenzung: Er kann nicht über dem Vermieteranteil liegen und nicht das
    // Vorzeichen wechseln, eine Gutschrift senkt ihn ebenso (#129). Geht die Position aus einem
    // einzigen Grund ganz an den Vermieter, gilt dieser Grund und kein Eigenanteil.
    const parts: LandlordPart[] = recipients.flatMap((r, k) => (r.landlord && cents[k] !== 0 ? [{ reason: r.key as LandlordReason, cents: cents[k] }] : []))
    if (!forced) selfUsedShareCents += parts.find((p) => p.reason === 'selfUse')?.cents ?? 0
    if (landlordCents !== 0) {
      landlordRows.push({
        costItemId: item.id,
        category: item.category,
        description: item.description,
        totalCents: item.amountCents,
        keyLabel: KEY_LABELS[item.key] || item.key,
        shareCents: landlordCents,
        landlordParts: forced ? [{ reason: forced, cents: landlordCents }] : parts,
      })
    }
  }

  notices.splice(tvAt, 0, ...tvNotices())

  // Überschneidende Mietverhältnisse (#204), mit dem Mehrbetrag aus der Verteilung oben. „Hier
  // beheben →“ führt zum früher eingezogenen, denn meist ist sein Auszug vertippt.
  for (const o of overlaps) {
    const period = (t: SnapshotTenancy) => (t.end ? `${fmtDay(t.start)} bis ${fmtDay(t.end)}` : `ab ${fmtDay(t.start)}`)
    const span = o.to === null ? `seit dem ${fmtDay(o.from)}` : `vom ${fmtDay(o.from)} bis ${fmtDay(o.to)}`
    const yearDays = rangeOverlapDays(o.inYear.from, o.inYear.to, o.inYear.from, o.inYear.to)
    const whole = o.to !== null && o.from === o.inYear.from && o.to === o.inYear.to
    // Je Lesart der Betrag; die Richtung folgt dem Nettobetrag (Kosten oder Gutschrift).
    const byFirst = Math.round(o.extra.first)
    const bySecond = Math.round(o.extra.second)
    const clause = (c: number, inverted: boolean): string => {
      const who = 'die Mieter dieser Wohnung'
      const what = c >= 0
        ? `${year} zusammen ${fmtCents(c)} mehr, als auf die Wohnung entfällt`
        : `${year} zusammen ${fmtCents(-c)} mehr gutgeschrieben, als auf die Wohnung entfällt`
      const verb = c >= 0 ? 'tragen' : 'bekommen'
      return inverted ? `${verb} ${who} ${what}` : `Die Mieter dieser Wohnung ${verb} ${what}`
    }
    const none = 'wirkt es sich auf die Anteile der Mieter nicht aus'
    const amountText = byFirst === 0 && bySecond === 0
      ? `Auf die Anteile der Mieter wirkt sich das ${year} nicht aus, die Angaben widersprechen sich aber. `
      : byFirst === bySecond
        ? `Für diese Zeit wird beiden der volle Anteil berechnet: ${clause(byFirst, false)}. `
        : `Für diese Zeit wird beiden der volle Anteil berechnet. Wie viel zu viel, hängt davon ab, welches Datum falsch ist: Ist bei ${o.first.tenantName} ein Datum falsch, ${byFirst === 0 ? none : clause(byFirst, true)}; ist es bei ${o.second.tenantName} falsch, ${
          bySecond === 0 ? none : byFirst !== 0 && Math.sign(byFirst) === Math.sign(bySecond) ? fmtCents(Math.abs(bySecond)) : clause(bySecond, true)
        }. `
    warn('tenancy.overlap',
      `Die Mietverhältnisse von ${o.first.tenantName} (${period(o.first)}) und ${o.second.tenantName} (${period(o.second)}) in ${o.first.unit.name} überschneiden sich ${span} (${whole ? '' : 'davon '}${daysLabel(yearDays)}${whole ? '' : ` in ${year}`}). ` +
        amountText +
        'Meist ist ein Datum vertippt: Bitte Auszug und Einzug prüfen und das falsche Datum berichtigen. Bis dahin rechnet Mietfuchs wie erfasst.',
      { kind: 'tenancy', id: o.first.id })
  }

  // Fernablesbarkeit (#110): Ab dem Abrechnungsjahr 2027 müssen alle Erfassungsgeräte fernablesbar
  // sein. Welche Geräte eingebaut sind, weiß Mietfuchs nicht; deshalb ein Hinweis ohne Betrag statt
  // einer bezifferten Kürzung. Ein Feld dafür am Zähler gehört zur Heizkostenabrechnung (#97, #99).
  // Ohne `subject`: An der Kostenposition gibt es nichts zu beheben, ein „Hier beheben →“ führte
  // ins Leere.
  if (heatingBilledItem && ruleCoverage('heating-remote-reading', yFrom, yTo) !== 'none') {
    warn('heating.remote-reading',
      'Spätestens seit dem 01.01.2027 müssen alle Zähler und Heizkostenverteiler für Heizung und Warmwasser fernablesbar sein (§ 5 Abs. 3 HeizkostenV); ' +
        'Geräte, die nach dem 01.12.2021 eingebaut wurden, müssen es in der Regel schon seit ihrem Einbau sein (§ 5 Abs. 2). Bei fernablesbaren Geräten stehen den Mietern schon seit 2022 monatliche Verbrauchsinformationen zu (§ 6a HeizkostenV). ' +
        'Fehlt das eine oder das andere, darf jeder Mieter seinen Anteil an den Heizkosten um 3 % kürzen (§ 12 Abs. 1 HeizkostenV). ' +
        'Mietfuchs weiß nicht, welche Geräte bei Ihnen eingebaut sind. Prüfen Sie das bitte mit Ihrem Messdienst. Ausgenommen sind Einzelfälle, in denen die Nachrüstung technisch nicht möglich ist, unangemessen aufwendig wäre oder sonst eine unbillige Härte bedeutete (§ 5 Abs. 3 Satz 2), sowie die Fälle des § 11 HeizkostenV. ' +
        'Das gilt nicht für eine Gastherme in der Wohnung mit eigenem Gasvertrag des Mieters. ' +
        'Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, gilt das nur, wenn Sie nichts anderes vereinbart haben (§ 2 HeizkostenV).')
  }

  // Nur Wohnungen, die im Jahr nicht nach Verbrauch gedeckt sind, dürfen kürzen: Eine
  // Grundkostenposition nach Fläche neben der Verbrauchsposition ist der Regelfall der Verordnung.
  const heating = heatingFindings(items, snapshot.units.filter((u) => !outsideHeating(u)), heatingCovered)
  for (const { item, rows } of heatingCuts) {
    const affected = heating.withoutConsumption.get(item.id)
    const cuts = rows.filter((r) => affected?.has(r.unitId)).map((r) => r.text)
    if (cuts.length === 0) continue
    if (!heatingAgreeable) {
      warn('heating.not-by-consumption',
        `„${item.description}“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt, mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch zu verteilen, den Rest nach Fläche (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). ` +
          `Sonst darf jeder Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV), hier: ${andList(cuts)}. ` +
          'Verteilen Sie 50 bis 70 % nach Verbrauch (eine Position nach Verbrauch mit Wärmezählern, den Rest als eigene Position nach Fläche) oder übernehmen Sie die Abrechnung des Messdienstes als Einzelbeträge.',
        itemSubject(item))
    } else {
      // § 2: Hier darf anderes vereinbart werden, und ob es vereinbart ist, weiß Mietfuchs nicht.
      // Deshalb ein Hinweis ohne Betrag statt Schweigen.
      warn('heating.may-agree-otherwise',
        `„${item.description}“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, darf anderes vereinbart werden (§ 2 HeizkostenV). ` +
          'Die Heizkostenverordnung gilt hier, sofern im Mietvertrag nichts anderes vereinbart ist; dann sind 50 bis 70 % nach Verbrauch zu verteilen, und sonst darf der Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV).',
        itemSubject(item))
    }
  }

  // Verbrauchsanteil außerhalb von 50 bis 70 % (#140, Durchsicht): ein Hinweis ohne Betrag, denn
  // nach Verbrauch abgerechnet wird ja; ob die Aufteilung der Positionen stimmt, prüft der Vermieter.
  for (const g of heating.shareOutside) {
    const names = andList(g.itemIds.map((id) => `„${items.find((c) => c.id === id)?.description ?? id}“`))
    const pct = Math.round((g.consumptionCents * 1000) / g.totalCents) / 10
    warn('heating.consumption-share',
      `Heizung und Warmwasser (${names}): nach Zählern verteilt werden ${fmtNum(pct)} % der Heizkosten. Die Heizkostenverordnung verlangt mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Bitte die Aufteilung zwischen Verbrauchs- und Grundkosten prüfen.`,
      itemSubject({ id: g.itemIds[0] ?? '' }))
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

  // Rückstand im Mietkonto (#133): Angerechnet wird die Vorauszahlung laut Staffel, solange keine
  // Jahreskorrektur gesetzt ist. Maßgeblich ist aber das tatsächlich Gezahlte (siehe
  // computePrepaymentCents); zeigt das Mietkonto einen Rückstand, ging womöglich ein Guthaben
  // hinaus, das es nicht gibt. Umgerechnet wird nicht: Ob eine Teilzahlung die Kaltmiete oder die
  // Vorauszahlung betraf, weiß nur der Vermieter. Der Rückstand kommt aus `rentLedger` selbst,
  // damit Abrechnung und Mietkonto nie Verschiedenes sagen.
  // **Ohne eine einzige Zahlung des Objekts im Jahr bleibt der Hinweis aus.** Wer keine Zahlungen
  // erfasst, führt das Mietkonto nicht, und dann stünde dort für jedes Mietverhältnis die ganze
  // Jahresmiete als Rückstand; der Hinweis erschiene bei jedem dieser Nutzer an jeder Abrechnung
  // und würde bald überlesen, auch dort, wo er zählt. Gefragt wird nach dem Objekt und nicht nach
  // dem Mietverhältnis, denn wer das Mietkonto führt und für einen Mieter nichts gebucht hat, hat
  // genau den Fall, um den es geht.
  // Gemeldet wird nur, wo eine Vorauszahlung angerechnet wird: Bei Pauschale und Inklusivmiete
  // fällt die Abrechnung oben weg oder rechnet nichts an.
  // **Fällig ist nur, was vor dem Monat des Stichtags liegt.** Das Mietkonto führt das Soll für alle
  // zwölf Monate, im laufenden Jahr also auch für die kommenden; ohne Grenze stünde dann bei jedem
  // Mieter ein Rückstand. Die Miete ist bis zum dritten Werktag fällig (§ 556b Abs. 1 BGB), und
  // eine Überweisung braucht ein paar Tage, bis sie gebucht ist. Den laufenden Monat erst ab einem
  // bestimmten Tag mitzuzählen, hinge an Wochenenden und Feiertagen; einfacher und ohne Fehlalarm
  // ist, ihn gar nicht mitzuzählen. Ein Rückstand des laufenden Monats erscheint dann im nächsten.
  // Liegt der Stichtag nach dem Jahr, ist alles fällig, liegt er davor, nichts.
  const dueMonths = dueMonthsOf(year, options.asOf)
  const ledgerInUse = snapshot.payments.some((p) => p.date >= yFrom && p.date <= yTo)
  if (ledgerInUse && dueMonths > 0) {
    const ledgerRows = new Map(rentLedger(snapshot, { asOf: options.asOf }).rows.map((r) => [r.tenancyId, r]))
    for (const st of statements.values()) {
      if (st.prepaymentOverridden || st.prepaymentCents <= 0) continue
      const row = ledgerRows.get(st.tenancyId)
      if (!row) continue
      const openCents = row.arrearsCents
      if (openCents <= 0) continue
      // Der Text behauptet nicht, dass die Vorauszahlung fehlt: Im Soll stehen auch Kaltmiete und
      // gegebenenfalls die Pauschale (gemischtes Modell, #93), und welcher Teil offen ist, sieht
      // man erst im Mietkonto.
      const alsoInSoll = row.baseRentYearCents > 0 && row.flatRateYearCents > 0
        ? 'stehen auch Kaltmiete und Pauschale'
        : row.baseRentYearCents > 0 ? 'steht auch die Kaltmiete' : row.flatRateYearCents > 0 ? 'steht auch die Pauschale' : ''
      warn('prepayment.arrears',
        `Im Mietkonto ${year} von ${st.tenantName} (${st.unitName}) sind ${fmtCents(openCents)} offen. Die Abrechnung rechnet die Vorauszahlung laut Vertrag an (${fmtCents(st.prepaymentCents)}); maßgeblich ist aber, was tatsächlich gezahlt wurde. ` +
          'Zahlungen zählen nach ihrem Datum; eine im Dezember vorab gezahlte Januarmiete steht im Vorjahr. ' +
          `Ob die Vorauszahlung betroffen ist, sehen Sie im Mietkonto${alsoInSoll ? `: Im Soll ${alsoInSoll}, der Rückstand kann ebenso sie betreffen` : ''}. ` +
          'Fehlt nur eine Buchung, tragen Sie die Zahlung im Mietkonto nach; ' +
          'hat der Mieter wirklich weniger Vorauszahlung geleistet, tragen Sie den gezahlten Betrag in der Abrechnung bei „abzüglich geleisteter Vorauszahlungen“ mit „✎ anpassen“ ein.',
        { kind: 'rentLedger', id: st.tenancyId })
    }
  }

  // § 2 HeizkostenV: Die Verordnung geht einer Vereinbarung vor; nur im Gebäude mit höchstens zwei
  // Wohnungen, von denen der Vermieter eine selbst bewohnt, darf anderes vereinbart werden. Gemeldet wird nur,
  // wenn es im Jahr eine Heizposition gibt; einen Kürzungsbetrag nennt die Meldung nicht, solange
  // der Rechenweg nach BGH VIII ZR 212/05 nicht geprüft ist (#93).
  const heatingFlat = partTenancies.filter((t) => (t.heatingModel ?? 'settlement') !== 'settlement' && !outsideHeating(t.unit))
  // Die Ausnahme steht in shared/heating.ts, für diese Warnung wie für die Verteilung (#140).
  if (heatingFlat.length > 0 && !heatingAgreeable && items.some((c) => c.category === HEATING_CATEGORY)) {
    warn('heating.flat-rate',
      `Für ${andList(heatingFlat.map((t) => `${t.tenantName} (${t.unit.name})`))} ist für Heizung und Warmwasser eine Pauschale oder Warmmiete vereinbart. ` +
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
    // Eine Regel, und der Server entscheidet sie: Das Cockpit liest die Einstufung von hier, statt
    // sie aus seinen eigenen Daten nachzubauen (#135). Alle Mietverhältnisse zählen, auch die mit
    // Inklusivmiete oder Pauschale, die in `statements` fehlen.
    garageLikeUnitIds: snapshot.units.filter((u) => (u.participates || u.selfUsed) && isGarageLike(u)).map((u) => u.id),
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
  const tenancyEnd = new Map(partTenancies.map((t) => [t.id, t.end]))
  for (const st of result.statements) {
    st.balanceCents = st.prepaymentCents - st.totalShareCents // >0 Guthaben, <0 Nachzahlung
    // Vorschlag nach §560 Abs. 4 BGB: ein Zwölftel der Jahreskosten, auf volle Euro gerundet.
    // Die Kosten fallen künftig für zwölf Monate an; wer erst im Jahr einzog, hat einen Anteil für
    // weniger Tage, der deshalb auf das volle Jahr hochgerechnet wird (#134). Das ist eine
    // Vergröberung: Bei einem kurzen Teiljahr vervielfacht die Hochrechnung jede Zufälligkeit
    // (ein Einzug im November ergibt den Faktor sechs), und verbrauchsabhängige Kosten wie Heizung
    // fallen nicht gleichmäßig übers Jahr an, ein Winterhalbjahr ergibt also zu viel, ein Sommer
    // zu wenig. Es bleibt ein Vorschlag, den der Vermieter vor dem Versand prüft.
    // Endet das Mietverhältnis im Jahr, auch zum 31.12., gibt es keine künftige Vorauszahlung und
    // keinen Vorschlag; 0 heißt für die Oberfläche „nichts anzeigen“.
    const end = tenancyEnd.get(st.tenancyId)
    st.suggestedMonthlyCents = (end != null && end <= yTo) || st.days <= 0
      ? 0
      // Nie negativ: Überwiegen Gutschriften, gibt es keine Vorauszahlung unter 0 (Integrationsdurchsicht).
      : Math.max(0, Math.round((st.totalShareCents * diy) / st.days / 12 / 100) * 100)
  }
  return result
}

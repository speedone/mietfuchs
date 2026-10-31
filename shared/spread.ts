// Größeren Erhaltungsaufwand für die Steuer auf zwei bis fünf Jahre verteilen (§ 82b Abs. 1 EStDV, #262). Hier stehen
// die Regeln, die Server und Formular gleich sehen müssen: wo verteilt werden kann, welche Werte es gibt, wie die Raten
// auf den Cent fallen und was eine Änderung für die Steuer bedeutet (Rückfrage). **Gerechnet** werden die Jahre des
// Abzugs nur in server/src/outflow.ts (`deductionPlan`, #262 PR 2), aufbauend auf `outflowShares`. Entwurf
// docs/superpowers/specs/2026-10-30-erhaltungsaufwand-verteilen-design.md (E-1, E-4, E-9, E-11).
//
// - Die Wahl gilt je Aufwand und steht deshalb an der Position (E-1); bei einer aufgeteilten Rechnung an allen Teilen
//   derselben Quelle (E-11, eine Wahl je Rechnung).
// - „1 Jahr“ ist keine Verteilung und hat keinen eigenen Wert; fehlt die Angabe, zählt der Betrag ganz im Jahr des
//   Abflusses (§ 11 Abs. 2 EStG), wie bisher.
// - Kein Mindestbetrag: § 82b EStDV nennt keinen, eine Schwelle von Mietfuchs wäre erfunden.
import type { CostItem, SpreadYears } from './types.ts'
import { RESERVE_WITHDRAWAL_CATEGORY } from './categories.ts'
import { ADVICE, statedOutflowYear } from './paidOn.ts'

export const SPREAD_YEARS = [2, 3, 4, 5] as const satisfies readonly SpreadYears[]

export const isSpreadYears = (v: unknown): v is SpreadYears => typeof v === 'number' && (SPREAD_YEARS as readonly number[]).includes(v)

// Die Kostenarten, an denen verteilt werden kann (E-1): Instandhaltung zählt nach § 1 Abs. 2 Nr. 2 BetrKV nicht
// zu den Betriebskosten und steht unter „Nicht umlagefähig“; die Entnahme aus der Erhaltungsrücklage nennt Zeile 57 der
// Anlage V ausdrücklich (#96). Die Zuführung zur Rücklage zählt nicht zu den Werbungskosten (#143, BFH, Urteil vom 14.01.2025,
// IX R 19/24) und lässt sich deshalb nicht verteilen.
const SPREAD_CATEGORIES: readonly string[] = ['Nicht umlagefähig', RESERVE_WITHDRAWAL_CATEGORY]

// Ob eine Position verteilt werden kann (E-1). Ein Betrag über 0: Eine Gutschrift auf eine verteilte Maßnahme mindert
// die Werbungskosten im Jahr ihres Zuflusses. Kein Abzug beim Betriebsstrom (folgt schon aus der Kostenart, geprüft zur
// Sicherheit). „Laut Gemeinschaftsabrechnung“ ist erlaubt: Der Anteil des Eigentümers an einer Maßnahme der
// Gemeinschaft ist sein Erhaltungsaufwand (E-10). Server (Ablehnung mit 400) und Formular (Feld nur dann) fragen hier.
export const allowsSpread = (item: Pick<CostItem, 'category' | 'amountCents'> & { operatingPower?: CostItem['operatingPower'] | null }): boolean =>
  SPREAD_CATEGORIES.includes(item.category) && item.amountCents > 0 && item.operatingPower !== 'deduction'

// Die Auswahl im Formular (E-9), kurz, damit das Auswahlfeld nichts abschneidet (Browserlauf, `clippedFields`). Die
// Werte als Text, wie ein Auswahlfeld sie liefert; leer heißt „nicht verteilen“.
export const spreadOptions: readonly { value: '' | `${SpreadYears}`; label: string }[] = [
  { value: '', label: 'nicht verteilen' },
  ...SPREAD_YEARS.map((n) => ({ value: `${n}` as const, label: `auf ${n} Jahre` })),
]

// Die Raten einer Verteilung (E-4): gleiche Beträge auf den Cent, der Rest-Cent in den ersten Jahren. Das ist genau
// `largestRemainder` mit den Jahren als Schlüssel (gleiche Nachkommaanteile, das früheste Jahr zuerst), ganzzahlig
// gerechnet. Früher abgezogen ist für den Vermieter nicht schlechter, und der Cent hängt nicht am letzten Jahr, das mit
// § 82b Abs. 2 womöglich nie kommt.
export function spreadRates(totalCents: number, years: number): number[] {
  if (!Number.isInteger(totalCents)) throw new Error('spreadRates: der Betrag muss ganze Cent sein.')
  if (totalCents < 0) throw new Error('spreadRates: der Betrag muss nicht negativ sein.')
  if (!isSpreadYears(years)) throw new Error('spreadRates: verteilt wird auf 2 bis 5 Jahre.')
  const base = Math.floor(totalCents / years)
  const rest = totalCents - years * base
  return Array.from({ length: years }, (_, i) => (i < rest ? base + 1 : base))
}

// `category`, `amountCents`, `operatingPower`: wo bekannt, erkennt die Rückfrage eine nie gerechnete Wahl (K2).
type Spreadable = { period: string; paidOn?: string | null; taxYear?: number | null; spreadYears?: SpreadYears | null; category?: string; amountCents?: number; operatingPower?: CostItem['operatingPower'] | null }

// Das Jahr, in dem die Verteilung beginnt, wie das Formular es ohne die Steuerübersicht kennt: aus Zahlungsdatum oder
// Jahr der Zahlung, sonst das Jahr des Beginns des Zeitraums (wie `effectiveYear` in shared/paidOn.ts). Gerechnet wird
// das Jahr des Abflusses in outflow.ts; für jede Position, an der verteilt werden kann (kein Abzug beim Betriebsstrom,
// keine Heizposition), ist es dasselbe, auch bei Zeiträumen außerhalb des Kalenderjahres, denn über zwei Kalenderjahre
// verlangt der Server das Jahr der Zahlung (Durchsicht K-c, festgehalten in invariant-verteilung.test.ts, V2).
const startYear = (c: Spreadable): number => statedOutflowYear(c) ?? Number(c.period.slice(0, 4))
const range = (from: number, to: number): string => (from === to ? `${from}` : `${from} bis ${to}`)
const span = (c: Spreadable): string => {
  const y = startYear(c)
  return c.spreadYears != null ? range(y, y + c.spreadYears - 1) : `ganz ${y}`
}
const dropped = (from: number, to: number, suffix: string): string =>
  from === to ? `der Anteil ${from} entfällt${suffix}` : `die Anteile ${range(from, to)} entfallen${suffix}`
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const BOUND = 'Die Wahl ist an die Erklärung des ersten Jahres gebunden.'
const NEVER = 'An dieser Position war eine Verteilung gespeichert, die Mietfuchs nie gerechnet hat, weil sie sich nicht verteilen lässt; sie entfällt, an den Zahlen der Steuer ändert sich nichts.'
// Eine gespeicherte Wahl, die die Steuer nie gerechnet hat (`spreadIgnored`, Durchsicht von #262 PR 3, K2).
const neverCounted = (c: Spreadable): boolean =>
  c.spreadYears != null && c.category !== undefined && c.amountCents !== undefined && !allowsSpread({ category: c.category, amountCents: c.amountCents, operatingPower: c.operatingPower ?? null })

// Was eine Änderung an einer gespeicherten Position für die Verteilung bedeutet (E-9), als Sätze für die Rückfrage;
// leer heißt: nichts zu bestätigen. `before` ist die gespeicherte Position (`null` beim Anlegen: nicht gefragt),
// `after` die neue Fassung oder `null` beim Löschen. Gefragt wird, wenn die Wahl gesetzt, geändert oder entfernt wird,
// und wenn sich an einer verteilten Position das Jahr der Zahlung ändert. `otherParts`: die Zeiträume der übrigen
// Teile derselben Rechnung, an die der Server die Wahl mit schreibt (E-11). Server (409 `question: 'spread'`, bestätigt
// mit `confirmSpread`) und Formular fragen beide hier.
export function spreadQuestions(before: Spreadable | null, after: Spreadable | null, otherParts: readonly string[] = []): string[] {
  if (before === null) return []
  const was = before.spreadYears ?? null
  if (neverCounted(before) && (after === null || (after.spreadYears ?? null) !== was)) return [NEVER]
  const out: string[] = []
  if (after === null) {
    if (was === null) return []
    const y = startYear(before)
    out.push(`${capital(dropped(y + 1, y + was - 1, ' damit'))}.`)
  } else {
    const now = after.spreadYears ?? null
    const from = startYear(before)
    const to = startYear(after)
    if (was === now && (now === null || from === to)) return []
    if (was === now) {
      out.push(`Die Verteilung beginnt dann ${to} statt ${from}: Abzug ${span(after)} statt ${span(before)}.`)
    } else if (now === null && was !== null) {
      out.push(`Ohne Verteilung zählt die Position für die Steuer ganz im Jahr ${to}; ${dropped(from + 1, from + was - 1, '')}.`)
    } else {
      out.push(`Für die Steuer wird die Position dann auf ${now} Jahre verteilt: Abzug ${span(after)} statt ${span(before)}.`)
    }
    if (otherParts.length > 0 && was !== now) {
      out.push(`Die Wahl gilt für die ganze Rechnung und wird auch an den übrigen Teilen (${otherParts.join(', ')}) gespeichert.`)
    }
  }
  return [...out, BOUND, ADVICE]
}

// ---------- Vorzeitiges Ende am Objekt (§ 82b Abs. 2 EStDV, #262 PR 4, E-7) ----------
//
// „Wird das Gebäude während des Verteilungszeitraums veräußert, ist der noch nicht berücksichtigte Teil des
// Erhaltungsaufwands im Jahr der Veräußerung als Werbungskosten abzusetzen. Das Gleiche gilt, wenn ein Gebäude in ein
// Betriebsvermögen eingebracht oder nicht mehr zur Einkunftserzielung genutzt wird.“ Den Tod stellt BFH, Urteil vom
// 10.11.2020, IX R 31/19, gleich (Rest beim Erblasser im Todesjahr, entgegen R 21.1 Abs. 6 Satz 2 EStR 2012). Die
// Schenkung ist Auslegung (Lexikon `spread82b`). Gerechnet wird in outflow.ts (`deductionPlan`); hier steht nur, was die
// Rückfrage beim Setzen, Ändern und Entfernen des Jahres sagt, an Server (409 `question: 'spread'`, bestätigt mit
// `confirmSpread`) und Formular gleich.

// Die Jahre einer gewählten Verteilung ohne Ende: Beginn wie `startYear`, Ende nach N Jahren.
export const spreadSpan = (c: Spreadable & { spreadYears: SpreadYears }): { from: number; to: number } => {
  const from = startYear(c)
  return { from, to: from + c.spreadYears - 1 }
}

type RestItem = Spreadable & { description: string }
// Der Abzug einer Position bei einem Ende `rest` in Worten, wie `deductionPlan` ihn rechnet: Ende im letzten Jahr oder
// danach oder vor dem ersten wirkt nicht, Ende im ersten Jahr heißt nicht verteilt.
const restSpanText = (c: RestItem & { spreadYears: SpreadYears }, rest: number | null): string => {
  const { from, to } = spreadSpan(c)
  // Ein Ende vor dem Beginn betrifft die Position nicht (Durchsicht S2), eines im ersten Jahr heißt nicht verteilt.
  if (rest === null || rest >= to || rest < from) return range(from, to)
  if (rest === from) return `ganz ${from}`
  return `${range(from, rest)} (Rest ${rest})`
}
const counted = (c: RestItem): c is RestItem & { spreadYears: SpreadYears } => c.spreadYears != null && !neverCounted(c)

// Was ein anderes Jahr des Endes für die verteilten Positionen des Objekts bedeutet, als Sätze für die Rückfrage; leer
// heißt: keine Position betroffen, nichts zu bestätigen. `items` sind die Positionen des Objekts mit Wahl.
export function spreadRestQuestions(before: number | null, after: number | null, items: readonly RestItem[]): string[] {
  if (before === after) return []
  const changed = items.filter(counted).flatMap((c) => {
    const was = restSpanText(c, before)
    const now = restSpanText(c, after)
    return was === now ? [] : [`${quoted(c.description)}: Abzug ${now} statt ${was}.`]
  })
  if (changed.length === 0) return []
  const ends = after !== null && items.filter(counted).some((c) => after < spreadSpan(c).to && after >= spreadSpan(c).from)
  const lead = after === null
    ? 'Ohne dieses Jahr laufen die Verteilungen wie gewählt.'
    : ends
      ? `Im Jahr ${after} wird der noch nicht abgezogene Teil des verteilten Erhaltungsaufwands auf einmal abgezogen (§ 82b Abs. 2 EStDV).`
      : `Im Jahr ${after} endet keine Verteilung vorzeitig; sie laufen wie gewählt.`
  return [lead, ...changed, ADVICE]
}
const quoted = (d: string): string => `„${d || 'ohne Beschreibung'}“`

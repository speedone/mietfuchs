// Die centgenaue Regression: der Prüfstein des Umstiegs (#55).
//
// Gefragt wird das Einzige, worauf es ankommt: **Kommt aus der Datenbank dieselbe Abrechnung
// heraus wie bisher aus der Datei?** Gerechnet werden dafür beide Bestände, Jahr für Jahr, mit
// allen vier Rechnungen, und verglichen wird Zahl für Zahl. Weicht ein einziger Cent ab, wird
// nicht aktiviert — ein Umstieg, der stillschweigend eine Abrechnung ändert, ist der teuerste
// Fehler, den dieses Vorhaben haben kann.
//
// ---------- Was verglichen wird und was nicht ----------
//
// Verglichen wird alles: jede Zahl, jeder Zustand („bezahlt", „teilweise", „offen"), jeder
// Umlageschlüssel, jede Kennung, jedes Datum. **Ausgenommen sind genau fünf Angaben**, und jede
// einzelne ist eine, die das Geraderücken ausdrücklich verändern darf, ohne dass ein Cent
// wandert (siehe `straightenForDatabase` in legacy.ts und die Tests in validate.test.ts):
//
//   unitName, tenantName, description   Ein fehlendes Anzeigefeld wird beim Übernehmen zum
//                                       leeren Feld. Das Mietkonto setzt für eine Wohnung ohne
//                                       Namen heute einen Strich ein, danach steht dort der
//                                       leere Name. Beide sagen dasselbe.
//   basisText                           Die Beschreibung der Rechengrundlage auf der
//                                       Abrechnung. Bei der Direktzuordnung steht der Name der
//                                       Wohnung darin, sie ändert sich also aus demselben Grund.
//   warnings                            Der vereinbarte Anteil einer gelöschten Wohnung entfällt
//                                       beim Übernehmen, und mit ihm die Warnung darüber.
//                                       Verteilt wurde er ohnehin nie.
//
// Ändert sich sonst nichts und eine dieser fünf Angaben doch, ist das kein Abbruch, steht aber
// im Protokoll. Alles andere ist einer.

import { computeSettlement, consumptionOverview, rentLedger, taxReport } from '../calc.ts'
import { legacyPrepaymentEntry } from '../legacy.ts'
import { snapshotFromDb, snapshotOf, type Snapshot, type SnapshotSource } from '../snapshot.ts'
import type { Db } from '../store.ts'

// ---------- Welche Jahre geprüft werden ----------

// Ein Bereich, der sich lohnt. Eine von Hand verdorbene Datei kann das Jahr 9999 enthalten (der
// Validator prüft keine Datumsformate), und dann wären es Tausende von Jahren. Dann werden nur
// die Jahre geprüft, in denen wirklich etwas steht.
const MAX_YEARS = 200

// Jahre, die zu einem Bestand gehören können. Sie bilden den zusammenhängenden Bereich; alles
// außerhalb wird trotzdem geprüft, reißt den Bereich aber nicht auf.
//
// **Ohne diese Grenze nähme ein einziges krummes Datum der Prüfung ihre Mitte.** `yearOfDate`
// liest die ersten vier Zeichen als Zahl, aus „12" wird also das Jahr 12. Der Bereich 12 bis
// heute überspannt mehr als MAX_YEARS, und der Rückfall darauf, nur die genannten Jahre zu
// prüfen, ließe ausgerechnet die Jahre dazwischen aus — die, für die die Berechnung am meisten
// herleitet und für die der Kommentar an `yearsToCheck` begründet, warum sie dazugehören. Der
// Validator fängt ein leeres Datum ab, ein nicht leeres unsinniges nicht.
//
// Die Grenze liegt bewusst **am laufenden Jahr und nicht auf einer festen Jahreszahl**, und
// zwar genau MAX_YEARS zurück. Damit ist die Regel nie enger als die alte: Ein Jahr, das den
// Bereich früher nicht gesprengt hätte, gilt auch hier als plausibel und bleibt in ihm drin.
// Nach vorn genügt eine Generation; weiter reicht kein Mietverhältnis, und ein Datum dahinter
// ist ein Tippfehler.
const PLAUSIBLE_AHEAD = 50
const plausibleYear = (year: number, currentYear: number): boolean =>
  year >= currentYear - MAX_YEARS && year <= currentYear + PLAUSIBLE_AHEAD

const yearOfDate = (date: unknown): number | null => {
  const year = typeof date === 'string' ? Number(date.slice(0, 4)) : Number.NaN
  return Number.isInteger(year) ? year : null
}

// **Jedes Jahr, in dem der Bestand etwas enthält, und jedes Jahr dazwischen.**
//
// Die Jahre dazwischen gehören dazu, und das ist kein Übereifer: Ein Mietverhältnis von 2020 bis
// 2024 hat in jedem dieser Jahre ein Mietsoll, auch wenn für 2022 keine einzige Kostenposition
// erfasst ist. Ebenso wird der Verbrauch zwischen zwei Ablesungen tagesanteilig interpoliert:
// Liegen sie Jahre auseinander, haben die Jahre dazwischen sehr wohl einen Verbrauch, ohne
// selbst eine Ablesung zu tragen. Wer nur die Jahre prüfte, in denen ein Datensatz steht, ließe
// genau diese Jahre ungeprüft.
//
// **Ein unbefristetes Mietverhältnis reicht bis ins laufende Jahr.** Sonst bliebe das Jahr, in
// dem der Vermieter gerade arbeitet, ungeprüft, und das ist das einzige, das er sofort ansieht.
//
// Die Stichtage der Staffeln bleiben außen vor. Ein Eintrag „ab 2019" für ein Mietverhältnis,
// das 2024 beginnt, wirkt sich erst ab 2024 aus; seine Wirkung liegt also immer in den Jahren,
// die ohnehin geprüft werden.
export function yearsToCheck(db: Db, currentYear: number): number[] {
  const marks = new Set<number>()
  const add = (year: number | null): void => { if (year !== null) marks.add(year) }
  for (const item of db.costItems) add(Number.isInteger(item.year) ? item.year : null)
  for (const closed of db.closedSettlements) add(Number.isInteger(closed.year) ? closed.year : null)
  for (const payment of db.payments) add(yearOfDate(payment.date))
  for (const reading of db.readings) add(yearOfDate(reading.date))
  for (const tenancy of db.tenancies) {
    add(yearOfDate(tenancy.start))
    // Offenes Mietverhältnis: bis heute.
    add(tenancy.end ? yearOfDate(tenancy.end) : currentYear)
    for (const year of Object.keys(tenancy.prepaymentOverrides ?? {})) add(yearOfDate(year))
  }
  const named = [...marks].sort((a, b) => a - b)
  if (named.length === 0) return []
  // Der Bereich entsteht nur aus plausiblen Jahren, die übrigen kommen einzeln dazu. Sie können
  // nicht im Bereich liegen, denn sie stehen gerade außerhalb seiner Grenzen.
  const plausible = named.filter((year) => plausibleYear(year, currentYear))
  const odd = named.filter((year) => !plausibleYear(year, currentYear))
  if (plausible.length === 0) return named
  const from = plausible[0]
  const to = plausible[plausible.length - 1]
  if (to - from + 1 > MAX_YEARS) return named
  const all: number[] = odd.filter((year) => year < from)
  for (let year = from; year <= to; year++) all.push(year)
  return [...all, ...odd.filter((year) => year > to)]
}

// ---------- Der Vergleichsstand ----------

// Der Bestand, gegen den verglichen wird: die Datei, so wie Mietfuchs sie **heute** rechnet, und
// dazu die eine benannte Änderung.
//
// Der feste Monatsbetrag neben einer leeren Staffel wird zum Staffeleintrag. Das ist der eine
// hingenommene Fall, der eine Zahl bewegt, nämlich die des Mietkontos und damit der
// Steuerübersicht (#70): Die Abrechnung liest den alten Betrag heute schon, das Mietkonto nicht.
// Nach dem Umstieg sagen beide dasselbe.
//
// **Er steht hier ausdrücklich und nicht versteckt im Geraderücken.** Was der Vergleich
// hinnimmt, muss man an einer Stelle lesen können; sonst wäre die Zusage „centgenau" eine mit
// unbekannten Ausnahmen. Der Eintrag selbst kommt aus derselben Funktion, die auch beim
// Übernehmen entscheidet — zwei Fassungen davon ließen die Regression genau dort blind werden,
// wo sie am meisten zu tun hat.
export function standToCompare(file: Db): Db {
  const copy = structuredClone(file)
  for (const tenancy of copy.tenancies) {
    const entry = legacyPrepaymentEntry(tenancy)
    if (entry) tenancy.prepayments = [entry]
  }
  return copy
}

// ---------- Der Vergleich ----------

export type Difference = { path: string, before: unknown, after: unknown }

// Der erste Unterschied zweier Ergebnisse, mit dem Weg dorthin. Kein Wahrheitswert: Der Nutzer
// soll erfahren, **welche** Zahl abweicht, nicht nur, dass etwas abweicht.
export function firstDifference(before: unknown, after: unknown, path = ''): Difference | null {
  if (typeof before === 'number' && typeof after === 'number') {
    // `===` und nicht `Object.is`: 0 und -0 sind derselbe Betrag, und ein -0 kann beim Rechnen
    // mit einer Gutschrift entstehen. Zwei NaN gelten ebenfalls als gleich; ein NaN ist ein
    // Fehler, aber keiner, den der Umstieg verursacht hätte.
    if (before === after || (Number.isNaN(before) && Number.isNaN(after))) return null
    return { path, before, after }
  }
  if (before === after) return null
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return { path, before, after }
    if (before.length !== after.length) return { path: `${path} (Zahl der Einträge)`, before: before.length, after: after.length }
    for (let i = 0; i < before.length; i++) {
      const found = firstDifference(before[i], after[i], `${path}[${i + 1}]`)
      if (found) return found
    }
    return null
  }
  // Beide Objekte (Listen sind oben schon behandelt). Verengt wird ausschließlich mit `typeof`,
  // das der Übersetzer selbst nachrechnet; ein angeschriebenes Typprädikat wäre nur eine
  // Behauptung.
  if (before !== null && typeof before === 'object' && after !== null && typeof after === 'object') {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of [...keys].sort()) {
      const found = firstDifference(Reflect.get(before, key), Reflect.get(after, key), path ? `${path}.${key}` : key)
      if (found) return found
    }
    return null
  }
  return { path, before, after }
}

// Die fünf Angaben von oben. Sie werden vor dem zweiten Vergleich herausgenommen, nicht vor dem
// ersten: Erst wird alles verglichen, und nur wenn dabei etwas auffällt, wird gefragt, ob es
// eine von ihnen war.
const LABEL_FIELDS = new Set(['unitName', 'tenantName', 'description', 'basisText', 'warnings'])

function withoutLabels(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLabels)
  if (value !== null && typeof value === 'object') {
    const kept: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      if (!LABEL_FIELDS.has(key)) kept[key] = withoutLabels(Reflect.get(value, key))
    }
    return kept
  }
  return value
}

// Die vier Rechnungen. Jede bekommt denselben Schnappschuss und wird einzeln verglichen, damit
// die Meldung sagen kann, welche abweicht.
const CALCULATIONS: { what: string, of: (snapshot: Snapshot) => unknown }[] = [
  { what: 'die Abrechnung', of: computeSettlement },
  { what: 'die Verbrauchsübersicht', of: consumptionOverview },
  { what: 'das Mietkonto', of: rentLedger },
  { what: 'die Steuerübersicht', of: taxReport },
]

export type Deviation = { year: number, what: string, difference: Difference }

export type RegressionResult = {
  // Die erste Abweichung, oder null. Nach der ersten wird nicht weitergesucht: Sie genügt, um
  // nicht zu aktivieren, und eine Liste von hundert Folgefehlern hilft niemandem.
  deviation: Deviation | null
  years: number[]
  // Ob eine der fünf Beschriftungen anders ist. Kein Abbruch, aber es gehört ins Protokoll.
  labelsChanged: boolean
}

export function runRegression(before: Db, after: SnapshotSource, years: number[]): RegressionResult {
  let labelsChanged = false
  for (const year of years) {
    const fromFile = snapshotFromDb(before, year)
    const fromDatabase = snapshotOf(after, year)
    for (const { what, of } of CALCULATIONS) {
      const expected = of(fromFile)
      const actual = of(fromDatabase)
      if (firstDifference(expected, actual) === null) continue
      const difference = firstDifference(withoutLabels(expected), withoutLabels(actual))
      if (difference === null) {
        labelsChanged = true
        continue
      }
      return { deviation: { year, what, difference }, years, labelsChanged }
    }
  }
  return { deviation: null, years, labelsChanged }
}

// ---------- Die eingefrorenen Abrechnungen ----------

// Was von einer abgeschlossenen Abrechnung verglichen wird. Beide Seiten liefern den
// eingefrorenen Berechnungsstand als `unknown`: Es ist ein Archivstück, und ein Typ darüber
// wäre eine Behauptung über etwas, das eine frühere Version geschrieben hat.
export type FrozenSettlement = { id: string, year: number, settlement: unknown }

// **Der eingefrorene Berechnungsstand muss wortgleich zurückkommen.** Er ist das, was dem
// Mieter zugestellt wurde, und lässt sich nicht noch einmal ausrechnen. Die vier Rechnungen
// oben lesen daraus nur den Eigenanteil; alles andere fiele dort also nicht auf, und ein
// verstümmeltes Archivstück bemerkte erst der Vermieter, wenn er Jahre später die alte
// Abrechnung öffnet.
export function frozenDifference(before: FrozenSettlement[], after: FrozenSettlement[]): Deviation | null {
  const nachher = new Map(after.map((entry) => [entry.id, entry]))
  for (const vorher of before) {
    const gegenstueck = nachher.get(vorher.id)
    if (!gegenstueck) {
      return {
        year: vorher.year,
        what: 'die abgeschlossene Abrechnung',
        difference: { path: `Kennung ${vorher.id}`, before: 'vorhanden', after: 'fehlt' },
      }
    }
    const difference = firstDifference(vorher.settlement, gegenstueck.settlement)
    if (difference) return { year: vorher.year, what: 'die abgeschlossene Abrechnung', difference }
  }
  if (after.length !== before.length) {
    return {
      year: 0,
      what: 'die abgeschlossene Abrechnung',
      difference: { path: 'Zahl der Einträge', before: before.length, after: after.length },
    }
  }
  return null
}

// Ein Wert, wie er in einer Meldung stehen kann. Zahlen so, wie sie sind (es ist eine Zahl aus
// der Abrechnung, kein Euro-Betrag mit Komma), alles andere kurz.
function shortValue(value: unknown): string {
  if (value === null || value === undefined) return 'nichts'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return `„${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

// Die Meldung für den Nutzer. Sie nennt das Jahr und die Zahl, denn beides braucht er, um zu
// verstehen, was Mietfuchs da gerade verhindert hat.
export function deviationMessage(deviation: Deviation): string {
  const { year, what, difference } = deviation
  return (
    `Nach dem Umstieg käme für ${year} etwas anderes heraus als bisher: In ${what} weicht ` +
    `${difference.path} ab (bisher ${shortValue(difference.before)}, nach dem Umstieg ` +
    `${shortValue(difference.after)}). Deshalb wurde nichts übernommen. Bitte melden Sie diesen ` +
    `Fehler, er gehört nicht zu Ihren Daten, sondern zu Mietfuchs.`
  )
}

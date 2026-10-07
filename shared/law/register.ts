// Das Rechtsregister (Heizung PR 1, Entwurf 2026-10-05 Abschnitt 4): jeder Rechtswert, mit dem
// Mietfuchs rechnet oder den es nennt, mit Gültigkeit, Fundstelle und Zeitregel. Es liegt in
// shared/, wie shared/heating.ts: Berechnung, Lexikon und Oberfläche lesen dieselbe Zahl, und Text
// und Rechnung können nicht auseinanderlaufen. Ein Wächter (server/test/law-literals.test.ts)
// verbietet die Zahlen außerhalb dieses Ordners.
//
// Diese Datei hält nur die Typen und die Abfrage. Die Werte stehen je Gesetz daneben
// (heizkostenv.ts, bgb-betrkv.ts, ustg.ts, practice.ts) und gesammelt in params.ts.
//
// **Eine Fassung wird nie geändert, nur eine neue angelegt** (4.4). Was ausgeliefert ist, hält
// server/test/law-history.test.ts als Zahl fest.
import type { AppliedValue, LawOverride, LawValue } from '../types.ts'

export type SourceRank = 'law' | 'court' | 'technical' | 'practice' | 'software' | 'interpretation'
// `checked`: am Tag `retrieved` an der Quelle gelesen; `adopted`: so übernommen aus einem Entwurf
// oder Bestand, der es mit Datum geprüft hat; `unchecked`: nicht an einer Primärquelle bestätigt.
// Ein Release bricht ab, solange ein Wert `unchecked` ist (law-release.test.ts).
export type SourceCheck = 'checked' | 'adopted' | 'unchecked'
export type Source = { rank: SourceRank; cite: string; url: string; retrieved: string; checked: SourceCheck }

// Nach welchem Zeitpunkt sich die Fassung richtet (Entwurf 3.13). Jeder Parameter hat genau eine
// Zeitregel (N6 der dritten Fassung); braucht ein Fall zwei, sind es zwei Parameter. `incurred`
// kommt mit PR 18; die Überladungen von `law()` nehmen sie bis dahin nicht an. `deliveryYear`
// (Heizung PR 17): die Fassung am 1. Januar des Lieferjahres (§ 3 Abs. 2 und 3 CO2KostAufG).
export type Timing = 'periodStart' | 'incurred' | 'overlap' | 'eventDate' | 'deliveryYear'

// Eine Fassung. Die Grenzen sind ISO-Daten und gelten einschließlich; fehlt eine, gilt die Fassung
// in diese Richtung unbegrenzt. `enacted` nennt die Fassung des Gesetzes, an der der Wert gelesen
// wurde, oder bei einer Auslegung, wo sie festgelegt ist.
export type Version<T extends LawValue> = { validFrom?: string; validTo?: string; value: T; source: Source; enacted: string }

// Ein Parameter. Abweichend vom Typ in 4.2 steckt ein noch nicht veröffentlichter Wert (`null`)
// im `T` des Parameters selbst: So zwingt der Übersetzer genau die Aufrufer überschreibbarer
// Parameter, mit `null` umzugehen, und keinen anderen. `describe` macht aus dem Wert den Text,
// der mit der Abrechnung einfriert („15 %“). Als Methode geschrieben, damit sich jeder Parameter
// in die gemeinsame Liste `LAW_PARAMS` (params.ts) einreihen lässt.
export type LawParam<T extends LawValue, M extends Timing = Timing> = {
  id: string
  title: string
  norm: string
  timing: M
  // lückenlos, nicht überlappend, aufsteigend (law.test.ts prüft das)
  versions: readonly Version<T>[]
  describe(value: T): string
  // nur Werte, die eine Behörde später veröffentlicht (4.5)
  overridable?: { reason: string }
}

export type Period = { from: string; to: string }
export type Coverage = 'full' | 'partial' | 'none'

// Der Rechtsstand: das jüngste `retrieved` im Register (law.test.ts prüft das). Wer einen Wert
// prüft oder eine Fassung anlegt, setzt ihn auf den Tag der Durchsicht (#110).
export const LAW_AS_OF = '2026-10-07'

// ---------- Datumshelfer, Zeichen für Zeichen wie compareText in calc.ts ----------

// „01.07.2024“ statt „2024-07-01“, aus der Zeichenkette und nicht über `Date`, damit keine
// Zeitzone einen Tag verschiebt.
export function germanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10)
}
export const dayAfter = (iso: string): string => shiftDay(iso, 1)
export const dayBefore = (iso: string): string => shiftDay(iso, -1)

// ---------- Abfrage ----------

const contains = (v: { validFrom?: string; validTo?: string }, date: string): boolean =>
  (v.validFrom === undefined || v.validFrom <= date) && (v.validTo === undefined || v.validTo >= date)

// Die Fassung an einem Tag. Gibt es keine, ist das ein Programmfehler wie ein unbekannter
// Regelcode: Eine stille Antwort ließe die Regel unbemerkt nie greifen.
export function versionAt<T extends LawValue>(param: LawParam<T>, date: string): Version<T> {
  const v = param.versions.find((x) => contains(x, date))
  if (!v) throw new Error(`Kein Rechtswert „${param.id}“ am ${date}`)
  return v
}

// Die einzige Fassung eines Parameters, für Texte, die eine Grenze nennen („nur bis 30.06.2024“)
// und nicht zu einem Zeitraum gehören, etwa den Titel eines Hinweises. Hat der Parameter mehr als
// eine Fassung, muss die Stelle entscheiden, welche sie meint; dann bricht sie hier ab.
export function onlyVersion<T extends LawValue>(param: LawParam<T>): Version<T> {
  const [v, ...rest] = param.versions
  if (!v || rest.length > 0) throw new Error(`Rechtswert „${param.id}“ hat nicht genau eine Fassung`)
  return v
}

// Der Wert an einem Tag, ohne Protokoll: für Texte außerhalb einer Abrechnung (Lexikon,
// Anleitungen, Cockpit), die das geltende Recht erklären. In einer Berechnung immer `law()`.
export function valueAt<T extends LawValue>(param: LawParam<T>, date: string): T {
  return versionAt(param, date).value
}

// Ob das Register an einem Tag eine Fassung hat. Für Stellen, die einen Wert nur dort brauchen, wo es ihn
// gibt (Plausibilität vor 2023, Umsatzsteuer im Übergangszeitraum), statt auf den Fehler von versionAt zu
// warten.
export function coversDate<T extends LawValue>(param: LawParam<T>, date: string): boolean {
  return param.versions.some((v) => contains(v, date))
}

// Der 1. Januar eines Jahres, wie `deliveryYear` und die Einträge ihn tragen.
export const yearStart = (year: number): string => `${String(year).padStart(4, '0')}-01-01`

// Das Protokoll einer Berechnung: was sie abgefragt hat, und die Einträge des Vermieters für Werte, die
// noch nicht veröffentlicht sind (Heizung PR 17). Es wird hineingereicht und ist kein globaler Zustand,
// denn zwei Abrechnungen rechnen nebeneinander.
export type LawLog = { readonly values: AppliedValue[]; readonly overrides: readonly LawOverride[] }
export function createLawLog(overrides: readonly LawOverride[] = []): LawLog {
  return { values: [], overrides }
}

function record<T extends LawValue>(log: LawLog, param: LawParam<T>, version: Version<T>): void {
  // Dieselbe Fassung zweimal abgefragt ist ein Eintrag, nicht zwei.
  if (log.values.some((a) => a.id === param.id && a.validFrom === version.validFrom)) return
  log.values.push({
    id: param.id,
    title: param.title,
    norm: param.norm,
    cite: version.source.cite,
    value: version.value,
    text: param.describe(version.value),
    ...(version.validFrom !== undefined ? { validFrom: version.validFrom } : {}),
    ...(version.validTo !== undefined ? { validTo: version.validTo } : {}),
  })
}

export type OverlapAnswer<T extends LawValue> = { coverage: Coverage; value: T; validFrom?: string; validTo?: string }

// Die Frage, die eine Stelle stellen darf, hängt an der Zeitregel des Parameters; der Übersetzer
// prüft so, dass niemand einen Wert nach dem Beginn des Zeitraums fragt, der nach einem Ereignis
// gilt.
export function law<T extends LawValue>(param: LawParam<T, 'periodStart'>, ctx: { period: Period }, log: LawLog): T
export function law<T extends LawValue>(param: LawParam<T, 'eventDate'>, ctx: { date: string }, log: LawLog): T
export function law<T extends LawValue>(param: LawParam<T, 'deliveryYear'>, ctx: { year: number }, log: LawLog): T
export function law<T extends LawValue>(param: LawParam<T, 'overlap'>, ctx: { period: Period }, log: LawLog): OverlapAnswer<T>
export function law<T extends LawValue>(
  param: LawParam<T, 'periodStart' | 'eventDate' | 'deliveryYear' | 'overlap'>,
  ctx: { period: Period } | { date: string } | { year: number },
  log: LawLog,
): T | OverlapAnswer<T> {
  // Ein Wert, den der Vermieter eintragen darf, geht über lawOverridable (Abweichung 1 des Plans zu
  // Heizung PR 17): Hier würde ein `null` sonst still durchgereicht und der Eintrag übersehen.
  if (param.overridable) throw new Error(`Rechtswert „${param.id}“ ist überschreibbar; bitte lawOverridable nehmen`)
  if (param.timing === 'overlap' && 'period' in ctx) return overlap(param, ctx.period, log)
  const date = 'period' in ctx ? ctx.period.from : 'year' in ctx ? yearStart(ctx.year) : ctx.date
  const version = versionAt(param, date)
  record(log, param, version)
  return version.value
}

// Ein überschreibbarer Wert (Entwurf 4.5): Ist er veröffentlicht, gilt er, auch wenn ein Eintrag
// dasteht (der ist dann überholt). Sonst gilt der Eintrag des Vermieters für das Jahr und wird als
// `overridden` protokolliert. Fehlt beides, ist die Antwort `null`, und protokolliert wird nichts
// (wie `none` bei `overlap`, Durchsicht von #221, I1).
export function lawOverridable(param: LawParam<number | null, 'deliveryYear'>, ctx: { year: number }, log: LawLog): number | null
export function lawOverridable(param: LawParam<number | null, 'eventDate'>, ctx: { date: string }, log: LawLog): number | null
export function lawOverridable(param: LawParam<number | null, 'deliveryYear' | 'eventDate'>, ctx: { year: number } | { date: string }, log: LawLog): number | null {
  if (!param.overridable) throw new Error(`Rechtswert „${param.id}“ ist nicht überschreibbar; bitte law nehmen`)
  const date = 'year' in ctx ? yearStart(ctx.year) : ctx.date
  const version = versionAt(param, date)
  if (version.value !== null) {
    record(log, param, version)
    return version.value
  }
  const from = yearStart(Number(date.slice(0, 4)))
  const entry = log.overrides.find((o) => o.paramId === param.id && o.validFrom === from)
  if (!entry) return null
  if (!log.values.some((a) => a.id === param.id && a.validFrom === from)) {
    log.values.push({
      id: param.id, title: param.title, norm: param.norm, cite: entry.source, value: entry.value, text: param.describe(entry.value),
      validFrom: from, validTo: `${from.slice(0, 4)}-12-31`, overridden: { source: entry.source, enteredAt: entry.enteredAt },
    })
  }
  return entry.value
}

// `overlap`: gilt, sobald der Zeitraum die Fassung berührt (Kabelregel). Berührt er keine, sagt
// die Antwort `none` und nennt trotzdem die nächstgelegene Fassung, denn der Hinweis „seit dem
// 01.07.2024 nicht mehr“ braucht ihr Ende. Protokolliert wird bei `none` **nichts**: Ein Wert, der
// im Zeitraum nicht gilt, ist kein angewandter Rechtswert, und „Angewandte Rechtswerte“ nennte
// sonst etwa die Fernablesbarkeit ab 2027 in einer Abrechnung 2023 (Durchsicht von #221, I1).
// Braucht eine Stelle die Fassung trotzdem für ihren Text, trägt sie sie mit `recordVersionAt`
// ausdrücklich ein; die Anzeige nennt dann die Gültigkeit mit.
function overlap<T extends LawValue>(param: LawParam<T>, period: Period, log: LawLog): OverlapAnswer<T> {
  const touching = param.versions.filter((v) => (v.validFrom === undefined || v.validFrom <= period.to) && (v.validTo === undefined || v.validTo >= period.from))
  const answer = (v: Version<T>, coverage: Coverage): OverlapAnswer<T> => ({
    coverage,
    value: v.value,
    ...(v.validFrom !== undefined ? { validFrom: v.validFrom } : {}),
    ...(v.validTo !== undefined ? { validTo: v.validTo } : {}),
  })
  const first = touching[0]
  if (first) {
    for (const v of touching) record(log, param, v)
    const full = touching.length === 1 && contains(first, period.from) && contains(first, period.to)
    return answer(touching.find((v) => contains(v, period.from)) ?? first, full ? 'full' : 'partial')
  }
  const before = param.versions.filter((v) => v.validTo !== undefined && v.validTo < period.from).at(-1)
  const after = param.versions.find((v) => v.validFrom !== undefined && v.validFrom > period.to)
  const nearest = before ?? after
  if (!nearest) throw new Error(`Rechtswert „${param.id}“ ohne Fassung`)
  return answer(nearest, 'none')
}

// Trägt die Fassung an einem Tag ins Protokoll ein, ohne nach einer Zeitregel zu fragen: für eine
// Stelle, die eine im Zeitraum nicht geltende Fassung in ihrem Text nennt (der Hinweis „seit dem
// 01.07.2024 nicht mehr umlagefähig“). So steht in der Abrechnung, worauf sich der Text stützt,
// und die Anzeige nennt mit der Gültigkeit, dass es nicht das Recht des Jahres ist.
export function recordVersionAt<T extends LawValue>(param: LawParam<T>, date: string, log: LawLog): void {
  record(log, param, versionAt(param, date))
}

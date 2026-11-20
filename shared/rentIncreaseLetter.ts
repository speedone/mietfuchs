// Die Eingaben für das Schreiben einer Mieterhöhung (#191, PR 3), geprüft an einer Stelle für Server und Oberfläche: Der
// Server lehnt mit dem ersten Satz ab (400), die Oberfläche (client/src/rentIncreaseLetterForm.ts) zeigt jeden Satz an
// seinem Feld. Entwurf docs/superpowers/specs/2026-11-20-mieterhoehung-design.md, R7 und Gegenprüfung M6, M7, S4, S5.
//
// - Begründungsmittel nach § 558a Abs. 2 BGB mit nachprüfbaren Angaben: Mietspiegel (Name, Stand, Feld, Spanne
//   empfohlen, wo allgemein zugänglich), Gutachten (liegt bei), drei auffindbare Vergleichswohnungen, Mietdatenbank.
// - Die Frage nach dem qualifizierten Mietspiegel ist Pflicht (M6); „weiß nicht“ lässt kein Schreiben zu.
// - Alle Vermieter und alle Mieter (S4): zwei Bestätigungen, die Empfängerzeile ist eingebbar.
// - Felder, die zur gewählten Begründung nicht gehören, werden geleert, damit `basis` nur trägt, was gedruckt wird.
import { valueAt } from './law/register.ts'
import { bgbRentSurveyUpdateYears } from './law/bgb-betrkv.ts'
import type { RentComparable, RentIncreaseKind, RentIncreaseLetterInput, RentJustification, RentQualifiedSurveyAnswer, RentSource, RentSurveyInfo } from './types.ts'

export const RENT_COMPARABLES = 3
export const LETTER_TEXT_MAX = 300
export const EXTRA_PARAGRAPH_MAX = 1500
const AREA_MAX = 10000

// Ein Satz an einem Feld; `field` ist der Pfad im Rumpf („survey.name“, „comparables.1.address“).
export type RentLetterProblem = { field: string; text: string }

const JUSTIFICATIONS: readonly RentJustification[] = ['survey', 'expert', 'comparables', 'database']
const QUALIFIED: readonly RentQualifiedSurveyAnswer[] = ['yes', 'no', 'unknown']

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : '')
const isMonth = (x: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(x)
const isDay = (x: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return false
  const ms = Date.parse(`${x}T00:00:00Z`)
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === x
}
const cents = (x: unknown): number | null => (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null)

function surveyOf(raw: unknown, at: string, label: string, problems: RentLetterProblem[]): RentSurveyInfo | null {
  const o = isObject(raw) ? raw : {}
  const name = text(o.name)
  const asOf = text(o.asOf)
  const field = text(o.field)
  const availableAt = text(o.availableAt)
  if (name === '') problems.push({ field: `${at}.name`, text: `Bitte nennen Sie den ${label} mit seinem Namen, etwa „Mietspiegel der Stadt Musterstadt 2025“.` })
  if (!isMonth(asOf)) problems.push({ field: `${at}.asOf`, text: `Bitte geben Sie den Stand des ${label === 'Mietspiegel' ? 'Mietspiegels' : 'qualifizierten Mietspiegels'} als Monat an, etwa „4.2025“.` })
  if (field === '') problems.push({ field: `${at}.field`, text: 'Bitte nennen Sie das Feld bzw. die Einordnung der Wohnung im Mietspiegel, etwa „Baujahr 1950 bis 1964, 60 bis 80 m², mittlere Lage“. Der Mieter muss die Einordnung nachprüfen können (BGH, Urteil vom 12.12.2007, VIII ZR 11/07).' })
  const low = o.rangeLowCentsPerM2 == null ? null : cents(o.rangeLowCentsPerM2)
  const high = o.rangeHighCentsPerM2 == null ? null : cents(o.rangeHighCentsPerM2)
  if ((o.rangeLowCentsPerM2 != null && low === null) || (o.rangeHighCentsPerM2 != null && high === null)) problems.push({ field: `${at}.range`, text: 'Die Spanne ist ein Betrag in Cent je m², nicht negativ.' })
  else if ((low === null) !== (high === null)) problems.push({ field: `${at}.range`, text: 'Bitte geben Sie die Spanne mit Unter- und Oberwert an oder ganz ohne.' })
  else if (low !== null && high !== null && low > high) problems.push({ field: `${at}.range`, text: 'Der Unterwert der Spanne liegt über dem Oberwert.' })
  for (const [key, value] of [['name', name], ['field', field], ['availableAt', availableAt]] as const) {
    if (value.length > LETTER_TEXT_MAX) problems.push({ field: `${at}.${key}`, text: `Bitte fassen Sie die Angabe kürzer (höchstens ${LETTER_TEXT_MAX} Zeichen).` })
  }
  return { name, asOf, field, rangeLowCentsPerM2: low, rangeHighCentsPerM2: high, availableAt }
}

function sourceOf(raw: unknown, at: string, what: 'expert' | 'database', problems: RentLetterProblem[]): RentSource {
  const o = isObject(raw) ? raw : {}
  const name = text(o.name)
  const date = text(o.date)
  if (name === '' || name.length > LETTER_TEXT_MAX) problems.push({ field: `${at}.name`, text: what === 'expert' ? 'Bitte nennen Sie den öffentlich bestellten und vereidigten Sachverständigen, der das Gutachten erstellt hat.' : 'Bitte nennen Sie die Mietdatenbank, aus der die Auskunft stammt.' })
  if (!isDay(date)) problems.push({ field: `${at}.date`, text: what === 'expert' ? 'Bitte geben Sie das Datum des Gutachtens an.' : 'Bitte geben Sie das Datum der Auskunft an.' })
  return { name, date }
}

function comparablesOf(raw: unknown, problems: RentLetterProblem[]): RentComparable[] {
  const list = Array.isArray(raw) ? raw : []
  if (list.length !== RENT_COMPARABLES) {
    problems.push({ field: 'comparables', text: `Bitte nennen Sie genau ${RENT_COMPARABLES} Vergleichswohnungen (§ 558a Abs. 2 Nr. 4 BGB).` })
  }
  return list.slice(0, RENT_COMPARABLES).map((raw, i) => {
    const o = isObject(raw) ? raw : {}
    const n = i + 1
    const address = text(o.address)
    const location = text(o.location)
    const areaM2 = typeof o.areaM2 === 'number' && Number.isFinite(o.areaM2) && o.areaM2 > 0 && o.areaM2 <= AREA_MAX ? o.areaM2 : 0
    const centsPerM2 = cents(o.centsPerM2) ?? 0
    if (address === '' || address.length > LETTER_TEXT_MAX) problems.push({ field: `comparables.${i}.address`, text: `Vergleichswohnung ${n}: Bitte geben Sie die Anschrift an (Straße, Hausnummer, Ort).` })
    if (location === '' || location.length > LETTER_TEXT_MAX) problems.push({ field: `comparables.${i}.location`, text: `Vergleichswohnung ${n}: Bitte geben Sie Geschoss und Lage im Haus an, etwa „2. OG links“. Ohne sie kann der Mieter die Wohnung nicht finden.` })
    if (areaM2 <= 0) problems.push({ field: `comparables.${i}.areaM2`, text: `Vergleichswohnung ${n}: Bitte geben Sie die Wohnfläche in m² an.` })
    if (centsPerM2 <= 0) problems.push({ field: `comparables.${i}.centsPerM2`, text: `Vergleichswohnung ${n}: Bitte geben Sie die Nettokaltmiete je m² an.` })
    return { address, location, areaM2, centsPerM2 }
  })
}

const ALL_LANDLORDS_NAMED = 'Bitte bestätigen Sie, dass im Briefkopf alle Vermieter laut Mietvertrag genannt sind. Das Schreiben muss von allen ausgehen (§ 126b BGB).'
// Die Eingaben aus einem Rumpf, geprüft. Alle Sätze auf einmal, je mit Feld.
// `senderMissing`: Es ist kein Name des Vermieters eingetragen und kein Briefpapier hinterlegt (siehe `rentSenderWarning`);
// die Bestätigung zum Briefkopf ist dann nicht verlangt und bleibt, wie sie kommt.
export function rentIncreaseLetterOf(raw: unknown, kind: RentIncreaseKind, options: { senderMissing?: boolean } = {}): { letter: RentIncreaseLetterInput } | { problems: RentLetterProblem[] } {
  const problems: RentLetterProblem[] = []
  const o = isObject(raw) ? raw : {}
  const recipientName = text(o.recipientName)
  if (recipientName === '' || recipientName.length > LETTER_TEXT_MAX) problems.push({ field: 'recipientName', text: 'Bitte nennen Sie als Empfänger alle Mieter laut Mietvertrag, etwa „Anna und Ben Becker“.' })
  const severalLandlords = o.severalLandlords === true
  const allLandlordsNamed = o.allLandlordsNamed === true
  const allTenantsNamed = o.allTenantsNamed === true
  if (!allLandlordsNamed && options.senderMissing !== true) problems.push({ field: 'allLandlordsNamed', text: ALL_LANDLORDS_NAMED })
  if (!allTenantsNamed) problems.push({ field: 'allTenantsNamed', text: 'Bitte bestätigen Sie, dass als Empfänger alle Mieter laut Mietvertrag genannt sind. Das Schreiben muss an alle gerichtet sein.' })
  const extraParagraph = typeof o.extraParagraph === 'string' ? o.extraParagraph.trim() : ''
  if (extraParagraph.length > EXTRA_PARAGRAPH_MAX) problems.push({ field: 'extraParagraph', text: `Bitte fassen Sie den Zusatzabsatz kürzer (höchstens ${EXTRA_PARAGRAPH_MAX} Zeichen).` })
  const common = { recipientName, severalLandlords, allLandlordsNamed, allTenantsNamed, extraParagraph }
  if (kind === 'index') {
    const letter: RentIncreaseLetterInput = { justification: null, survey: null, expert: null, database: null, comparables: [], qualifiedSurvey: null, qualified: null, ...common }
    return problems.length > 0 ? { problems } : { letter }
  }

  const justification = JUSTIFICATIONS.find((j) => j === o.justification) ?? null
  if (!justification) problems.push({ field: 'justification', text: 'Bitte wählen Sie das Begründungsmittel: Mietspiegel, Gutachten, drei Vergleichswohnungen oder Mietdatenbank (§ 558a Abs. 2 BGB).' })
  const qualifiedSurvey = QUALIFIED.find((q) => q === o.qualifiedSurvey) ?? null
  if (!qualifiedSurvey) problems.push({ field: 'qualifiedSurvey', text: 'Bitte beantworten Sie, ob es für die Gemeinde einen qualifizierten Mietspiegel gibt. Seine Angaben gehören in jedes Schreiben, auch wenn Sie anders begründen (§ 558a Abs. 3 BGB).' })
  else if (qualifiedSurvey === 'unknown') problems.push({ field: 'qualifiedSurvey', text: 'Bitte klären Sie vor dem Schreiben, ob es für die Gemeinde einen qualifizierten Mietspiegel gibt; die Gemeinde gibt Auskunft. Gemeinden mit mehr als 50 000 Einwohnern müssen einen Mietspiegel haben (§ 558c Abs. 4 BGB), und die Angaben eines qualifizierten gehören in jedes Schreiben (§ 558a Abs. 3 BGB).' })
  const survey = justification === 'survey' ? surveyOf(o.survey, 'survey', 'Mietspiegel', problems) : null
  const qualified = qualifiedSurvey === 'yes' && justification !== null && justification !== 'survey' ? surveyOf(o.qualified, 'qualified', 'qualifizierten Mietspiegel', problems) : null
  const expert = justification === 'expert' ? sourceOf(o.expert, 'expert', 'expert', problems) : null
  const database = justification === 'database' ? sourceOf(o.database, 'database', 'database', problems) : null
  const comparables = justification === 'comparables' ? comparablesOf(o.comparables, problems) : []
  if (problems.length > 0) return { problems }
  return { letter: { justification, survey, expert, database, comparables, qualifiedSurvey, qualified, ...common } }
}

// Der Vermieter muss im Schreiben genannt sein: Das Verlangen nach § 558 BGB ist „in Textform zu erklären“ (§ 558a Abs. 1
// BGB), die Änderung der Indexmiete durch Erklärung in Textform geltend zu machen (§ 557b Abs. 3 BGB), und Textform heißt
// „eine lesbare Erklärung, in der die Person des Erklärenden genannt ist“ (§ 126b Satz 1 BGB). Ohne Namen des Vermieters
// steht im Briefkopf nur das Objekt, unter dem Gruß nichts und in der Zustimmungserklärung ein leeres „An:“.
// **Eine Warnung, keine Sperre**, wie bei „Absender fehlt“ der Abrechnung (client/src/letterView.ts, derselbe § 126b BGB):
// Setzt der Vermieter Namen und Unterschrift von Hand unter den Ausdruck, ist er genannt, und Mietfuchs sieht das nicht.
// Der Server legt den Entwurf deshalb an; die Oberfläche warnt im Fenster, am Entwurf und fragt vor „Als versendet
// speichern“. Kein Text behauptet, die Form fehle: Das gilt nur, wenn der Name auf dem Schriftstück nirgends steht.
// **Mit Briefpapier** (`paper`) trägt das Papier den Absender (wie `senderMissing` der Abrechnung): dafür
// `SENDER_ON_PAPER_ONLY`. Die Bestätigung „Im Briefkopf sind alle Vermieter genannt“ lässt sich ohne Namen und ohne
// Briefpapier nicht geben; `rentIncreaseLetterOf` verlangt sie dann nicht (`senderMissing`).
export function rentSenderWarning(landlordName: string, paper: boolean): string | null {
  if (landlordName.trim() !== '' || paper) return null
  return 'Es ist kein Name des Vermieters eingetragen: Im Briefkopf steht dann nur das Objekt, unter dem Gruß kein Name, und in der Zustimmungserklärung bleibt „An:“ leer. Eine Mieterhöhung ist in Textform zu erklären (§ 558a Abs. 1, § 557b Abs. 3 BGB), und dafür muss die Person des Erklärenden genannt sein (§ 126b BGB). Tragen Sie Ihren Namen vor dem Anlegen in den Einstellungen unter „Name des Vermieters“ ein (oder, nur für dieses Objekt, in den Stammdaten beim Objekt), oder setzen Sie Namen und Unterschrift von Hand auf den Ausdruck. Die Bestätigung zum Briefkopf bleibt ohne Namen leer.'
}
export const SENDER_ON_PAPER_ONLY = 'Es ist kein Name des Vermieters eingetragen. Das Schreiben nennt den Vermieter dann nur, wenn Ihr Briefpapier ihn trägt oder Sie Namen und Unterschrift von Hand daruntersetzen; Mietfuchs sieht nicht, was auf dem Papier steht. Unter dem Gruß steht kein Name, und in der Zustimmungserklärung bleibt „An:“ leer. Eine Mieterhöhung ist in Textform zu erklären, und dafür muss die Person des Erklärenden genannt sein (§ 558a Abs. 1, § 557b Abs. 3, § 126b BGB). Am sichersten tragen Sie Ihren Namen in den Einstellungen unter „Name des Vermieters“ ein.'
// Ein Schreiben, dessen eingefrorener Absender keinen Namen trägt: am Entwurf und in der Rückfrage vor dem Versand.
export const SENDER_MISSING_DRAFT = 'Dieses Schreiben nennt keinen Namen des Vermieters: Unter dem Gruß steht nichts, und in der Zustimmungserklärung ist „An:“ leer. Eine Mieterhöhung ist in Textform zu erklären, und dafür muss die Person des Erklärenden genannt sein (§ 126b BGB). Zwei Wege: Löschen Sie den Entwurf, tragen Sie Ihren Namen in den Einstellungen unter „Name des Vermieters“ ein und legen Sie das Schreiben neu an (der Absender eines Entwurfs ändert sich nicht mehr); oder setzen Sie Namen und Unterschrift von Hand auf den Ausdruck, falls Ihr Briefpapier den Namen nicht schon trägt.'
export const SENDER_MISSING_SEND = 'Das Schreiben nennt keinen Namen des Vermieters. Speichern Sie es nur als versendet, wenn der Name auf dem Schriftstück steht, das der Mieter bekommen hat, etwa von Hand mit Ihrer Unterschrift oder auf Ihrem Briefpapier; eine Mieterhöhung ist in Textform zu erklären, und dafür muss die Person des Erklärenden genannt sein (§ 126b BGB).'

// Ein Mietspiegel, dessen Stand länger zurückliegt als der Abstand seiner Anpassung (Gegenprüfung S5,
// `bgb.rent-survey-update-years`, § 558d Abs. 2 Satz 1 BGB): Ein älterer darf nur verwendet werden, wenn es keinen neueren
// gibt (§ 558a Abs. 4 Satz 2 BGB); Mietfuchs warnt nur. `onDay` ist der Tag des Schreibens.
export function surveyStale(asOf: string, onDay: string): boolean {
  if (!isMonth(asOf)) return false
  const years = valueAt(bgbRentSurveyUpdateYears, onDay)
  return `${Number(asOf.slice(0, 4)) + years}${asOf.slice(4)}` < onDay.slice(0, 7)
}

// Die eingefrorene Grundlage, wie sie aus der Datenbank kommt (Durchsicht K1): Fassung und Grundgestalt. Eine andere
// Fassung (etwa nach dem Wiederherstellen eines Backups einer neueren Version) zeigt die Oberfläche nicht als Schreiben,
// und der Server versendet oder beantwortet sie nicht (409); beide nennen diesen Satz statt abzustürzen. Löschen geht.
export const FOREIGN_BASIS = 'Dieses Schreiben stammt aus einer anderen Fassung von Mietfuchs und lässt sich mit dieser nicht anzeigen, drucken oder bearbeiten; einen Entwurf können Sie löschen. Öffnen Sie es mit der Fassung, mit der es angelegt wurde, oder legen Sie es neu an.'
export function rentIncreaseBasisProblem(x: unknown): string | null {
  if (!isObject(x) || x.version !== 1) return FOREIGN_BASIS
  const plan = x.plan
  const letter = x.letter
  const sender = x.sender
  const fine = typeof x.letterDate === 'string' && isObject(x.request) &&
    isObject(plan) && (plan.kind === 'comparison' || plan.kind === 'index') && typeof plan.receivedOn === 'string' &&
    isObject(letter) && typeof letter.recipientName === 'string' && Array.isArray(letter.comparables) &&
    isObject(sender) && typeof sender.name === 'string' && typeof sender.address === 'string' &&
    Array.isArray(x.recipient) && typeof x.salutation === 'string' && isObject(x.premises) && isObject(x.prepayments) &&
    (x.sentPlan === undefined || x.sentPlan === null || isObject(x.sentPlan))
  return fine ? null : FOREIGN_BASIS
}

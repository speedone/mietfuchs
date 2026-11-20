// Eingaben für das Schreiben einer Mieterhöhung im Seitenfenster (#191, PR 3), ohne DOM (rentIncreaseLetterForm.test.ts).
// Hier stehen der Zustand als Texte, Vorgaben, Auswahllisten, das Lesen der Beträge und Monate und die Hinweise, die nichts
// sperren. Geprüft wird mit derselben Funktion wie auf dem Server (shared/rentIncreaseLetter.ts); ihre Sätze stehen am Feld,
// dessen Schlüssel der Pfad im Rumpf ist („survey.name“, „comparables.1.address“).
import type { RentIncrease, RentIncreaseBasis, RentIncreaseDecision, RentIncreaseKind, RentIncreaseLetterInput, RentIncreasePlan, RentIncreaseStatus, RentJustification, RentQualifiedSurveyAnswer, Tenancy } from './types'
import type { Checked, Problem } from './formProblems'
import { fmtDate, fmtEuro, parseEuro } from './api'
import { parseNumberDe } from './numbers'
import { monthLabel, parseMonthText } from './monthText'
import { RENT_COMPARABLES, SENDER_MISSING_SEND, rentIncreaseLetterOf, surveyStale } from '../../shared/rentIncreaseLetter.ts'

export type RentSurveyValue = { name: string; asOf: string; field: string; low: string; high: string; availableAt: string }
export type RentComparableValue = { address: string; location: string; area: string; perM2: string }
export type RentLetterValue = {
  justification: RentJustification
  survey: RentSurveyValue
  qualifiedSurvey: RentQualifiedSurveyAnswer | '' // '' heißt noch nicht beantwortet
  qualified: RentSurveyValue
  expertName: string
  expertDate: string
  databaseName: string
  databaseDate: string
  comparables: RentComparableValue[]
  recipientName: string
  severalLandlords: boolean
  allLandlordsNamed: boolean
  allTenantsNamed: boolean
  extraParagraph: string
}
// Die Spanne der Vergleichsmiete aus den Eingaben der Rechnung, als Texte (rentIncreaseForm.ts: `rangeLow`, `rangeHigh`).
export type RentRangeText = { low: string; high: string }

const emptySurvey = (range: RentRangeText): RentSurveyValue => ({ name: '', asOf: '', field: '', low: range.low, high: range.high, availableAt: '' })
// Die Spanne des Mietspiegels steht vorbelegt aus der Rechnung (Durchsicht S2), beim Mietspiegel und beim qualifizierten.
export function rentLetterStart(t: Pick<Tenancy, 'tenantName'>, range: RentRangeText = { low: '', high: '' }): RentLetterValue {
  return {
    justification: 'survey', survey: emptySurvey(range), qualifiedSurvey: '', qualified: emptySurvey(range),
    expertName: '', expertDate: '', databaseName: '', databaseDate: '',
    comparables: Array.from({ length: RENT_COMPARABLES }, () => ({ address: '', location: '', area: '', perM2: '' })),
    recipientName: t.tenantName, severalLandlords: false, allLandlordsNamed: false, allTenantsNamed: false, extraParagraph: '',
  }
}

// Ändert sich die Spanne in der Rechnung, zieht die des Schreibens mit, solange sie leer ist oder der bisherigen der
// Rechnung gleicht; eine eigens geänderte bleibt.
export function followPlanRange(v: RentLetterValue, before: RentRangeText, after: RentRangeText): RentLetterValue {
  const follow = (s: RentSurveyValue): RentSurveyValue => ({
    ...s,
    low: s.low.trim() === '' || s.low === before.low ? after.low : s.low,
    high: s.high.trim() === '' || s.high === before.high ? after.high : s.high,
  })
  return { ...v, survey: follow(v.survey), qualified: follow(v.qualified) }
}

export function justificationOptions(): { value: RentJustification; label: string }[] {
  return [
    { value: 'survey', label: 'Mietspiegel' },
    { value: 'comparables', label: 'Drei Vergleichswohnungen' },
    { value: 'expert', label: 'Gutachten eines Sachverständigen' },
    { value: 'database', label: 'Auskunft einer Mietdatenbank' },
  ]
}
// Immer alle, auch „noch nicht beantwortet“, damit der angezeigte Wert dem gespeicherten entspricht.
export function qualifiedSurveyOptions(): { value: RentQualifiedSurveyAnswer | ''; label: string }[] {
  return [
    { value: '', label: 'Bitte wählen' },
    { value: 'yes', label: 'Ja' },
    { value: 'no', label: 'Nein' },
    { value: 'unknown', label: 'Weiß nicht' },
  ]
}
export const EXTRA_PARAGRAPH_HINT = 'Der einzige frei formulierte Text des Schreibens. Er darf weder die Mietstruktur (etwa Betriebskosten in die Miete nehmen) noch die Vorauszahlungen ändern; sonst kann das ganze Verlangen unwirksam sein (BGH, Urteil vom 16.12.2020, VIII ZR 108/20, Rn. 18 f.).'
export const PARTIES_HINT = 'Das Schreiben muss von allen Vermietern laut Mietvertrag ausgehen und an alle Mieter gerichtet sein. Den Absender ändern Sie in den Einstellungen oder am Objekt.'
// Ohne Ränder je Druckseite (`canPagePaper` in letterDesignView.ts) druckt das Schreiben wie ohne Briefpapier; derselbe
// Grund wie auf der Seite Abrechnung, ohne deren Satz zur Fußzeile.
export const PAPER_BROWSER_NOTE = 'Dieser Browser (etwa Safari) kann die Ränder nicht je Druckseite unterscheiden; mit Briefpapier stünde der Text der Folgeseiten im Kopf oder Fuß des Papiers. Das Schreiben druckt deshalb wie ohne Briefpapier: mit Seitenrand und Absender oben. Mit Briefpapier drucken Sie in einem aktuellen Chrome, Edge oder Firefox.'
export const SEVERAL_LANDLORDS_LABEL = 'Mehrere Vermieter, etwa Eheleute oder eine Erbengemeinschaft: Das Schreiben spricht in der Mehrzahl („wir“).'

// Der Rumpf aus den Texten, oder die Meldungen am Feld. Was sich nicht lesen lässt (Betrag, Monat, Fläche), meldet diese
// Funktion; alles Übrige die gemeinsame Prüfung.
// `senderMissing`: kein Name des Vermieters und kein Briefpapier; die Bestätigung zum Briefkopf ist dann gesperrt, geht
// als „nein“ an den Server und ist nicht verlangt (shared/rentIncreaseLetter.ts).
export function rentLetterInput(v: RentLetterValue, kind: RentIncreaseKind, senderMissing = false): Checked<RentIncreaseLetterInput, string> {
  const problems: Problem<string>[] = []
  const cents = (field: string, text: string): number | null => {
    if (text.trim() === '') return null
    const c = parseEuro(text)
    if (c === null || c < 0) {
      problems.push({ field, short: 'Kein Betrag', text: 'Geben Sie einen Betrag in Euro ein, etwa „8,50“.' })
      return null
    }
    return c
  }
  const month = (field: string, text: string): string => {
    const m = parseMonthText(text)
    if (m.kind === 'month') return m.key
    if (m.kind === 'invalid') problems.push({ field, short: m.short, text: m.text })
    return ''
  }
  const survey = (at: 'survey' | 'qualified', s: RentSurveyValue) => ({
    name: s.name, asOf: month(`${at}.asOf`, s.asOf), field: s.field, availableAt: s.availableAt,
    rangeLowCentsPerM2: cents(`${at}.range`, s.low), rangeHighCentsPerM2: cents(`${at}.range`, s.high),
  })
  const raw = {
    justification: v.justification,
    survey: v.justification === 'survey' ? survey('survey', v.survey) : null,
    qualifiedSurvey: v.qualifiedSurvey === '' ? null : v.qualifiedSurvey,
    qualified: v.justification !== 'survey' && v.qualifiedSurvey === 'yes' ? survey('qualified', v.qualified) : null,
    expert: { name: v.expertName, date: v.expertDate },
    database: { name: v.databaseName, date: v.databaseDate },
    comparables: v.justification === 'comparables' ? v.comparables.map((c, i) => {
      const area = c.area.trim() === '' ? 0 : parseNumberDe(c.area)
      if (area === null) problems.push({ field: `comparables.${i}.areaM2`, short: 'Keine Fläche', text: `Vergleichswohnung ${i + 1}: Geben Sie die Wohnfläche in m² ein, etwa „61,5“.` })
      return { address: c.address, location: c.location, areaM2: area ?? 0, centsPerM2: cents(`comparables.${i}.centsPerM2`, c.perM2) ?? 0 }
    }) : [],
    recipientName: v.recipientName,
    severalLandlords: v.severalLandlords,
    allLandlordsNamed: v.allLandlordsNamed && !senderMissing,
    allTenantsNamed: v.allTenantsNamed,
    extraParagraph: v.extraParagraph,
  }
  const checked = rentIncreaseLetterOf(raw, kind, { senderMissing })
  if ('problems' in checked) {
    for (const p of checked.problems) if (!problems.some((x) => x.field === p.field)) problems.push({ field: p.field, text: p.text })
  }
  if (problems.length > 0) return { problems }
  return 'letter' in checked ? { body: checked.letter } : { problems }
}

// Hinweise, die nichts sperren: ein alter Mietspiegel (S5), eine verlangte Miete je m² über dem Oberwert der Spanne eines
// genannten Mietspiegels (Durchsicht S2) oder über der niedrigsten Vergleichswohnung (M7, verbreitete Praxis,
// Rechtsfolge umstritten). Je m² zählt die Miete ohne enthaltene Betriebskosten.
export function rentLetterWarnings(letter: RentIncreaseLetterInput, plan: RentIncreasePlan | null, today: string): string[] {
  const out: string[] = []
  const cmp = plan?.comparison
  for (const s of [letter.survey, letter.qualified]) {
    if (!s) continue
    if (surveyStale(s.asOf, today)) out.push(`Der Mietspiegel „${s.name}“ hat den Stand ${monthLabel(s.asOf)}. Ein älterer Mietspiegel darf nur verwendet werden, wenn es keinen neueren gibt (§ 558a Abs. 4 Satz 2 BGB); prüfen Sie, ob die Gemeinde inzwischen einen neueren hat.`)
    if (cmp && plan.newCents !== null && cmp.areaM2 > 0 && s.rangeHighCentsPerM2 !== null) {
      const net = plan.newCents - (cmp.operatingCostsCents ?? 0)
      if (net > s.rangeHighCentsPerM2 * cmp.areaM2) out.push(`Die verlangte Miete von ${fmtEuro(Math.floor(net / cmp.areaM2))} je m² liegt über dem Oberwert der Spanne (${fmtEuro(s.rangeHighCentsPerM2)} je m²) im Mietspiegel „${s.name}“. Über die Spanne hinaus trägt der Mietspiegel die Erhöhung nicht; prüfen Sie Vergleichsmiete und Einordnung.`)
    }
  }
  if (letter.justification === 'comparables' && cmp && plan.newCents !== null && letter.comparables.length > 0) {
    const lowest = Math.min(...letter.comparables.map((c) => c.centsPerM2))
    const net = plan.newCents - (cmp.operatingCostsCents ?? 0)
    if (net > lowest * cmp.areaM2) out.push(`Die verlangte Miete liegt über der niedrigsten Miete der Vergleichswohnungen (${fmtEuro(lowest)} je m²). Ob drei Vergleichswohnungen eine höhere Miete tragen, ist umstritten; sicher ist eine Miete bis zur niedrigsten.`)
  }
  return out
}

// ---------- Verlangen und Erklärungen (Liste im Seitenfenster) ----------

// Ein Entwurf, dessen Rechnung „noch nicht möglich“ sagt (Durchsicht S1): Das Schreiben darf erst ab dem frühesten Zugang
// ankommen. Steht auf der Karte und in der Rückfrage vor dem Druck; auf das Blatt kommt er nicht (DIN 5008 legt Briefkopf
// und Anschriftfeld fest, und gedruckt wird das Schreiben, das der Mieter bekommt).
export function notYetNote(x: { status: RentIncrease['status']; basis: Pick<RentIncreaseBasis, 'plan'> }): string | null {
  const p = x.basis.plan
  if (x.status !== 'draft' || p.state !== 'notYet' || p.earliestReceivedOn === null) return null
  return `Nicht vor dem ${fmtDate(p.earliestReceivedOn)} zugehen lassen. Ein früherer Zugang hält die gesetzlichen Fristen nicht ein; als versendet speichern lässt sich das Schreiben erst mit einem Zugang ab diesem Tag.`
}

// Weicht der heutige Absender (Einstellungen bzw. Objekt) vom eingefrorenen ab, etwa nach dem Verschieben der Wohnung in
// ein anderes Objekt (#657) oder einem Wechsel des Vermieters (Durchsicht K2)? Der Nachdruck bleibt beim Absender des
// Schreibens; die Antwort des Mieters gehört zum Vermieter, von dem das Verlangen ausging.
export function senderNote(frozen: { name: string; address: string }, current: { landlordName: string; landlordAddress: string } | null): string | null {
  if (!current) return null
  const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ')
  if (same(frozen.name, current.landlordName) && same(frozen.address, current.landlordAddress)) return null
  const show = (name: string, address: string) => `„${name.trim() || 'ohne Namen'}“${address.trim() !== '' ? ` (${address.trim()})` : ''}`
  return `Das Schreiben nennt als Absender ${show(frozen.name, frozen.address)}, heute stünde dort ${show(current.landlordName, current.landlordAddress)}. Ein Nachdruck bleibt beim Absender des Schreibens. Prüfen Sie, ob das Verlangen noch vom richtigen Vermieter ausgeht; sonst nehmen Sie es zurück und legen ein neues an.`
}

export const RENT_INCREASE_STATUS_LABELS: Record<RentIncreaseStatus, string> = {
  draft: 'Entwurf',
  sent: 'Versandt',
  agreed: 'Zugestimmt',
  partial: 'Teilweise zugestimmt',
  refused: 'Abgelehnt',
  withdrawn: 'Zurückgenommen',
}
// Beschriftung der Knöpfe; „Zurücknehmen …“ steht als Gefahrknopf im Seitenfenster selbst.
export const DECISION_LABELS: Record<RentIncreaseDecision, string> = {
  agreed: 'Zugestimmt …',
  partial: 'Teilweise zugestimmt …',
  refused: 'Abgelehnt …',
  withdrawn: 'Zurücknehmen …',
}

// Welche Antworten zu einem Stand passen (wie rentIncreaseSave.ts auf dem Server): Zustimmung und Ablehnung nur beim
// Verlangen nach § 558 BGB, zurücknehmen nach dem Versand immer.
export function rentIncreaseDecisions(x: Pick<RentIncrease, 'kind' | 'status'>): RentIncreaseDecision[] {
  if (x.status === 'draft' || x.status === 'withdrawn') return []
  if (x.kind === 'index') return ['withdrawn']
  if (x.status === 'sent') return ['agreed', 'partial', 'refused', 'withdrawn']
  if (x.status === 'refused') return ['agreed', 'partial', 'withdrawn']
  return ['withdrawn']
}

export type RentQuestion = { title: string; message: string; confirmLabel: string; danger?: boolean }

// `nameless`: Der eingefrorene Absender trägt keinen Namen. Mit dem Versand wird das wirksam, deshalb steht der Satz in
// der Rückfrage (`SENDER_MISSING_SEND`); gesperrt wird nichts, der Name kann von Hand auf dem Schriftstück stehen.
export function sendQuestion(x: Pick<RentIncrease, 'kind' | 'toCents' | 'effectiveFrom'>, receivedOn: string, nameless = false): RentQuestion {
  const message = x.kind === 'index'
    ? `Gespeichert wird der Zugang am ${fmtDate(receivedOn)}. Eine Anpassung der Indexmiete wirkt ohne Zustimmung: Mietfuchs trägt die neue Miete von ${fmtEuro(x.toCents)} ab ${monthLabel(x.effectiveFrom)} in die Kaltmiete-Staffel ein.`
    : `Gespeichert wird der Zugang am ${fmtDate(receivedOn)}; Mietfuchs rechnet die Fristen damit neu. Die neue Miete trägt Mietfuchs erst ein, wenn Sie die Zustimmung des Mieters eintragen.`
  return { title: 'Als versendet speichern?', confirmLabel: 'Speichern', message: nameless ? `${message} ${SENDER_MISSING_SEND}` : message }
}

export function decisionQuestion(x: Pick<RentIncrease, 'kind' | 'toCents' | 'effectiveFrom'>, decision: RentIncreaseDecision, agreedCents: number | null): RentQuestion {
  const silence = 'Schweigen ist keine Zustimmung: Antwortet der Mieter bis zum Ende der Frist nicht, bleibt nur die Klage auf Zustimmung (§ 558b Abs. 2 BGB).'
  switch (decision) {
    case 'agreed':
      return { title: 'Zustimmung eintragen?', confirmLabel: 'Eintragen', message: `Tragen Sie die Zustimmung nur ein, wenn der Mieter zugestimmt hat: schriftlich, mündlich oder indem er die erhöhte Miete vorbehaltlos zahlt. ${silence} Mietfuchs trägt ${fmtEuro(x.toCents)} ab ${monthLabel(x.effectiveFrom)} in die Kaltmiete-Staffel ein.` }
    case 'partial':
      return { title: 'Teilweise Zustimmung eintragen?', confirmLabel: 'Eintragen', message: `Der Mieter hat einer Miete von ${agreedCents === null ? '…' : fmtEuro(agreedCents)} zugestimmt, nicht den verlangten ${fmtEuro(x.toCents)}. ${silence} Mietfuchs trägt die zugestimmte Miete ab ${monthLabel(x.effectiveFrom)} in die Kaltmiete-Staffel ein; für den Rest bleibt die Klage.` }
    case 'refused':
      return { title: 'Ablehnung eintragen?', confirmLabel: 'Eintragen', message: 'Die Kaltmiete bleibt unverändert. Stimmt der Mieter später doch zu, etwa im Rechtsstreit, tragen Sie das hier nach.' }
    case 'withdrawn':
      return { title: 'Zurücknehmen?', confirmLabel: 'Zurücknehmen', danger: true, message: x.kind === 'index' ? 'Die eingetragene Stufe nimmt Mietfuchs aus der Kaltmiete-Staffel, wenn sie seither unverändert ist.' : 'Eine schon eingetragene Stufe nimmt Mietfuchs aus der Kaltmiete-Staffel, wenn sie seither unverändert ist. Das Verlangen bleibt mit dem Stand „Zurückgenommen“ in der Liste.' }
  }
}

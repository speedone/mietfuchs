// Das Bearbeiten des Anschreibens (#415), ohne DOM prüfbar: welche Texte eine Ebene selbst führt, was
// beim Speichern geschickt wird, und was die Prüfung meldet. Die Prüfung der Platzhalter ist dieselbe
// wie beim Server (`templateProblems` in shared/letter.ts); was hier durchgeht, lehnt er nicht ab.
import type { LetterAdjustmentMode, LetterBlock, LetterField, LetterTexts } from './types'
import { blockLabel, DEFAULT_LETTER_TEXTS, LETTER_BLOCK_IDS, resolveTemplate, templateProblems, unmaskLetterText } from '../../shared/letter.ts'
import { fmtEuro, parseEuro } from './api'
import type { Problem } from './formProblems'
import { andList } from '../../shared/wording.ts'
import { secondPrepaymentLabel } from '../../shared/heatingModel.ts'

export type LetterLevel = 'installation' | 'property' | 'tenancy'
export type LetterFieldKey = LetterBlock | 'customCents' | 'customHeatingCents' | 'adjustFrom'

// Je Baustein der eigene Text dieser Ebene oder `null`, wenn die Ebene darüber gilt.
export type OwnTexts = Record<LetterBlock, string | null>
export type LetterDraft = {
  own: OwnTexts
  // Installation: die Vorgabe der Anpassung (ohne eigenen Betrag); Mieter: seine Wahl.
  adjust: LetterAdjustmentMode
  // Mieter: Gilt eine eigene Wahl? `false` nach „Anpassung auf Vorgabe zurücksetzen“ (Durchsicht K6).
  adjustOwn: boolean
  customCents: string
  // #704: beim eigenen Betrag der Teil für Heizung und Warmwasser, wenn das Mietverhältnis zwei Staffeln führt
  customHeatingCents?: string
  // #317: der Monat, ab dem die Anpassung gilt; `null` heißt die Vorgabe (übernächster Monat nach dem Tag des Briefs).
  adjustFrom?: string | null
  // Teil 2: „Anschreiben mitdrucken“ der Ebene; `null` am Objekt heißt „wie die Vorgabe“.
  printLetter?: boolean | null
}

export const ownOf = (texts: LetterTexts | null | undefined): OwnTexts =>
  Object.fromEntries(LETTER_BLOCK_IDS.map((b) => [b, typeof texts?.[b] === 'string' ? texts[b] : null])) as OwnTexts

export const shownText = (draft: LetterDraft, base: Record<LetterBlock, string>, block: LetterBlock): string => draft.own[block] ?? base[block]

// Nur, was sich geändert hat: Ein Baustein, den niemand angefasst hat, bleibt auf seiner Ebene (eine
// geerbte Vorlage würde sonst als eigene gespeichert und folgte späteren Änderungen nicht mehr).
export function textChanges(saved: OwnTexts, draft: OwnTexts): Partial<Record<LetterBlock, string | null>> {
  const out: Partial<Record<LetterBlock, string | null>> = {}
  for (const b of LETTER_BLOCK_IDS) if (saved[b] !== draft[b]) out[b] = draft[b]
  return out
}

// Ein Text, der genau der Vorlage darüber gleicht, ist keine eigene Angabe.
export function setText(draft: LetterDraft, base: Record<LetterBlock, string>, block: LetterBlock, text: string): LetterDraft {
  return { ...draft, own: { ...draft.own, [block]: text === base[block] ? null : text } }
}

// `split` (#704): Das Mietverhältnis führt zwei Staffeln, und der neue Betrag gilt beiden; dann gehört zum eigenen Betrag sein
// Teil für Heizung und Warmwasser, sonst ließe sich die Anpassung später nicht in die Staffeln übernehmen.
export function letterProblems(draft: LetterDraft, base: Record<LetterBlock, string>, level: LetterLevel, options: { split?: boolean; coversWater?: boolean } = {}): Problem<LetterFieldKey>[] {
  const out: Problem<LetterFieldKey>[] = []
  for (const b of LETTER_BLOCK_IDS) {
    const problems = templateProblems(b, shownText(draft, base, b))
    if (problems.length > 0) out.push({ field: b, short: problems.join(' '), text: `${blockLabel(b)}: ${problems.join(' ')}` })
  }
  if (level === 'tenancy' && draft.adjust !== 'none' && draft.adjustFrom != null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.adjustFrom)) {
    out.push({ field: 'adjustFrom', short: 'Kein Monat', text: 'Ab Monat: Geben Sie einen Monat ein, etwa „Januar 2027“.' })
  }
  if (level === 'tenancy' && draft.adjust === 'custom' && customCentsOf(draft) === null) {
    out.push({ field: 'customCents', short: 'Betrag fehlt oder ist ungültig', text: 'Neue monatliche Vorauszahlung: Geben Sie einen Betrag in Euro ein, etwa 105,00.' })
  }
  if (level === 'tenancy' && draft.adjust === 'custom' && options.split === true) {
    const total = customCentsOf(draft)
    const heating = customHeatingCentsOf(draft)
    // #712: Das Feld heißt, wie die zweite Vorauszahlung an der Heizanlage geführt wird.
    const field = `Davon für ${secondPrepaymentLabel(options.coversWater)}`
    if (heating === null) out.push({ field: 'customHeatingCents', short: 'Betrag fehlt oder ist ungültig', text: `${field}: Geben Sie einen Betrag in Euro ein, etwa 45,00; ohne ${options.coversWater === true ? 'diese Vorauszahlung' : 'Heizvorauszahlung'} 0.` })
    else if (total !== null && heating > total) out.push({ field: 'customHeatingCents', short: 'Liegt über der neuen Vorauszahlung', text: `${field}: Der Teil liegt über der neuen Vorauszahlung.` })
  }
  return out
}

export function customHeatingCentsOf(draft: Pick<LetterDraft, 'customHeatingCents'>): number | null {
  const cents = parseEuro(draft.customHeatingCents ?? '')
  return cents === null || cents < 0 ? null : cents
}

export function customCentsOf(draft: Pick<LetterDraft, 'customCents'>): number | null {
  const cents = parseEuro(draft.customCents)
  return cents === null || cents < 0 ? null : cents
}

// Setzt einen Platzhalter an die Stelle der Einfügemarke (oder ersetzt die Auswahl).
export function insertField(text: string, start: number, end: number, field: LetterField): { text: string, caret: number } {
  const token = `{${field}}`
  const a = Math.max(0, Math.min(start, text.length))
  const b = Math.max(a, Math.min(end, text.length))
  return { text: text.slice(0, a) + token + text.slice(b), caret: a + token.length }
}

// Die Vorschau eines Bausteins mit den Werten des Mieters (oder Beispielwerten); was nicht stimmt, bleibt
// sichtbar stehen.
export const previewOf = (text: string, values: Partial<Record<LetterField, string>>): string => unmaskLetterText(resolveTemplate(text, values))

// Der neue Betrag, wie der Entwurf ihn ankündigt, formatiert für die Vorschau (Durchsicht S4).
export function draftNewCents(draft: Pick<LetterDraft, 'adjust' | 'customCents'>, suggestedCents: number): string {
  if (draft.adjust === 'custom') {
    const cents = customCentsOf(draft)
    return cents === null ? '' : fmtEuro(cents)
  }
  return draft.adjust === 'suggestion' && suggestedCents > 0 ? fmtEuro(suggestedCents) : ''
}

// #704: Ein eigener Text der Anpassung ohne {Aufteilung} nennt die Teile für Heizung und übrige Nebenkosten nicht; welcher
// Baustein das ist, wie bei `monthlessAdjustTexts`. Gefragt wird nur bei einem Mietverhältnis mit zwei Staffeln.
export function splitlessAdjustTexts(draft: LetterDraft, base: Record<LetterBlock, string>, level: LetterLevel): LetterBlock[] {
  const blocks: LetterBlock[] = level === 'tenancy'
    ? (draft.adjust === 'none' ? [] : [draft.adjust === 'custom' ? 'adjustCustom' : 'adjustSuggestion'])
    : (['adjustSuggestion', 'adjustCustom'] as const).filter((b) => draft.own[b] !== null)
  return blocks.filter((b) => { const text = shownText(draft, base, b); return text.trim() !== '' && !text.includes('{Aufteilung}') })
}

// #317: Ein Monat, der nicht nach dem laufenden liegt, wirkte zurück; die Anpassung gilt nur für die Zukunft.
export function adjustFromHint(from: string, today: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(from) || from > today.slice(0, 7)) return null
  return 'Der Monat liegt nicht in der Zukunft. Eine Anpassung der Vorauszahlungen ist nur für die Zukunft möglich (BGH, VIII ZR 271/10, Leitsatz 2); wählen Sie einen späteren Monat.'
}

// #317: Ein eigener Text ohne {AnpassungAb} nennt den Monat nicht, übernommen wird aber ab diesem Monat.
export const adjustTextLacksMonth = (text: string): boolean => text.trim() !== '' && !text.includes('{AnpassungAb}')

// Welche Bausteine zur Anpassung den Monat nicht nennen (K3 der Durchsicht zu PR #435): beim Mieter der seiner gewählten
// Anpassung, auf Installation und Objekt jeder eigene Text der beiden Bausteine.
export function monthlessAdjustTexts(draft: LetterDraft, base: Record<LetterBlock, string>, level: LetterLevel): LetterBlock[] {
  const blocks: LetterBlock[] = level === 'tenancy'
    ? (draft.adjust === 'none' ? [] : [draft.adjust === 'custom' ? 'adjustCustom' : 'adjustSuggestion'])
    : (['adjustSuggestion', 'adjustCustom'] as const).filter((b) => draft.own[b] !== null)
  return blocks.filter((b) => adjustTextLacksMonth(shownText(draft, base, b)))
}

// #691, Durchsicht: Ein eigener Text zum Guthaben in der Vorlage oder am Objekt gilt nicht für Mieter, deren
// Mietverhältnis beendet ist; für sie steht „Guthaben nach dem Auszug“. Das Fenster sagt es, solange dieser Baustein auf
// keiner Ebene einen eigenen Text hat (`base` gleich der Vorgabe). Beim Mieter gilt sein eigener Text zum Guthaben ohnehin.
export const CREDIT_MOVED_OUT_HINT = 'Ihr eigener Text zum Guthaben gilt nicht für Mieter, deren Mietverhältnis beendet ist; für sie steht der Satz von Mietfuchs, der nach der Bankverbindung fragt. Soll Ihr Wortlaut auch dort stehen: Text für „Guthaben nach dem Auszug“ anpassen.'
// Dasselbe in „Zu prüfen“ der Seite Abrechnung, je ausgezogenem Mieter mit Guthaben (`creditTextUnused` in shared/letter.ts)
export const CREDIT_MOVED_OUT_PAGE_TEXT = 'Ihr eigener Text zum Guthaben aus der Vorlage oder für dieses Objekt gilt nicht für Mieter, deren Mietverhältnis beendet ist; dieses Anschreiben trägt den Satz von Mietfuchs, der nach der Bankverbindung fragt. Soll Ihr Wortlaut auch hier stehen: Text für „Guthaben nach dem Auszug“ anpassen, in den Einstellungen unter „Anschreiben zur Abrechnung“ oder unter „Mehr“ mit „Vorlage für dieses Objekt bearbeiten“.'
export function creditMovedOutHint(draft: LetterDraft, base: Record<LetterBlock, string>, level: LetterLevel): boolean {
  if (level === 'tenancy') return false
  const ownCredit = draft.own.credit !== null || base.credit !== DEFAULT_LETTER_TEXTS.credit
  return ownCredit && draft.own.creditMovedOut === null && base.creditMovedOut === DEFAULT_LETTER_TEXTS.creditMovedOut
}

// Druck (#415): Ohne eingetragene Anrede beginnt der Brief mit „Guten Tag {Name},“. Das Seitenfenster sagt es, solange der
// Baustein die Anrede des Mietverhältnisses nimmt ({Anrede}), und nennt, wo eine persönliche eingetragen wird. `names`: die
// Mieter ohne Anrede, `total`: alle Mieter, für die das Fenster gilt.
const SALUTATION_WHERE = 'Eine persönliche Anrede wie „Sehr geehrte Frau Becker“ tragen Sie in den Stammdaten beim Mietverhältnis ein, im Feld „Anrede im Brief“.'
export function salutationHint(names: readonly string[], total: number, salutationText: string): string | null {
  if (names.length === 0 || !salutationText.includes('{Anrede}')) return null
  if (names.length === 1 && total === 1) return `Für ${names[0]} ist keine Anrede eingetragen; der Brief beginnt mit „Guten Tag ${names[0]},“. ${SALUTATION_WHERE}`
  return `Für ${names.length} von ${total} Mietern (${andList(names)}) ist keine Anrede eingetragen; deren Brief beginnt mit „Guten Tag {Name},“. ${SALUTATION_WHERE}`
}

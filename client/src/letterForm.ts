// Das Bearbeiten des Anschreibens (#415), ohne DOM prüfbar: welche Texte eine Ebene selbst führt, was
// beim Speichern geschickt wird, und was die Prüfung meldet. Die Prüfung der Platzhalter ist dieselbe
// wie beim Server (`templateProblems` in shared/letter.ts); was hier durchgeht, lehnt er nicht ab.
import type { LetterAdjustmentMode, LetterBlock, LetterField, LetterTexts } from './types'
import { blockLabel, LETTER_BLOCK_IDS, resolveTemplate, templateProblems, unmaskLetterText } from '../../shared/letter.ts'
import { fmtEuro, parseEuro } from './api'
import type { Problem } from './formProblems'

export type LetterLevel = 'installation' | 'property' | 'tenancy'
export type LetterFieldKey = LetterBlock | 'customCents'

// Je Baustein der eigene Text dieser Ebene oder `null`, wenn die Ebene darüber gilt.
export type OwnTexts = Record<LetterBlock, string | null>
export type LetterDraft = {
  own: OwnTexts
  // Installation: die Vorgabe der Anpassung (ohne eigenen Betrag); Mieter: seine Wahl.
  adjust: LetterAdjustmentMode
  // Mieter: Gilt eine eigene Wahl? `false` nach „Anpassung auf Vorgabe zurücksetzen“ (Durchsicht K6).
  adjustOwn: boolean
  customCents: string
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

export function letterProblems(draft: LetterDraft, base: Record<LetterBlock, string>, level: LetterLevel): Problem<LetterFieldKey>[] {
  const out: Problem<LetterFieldKey>[] = []
  for (const b of LETTER_BLOCK_IDS) {
    const problems = templateProblems(b, shownText(draft, base, b))
    if (problems.length > 0) out.push({ field: b, short: problems.join(' '), text: `${blockLabel(b)}: ${problems.join(' ')}` })
  }
  if (level === 'tenancy' && draft.adjust === 'custom' && customCentsOf(draft) === null) {
    out.push({ field: 'customCents', short: 'Betrag fehlt oder ist ungültig', text: 'Neue monatliche Vorauszahlung: Geben Sie einen Betrag in Euro ein, etwa 105,00.' })
  }
  return out
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

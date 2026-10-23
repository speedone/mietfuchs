// Anschreiben und Ergebniskasten der gedruckten Abrechnung (#415), ohne DOM prüfbar. Gerechnet wird
// hier nichts: Die Texte setzt der Server ein (shared/letter.ts), die Zahlen stammen aus der Abrechnung.
import type { LetterBlock, LetterTemplates, Property, Settings, Settlement, Statement, StatementLetter, Tenancy } from './types'
import { chooseLetterBlocks, lettersOf, renderLetterText } from '../../shared/letter.ts'
import { fmtDate, fmtEuro } from './api'
import { countOf } from '../../shared/wording.ts'

// Eine Antwort von /api/letter-texts, wie sie sein soll; ein älterer Server oder eine Testattrappe liefert
// etwas anderes, dann gibt es nichts zu bearbeiten, und die Seite bleibt bedienbar.
export const asTemplates = (x: unknown): LetterTemplates | null =>
  x !== null && typeof x === 'object' && !Array.isArray(x) && 'defaults' in x && 'installation' in x ? (x as LetterTemplates) : null

export type LetterParagraph = { block: LetterBlock, text: string }

// Das Anschreiben eines Mieters, wie es gedruckt wird: die Bausteine, die Mietfuchs für ihn wählt, mit
// Datum und Zahl der Belege. Ohne Anschreiben in der Antwort (ein älterer Server) entsteht es aus den
// Vorgaben von Mietfuchs, wie der Server es für eine vor #415 abgeschlossene Abrechnung täte.
export function letterOf(
  data: Settlement,
  st: Statement,
  ctx: { settings: Pick<Settings, 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'printAdjustSuggestion'> | null, property: Property | null, tenancies: readonly Tenancy[] },
): StatementLetter {
  const own = data.letters?.[st.tenancyId]
  if (own) return own
  const settings = ctx.settings ?? { landlordName: '', iban: '', paymentDeadlineDays: 30 }
  const built = lettersOf({ ...data, statements: [st] }, { settings, property: ctx.property, tenancies: ctx.tenancies, installation: {}, propertyTexts: {}, own: {} })
  const letter = built[st.tenancyId]
  if (!letter) throw new Error('Das Anschreiben ließ sich nicht zusammenstellen.')
  return letter
}

export function letterParagraphs(letter: StatementLetter, balanceCents: number, print: { date: string, attachments: number }): LetterParagraph[] {
  return chooseLetterBlocks(letter, balanceCents, print.attachments).map((block) => ({ block, text: renderLetterText(letter.texts[block], print) }))
}

// Die Rücksendeangabe steht im Druck in höchstens zwei Zeilen zu 7 pt über der Anschrift (letter.css). Rund 55 Zeichen je
// Zeile bei Umbruch an Wortgrenzen; was länger ist, nennt die Seite vor dem Druck, statt es still abzuschneiden
// (Durchsicht zu PR #427, K7, nachgemessen mit page.pdf).
export const RETURN_LINE_MAX = 110
export const returnLineTooLong = (line: string): boolean => line.trim().length > RETURN_LINE_MAX

// Der Ergebniskasten oben in der Aufstellung: Zeitraum, Kosten, Vorauszahlungen, Ergebnis, Frist. Die
// Nachzahlung steht neutral fett, nicht rot: In Rot las sie sich wie eine Mahnung.
export type ResultRow = { label: string, value: string, strong?: boolean }
export function resultRows(st: Statement, paymentDeadlineDays: number | null | undefined): ResultRow[] {
  const rows: ResultRow[] = [
    { label: 'Zeitraum', value: `${fmtDate(st.periodStart)} – ${fmtDate(st.periodEnd)} (${countOf(st.days, 'Tag', 'Tage')})` },
    { label: 'Ihre Kosten', value: fmtEuro(st.totalShareCents) },
    { label: 'Ihre Vorauszahlungen', value: fmtEuro(st.prepaymentCents) },
  ]
  if (st.balanceCents < 0) {
    rows.push({ label: 'Nachzahlung', value: fmtEuro(-st.balanceCents), strong: true })
    rows.push({ label: 'Zahlbar', value: `innerhalb von ${paymentDeadlineDays || 30} Tagen nach Zugang` })
  } else if (st.balanceCents > 0) {
    rows.push({ label: 'Guthaben', value: fmtEuro(st.balanceCents), strong: true })
  } else {
    rows.push({ label: 'Ergebnis', value: 'ausgeglichen', strong: true })
  }
  return rows
}

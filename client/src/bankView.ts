// Logik der Seite „Kontoauszug“ (#188, Teil 3): aus dem Vorschlag des Servers die Vorauswahl einer Zeile, aus den Zeilen
// die Entscheidungen, Auswahllisten und Sätze. Rechnet kein Geld; Vorschlag, offener Betrag und Ergebnis kommen fertig
// vom Server. Nichts davon wird im Browser abgelegt: Private Umsätze stehen nur in den Rückfragen der Vorschau.

import type { Problem } from './formProblems'
import type { BankAccountInfo, BankImportDecision, BankImportQuestion, BankLinkDecision, BankLinkTarget, BankSetAside, BankTransactionView } from './types'

export type RowTarget = 'rent' | 'settlement' | 'depositReceived' | 'depositRefunded' | 'existingPayment' | 'existingDeposit'

// Ein Teil einer Zeile: ein Umsatz lässt sich auf mehrere Mietverhältnisse aufteilen.
// `key` ist fest je Teil (Durchsicht Teil 3, W2: ein Feld darf beim Entfernen nicht den Text eines anderen Teils
// behalten); `amountText` ist die Eingabe im Betragsfeld, solange sie nicht als Betrag lesbar ist.
export type RowPart = { key: string; tenancyId: string | null; target: RowTarget | null; refId?: string; amountCents: number; amountText?: string }
export type BankRow = { tx: BankTransactionView; parts: RowPart[]; selected: boolean; setAside: BankSetAside | null }

export const BANK_TARGET_OPTIONS: readonly { value: RowTarget; label: string }[] = [
  { value: 'rent', label: 'Miete' },
  { value: 'settlement', label: 'Nachzahlung oder Guthaben' },
  { value: 'depositReceived', label: 'Kaution erhalten' },
  { value: 'depositRefunded', label: 'Kaution zurückgezahlt' },
  { value: 'existingPayment', label: 'mit erfasster Zahlung verknüpfen' },
  { value: 'existingDeposit', label: 'mit erfasster Kautionsbuchung verknüpfen' },
]

export const SET_ASIDE_OPTIONS: readonly { value: BankSetAside; label: string }[] = [
  { value: 'transfer', label: 'Umbuchung zwischen eigenen Konten' },
  { value: 'notRental', label: 'gehört nicht zur Vermietung' },
  { value: 'other', label: 'Sonstiges' },
]

function rowTargetOf(target: BankLinkTarget): { target: RowTarget; refId?: string } {
  switch (target.type) {
    case 'newPayment': return { target: target.kind === 'settlement' ? 'settlement' : 'rent' }
    case 'deposit': return { target: target.kind === 'received' ? 'depositReceived' : 'depositRefunded' }
    case 'existingPayment': return { target: 'existingPayment', refId: target.paymentId }
    case 'existingDeposit': return { target: 'existingDeposit', refId: target.depositEntryId }
  }
}

function linkTargetOf(part: RowPart): BankLinkTarget | null {
  switch (part.target) {
    case 'rent': return { type: 'newPayment', kind: 'rent' }
    case 'settlement': return { type: 'newPayment', kind: 'settlement' }
    case 'depositReceived': return { type: 'deposit', kind: 'received' }
    case 'depositRefunded': return { type: 'deposit', kind: 'refunded' }
    case 'existingPayment': return part.refId ? { type: 'existingPayment', paymentId: part.refId } : null
    case 'existingDeposit': return part.refId ? { type: 'existingDeposit', depositEntryId: part.refId } : null
    case null: return null
  }
}

export function initialRow(tx: BankTransactionView): BankRow {
  const s = tx.suggestion
  const key = `${tx.id}:0`
  const part: RowPart = s ? { key, tenancyId: s.tenancyId, ...rowTargetOf(s.target), amountCents: tx.openCents } : { key, tenancyId: null, target: null, amountCents: tx.openCents }
  return { tx, parts: [part], selected: false, setAside: null }
}

// Warum eine Zeile so nicht buchbar ist, oder null. Ob die Teile den Umsatz übersteigen, sagt der Server.
export function rowProblem(row: BankRow): string | null {
  if (row.setAside) return null
  if (row.parts.some((p) => p.amountText !== undefined)) return 'Bitte prüfen Sie den Betrag eines Teils.'
  if (row.parts.some((p) => p.tenancyId === null || linkTargetOf(p) === null)) return 'Bitte wählen Sie Mietverhältnis und Art.'
  if (row.parts.some((p) => p.amountCents === 0)) return 'Ein Teil über 0 € lässt sich nicht buchen.'
  return null
}

export function decisionsOf(rows: readonly BankRow[]): BankLinkDecision[] {
  return rows.filter((r) => r.selected && rowProblem(r) === null).map((r): BankLinkDecision => {
    if (r.setAside) return { transactionId: r.tx.id, setAside: r.setAside }
    return { transactionId: r.tx.id, parts: r.parts.map((p) => ({ tenancyId: p.tenancyId ?? '', amountCents: p.amountCents, target: linkTargetOf(p) ?? { type: 'newPayment', kind: 'rent' } })) }
  })
}

// Einen Teil entfernen; bleibt nur einer, trägt er wieder den ganzen offenen Betrag (Durchsicht Teil 3, W1): Sonst sähe die
// Zeile aus wie vor dem Aufteilen und buchte doch nur einen Teil.
export function removePart(row: BankRow, index: number): BankRow {
  const parts = row.parts.filter((_, k) => k !== index)
  const only = parts.length === 1 ? parts[0] : undefined
  if (only) {
    const { amountText: _drop, ...rest } = only
    return { ...row, parts: [{ ...rest, amountCents: row.tx.openCents }] }
  }
  return { ...row, parts }
}

// Ob eine Zeile noch genau so steht, wie der Server sie vorschlägt.
export const isUntouched = (row: BankRow): boolean => row.setAside === null && JSON.stringify(row.parts) === JSON.stringify(initialRow(row.tx).parts)

// „Alle grünen übernehmen“ nimmt nur grüne Zeilen, die noch wie vorgeschlagen stehen (Durchsicht Teil 3, W3): Eine
// abweichende Wahl, etwa „gehört nicht zur Vermietung“, übergeht der Sammelknopf nie.
export const untouchedGreen = (rows: readonly BankRow[]): BankRow[] => rows.filter((r) => r.tx.suggestion?.light === 'green' && isUntouched(r))

export const greenRows = (txs: readonly BankTransactionView[]): BankTransactionView[] => txs.filter((t) => t.suggestion?.light === 'green')

// Die Arten, die zur Richtung des Umsatzes passen; „verknüpfen“ nur, wenn der Server eine erfasste Buchung vorschlägt.
// Der gewählte Wert steht immer in der Liste, sonst zeigte das Auswahlfeld etwas anderes, als gesendet wird.
export function targetOptionsFor(tx: BankTransactionView, chosen: RowTarget | null = null): { value: RowTarget; label: string }[] {
  const wanted = new Set<RowTarget>(['rent', 'settlement', tx.openCents > 0 ? 'depositReceived' : 'depositRefunded'])
  const t = tx.suggestion?.target.type
  if (t === 'existingPayment') wanted.add('existingPayment')
  if (t === 'existingDeposit') wanted.add('existingDeposit')
  if (chosen) wanted.add(chosen)
  return BANK_TARGET_OPTIONS.filter((o) => wanted.has(o.value))
}

const germanDay = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

// Wortlaut der Spec: nie „Einnahmen vollständig“, nur ob das Konto lückenlos eingelesen ist.
export function coverageText(a: Pick<BankAccountInfo, 'coverage'>): string {
  const c = a.coverage
  if (c === null) return 'Ob das Konto lückenlos eingelesen ist, lässt sich erst mit Auszügen sagen, die Anfangs- und Endsaldo nennen.'
  if ('from' in c) return `Konto lückenlos eingelesen vom ${germanDay(c.from)} bis ${germanDay(c.to)}.`
  return `Zwischen ${germanDay(c.gapAfter)} und ${germanDay(c.gapBefore)} fehlt ein Auszug oder die Salden schließen nicht an.`
}

export type QuestionAnswer = { accept?: boolean; as?: 'rent' | 'deposit' | 'private'; tenancyId?: string; rememberPayer?: boolean }
export const questionKey = (q: BankImportQuestion): string => (q.type === 'account' ? `account:${q.iban ?? q.otherId ?? ''}` : `entry:${q.key}`)

// Jede Rückfrage braucht eine Antwort; „Mieteingang“ und „Kaution“ brauchen ein Mietverhältnis.
export function questionProblems(questions: readonly BankImportQuestion[], answers: Readonly<Record<string, QuestionAnswer>>): Problem[] {
  const out: Problem[] = []
  for (const q of questions) {
    const key = questionKey(q)
    const a = answers[key]
    if (q.type === 'account') {
      if (a?.accept === undefined) out.push({ field: key, text: `Bitte sagen Sie, ob ${q.iban ?? q.otherId ?? 'das Konto'} Ihr Konto für Mieteingänge ist.`, short: 'Bitte wählen Sie.' })
    } else if (!a?.as) {
      out.push({ field: key, text: `Bitte sagen Sie, was der Eingang vom ${germanDay(q.bookingDate)} ist.`, short: 'Bitte wählen Sie.' })
    } else if (a.as !== 'private' && !a.tenancyId) {
      out.push({ field: key, text: `Bitte wählen Sie das Mietverhältnis zum Eingang vom ${germanDay(q.bookingDate)}.`, short: 'Bitte wählen Sie das Mietverhältnis.' })
    }
  }
  return out
}

// Die Antworten als Entscheidungen für den Server.
export function importDecisionsOf(questions: readonly BankImportQuestion[], answers: Readonly<Record<string, QuestionAnswer>>): BankImportDecision[] {
  return questions.flatMap((q): BankImportDecision[] => {
    const a = answers[questionKey(q)]
    if (q.type === 'account') return a?.accept === undefined ? [] : [{ type: 'account' as const, iban: q.iban ?? q.otherId ?? '', accept: a.accept }]
    if (!a?.as) return []
    return [{ type: 'entry' as const, key: q.key, as: a.as, ...(a.tenancyId ? { tenancyId: a.tenancyId } : {}), ...(a.rememberPayer && a.as === 'rent' ? { rememberPayer: true } : {}) }]
  })
}

// Vorschlag zu einer Rückfrage beim Einlesen (#188, Nachtrag 13.11.): Fragt die Vorschau nach einem Eingang von
// unbekannter IBAN, schlägt sie ein Mietverhältnis vor, wenn Name und Betrag zu genau einem passen. Der Name allein ist
// kein Beleg (dieselbe Person kann privat überweisen), deshalb nur zusammen mit dem Betrag, und der Vermieter bestätigt
// mit „Einlesen“. Der Vorschlag ändert den Plan nicht und steht nicht in der Prüfmarke.
import type { BankImportQuestion } from '../../../shared/types.ts'
import { addIsoDays } from './coverage.ts'

export type SuggestTenancy = { id: string; tenantName: string; start: string; end: string | null }
export type ImportSuggestion = { tenancyId: string; reason: string }

// Anreden und Zusätze, die in Kontoauszügen vor dem Namen stehen und nichts unterscheiden.
const FILLERS = new Set(['familie', 'fam', 'herr', 'herrn', 'frau', 'eheleute', 'dr', 'prof', 'und', 'u'])

// Ein Name als Menge von Wörtern: klein, Umlaute wie im Zahlungsverkehr umschrieben (ä → ae, ß → ss), übrige
// Zeichen ohne Akzent, Bindestrich und Komma trennen.
export function nameTokens(name: string): string[] {
  const folded = name.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/ı/g, 'i')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  return [...new Set(folded.split(/[^a-z0-9]+/).filter((w) => w !== '' && !FILLERS.has(w)))]
}

const monthOf = (iso: string) => iso.slice(0, 7)
const shiftMonth = (month: string, by: number): string => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

// Ein beendetes Mietverhältnis zahlt mitunter nach; bis drei Monate nach dem Ende zählt es mit.
const AFTER_END_DAYS = 92

export function suggestForQuestion(
  q: Extract<BankImportQuestion, { type: 'entry' }>,
  tenancies: readonly SuggestTenancy[],
  monthlySollCents: (tenancyId: string, month: string) => number | null,
): ImportSuggestion | null {
  if (q.amountCents <= 0 || !q.counterpartyName) return null
  const payer = new Set(nameTokens(q.counterpartyName))
  const month = monthOf(q.bookingDate)
  const months = [month, shiftMonth(month, -1), shiftMonth(month, 1)]
  const hits = tenancies.filter((t) => {
    if (t.start > addIsoDays(q.bookingDate, 31)) return false
    if (t.end !== null && addIsoDays(t.end, AFTER_END_DAYS) < q.bookingDate) return false
    const tenant = nameTokens(t.tenantName)
    if (tenant.length === 0 || !tenant.every((w) => payer.has(w))) return false
    return months.some((m) => monthlySollCents(t.id, m) === q.amountCents)
  })
  if (hits.length !== 1) return null
  return { tenancyId: hits[0].id, reason: `Name und Betrag passen zu ${hits[0].tenantName}.` }
}

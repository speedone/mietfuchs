// Gemeinsame Gestalt eingelesener Kontoauszüge (#188), gleich aus welchem Format: camt (XML,
// camt.ts) oder MT940 (Text, mt940.ts). Was hier steht, ist nur, was auf dem Konto steht; ein
// Umsatz ist keine Zahlung: Zur Zahlung im Mietkonto wird er erst durch eine bestätigte Zuordnung.

import crypto from 'node:crypto'

export type BankBatch = {
  reference: string | null // Referenz der Sammelbuchung
  totalCents: number // Betrag der Sammelbuchung, mit Vorzeichen
  part: number // 1-basiert
  parts: number
}

export type BankEntry = {
  bookingDate: string // 'YYYY-MM-DD', Buchungstag in Deutschland
  valueDate: string | null // 'YYYY-MM-DD', Wertstellung
  amountCents: number // Eingang positiv, Ausgang negativ
  counterpartyName: string | null // die andere Seite der Zahlung, nie das eigene Konto
  counterpartyIban: string | null
  ultimatePartyName: string | null // abweichender Zahler bzw. Empfänger, etwa das Jobcenter für den Mieter
  purpose: string // Verwendungszweck, Leerraum zusammengezogen
  bankReference: string | null // Kennung der Bank, nicht zwingend eindeutig
  endToEndId: string | null // vom Zahler vergeben, oft „NOTPROVIDED“ oder je Monat gleich
  reversal: boolean // Storno bzw. Rücklastschrift
  // Der Buchungstag fehlte in der Datei (MT940 ohne MMTT in :61:) und ist die Wertstellung. Am
  // Wochenende und bei Gutschriften mit Valuta kann er vom echten Buchungstag abweichen; der Import
  // gleicht solche Umsätze deshalb nur mit Rückfrage ab.
  bookingDateEstimated: boolean
  batch: BankBatch | null // gesetzt, wenn der Umsatz ein Posten einer zerlegten Sammelbuchung ist
  // Fingerabdruck aus Buchungstag, Betrag, IBAN der Gegenseite und Verwendungszweck. Hängt nur an
  // der Buchung selbst, nicht an der Datei, dem Konto oder anderen Buchungen. Ob ein Umsatz schon
  // bekannt ist, entscheidet der Import gegen den Bestand, nicht der Leser (siehe camt.ts).
  fingerprint: string
}

export type BankStatement = {
  format: 'camt.052' | 'camt.053' | 'camt.054' | 'mt940'
  statementId: string | null
  accountIban: string | null
  accountOtherId: string | null // Kontokennung ohne IBAN (camt `Othr/Id`, MT940 `BLZ/Konto`)
  createdAt: string | null
  fromDate: string | null
  toDate: string | null
  // Anfangs- und Endsaldo, soweit der Auszug sie nennt. Anfang + Summe der Umsätze = Ende ist die
  // Probe darauf, dass kein Umsatz fehlt oder falsch gelesen wurde.
  openingBalanceCents: number | null
  closingBalanceCents: number | null
  entries: BankEntry[]
}

export type BankProblem = {
  where: string // z. B. „auszug.xml, Auszug 2025-03, Umsatz 4“
  message: string
}

export type BankReadResult = {
  statements: BankStatement[]
  problems: BankProblem[]
  pendingSkipped: number // vorgemerkte Umsätze, bewusst nicht gelesen
}

// **Der Fingerabdruck ist nicht eindeutig, und das ist gewollt.** Zwei Überweisungen eines Mieters
// am selben Tag mit gleichem Betrag und Zweck sind zwei Zahlungen und haben denselben
// Fingerabdruck; ebenso zwei Buchungen, die sich erst hinter den ersten PURPOSE_KEY_LENGTH Zeichen
// des Zwecks unterscheiden. Der Import gleicht deshalb **nach Anzahl** ab (ein Fingerabdruck,
// zweimal in der Datei und einmal im Bestand, ist einmal neu), und wo Bankreferenz oder
// Endkennung auf beiden Seiten stehen, trennen sie. Als Menge geprüft, verschwände die zweite
// Zahlung still.
//
// Der Name gehört nicht in den Fingerabdruck, weil Banken ihn zwischen camt.052 und camt.053
// verschieden kürzen; die Endkennung des Zahlers auch nicht, denn viele schicken jeden Monat
// dieselbe; und die Referenz der Bank nicht, weil camt.052 sie oft nicht trägt.
//
// Vom Verwendungszweck zählt nur ein genormter Anfang: Buchstaben und Ziffern, klein, die ersten
// PURPOSE_KEY_LENGTH. camt kürzt den Zweck auf 140 Zeichen (ein Ustrd-Feld), MT940 führt ihn in bis
// zu 14 Unterfeldern zu 27 Zeichen voll, und MT940 setzt die Unterfelder ohne Leerzeichen zusammen. Der volle Zweck ergäbe für dieselbe Buchung zwei Fingerabdrücke.
const PURPOSE_KEY_LENGTH = 100

// Umlaute werden umgeschrieben (ä → ae, ß → ss) und Akzente entfernt, bevor gefiltert wird: MT940
// im SWIFT-Zeichensatz schreibt „Maerz“ oder lässt die Zeichen weg, camt schreibt „März“.
// Die Normierung gehört zum gespeicherten Fingerabdruck; wer sie ändert, entwertet alle
// gespeicherten. Deshalb trägt sie eine Fassung (FINGERPRINT_VERSION), die der Import mitspeichert.
export const FINGERPRINT_VERSION = 1

export function purposeKey(purpose: string): string {
  return purpose.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '').slice(0, PURPOSE_KEY_LENGTH)
}

export function fingerprintOf(e: Pick<BankEntry, 'bookingDate' | 'amountCents' | 'counterpartyIban' | 'purpose'>): string {
  const source = [e.bookingDate, e.amountCents, e.counterpartyIban ?? '', purposeKey(e.purpose)].join('|')
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex')
}

// '850.00' bzw. '850,00' → 85000, '850' und '850,' → 85000. Mehr als zwei Nachkommastellen nur,
// wenn sie Null sind; gerundet wird nicht.
export function decimalToCents(raw: string, separator: '.' | ','): number | null {
  const re = separator === '.' ? /^(\d+)(?:\.(\d*))?$/ : /^(\d+)(?:,(\d*))?$/
  const m = re.exec(raw.trim())
  if (!m) return null
  const fraction = (m[2] ?? '').replace(/0+$/, '')
  if (fraction.length > 2) return null
  const cents = Number(m[1]) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

export const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

export const normalizeIban = (s: string) => s.replace(/\s+/g, '').toUpperCase()

export const problemOnly = (where: string, message: string): BankReadResult =>
  ({ statements: [], problems: [{ where, message }], pendingSkipped: 0 })

// Anfangssaldo + Umsätze = Endsaldo. Weicht es ab, fehlt ein Umsatz oder ist falsch gelesen; der
// Auszug wird trotzdem geliefert, aber mit Befund, damit der Import ihn nicht still übernimmt.
export function checkBalance(statement: BankStatement, where: string, problems: BankProblem[]): void {
  const { openingBalanceCents: opening, closingBalanceCents: closing } = statement
  if (opening === null || closing === null) return
  const sum = statement.entries.reduce((a, e) => a + e.amountCents, 0)
  if (opening + sum !== closing) {
    problems.push({ where, message: `Anfangssaldo und Umsätze ergeben nicht den Endsaldo (Abweichung ${((opening + sum - closing) / 100).toFixed(2)} €); ein Umsatz fehlt oder ist nicht lesbar.` })
  }
}

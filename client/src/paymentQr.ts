// Ob der Zahlungs-QR-Code erscheint und mit welchen Angaben (#624). Alles kommt aus dem Anschreiben, abgeschlossen also
// eingefroren: IBAN und Empfänger aus den eingesetzten Werten (dort gilt die Angabe am Objekt vor den Einstellungen),
// der Verwendungszweck aus dem Baustein `paymentPurpose`, der Betrag aus der Abrechnung. So nennt der Code nie etwas
// anderes als der Text daneben.
import type { StatementLetter } from './types'
import { renderLetterText } from '../../shared/letter.ts'
import { epcBlocked, epcPayload, epcText } from '../../shared/epcQr.ts'

export type PaymentQrData = { payload: string; name: string; iban: string; amountCents: number; purpose: string }

export function paymentQrOf(
  letter: Pick<StatementLetter, 'texts' | 'values'> | null,
  balanceCents: number,
  print: { date: string; attachments: number },
  enabled: boolean,
): PaymentQrData | null {
  if (!enabled || letter === null || balanceCents >= 0) return null
  // Vor #624 eingefroren: Der Baustein fehlt. Was zugestellt wurde, bekommt nachträglich keinen Code.
  if (!Object.hasOwn(letter.texts, 'paymentPurpose')) return null
  const name = letter.values.Vermieter
  const iban = letter.values.IBAN
  const amountCents = -balanceCents
  const purpose = epcText(renderLetterText(letter.texts.paymentPurpose, print))
  const payload = epcPayload({ name, iban, amountCents, purpose })
  if (payload === null) return null
  // Neben dem Code steht, was im Code steht: der Zweck so, wie er im Code ankommt (gekürzt und bereinigt).
  const lines = payload.split('\n')
  return { payload, name: lines[5] ?? name, iban, amountCents, purpose: lines[10] ?? '' }
}

// Warum bei einer Nachzahlung kein Code entsteht, für das Druckfenster (Durchsicht Befund 2). Aus demselben Anschreiben
// wie der Code, nie aus den Einstellungen von heute: Abgeschlossen gilt, was eingefroren ist. `sentenceShown`: Der Satz zur
// Nachzahlung erscheint (ein geleerter Baustein nimmt den Code mit, er steht direkt nach dem Satz).
export const QR_REASON_FROZEN = '(nicht bei Abrechnungen, die vor dieser Funktion abgeschlossen wurden)'
export const QR_REASON_SENTENCE = '(nur mit dem Satz zur Nachzahlung im Anschreiben)'
export const QR_REASON_ACCOUNT = '(braucht Vermieter und gültige IBAN aus dem EWR)'
export function paymentQrReason(letter: Pick<StatementLetter, 'texts' | 'values'> | null, balanceCents: number, sentenceShown: boolean): string | null {
  if (balanceCents >= 0) return null
  if (letter === null || !Object.hasOwn(letter.texts, 'paymentPurpose')) return QR_REASON_FROZEN
  if (!sentenceShown) return QR_REASON_SENTENCE
  return epcBlocked({ landlordName: letter.values.Vermieter, iban: letter.values.IBAN }) === null ? null : QR_REASON_ACCOUNT
}

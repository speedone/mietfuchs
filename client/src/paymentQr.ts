// Ob der Zahlungs-QR-Code erscheint und mit welchen Angaben (#624). Alles kommt aus dem Anschreiben, abgeschlossen also
// eingefroren: IBAN und Empfänger aus den eingesetzten Werten (dort gilt die Angabe am Objekt vor den Einstellungen),
// der Verwendungszweck aus dem Baustein `paymentPurpose`, der Betrag aus der Abrechnung. So nennt der Code nie etwas
// anderes als der Text daneben.
import type { StatementLetter } from './types'
import { renderLetterText } from '../../shared/letter.ts'
import { epcPayload, epcText } from '../../shared/epcQr.ts'

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

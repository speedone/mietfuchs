// Die gedruckte Aufstellung zum Auszug als Brief (#228), ohne DOM (depositLetter.test.ts): Briefkopf des Anschreibens
// (Absender über `effectiveLandlord`, Anschrift für den Schriftverkehr über `recipientLines`, Ort und Datum), Betreff mit
// Wohnung und Objekt, darunter die Aufstellung (depositSettlement.ts), das Ergebnis in einem Satz, Gruß und Unterschrift.
// Gezeichnet in components/DepositLetter.tsx.
//
// **Fester Text, keine Bausteine in der Datenbank.** Gelesen ist nur § 551 Abs. 1 bis 4 BGB (server/src/CLAUDE.md,
// „Kaution“): Der Brief stellt dar, was gebucht ist und was der Vermieter als Einbehalt mit Grund eingetragen hat. Er
// nennt keine Norm, keine Frist und keine Zahl von Monaten und sagt nichts dazu, wann ausgezahlt wird. Die Aufstellung
// endet nie unter 0; eine Nachforderung und damit das Konto des Vermieters kommen deshalb nicht vor. „ich“ oder „wir“
// vermeidet der Text, denn ob mehrere vermieten, weiß hier niemand.
import type { EffectiveLandlord } from '../../shared/landlord.ts'
import { recipientLines, returnLine } from '../../shared/landlord.ts'
import { normalizeIban } from '../../shared/iban.ts'
import { salutationOf } from '../../shared/letter.ts'
import { fmtDate, fmtEuro } from './api'
import type { DepositSettlement } from './depositSettlement'
import { infoRows, type LabeledRow } from './letterView'
import type { Property, Tenancy } from './types'

export type DepositLetterView = {
  head: { sender: string; senderAddress: string; returnLine: string; recipient: string[]; info: LabeledRow[] }
  subject: string
  salutation: string
  intro: string
  result: string
  greeting: string
  signature: string
}

export function depositLetterView(i: {
  tenancy: Pick<Tenancy, 'tenantName' | 'correspondenceAddress' | 'letterSalutation' | 'iban'>
  // Das Mietende; eine Aufstellung gibt es erst danach (depositSettlement.ts).
  end: string
  unitName: string
  property: Pick<Property, 'name' | 'address'> | null
  landlord: Pick<EffectiveLandlord, 'landlordName' | 'landlordAddress' | 'landlordContact'>
  settlement: Pick<DepositSettlement, 'hold' | 'payoutCents'>
  today: string
}): DepositLetterView {
  const { tenancy: t, property, landlord, settlement: s } = i
  const name = landlord.landlordName.trim()
  const where = [i.unitName.trim(), (property?.address ?? '').trim() || (property?.name ?? '').trim()].filter((x) => x !== '').join(', ')
  // Nie die ganze IBAN (Durchsicht): Das Feld dient auch Lastschrift und Kontoauszug, kann alt sein, und der Brief geht
  // womöglich an eine c/o-Anschrift. Die letzten vier Stellen genügen, damit der Mieter das Konto erkennt.
  const iban = normalizeIban(t.iban ?? '')
  const back = returnLine(landlord, property)
  const account = iban !== ''
    ? `Als Ihre Bankverbindung ist das Konto mit der IBAN-Endung ${iban.slice(-4)} hinterlegt; bitte teilen Sie mit, falls der Betrag auf ein anderes Konto gehen soll.`
    : 'Bitte teilen Sie mit, auf welches Konto der Betrag überwiesen werden soll.'
  return {
    head: {
      sender: name,
      senderAddress: landlord.landlordAddress,
      returnLine: back,
      recipient: recipientLines(t.tenantName, t, property),
      info: infoRows({ name, returnLine: back, address: landlord.landlordAddress, contact: landlord.landlordContact }, fmtDate(i.today)),
    },
    subject: `Kaution: Aufstellung zum Auszug${where ? `\n${where}` : ''}`,
    salutation: salutationOf(t.tenantName, t.letterSalutation),
    intro: `Ihr Mietverhältnis${where ? ` über die Wohnung ${where}` : ''} endete am ${fmtDate(i.end)}. Nachstehend finden Sie, was mit Ihrer Kaution gebucht ist, Stand vom ${fmtDate(i.today)}.`,
    result: s.payoutCents > 0
      ? `Zur Auszahlung an Sie bleiben damit ${fmtEuro(s.payoutCents)}. ${account}`
      : s.hold ? 'Nach dem Einbehalt bleibt derzeit nichts auszuzahlen.' : 'Damit bleibt nichts auszuzahlen.',
    greeting: 'Mit freundlichen Grüßen',
    signature: name,
  }
}

// Ohne Namen des Vermieters bleibt der Briefkopf leer und die Unterschrift fehlt (wie `senderMissing` der Abrechnung): eine
// Warnung, keine Sperre. Die Rücksendezeile druckt trotzdem, was es gibt (Anschrift des Vermieters oder Objekt). Mit
// Briefpapier trägt das Papier den Absender.
export function depositSenderMissing(view: Pick<DepositLetterView, 'head' | 'signature'>, paper: boolean): boolean {
  return !paper && view.head.sender.trim() === '' && view.signature.trim() === ''
}
export const DEPOSIT_SENDER_MISSING_TEXT =
  'Im Brief steht kein Name des Vermieters: Der Briefkopf bleibt leer und die Unterschrift fehlt; die Rücksendezeile über der Anschrift des Mieters nennt dann nur eine Anschrift. ' +
  'Tragen Sie Ihren Namen in den Einstellungen unter „Name des Vermieters“ ein oder, nur für dieses Objekt, in den Stammdaten beim Objekt.'

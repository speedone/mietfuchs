// Der Aufbau der Mieterabrechnung von vor #415, für Abrechnungen, die vorher abgeschlossen wurden und deshalb
// kein Anschreiben eingefroren haben (Durchsicht S1). Was zugestellt wurde, ändert eine Programmänderung nicht
// rückwirkend: kein Anschreiben, kein Ergebniskasten, Kopf und Sätze unter der Tabelle wie bisher, auch das
// „Guthaben von 0,00 €“ bei 0 € und der rote oder grüne Saldo. Der Wortlaut ist der von vor #415.
import type { Statement } from '../types'
import { fmtDate, fmtEuro } from '../api'
import { formatIban } from '../../../shared/iban.ts'
import { countOf } from '../../../shared/wording.ts'
import { adjustedPrepaymentLabel, suggestionBasis } from '../../../shared/letter.ts'

// Absender und Datum in einer Zeile, darunter im Druck die Anschrift; dann Name, Wohnung, Personen und Zeitraum.
export function LegacyHead({ sender, date, recipient }: { sender: string, date: string, recipient: string[] }) {
  return (
    <>
      <div className="muted flex flex-wrap justify-between gap-x-4">
        <span>{sender}</span>
        <span>{fmtDate(date)}</span>
      </div>
      <address className="print-only not-italic">
        {recipient.map((l, i) => <div key={i}>{l}</div>)}
      </address>
    </>
  )
}

export const legacyHeadLine = (st: Statement, persons: string): string =>
  `${st.tenantName} · ${st.unitName} · ${persons} · Zeitraum ${fmtDate(st.periodStart)} – ${fmtDate(st.periodEnd)} (${countOf(st.days, 'Tag', 'Tage')})`

// Die Sätze unter der Tabelle: Ergebnis mit Zahlung oder Erstattung und der Vorschlag nach § 560 Abs. 4 BGB.
export function LegacyResult({ st, landlord, adjust, separate, daysInYear }: {
  st: Statement
  landlord: { landlordName: string, iban: string, paymentDeadlineDays: number } | null
  adjust: boolean
  separate: boolean
  daysInYear: number
}) {
  return (
    <>
      <p>
        {st.balanceCents < 0 ? (
          <>
            Es ergibt sich eine <strong>Nachzahlung von {fmtEuro(-st.balanceCents)}</strong>.
            Bitte überweisen Sie den Betrag innerhalb von {landlord?.paymentDeadlineDays || 30} Tagen
            nach Zugang dieser Abrechnung
            {landlord?.iban ? <> auf das Konto <strong>{formatIban(landlord.iban)}</strong>{landlord.landlordName ? ` (${landlord.landlordName})` : ''}</> : null}.
          </>
        ) : (
          <>
            Es ergibt sich ein <strong>Guthaben von {fmtEuro(st.balanceCents)}</strong>.
            Der Betrag wird Ihnen erstattet bzw. mit der nächsten Mietzahlung verrechnet.
          </>
        )}
      </p>
      {adjust && st.suggestedMonthlyCents > 0 && (
        <p>
          Auf Basis dieser Abrechnung wird die {adjustedPrepaymentLabel(st, separate)} gemäß
          § 560 Abs. 4 BGB ab dem übernächsten Monat auf <strong>{fmtEuro(st.suggestedMonthlyCents)}</strong> angepasst
          ({suggestionBasis(st, daysInYear)}).
        </p>
      )}
    </>
  )
}

export const legacyReceiptsText = (attachments: number): string => attachments > 0
  ? ` Kopien der zugrunde liegenden Belege sind als Anlage beigefügt (${attachments} Beleg${attachments > 1 ? 'e' : ''}).`
  : ' Die zugrunde liegenden Belege können nach Terminvereinbarung eingesehen werden.'

// Das Anschreiben als erste Seite jeder Mieterabrechnung (#415): ein Brief nach DIN 5008 Form B. Am
// Bildschirm eine Vorschau im Kasten, im Druck mit den Maßen der Norm in letter.css (Anschriftfeld für
// Fensterumschläge, Informationsblock, Betreff ab 98,46 mm; Falz- und Lochmarken nur auf Wunsch).
import type { LetterParagraph } from '../letterView'

type Props = {
  paragraphs: LetterParagraph[]
  sender: string // der Absender oben, meist der Name des Vermieters
  returnLine: string // die Rücksendeangabe über der Anschrift
  recipient: string[]
  date: string // schon formatiert
  foldMarks: boolean
  draftMark?: string | null // „Entwurf, nicht versenden“, nur im Druck
}

const FLOW: readonly LetterParagraph['block'][] = ['intro', 'credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments', 'closing']

export default function Letter({ paragraphs, sender, returnLine, recipient, date, foldMarks, draftMark }: Props) {
  const text = (b: LetterParagraph['block']) => paragraphs.find((p) => p.block === b)?.text ?? null
  const subject = text('subject')
  const salutation = text('salutation')
  const greeting = text('greeting')
  const signature = text('signature')
  return (
    <section className="letter" aria-label={`Anschreiben an ${recipient[0] ?? ''}`}>
      {foldMarks && (
        <>
          <span className="letter-mark letter-fold-1" aria-hidden="true" />
          <span className="letter-mark letter-punch" aria-hidden="true" />
          <span className="letter-mark letter-fold-2" aria-hidden="true" />
        </>
      )}
      {draftMark && <div className="print-only draft-mark letter-draft">{draftMark}</div>}
      {sender && <div className="letter-head">{sender}</div>}
      <div className="letter-window">
        {returnLine && <div className="letter-return">{returnLine}</div>}
        <address className="letter-address">
          {recipient.map((l, i) => <div key={i}>{l}</div>)}
        </address>
      </div>
      <div className="letter-info">
        <span className="muted">Datum</span> {date}
      </div>
      <div className="letter-body">
        {subject && <p className="letter-subject">{subject}</p>}
        {salutation && <p>{salutation}</p>}
        {paragraphs.filter((p) => FLOW.includes(p.block)).map((p) => <p key={p.block}>{p.text}</p>)}
        {greeting && <p className="letter-greeting">{greeting}</p>}
        {signature && <p className="letter-signature">{signature}</p>}
      </div>
    </section>
  )
}

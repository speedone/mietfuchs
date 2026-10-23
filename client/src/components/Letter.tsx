// Das Anschreiben als erste Seite jeder Mieterabrechnung (#415): ein Brief nach DIN 5008 Form B. Am
// Bildschirm eine Vorschau im Kasten, im Druck mit den Maßen der Norm in letter.css (Anschriftfeld für
// Fensterumschläge, Informationsblock, Betreff ab 98,46 mm; Falz- und Lochmarken nur auf Wunsch).
//
// Teil 2: Ohne Anschreiben beginnt die Aufstellung mit demselben Kopf (`StatementHead`): Absender,
// Rücksendeangabe und Anschrift im Fensterfeld, Datum; den Betreff setzt die Aufstellung als Überschrift.
// Jede Seite der Aufstellung trägt im Druck einen Fußvermerk (`PrintPages`).
import type { ReactNode } from 'react'
import type { LetterParagraph } from '../letterView'

type HeadProps = {
  sender: string // der Absender oben, meist der Name des Vermieters
  senderAddress?: string // seine Anschrift darunter (Teil 2), ohne Angabe nichts
  returnLine: string // die Rücksendeangabe über der Anschrift
  recipient: string[]
  date: string // schon formatiert
  foldMarks: boolean
  draftMark?: string | null // „Entwurf, nicht versenden“, nur im Druck
}

type Props = HeadProps & {
  paragraphs: LetterParagraph[]
  footer?: string | null // Teil 2: Fußzeile mit Kontakt und Bank, nur auf Wunsch
}

const FLOW: readonly LetterParagraph['block'][] = ['intro', 'credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments', 'closing']

function LetterHead({ sender, senderAddress, returnLine, recipient, date, foldMarks, draftMark }: HeadProps) {
  return (
    <>
      {foldMarks && (
        <>
          <span className="letter-mark letter-fold-1" aria-hidden="true" />
          <span className="letter-mark letter-punch" aria-hidden="true" />
          <span className="letter-mark letter-fold-2" aria-hidden="true" />
        </>
      )}
      {draftMark && <div className="print-only draft-mark letter-draft">{draftMark}</div>}
      {sender && (
        <div className="letter-head">
          {sender}
          {senderAddress && <div className="letter-head-address">{senderAddress}</div>}
        </div>
      )}
      <div className="letter-window">
        {returnLine && <div className="letter-return">{returnLine}</div>}
        <address className="letter-address">
          {recipient.map((l, i) => <div key={i}>{l}</div>)}
        </address>
      </div>
      <div className="letter-info">
        <span className="muted">Datum</span> {date}
      </div>
    </>
  )
}

export default function Letter({ paragraphs, footer, ...head }: Props) {
  const text = (b: LetterParagraph['block']) => paragraphs.find((p) => p.block === b)?.text ?? null
  const subject = text('subject')
  const salutation = text('salutation')
  const greeting = text('greeting')
  const signature = text('signature')
  return (
    // Mit Fußzeile hält der Brieftext unten Platz frei (Durchsicht zu PR #427, S1, letter.css).
    <section className={footer ? 'letter letter-with-footer' : 'letter'} aria-label={`Anschreiben an ${head.recipient[0] ?? ''}`}>
      <LetterHead {...head} />
      <div className="letter-body">
        {subject && <p className="letter-subject">{subject}</p>}
        {salutation && <p>{salutation}</p>}
        {paragraphs.filter((p) => FLOW.includes(p.block)).map((p) => <p key={p.block}>{p.text}</p>)}
        {greeting && <p className="letter-greeting">{greeting}</p>}
        {signature && <p className="letter-signature">{signature}</p>}
      </div>
      {footer && <div className="letter-footer">{footer}</div>}
    </section>
  )
}

// Ohne Anschreiben (Teil 2): der Kopf des Briefs über der Aufstellung, im Druck mit denselben Maßen; danach
// beginnt die Aufstellung auf der Höhe des Betreffs.
export function StatementHead(props: HeadProps) {
  return (
    <div className="letter letter-top">
      <LetterHead {...props} />
    </div>
  )
}

// Der Fußvermerk auf jeder Seite der Aufstellung (Teil 2, Durchsicht K8 zu #421): Chromium und Firefox
// wiederholen den Fuß einer echten Tabelle auf jeder Druckseite, eine Tabelle aus CSS dagegen nicht
// (nachgemessen). Am Bildschirm ist die Hülle unsichtbar und der Fuß ausgeblendet. Ohne Vermerk keine Hülle.
export function PrintPages({ footnote, children }: { footnote: ReactNode | null, children: ReactNode }) {
  if (footnote === null) return <>{children}</>
  return (
    <table className="print-pages" role="presentation">
      <tfoot>
        <tr><td className="print-pages-cell"><div className="statement-footnote">{footnote}</div></td></tr>
      </tfoot>
      <tbody>
        <tr><td className="print-pages-cell">{children}</td></tr>
      </tbody>
    </table>
  )
}

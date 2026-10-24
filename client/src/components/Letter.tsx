// Das Anschreiben als erste Seite jeder Mieterabrechnung (#415): ein Brief nach DIN 5008 Form B. Am
// Bildschirm eine Vorschau im Kasten, im Druck mit den Maßen der Norm in letter.css (Anschriftfeld für
// Fensterumschläge, Informationsblock, Betreff ab 98,46 mm; Falz- und Lochmarken nur auf Wunsch).
//
// Teil 2: Ohne Anschreiben beginnt die Aufstellung mit demselben Kopf (`StatementHead`): Absender,
// Rücksendeangabe und Anschrift im Fensterfeld, Datum; den Betreff setzt die Aufstellung als Überschrift.
// Jede Seite der Aufstellung trägt im Druck einen Fußvermerk (`PrintPages`).
//
// Druck nach DIN 5008 (#415): Rechts neben dem Anschriftfeld steht der Informationsblock mit Ansprechpartner, Kontakt, Ort
// und Datum (`infoRows` in letterView.ts), wie ein Geschäftsbrief ihn trägt.
import { Fragment, type ReactNode } from 'react'
import type { LabeledRow, LetterParagraph } from '../letterView'

type HeadProps = {
  sender: string // der Absender oben, meist der Name des Vermieters
  senderAddress?: string // seine Anschrift darunter (Teil 2), ohne Angabe nichts
  returnLine: string // die Rücksendeangabe über der Anschrift
  recipient: string[]
  info: LabeledRow[] // Informationsblock: Ansprechpartner, Kontakt, Ort und Datum (schon formatiert)
  foldMarks: boolean
  draftMark?: string | null // „Entwurf, nicht versenden“, nur im Druck
  logo?: string | null // Teil 2b: Adresse des Logos, oben rechts im Briefkopf
  paper?: string | null // Teil 2b: Briefpapier der ersten Seite (Adresse oder gerendertes Bild), nur im Druck
}

type Props = HeadProps & {
  paragraphs: LetterParagraph[]
  footer?: string | null // Teil 2: Fußzeile mit Kontakt und Bank, nur auf Wunsch
}

const FLOW: readonly LetterParagraph['block'][] = ['intro', 'credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments', 'closing']

function LetterHead({ sender, senderAddress, returnLine, recipient, info, foldMarks, draftMark, logo, paper }: HeadProps) {
  return (
    <>
      {/* Das Briefpapier liegt unter allem auf der ganzen Seite; mit ihm entfällt der Absender von Mietfuchs (der Kopf
          des Briefpapiers nennt ihn). Die Rücksendeangabe im Fenster bleibt. Immer ein Bild (PNG, JPG, gerenderte PDF). */}
      {paper && <img className="letter-paper" src={paper} alt="" aria-hidden="true" />}
      {logo && <img className="letter-logo" src={logo} alt="Logo" />}
      {foldMarks && (
        <>
          <span className="letter-mark letter-fold-1" aria-hidden="true" />
          <span className="letter-mark letter-punch" aria-hidden="true" />
          <span className="letter-mark letter-fold-2" aria-hidden="true" />
        </>
      )}
      {draftMark && <div className="print-only draft-mark letter-draft">{draftMark}</div>}
      {sender && !paper && (
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
        {info.map((r, i) => (r.label ? (
          <Fragment key={i}>
            <span className="letter-info-label">{r.label}</span>
            <span>{r.value}</span>
          </Fragment>
        ) : (
          <span key={i} className={i === info.length - 1 && i > 0 ? 'letter-info-wide letter-info-date' : 'letter-info-wide'}>{r.value}</span>
        )))}
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
//
// Teil 2b: Mit Briefpapier druckt die Seite ohne Seitenrand; dann hält ein leerer Kopf jeder Druckseite den oberen Rand
// frei, der Fuß den unteren, und die Zelle die seitlichen (`paper`, Maße in letter.css). Im Kopf liegt auch das
// Briefpapier der Folgeseiten (`follow`): Den Kopf wiederholt der Browser auf jeder Seite, und so trägt nur diese Hülle
// es, nicht die der Belegkopien dahinter (Durchsicht S2; ein fest positioniertes Bild läge unter jeder Seite). `newPage`:
// Die Hülle beginnt auf einer neuen Seite; ein Umbruch vor dem ersten Inhalt der Zelle wirkte nicht (nachgemessen).
export function PrintPages({ footnote, paper = false, follow = null, newPage = false, children }: { footnote: ReactNode | null, paper?: boolean, follow?: string | null, newPage?: boolean, children: ReactNode }) {
  if (footnote === null && !paper) return <>{children}</>
  return (
    <table className={newPage ? 'print-pages print-pages-new' : 'print-pages'} role="presentation">
      {paper && (
        <thead>
          <tr><td className="print-pages-cell"><div className="print-pages-spacer">{follow && <img className="paper-follow" src={follow} alt="" aria-hidden="true" />}</div></td></tr>
        </thead>
      )}
      <tfoot>
        <tr><td className="print-pages-cell">{footnote !== null && <div className="statement-footnote">{footnote}</div>}</td></tr>
      </tfoot>
      <tbody>
        <tr><td className="print-pages-cell">{children}</td></tr>
      </tbody>
    </table>
  )
}

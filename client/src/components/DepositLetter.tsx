// Die Aufstellung zum Auszug der Kaution (#228): am Bildschirm im Seitenfenster (`SettlementView`), gedruckt als Brief
// mit dem Briefkopf des Anschreibens (`LetterHead`, letter.css), Logo und Briefpapier des Objekts wie beim Schreiben der
// Mieterhöhung. Der Text kommt aus depositLetter.ts. Das Blatt hängt am Ende von body und erscheint nur im Druck
// (`print-deposit`, letter.css).
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { fmtDate, fmtEuro } from '../api'
import type { DepositLetterView } from '../depositLetter'
import type { DepositSettlement } from '../depositSettlement'
import { PAPER_PAGE_CSS, paperVars, type PrintedDesign } from '../letterDesignView'
import { startPrint } from '../printJob'
import { softBreak } from '../softBreak'
import { LetterHead } from './Letter'
import { useLetterDesign } from './RentIncreaseLetter'
import Table from './Table'

// Die Aufstellung selbst, gleich am Bildschirm und im Druck.
// Gedruckt geht das Blatt an den Mieter; „Ihnen“ hieße dort ihn (Durchsicht G2). Freie Notizen, die letzte Abrechnung
// und Ausstehendes sind Orientierung für den Vermieter und stehen nicht darauf (Abschlussdurchsicht G4).
export function SettlementView({ settlement: s, printed = false }: { settlement: DepositSettlement; printed?: boolean }) {
  return (
    <>
      <Table aria-label="Buchungen der Kaution">
        <tbody>
          {s.rows.map((r, i) => (
            <tr key={i}><td>{fmtDate(r.date)}</td><td>{softBreak(`${r.label}${printed ? (r.printNote ? ` (${r.printNote})` : '') : r.note ? ` (${r.note})` : ''}`)}</td><td className="num">{fmtEuro(r.cents)}</td></tr>
          ))}
        </tbody>
      </Table>
      <p className="m-0">{printed ? 'Beim Vermieter liegen' : 'Bei Ihnen liegen'} {fmtEuro(s.balanceCents)}.</p>
      {s.hold && <p className="m-0">Einbehalten: {fmtEuro(s.hold.cents)} ({s.hold.note})</p>}
      <p className="m-0"><strong>Bleibt auszuzahlen: {fmtEuro(s.payoutCents)}</strong></p>
      {!printed && s.lastStatement && <p className="muted m-0">{s.lastStatement}</p>}
      {!printed && s.lastHeatingStatement && <p className="muted m-0">{s.lastHeatingStatement}</p>}
      {!printed && s.pending.map((line) => <p key={line} className="muted m-0">{line}</p>)}
    </>
  )
}

export function DepositLetterSheet({ view: v, settlement, design = null }: { view: DepositLetterView; settlement: DepositSettlement; design?: PrintedDesign | null }) {
  return (
    <section className="letter" aria-label={`Schreiben an ${v.head.recipient[0] ?? ''}`}>
      <LetterHead {...v.head} foldMarks={false} logo={design?.logo ?? null} paper={design?.paper ?? null} />
      <div className="letter-body">
        <p className="letter-subject">{v.subject}</p>
        <p>{v.salutation}</p>
        <p>{v.intro}</p>
        <div className="deposit-letter-settlement"><SettlementView settlement={settlement} printed /></div>
        <p>{v.result}</p>
        <p className="letter-greeting">{v.greeting}</p>
        <p className="letter-signature">{v.signature}</p>
      </div>
    </section>
  )
}

// Druckt den Brief, sobald Logo und Briefpapier geladen sind, wie `RentIncreasePrint`: über `startPrint` (Dateiname aus
// `title`, aufgeräumt erst bei der nächsten Bedienung, nicht bei `afterprint`; printJob.ts), danach `onDone`.
export function DepositLetterPrint({ title, view, settlement, propertyId, onDone }: { title: string; view: DepositLetterView; settlement: DepositSettlement; propertyId: string | null | undefined; onDone: () => void }) {
  const design = useLetterDesign(propertyId)
  useEffect(() => {
    if (!design.ready) return
    document.body.classList.add('print-deposit')
    const job = startPrint({
      title,
      onDone: () => {
        document.body.classList.remove('print-deposit')
        onDone()
      },
    })
    return () => {
      job.cancel()
      document.body.classList.remove('print-deposit')
    }
  }, [design.ready])
  return createPortal(
    <div className={design.paper ? 'deposit-print paper-print' : 'deposit-print'} style={design.margins ? paperVars(design.margins) : undefined}>
      {design.paper && <style>{PAPER_PAGE_CSS}</style>}
      <DepositLetterSheet view={view} settlement={settlement} design={design} />
    </div>,
    document.body,
  )
}

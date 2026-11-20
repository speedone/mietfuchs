// Das Schreiben einer Mieterhöhung (#191, PR 3) mit den Bausteinen des Anschreibens: Briefkopf nach DIN 5008 (`LetterHead`,
// letter.css), Logo und Briefpapier des Objekts wie im Druck der Abrechnung (letterDesignView.ts). Der Text kommt aus
// rentIncreaseLetter.ts und nur aus der eingefrorenen Grundlage; Logo und Briefpapier lädt jeder Druck aktuell (nicht
// eingefroren, Entwurf „Umsetzung PR 3“). Eine Grundlage aus einer anderen Fassung zeigt nur ihren Satz (Durchsicht K1). Am Bildschirm eine Vorschau im Kasten; gedruckt wird ein
// Blatt am Ende von body (`print-rent-increase`, letter.css), die Zustimmungserklärung auf eigener Seite.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LetterDesigns, RentIncrease } from '../types'
import { api } from '../api'
import { withProperty } from '../property'
import { rentIncreaseLetterView } from '../rentIncreaseLetter'
import { rentIncreaseBasisProblem } from '../../../shared/rentIncreaseLetter.ts'
import { PAPER_PAGE_CSS, asLetterDesigns, canPagePaper, designKey, paperVars, printDesign, printedDesign, type LoadedDesign, type PrintedDesign } from '../letterDesignView'
import { designImage } from '../letterPaper'
import { softBreak } from '../softBreak'
import { startPrint } from '../printJob'
import { monthLabel } from '../monthText'
import { LetterHead } from './Letter'
import Table from './Table'

export function RentIncreaseLetterSheet({ increase, design = null }: { increase: Pick<RentIncrease, 'basis'>; design?: PrintedDesign | null }) {
  const foreign = rentIncreaseBasisProblem(increase.basis)
  if (foreign) return <p>{foreign}</p>
  const v = rentIncreaseLetterView(increase.basis)
  return (
    <>
      <section className="letter" aria-label={`Schreiben an ${v.head.recipient[0] ?? ''}`}>
        <LetterHead {...v.head} foldMarks={false} logo={design?.logo ?? null} paper={design?.paper ?? null} />
        <div className="letter-body">
          <p className="letter-subject">{v.subject}</p>
          <p>{v.salutation}</p>
          {v.paragraphs.map((p, i) => (
            <div key={i}>
              <p>{p}</p>
              {v.comparables && v.comparables.after === i && (
                <Table aria-label="Vergleichswohnungen" className="rent-increase-comparables">
                  <thead><tr><th>Anschrift</th><th>Geschoss, Lage</th><th className="num">Fläche</th><th className="num">Miete je m²</th></tr></thead>
                  <tbody>
                    {v.comparables.rows.map((c, j) => <tr key={j}><td>{softBreak(c.address)}</td><td>{softBreak(c.location)}</td><td className="num">{c.area}</td><td className="num">{c.perM2}</td></tr>)}
                  </tbody>
                </Table>
              )}
            </div>
          ))}
          <p className="letter-greeting">{v.greeting}</p>
          <p className="letter-signature">{v.signature}</p>
        </div>
      </section>
      {v.consentForm && (
        <section className="letter rent-increase-consent" aria-label={v.consentForm.title}>
          <div className="letter-body">
            <p className="letter-subject">{v.consentForm.title}</p>
            {v.consentForm.lines.map((l, i) => <p key={i}>{l}</p>)}
          </div>
        </section>
      )}
    </>
  )
}

// Logo und Briefpapier des Objekts, geladen wie auf der Seite Abrechnung (Briefpapier nur, wo der Browser es kann).
function useLetterDesign(propertyId: string | null | undefined): PrintedDesign {
  const [designs, setDesigns] = useState<LetterDesigns | null>(null)
  const [loaded, setLoaded] = useState<LoadedDesign | null>(null)
  useEffect(() => {
    let alive = true
    api<unknown>(withProperty('/api/letter-design', propertyId)).then((d) => { if (alive) setDesigns(asLetterDesigns(d)) }).catch(() => { if (alive) setDesigns(null) })
    return () => { alive = false }
  }, [propertyId])
  const planned = printDesign(designs, { legacy: false, pagedPaper: canPagePaper() })
  const key = designKey(planned)
  useEffect(() => {
    let alive = true
    const failed: string[] = []
    const load = (f: typeof planned.logo, label: string) => (f ? designImage(f).catch(() => { failed.push(label); return null }) : Promise.resolve(null))
    void Promise.all([load(planned.logo, 'Logo'), load(planned.paper, 'Briefpapier')]).then(([logo, paper]) => {
      if (alive) setLoaded({ key, logo, paper, follow: null, failed })
    })
    return () => { alive = false }
    // `planned` folgt `key`; neu geladen wird nur bei anderen Dateien.
  }, [key])
  return printedDesign(planned, loaded)
}

// Druckt das Schreiben, sobald Logo und Briefpapier geladen sind; danach `onDone`.
export function RentIncreasePrint({ increase, propertyId, onDone }: { increase: RentIncrease; propertyId: string | null | undefined; onDone: () => void }) {
  const design = useLetterDesign(propertyId)
  useEffect(() => {
    if (!design.ready) return
    document.body.classList.add('print-rent-increase')
    const job = startPrint({
      title: `Mieterhöhung ${increase.basis.letter.recipientName} ab ${monthLabel(increase.effectiveFrom)}`,
      onDone: () => {
        document.body.classList.remove('print-rent-increase')
        onDone()
      },
    })
    return () => {
      job.cancel()
      document.body.classList.remove('print-rent-increase')
    }
  }, [design.ready])
  return createPortal(
    <div className={design.paper ? 'rent-increase-print paper-print' : 'rent-increase-print'} style={design.margins ? paperVars(design.margins) : undefined}>
      {design.paper && <style>{PAPER_PAGE_CSS}</style>}
      <RentIncreaseLetterSheet increase={increase} design={design} />
    </div>,
    document.body,
  )
}

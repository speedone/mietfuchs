// Die Seite „Hilfe & Begriffe“: oben die Anleitungen je Vermietungsart (#164), darunter alle
// Begriffe des Lexikons (#113). Eine Suche gilt für beide. Dieselben Begriffstexte erscheinen in
// den Formularen hinter den unterstrichenen Begriffen; die Anleitungen springen mit ihren Schritten
// auf die Seite, auf der man es tut.

import { Fragment, useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
import Term from '../components/Term'
import { filterTerms, sortedTerms } from '../glossaryView'
import { allGuides, filterGuides, type GuideEntry } from '../guideView'
import { pageLabel } from '../nav'
import type { GuidePage } from '../../../shared/guides.ts'

const ISSUE_URL = 'https://github.com/speedone/mietfuchs/issues/'

export default function Hilfe({ onNavigate }: { onNavigate: (page: GuidePage) => void }) {
  const [query, setQuery] = useState('')
  const terms = useMemo(sortedTerms, [])
  const guides = useMemo(allGuides, [])
  const shownTerms = filterTerms(terms, query)
  const shownGuides = filterGuides(guides, query)
  const q = query.trim()
  // Ein Sprung beginnt oben auf der Zielseite, nicht auf der Höhe, auf der die Anleitung stand.
  const jump = (page: GuidePage) => {
    window.scrollTo(0, 0)
    onNavigate(page)
  }
  return (
    <>
      <PageHeader
        title="Hilfe"
        subtitle="Anleitungen je Vermietungsart und die Fachbegriffe der Nebenkostenabrechnung in einfachen Worten, mit Beispiel und Rechtsgrundlage. Dieselben Erklärungen erscheinen in den Formularen, wenn Sie einen gestrichelt unterstrichenen Begriff antippen."
      />
      <div className="card">
        <label className="field">
          Suchen in Anleitungen und Begriffen
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="z. B. Garage, Pauschale oder § 556" />
        </label>
      </div>

      <h2 className="help-section">Anleitungen</h2>
      {shownGuides.length === 0 && <div className="notice">Keine Anleitung passt zu „{q}“.</div>}
      {/* Bei einer Suche aufgeklappt: Sonst sähe man nicht, wo das gesuchte Wort steht. */}
      {shownGuides.map((g) => <GuideCard key={g.id} guide={g} open={q !== ''} onNavigate={jump} />)}

      <h2 className="help-section">Begriffe</h2>
      {shownTerms.length === 0 && <div className="notice">Kein Begriff passt zu „{q}“.</div>}
      {shownTerms.map((t) => (
        <div key={t.id} className="card glossary-entry" id={`begriff-${t.id}`}>
          <h3>{t.title}</h3>
          <p>{t.short}</p>
          <p><em>Beispiel:</em> {t.example}</p>
          {t.norm && <p><em>Rechtsgrundlage:</em> {t.norm}</p>}
          <p><em>Brauche ich das?</em> {t.needed}</p>
        </div>
      ))}
    </>
  )
}

function GuideCard({ guide: g, open, onNavigate }: { guide: GuideEntry; open: boolean; onNavigate: (page: GuidePage) => void }) {
  return (
    <details className="card guide" id={`anleitung-${g.id}`} open={open}>
      <summary><h3 className="guide-title">{g.title}</h3></summary>
      <h4>Trifft das auf Sie zu?</h4>
      <p>{g.applies}</p>

      <h4>So legen Sie es an</h4>
      <ol className="guide-steps">
        {g.steps.map((s, i) => (
          <li key={i}>
            {s.text}
            {s.page && (
              <>
                {' '}
                <button type="button" className="btn small secondary guide-jump" onClick={() => s.page && onNavigate(s.page)}>
                  Zu {pageLabel(s.page)} →
                </button>
              </>
            )}
          </li>
        ))}
      </ol>

      <h4>Was Mietfuchs daraus macht</h4>
      <ul>
        {g.result.map((r, i) => <li key={i}>{r}</li>)}
      </ul>

      <h4>Beispiel</h4>
      <p>{g.example}</p>

      <h4>Worauf Sie achten müssen</h4>
      <ul>
        {g.caveats.map((c, i) => (
          <li key={i}>
            {c.text}
            {c.norm && <> <span className="muted">(<span className="guide-norm">{c.norm}</span>)</span></>}
          </li>
        ))}
      </ul>

      <h4>Was Mietfuchs (noch) nicht kann</h4>
      <ul>
        {g.gaps.map((x, i) => (
          <li key={i}>
            {x.text}
            {x.issue && <> <span className="muted">(geplant in <a href={`${ISSUE_URL}${x.issue}`} target="_blank" rel="noreferrer">#{x.issue}</a>)</span></>}
          </li>
        ))}
      </ul>

      <p className="guide-terms">
        <em>Begriffe:</em> {g.terms.map((t, k) => <Fragment key={t}>{k > 0 && ', '}<Term id={t} /></Fragment>)}
      </p>
    </details>
  )
}

// Die Seite „Hilfe“ (#113): alle Begriffe des Lexikons zum Nachschlagen. Dieselben Texte
// erscheinen in den Formularen hinter den unterstrichenen Begriffen.

import { useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { filterTerms, sortedTerms } from '../glossaryView'

export default function Hilfe() {
  const [query, setQuery] = useState('')
  const all = useMemo(sortedTerms, [])
  const shown = filterTerms(all, query)
  return (
    <>
      <PageHeader
        title="Hilfe"
        subtitle="Die Fachbegriffe der Nebenkostenabrechnung in einfachen Worten, mit Beispiel und Rechtsgrundlage. Dieselben Erklärungen erscheinen in den Formularen, wenn Sie einen gestrichelt unterstrichenen Begriff antippen."
      />
      <div className="card">
        <label className="field">
          Begriff suchen
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="z. B. Pauschale oder § 556" />
        </label>
      </div>
      {shown.length === 0 && <div className="notice">Kein Begriff passt zu „{query.trim()}“.</div>}
      {shown.map((t) => (
        <div key={t.id} className="card glossary-entry" id={`begriff-${t.id}`}>
          <h2>{t.title}</h2>
          <p>{t.short}</p>
          <p><em>Beispiel:</em> {t.example}</p>
          {t.norm && <p><em>Rechtsgrundlage:</em> {t.norm}</p>}
          <p><em>Brauche ich das?</em> {t.needed}</p>
        </div>
      ))}
    </>
  )
}

// Ein Fachbegriff mit Erklärung zum Aufklappen (#113). Der Text steht im Lexikon
// (shared/glossary.ts); hier nur, wie er erscheint.
//
// Ein `span` mit `role="button"` und kein <button>: Steht der Begriff in einem <label>, wäre ein
// Button das erste bedienbare Element darin, und das Label beschriftete ihn statt des
// Eingabefelds. Aus demselben Grund verhindert jeder Klick hier die Aktivierung des Labels,
// die sonst das Feld fokussierte oder eine Auswahl öffnete.

import { useId, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { GLOSSARY, type Term as GlossaryTerm, type TermId } from '../../../shared/glossary.ts'

export default function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const popId = useId()
  // Lookup über `Object.hasOwn`, nicht blind: Eine abgeschlossene Abrechnung friert ihre
  // Hinweise samt Begriffen ein, und ein später umbenannter Begriff darf die Seite dieses Jahres
  // nicht zum Absturz bringen. Dann steht nur der Text da.
  const term: GlossaryTerm | undefined = Object.hasOwn(GLOSSARY, id) ? GLOSSARY[id] : undefined
  const stop = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpen((o) => !o)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }
  if (!term) return <>{children ?? id}</>
  return (
    <span className="term-wrap">
      <span
        role="button"
        tabIndex={0}
        className="term"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={(e) => {
          stop(e)
          setOpen((o) => !o)
        }}
        onKeyDown={onKey}
      >
        {children ?? term.title}
      </span>
      {open && (
        <span id={popId} role="note" className="term-pop" onClick={stop}>
          <strong>{term.title}</strong>
          <span className="term-line">{term.short}</span>
          <span className="term-line"><em>Beispiel:</em> {term.example}</span>
          {term.norm && <span className="term-line"><em>Rechtsgrundlage:</em> {term.norm}</span>}
          <span className="term-line"><em>Brauche ich das?</em> {term.needed}</span>
        </span>
      )}
    </span>
  )
}

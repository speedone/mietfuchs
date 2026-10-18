// Ein Fachbegriff mit Erklärung (#113; #346 Schritt 6, Spezifikation Abschnitt 3 „Begriffserklärung“). Der
// Text steht im Lexikon (shared/glossary.ts); hier nur, wie er erscheint.
//
// Der Begriff ist gestrichelt unterstrichen, dahinter steht ein kleiner Knopf „?“ (Tippfläche `--target` über
// `::after`, Utility `term-q`). Ein Klick, Enter oder Leertaste öffnet die Erklärung als Popover im Top-Layer
// (popover.tsx): Sie schiebt nichts weg und wird nie zur Säule, auch nicht in einem Häkchen-Label oder einem
// schmalen Raster (UI-Durchsicht H2, M1), am Handy steht sie als Blatt unten mit höchstens 60 % der Höhe
// (MOB3). Darin stehen höchstens zwei Absätze, die Erklärung und das Beispiel; Rechtsgrundlage und „Brauche
// ich das?“ stehen in „Hilfe & Begriffe“, dorthin führt „Mehr in ‚Hilfe & Begriffe‘ →“ (über `navigate`, also
// mit der Rückfrage bei offenem Formular).
//
// Ein `span` mit `role="button"` und kein <button>: Steht der Begriff in einem <label>, wäre ein Button das
// erste bedienbare Element darin, und das Label beschriftete ihn statt des Eingabefelds. Aus demselben Grund
// verhindert jeder Klick hier die Aktivierung des Labels, das „?“ ist für Vorleser ausgeblendet (der Name des
// Felds bleibt seine Beschriftung), und die Erklärung hängt nicht im Label, sondern über ein Portal im
// nächsten Dialog bzw. in `body`: Sonst gehörte ihr Text, solange sie offen ist, zum Namen des Felds.

import { createContext, useContext, useId, type KeyboardEvent, type ReactNode } from 'react'
import { GLOSSARY, type Term as GlossaryTerm, type TermId } from '../../../shared/glossary.ts'
import { usePopover } from './popover'

// Der Sprung nach „Hilfe & Begriffe“ zu einem Begriff; App.tsx reicht ihn über `navigate` herein. Ohne ihn
// (Tests, Druck) fehlt nur der Verweis.
export const TermHelp = createContext<((id: TermId) => void) | null>(null)

// Lookup über `Object.hasOwn`, nicht blind: Eine abgeschlossene Abrechnung friert ihre
// Hinweise samt Begriffen ein, und ein später umbenannter Begriff darf die Seite dieses Jahres
// nicht zum Absturz bringen. Dann steht nur der Text da.
const lookup = (id: TermId): GlossaryTerm | undefined => (Object.hasOwn(GLOSSARY, id) ? GLOSSARY[id] : undefined)

export default function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  const titleId = useId()
  const help = useContext(TermHelp)
  // Beim Öffnen geht der Fokus in die Erklärung, damit Vorleser sie hören und der Verweis per Tab erreichbar ist.
  const pop = usePopover({ onOpen: (el) => el.focus() })
  const term = lookup(id)
  if (!term) return <>{children ?? id}</>
  const toggle = () => (pop.open ? pop.hide() : pop.show())
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }
  return (
    <span className="term-wrap">
      <span
        role="button"
        tabIndex={0}
        className="term"
        aria-haspopup="dialog"
        {...pop.trigger}
        onKeyDown={onKey}
      >
        {children ?? term.title}
        <span aria-hidden="true" className="term-q print:hidden" />
      </span>
      {pop.render({
        className: 'term-pop',
        labelledBy: titleId,
        children: (
          <>
            <strong id={titleId}>{term.title}</strong>
            <span>{term.short}</span>
            <span><em>Beispiel:</em> {term.example}</span>
            {help && (
              <a href={`#begriff-${id}`} onClick={(e) => { e.preventDefault(); pop.hide(); help(id) }}>
                Mehr in „Hilfe & Begriffe“ →
              </a>
            )}
          </>
        ),
      })}
    </span>
  )
}

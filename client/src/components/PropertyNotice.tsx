import { useEffect, useRef } from 'react'
import type { Property } from '../types'
import { propertyName } from '../propertyView'

// Der Hinweis nach dem Wechsel in ein Objekt ohne Wohnungen (#157), oben auf jeder Seite. Ohne ihn
// sah ein frisch angelegtes Objekt aus wie ein verlorener Bestand: alle Seiten leer, und nur der
// Umschalter in der Seitenleiste verriet, dass bloß gewechselt wurde. Ob er erscheint, entscheidet
// `emptyPropertyNotice` in propertyView.ts.
//
// `onSetUp` fehlt in den Stammdaten: Dort steht „+ Wohnung hinzufügen“ ohnehin vor Augen.
// `focus` setzt den Fokus auf die Überschrift, nach dem Anlegen über den Dialog.
export default function PropertyNotice({ current, previous, previousHadUnits, focus, onFocused, onBack, onSetUp, onDismiss }: {
  current: string
  previous: Property
  previousHadUnits: boolean
  focus: boolean
  onFocused: () => void
  onBack: () => void
  onSetUp?: () => void
  onDismiss: () => void
}) {
  const before = propertyName(previous)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!focus) return
    heading.current?.focus()
    onFocused()
  }, [focus, onFocused])
  return (
    <section className="hint property-notice no-print" role="region" aria-label="Neues Objekt">
      <div className="property-notice-text">
        <h2 className="property-notice-title" tabIndex={-1} ref={heading}>
          Sie arbeiten jetzt in „{current}“, das noch keine Wohnungen hat.
        </h2>
        {previousHadUnits
          ? <>Ihre Daten in „{before}“ sind unverändert.</>
          : <>Ihr Objekt „{before}“ bleibt, wie es ist.</>}{' '}
        Die Seiten zeigen immer das Objekt, das in der Seitenleiste unter „Objekt“ gewählt ist.
      </div>
      <div className="property-notice-actions">
        <button className="btn" onClick={onBack}>Zurück zu „{before}“</button>
        {onSetUp && <button className="btn secondary" onClick={onSetUp}>Wohnungen anlegen</button>}
        <button className="btn ghost" onClick={onDismiss} aria-label="Hinweis schließen">Schließen</button>
      </div>
    </section>
  )
}

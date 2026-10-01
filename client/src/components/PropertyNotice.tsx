import type { Property } from '../types'
import { propertyName } from '../propertyView'

// Der Hinweis nach dem Wechsel in ein Objekt ohne Wohnungen (#157), oben auf jeder Seite. Ohne ihn
// sah ein frisch angelegtes Objekt aus wie ein verlorener Bestand: alle Seiten leer, und nur der
// Umschalter in der Seitenleiste verriet, dass bloß gewechselt wurde. Ob er erscheint, entscheidet
// `emptyPropertyNotice` in propertyView.ts.
export default function PropertyNotice({ current, previous, onBack, onSetUp, onDismiss }: {
  current: string
  previous: Property
  onBack: () => void
  onSetUp: () => void
  onDismiss: () => void
}) {
  const before = propertyName(previous)
  return (
    <section className="hint property-notice no-print" role="region" aria-label="Neues Objekt">
      <div className="property-notice-text">
        <strong>Sie arbeiten jetzt in „{current}“ — dieses Objekt ist noch leer.</strong>{' '}
        Ihre Daten in „{before}“ sind unverändert. Die Seiten zeigen immer das Objekt, das in der
        Seitenleiste unter „Objekt“ gewählt ist.
      </div>
      <div className="property-notice-actions">
        <button className="btn" onClick={onBack}>Zurück zu „{before}“</button>
        <button className="btn secondary" onClick={onSetUp}>Wohnungen anlegen</button>
        <button className="btn ghost" onClick={onDismiss} aria-label="Hinweis schließen">Schließen</button>
      </div>
    </section>
  )
}

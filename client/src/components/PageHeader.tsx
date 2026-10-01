import type { ReactNode } from 'react'
import { usePropertyHeading } from '../property'

// Einheitlicher Seitenkopf: Titel + Untertitel links, Primäraktion(en) rechts. Ersetzt das
// bisherige Muster (h1 + p.sub einzeln, Aktion irgendwo in der Seite) auf allen Seiten.
export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  // Ab zwei Objekten steht über dem Titel, in welchem Objekt die Seite gerade ist (#157). Sonst
  // sah ein leeres neues Objekt aus wie ein verlorener Bestand.
  const propertyName = usePropertyHeading()
  return (
    <div className="page-head">
      <div className="page-head-text">
        {propertyName && (
          <div className="page-property" data-testid="page-property">
            <span className="page-property-label">Objekt</span> {propertyName}
          </div>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions no-print">{actions}</div>}
    </div>
  )
}

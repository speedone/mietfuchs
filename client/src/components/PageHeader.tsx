import type { ReactNode } from 'react'
import { useOptionalProperty } from '../property'
import { useOptionalPeriod } from '../period'
import { pageContextLine, type PageContextKind } from '../propertyView'

// Einheitlicher Seitenkopf: Kontextzeile, Titel + Untertitel links, Primäraktion(en) rechts. Ersetzt das
// bisherige Muster (h1 + p.sub einzeln, Aktion irgendwo in der Seite) auf allen Seiten.
//
// Die Kontextzeile (#346 Schritt 8, M13) nennt Objekt und Abrechnungszeitraum, in denen die Seite steht,
// „Lindenweg 12 · Abrechnungsjahr 2025“. Sie ist nur Anzeige: Gewählt wird beides in der Seitenleiste bzw. im
// Menüblatt (Wächter S18). Am Handy nennt der angeheftete Kopf Objekt und Zeitraum, dort entfällt sie auf dem
// Bildschirm (index.css). Gedruckt wird sie, damit das Papier sagt, für welches Objekt und Jahr es gilt.
// Seit #157 nennt der Seitenkopf das Objekt; vorher sah ein leeres neues Objekt aus wie ein verlorener Bestand.
export default function PageHeader({
  title,
  subtitle,
  actions,
  context = 'period',
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  context?: PageContextKind
}) {
  // Ohne Provider (Tests einzelner Seiten) ohne Objekt bzw. ohne Zeitraum, statt zu werfen.
  const property = useOptionalProperty()?.property ?? null
  const period = useOptionalPeriod()
  const line = pageContextLine(context, property, period)
  return (
    <div className="page-head">
      <div className="page-head-text">
        {line && <p className="page-context" data-testid="page-context">{line}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions no-print">{actions}</div>}
    </div>
  )
}

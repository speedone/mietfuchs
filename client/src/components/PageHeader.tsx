import type { ReactNode } from 'react'

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
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {subtitle && <p className="sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions no-print">{actions}</div>}
    </div>
  )
}
